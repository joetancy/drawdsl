import ELK from "elkjs/lib/elk.bundled.js";
import { routeEdges } from "@mr_mint/elkjs-libavoid";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import { CONFIG } from "../config.js";
import { isContainer, isLayoutOnly, type AstEdge, type AstNode, type DocumentAst, type FlatLayoutNode, type LayoutResult, type Point, type RoutedEdge } from "../model.js";
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

function nodeSpacing(children: PositionedNode[]): number {
    return children.every((child) => isContainer(child.ast)) ? CONFIG.elk.containerNodeSpacing : CONFIG.elk.resourceNodeSpacing;
}

function layoutGrid(container: AstNode, children: PositionedNode[]): LocalLayout {
    const columnCount = Math.min(container.gridColumns!, children.length);
    const rowCount = Math.ceil(children.length / columnCount);
    const spacing = nodeSpacing(children);
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
    const spacing = container ? nodeSpacing(children) : CONFIG.layout.nodeSpacing;
    const layoutOptions: Record<string, string> = {
        "elk.algorithm": "layered",
        "elk.padding": container ? padding(container) : CONFIG.elk.rootPadding,
        "elk.spacing.nodeNode": String(spacing),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(container ? CONFIG.elk.containerLayerSpacing : CONFIG.layout.layerSpacing),
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    };
    if (!container) layoutOptions["elk.direction"] = elkDirection(ast.direction);
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
        if (isLayoutOnly(node)) return false;
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
            idealNudgingDistance: 8,
            crossingPenalty: 100,
            nudgeOrthogonalSegmentsConnectedToShapes: true,
            nudgeOrthogonalTouchingColinearSegments: true,
            nudgeSharedPathsWithCommonEndPoint: true,
            performUnifyingNudgingPreprocessingStep: true,
        });
        for (const [id, route] of groupRoutes) routes.set(id, route);
    }
    return routes;
}

export async function layoutWithElk(ast: DocumentAst): Promise<LayoutResult> {
    const elk = new (ELK as unknown as ElkConstructor)();
    const nodesById = flattenAst(ast.nodes);
    const positioned = await Promise.all(ast.nodes.map((node) => positionNode(elk, node, ast, nodesById)));
    await layoutChildren(elk, undefined, positioned, ast, nodesById);
    const nodes = flatten(positioned);
    const routes = await routeWithContainerObstacles(nodes, ast.edges);
    const edges = byDeclarationOrder(ast.edges.map((edge): RoutedEdge => {
        const route = routes.get(edge.id);
        return route ? { ...edge, points: simplifyWaypoints(route.bendPoints), sourcePoint: route.sourcePoint, targetPoint: route.targetPoint } : { ...edge, points: [] };
    }));
    return { nodes, edges };
}
