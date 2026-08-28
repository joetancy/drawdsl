import "./web.css";
import { init as initRouter } from "@mr_mint/elkjs-libavoid";
import { layoutDocument } from "./layout/index.js";
import { parseDsl } from "./parser.js";
import { formatDsl } from "./formatter.js";
import { renderDrawio } from "./render/drawio.js";

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
const savedDiagrams = document.querySelector<HTMLDialogElement>("#saved-diagrams")!;
const savedToggle = document.querySelector<HTMLButtonElement>("#saved-toggle")!;
const savedClose = document.querySelector<HTMLButtonElement>("#saved-close")!;
const saveName = document.querySelector<HTMLInputElement>("#save-name")!;
const saveCurrent = document.querySelector<HTMLButtonElement>("#save-current")!;
const savedEmpty = document.querySelector<HTMLParagraphElement>("#saved-empty")!;
const savedDiagramsList = document.querySelector<HTMLDivElement>("#saved-diagrams-list")!;
const guide = document.querySelector<HTMLDialogElement>("#guide")!;
const guideToggle = document.querySelector<HTMLButtonElement>("#guide-toggle")!;
const guideClose = document.querySelector<HTMLButtonElement>("#guide-close")!;
const formatDslButton = document.querySelector<HTMLButtonElement>("#format-dsl")!;
const copyShareLink = document.querySelector<HTMLButtonElement>("#copy-share-link")!;
const xmlToggle = document.querySelector<HTMLButtonElement>("#xml-toggle")!;
const copyXml = document.querySelector<HTMLButtonElement>("#copy-xml")!;
const themeToggle = document.querySelector<HTMLButtonElement>("#theme-toggle")!;
const routerReady = initRouter(new URL("../node_modules/libavoid-js/dist/libavoid.wasm", import.meta.url).href);
const viewerReady = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://viewer.diagrams.net/js/viewer-static.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the diagrams.net viewer"));
    document.head.append(script);
});
let revision = 0;
let debounce: ReturnType<typeof setTimeout>;
let darkMode = false;
let latestXml = "";
let dslSource = "";
let showingXml = false;
let shareRevision = 0;
let shareDebounce: ReturnType<typeof setTimeout>;
const savedDiagramsKey = "drawdsl.saved-diagrams.v1";

type SavedDiagram = { id: string; name: string; source: string };

function isSavedDiagram(value: unknown): value is SavedDiagram {
    if (!value || typeof value !== "object") return false;
    const diagram = value as Record<string, unknown>;
    return typeof diagram.id === "string" && typeof diagram.name === "string" && typeof diagram.source === "string";
}

