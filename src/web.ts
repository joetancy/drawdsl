import "./web.css";
import skillText from "../SKILL.md?raw";
import { init as initRouter } from "@mr_mint/elkjs-libavoid";
import { layoutDocument } from "./layout/index.js";
import { parseDsl } from "./parser.js";
import { formatDsl } from "./formatter.js";
import { renderDrawio } from "./render/drawio.js";
import { buildShareHash, resolveShareDsl } from "./share.js";
import { DslError } from "./model.js";

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

const source = document.querySelector<HTMLTextAreaElement>("#source")!;
const lineNumbers = document.querySelector<HTMLPreElement>("#line-numbers")!;
const syntaxHighlight = document.querySelector<HTMLPreElement>("#syntax-highlight")!;
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
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const gotoError = document.querySelector<HTMLButtonElement>("#goto-error")!;
let errorLine: number | undefined;

function setErrorLine(line?: number): void {
    errorLine = line;
    gotoError.hidden = line === undefined;
    if (line !== undefined) gotoError.textContent = `Go to line ${line}`;
}

function focusErrorLine(): void {
    if (errorLine === undefined || showingXml) return;
    const lines = source.value.split("\n");
    let offset = 0;
    for (let i = 0; i < errorLine - 1 && i < lines.length; i += 1) offset += lines[i]!.length + 1;
    source.focus();
    source.setSelectionRange(offset, offset);
    updateEditor();
}

function reportError(error: unknown, stalePreview: boolean): void {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = stalePreview && lastGoodXml ? `${message} (showing last successful preview)` : message;
    setErrorLine(error instanceof DslError ? error.line : undefined);
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
    return showingXml ? dslSource : source.value;
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
    saveCurrent.disabled = !diagram;
    savedCurrentStatus.textContent = diagram ? `Loaded: ${diagram.name}` : "Not saved";
}

