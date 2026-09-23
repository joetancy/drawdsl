import { routeEdges } from "@mr_mint/elkjs-libavoid";
import type { ElkNode, ElkPort } from "elkjs/lib/elk-api.js";
import type { LayoutConfig } from "../config.js";
import { isContainer, isLayoutOnly, isRenderable, type AstEdge, type FlatLayoutNode, type Point, type RoutedEdge } from "../model.js";
import { byDeclarationOrder, simplifyWaypoints } from "./common.js";

type RoutingGroup = { edges: AstEdge[]; excludedContainers: Set<string> };
export type Route = { sourcePoint: Point; targetPoint: Point; bendPoints: Point[] };
type RoutePath = { edge: AstEdge; route: Route; points: Point[] };
type Rect = { x: number; y: number; width: number; height: number };
type LineSegment = { start: Point; end: Point; horizontal: boolean };
type Segment = LineSegment & { path: RoutePath; index: number };

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

function tooClose(first: LineSegment, second: LineSegment, edgeSpacing: number): boolean {
    if (first.horizontal !== second.horizontal) return false;
    const distance = first.horizontal ? Math.abs(first.start.y - second.start.y) : Math.abs(first.start.x - second.start.x);
    if (distance >= edgeSpacing) return false;
    const firstStart = first.horizontal ? first.start.x : first.start.y;
    const firstEnd = first.horizontal ? first.end.x : first.end.y;
    const secondStart = second.horizontal ? second.start.x : second.start.y;
    const secondEnd = second.horizontal ? second.end.x : second.end.y;
    return overlapLength(firstStart, firstEnd, secondStart, secondEnd) > 0;
}

function containerBorders(nodes: FlatLayoutNode[]): LineSegment[] {
    return nodes.filter((node) => isContainer(node) && isRenderable(node)).flatMap((node) => [
        { start: { x: node.x, y: node.y }, end: { x: node.x + node.width, y: node.y }, horizontal: true },
        { start: { x: node.x, y: node.y + node.height }, end: { x: node.x + node.width, y: node.y + node.height }, horizontal: true },
        { start: { x: node.x, y: node.y }, end: { x: node.x, y: node.y + node.height }, horizontal: false },
        { start: { x: node.x + node.width, y: node.y }, end: { x: node.x + node.width, y: node.y + node.height }, horizontal: false },
    ]);
}

function boundaryConflicts(path: RoutePath, borders: LineSegment[], clearance: number): Array<{ segment: Segment; border: LineSegment }> {
    return routeSegments([path]).flatMap((segment) => borders.filter((border) => tooClose(segment, border, clearance)).map((border) => ({ segment, border })));
}

function boundaryPenalty(path: RoutePath, borders: LineSegment[], clearance: number): number {
    return boundaryConflicts(path, borders, clearance).reduce((sum, { segment, border }) => {
        const horizontal = segment.horizontal;
        const distance = Math.abs(horizontal ? segment.start.y - border.start.y : segment.start.x - border.start.x);
        const overlap = horizontal ? overlapLength(segment.start.x, segment.end.x, border.start.x, border.end.x)
            : overlapLength(segment.start.y, segment.end.y, border.start.y, border.end.y);
        return sum + overlap * (clearance - distance) / (1 + distance);
    }, 0);
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

function paddedObstacles(obstacles: Rect[], clearance: number): Rect[] {
    return obstacles.map((obstacle) => ({
        x: obstacle.x - clearance,
        y: obstacle.y - clearance,
        width: obstacle.width + clearance * 2,
        height: obstacle.height + clearance * 2,
    }));
}

function sharedLength(points: Point[], paths: RoutePath[], except: RoutePath): number {
    let length = 0;
    const candidateSegments: Array<{ start: Point; end: Point; horizontal: boolean }> = [];
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1]!;
        const end = points[index]!;
        if (start.x === end.x || start.y === end.y) candidateSegments.push({ start, end, horizontal: start.y === end.y });
    }
    for (const segment of candidateSegments) {
        for (const other of routeSegments(paths)) {
            if (other.path === except || other.horizontal !== segment.horizontal) continue;
            const sameLane = segment.horizontal ? segment.start.y === other.start.y : segment.start.x === other.start.x;
            if (!sameLane) continue;
            const firstStart = segment.horizontal ? segment.start.x : segment.start.y;
            const firstEnd = segment.horizontal ? segment.end.x : segment.end.y;
            const secondStart = segment.horizontal ? other.start.x : other.start.y;
            const secondEnd = segment.horizontal ? other.end.x : other.end.y;
            length += Math.max(0, overlapLength(firstStart, firstEnd, secondStart, secondEnd));
        }
    }
    return length;
}

