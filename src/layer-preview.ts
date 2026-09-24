import "./layers.css";
import { LayerState } from "./layer-state.js";

type ViewerView = {
    scale: number;
    translate: { x: number; y: number };
    scaleAndTranslate(scale: number, x: number, y: number): void;
};

type ViewerModel = {
    getCell(id: string): unknown;
    beginUpdate(): void;
    endUpdate(): void;
    setVisible(cell: unknown, visible: boolean): void;
};

export type DrawioViewer = {
    graph: { getModel(): ViewerModel; view?: ViewerView; destroy?(): void };
    autoOrigin?: boolean;
    autoCrop?: boolean;
};

declare global {
    interface Window {
        GraphViewer?: {
            processElements(): void;
            createViewerForElement?(element: HTMLElement, callback: (viewer: DrawioViewer) => void): void;
        };
    }
}

type PreviewLayer = { id: string; label: string; visible: boolean; count: number };

function rootCells(document: Document): Element[] {
    const root = document.querySelector("mxGraphModel > root");
    if (!root) throw new Error("Preview XML has no graph root");
    return Array.from(root.children).filter((cell) => cell.tagName === "mxCell");
}

/** Owns preview-only state. It never calls the compiler or changes canonical export XML. */
export class LayerPreview {
    private readonly state = new LayerState();
    private readonly panel = document.createElement("fieldset");
    private readonly choices = new Map<string, HTMLInputElement>();
    private layers: PreviewLayer[] = [];
    private modelDocument?: Document;
    private element?: HTMLDivElement;
    private viewer?: DrawioViewer;
    private waitingForViewer = false;
    private resetOnNextDocument = false;
    private dark = false;
    private readonly preview: HTMLElement;

    constructor(preview: HTMLElement) {
        this.preview = preview;
        this.panel.id = "connection-layers";
        this.panel.className = "connection-layers";
        this.panel.hidden = true;
        this.preview.before(this.panel);
    }

    resetForNextDocument(): void {
        // Keep the previous successful preview usable if the next document fails to compile.
        this.resetOnNextDocument = true;
    }

    show(xml: string, dark: boolean): void {
        const parsed = new DOMParser().parseFromString(xml, "application/xml");
        if (parsed.querySelector("parsererror")) throw new Error("Invalid preview XML");
        const cells = rootCells(parsed);
        const counts = new Map<string, number>();
        for (const cell of cells) {
            if (cell.getAttribute("edge") !== "1") continue;
            const parent = cell.getAttribute("parent") ?? "";
            counts.set(parent, (counts.get(parent) ?? 0) + 1);
        }
        const layers = cells.filter((cell) => cell.getAttribute("parent") === "0" && cell.getAttribute("id")?.startsWith("layer:")).map((cell): PreviewLayer => {
            const cellId = cell.getAttribute("id")!;
            return { id: cellId.slice(6), label: cell.getAttribute("value") ?? cellId.slice(6), visible: cell.getAttribute("visible") !== "0", count: counts.get(cellId) ?? 0 };
        });
        if (this.resetOnNextDocument) this.state.reset();
        this.resetOnNextDocument = false;
        this.state.sync(layers);
        this.layers = layers;
        this.modelDocument = parsed;
        this.dark = dark;
        this.renderControls();
        this.mount();
    }

    redraw(dark: boolean): void {
        this.dark = dark;
        if (this.modelDocument) this.mount();
    }

    clear(): void {
        this.element = undefined;
        this.viewer?.graph.destroy?.();
        this.viewer = undefined;
        this.modelDocument = undefined;
        this.waitingForViewer = false;
        this.panel.hidden = true;
        this.preview.parentElement?.classList.remove("with-flow-layers");
    }

