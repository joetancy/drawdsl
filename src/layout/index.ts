import type { DocumentAst, LayoutResult } from "../model.js";
import { positionWithElk } from "./elk.js";
import { routeDiagram, type RoutingQuality } from "./routing.js";

export async function layoutDocument(ast: DocumentAst, routingQuality: RoutingQuality = "beautiful"): Promise<LayoutResult> {
    // Visibility is presentation state. Hidden flows still take part in placement and routing.
    const nodes = await positionWithElk(ast, ast.layout);
    return { nodes, edges: await routeDiagram(nodes, ast.edges, ast.layout, routingQuality), layers: ast.layers };
}
