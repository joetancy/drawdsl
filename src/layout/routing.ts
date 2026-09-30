import { routeEdges } from "@mr_mint/elkjs-libavoid";
import type { ElkNode, ElkPort } from "elkjs/lib/elk-api.js";
import type { LayoutConfig } from "../config.js";
import { isContainer, isLayoutOnly, isRenderable, type AstEdge, type FlatLayoutNode, type Point, type RoutedEdge } from "../model.js";
import { byDeclarationOrder, simplifyWaypoints } from "./common.js";

type RoutingGroup = { edges: AstEdge[]; excludedContainers: Set<string> };
export type Route = { sourcePoint: Point; targetPoint: Point; bendPoints: Point[] };
export type RoutingQuality = "beautiful" | "fast";
type RoutePath = { edge: AstEdge; route: Route; points: Point[] };
type Rect = { x: number; y: number; width: number; height: number };
type LineSegment = { start: Point; end: Point; horizontal: boolean };
type Segment = LineSegment & { path: RoutePath; index: number };
type SegmentScore = "conflict" | "shared";
type Side = NonNullable<AstEdge["sourceSide"]>;
type PortAssignment = { ports: Map<string, ElkPort[]>; crowdedSides: number };
export type RoutingDiagnostics = { sharedSegmentPairs: number; spacingConflictPairs: number; crowdedSides: number };

function portId(edgeId: string, source: boolean): string {
    return `__drawdsl_${edgeId}_${source ? "source" : "target"}_port`;
}

function sidePoint(node: FlatLayoutNode, side: Side, along: number): Point {
    return {
        x: side === "left" ? node.x : side === "right" ? node.x + node.width : node.x + along,
        y: side === "top" ? node.y : side === "bottom" ? node.y + node.height : node.y + along,
    };
}

function routingBuffer(graph: ElkNode, config: LayoutConfig): number {
    const shapes = graph.children ?? [];
    let buffer = config.edgeEndpointClearance;
    for (let i = 0; i < shapes.length; i += 1) for (let j = i + 1; j < shapes.length; j += 1) {
        const a = shapes[i]!;
        const b = shapes[j]!;
        const xOverlap = overlapLength(a.x!, a.x! + a.width!, b.x!, b.x! + b.width!);
        const yOverlap = overlapLength(a.y!, a.y! + a.height!, b.y!, b.y! + b.height!);
        const xGap = Math.max(a.x!, b.x!) - Math.min(a.x! + a.width!, b.x! + b.width!);
        const yGap = Math.max(a.y!, b.y!) - Math.min(a.y! + a.height!, b.y! + b.height!);
        const gap = xOverlap > 0 && yGap > 0 ? yGap : yOverlap > 0 && xGap > 0 ? xGap : undefined;
        if (gap !== undefined) buffer = Math.min(buffer, Math.max(config.edgeSpacing / 2, (gap - config.edgeSpacing * 2) / 2));
    }
    return buffer;
}

