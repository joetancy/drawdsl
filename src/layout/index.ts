import type { DocumentAst, LayoutResult } from "../model.js";
import { layoutWithElk } from "./elk.js";

export function layoutDocument(ast: DocumentAst): Promise<LayoutResult> {
    return layoutWithElk(ast);
}
