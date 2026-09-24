import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const SOURCE = `direction right
core:box api "API"
core:box handler "Handler"
layer requests "Request flow" {
    api --> handler : Invoke
}
layer events "Event flow" [visible=false] {
    handler -.-> api : Notify
}`;

// A deterministic viewer contract test. The live viewer is tested separately.
const VIEWER = `
window.__viewerCreates = 0;
window.GraphViewer = {
    processElements() {},
    createViewerForElement(element, callback) {
        window.__viewerCreates += 1;
        const doc = new DOMParser().parseFromString(JSON.parse(element.dataset.mxgraph).xml, "application/xml");
        const cells = new Map(Array.from(doc.querySelectorAll("mxCell")).map(cell => [cell.getAttribute("id"), cell]));
        const view = { scale: 1, translate: { x: 0, y: 0 }, scaleAndTranslate(scale, x, y) { this.scale = scale; this.translate = { x, y }; } };
        const draw = () => {
            element.replaceChildren();
            for (const cell of cells.values()) {
                const edge = cell.getAttribute("edge") === "1";
                if (!edge && cell.getAttribute("vertex") !== "1") continue;
                if (edge && cells.get(cell.getAttribute("parent"))?.getAttribute("visible") === "0") continue;
                const label = document.createElement("span");
                label.dataset[edge ? "edge" : "node"] = cell.getAttribute("id");
                label.textContent = cell.getAttribute("value");
                element.append(label);
            }
        };
        const model = {
            getCell(id) { return cells.get(id); },
            beginUpdate() {},
            endUpdate() { draw(); view.scaleAndTranslate(9, 99, 99); },
            setVisible(cell, visible) { cell.setAttribute("visible", visible ? "1" : "0"); }
        };
        const viewer = { graph: { getModel() { return model; }, view }, autoOrigin: true, autoCrop: true };
        window.__activeViewer = viewer;
        callback(viewer);
    }
};`;

async function setup(page: Page): Promise<void> {
    await page.route("https://viewer.diagrams.net/js/viewer-static.min.js", (route) => route.fulfill({ contentType: "application/javascript", body: VIEWER }));
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as { __clipboard: string }).__clipboard = value; } } });
    });
    await page.goto(`./#dsl=${encodeURIComponent(SOURCE)}`);
    await expect(page.locator("#preview-status")).toHaveText("Up to date", { timeout: 30_000 });
    await expect(page.getByRole("checkbox", { name: "Request flow", exact: true })).toBeChecked();
}

async function creates(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { __viewerCreates: number }).__viewerCreates);
}

async function geometry(page: Page): Promise<string[]> {
    return page.locator("#preview .mxgraph").evaluate((element) => {
        const xml = JSON.parse((element as HTMLElement).dataset.mxgraph!).xml as string;
        const doc = new DOMParser().parseFromString(xml, "application/xml");
        return Array.from(doc.querySelectorAll("mxGeometry")).map((node) => new XMLSerializer().serializeToString(node));
    });
}

test("layer switches hide edges and labels without a new viewer or changed geometry", async ({ page }) => {
    await setup(page);
    const initialCreates = await creates(page);
    const initialGeometry = await geometry(page);
    const initialSource = await page.locator("#source .cm-content").innerText();
    await page.evaluate(() => {
        const viewer = (window as unknown as { __activeViewer: { graph: { view: { scaleAndTranslate(scale: number, x: number, y: number): void } } } }).__activeViewer;
        viewer.graph.view.scaleAndTranslate(2, 13, 17);
    });
    await expect(page.locator("#preview [data-edge]")).toHaveCount(1);
    await expect(page.locator("#preview")).toContainText("Invoke");
    await page.getByRole("checkbox", { name: "Request flow", exact: true }).uncheck();
    await expect(page.locator("#preview [data-edge]")).toHaveCount(0);
    await expect(page.locator("#preview [data-node]")).toHaveCount(2);
    await page.getByRole("button", { name: "All flows", exact: true }).click();
    await expect(page.locator("#preview [data-edge]")).toHaveCount(2);
    await expect(page.locator("#preview")).toContainText("Notify");
    await page.getByRole("button", { name: "Architecture only", exact: true }).click();
    await expect(page.locator("#preview [data-edge]")).toHaveCount(0);
    await page.getByRole("button", { name: "Reset layers", exact: true }).click();
    await expect(page.locator("#preview [data-edge]")).toHaveCount(1);
    expect(await creates(page)).toBe(initialCreates);
    expect(await geometry(page)).toEqual(initialGeometry);
    expect(await page.locator("#source .cm-content").innerText()).toBe(initialSource);
    const viewport = await page.evaluate(() => {
        const viewer = (window as unknown as { __activeViewer: { graph: { view: { scale: number; translate: { x: number; y: number } } } } }).__activeViewer;
        return { scale: viewer.graph.view.scale, ...viewer.graph.view.translate };
    });
    expect(viewport).toEqual({ scale: 2, x: 13, y: 17 });
});

