import type { DocumentAst, LayoutResult } from "../model.js";
import { positionWithElk } from "./elk.js";
import { routeDiagram } from "./routing.js";

export async function layoutDocument(ast: DocumentAst): Promise<LayoutResult> {
    // Visibility is presentation state. Hidden flows still take part in placement and routing.
    const nodes = await positionWithElk(ast, ast.layout);
    return { nodes, edges: await routeDiagram(nodes, ast.edges, ast.layout), layers: ast.layers };
}
