import "./web.css";
import skillText from "../SKILL.md?raw";
import { init as initRouter } from "@mr_mint/elkjs-libavoid";
import { compileDrawDsl } from "./compiler.js";
import { parseDsl } from "./parser.js";
import { formatDsl } from "./formatter.js";
import { buildShareHash, resolveShareDsl } from "./share.js";
import { DslError } from "./model.js";
import { computeFoldRegions, type FoldRegion } from "./fold.js";
import { foldAll, unfoldAll, unfoldEffect } from "@codemirror/language";
import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorExtensions } from "./editor.js";

declare global {
    interface Window {
        GraphViewer?: { processElements(): void };
    }
}

const starter = `direction right

aws:internet internet "Internet"
aws:cloud cloud "AWS Cloud" {
    aws:region region "ap-southeast-1" {
        aws:apigw api "API Gateway"
        aws:lambda handler "Request handler"
        aws:dynamodb data "Application data"
    }
}

internet --> api : HTTPS
api --> handler
handler --> data
`;

const source = document.querySelector<HTMLDivElement>("#source")!;
const foldToggle = document.querySelector<HTMLButtonElement>("#fold-toggle")!;
const preview = document.querySelector<HTMLDivElement>("#preview")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const saveName = document.querySelector<HTMLInputElement>("#save-name")!;
const saveCurrent = document.querySelector<HTMLButtonElement>("#save-current")!;
const saveCopy = document.querySelector<HTMLButtonElement>("#save-copy")!;
const savedCurrentStatus = document.querySelector<HTMLSpanElement>("#saved-current-status")!;
const savedEmpty = document.querySelector<HTMLSpanElement>("#saved-empty")!;
const savedDiagramsList = document.querySelector<HTMLDivElement>("#saved-diagrams-list")!;
const savedReset = document.querySelector<HTMLButtonElement>("#saved-reset")!;
const deleteConfirm = document.querySelector<HTMLDialogElement>("#delete-confirm")!;
const deleteConfirmName = document.querySelector<HTMLElement>("#delete-confirm-name")!;
const deleteCancel = document.querySelector<HTMLButtonElement>("#delete-cancel")!;
const deleteAccept = document.querySelector<HTMLButtonElement>("#delete-accept")!;
const guide = document.querySelector<HTMLDialogElement>("#guide")!;
const guideToggle = document.querySelector<HTMLButtonElement>("#guide-toggle")!;
const guideClose = document.querySelector<HTMLButtonElement>("#guide-close")!;
const skill = document.querySelector<HTMLDialogElement>("#skill")!;
const skillToggle = document.querySelector<HTMLButtonElement>("#skill-toggle")!;
const skillClose = document.querySelector<HTMLButtonElement>("#skill-close")!;
const copySkill = document.querySelector<HTMLButtonElement>("#copy-skill")!;
const skillSource = document.querySelector<HTMLElement>("#skill-source")!;
const formatDslButton = document.querySelector<HTMLButtonElement>("#format-dsl")!;
const copyShareLink = document.querySelector<HTMLButtonElement>("#copy-share-link")!;
const xmlToggle = document.querySelector<HTMLButtonElement>("#xml-toggle")!;
const copyXml = document.querySelector<HTMLButtonElement>("#copy-xml")!;
const downloadDsl = document.querySelector<HTMLButtonElement>("#download-dsl")!;
const downloadDrawio = document.querySelector<HTMLButtonElement>("#download-drawio")!;
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const gotoError = document.querySelector<HTMLButtonElement>("#goto-error")!;
let errorLine: number | undefined;
const modeCompartment = new Compartment();
const view = new EditorView({ parent: source, doc: "", extensions: [modeCompartment.of(editorExtensions())] });
const editorText = (): string => view.state.doc.toString();

function setErrorLine(line?: number): void {
    errorLine = line;
    gotoError.hidden = line === undefined;
    if (line !== undefined) gotoError.textContent = `Go to line ${line}`;
}

function focusErrorLine(): void {
    if (errorLine === undefined || showingXml) return;
    ensureLineVisible(errorLine - 1);
    const line = view.state.doc.line(Math.min(errorLine, view.state.doc.lines));
    view.focus();
    view.dispatch({ selection: { anchor: line.from } });
    updateEditor();
}