function loadSavedDiagram(diagram: SavedDiagram): void {
    if (isDirtyForLoad() && !confirm(`Discard unsaved changes and load "${diagram.name}"?`)) return;
    setLoadedDiagram(diagram);
    savedSnapshot = diagram.source;
    showingXml = false;
    dslSource = diagram.source;
    source.value = diagram.source;
    source.readOnly = false;
    source.setSelectionRange(0, 0);
    source.scrollTop = 0;
    source.scrollLeft = 0;
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

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function tokenClass(value: string, firstToken: boolean): string {
    if (firstToken && /^(direction|layout|node-spacing|layer-spacing|edge-spacing|padding|grid-columns)$/.test(value)) return "keyword";
    if (/^(?:[TRBLtrbl]:)?[A-Za-z_][\w-]*:[A-Za-z_][\w-]*$/.test(value)) return "symbol";
    if (/^(?:[TRBLtrbl]:)?[A-Za-z_][\w-]*$/.test(value)) return "identifier";
    if (/^\d+$/.test(value)) return "number";
    if (/^(<-->|<-\.->|-->|-\.->|---|-.-)$/.test(value)) return "operator";
    if (/^[{}]$/.test(value)) return "brace";
    return "plain";
}

function highlightLine(line: string): { html: string; kind: string } {
    let html = "";
    let index = 0;
    let firstToken = true;
    let kind = "plain";
    const add = (value: string, className: string): void => {
        html += `<span class="token-${className}">${escapeHtml(value)}</span>`;
        if (className !== "plain" && kind === "plain") kind = className;
    };
    while (index < line.length) {
        const rest = line.slice(index);
        if (rest[0] === "#") {
            add(rest, "comment");
            break;
        }
        if (rest[0] === '"') {
            let end = 1;
            while (end < rest.length) {
                if (rest[end] === "\\") end += 2;
                else if (rest[end] === '"') {
                    end += 1;
                    break;
                } else end += 1;
            }
            add(rest.slice(0, end), "string");
            index += end;
            firstToken = false;
            continue;
        }
        const match = rest.match(/^(\s+|<-->|<-\.->|-->|-\.->|---|-.-|[TRBLtrbl]:|[A-Za-z_][\w-]*:[A-Za-z_][\w-]*|[A-Za-z_][\w-]*|\d+|[{}]|.)/s)!;
        const value = match[0]!;
        const className = /^\s+$/.test(value) ? "plain" : tokenClass(value, firstToken);
        add(value, className);
        if (!/^\s+$/.test(value)) firstToken = false;
        index += value.length;
    }
    return { html: html || " ", kind };
}

function updateEditor(): void {
    const lines = source.value.split("\n");
    const activeLine = source.value.slice(0, source.selectionStart).split("\n").length - 1;
    const highlighted = lines.map((line, index) => {
        const result = showingXml ? { html: escapeHtml(line) || " ", kind: "plain" } : highlightLine(line);
        return `<span class="editor-line${index === activeLine ? " active" : ""}">${result.html}</span>`;
    });
    syntaxHighlight.innerHTML = highlighted.join("");
    lineNumbers.innerHTML = lines.map((line, index) => {
        const kind = showingXml ? "plain" : highlightLine(line).kind;
        return `<span class="editor-line token-${kind}${index === activeLine ? " active" : ""}">${index + 1}</span>`;
    }).join("");
    syntaxHighlight.scrollTop = source.scrollTop;
    syntaxHighlight.scrollLeft = source.scrollLeft;
    lineNumbers.scrollTop = source.scrollTop;
}

function markSourceChanged(): void {
    sourceRevision += 1;
    // Current source has no successful output yet; keep the last preview but
    // prevent exporting stale XML as if it were current.
    copyXml.disabled = true;
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
    const src = showingXml ? dslSource : source.value;
    try {
        const ast = parseDsl(src);
        await routerReady;
        if (seen !== sourceRevision) return;
        const result = await layoutDocument(ast);
        if (seen !== sourceRevision) return;
        const xml = renderDrawio(result.nodes, result.edges);
        if (seen !== sourceRevision) return;
        latestXml = xml;
        lastGoodXml = xml;
        lastGoodSource = src;
        copyXml.disabled = false;
        xmlToggle.disabled = false;
        if (showingXml) {
            source.value = xml;
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
        status.textContent = "";
        setErrorLine(undefined);
    } catch (error) {
        if (seen !== sourceRevision) return;
        copyXml.disabled = true;
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
source.value = initialLegacy ?? starter;
dslSource = source.value;
savedSnapshot = source.value;
skillSource.textContent = skillText;
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
        const formatted = formatDsl(showingXml ? dslSource : source.value);
        parseDsl(formatted);
        showingXml = false;
        dslSource = formatted;
        source.value = formatted;
        scheduleShareUrl();
        updateEditor();
        source.readOnly = false;
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
xmlToggle.addEventListener("click", () => {
    if (!latestXml) return;
    showingXml = !showingXml;
    if (showingXml) {
        dslSource = source.value;
        source.value = latestXml;
        updateEditor();
        source.readOnly = true;
        xmlToggle.textContent = "📝 Show DSL";
    } else {
        source.value = dslSource;
        updateEditor();
        source.readOnly = false;
        xmlToggle.textContent = "🧾 Show draw.io XML";
    }
});
source.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || showingXml) return;
    event.preventDefault();
    const start = source.selectionStart;
    const end = source.selectionEnd;
    source.setRangeText("    ", start, end, "end");
    dslSource = source.value;
    updateEditor();
    source.dispatchEvent(new Event("input"));
});
copyXml.addEventListener("click", async () => {
    if (!latestXml || copyXml.disabled) return;
    const currentSrc = showingXml ? dslSource : source.value;
    if (currentSrc !== lastGoodSource) return;
    try {
        await navigator.clipboard.writeText(latestXml);
        copyXml.textContent = "✅ Copied!";
        setTimeout(() => { copyXml.textContent = "📋 Copy draw.io XML"; }, 1200);
    } catch {
        status.textContent = "Clipboard access was denied";
    }
});
copyShareLink.addEventListener("click", async () => {
    const snapshot = showingXml ? dslSource : source.value;
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
source.addEventListener("input", () => {
    if (showingXml) return;
    dslSource = source.value;
    markSourceChanged();
    scheduleShareUrl();
    updateEditor();
    clearTimeout(debounce);
    debounce = setTimeout(() => void render(), 300);
});
source.addEventListener("scroll", updateEditor);
source.addEventListener("focus", updateEditor);
source.addEventListener("click", updateEditor);
source.addEventListener("keyup", updateEditor);
document.addEventListener("selectionchange", () => {
    if (document.activeElement === source) updateEditor();
});
void (async () => {
    let initialError = "";
    const initialRevision = shareRevision;
    const { dsl, error } = await resolveShareDsl(initialHash);
    if (dsl !== null) {
        if (shareRevision === initialRevision && sourceRevision === 0) {
            source.value = dsl;
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
