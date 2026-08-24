import { routeEdges } from "@mr_mint/elkjs-libavoid";
import type { ElkNode, ElkPort } from "elkjs/lib/elk-api.js";
import type { LayoutConfig } from "../config.js";
import { isContainer, isLayoutOnly, isRenderable, type AstEdge, type FlatLayoutNode, type Point, type RoutedEdge } from "../model.js";
import { byDeclarationOrder, simplifyWaypoints } from "./common.js";

type RoutingGroup = { edges: AstEdge[]; excludedContainers: Set<string> };
export type Route = { sourcePoint: Point; targetPoint: Point; bendPoints: Point[] };
type RoutePath = { edge: AstEdge; route: Route; points: Point[] };
type Rect = { x: number; y: number; width: number; height: number };
type Segment = { path: RoutePath; index: number; start: Point; end: Point; horizontal: boolean };

function portId(nodeId: string, side: NonNullable<AstEdge["sourceSide"]>): string {
    return `__drawdsl_${nodeId}_${side}_port`;
}

function portsFor(node: FlatLayoutNode, edges: AstEdge[]): ElkPort[] {
    const sides = new Set<NonNullable<AstEdge["sourceSide"]>>();
    for (const edge of edges) {
        if (edge.source === node.id && edge.sourceSide) sides.add(edge.sourceSide);
        if (edge.target === node.id && edge.targetSide) sides.add(edge.targetSide);
    }
    return [...sides].map((side) => ({
        id: portId(node.id, side),
        x: side === "left" ? 0 : side === "right" ? node.width : node.width / 2,
        y: side === "top" ? 0 : side === "bottom" ? node.height : node.height / 2,
        width: 0,
        height: 0,
    }));
}

function visibleContainerAncestors(id: string, nodesById: Map<string, FlatLayoutNode>): Set<string> {
    const result = new Set<string>();
    let current = nodesById.get(id);
    while (current) {
        if (isContainer(current) && !isLayoutOnly(current)) result.add(current.id);
        current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return result;
}

function routingGroups(nodes: FlatLayoutNode[], edges: AstEdge[]): RoutingGroup[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const groups = new Map<string, RoutingGroup>();
    for (const edge of edges) {
        const excludedContainers = visibleContainerAncestors(edge.source, byId);
        for (const id of visibleContainerAncestors(edge.target, byId)) excludedContainers.add(id);
        const key = [...excludedContainers].sort().join("\u0000");
        const group = groups.get(key);
        if (group) group.edges.push(edge);
        else groups.set(key, { edges: [edge], excludedContainers });
    }
    return [...groups.values()];
}

function routingGraph(nodes: FlatLayoutNode[], group: RoutingGroup): ElkNode {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const endpoints = new Set(group.edges.flatMap((edge) => [edge.source, edge.target]));
    const blockingContainers = new Set(nodes.filter((node) => isContainer(node) && !isLayoutOnly(node) && !group.excludedContainers.has(node.id)).map((node) => node.id));
    const hasBlockingAncestor = (node: FlatLayoutNode): boolean => {
        let parent = node.parentId ? nodesById.get(node.parentId) : undefined;
        while (parent) {
            if (blockingContainers.has(parent.id)) return true;
            parent = parent.parentId ? nodesById.get(parent.parentId) : undefined;
        }
        return false;
    };
    const children: ElkNode[] = nodes.filter((node) => {
        if (!isRenderable(node)) return false;
        if (endpoints.has(node.id)) return true;
        if (hasBlockingAncestor(node)) return false;
        return !isContainer(node) || blockingContainers.has(node.id);
    }).map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height, ports: portsFor(node, group.edges) }));
    return {
        id: "root",
        children,
        edges: group.edges.map((edge) => ({
            id: edge.id,
            sources: [edge.sourceSide ? portId(edge.source, edge.sourceSide) : edge.source],
            targets: [edge.targetSide ? portId(edge.target, edge.targetSide) : edge.target],
        })),
    };
}