function reportError(error: unknown, stalePreview: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = stalePreview && lastGoodXml ? `${message} (showing last successful preview)` : message;
    setErrorLine(error instanceof DslError ? error.line : undefined);
}

let editorFull = "";
let foldRegions: FoldRegion[] = [];

function getEditorFull(): string {
    return editorText();
}

function setEditorText(full: string): void {
    editorFull = full;
    foldRegions = computeFoldRegions(full);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: full }, selection: { anchor: 0 } });
    unfoldAll(view);
}

function ensureLineVisible(fullLine: number): void {
    const region = foldRegions.find((candidate) => candidate.start < fullLine && fullLine <= candidate.end);
    if (region) view.dispatch({ effects: unfoldEffect.of({ from: view.state.doc.line(region.start + 1).to, to: view.state.doc.line(region.end + 1).to }) });
}
const routerReady = initRouter(new URL("../node_modules/libavoid-js/dist/libavoid.wasm", import.meta.url).href);
routerReady.catch(() => {});
const viewerReady = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://viewer.diagrams.net/js/viewer-static.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the diagrams.net viewer"));
    document.head.append(script);
});
viewerReady.catch(() => {});
let sourceRevision = 0;
let debounce: ReturnType<typeof setTimeout>;
let darkMode = false;
let latestXml = "";
let lastGoodXml = "";
let lastGoodSource = "";
let dslSource = "";
let showingXml = false;
let shareRevision = 0;
let shareDebounce: ReturnType<typeof setTimeout>;
const savedDiagramsKey = "drawdsl.saved-diagrams.v1";
let pendingDelete: SavedDiagram | undefined;
let loadedDiagramId: string | undefined;
let loadedDiagramName: string | undefined;
let savedSnapshot = "";
let savedFailed = false;

type SavedDiagram = { id: string; name: string; source: string };

function isSavedDiagram(value: unknown): value is SavedDiagram {
    if (!value || typeof value !== "object") return false;
    const diagram = value as Record<string, unknown>;
    return typeof diagram.id === "string" && typeof diagram.name === "string" && typeof diagram.source === "string";
}

function readSavedState(): { diagrams: SavedDiagram[]; failed: boolean } {
    try {
        const saved = localStorage.getItem(savedDiagramsKey);
        if (!saved) return { diagrams: [], failed: false };
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed)) return { diagrams: [], failed: true };
        return { diagrams: parsed.filter(isSavedDiagram), failed: false };
    } catch {
        return { diagrams: [], failed: true };
    }
}

function currentSource(): string {
    return showingXml ? dslSource : getEditorFull();
}

function isDirtyForLoad(): boolean {
    return currentSource() !== savedSnapshot;
}

function writeSavedDiagrams(diagrams: SavedDiagram[]): boolean {
    try {
        localStorage.setItem(savedDiagramsKey, JSON.stringify(diagrams));
        return true;
    } catch {
        status.textContent = "Could not save diagram locally";
        return false;
    }
}

