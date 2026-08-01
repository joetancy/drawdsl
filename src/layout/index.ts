import type { DocumentAst, LayoutResult } from "../model.js";
import { layoutWithDagre } from "./dagre.js";
import { layoutWithElk } from "./elk.js";

export function layoutDocument(ast: DocumentAst): Promise<LayoutResult> {
  return ast.layoutEngine === "dagre" ? Promise.resolve(layoutWithDagre(ast)) : layoutWithElk(ast);
}