async function routeWithContainerObstacles(nodes: FlatLayoutNode[], edges: AstEdge[], config: LayoutConfig): Promise<Map<string, Route>> {
    const routes = new Map<string, Route>();
    for (const group of routingGroups(nodes, edges)) {
        const groupRoutes = await routeEdges(routingGraph(nodes, group), {
            shapeBufferDistance: config.edgeEndpointClearance,
            idealNudgingDistance: config.edgeSpacing,
            nudgeOrthogonalSegmentsConnectedToShapes: true,
            nudgeOrthogonalTouchingColinearSegments: true,
            nudgeSharedPathsWithCommonEndPoint: true,
            performUnifyingNudgingPreprocessingStep: true,
        });
        for (const [id, route] of groupRoutes) routes.set(id, route);
    }
    return routes;
}

function routeObstacles(nodes: FlatLayoutNode[], edge: AstEdge): Rect[] {
    const group = routingGroups(nodes, [edge])[0]!;
    return (routingGraph(nodes, group).children ?? [])
        .filter((node) => node.id !== edge.source && node.id !== edge.target)
        .map((node) => ({ x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 }));
}

function routeSegments(paths: RoutePath[]): Segment[] {
    const segments: Segment[] = [];
    for (const path of paths) {
        for (let index = 0; index < path.points.length - 1; index += 1) {
            const start = path.points[index]!;
            const end = path.points[index + 1]!;
            if (start.x === end.x || start.y === end.y) segments.push({ path, index, start, end, horizontal: start.y === end.y });
        }
    }
    return segments;
}

function overlapLength(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): number {
    return Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd)) - Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd));
}

function tooClose(first: Segment, second: Segment, edgeSpacing: number): boolean {
    if (first.horizontal !== second.horizontal) return false;
    const distance = first.horizontal ? Math.abs(first.start.y - second.start.y) : Math.abs(first.start.x - second.start.x);
    if (distance >= edgeSpacing) return false;
    const firstStart = first.horizontal ? first.start.x : first.start.y;
    const firstEnd = first.horizontal ? first.end.x : first.end.y;
    const secondStart = second.horizontal ? second.start.x : second.start.y;
    const secondEnd = second.horizontal ? second.end.x : second.end.y;
    return overlapLength(firstStart, firstEnd, secondStart, secondEnd) > 0;
}

function crossesObstacle(start: Point, end: Point, obstacle: Rect): boolean {
    if (start.x === end.x) {
        return start.x > obstacle.x && start.x < obstacle.x + obstacle.width
            && Math.max(start.y, end.y) > obstacle.y && Math.min(start.y, end.y) < obstacle.y + obstacle.height;
    }
    return start.y > obstacle.y && start.y < obstacle.y + obstacle.height
        && Math.max(start.x, end.x) > obstacle.x && Math.min(start.x, end.x) < obstacle.x + obstacle.width;
}

function pathAvoidsObstacles(points: Point[], obstacles: Rect[]): boolean {
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1]!;
        const end = points[index]!;
        if (start.x !== end.x && start.y !== end.y) return false;
        if (obstacles.some((obstacle) => crossesObstacle(start, end, obstacle))) return false;
    }
    return true;
}

function shifted(point: Point, horizontal: boolean, offset: number): Point {
    return horizontal ? { x: point.x, y: point.y + offset } : { x: point.x + offset, y: point.y };
}

function pointAlong(start: Point, end: Point, distance: number): Point {
    if (start.x === end.x) return { x: start.x, y: start.y + Math.sign(end.y - start.y) * distance };
    return { x: start.x + Math.sign(end.x - start.x) * distance, y: start.y };
}

