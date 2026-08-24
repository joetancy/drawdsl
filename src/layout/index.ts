import type { DocumentAst, LayoutResult } from "../model.js";
import { positionWithElk } from "./elk.js";
import { routeDiagram } from "./routing.js";

export async function layoutDocument(ast: DocumentAst): Promise<LayoutResult> {
    const nodes = await positionWithElk(ast, ast.layout);
    return { nodes, edges: await routeDiagram(nodes, ast.edges, ast.layout) };
}