/** Allocate across every routing group: a side selector fixes the side, not a shared midpoint. */
function assignPorts(nodes: FlatLayoutNode[], edges: AstEdge[], config: LayoutConfig): PortAssignment {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const entries = new Map<string, Array<{ edge: AstEdge; source: boolean; side: Side; other: FlatLayoutNode }>>();
    const ports = new Map<string, ElkPort[]>();
    // Reserve pinned sides first; flexible endpoints can use another side when one is full.
    for (const pinned of [true, false]) for (const edge of byDeclarationOrder(edges)) {
        if (edge.source === edge.target) continue;
        for (const source of [true, false]) {
            const fixedSide = source ? edge.sourceSide : edge.targetSide;
            if (!!fixedSide !== pinned) continue;
            const node = byId.get(source ? edge.source : edge.target);
            const other = byId.get(source ? edge.target : edge.source);
            if (!node || !other) continue;
            const incident = entries.get(node.id) ?? [];
            const otherCentre = { x: other.x + other.width / 2, y: other.y + other.height / 2 };
            const excluded = visibleContainerAncestors(node.id, byId);
            for (const id of visibleContainerAncestors(other.id, byId)) excluded.add(id);
            const sideCost = (side: Side): number => {
                const vertical = side === "left" || side === "right";
                const length = vertical ? node.height : node.width;
                const margin = Math.min(config.edgeSpacing / 2, length / 4);
                const capacity = Math.floor((length - margin * 2) / config.edgeSpacing) + 1;
                const point = sidePoint(node, side, length / 2);
                const outside = sidePoint(node, side, length / 2);
                if (side === "left") outside.x -= config.edgeEndpointClearance;
                if (side === "right") outside.x += config.edgeEndpointClearance;
                if (side === "top") outside.y -= config.edgeEndpointClearance;
                if (side === "bottom") outside.y += config.edgeEndpointClearance;
                const backwards = side === "left" ? otherCentre.x > point.x : side === "right" ? otherCentre.x < point.x
                    : side === "top" ? otherCentre.y > point.y : otherCentre.y < point.y;
                const blocked = nodes.some((obstacle) => obstacle.id !== node.id && obstacle.id !== other.id && isRenderable(obstacle)
                    && !excluded.has(obstacle.id) && crossesObstacle(point, outside, obstacle));
                return Math.abs(point.x - otherCentre.x) + Math.abs(point.y - otherCentre.y)
                    + (backwards ? config.edgeEndpointClearance * 4 : 0)
                    + (blocked ? config.edgeEndpointClearance * 8 : 0)
                    + (incident.filter((entry) => entry.side === side).length >= capacity ? config.edgeEndpointClearance * 8 : 0);
            };
            const side = fixedSide ?? (["left", "right", "top", "bottom"] as Side[])
                .map((side) => ({ side, cost: sideCost(side) })).sort((a, b) => a.cost - b.cost)[0]!.side;
            incident.push({ edge, source, side, other });
            entries.set(node.id, incident);
        }
    }
    let crowdedSides = 0;
    for (const [id, incident] of entries) {
        const node = byId.get(id)!;
        const nodePorts: ElkPort[] = [];
        for (const side of ["left", "right", "top", "bottom"] as Side[]) {
            const vertical = side === "left" || side === "right";
            const sorted = incident.filter((entry) => entry.side === side).sort((a, b) => {
                const position = (other: FlatLayoutNode): number => vertical ? other.y + other.height / 2 : other.x + other.width / 2;
                return position(a.other) - position(b.other) || a.edge.declarationOrder - b.edge.declarationOrder || Number(a.source) - Number(b.source);
            });
            if (!sorted.length) continue;
            const length = vertical ? node.height : node.width;
            const margin = Math.min(config.edgeSpacing / 2, length / 4);
            const spacing = sorted.length < 2 ? 0 : Math.min(config.edgeSpacing, (length - margin * 2) / (sorted.length - 1));
            if (sorted.length > 1 && spacing < config.edgeSpacing) crowdedSides += 1;
            const positions = sorted.map((entry) => {
                const pinned = entry.source ? entry.edge.sourceSide : entry.edge.targetSide;
                const projected = vertical ? entry.other.y + entry.other.height / 2 - node.y : entry.other.x + entry.other.width / 2 - node.x;
                return pinned && sorted.length === 1 ? length / 2 : Math.max(margin, Math.min(length - margin, projected));
            });
            for (let i = 1; i < positions.length; i += 1) positions[i] = Math.max(positions[i]!, positions[i - 1]! + spacing);
            positions[positions.length - 1] = Math.min(positions.at(-1)!, length - margin);
            for (let i = positions.length - 2; i >= 0; i -= 1) positions[i] = Math.min(positions[i]!, positions[i + 1]! - spacing);
            for (const [index, entry] of sorted.entries()) {
                const point = sidePoint(node, side, positions[index]!);
                nodePorts.push({ id: portId(entry.edge.id, entry.source), x: point.x - node.x, y: point.y - node.y, width: 0, height: 0 });
            }
        }
        ports.set(id, nodePorts);
    }
    return { ports, crowdedSides };
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

function routingGraph(nodes: FlatLayoutNode[], group: RoutingGroup, ports: Map<string, ElkPort[]> = new Map()): ElkNode {
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
    }).map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height, ports: ports.get(node.id) ?? [] }));
    return {
        id: "root",
        children,
        edges: group.edges.map((edge) => ({
            id: edge.id,
            sources: [ports.has(edge.source) && edge.source !== edge.target ? portId(edge.id, true) : edge.source],
            targets: [ports.has(edge.target) && edge.source !== edge.target ? portId(edge.id, false) : edge.target],
        })),
    };
}

