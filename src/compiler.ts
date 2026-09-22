import { layoutDocument } from "./layout/index.js";
import { parseDsl } from "./parser.js";
import { renderDrawio } from "./render/drawio.js";

/** Browser-safe DrawDSL compiler boundary for CLI, web, and plugin hosts. */
export async function compileDrawDsl(source: string): Promise<string> {
    const result = await layoutDocument(parseDsl(source));
    return renderDrawio(result.nodes, result.edges);
}
