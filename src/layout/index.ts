import type { DocumentAst, LayoutResult } from "../model.js";
import { positionWithElk } from "./elk.js";
import { routeDiagram, type RoutingDiagnostics, type RoutingQuality } from "./routing.js";

export async function layoutDocument(ast: DocumentAst, routingQuality: RoutingQuality = "beautiful", onRoutingTime?: (milliseconds: number, diagnostics: RoutingDiagnostics) => void): Promise<LayoutResult> {
    // Visibility is presentation state. Hidden flows still take part in placement and routing.
    const nodes = await positionWithElk(ast, ast.layout);
    const start = performance.now();
    let diagnostics: RoutingDiagnostics = { sharedSegmentPairs: 0, spacingConflictPairs: 0, crowdedSides: 0 };
    const edges = await routeDiagram(nodes, ast.edges, ast.layout, routingQuality, onRoutingTime ? (result) => { diagnostics = result; } : undefined);
    onRoutingTime?.(performance.now() - start, diagnostics);
    return { nodes, edges, layers: ast.layers };
}
