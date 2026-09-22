import { init as initRouter } from "@mr_mint/elkjs-libavoid";
import { compileDrawDsl } from "../compiler.js";
import { formatDsl } from "../formatter.js";

declare const Draw: { loadPlugin(callback: (ui: any) => void): void };

const routerReady = initRouter(new URL(/* @vite-ignore */ "./libavoid.wasm", import.meta.url).href);

function openDrawDslEditor(ui: any): void {
    const root = document.createElement("div");
    root.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:12px;height:100%;box-sizing:border-box";
    const source = document.createElement("textarea");
    source.value = "aws:apigw api \"API Gateway\"\naws:lambda handler \"Request handler\"\napi --> handler";
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
                await compileDrawDsl(source.value);
                status.textContent = "Compiled. Graph import will be added next.";
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
