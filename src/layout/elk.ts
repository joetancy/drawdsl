import ELK from "elkjs/lib/elk.bundled.js";
import { routeEdges } from "@mr_mint/elkjs-libavoid";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { CONFIG } from "../config.js";
import { isContainer, isLayoutOnly, isRenderable, type AstEdge, type AstNode, type DocumentAst, type FlatLayoutNode, type LayoutResult, type Point, type RoutedEdge } from "../model.js";
import { byDeclarationOrder, dimensions, elkDirection, flattenAst, simplifyWaypoints } from "./common.js";

type ElkEngine = { layout(graph: ElkNode): Promise<ElkNode> };
type ElkConstructor = new () => ElkEngine;

type PositionedNode = {
    ast: AstNode;
    children: PositionedNode[];
    x: number;
    y: number;
    width: number;
    height: number;
};

type LocalLayout = {
    children: PositionedNode[];
    width: number;
    height: number;
};

type Insets = { top: number; left: number; bottom: number; right: number };

function directOwner(container: AstNode | undefined, id: string, nodesById: Map<string, AstNode>): string | undefined {
    let current = nodesById.get(id);
    while (current) {
        if (container ? current.parentId === container.id : current.parentId === undefined) return current.id;
        current = current.parentId ? nodesById.get(current.parentId) : undefined;
    }
    return undefined;
}

