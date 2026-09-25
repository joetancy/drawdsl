import { basicSetup } from "codemirror";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { foldService, HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { computeFoldRegions } from "./fold.js";
import { registeredNamespaces, registeredSymbols, resolveSymbol } from "./symbols/registry.js";

const directiveWords = /^(direction|layout|layer|node-spacing|layer-spacing|edge-spacing|padding|col|grid-columns|color)$/;
const operators = /^(<-->|<-\.->|-->|-\.->|---|-\.-)$/;
const symbols = registeredSymbols().map(({ label, detail }) => ({ label, detail, type: "type" }));
const directiveCompletions: Completion[] = ["direction", "layout elk", "layer", "node-spacing", "layer-spacing", "edge-spacing", "padding", "col", "grid-columns", "color"].map((label) => ({ label, detail: "directive", type: "keyword" }));
const endpointOperator = /(?:<-->|<-\.->|-->|-\.->|---|-\.-)\s*(?:[TRBLtrbl]:)?$/;
const endpointIds = (source: string): Completion[] => {
    const namespaces = registeredNamespaces().join("|");
    const declarations = new RegExp(`^\\s*(${namespaces}):([\\w-]+)\\s+([A-Za-z_][\\w-]*)`, "gm");
    const ids = new Set<string>();
    for (const [, namespace, symbol, id] of source.matchAll(declarations)) {
        try {
            const definition = resolveSymbol({ namespace: namespace!, name: symbol! }).definition;
            if (definition.render !== false && !definition.layoutOnly) ids.add(id!);
        } catch { /* Ignore incomplete declarations while editing. */ }
    }
    return [...ids].map((label) => ({ label, detail: "declared resource", type: "variable" }));
};

function dslCompletions(context: CompletionContext) {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    if (before.includes("#") || (before.match(/"/g)?.length ?? 0) % 2 === 1) return null;
    const word = context.matchBefore(/[A-Za-z_][\w:-]*/);
    if (!word && !context.explicit) return null;
    let from = word?.from ?? context.pos;
    let token = word?.text ?? "";
    const lineBeforeWord = line.text.slice(0, from - line.from);
    let options: Completion[];
    if (endpointOperator.test(lineBeforeWord)) {
        const side = token.match(/^[TRBLtrbl]:(.*)$/);
        if (side) { from += 2; token = side[1]!; }
        options = endpointIds(context.state.doc.toString());
    } else if (!lineBeforeWord.trim()) {
        options = [...directiveCompletions, ...symbols, ...endpointIds(context.state.doc.toString())];
    } else if (/^(?:direction|layout)\s+$/.test(lineBeforeWord.trimStart())) {
        options = (lineBeforeWord.trimStart().startsWith("direction") ? ["right", "left", "down", "up"] : ["elk"]).map((label) => ({ label, type: "keyword" }));
    } else {
        return null;
    }
    const filtered = options.filter((option) => option.label.toLowerCase().startsWith(token.toLowerCase()));
    if (!filtered.length) return null;
    return { from, options: filtered, validFor: /[\w:-]*/ };
}
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
        if (state.first && directiveWords.test(value)) { state.first = false; return "keyword"; }
        state.first = false;
        if (/^(?:[TRBLtrbl]:)?[A-Za-z_][\w-]*:[A-Za-z_][\w-]*$/.test(value)) return "typeName";
        if (/^\d+$/.test(value)) return "number";
        return null;
    },
    languageData: { commentTokens: { line: "#" }, autocomplete: dslCompletions },
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