    private renderControls(): void {
        this.choices.clear();
        const legend = document.createElement("legend");
        legend.textContent = "Connection layers";
        const actions = document.createElement("div");
        actions.className = "layer-actions";
        const button = (label: string, action: () => void): HTMLButtonElement => {
            const control = document.createElement("button");
            control.type = "button";
            control.textContent = label;
            control.addEventListener("click", () => { action(); this.applyVisibility(); });
            return control;
        };
        actions.append(
            button("All flows", () => this.state.setAll(true)),
            button("Architecture only", () => this.state.setAll(false)),
            button("Reset layers", () => this.state.reset()),
        );
        const list = document.createElement("div");
        list.className = "layer-choices";
        for (const layer of this.layers) {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.dataset.layerId = layer.id;
            input.checked = this.state.visible(layer.id);
            input.setAttribute("aria-label", layer.label);
            input.addEventListener("change", () => {
                this.state.set(layer.id, input.checked);
                this.applyVisibility();
            });
            const name = document.createElement("span");
            name.textContent = layer.label;
            const count = document.createElement("span");
            count.className = "layer-count";
            count.textContent = String(layer.count);
            count.setAttribute("aria-hidden", "true");
            label.append(input, name, count);
            list.append(label);
            this.choices.set(layer.id, input);
        }
        const note = document.createElement("p");
        note.className = "layer-note";
        note.textContent = "Preview only. Exports and share links use DSL visibility defaults.";
        this.panel.replaceChildren(legend, actions, list, note);
        this.panel.hidden = this.layers.length === 0;
        this.preview.parentElement?.classList.toggle("with-flow-layers", !this.panel.hidden);
    }

    private previewXml(): string {
        if (!this.modelDocument) throw new Error("No compiled preview is available");
        const copy = this.modelDocument.cloneNode(true) as Document;
        for (const cell of rootCells(copy)) {
            const id = cell.getAttribute("id") ?? "";
            if (cell.getAttribute("parent") === "0" && id.startsWith("layer:")) {
                cell.setAttribute("visible", this.state.visible(id.slice(6)) ? "1" : "0");
            }
        }
        return new XMLSerializer().serializeToString(copy);
    }

    private config(): string {
        return JSON.stringify({ xml: this.previewXml(), nav: true, resize: true, toolbar: "zoom", "dark-mode": this.dark ? "dark" : "light" });
    }

    private mount(): void {
        this.element = undefined;
        this.viewer?.graph.destroy?.();
        this.viewer = undefined;
        const element = document.createElement("div");
        element.className = "mxgraph";
        element.dataset.mxgraph = this.config();
        this.element = element;
        this.preview.replaceChildren(element);
        const api = window.GraphViewer;
        this.waitingForViewer = Boolean(api?.createViewerForElement);
        if (api?.createViewerForElement) {
            api.createViewerForElement(element, (viewer) => {
                if (this.element !== element) { viewer.graph.destroy?.(); return; }
                this.viewer = viewer;
                this.waitingForViewer = false;
                viewer.autoOrigin = false;
                viewer.autoCrop = false;
                this.applyVisibility();
            });
        } else {
            api?.processElements();
        }
    }

    private applyVisibility(): void {
        for (const [id, input] of this.choices) input.checked = this.state.visible(id);
        if (!this.element || !this.modelDocument) return;
        this.element.dataset.mxgraph = this.config();
        if (!this.viewer) {
            // Older viewer builds can redraw cached XML without running layout again.
            if (!this.waitingForViewer) this.mount();
            return;
        }
        const graph = this.viewer.graph;
        const model = graph.getModel();
        const view = graph.view;
        const viewport = view ? { scale: view.scale, x: view.translate.x, y: view.translate.y } : undefined;
        const scroll = { left: this.preview.scrollLeft, top: this.preview.scrollTop };
        model.beginUpdate();
        try {
            for (const layer of this.layers) {
                const cell = model.getCell(`layer:${layer.id}`);
                if (cell) model.setVisible(cell, this.state.visible(layer.id));
            }
        } finally {
            model.endUpdate();
            if (view && viewport && (view.scale !== viewport.scale || view.translate.x !== viewport.x || view.translate.y !== viewport.y)) {
                view.scaleAndTranslate(viewport.scale, viewport.x, viewport.y);
            }
            this.preview.scrollLeft = scroll.left;
            this.preview.scrollTop = scroll.top;
        }
    }
}