function validAttachment(point: Point, adjacent: Point, original: Point, node: FlatLayoutNode | undefined, fixed: boolean): boolean {
    const unchanged = point.x === original.x && point.y === original.y;
    if (!node) return unchanged;
    if (fixed && !unchanged) return false;
    return (original.x === node.x && point.x === node.x && point.y >= node.y && point.y <= node.y + node.height && adjacent.x < point.x && adjacent.y === point.y)
        || (original.x === node.x + node.width && point.x === original.x && point.y >= node.y && point.y <= node.y + node.height && adjacent.x > point.x && adjacent.y === point.y)
        || (original.y === node.y && point.y === node.y && point.x >= node.x && point.x <= node.x + node.width && adjacent.y < point.y && adjacent.x === point.x)
        || (original.y === node.y + node.height && point.y === original.y && point.x >= node.x && point.x <= node.x + node.width && adjacent.y > point.y && adjacent.x === point.x);
}

type CleanupIndex = {
    byId: Map<string, FlatLayoutNode>;
    borders: LineSegment[];
    obstaclesByEdge: Map<string, Rect[]>;
};

// Nodes are fixed for the whole cleanup pass, so build per-edge obstacles once
// instead of recomputing them for every path in every phase.
function buildCleanupIndex(nodes: FlatLayoutNode[], paths: RoutePath[]): CleanupIndex {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const borders = containerBorders(nodes);
    const obstaclesByEdge = new Map<string, Rect[]>();
    for (const path of paths) {
        if (!obstaclesByEdge.has(path.edge.id)) obstaclesByEdge.set(path.edge.id, routeObstacles(nodes, path.edge));
    }
    return { byId, borders, obstaclesByEdge };
}

