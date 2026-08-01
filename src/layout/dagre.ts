import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import { CONFIG } from "../config.js";
import type { AstNode, DocumentAst, FlatLayoutNode, LayoutResult, Point, RoutedEdge } from "../model.js";
import { byDeclarationOrder, dagreDirection, dimensions, flattenAst, simplifyWaypoints } from "./common.js";

type DagreLayout = { x: number; y: number; width: number; height: number };
function anchor(node: AstNode): string { return node.definition.role !== "container" ? node.id : node.children.length ? anchor(node.children[0]!) : node.id; }

export function layoutWithDagre(ast: DocumentAst): LayoutResult {
  const nodesById = flattenAst(ast.nodes);
  const graph = new graphlib.Graph({ compound: true, multigraph: true });
  graph.setGraph({ rankdir: dagreDirection(ast.direction), nodesep: CONFIG.layout.nodeSpacing, ranksep: CONFIG.layout.layerSpacing, edgesep: CONFIG.layout.edgeNodeSpacing, marginx: 40, marginy: 40 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodesById.values()) graph.setNode(node.id, dimensions(node));
  for (const node of nodesById.values()) if (node.parentId) graph.setParent(node.id, node.parentId);
  const routed = new Map<string, { source: string; target: string }>();
  for (const edge of ast.edges) {
    const source = anchor(nodesById.get(edge.source)!); const target = anchor(nodesById.get(edge.target)!);
    routed.set(edge.id, { source, target }); graph.setEdge(source, target, {}, edge.id);
  }
  dagreLayout(graph);
  const nodes = byDeclarationOrder([...nodesById.values()].map((node): FlatLayoutNode => {
    const layout = graph.node(node.id) as DagreLayout;
    return { id: node.id, symbol: node.symbol, definition: node.definition, label: node.label, parentId: node.parentId, x: layout.x - layout.width / 2, y: layout.y - layout.height / 2, width: layout.width, height: layout.height, declarationOrder: node.declarationOrder };
  }));
  const edges = byDeclarationOrder(ast.edges.map((edge): RoutedEdge => {
    const route = routed.get(edge.id)!; const layout = graph.edge(route.source, route.target, edge.id) as { points?: Point[] };
    return { ...edge, points: route.source === edge.source && route.target === edge.target ? simplifyWaypoints((layout.points ?? []).slice(1, -1)) : [] };
  }));
  return { nodes, edges };
}
