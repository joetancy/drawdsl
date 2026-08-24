import "./web.css";
import { init as initRouter } from "@mr_mint/elkjs-libavoid";
import { layoutDocument } from "./layout/index.js";
import { parseDsl } from "./parser.js";
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
const preview = document.querySelector<HTMLDivElement>("#preview")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const guide = document.querySelector<HTMLDialogElement>("#guide")!;
const guideToggle = document.querySelector<HTMLButtonElement>("#guide-toggle")!;
const guideClose = document.querySelector<HTMLButtonElement>("#guide-close")!;
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

source.value = starter;
dslSource = starter;
guideToggle.addEventListener("click", () => guide.showModal());
guideClose.addEventListener("click", () => guide.close());
guide.addEventListener("click", (event) => {
    if (event.target === guide) guide.close();
});
xmlToggle.addEventListener("click", () => {
    if (!latestXml) return;
    showingXml = !showingXml;
    if (showingXml) {
        dslSource = source.value;
        source.value = latestXml;
        source.readOnly = true;
        xmlToggle.textContent = "Show DSL";
    } else {
        source.value = dslSource;
        source.readOnly = false;
        xmlToggle.textContent = "Show draw.io XML";
    }
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
    clearTimeout(debounce);
    debounce = setTimeout(() => void render(), 300);
});
void render();