async function routeWithContainerObstacles(nodes: FlatLayoutNode[], edges: AstEdge[], config: LayoutConfig, quality: RoutingQuality, ports: Map<string, ElkPort[]>): Promise<Map<string, Route>> {
    const routes = new Map<string, Route>();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const group of routingGroups(nodes, edges)) {
        const graph = routingGraph(nodes, group, ports);
        const options = {
            shapeBufferDistance: routingBuffer(graph, config),
            idealNudgingDistance: config.edgeSpacing,
            nudgeOrthogonalSegmentsConnectedToShapes: false,
            nudgeOrthogonalTouchingColinearSegments: quality === "beautiful",
            nudgeSharedPathsWithCommonEndPoint: quality === "beautiful",
            performUnifyingNudgingPreprocessingStep: false,
        };
        const groupRoutes = await routeEdges(graph, options);
        const invalid = (edge: AstEdge, route: Route | undefined): boolean => {
            if (!route) return edge.source !== edge.target;
            const points = [route.sourcePoint, ...route.bendPoints, route.targetPoint];
            const obstacles = (graph.children ?? []).filter((node) => node.id !== edge.source && node.id !== edge.target)
                .map((node) => ({ x: node.x!, y: node.y!, width: node.width!, height: node.height! }));
            return !points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
                || !pathAvoidsObstacles(points, obstacles) || selfIntersects(points)
                || !validAttachment(points[0]!, points[1]!, route.sourcePoint, byId.get(edge.source), true)
                || !validAttachment(points.at(-1)!, points.at(-2)!, route.targetPoint, byId.get(edge.target), true);
        };
        let failed = group.edges.filter((edge) => invalid(edge, groupRoutes.get(edge.id)));
        if (failed.length) {
            // Endpoint lead-in length is not obstacle padding: 40px buffers close an 80px grid gap.
            const retryOptions = { ...options, shapeBufferDistance: Math.min(config.edgeEndpointClearance, config.edgeSpacing / 2) };
            const compact = await routeEdges({ ...graph, edges: graph.edges?.filter((edge) => failed.some((item) => item.id === edge.id)) }, retryOptions);
            for (const edge of failed) {
                const route = compact.get(edge.id);
                if (!invalid(edge, route) && route) groupRoutes.set(edge.id, route);
            }
            failed = failed.filter((edge) => invalid(edge, groupRoutes.get(edge.id)));
            if (!failed.length) {
                for (const [id, route] of groupRoutes) routes.set(id, route);
                continue;
            }
            // Libavoid can return a centre-to-centre diagonal when fixed natural ports have no route.
            // Retry only failed edges once, letting unpinned ends choose another approach side.
            const pinnedPorts = new Set(failed.flatMap((edge) => [edge.sourceSide ? portId(edge.id, true) : "", edge.targetSide ? portId(edge.id, false) : ""]));
            const retryGraph = { ...graph, children: graph.children?.map((node) => ({ ...node, ports: node.ports?.filter((port) => pinnedPorts.has(port.id)) })), edges: failed.map((edge) => ({
                id: edge.id,
                sources: [edge.sourceSide ? portId(edge.id, true) : edge.source],
                targets: [edge.targetSide ? portId(edge.id, false) : edge.target],
            })) };
            const retry = await routeEdges(retryGraph, retryOptions);
            for (const edge of failed) {
                const route = retry.get(edge.id);
                if (invalid(edge, route)) throw new Error(`Could not route edge ${edge.source} → ${edge.target}; free space around its endpoints or change its pinned sides`);
                if (route) groupRoutes.set(edge.id, route);
            }
        }
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
    const others = routeSegments(paths);
    const candidateSegments: Array<{ start: Point; end: Point; horizontal: boolean }> = [];
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1]!;
        const end = points[index]!;
        if (start.x === end.x || start.y === end.y) candidateSegments.push({ start, end, horizontal: start.y === end.y });
    }
    for (const segment of candidateSegments) {
        for (const other of others) {
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
        const obstacles = paddedObstacles(base, Math.min(config.edgeEndpointClearance, config.edgeSpacing / 2));
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
                        if (selfIntersects(candidate) || !pathAvoidsObstacles(candidate, obstacles) || sharedLength(candidate, paths, path) > sharedLength(path.points, paths, path)) continue;
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
        return simplifyWaypoints([...points.slice(0, index), shifted(segment.start, segment.horizontal, offset), shifted(junction, segment.horizontal, offset), junction, segment.end]);
    }
    return simplifyWaypoints([...points.slice(0, index), shifted(segment.start, segment.horizontal, offset), shifted(segment.end, segment.horizontal, offset), ...points.slice(index + 2)]);
}

