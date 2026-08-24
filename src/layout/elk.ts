import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api.js";
import type { Insets, LayoutConfig } from "../config.js";
import { isContainer, isLayoutOnly, type AstNode, type DocumentAst, type FlatLayoutNode } from "../model.js";
import { byDeclarationOrder, dimensions, elkDirection, flattenAst } from "./common.js";

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

const allSides = (value: number): Insets => ({ top: value, right: value, bottom: value, left: value });

function insets(node: AstNode, config: LayoutConfig): Insets {
    if (node.layout?.padding !== undefined) return allSides(node.layout.padding);
    return isLayoutOnly(node) ? config.padding.layoutOnly : config.padding.container;
}

function padding(value: Insets): string {
    return `[top=${value.top},left=${value.left},bottom=${value.bottom},right=${value.right}]`;
}

function nodeSpacing(container: AstNode | undefined, children: PositionedNode[], config: LayoutConfig): number {
    if (container?.layout?.nodeSpacing !== undefined) return container.layout.nodeSpacing;
    if (!container) return config.nodeSpacing.root;
    return children.every((child) => isContainer(child.ast)) ? config.nodeSpacing.container : config.nodeSpacing.resource;
}

function layoutGrid(container: AstNode, children: PositionedNode[], config: LayoutConfig): LocalLayout {
    const columnCount = Math.min(container.layout!.gridColumns!, children.length);
    const rowCount = Math.ceil(children.length / columnCount);
    const spacing = nodeSpacing(container, children, config);
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
    const inset = insets(container, config);
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

async function layoutChildren(elk: ElkEngine, container: AstNode | undefined, children: PositionedNode[], ast: DocumentAst, nodesById: Map<string, AstNode>, config: LayoutConfig): Promise<LocalLayout> {
    if (!children.length) return { children, width: container ? dimensions(container).width : 0, height: container ? dimensions(container).height : 0 };
    if (container?.layout?.gridColumns) return layoutGrid(container, children, config);
    const layoutOptions: Record<string, string> = {
        "elk.algorithm": "layered",
        "elk.padding": padding(container ? insets(container, config) : config.padding.root),
        "elk.spacing.nodeNode": String(nodeSpacing(container, children, config)),
        "elk.layered.spacing.nodeNodeBetweenLayers": String(container?.layout?.layerSpacing ?? config.layerSpacing),
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.direction": elkDirection(container?.layout?.direction ?? config.direction),
    };
    const graph: ElkNode = {
        id: container?.id ?? "root",
        children: children.map((child) => ({ id: child.ast.id, width: child.width, height: child.height })),
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

async function positionNode(elk: ElkEngine, node: AstNode, ast: DocumentAst, nodesById: Map<string, AstNode>, config: LayoutConfig): Promise<PositionedNode> {
    const children: PositionedNode[] = [];
    for (const child of node.children) children.push(await positionNode(elk, child, ast, nodesById, config));
    if (!children.length) return { ast: node, children, x: 0, y: 0, ...dimensions(node) };
    const local = await layoutChildren(elk, node, children, ast, nodesById, config);
    const size = dimensions(node);
    return { ast: node, children, x: 0, y: 0, width: Math.max(size.width, local.width), height: Math.max(size.height, local.height) };
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

export async function positionWithElk(ast: DocumentAst, config: LayoutConfig): Promise<FlatLayoutNode[]> {
    const elk = new (ELK as unknown as ElkConstructor)();
    const nodesById = flattenAst(ast.nodes);
    const positioned = await Promise.all(ast.nodes.map((node) => positionNode(elk, node, ast, nodesById, config)));
    await layoutChildren(elk, undefined, positioned, ast, nodesById, config);
    return flatten(positioned);
}
