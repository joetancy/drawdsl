import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const base = "https://app.diagrams.net";
const fetchSync = (url) => execFileSync("curl", ["-fsSL", new URL(url, base).href], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, timeout: 60000 });
const app = fetchSync("/js/app.min.js");
const captured = [];
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: `${base}/?dev=1&test=1&createindex=1`, pretendToBeVisual: true, runScripts: "dangerously",
    beforeParse(window) {
        window.mxBasePath = "/mxgraph/src";
        window.mxLoadResources = false;
        window.mxLoadStylesheets = false;
        window.urlParams = { createindex: "1", dev: "1", test: "1" };
        window.STENCIL_PATH = "/stencils";
        window.DRAWIO_BASE_URL = base;
        window.XMLHttpRequest = function XMLHttpRequest() { this.readyState = 0; this.status = 0; this.responseText = ""; };
        window.XMLHttpRequest.prototype = {
            open(_method, url) { this.url = url; },
            send() {
                try {
                    const body = fetchSync(this.url);
                    this.responseText = body; this.status = 200; this.readyState = 4;
                    try { this.responseXML = new window.DOMParser().parseFromString(body, "text/xml"); } catch {}
                    this.onreadystatechange?.(); this.onload?.();
                } catch (error) { this.status = 404; this.readyState = 4; this.onerror?.(error); this.onreadystatechange?.(); }
            },
            setRequestHeader() {}, abort() {}, getAllResponseHeaders() { return ""; }, getResponseHeader() { return null; }, overrideMimeType() {},
        };
    },
});
const w = dom.window;
// app.min.js logs a large encoded stencil-index payload; keep generator output actionable.
w.console.log = function() {};
try { w.eval(app); } catch (error) { throw new Error(`Could not evaluate draw.io app.min.js: ${error.message}`); }
if (!w.Sidebar?.prototype || !w.Graph || !w.Editor) throw new Error("draw.io app did not expose Sidebar, Graph, and Editor");

const vertex = w.Sidebar.prototype.createVertexTemplateEntry;
w.Sidebar.prototype.createVertexTemplateEntry = function(style, width, height, value, title, showLabel, showTitle, tags) {
    if (style) captured.push({ style, width: Math.round(width) || 0, height: Math.round(height) || 0, title: title || "", tags: tags || "", type: "vertex" });
    return vertex.apply(this, arguments);
};
const edge = w.Sidebar.prototype.createEdgeTemplateEntry;
w.Sidebar.prototype.createEdgeTemplateEntry = function(style, width, height, value, title, showLabel, tags) {
    if (style) captured.push({ style, width: Math.round(width) || 0, height: Math.round(height) || 0, title: title || "", tags: tags || "", type: "edge" });
    return edge.apply(this, arguments);
};

const container = w.document.createElement("div");
w.document.body.appendChild(container);
const graph = new w.Graph(container);
const editor = new w.Editor(false, null, null, graph);
const sidebar = Object.create(w.Sidebar.prototype);
sidebar.editorUi = { editor, container, isOffline: () => true, createTemporaryGraph: (s) => w.Graph.createOffscreenGraph(s), addListener() {}, fireEvent() {}, getServiceName: () => "draw.io", getBaseUrl: () => base, formatEnabled: true };
Object.assign(sidebar, { taglist: {}, currentSearchEntryLibrary: null, createdSearchIndex: [], shapetags: {}, customEntries: null, appendCustomLibraries: false, addStencilsToIndex: true, styleToLibs: {}, defaultImageWidth: 80, defaultImageHeight: 80, palettes: {}, graph, container, wrapper: w.document.createElement("div"), initialDefaultVertexStyle: graph.getStylesheet().getDefaultVertexStyle() || { fontSize: 12 }, initialDefaultEdgeStyle: graph.getStylesheet().getDefaultEdgeStyle() || {} });
sidebar.showPalettes = sidebar.showEntries = sidebar.addSearchPalette = function() {};
sidebar.createItem = () => w.document.createElement("a");
sidebar.addPalette = function(_id, _title, _expanded, build) { try { build?.(w.document.createElement("div")); } catch (error) { if (/aws|azure|gcp/i.test(String(_id))) throw error; } };
sidebar.addPaletteFunctions = function() {};
for (const name of ["setLinkForCell", "setAttributeForCell", "setTooltipForCell"]) graph[name] ??= function() {};
try { sidebar.initPalettes(); } catch (error) { console.warn(`Palette initialization stopped after partial capture: ${error.message}`); }

const namespaces = { "mxgraph.aws4": "aws", "mxgraph.azure": "azure", "mxgraph.azure2": "azure", "mxgraph.gcp": "gcp", "mxgraph.gcp2": "gcp" };
const resources = new Map();
for (const item of captured) {
    const match = item.style.match(/(?:^|;)(?:resIcon|grIcon)=(mxgraph\.(?:aws4|azure2?|gcp2?)\.[^;]+)/)
        ?? item.style.match(/(?:^|;)shape=(mxgraph\.(?:aws4|azure2?|gcp2?)\.[^;]+)/);
    if (!match || item.type !== "vertex") continue;
    const internal = match[1];
    const provider = namespaces[internal.split(".").slice(0, 2).join(".")];
    if (!provider) continue;
    const key = `${provider}\0${item.style}`;
    if (resources.has(key)) continue;
    resources.set(key, { provider, title: item.title, tags: item.tags || item.title.toLowerCase(), style: item.style, width: item.width, height: item.height, type: item.type, drawioShape: internal, drawioLibrary: internal.split(".").slice(0, 2).join(".") });
}
const result = [...resources.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.drawioShape.localeCompare(b.drawioShape) || a.style.localeCompare(b.style));
const minimums = { aws: 300, azure: 80, gcp: 80 };
for (const provider of Object.keys(minimums)) {
    const count = result.filter((item) => item.provider === provider).length;
    if (count < minimums[provider]) throw new Error(`Incomplete ${provider} extraction: only ${count} resources captured (expected at least ${minimums[provider]})`);
}
await writeFile(new URL("../src/generated/drawio-resources.raw.json", import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(`Captured ${result.length} cloud resources (${Object.keys(namespaces).join(", ")} internal namespaces); styles deduplicated: ${captured.length - result.length}`);
dom.window.close();
