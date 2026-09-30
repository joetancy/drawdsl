import { layoutDocument } from "./layout/index.js";
import type { RoutingQuality } from "./layout/routing.js";
import { parseDsl } from "./parser.js";
import { renderDrawio } from "./render/drawio.js";

/** Browser-safe DrawDSL compiler boundary for CLI and web. */
export async function compileDrawDsl(source: string, routingQuality: RoutingQuality = "beautiful", onRoutingTime?: (milliseconds: number) => void): Promise<string> {
    const result = await layoutDocument(parseDsl(source), routingQuality, onRoutingTime);
    return renderDrawio(result.nodes, result.edges, result.layers, source);
}
