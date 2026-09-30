import type { DocumentAst, LayoutResult } from "../model.js";
import { positionWithElk } from "./elk.js";
import { routeDiagram, type RoutingQuality } from "./routing.js";

export async function layoutDocument(ast: DocumentAst, routingQuality: RoutingQuality = "beautiful", onRoutingTime?: (milliseconds: number) => void): Promise<LayoutResult> {
    // Visibility is presentation state. Hidden flows still take part in placement and routing.
    const nodes = await positionWithElk(ast, ast.layout);
    const start = performance.now();
    const edges = await routeDiagram(nodes, ast.edges, ast.layout, routingQuality);
    onRoutingTime?.(performance.now() - start);
    return { nodes, edges, layers: ast.layers };
}
