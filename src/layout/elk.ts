import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";
import { CONFIG } from "../config.js";
import type { AstNode, DocumentAst, FlatLayoutNode, LayoutResult, RoutedEdge } from "../model.js";
import { byDeclarationOrder, dimensions, elkDirection, flattenAst, sharedContainerOrigin, simplifyWaypoints } from "./common.js";

type ElkEngine = { layout(graph: ElkNode): Promise<ElkNode> };
type ElkConstructor = new () => ElkEngine;

function toElkNode(node: AstNode): ElkNode {
    const size = dimensions(node);
    const options: Record<string, string> = {};
    if (node.definition.role === "container") {
        const p = CONFIG.elk.groupPadding;
        options["elk.algorithm"] = "layered";
        options["elk.padding"] = `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`;
        options["elk.spacing.nodeNode"] = String(CONFIG.elk.containerNodeSpacing);
        options["elk.layered.spacing.nodeNodeBetweenLayers"] = String(CONFIG.elk.containerLayerSpacing);
    }
    return { id: node.id, width: size.width, height: size.height, children: node.children.map(toElkNode), layoutOptions: Object.keys(options).length ? options : undefined };
}

function graph(ast: DocumentAst): ElkNode {
    const edges: ElkExtendedEdge[] = ast.edges.map((edge) => ({
        id: edge.id, sources: [edge.source], targets: [edge.target],
        labels: edge.label ? [{ id: `${edge.id}_label`, text: edge.label, width: Math.max(40, edge.label.length * 7), height: 18 }] : undefined,
    }));
    return {
        id: "root", children: ast.nodes.map(toElkNode), edges,
        layoutOptions: {
            "elk.algorithm": "layered", "elk.direction": elkDirection(ast.direction), "elk.edgeRouting": "ORTHOGONAL",
            "elk.hierarchyHandling": "INCLUDE_CHILDREN", "elk.spacing.nodeNode": String(CONFIG.layout.nodeSpacing),
            "elk.layered.spacing.nodeNodeBetweenLayers": String(CONFIG.layout.layerSpacing), "elk.spacing.edgeNode": String(CONFIG.layout.edgeNodeSpacing),
            "elk.padding": CONFIG.elk.rootPadding, "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        },
    };
}

function flatten(root: ElkNode, astMap: Map<string, AstNode>): FlatLayoutNode[] {
    const result: FlatLayoutNode[] = [];
    const visit = (node: ElkNode, ox: number, oy: number, parentId?: string): void => {
        const ast = astMap.get(node.id); if (!ast) return;
        const x = ox + (node.x ?? 0); const y = oy + (node.y ?? 0);
        result.push({ id: node.id, symbol: ast.symbol, definition: ast.definition, label: ast.label, parentId, x, y, width: node.width ?? dimensions(ast).width, height: node.height ?? dimensions(ast).height, declarationOrder: ast.declarationOrder });
        node.children?.forEach((child) => visit(child, x, y, node.id));
    };
    root.children?.forEach((node) => visit(node, 0, 0));
    return byDeclarationOrder(result);
}

export async function layoutWithElk(ast: DocumentAst): Promise<LayoutResult> {
    const elk = new (ELK as unknown as ElkConstructor)();
    const laidOut = await elk.layout(graph(ast));
    const nodes = flatten(laidOut, flattenAst(ast.nodes));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const originals = new Map(ast.edges.map((edge) => [edge.id, edge]));
    const edges: RoutedEdge[] = [];
    for (const edge of laidOut.edges ?? []) {
        const original = originals.get(edge.id); if (!original) continue;
        const origin = sharedContainerOrigin(original.source, original.target, byId);
        const points: ElkPoint[] = [];
        for (const section of edge.sections ?? []) for (const bend of section.bendPoints ?? []) points.push({ x: bend.x + origin.x, y: bend.y + origin.y });
        edges.push({ ...original, points: simplifyWaypoints(points) });
    }
    return { nodes, edges: byDeclarationOrder(edges) };
}