function moveEndpointLane(segment: Segment, offset: number, node: FlatLayoutNode | undefined, source: boolean): Point[] | undefined {
    const { points, route } = segment.path;
    if (segment.index !== (source ? 0 : points.length - 2)) return undefined;
    const ordered = source ? [...points].reverse() : points;
    const start = ordered.at(-2)!;
    const end = ordered.at(-1)!;
    const junction = pointAlong(start, end, Math.min(
        (Math.abs(end.x - start.x) + Math.abs(end.y - start.y)) / 2, 40,
    ));
    const candidate = ordered.length >= 3
        ? [...ordered.slice(0, -2), shifted(start, segment.horizontal, offset), shifted(end, segment.horizontal, offset)]
        : [start, junction, shifted(junction, segment.horizontal, offset), shifted(end, segment.horizontal, offset)];
    if (!validAttachment(candidate.at(-1)!, candidate.at(-2)!, source ? route.sourcePoint : route.targetPoint, node, false)) return undefined;
    return simplifyWaypoints(source ? candidate.reverse() : candidate);
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
                    if (!candidate || selfIntersects(candidate) || !pathAvoidsObstacles(candidate, obstacles.get(path.edge.id) ?? []) || sharedLength(candidate, paths, path) > sharedLength(path.points, paths, path)) continue;
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

function segmentPenalty(a: Segment, b: Segment, spacing: number, kind: SegmentScore): number {
    if (a.path === b.path || a.horizontal !== b.horizontal) return 0;
    const overlap = overlapLength(a.horizontal ? a.start.x : a.start.y, a.horizontal ? a.end.x : a.end.y,
        b.horizontal ? b.start.x : b.start.y, b.horizontal ? b.end.x : b.end.y);
    if (overlap <= 0) return 0;
    const distance = Math.abs((a.horizontal ? a.start.y : a.start.x) - (b.horizontal ? b.start.y : b.start.x));
    if (kind === "shared") return distance === 0 ? overlap : 0;
    return distance < spacing ? overlap * (spacing - distance) / spacing : 0;
}

// Only nearby lanes matter: edge spacing is minimum clearance, not a target bundle pitch.
class SegmentIndex {
    private readonly laneBuckets = new Map<string, Set<Segment>>();
    private readonly byPath = new Map<RoutePath, Segment[]>();
    conflict = 0;

    constructor(paths: RoutePath[], private readonly spacing: number) {
        for (const path of paths) this.replace(path);
    }

    private laneKey(segment: Segment): number {
        return Math.floor((segment.horizontal ? segment.start.y : segment.start.x) / this.spacing);
    }

    private nearby(segment: Segment): Set<Segment> {
        const result = new Set<Segment>();
        const lane = this.laneKey(segment);
        for (let offset = -1; offset <= 1; offset += 1) {
            for (const other of this.laneBuckets.get(`${segment.horizontal ? "h" : "v"}:${lane + offset}`) ?? []) result.add(other);
        }
        return result;
    }

    *pairs(): Generator<[Segment, Segment]> {
        const segments = [...this.byPath.values()].flat();
        const order = new Map(segments.map((segment, index) => [segment, index]));
        for (const a of segments) {
            const others = [...this.nearby(a)].filter((b) => order.get(b)! > order.get(a)!
                && segmentPenalty(a, b, this.spacing, "conflict") > 0);
            others.sort((a, b) => order.get(a)! - order.get(b)!);
            for (const b of others) yield [a, b];
        }
    }

    conflictingLanes(path: RoutePath): Segment[] {
        const result = new Set<Segment>();
        for (const segment of this.byPath.get(path) ?? []) for (const other of this.nearby(segment)) {
            if (segmentPenalty(segment, other, this.spacing, "conflict") > 0) result.add(other);
        }
        return [...result];
    }

    score(path: RoutePath, points: Point[], kind: SegmentScore): number {
        let score = 0;
        for (let index = 0; index < points.length - 1; index += 1) {
            const start = points[index]!;
            const end = points[index + 1]!;
            if (start.x !== end.x && start.y !== end.y) continue;
            const segment: Segment = { path, index, start, end, horizontal: start.y === end.y };
            for (const other of this.nearby(segment)) score += segmentPenalty(segment, other, this.spacing, kind);
        }
        return score;
    }

    replace(path: RoutePath): void {
        const old = this.byPath.get(path) ?? [];
        for (const segment of old) {
            for (const other of this.nearby(segment)) {
                this.conflict -= segmentPenalty(segment, other, this.spacing, "conflict");
            }
            const laneKey = `${segment.horizontal ? "h" : "v"}:${this.laneKey(segment)}`;
            const laneBucket = this.laneBuckets.get(laneKey)!;
            laneBucket.delete(segment);
            if (!laneBucket.size) this.laneBuckets.delete(laneKey);
        }
        const segments = routeSegments([path]);
        for (const segment of segments) {
            for (const other of this.nearby(segment)) {
                this.conflict += segmentPenalty(segment, other, this.spacing, "conflict");
            }
        }
        // Other routes stay indexed; only this route's pair contributions change.
        this.byPath.set(path, segments);
        for (const segment of segments) {
            const laneKey = `${segment.horizontal ? "h" : "v"}:${this.laneKey(segment)}`;
            let laneBucket = this.laneBuckets.get(laneKey);
            if (!laneBucket) { laneBucket = new Set(); this.laneBuckets.set(laneKey, laneBucket); }
            laneBucket.add(segment);
        }
        if (Math.abs(this.conflict) < 1e-7) this.conflict = 0;
    }
}

function pathLength(points: Point[]): number {
    return points.slice(1).reduce((length, point, index) => length + Math.abs(point.x - points[index]!.x) + Math.abs(point.y - points[index]!.y), 0);
}

function selfIntersects(points: Point[]): boolean {
    const segments = points.slice(1).map((end, index) => ({ start: points[index]!, end, horizontal: points[index]!.y === end.y }));
    for (let i = 0; i < segments.length; i += 1) {
        const a = segments[i]!;
        for (let j = i + 2; j < segments.length; j += 1) {
            const b = segments[j]!;
            if (a.horizontal === b.horizontal) {
                if (tooClose(a, b, 1e-7)) return true;
            } else {
                const h = a.horizontal ? a : b;
                const v = a.horizontal ? b : a;
                if (v.start.x >= Math.min(h.start.x, h.end.x) && v.start.x <= Math.max(h.start.x, h.end.x)
                    && h.start.y >= Math.min(v.start.y, v.end.y) && h.start.y <= Math.max(v.start.y, v.end.y)) return true;
            }
        }
        const b = segments[i + 1];
        if (b && a.horizontal === b.horizontal && overlapLength(a.horizontal ? a.start.x : a.start.y, a.horizontal ? a.end.x : a.end.y,
            b.horizontal ? b.start.x : b.start.y, b.horizontal ? b.end.x : b.end.y) > 0) return true;
    }
    return false;
}

/** Replace an entire approach with straight/L/Z candidates, rather than layering tiny endpoint jogs. */
function repairApproach(path: RoutePath, segmentsIndex: SegmentIndex, index: CleanupIndex, obstacles: Rect[], config: LayoutConfig): boolean {
    if (path.edge.source === path.edge.target || !index.byId.has(path.edge.source) || !index.byId.has(path.edge.target)) return false;
    const currentScore = segmentsIndex.score(path, path.points, "conflict");
    const currentShared = segmentsIndex.score(path, path.points, "shared");
    const currentLength = pathLength(path.points);
    const conflicts = segmentsIndex.conflictingLanes(path);
    let best = path.points;
    let bestScore = currentScore;
    let bestLength = currentLength;
    for (const source of [false, true]) {
        const points = source ? [...path.points].reverse() : path.points;
        const end = points.at(-1)!;
        // ponytail: bounded local repair; Libavoid handles long obstacle detours in the initial route.
        const joins = new Set([0, ...Array.from({ length: Math.min(5, points.length - 1) }, (_, i) => points.length - 2 - i)]);
        for (const join of joins) {
            const start = points[join]!;
            const xs = new Set([start.x, end.x, (start.x + end.x) / 2]);
            const ys = new Set([start.y, end.y, (start.y + end.y) / 2]);
            // Reserve a straight final approach outside the endpoint shape.
            const adjacent = points.at(-2)!;
            xs.add(end.x + Math.sign(adjacent.x - end.x) * config.edgeEndpointClearance);
            ys.add(end.y + Math.sign(adjacent.y - end.y) * config.edgeEndpointClearance);
            for (const segment of conflicts) {
                const lane = segment.horizontal ? segment.start.y : segment.start.x;
                const lanes = segment.horizontal ? ys : xs;
                lanes.add(lane - config.edgeSpacing);
                lanes.add(lane + config.edgeSpacing);
            }
            for (const obstacle of obstacles) {
                if (obstacle.x > Math.max(start.x, end.x) || obstacle.x + obstacle.width < Math.min(start.x, end.x)
                    || obstacle.y > Math.max(start.y, end.y) || obstacle.y + obstacle.height < Math.min(start.y, end.y)) continue;
                xs.add(obstacle.x);
                xs.add(obstacle.x + obstacle.width);
                ys.add(obstacle.y);
                ys.add(obstacle.y + obstacle.height);
            }
            const nearest = (lanes: Set<number>, centre: number): number[] => [...lanes].sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre)).slice(0, 12);
            const candidates = [
                [start, end],
                [start, { x: end.x, y: start.y }, end],
                [start, { x: start.x, y: end.y }, end],
                ...nearest(xs, (start.x + end.x) / 2).map((x) => [start, { x, y: start.y }, { x, y: end.y }, end]),
                ...nearest(ys, (start.y + end.y) / 2).map((y) => [start, { x: start.x, y }, { x: end.x, y }, end]),
            ];
            for (const tail of candidates) {
                const ordered = [...points.slice(0, join), ...tail];
                const candidate = simplifyWaypoints(source ? ordered.reverse() : ordered);
                if (!currentShared && candidate.length > path.points.length) continue;
                if (candidate.length < 2) continue;
                const length = pathLength(candidate);
                if (!currentScore && (candidate.length > best.length || (candidate.length === best.length && length >= bestLength - 1e-7))) continue;
                if (!validAttachment(candidate[0]!, candidate[1]!, path.points[0]!, index.byId.get(path.edge.source), true)
                    || !validAttachment(candidate.at(-1)!, candidate.at(-2)!, path.points.at(-1)!, index.byId.get(path.edge.target), true)) continue;
                if (selfIntersects(candidate) || !pathAvoidsObstacles(candidate, obstacles)) continue;
                if (boundaryPenalty({ ...path, points: candidate }, index.borders, config.edgeEndpointClearance)
                    > boundaryPenalty(path, index.borders, config.edgeEndpointClearance)) continue;
                const score = segmentsIndex.score(path, candidate, "conflict");
                if (score > currentScore + 1e-7 || segmentsIndex.score(path, candidate, "shared") > currentShared + 1e-7) continue;
                if (score < bestScore - 1e-7 || (Math.abs(score - bestScore) < 1e-7
                    && (candidate.length < best.length || (candidate.length === best.length && length < bestLength - 1e-7)))) {
                    best = candidate;
                    bestScore = score;
                    bestLength = length;
                }
            }
        }
    }
    if (best === path.points) return false;
    path.points = best;
    segmentsIndex.replace(path);
    return true;
}