test("canonical download retains DSL defaults after preview switches", async ({ page }) => {
    await setup(page);
    await page.getByRole("button", { name: "All flows", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Event flow", exact: true })).toBeChecked();
    await page.locator("#export-menu > summary").click();
    const pending = page.waitForEvent("download");
    await page.locator("#download-drawio").click();
    const path = await (await pending).path();
    expect(path).not.toBeNull();
    const xml = await readFile(path!, "utf8");
    expect(xml).toMatch(/id="layer:events"[^>]*visible="0"/);
    expect(xml).toMatch(/id="layer:requests"[^>]*visible="1"/);
    expect(xml.match(/edge="1"/g)).toHaveLength(2);
});

test("choices survive edits, theme changes and a failed compile", async ({ page }) => {
    await setup(page);
    await page.getByRole("checkbox", { name: "Request flow", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Event flow", exact: true }).check();
    const initial = await creates(page);
    await page.locator("#source .cm-content").fill(`${SOURCE}\n# edited`);
    await expect.poll(() => creates(page)).toBeGreaterThan(initial);
    await expect(page.getByRole("checkbox", { name: "Request flow", exact: true })).not.toBeChecked();
    await page.locator("#theme-toggle").click();
    await expect(page.getByRole("checkbox", { name: "Event flow", exact: true })).toBeChecked();
    await page.locator("#source .cm-content").fill(`${SOURCE}\nnot valid`);
    await expect(page.locator("#preview-status")).toContainText("previous successful preview");
    await expect(page.locator("#download-drawio")).toBeDisabled();
    await page.getByRole("checkbox", { name: "Event flow", exact: true }).uncheck();
    await expect(page.locator("#preview [data-edge]")).toHaveCount(0);
    await page.locator("#source .cm-content").fill(SOURCE);
    await expect(page.locator("#preview-status")).toHaveText("Up to date");
    await expect(page.getByRole("checkbox", { name: "Request flow", exact: true })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Event flow", exact: true })).not.toBeChecked();
});

test("loading a saved diagram resets choices even with the same layer IDs", async ({ page }) => {
    await setup(page);
    await page.locator("#saved-menu > summary").click();
    await page.locator("#save-name").fill("Flow diagram");
    await page.locator("#save-copy").click();
    await page.locator("#saved-menu > summary").click();
    await page.getByRole("button", { name: "Architecture only", exact: true }).click();
    await page.locator("#saved-menu > summary").click();
    await page.locator(".saved-load").click();
    await expect(page.getByRole("checkbox", { name: "Request flow", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Event flow", exact: true })).not.toBeChecked();
});

test("shared source reloads with document visibility rather than preview choices", async ({ page }) => {
    await setup(page);
    await page.getByRole("button", { name: "All flows", exact: true }).click();
    await page.locator("#copy-share-link").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __clipboard?: string }).__clipboard ?? "")).toContain("#");
    await page.reload();
    await expect(page.locator("#preview-status")).toHaveText("Up to date", { timeout: 30_000 });
    await expect(page.getByRole("checkbox", { name: "Request flow", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "Event flow", exact: true })).not.toBeChecked();
});

test("layer controls work with the keyboard at a narrow viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page);
    const request = page.getByRole("checkbox", { name: "Request flow", exact: true });
    await request.focus();
    await page.keyboard.press("Space");
    await expect(request).not.toBeChecked();
    await expect(request).toBeFocused();
    await expect(page.getByRole("button", { name: "Reset layers", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