function savedDiagramId(): string {
    return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setLoadedDiagram(diagram?: SavedDiagram): void {
    loadedDiagramId = diagram?.id;
    loadedDiagramName = diagram?.name;
    saveCurrent.disabled = !diagram;
    savedCurrentStatus.textContent = diagram ? `Loaded: ${diagram.name}` : "Not saved";
}

function downloadFilename(extension: string): string {
    const base = (loadedDiagramName ?? "diagram").trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "diagram";
    return `${base.slice(0, 80)}.${extension}`;
}

function downloadFile(filename: string, content: string, mime: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function loadSavedDiagram(diagram: SavedDiagram): void {
    if (isDirtyForLoad() && !confirm(`Discard unsaved changes and load "${diagram.name}"?`)) return;
    setLoadedDiagram(diagram);
    savedSnapshot = diagram.source;
    showingXml = false;
    dslSource = diagram.source;
    setEditorText(diagram.source);
    view.dispatch({ selection: { anchor: 0 } });
    view.scrollDOM.scrollTop = 0;
    view.scrollDOM.scrollLeft = 0;
    xmlToggle.textContent = "🧾 Show draw.io XML";
    scheduleShareUrl();
    updateEditor();
    renderSavedDiagrams();
    setErrorLine(undefined);
    status.textContent = `Loaded ${diagram.name}`;
    markSourceChanged();
    void render();
}

function renderSavedDiagrams(): void {
    const { diagrams, failed } = readSavedState();
    savedFailed = failed;
    savedEmpty.hidden = failed || diagrams.length > 0;
    savedReset.hidden = !failed;
    if (failed) status.textContent = "Saved diagrams are unavailable or corrupt; stored data was preserved";
    savedDiagramsList.replaceChildren(...diagrams.map((diagram) => {
        const item = document.createElement("div");
        item.className = `saved-item${diagram.id === loadedDiagramId ? " active" : ""}`;
        const load = document.createElement("button");
        load.className = "saved-load";
        load.type = "button";
        load.textContent = `📂 ${diagram.name}`;
        load.setAttribute("aria-current", String(diagram.id === loadedDiagramId));
        load.addEventListener("click", () => loadSavedDiagram(diagram));
        const remove = document.createElement("button");
        remove.className = "saved-delete";
        remove.type = "button";
        remove.textContent = "🗑️ Delete";
        remove.addEventListener("click", () => {
            pendingDelete = diagram;
            deleteConfirmName.textContent = diagram.name;
            deleteConfirm.showModal();
        });
        item.append(load, remove);
        return item;
    }));
}

async function syncShareUrl(snapshot: string, expectedRevision?: number): Promise<void> {
    const hash = await buildShareHash(snapshot);
    if (expectedRevision !== undefined && expectedRevision !== shareRevision) return;
    history.replaceState(null, "", `#${hash}`);
}

function scheduleShareUrl(): void {
    const revision = ++shareRevision;
    clearTimeout(shareDebounce);
    shareDebounce = setTimeout(() => { void syncShareUrl(dslSource, revision); }, 3000);
}

function updateEditor(): void {
    foldToggle.disabled = showingXml || !foldRegions.length;
    foldToggle.textContent = view.dom.querySelector(".cm-foldPlaceholder") ? "Unfold all" : "Fold all";
}

function markSourceChanged(): void {
    sourceRevision += 1;
    // Current source has no successful output yet; keep the last preview but
    // prevent exporting stale XML as if it were current.
    copyXml.disabled = true;
    downloadDrawio.disabled = true;
}

function showPreview(xml: string): void {
    const graph = document.createElement("div");
    graph.className = "mxgraph";
    graph.dataset.mxgraph = JSON.stringify({
        xml,
        nav: true,
        resize: true,
        toolbar: "zoom",
        "dark-mode": darkMode ? "dark" : "light",
    });
    preview.replaceChildren(graph);
    window.GraphViewer?.processElements();
}

async function render(): Promise<void> {
    const seen = sourceRevision;
    const src = showingXml ? dslSource : getEditorFull();
    try {
        await routerReady;
        if (seen !== sourceRevision) return;
        const xml = await compileDrawDsl(src);
        if (seen !== sourceRevision) return;
        latestXml = xml;
        lastGoodXml = xml;
        lastGoodSource = src;
        copyXml.disabled = false;
        downloadDrawio.disabled = false;
        xmlToggle.disabled = false;
        if (showingXml) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: xml } });
            updateEditor();
        }
        try {
            await viewerReady;
        } catch (viewerError) {
            if (seen !== sourceRevision) return;
            showPreviewFallback();
            status.textContent = viewerError instanceof Error ? viewerError.message : String(viewerError);
            return;
        }
        if (seen !== sourceRevision) return;

        showPreview(xml);
        if (!savedFailed) status.textContent = "";
        setErrorLine(undefined);
    } catch (error) {
        if (seen !== sourceRevision) return;
        copyXml.disabled = true;
        downloadDrawio.disabled = true;
        xmlToggle.disabled = !lastGoodXml;
        reportError(error, true);
    }
}

function showPreviewFallback(): void {
    // Viewer failed but compilation succeeded: keep valid XML accessible.
    const fallback = document.createElement("div");
    fallback.className = "mxgraph";
    fallback.textContent = "Preview unavailable; use Show draw.io XML.";
    preview.replaceChildren(fallback);
}