function readSavedDiagrams(): SavedDiagram[] {
    try {
        const saved = localStorage.getItem(savedDiagramsKey);
        if (!saved) return [];
        const parsed: unknown = JSON.parse(saved);
        return Array.isArray(parsed) ? parsed.filter(isSavedDiagram) : [];
    } catch {
        return [];
    }
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

function loadSavedDiagram(diagram: SavedDiagram): void {
    showingXml = false;
    dslSource = diagram.source;
    source.value = diagram.source;
    source.readOnly = false;
    source.setSelectionRange(0, 0);
    source.scrollTop = 0;
    source.scrollLeft = 0;
    xmlToggle.textContent = "Show draw.io XML";
    scheduleShareUrl();
    updateEditor();
    savedDiagrams.close();
    status.textContent = `Loaded ${diagram.name}`;
    void render();
}

function renderSavedDiagrams(): void {
    const diagrams = readSavedDiagrams();
    savedEmpty.hidden = diagrams.length > 0;
    savedDiagramsList.replaceChildren(...diagrams.map((diagram) => {
        const item = document.createElement("div");
        item.className = "saved-item";
        const load = document.createElement("button");
        load.className = "saved-load";
        load.type = "button";
        load.textContent = diagram.name;
        load.addEventListener("click", () => loadSavedDiagram(diagram));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Delete";
        remove.addEventListener("click", () => {
            if (!confirm(`Delete ${diagram.name}?`)) return;
            if (writeSavedDiagrams(readSavedDiagrams().filter((saved) => saved.id !== diagram.id))) renderSavedDiagrams();
        });
        item.append(load, remove);
        return item;
    }));
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): ArrayBuffer {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
}

async function compressDsl(value: string): Promise<string> {
    const compressed = new Blob([new TextEncoder().encode(value)]).stream().pipeThrough(new CompressionStream("gzip"));
    return bytesToBase64Url(new Uint8Array(await new Response(compressed).arrayBuffer()));
}

async function decompressDsl(value: string): Promise<string> {
    const decompressed = new Blob([base64UrlToBytes(value)]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new TextDecoder().decode(await new Response(decompressed).arrayBuffer());
}

async function syncShareUrl(expectedRevision?: number): Promise<void> {
    const rawHash = `dsl=${encodeURIComponent(dslSource)}`;
    let hash = rawHash;
    try {
        const compressedHash = `v=1&z=${await compressDsl(dslSource)}`;
        if (compressedHash.length < rawHash.length) hash = compressedHash;
    } catch {
        // Compression Streams are unavailable; raw links remain shareable.
    }
    if (expectedRevision !== undefined && expectedRevision !== shareRevision) return;
    history.replaceState(null, "", `#${hash}`);
}

function scheduleShareUrl(): void {
    const revision = ++shareRevision;
    clearTimeout(shareDebounce);
    shareDebounce = setTimeout(() => { void syncShareUrl(revision); }, 3000);
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

async function render(): Promise<void> {
    const current = ++revision;
    try {
        const ast = parseDsl(showingXml ? dslSource : source.value);
        await routerReady;
        const result = await layoutDocument(ast);
        const xml = renderDrawio(result.nodes, result.edges);
        if (current !== revision) return;
        latestXml = xml;
        copyXml.disabled = false;
        xmlToggle.disabled = false;
        await viewerReady;
        if (current !== revision) return;

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
        status.textContent = "";
    } catch (error) {
        if (current !== revision) return;
        status.textContent = error instanceof Error ? error.message : String(error);
    }
}

const shareParams = new URLSearchParams(location.hash.slice(1));
source.value = shareParams.get("dsl") ?? starter;
dslSource = source.value;
updateEditor();
savedToggle.addEventListener("click", () => {
    renderSavedDiagrams();
    savedDiagrams.showModal();
    saveName.focus();
});
savedClose.addEventListener("click", () => savedDiagrams.close());
savedDiagrams.addEventListener("click", (event) => {
    if (event.target === savedDiagrams) savedDiagrams.close();
});
saveCurrent.addEventListener("click", () => {
    const diagram: SavedDiagram = {
        id: savedDiagramId(),
        name: saveName.value.trim() || "Untitled diagram",
        source: dslSource,
    };
    const diagrams = readSavedDiagrams();
    if (!writeSavedDiagrams([diagram, ...diagrams])) return;
    saveName.value = "";
    renderSavedDiagrams();
    status.textContent = `Saved ${diagram.name} locally`;
});
guideToggle.addEventListener("click", () => guide.showModal());
guideClose.addEventListener("click", () => guide.close());
guide.addEventListener("click", (event) => {
    if (event.target === guide) guide.close();
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
        xmlToggle.textContent = "Show draw.io XML";
        status.textContent = "Formatted successfully";
        void render();
    } catch (error) {
        status.textContent = error instanceof Error ? error.message : String(error);
    }
});
xmlToggle.addEventListener("click", () => {
    if (!latestXml) return;
    showingXml = !showingXml;
    if (showingXml) {
        dslSource = source.value;
        source.value = latestXml;
        updateEditor();
        source.readOnly = true;
        xmlToggle.textContent = "Show DSL";
    } else {
        source.value = dslSource;
        updateEditor();
        source.readOnly = false;
        xmlToggle.textContent = "Show draw.io XML";
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
    if (!latestXml) return;
    try {
        await navigator.clipboard.writeText(latestXml);
        copyXml.textContent = "Copied!";
        setTimeout(() => { copyXml.textContent = "Copy draw.io XML"; }, 1200);
    } catch {
        status.textContent = "Clipboard access was denied";
    }
});
copyShareLink.addEventListener("click", async () => {
    try {
        await syncShareUrl();
        await navigator.clipboard.writeText(location.href);
        copyShareLink.textContent = "Copied!";
        setTimeout(() => { copyShareLink.textContent = "Copy share link"; }, 1200);
    } catch {
        status.textContent = "Clipboard access was denied";
    }
});
themeToggle.addEventListener("click", () => {
    darkMode = !darkMode;
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    themeToggle.textContent = darkMode ? "☀️ Light mode" : "🌙 Dark mode";
    themeToggle.setAttribute("aria-pressed", String(darkMode));
    void render();
});
source.addEventListener("input", () => {
    if (showingXml) return;
    dslSource = source.value;
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
    const compressedDsl = shareParams.get("z");
    if (compressedDsl) {
        const initialRevision = shareRevision;
        try {
            const sharedDsl = await decompressDsl(compressedDsl);
            if (shareRevision === initialRevision) {
                source.value = sharedDsl;
                dslSource = sharedDsl;
            }
        } catch {
            status.textContent = "Could not read the shared DrawDSL link";
        }
    }
    updateEditor();
    await render();
})();