/** Separates close or shared route segments from every routing group when a clear lane exists. */
export function enforceGlobalEdgeSpacing(nodes: FlatLayoutNode[], edges: AstEdge[], routes: Map<string, Route>, config: LayoutConfig): void {
    const paths = edges.flatMap((edge): RoutePath[] => {
        const route = routes.get(edge.id);
        return route ? [{ edge, route, points: [route.sourcePoint, ...route.bendPoints, route.targetPoint] }] : [];
    });
    const index = buildCleanupIndex(nodes, paths);
    straightenRoutes(nodes, paths, config, index);
    const obstacles = new Map(paths.map((path) => [path.edge.id, paddedObstacles(index.obstaclesByEdge.get(path.edge.id) ?? [], Math.min(config.edgeEndpointClearance, config.edgeSpacing / 2))]));
    const { borders } = index;
    for (const path of paths) {
        obstacles.get(path.edge.id)!.push(...nodes.filter((node) => !isContainer(node) && (node.id === path.edge.source || node.id === path.edge.target)));
    }
    clearContainerBorders(paths, borders, obstacles, config);
    straightenRoutes(nodes, paths, config, index);
    const segmentsIndex = new SegmentIndex(paths, config.edgeSpacing);
    for (const path of paths) if (path.points.length > 4 || segmentsIndex.score(path, path.points, "shared") > 0) {
        repairApproach(path, segmentsIndex, index, obstacles.get(path.edge.id) ?? [], config);
    }
    const maxAdjustments = Math.max(paths.length * 8, 1);
    for (let adjustment = 0; adjustment < maxAdjustments; adjustment += 1) {
        if (!segmentsIndex.conflict) break;
        let adjusted = false;
        for (const [a, b] of segmentsIndex.pairs()) {
            for (const segment of [b, a]) {
                const currentScore = segmentsIndex.score(segment.path, segment.path.points, "conflict");
                const currentShared = segmentsIndex.score(segment.path, segment.path.points, "shared");
                for (const multiplier of [1, -1, 2, -2, 3, -3]) {
                    const offset = multiplier * config.edgeSpacing;
                    const endpoint = (a.path.edge.target === b.path.edge.target
                        ? moveEndpointLane(segment, offset, index.byId.get(segment.path.edge.target), false) : undefined)
                            ?? (a.path.edge.source === b.path.edge.source
                                ? moveEndpointLane(segment, offset, index.byId.get(segment.path.edge.source), true) : undefined);
                    for (const candidate of [endpoint, nudgePath(segment, offset, config.edgeEndpointClearance)]) {
                        if (!candidate || !pathAvoidsObstacles(candidate, obstacles.get(segment.path.edge.id) ?? [])) continue;
                        if (selfIntersects(candidate)) continue;
                        if (boundaryConflicts({ ...segment.path, points: candidate }, borders, config.edgeEndpointClearance).length) continue;
                        if (candidate !== endpoint && candidate.length > simplifyWaypoints(segment.path.points).length
                            && !currentShared) continue;
                        if (segmentsIndex.score(segment.path, candidate, "shared") > currentShared + 1e-7) continue;
                        // Ignore sub-pixel floating-point score ties instead of adding microscopic jogs.
                        if (segmentsIndex.score(segment.path, candidate, "conflict") < currentScore - 1e-7) {
                            segment.path.points = candidate;
                            segmentsIndex.replace(segment.path);
                            adjusted = true;
                            break;
                        }
                    }
                    if (adjusted) break;
                }
                if (adjusted) break;
            }
            if (adjusted) break;
        }
        if (!adjusted) break;
    }
    for (const path of paths) if (path.points.length > 4) repairApproach(path, segmentsIndex, index, obstacles.get(path.edge.id) ?? [], config);
    for (const path of paths) {
        path.route.sourcePoint = path.points[0]!;
        path.route.targetPoint = path.points.at(-1)!;
        path.route.bendPoints = simplifyWaypoints(path.points).slice(1, -1);
    }
}

