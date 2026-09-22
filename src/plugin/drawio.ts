import { init as initRouter } from "@mr_mint/elkjs-libavoid";
import { compileDrawDsl } from "../compiler.js";
import { formatDsl } from "../formatter.js";

declare const Draw: { loadPlugin(callback: (ui: any) => void): void };
declare const mxCodec: new (document?: Document) => { decode(node: Node): any };

const routerReady = initRouter(new URL(/* @vite-ignore */ "./libavoid.wasm", import.meta.url).href);
const DEFAULT_SOURCE = "aws:apigw api \"API Gateway\"\naws:lambda handler \"Request handler\"\napi --> handler";

function drawDslCells(graph: any): any[] {
    return graph.getChildCells(graph.getDefaultParent()).filter((cell: any) => graph.getCellStyle(cell).drawdsl === "1");
}

function importXml(ui: any, source: string, xml: string): void {
    const document = new DOMParser().parseFromString(xml, "text/xml");
    const modelNode = document.documentElement.querySelector("mxGraphModel");
    if (!modelNode) throw new Error("Compiler did not produce a graph model");
    const model = new mxCodec(document).decode(modelNode);
    const cells = model.getChildCells(model.getCell("1"));
    const graph = ui.editor.graph;
    graph.getModel().beginUpdate();
    try {
        graph.removeCells(drawDslCells(graph));
        const imported = graph.importCells(cells, 0, 0, graph.getDefaultParent());
        graph.setCellStyles("drawdsl", "1", imported);
        graph.setAttributeForCell(graph.getModel().getRoot(), "drawdslSource", source);
        graph.setSelectionCells(imported);
    } finally {
        graph.getModel().endUpdate();
    }
}

function openDrawDslEditor(ui: any): void {
    const root = document.createElement("div");
    root.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:12px;height:100%;box-sizing:border-box";
    const source = document.createElement("textarea");
    source.value = ui.editor.graph.getAttributeForCell(ui.editor.graph.getModel().getRoot(), "drawdslSource") ?? DEFAULT_SOURCE;
    source.style.cssText = "flex:1;min-height:260px;resize:vertical;font:13px monospace";
    const status = document.createElement("div");
    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const button = (label: string, action: () => void): HTMLButtonElement => {
        const element = document.createElement("button");
        element.textContent = label;
        element.onclick = action;
        return element;
    };
    controls.append(
        button("Format", () => { try { source.value = formatDsl(source.value); status.textContent = ""; } catch (error) { status.textContent = String(error); } }),
        button("Cancel", () => ui.hideDialog()),
        button("Apply", async () => {
            try {
                await routerReady;
                importXml(ui, source.value, await compileDrawDsl(source.value));
                ui.hideDialog();
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : String(error);
            }
        }),
    );
    root.append(source, status, controls);
    ui.showDialog(root, 640, 420, true, true);
}

Draw.loadPlugin((ui) => {
    ui.actions.addAction("drawdsl", () => openDrawDslEditor(ui));
    const extras = ui.menus.get("extras");
    const previous = extras.funct;
    extras.funct = function (...args: any[]): void {
        const [menu, parent] = args;
        previous.apply(this, args);
        ui.menus.addMenuItems(menu, ["-", "drawdsl"], parent);
    };
});
