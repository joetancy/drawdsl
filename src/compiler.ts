import { layoutDocument } from "./layout/index.js";
import type { RoutingQuality } from "./layout/routing.js";
import { parseDsl } from "./parser.js";
import { renderDrawio } from "./render/drawio.js";

/** Browser-safe DrawDSL compiler boundary for CLI and web. */
export async function compileDrawDsl(source: string, routingQuality: RoutingQuality = "beautiful"): Promise<string> {
    const result = await layoutDocument(parseDsl(source), routingQuality);
    return renderDrawio(result.nodes, result.edges, result.layers, source);
}