const initialHash = location.hash.slice(1);
const initialLegacy = new URLSearchParams(initialHash).get("dsl");
setEditorText(initialLegacy ?? starter);
dslSource = editorFull;
savedSnapshot = editorFull;
skillSource.textContent = skillText;
setEditorMode();
updateEditor();
renderSavedDiagrams();
savedReset.addEventListener("click", () => {
    if (!savedFailed) return;
    if (!confirm("Saved data looks corrupt. Clear it and start fresh? This cannot be undone.")) return;
    try {
        localStorage.removeItem(savedDiagramsKey);
    } catch {
        status.textContent = "Could not clear saved diagrams";
        return;
    }
    renderSavedDiagrams();
    status.textContent = "Cleared saved diagrams";
});
window.addEventListener("storage", (event) => {
    if (event.key !== savedDiagramsKey) return;
    const { diagrams, failed } = readSavedState();
    renderSavedDiagrams();
    if (failed) return;
    if (isDirtyForLoad()) {
        status.textContent = "Saved diagrams changed in another tab; your edits were kept";
        return;
    }
    if (loadedDiagramId && !diagrams.some((diagram) => diagram.id === loadedDiagramId)) {
        setLoadedDiagram();
        status.textContent = "Loaded diagram was deleted in another tab; your edits were kept";
    }
});
deleteCancel.addEventListener("click", () => {
    pendingDelete = undefined;
    deleteConfirm.close();
});
deleteAccept.addEventListener("click", () => {
    if (!pendingDelete) return;
    const deletedDiagram = pendingDelete;
    const { diagrams, failed } = readSavedState();
    if (failed) {
        status.textContent = "Saved diagrams are unavailable or corrupt; stored data was preserved";
        return;
    }
    if (!writeSavedDiagrams(diagrams.filter((saved) => saved.id !== deletedDiagram.id))) {
        return;
    }
    if (loadedDiagramId === deletedDiagram.id) {
        setLoadedDiagram();
        savedSnapshot = currentSource();
    }
    pendingDelete = undefined;
    deleteConfirm.close();
    renderSavedDiagrams();
    status.textContent = `Deleted ${deletedDiagram.name}`;
});
deleteConfirm.addEventListener("click", (event) => {
    if (event.target === deleteConfirm) {
        pendingDelete = undefined;
        deleteConfirm.close();
    }
});
saveCurrent.addEventListener("click", () => {
    if (!loadedDiagramId) return;
    const { diagrams, failed } = readSavedState();
    if (failed) {
        status.textContent = "Saved diagrams are unavailable or corrupt; stored data was preserved";
        return;
    }
    const index = diagrams.findIndex((diagram) => diagram.id === loadedDiagramId);
    if (index < 0) {
        setLoadedDiagram();
        renderSavedDiagrams();
        status.textContent = "Loaded diagram no longer exists";
        return;
    }
    const diagram = { ...diagrams[index]!, source: dslSource };
    diagrams[index] = diagram;
    if (!writeSavedDiagrams(diagrams)) return;
    savedSnapshot = diagram.source;
    renderSavedDiagrams();
    status.textContent = `Saved ${diagram.name} locally`;
});
saveCopy.addEventListener("click", () => {
    const diagram: SavedDiagram = {
        id: savedDiagramId(),
        name: saveName.value.trim() || "Untitled diagram",
        source: dslSource,
    };
    const { diagrams, failed } = readSavedState();
    if (failed) {
        status.textContent = "Saved diagrams are unavailable or corrupt; stored data was preserved";
        return;
    }
    if (!writeSavedDiagrams([diagram, ...diagrams])) return;
    setLoadedDiagram(diagram);
    savedSnapshot = diagram.source;
    saveName.value = "";
    renderSavedDiagrams();
    status.textContent = `Saved ${diagram.name} locally`;
});
guideToggle.addEventListener("click", () => guide.showModal());
guideClose.addEventListener("click", () => guide.close());
guide.addEventListener("click", (event) => {
    if (event.target === guide) guide.close();
});
skillToggle.addEventListener("click", () => skill.showModal());
skillClose.addEventListener("click", () => skill.close());
skill.addEventListener("click", (event) => {
    if (event.target === skill) skill.close();
});
copySkill.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(skillSource.textContent ?? "");
        copySkill.textContent = "✅ Copied!";
        setTimeout(() => { copySkill.textContent = "📋 Copy"; }, 1200);
    } catch {
        copySkill.textContent = "Clipboard denied";
    }
});
formatDslButton.addEventListener("click", () => {
    try {
        const formatted = formatDsl(showingXml ? dslSource : getEditorFull());
        parseDsl(formatted);
        showingXml = false;
        dslSource = formatted;
        setEditorText(formatted);
        scheduleShareUrl();
        updateEditor();
        setEditorMode();
        xmlToggle.textContent = "🧾 Show draw.io XML";
        status.textContent = "Formatted successfully";
        setErrorLine(undefined);
        markSourceChanged();
        void render();
    } catch (error) {
        reportError(error, false);
    }
});
gotoError.addEventListener("click", focusErrorLine);
function setEditorMode(): void {
    source.setAttribute("aria-label", showingXml ? "draw.io XML output (read-only)" : "DrawDSL source");
    view.dispatch({ effects: modeCompartment.reconfigure(editorExtensions(showingXml)) });
}
xmlToggle.addEventListener("click", () => {
    if (!latestXml) return;
    showingXml = !showingXml;
    if (showingXml) {
        dslSource = getEditorFull();
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: latestXml } });
        updateEditor();
        xmlToggle.textContent = "📝 Show DSL";
    } else {
        setEditorText(dslSource);
        updateEditor();
        xmlToggle.textContent = "🧾 Show draw.io XML";
    }
    setEditorMode();
});
source.addEventListener("keydown", (event) => {
    // Shift+Tab leaves the editor via native focus; Esc moves forward to the toolbar.
    if (event.key === "Escape" && !showingXml) {
        event.preventDefault();
        formatDslButton.focus();
        return;
    }
    if (event.key === "Tab" && event.shiftKey) {
        event.preventDefault();
        formatDslButton.focus();
        return;
    }
    if (event.key !== "Tab" || showingXml) return;
    event.preventDefault();
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: "    " }, selection: { anchor: from + 4 } });
});
copyXml.addEventListener("click", async () => {
    if (!latestXml || copyXml.disabled) return;
    if (currentSource() !== lastGoodSource) return;
    try {
        await navigator.clipboard.writeText(latestXml);
        copyXml.textContent = "✅ Copied!";
        setTimeout(() => { copyXml.textContent = "📋 Copy draw.io XML"; }, 1200);
    } catch {
        status.textContent = "Clipboard access was denied";
    }
});
downloadDsl.addEventListener("click", () => {
    downloadFile(downloadFilename("drawdsl"), currentSource(), "text/plain");
});
downloadDrawio.addEventListener("click", () => {
    if (!latestXml || downloadDrawio.disabled) return;
    if (currentSource() !== lastGoodSource) return;
    downloadFile(downloadFilename("drawio"), latestXml, "application/xml");
});
copyShareLink.addEventListener("click", async () => {
    const snapshot = currentSource();
    const revision = shareRevision;
    try {
        await syncShareUrl(snapshot, revision);
        if (revision !== shareRevision) return;
        await navigator.clipboard.writeText(location.href);
        copyShareLink.textContent = "✅ Copied!";
        setTimeout(() => { copyShareLink.textContent = "🔗 Copy share link"; }, 1200);
    } catch {
        status.textContent = "Clipboard access was denied";
    }
});
themeToggle.addEventListener("click", () => {
    darkMode = !darkMode;
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    themeToggle.textContent = darkMode ? "☀️ Light mode" : "🌙 Dark mode";
    themeToggle.setAttribute("aria-pressed", String(darkMode));
    if (lastGoodXml) showPreview(lastGoodXml);
});
view.dom.addEventListener("click", () => updateEditor());
view.dom.addEventListener("input", () => {
    if (showingXml) return;
    editorFull = editorText();
    foldRegions = computeFoldRegions(editorFull);
    dslSource = editorFull;
    markSourceChanged();
    scheduleShareUrl();
    updateEditor();
    clearTimeout(debounce);
    debounce = setTimeout(() => void render(), 300);
});
foldToggle.addEventListener("click", () => {
    if (showingXml || !foldRegions.length) return;
    if (view.dom.querySelector(".cm-foldPlaceholder")) unfoldAll(view);
    else foldAll(view);
    updateEditor();
    view.focus();
});
void (async () => {
    let initialError = "";
    const initialRevision = shareRevision;
    const { dsl, error } = await resolveShareDsl(initialHash);
    if (dsl !== null) {
        if (shareRevision === initialRevision && sourceRevision === 0) {
            setEditorText(dsl);
            dslSource = dsl;
            savedSnapshot = dsl;
            markSourceChanged();
        }
    } else if (error) {
        initialError = error;
        status.textContent = initialError;
    }
    updateEditor();
    await render();
    if (initialError && !status.textContent) status.textContent = initialError;
})();