async function rerouteSharedApproaches(nodes: FlatLayoutNode[], edges: AstEdge[], routes: Map<string, Route>, config: LayoutConfig): Promise<void> {
    const paths = edges.flatMap((edge): RoutePath[] => {
        const route = routes.get(edge.id);
        return route ? [{ edge, route, points: [route.sourcePoint, ...route.bendPoints, route.targetPoint] }] : [];
    });
    const segmentsIndex = new SegmentIndex(paths, config.edgeSpacing);
    const sharedPaths = paths.filter((path) => segmentsIndex.score(path, path.points, "shared") > 0);
    if (!sharedPaths.length) return;
    const cleanup = buildCleanupIndex(nodes, sharedPaths);
    let attempts = 0;
    for (const path of sharedPaths) {
        const shared = segmentsIndex.score(path, path.points, "shared");
        if (!shared || path.edge.source === path.edge.target || path.points.length < 4) continue;
        // ponytail: at most 16 single-edge retries per compile; avoid diagram-wide iterative rerouting.
        if (attempts++ >= 16) break;
        const ports = new Map<string, ElkPort[]>();
        for (const source of [true, false]) {
            const id = source ? path.edge.source : path.edge.target;
            const node = cleanup.byId.get(id)!;
            const point = source ? path.points[0]! : path.points.at(-1)!;
            ports.set(id, [{ id: portId(path.edge.id, source), x: point.x - node.x, y: point.y - node.y, width: 0, height: 0 }]);
        }
        const graph = routingGraph(nodes, routingGroups(nodes, [path.edge])[0]!, ports);
        const reserved = segmentsIndex.conflictingLanes(path).filter((other) => routeSegments([path]).some((segment) => segmentPenalty(segment, other, config.edgeSpacing, "shared") > 0));
        for (const [i, segment] of reserved.entries()) {
            const trim = Math.min(config.edgeEndpointClearance, (Math.abs(segment.end.x - segment.start.x) + Math.abs(segment.end.y - segment.start.y)) / 4);
            const start = pointAlong(segment.start, segment.end, trim);
            const end = pointAlong(segment.end, segment.start, trim);
            graph.children!.push({
                id: `__drawdsl_reserved_${i}`,
                x: Math.min(start.x, end.x) - (segment.horizontal ? 0 : config.edgeSpacing / 2),
                y: Math.min(start.y, end.y) - (segment.horizontal ? config.edgeSpacing / 2 : 0),
                width: segment.horizontal ? Math.abs(end.x - start.x) : config.edgeSpacing,
                height: segment.horizontal ? config.edgeSpacing : Math.abs(end.y - start.y),
            });
        }
        const routed = (await routeEdges(graph, { shapeBufferDistance: Math.min(config.edgeEndpointClearance, config.edgeSpacing / 2), segmentPenalty: 40 })).get(path.edge.id);
        if (!routed) continue;
        const candidate = simplifyWaypoints([routed.sourcePoint, ...routed.bendPoints, routed.targetPoint]);
        const obstacles = paddedObstacles(cleanup.obstaclesByEdge.get(path.edge.id) ?? [], Math.min(config.edgeEndpointClearance, config.edgeSpacing / 2));
        for (const id of [path.edge.source, path.edge.target]) {
            const node = cleanup.byId.get(id)!;
            if (!isContainer(node)) obstacles.push(node);
        }
        if (candidate.length < 2 || candidate.length > path.points.length || pathLength(candidate) > pathLength(path.points) + config.edgeEndpointClearance * 2
            || selfIntersects(candidate) || !pathAvoidsObstacles(candidate, obstacles)) continue;
        if (!validAttachment(candidate[0]!, candidate[1]!, path.points[0]!, cleanup.byId.get(path.edge.source), true)
            || !validAttachment(candidate.at(-1)!, candidate.at(-2)!, path.points.at(-1)!, cleanup.byId.get(path.edge.target), true)) continue;
        if (boundaryPenalty({ ...path, points: candidate }, cleanup.borders, config.edgeEndpointClearance) > boundaryPenalty(path, cleanup.borders, config.edgeEndpointClearance)) continue;
        if (segmentsIndex.score(path, candidate, "shared") >= shared - 1e-7
            || segmentsIndex.score(path, candidate, "conflict") > segmentsIndex.score(path, path.points, "conflict") + 1e-7) continue;
        path.points = candidate;
        segmentsIndex.replace(path);
        path.route.sourcePoint = candidate[0]!;
        path.route.targetPoint = candidate.at(-1)!;
        path.route.bendPoints = candidate.slice(1, -1);
    }
}