function nudgePath(segment: Segment, offset: number, endpointClearance: number): Point[] | undefined {
    const { points } = segment.path;
    const { index } = segment;
    const length = Math.abs(segment.end.x - segment.start.x) + Math.abs(segment.end.y - segment.start.y);
    const isFirst = index === 0;
    const isLast = index === points.length - 2;
    if (isFirst && isLast) {
        if (length < endpointClearance * 2) return undefined;
        const firstJunction = pointAlong(segment.start, segment.end, endpointClearance);
        const lastJunction = pointAlong(segment.end, segment.start, endpointClearance);
        return simplifyWaypoints([segment.start, firstJunction, shifted(firstJunction, segment.horizontal, offset), shifted(lastJunction, segment.horizontal, offset), lastJunction, segment.end]);
    }
    if (isFirst) {
        if (length < endpointClearance) return undefined;
        const junction = pointAlong(segment.start, segment.end, endpointClearance);
        return simplifyWaypoints([...points.slice(0, 1), junction, shifted(junction, segment.horizontal, offset), shifted(segment.end, segment.horizontal, offset), ...points.slice(2)]);
    }
    if (isLast) {
        if (length < endpointClearance) return undefined;
        const junction = pointAlong(segment.end, segment.start, endpointClearance);
        return simplifyWaypoints([...points.slice(0, index + 1), shifted(segment.start, segment.horizontal, offset), shifted(junction, segment.horizontal, offset), junction, segment.end]);
    }
    return simplifyWaypoints([...points.slice(0, index + 1), shifted(segment.start, segment.horizontal, offset), shifted(segment.end, segment.horizontal, offset), ...points.slice(index + 1)]);
}

function conflictScore(paths: RoutePath[], edgeSpacing: number): number {
    const segments = routeSegments(paths);
    let score = 0;
    for (let first = 0; first < segments.length; first += 1) {
        for (let second = first + 1; second < segments.length; second += 1) {
            if (segments[first]!.path !== segments[second]!.path && tooClose(segments[first]!, segments[second]!, edgeSpacing)) score += 2;
        }
    }
    return score;
}

/** Separates close or shared route segments from every routing group when a clear lane exists. */
export function enforceGlobalEdgeSpacing(nodes: FlatLayoutNode[], edges: AstEdge[], routes: Map<string, Route>, config: LayoutConfig): void {
    const paths = edges.flatMap((edge): RoutePath[] => {
        const route = routes.get(edge.id);
        return route ? [{ edge, route, points: [route.sourcePoint, ...route.bendPoints, route.targetPoint] }] : [];
    });
    const obstacles = new Map(paths.map((path) => [path.edge.id, routeObstacles(nodes, path.edge)]));
    const maxAdjustments = Math.max(paths.length * 8, 1);
    for (let adjustment = 0; adjustment < maxAdjustments; adjustment += 1) {
        const baseline = conflictScore(paths, config.edgeSpacing);
        if (!baseline) break;
        let adjusted = false;
        const segments = routeSegments(paths);
        for (let first = 0; first < segments.length && !adjusted; first += 1) {
            for (let second = first + 1; second < segments.length && !adjusted; second += 1) {
                const a = segments[first]!;
                const b = segments[second]!;
                if (a.path === b.path || !tooClose(a, b, config.edgeSpacing)) continue;
                for (const segment of [b, a]) {
                    for (const multiplier of [1, -1, 2, -2, 3, -3]) {
                        const candidate = nudgePath(segment, multiplier * config.edgeSpacing, config.edgeEndpointClearance);
                        if (!candidate || !pathAvoidsObstacles(candidate, obstacles.get(segment.path.edge.id) ?? [])) continue;
                        const original = segment.path.points;
                        segment.path.points = candidate;
                        if (conflictScore(paths, config.edgeSpacing) < baseline) {
                            adjusted = true;
                            break;
                        }
                        segment.path.points = original;
                    }
                    if (adjusted) break;
                }
            }
        }
        if (!adjusted) break;
    }
    for (const path of paths) path.route.bendPoints = simplifyWaypoints(path.points).slice(1, -1);
}

export async function routeDiagram(nodes: FlatLayoutNode[], edges: AstEdge[], config: LayoutConfig): Promise<RoutedEdge[]> {
    const routes = await routeWithContainerObstacles(nodes, edges, config);
    enforceGlobalEdgeSpacing(nodes, edges, routes, config);
    return byDeclarationOrder(edges.map((edge): RoutedEdge => {
        const route = routes.get(edge.id);
        return route ? { ...edge, points: simplifyWaypoints(route.bendPoints), sourcePoint: route.sourcePoint, targetPoint: route.targetPoint } : { ...edge, points: [] };
    }));
}