function projectedEdges(container: AstNode | undefined, children: PositionedNode[], ast: DocumentAst, nodesById: Map<string, AstNode>): ElkExtendedEdge[] {
    const childIds = new Set(children.map((child) => child.ast.id));
    const seen = new Set<string>();
    const edges: ElkExtendedEdge[] = [];
    for (const edge of ast.edges) {
        const source = directOwner(container, edge.source, nodesById);
        const target = directOwner(container, edge.target, nodesById);
        if (!source || !target || source === target || !childIds.has(source) || !childIds.has(target)) continue;
        const key = `${source}\u0000${target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ id: `${container?.id ?? "root"}_${edges.length}`, sources: [source], targets: [target] });
    }
    return edges;
}

function insets(node: AstNode): Insets {
    return isLayoutOnly(node) ? { top: 0, left: 0, bottom: 0, right: 0 } : CONFIG.elk.groupPadding;
}

function padding(node: AstNode): string {
    const value = insets(node);
    return `[top=${value.top},left=${value.left},bottom=${value.bottom},right=${value.right}]`;
}

function nodeSpacing(container: AstNode | undefined, children: PositionedNode[]): number {
    if (container?.nodeSpacing !== undefined) return container.nodeSpacing;
    return children.every((child) => isContainer(child.ast)) ? CONFIG.elk.containerNodeSpacing : CONFIG.elk.resourceNodeSpacing;
}

function layoutGrid(container: AstNode, children: PositionedNode[]): LocalLayout {
    const columnCount = Math.min(container.gridColumns!, children.length);
    const rowCount = Math.ceil(children.length / columnCount);
    const spacing = nodeSpacing(container, children);
    const columnWidths = Array.from({ length: columnCount }, () => 0);
    const rowHeights = Array.from({ length: rowCount }, () => 0);
    for (const [index, child] of children.entries()) {
        const column = index % columnCount;
        const row = Math.floor(index / columnCount);
        columnWidths[column] = Math.max(columnWidths[column]!, child.width);
        rowHeights[row] = Math.max(rowHeights[row]!, child.height);
    }
    const xOffsets: number[] = [];
    const yOffsets: number[] = [];
    for (let column = 0, offset = 0; column < columnCount; column += 1) {
        xOffsets.push(offset);
        offset += columnWidths[column]! + spacing;
    }
    for (let row = 0, offset = 0; row < rowCount; row += 1) {
        yOffsets.push(offset);
        offset += rowHeights[row]! + spacing;
    }
    const inset = insets(container);
    for (const [index, child] of children.entries()) {
        const column = index % columnCount;
        const row = Math.floor(index / columnCount);
        child.x = inset.left + xOffsets[column]! + (columnWidths[column]! - child.width) / 2;
        child.y = inset.top + yOffsets[row]! + (rowHeights[row]! - child.height) / 2;
    }
    return {
        children,
        width: inset.left + columnWidths.reduce((total, width) => total + width, 0) + (columnCount - 1) * spacing + inset.right,
        height: inset.top + rowHeights.reduce((total, height) => total + height, 0) + (rowCount - 1) * spacing + inset.bottom,
    };
}

async function layoutChildren(
    elk: ElkEngine,
    container: AstNode | undefined,
    children: PositionedNode[],
    ast: DocumentAst,
    nodesById: Map<string, AstNode>,
): Promise<LocalLayout> {
    if (!children.length) return { children, width: container ? dimensions(container).width : 0, height: container ? dimensions(container).height : 0 };
    const columns = container?.gridColumns;
    if (container && columns) return layoutGrid(container, children);
    const spacing = container ? nodeSpacing(container, children) : CONFIG.layout.nodeSpacing;
    const layoutOptions: Record<string, string> = {
        "elk.algorithm": "layered",
        "elk.padding": container ? padding(container) : CONFIG.elk.rootPadding,
        "elk.spacing.nodeNode": String(spacing),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(container ? CONFIG.elk.containerLayerSpacing : CONFIG.layout.layerSpacing),
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    };
    layoutOptions["elk.direction"] = elkDirection(container?.direction ?? ast.direction);
    const graph: ElkNode = {
        id: container?.id ?? "root",
        children: children.map((child) => ({
            id: child.ast.id,
            width: child.width,
            height: child.height,
        })),
        edges: projectedEdges(container, children, ast, nodesById),
        layoutOptions,
    };
    const result = await elk.layout(graph);
    const resultById = new Map((result.children ?? []).map((child) => [child.id, child]));
    for (const child of children) {
        const positioned = resultById.get(child.ast.id);
        child.x = positioned?.x ?? 0;
        child.y = positioned?.y ?? 0;
    }
    return { children, width: result.width ?? 0, height: result.height ?? 0 };
}

async function positionNode(elk: ElkEngine, node: AstNode, ast: DocumentAst, nodesById: Map<string, AstNode>): Promise<PositionedNode> {
    const children: PositionedNode[] = [];
    for (const child of node.children) children.push(await positionNode(elk, child, ast, nodesById));
    if (!children.length) {
        const size = dimensions(node);
        return { ast: node, children, x: 0, y: 0, ...size };
    }
    const local = await layoutChildren(elk, node, children, ast, nodesById);
    return { ast: node, children, x: 0, y: 0, width: Math.max(dimensions(node).width, local.width), height: Math.max(dimensions(node).height, local.height) };
}

function flatten(nodes: PositionedNode[]): FlatLayoutNode[] {
    const result: FlatLayoutNode[] = [];
    const visit = (node: PositionedNode, ox: number, oy: number, parentId?: string): void => {
        const x = ox + node.x;
        const y = oy + node.y;
        result.push({ id: node.ast.id, symbol: node.ast.symbol, definition: node.ast.definition, label: node.ast.label, parentId, x, y, width: node.width, height: node.height, declarationOrder: node.ast.declarationOrder });
        node.children.forEach((child) => visit(child, x, y, node.ast.id));
    };
    nodes.forEach((node) => visit(node, 0, 0));
    return byDeclarationOrder(result);
}

type RoutingGroup = {
    edges: AstEdge[];
    excludedContainers: Set<string>;
};

type Route = {
    sourcePoint: Point;
    targetPoint: Point;
    bendPoints: Point[];
};

type RoutePath = {
    edge: AstEdge;
    route: Route;
    points: Point[];
};

type Rect = { x: number; y: number; width: number; height: number };

type Segment = {
    path: RoutePath;
    index: number;
    start: Point;
    end: Point;
    horizontal: boolean;
};

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
        const containerEndpoints = [edge.source, edge.target].filter((id) => {
            const node = byId.get(id);
            return node && isContainer(node);
        }).sort();
        const key = `${[...excludedContainers].sort().join("\u0000")}|${containerEndpoints.join("\u0000")}`;
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
    }).map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
    }));
    return { id: "root", children, edges: group.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })) };
}

async function routeWithContainerObstacles(nodes: FlatLayoutNode[], edges: AstEdge[]): Promise<Map<string, Route>> {
    const routes = new Map<string, Route>();
    for (const group of routingGroups(nodes, edges)) {
        const groupRoutes = await routeEdges(routingGraph(nodes, group), {
            routingType: "orthogonal",
            shapeBufferDistance: 8,
            idealNudgingDistance: CONFIG.elk.edgeNudgingDistance,
            crossingPenalty: CONFIG.elk.edgeCrossingPenalty,
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

function internalSegments(paths: RoutePath[]): Segment[] {
    const segments: Segment[] = [];
    for (const path of paths) {
        for (let index = 1; index < path.points.length - 2; index += 1) {
            const start = path.points[index]!;
            const end = path.points[index + 1]!;
            if (start.x === end.x || start.y === end.y) segments.push({ path, index, start, end, horizontal: start.y === end.y });
        }
    }
    return segments;
}

function overlaps(first: Segment, second: Segment): boolean {
    if (first.horizontal !== second.horizontal) return false;
    if (first.horizontal && first.start.y !== second.start.y) return false;
    if (!first.horizontal && first.start.x !== second.start.x) return false;
    const [firstStart, firstEnd] = first.horizontal ? [first.start.x, first.end.x] : [first.start.y, first.end.y];
    const [secondStart, secondEnd] = second.horizontal ? [second.start.x, second.end.x] : [second.start.y, second.end.y];
    return Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd)) > Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd));
}

function crosses(first: Segment, second: Segment): boolean {
    if (first.horizontal === second.horizontal) return false;
    const horizontal = first.horizontal ? first : second;
    const vertical = first.horizontal ? second : first;
    const minX = Math.min(horizontal.start.x, horizontal.end.x);
    const maxX = Math.max(horizontal.start.x, horizontal.end.x);
    const minY = Math.min(vertical.start.y, vertical.end.y);
    const maxY = Math.max(vertical.start.y, vertical.end.y);
    return vertical.start.x > minX && vertical.start.x < maxX && horizontal.start.y > minY && horizontal.start.y < maxY;
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

function nudgedPath(segment: Segment, offset: number): Point[] {
    const { points } = segment.path;
    const start = segment.start;
    const end = segment.end;
    const shiftedStart = segment.horizontal ? { x: start.x, y: start.y + offset } : { x: start.x + offset, y: start.y };
    const shiftedEnd = segment.horizontal ? { x: end.x, y: end.y + offset } : { x: end.x + offset, y: end.y };
    return [...points.slice(0, segment.index + 1), shiftedStart, shiftedEnd, ...points.slice(segment.index + 1)];
}

function conflictScore(paths: RoutePath[]): number {
    const segments = internalSegments(paths);
    let score = 0;
    for (let first = 0; first < segments.length; first += 1) {
        for (let second = first + 1; second < segments.length; second += 1) {
            if (segments[first]!.path === segments[second]!.path) continue;
            if (overlaps(segments[first]!, segments[second]!)) score += 2;
            else if (crosses(segments[first]!, segments[second]!)) score += 1;
        }
    }
    return score;
}

/**
 * Separates routes produced in different Libavoid passes.  It only keeps a
 * lane adjustment when the new orthogonal path clears that edge's obstacles
 * and reduces the global overlap/crossing score.
 */
export function separateRouteLanes(nodes: FlatLayoutNode[], edges: AstEdge[], routes: Map<string, Route>): void {
    const paths = edges.flatMap((edge): RoutePath[] => {
        const route = routes.get(edge.id);
        return route ? [{ edge, route, points: [route.sourcePoint, ...route.bendPoints, route.targetPoint] }] : [];
    });
    const obstacles = new Map(paths.map((path) => [path.edge.id, routeObstacles(nodes, path.edge)]));
    const maxAdjustments = Math.max(paths.length * 4, 1);
    for (let adjustment = 0; adjustment < maxAdjustments; adjustment += 1) {
        const baseline = conflictScore(paths);
        if (!baseline) break;
        let adjusted = false;
        const segments = internalSegments(paths);
        for (let first = 0; first < segments.length && !adjusted; first += 1) {
            for (let second = first + 1; second < segments.length && !adjusted; second += 1) {
                const a = segments[first]!;
                const b = segments[second]!;
                if (a.path === b.path || (!overlaps(a, b) && !crosses(a, b))) continue;
                for (const segment of [b, a]) {
                    for (const multiplier of [1, -1, 2, -2, 3, -3]) {
                        const candidate = nudgedPath(segment, multiplier * CONFIG.elk.edgeNudgingDistance);
                        if (!pathAvoidsObstacles(candidate, obstacles.get(segment.path.edge.id) ?? [])) continue;
                        const original = segment.path.points;
                        segment.path.points = candidate;
                        if (conflictScore(paths) < baseline) {
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

export async function layoutWithElk(ast: DocumentAst): Promise<LayoutResult> {
    const elk = new (ELK as unknown as ElkConstructor)();
    const nodesById = flattenAst(ast.nodes);
    const positioned = await Promise.all(ast.nodes.map((node) => positionNode(elk, node, ast, nodesById)));
    await layoutChildren(elk, undefined, positioned, ast, nodesById);
    const nodes = flatten(positioned);
    const routes = await routeWithContainerObstacles(nodes, ast.edges);
    separateRouteLanes(nodes, ast.edges, routes);
    const edges = byDeclarationOrder(ast.edges.map((edge): RoutedEdge => {
        const route = routes.get(edge.id);
        return route ? { ...edge, points: simplifyWaypoints(route.bendPoints), sourcePoint: route.sourcePoint, targetPoint: route.targetPoint } : { ...edge, points: [] };
    }));
    return { nodes, edges };
}