export async function routeDiagram(nodes: FlatLayoutNode[], edges: AstEdge[], config: LayoutConfig, quality: RoutingQuality = "beautiful", onDiagnostics?: (diagnostics: RoutingDiagnostics) => void): Promise<RoutedEdge[]> {
    const assignment = assignPorts(nodes, edges, config);
    const routes = await routeWithContainerObstacles(nodes, edges, config, quality, assignment.ports);
    if (quality === "beautiful") {
        enforceGlobalEdgeSpacing(nodes, edges, routes, config);
        await rerouteSharedApproaches(nodes, edges, routes, config);
    }
    if (onDiagnostics) {
        const paths = edges.flatMap((edge): RoutePath[] => {
            const route = routes.get(edge.id);
            return route ? [{ edge, route, points: [route.sourcePoint, ...route.bendPoints, route.targetPoint] }] : [];
        });
        let sharedSegmentPairs = 0;
        let spacingConflictPairs = 0;
        for (const [a, b] of new SegmentIndex(paths, config.edgeSpacing).pairs()) {
            spacingConflictPairs += 1;
            if (segmentPenalty(a, b, config.edgeSpacing, "shared") > 0) sharedSegmentPairs += 1;
        }
        onDiagnostics({ sharedSegmentPairs, spacingConflictPairs, crowdedSides: assignment.crowdedSides });
    }
    return byDeclarationOrder(edges.map((edge): RoutedEdge => {
        const route = routes.get(edge.id);
        return route ? { ...edge, points: simplifyWaypoints(route.bendPoints), sourcePoint: route.sourcePoint, targetPoint: route.targetPoint } : { ...edge, points: [] };
    }));
}
