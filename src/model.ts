export type Direction = "right" | "left" | "down" | "up";
export type NodeSide = "top" | "right" | "bottom" | "left";
export type EdgeOperator = "-->" | "-.->" | "---" | "-.-" | "<-->" | "<-.->";
export type SymbolRole = "resource" | "container" | "annotation";

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
    parentId?: string;
    children: AstNode[];
    gridColumns?: number;
    nodeSpacing?: number;
    direction?: Direction;
    declarationOrder: number;
};

export type AstEdge = {
    id: string;
    source: string;
    target: string;
    sourceSide?: NodeSide;
    targetSide?: NodeSide;
    operator: EdgeOperator;
    label?: string;
    declarationOrder: number;
};

export type DocumentAst = {
    direction: Direction;
    nodes: AstNode[];
    edges: AstEdge[];
};

export type Point = { x: number; y: number };

export type FlatLayoutNode = {
    id: string;
    symbol: SymbolRef;
    definition: SymbolDefinition;
    label: string;
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
