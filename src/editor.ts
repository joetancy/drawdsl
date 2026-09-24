import { basicSetup } from "codemirror";
import { foldService, HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { computeFoldRegions } from "./fold.js";

const directives = /^(direction|layout|layer|node-spacing|layer-spacing|edge-spacing|padding|col|grid-columns|color)$/;
const operators = /^(<-->|<-\.->|-->|-\.->|---|-\.-)$/;
const highlightStyles = [
    HighlightStyle.define([
        { tag: tags.keyword, color: "#6D28D9" }, { tag: tags.typeName, color: "#1D4ED8" },
        { tag: tags.string, color: "#15803D" }, { tag: tags.comment, color: "#66758A" },
        { tag: tags.number, color: "#B45309" }, { tag: tags.operator, color: "#BE123C" },
    ]),
    HighlightStyle.define([
        { tag: tags.keyword, color: "#C4A7FF" }, { tag: tags.typeName, color: "#8AB4FF" },
        { tag: tags.string, color: "#8DD9A6" }, { tag: tags.comment, color: "#8C9AAF" },
        { tag: tags.number, color: "#F6B86B" }, { tag: tags.operator, color: "#FF9EAB" },
    ]),
];
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
        if (stream.match(/^#(?:[\da-f]{3}|[\da-f]{6})(?=\s|$|[,\]])/i)) return "number";
        if (stream.match(/#.*/)) return "comment";
        if (stream.match(/"(?:\\.|[^"\\])*"?/)) { state.first = false; return "string"; }
        const match = stream.match(/^(?:<-->|<-\.->|-->|-\.->|---|-\.-|[TRBLtrbl]:|[A-Za-z_][\w-]*:[A-Za-z_][\w-]*|[A-Za-z_][\w-]*|\d+|[{}]|.)/);
        const value = typeof match === "boolean" ? "" : match?.[0] ?? "";
        if (operators.test(value) || /^[{}]$/.test(value)) { state.first = false; return "operator"; }
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

export function editorExtensions(readOnly = false, dark = false): Extension[] {
    const border = dark ? "#344256" : "#D5DEE8";
    return [basicSetup, syntaxHighlighting(highlightStyles[Number(dark)]!), ...(readOnly ? [] : [dsl, foldDsl]), EditorView.theme({
        "&": { height: "100%", fontSize: "14px", backgroundColor: "var(--surface-muted)" },
        ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: "1.6" },
        ".cm-content": { padding: "14px 0", color: "var(--text-primary)", caretColor: "var(--accent)" },
        ".cm-gutters": { backgroundColor: "var(--surface-subtle)", color: "var(--text-tertiary)", borderRight: `1px solid ${border}` },
        ".cm-activeLine": { backgroundColor: "var(--editor-active)" },
        ".cm-activeLineGutter": { backgroundColor: "var(--surface-subtle)", color: "var(--text-secondary)" },
        ".cm-selectionBackground, ::selection": { backgroundColor: "var(--editor-selection) !important" },
        ".cm-foldPlaceholder": { backgroundColor: "var(--surface-subtle)", border: `1px solid ${border}`, borderRadius: "4px", color: "var(--text-secondary)" },
        ".cm-tooltip": { backgroundColor: "var(--surface)", color: "var(--text-primary)", borderColor: border },
    }), EditorView.editable.of(!readOnly), EditorView.contentAttributes.of({ "aria-label": readOnly ? "draw.io XML output (read-only)" : "DrawDSL source" })];
}
