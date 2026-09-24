import { expect, test, type Page } from "@playwright/test";

const SOURCE = `direction right
core:box api "API"
core:box handler "Handler"
layer requests "Request flow" [color=#2563EB, width=2] {
    api --> handler : Invoke
}
layer events "Event flow" [color=#15803D, width=2, visible=false] {
    handler -.-> api : Notify
}`;

async function geometry(page: Page): Promise<unknown> {
    return page.evaluate(() => {
        const graph = (window as any).__liveViewer.graph;
        const model = graph.getModel();
        return ["api", "handler", "edge:1:api:handler", "edge:2:handler:api"].map((id) => {
            const cell = model.getCell(id);
            const shape = cell.geometry;
            return { id, parent: cell.parent?.id, source: cell.source?.id, target: cell.target?.id, x: shape.x, y: shape.y, width: shape.width, height: shape.height, points: shape.points?.map((point: { x: number; y: number }) => ({ x: point.x, y: point.y })) };
        });
    });
}

test("native viewer changes flow visibility without moving the graph", async ({ page }, testInfo) => {
    test.skip(process.env.DRAWDSL_LIVE_VIEWER !== "1", "Set DRAWDSL_LIVE_VIEWER=1 to run with network access");
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://viewer.diagrams.net/js/viewer-static.min.js", async (route) => {
        const response = await route.fetch({ timeout: 30_000 });
        expect(response.ok()).toBe(true);
        const capture = `\n;(() => {
            const create = window.GraphViewer.createViewerForElement;
            window.__liveCreates = 0;
            window.GraphViewer.createViewerForElement = function(element, callback) {
                window.__liveCreates += 1;
                return create.call(this, element, function(viewer) {
                    window.__liveViewer = viewer;
                    if (callback) callback(viewer);
                });
            };
        })();`;
        await route.fulfill({ response, body: (await response.text()) + capture });
    });
    await page.goto(`./#dsl=${encodeURIComponent(SOURCE)}`);
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__liveViewer?.graph.getModel().getCell("api"))), { timeout: 30_000 }).toBe(true);
    await expect(page.locator("#preview svg").first()).toBeVisible();
    await expect(page.locator("#preview").getByText("Invoke", { exact: true })).toBeVisible();
    await expect(page.locator("#preview").getByText("Notify", { exact: true })).not.toBeVisible();
    const initial = await geometry(page);
    const creates = await page.evaluate(() => (window as any).__liveCreates as number);
    await page.getByRole("checkbox", { name: "Request flow", exact: true }).uncheck();
    await expect(page.locator("#preview").getByText("Invoke", { exact: true })).not.toBeVisible();
    await page.getByRole("checkbox", { name: "Event flow", exact: true }).check();
    await expect(page.locator("#preview").getByText("Notify", { exact: true })).toBeVisible();
    await expect(page.locator("#preview").getByText("API", { exact: true })).toBeVisible();
    expect(await geometry(page)).toEqual(initial);
    expect(await page.evaluate(() => (window as any).__liveCreates as number)).toBe(creates);
    await page.getByRole("button", { name: "All flows", exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath("layers-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: testInfo.outputPath("layers-mobile.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});