function straightenRoutes(nodes: FlatLayoutNode[], paths: RoutePath[], config: LayoutConfig, index: CleanupIndex): void {
    const { byId, borders } = index;
    for (const path of paths) {
        const base = index.obstaclesByEdge.get(path.edge.id) ?? [];
        const obstacles = paddedObstacles(base, config.edgeEndpointClearance);
        // Endpoints are not routing obstacles, but a shortcut must not cut through their icons.
        for (const id of [path.edge.source, path.edge.target]) {
            const node = byId.get(id);
            if (node && !isContainer(node)) obstacles.push(node);
        }
        path.points = simplifyWaypoints(path.points);
        let improved = true;
        while (improved) {
            improved = false;
            const segments = routeSegments([path]);
            for (let first = 0; first < segments.length && !improved; first += 1) {
                for (let last = segments.length - 1; last > first && !improved; last -= 1) {
                    const a = segments[first]!;
                    const b = segments[last]!;
                    if (a.horizontal !== b.horizontal) continue;
                    for (const lane of [a.start, b.end]) {
                        const start = a.horizontal ? { x: a.start.x, y: lane.y } : { x: lane.x, y: a.start.y };
                        const end = a.horizontal ? { x: b.end.x, y: lane.y } : { x: lane.x, y: b.end.y };
                        const candidate = simplifyWaypoints([...path.points.slice(0, a.index), start, end, ...path.points.slice(b.index + 2)]);
                        if (candidate.length < 2 || candidate.length >= path.points.length) continue;
                        if (!validAttachment(candidate[0]!, candidate[1]!, path.route.sourcePoint, byId.get(path.edge.source), !!path.edge.sourceSide)
                            || !validAttachment(candidate.at(-1)!, candidate.at(-2)!, path.route.targetPoint, byId.get(path.edge.target), !!path.edge.targetSide)) continue;
                        if (boundaryPenalty({ ...path, points: candidate }, borders, config.edgeEndpointClearance) > boundaryPenalty(path, borders, config.edgeEndpointClearance)) continue;
                        if (!pathAvoidsObstacles(candidate, obstacles) || sharedLength(candidate, paths, path) > sharedLength(path.points, paths, path)) continue;
                        path.points = candidate;
                        improved = true;
                        break;
                    }
                }
            }
        }
    }
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

function moveTerminalLane(segment: Segment, offset: number, node: FlatLayoutNode | undefined): Point[] | undefined {
    const { points, route } = segment.path;
    if (segment.index !== points.length - 2) return undefined;
    const junction = pointAlong(segment.start, segment.end, Math.min(
        (Math.abs(segment.end.x - segment.start.x) + Math.abs(segment.end.y - segment.start.y)) / 2, 40,
    ));
    const candidate = points.length >= 3
        ? [...points.slice(0, -2), shifted(segment.start, segment.horizontal, offset), shifted(segment.end, segment.horizontal, offset)]
        : [segment.start, junction, shifted(junction, segment.horizontal, offset), shifted(segment.end, segment.horizontal, offset)];
    if (!validAttachment(candidate.at(-1)!, candidate.at(-2)!, route.targetPoint, node, false)) return undefined;
    return simplifyWaypoints(candidate);
}

function clearContainerBorders(paths: RoutePath[], borders: LineSegment[], obstacles: Map<string, Rect[]>, config: LayoutConfig): void {
    for (const path of paths) {
        let conflicts = boundaryConflicts(path, borders, config.edgeEndpointClearance);
        // ponytail: local lane shifts; a full reroute is needed if every candidate is blocked.
        while (conflicts.length) {
            let improved = false;
            for (const { segment, border } of conflicts) {
                const distance = segment.horizontal ? border.start.y - segment.start.y : border.start.x - segment.start.x;
                const offsets = [1, 0.5, 0.25].flatMap((scale) => [distance - config.edgeEndpointClearance * scale, distance + config.edgeEndpointClearance * scale].sort((a, b) => Math.abs(a) - Math.abs(b)));
                for (const offset of offsets) {
                    const candidate = nudgePath(segment, offset, config.edgeEndpointClearance);
                    if (!candidate || !pathAvoidsObstacles(candidate, obstacles.get(path.edge.id) ?? []) || sharedLength(candidate, paths, path) > sharedLength(path.points, paths, path)) continue;
                    if (boundaryPenalty({ ...path, points: candidate }, borders, config.edgeEndpointClearance) >= boundaryPenalty(path, borders, config.edgeEndpointClearance)) continue;
                    path.points = candidate;
                    conflicts = boundaryConflicts(path, borders, config.edgeEndpointClearance);
                    improved = true;
                    break;
                }
                if (improved) break;
            }
            if (!improved) break;
        }
    }
}

function conflictScore(paths: RoutePath[], edgeSpacing: number): number {
    const segments = routeSegments(paths);
    let score = 0;
    for (let first = 0; first < segments.length; first += 1) {
        for (let second = first + 1; second < segments.length; second += 1) {
            const a = segments[first]!;
            const b = segments[second]!;
            if (a.path === b.path || !tooClose(a, b, edgeSpacing)) continue;
            const aStart = a.horizontal ? a.start.x : a.start.y;
            const aEnd = a.horizontal ? a.end.x : a.end.y;
            const bStart = b.horizontal ? b.start.x : b.start.y;
            const bEnd = b.horizontal ? b.end.x : b.end.y;
            const distance = a.horizontal ? Math.abs(a.start.y - b.start.y) : Math.abs(a.start.x - b.start.x);
            score += overlapLength(aStart, aEnd, bStart, bEnd) * (edgeSpacing - distance) / edgeSpacing;
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
    const index = buildCleanupIndex(nodes, paths);
    straightenRoutes(nodes, paths, config, index);
    const obstacles = new Map(paths.map((path) => [path.edge.id, paddedObstacles(index.obstaclesByEdge.get(path.edge.id) ?? [], config.edgeEndpointClearance)]));
    const { borders } = index;
    for (const path of paths) {
        obstacles.get(path.edge.id)!.push(...nodes.filter((node) => !isContainer(node) && (node.id === path.edge.source || node.id === path.edge.target)));
    }
    clearContainerBorders(paths, borders, obstacles, config);
    straightenRoutes(nodes, paths, config, index);
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
                        const offset = multiplier * config.edgeSpacing;
                        const terminal = a.path.edge.target === b.path.edge.target
                            ? moveTerminalLane(segment, offset, index.byId.get(segment.path.edge.target)) : undefined;
                        for (const candidate of [terminal, nudgePath(segment, offset, config.edgeEndpointClearance)]) {
                            if (!candidate || !pathAvoidsObstacles(candidate, obstacles.get(segment.path.edge.id) ?? [])) continue;
                            if (boundaryConflicts({ ...segment.path, points: candidate }, borders, config.edgeEndpointClearance).length) continue;
                            if (candidate !== terminal && candidate.length > simplifyWaypoints(segment.path.points).length) continue;
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
                    if (adjusted) break;
                }
            }
        }
        if (!adjusted) break;
    }
    for (const path of paths) {
        path.route.sourcePoint = path.points[0]!;
        path.route.targetPoint = path.points.at(-1)!;
        path.route.bendPoints = simplifyWaypoints(path.points).slice(1, -1);
    }
}

export async function routeDiagram(nodes: FlatLayoutNode[], edges: AstEdge[], config: LayoutConfig): Promise<RoutedEdge[]> {
    const routes = await routeWithContainerObstacles(nodes, edges, config);
    enforceGlobalEdgeSpacing(nodes, edges, routes, config);
    return byDeclarationOrder(edges.map((edge): RoutedEdge => {
        const route = routes.get(edge.id);
        return route ? { ...edge, points: simplifyWaypoints(route.bendPoints), sourcePoint: route.sourcePoint, targetPoint: route.targetPoint } : { ...edge, points: [] };
    }));
}
