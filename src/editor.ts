import { basicSetup } from "codemirror";
import { defaultHighlightStyle, foldService, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { computeFoldRegions } from "./fold.js";

const directives = /^(direction|layout|node-spacing|layer-spacing|edge-spacing|padding|grid-columns)$/;
const operators = /^(<-->|<-\.->|-->|-\.->|---|-\.-)$/;
const foldsByDoc = new WeakMap<Text, ReturnType<typeof computeFoldRegions>>();

function foldsFor(doc: Text): ReturnType<typeof computeFoldRegions> {
    let regions = foldsByDoc.get(doc);
    if (!regions) {
        regions = computeFoldRegions(doc.toString());
        foldsByDoc.set(doc, regions);
    }
    return regions;
}

const dsl = StreamLanguage.define({
    startState: () => ({ first: true }),
    token(stream, state) {
        if (stream.sol()) state.first = true;
        if (stream.eatSpace()) return null;
        if (stream.match(/#.*/)) return "comment";
        if (stream.match(/"(?:\\.|[^"\\])*"?/)) { state.first = false; return "string"; }
        const match = stream.match(/^(?:<-->|<-\.->|-->|-\.->|---|-\.-|[TRBLtrbl]:|[A-Za-z_][\w-]*:[A-Za-z_][\w-]*|[A-Za-z_][\w-]*|\d+|[{}]|.)/);
        const value = typeof match === "boolean" ? "" : match?.[0] ?? "";
        if (operators.test(value) || /^[{}]$/.test(value)) { state.first = false; return "keyword"; }
        if (state.first && directives.test(value)) { state.first = false; return "keyword"; }
        state.first = false;
        if (/^(?:[TRBLtrbl]:)?[A-Za-z_][\w-]*:[A-Za-z_][\w-]*$/.test(value)) return "typeName";
        if (/^\d+$/.test(value)) return "number";
        return null;
    },
    languageData: { commentTokens: { line: "#" } },
});

const foldDsl = foldService.of((state, lineStart, lineEnd) => {
    const start = state.doc.lineAt(lineStart).number - 1;
    const region = foldsFor(state.doc).find((candidate) => candidate.start === start);
    if (!region) return null;
    const end = state.doc.line(region.end + 1);
    return { from: lineEnd, to: end.to };
});

export function editorExtensions(readOnly = false): Extension[] {
    return [basicSetup, syntaxHighlighting(defaultHighlightStyle), ...(readOnly ? [] : [dsl, foldDsl]), EditorView.theme({
        "&": { height: "100%", fontSize: "14px" },
        ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.55" },
        ".cm-content": { padding: "14px 0", color: "var(--editor-text)", caretColor: "var(--editor-text)" },
        ".cm-gutters": { backgroundColor: "var(--editor-gutter)", borderRight: "1px solid #c5ccda" },
        ".cm-activeLine": { backgroundColor: "var(--editor-active)" },
        ".cm-foldPlaceholder": { backgroundColor: "var(--editor-active)", border: "0", color: "#71809d" },
    }), EditorView.editable.of(!readOnly), EditorView.contentAttributes.of({ "aria-label": readOnly ? "draw.io XML output (read-only)" : "DrawDSL source" })];
}
