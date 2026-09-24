import type { ContainerLayoutOptions, LayoutConfig } from "./config.js";

export type Direction = "right" | "left" | "down" | "up";
export type NodeSide = "top" | "right" | "bottom" | "left";
export type EdgeOperator = "-->" | "-.->" | "---" | "-.-" | "<-->" | "<-.->";
export type SymbolRole = "resource" | "container" | "annotation";

export const CONNECTIONS_LAYER_ID = "connections";

export type AstLayer = {
    id: string;
    label: string;
    visible: boolean;
    color?: string;
    width?: number;
    declarationOrder: number;
    line?: number;
};

export class DslError extends Error {
    line?: number;
    constructor(message: string, line?: number) {
        super(message);
        this.name = "DslError";
        if (line !== undefined) this.line = line;
    }
}

export type SymbolRef = {
    namespace: string;
    name: string;
};

export type DrawioSymbolStyle = {
    shape: string;
    resIcon?: string;
    fill?: string;
    stroke?: string;
    styles?: readonly string[];
};

export type SymbolDefinition = {
    role: SymbolRole;
    drawio: DrawioSymbolStyle;
    /** A structural container that participates in layout but is not rendered. */
    layoutOnly?: boolean;
    /** A layout participant that is intentionally omitted from draw.io output. */
    render?: boolean;
    widthScale?: number;
    heightScale?: number;
    defaultLabel?: string;
};

export type SymbolProvider = {
    namespace: string;
    symbols: Readonly<Record<string, SymbolDefinition>>;
    aliases?: Readonly<Record<string, string>>;
};

export type AstNode = {
    id: string;
    symbol: SymbolRef;
    definition: SymbolDefinition;
    label: string;
    backgroundColor?: string;
    parentId?: string;
    children: AstNode[];
    layout?: ContainerLayoutOptions;
    declarationOrder: number;
    line?: number;
};

export type AstEdge = {
    id: string;
    source: string;
    target: string;
    sourceSide?: NodeSide;
    targetSide?: NodeSide;
    operator: EdgeOperator;
    label?: string;
    color?: string;
    width?: number;
    /** Defaults to Connections for callers that construct edges directly. */
    layerId?: string;
    declarationOrder: number;
    line?: number;
};

export type DocumentAst = {
    layout: LayoutConfig;
    nodes: AstNode[];
    edges: AstEdge[];
    layers: AstLayer[];
};

export type Point = { x: number; y: number };

export type FlatLayoutNode = {
    id: string;
    symbol: SymbolRef;
    definition: SymbolDefinition;
    label: string;
    backgroundColor?: string;
    parentId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    declarationOrder: number;
};

export type RoutedEdge = AstEdge & {
    points: Point[];
    sourcePoint?: Point;
    targetPoint?: Point;
};

export type LayoutResult = {
    nodes: FlatLayoutNode[];
    edges: RoutedEdge[];
    layers: AstLayer[];
};

export function symbolKey(ref: SymbolRef): string {
    return `${ref.namespace}:${ref.name}`;
}

export function isContainer(node: AstNode | FlatLayoutNode): boolean {
    return node.definition.role === "container";
}

export function isLayoutOnly(node: AstNode | FlatLayoutNode): boolean {
    return node.definition.layoutOnly === true;
}

export function isRenderable(node: AstNode | FlatLayoutNode): boolean {
    return node.definition.render !== false && !isLayoutOnly(node);
}
