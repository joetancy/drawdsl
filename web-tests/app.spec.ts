import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile } from "node:fs/promises";

const STARTER = `direction right

aws:internet internet "Internet"`;

const VIEWER_STUB = "window.GraphViewer={processElements(){window.__viewerCalls=(window.__viewerCalls||0)+1;}};";

async function stubViewer(page: Page, mode: "stub" | "fail" = "stub"): Promise<void> {
    await page.route("https://viewer.diagrams.net/js/viewer-static.min.js", async (route: Route) => {
        if (mode === "fail") await route.abort();
        else await route.fulfill({ contentType: "application/javascript", body: VIEWER_STUB });
    });
}

async function stubClipboard(page: Page): Promise<void> {
    await page.addInitScript(() => {
        (window as unknown as { __clipboard: string }).__clipboard = "";
        Object.defineProperty(navigator, "clipboard", {
            value: {
                writeText: async (text: string): Promise<void> => {
                    (window as unknown as { __clipboard: string }).__clipboard = text;
                },
            },
            configurable: true,
        });
    });
}

async function ready(page: Page): Promise<void> {
    await expect(page.locator("#source")).toBeVisible();
    // Wait for the first successful compile: copy button enabled.
    await expect(page.locator("#copy-xml")).toBeEnabled({ timeout: 30_000 });
}

test("compile failure disables export and recovery re-enables it", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.fill("#source", "this is not valid {{{");
    await expect(page.locator("#status")).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#copy-xml")).toBeDisabled();
    await page.fill("#source", STARTER);
    await expect(page.locator("#status")).toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#copy-xml")).toBeEnabled();
    await expect(page.locator("#goto-error")).toBeHidden();
});

test("error line button focuses the offending line", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.fill("#source", `${STARTER}\ncore:nosuch thing`);
    await expect(page.locator("#goto-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#goto-error")).toContainText("line 4");
    await page.click("#goto-error");
    await expect(page.locator("#source")).toBeFocused();
});

test("rapid edits resolve to the latest source", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.fill("#source", "bogus syntax {{{");
    await page.fill("#source", STARTER);
    await expect(page.locator("#status")).toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#copy-xml")).toBeEnabled();
});

test("xml view switches and returns to dsl", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.click("#xml-toggle");
    await expect(page.locator("#source")).toHaveValue(/mxfile/, { timeout: 15_000 });
    await expect(page.locator("#source")).toHaveAttribute("aria-label", /XML/);
    await page.click("#xml-toggle");
    await expect(page.locator("#source")).toHaveAttribute("aria-label", /DrawDSL/);
});

test("save, load, and delete flow with empty state and active styling", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.fill("#save-name", "P08 diagram");
    await page.click("#save-copy");
    await expect(page.locator("#saved-diagrams-list .saved-item.active")).toContainText("P08 diagram");
    await expect(page.locator("#saved-empty")).toBeHidden();
    // Dirty guard: edit then cancel the confirm dialog.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.fill("#source", `${STARTER}\n# dirty`);
    await expect(page.locator("#source")).toHaveValue(/# dirty/);
    await page.locator("#saved-diagrams-list .saved-load").click();
    await expect(page.locator("#source")).toHaveValue(/# dirty/);
    // Accept load via dialog.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("#saved-diagrams-list .saved-load").click();
    await expect(page.locator("#source")).not.toHaveValue(/# dirty/);
    await page.locator("#saved-diagrams-list .saved-delete").click();
    await page.click("#delete-accept");
    await expect(page.locator("#saved-empty")).toBeVisible();
});

test("corrupt storage reports a recoverable error", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.evaluate(() => localStorage.setItem("drawdsl.saved-diagrams.v1", "{corrupt"));
    await page.reload();
    await expect(page.locator("#status")).toContainText(/unavailable or corrupt/, { timeout: 15_000 });
    await expect(page.locator("#saved-reset")).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.click("#saved-reset");
    await expect(page.locator("#saved-empty")).toBeVisible();
});

test("legacy and bad share links behave", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./#dsl=aws%3Alambda%20shared");
    await expect(page.locator("#source")).toHaveValue(/aws:lambda shared/, { timeout: 15_000 });
    // Same-document hash changes do not reload; set the hash then reload.
    await page.evaluate(() => { window.location.hash = "#v=999&z=abc"; });
    await page.reload();
    await expect(page.locator("#status")).toContainText(/Unsupported shared link version/, { timeout: 15_000 });
});

test("viewer failure keeps xml available", async ({ page }) => {
    await stubViewer(page, "fail");
    await stubClipboard(page);
    await page.goto("./");
    await expect(page.locator("#status")).toContainText(/viewer/i, { timeout: 30_000 });
    await expect(page.locator("#xml-toggle")).toBeEnabled();
    await page.click("#xml-toggle");
    await expect(page.locator("#source")).toHaveValue(/mxfile/, { timeout: 15_000 });
});

test("clipboard denial reports an error", async ({ page }) => {
    await stubViewer(page);
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: async (): Promise<void> => { throw new Error("denied"); } },
            configurable: true,
        });
    });
    await page.goto("./");
    await ready(page);
    await page.click("#copy-xml");
    await expect(page.locator("#status")).toContainText(/denied/, { timeout: 15_000 });
});

test("keyboard can leave the editor in both directions", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.click("#source");
    await expect(page.locator("#source")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#source")).not.toBeFocused();
    await page.click("#source");
    await page.keyboard.press("Escape");
    await expect(page.locator("#format-dsl")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#copy-share-link")).toBeFocused();
});

test("narrow viewport keeps essential controls reachable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(361);
    for (const id of ["#format-dsl", "#copy-share-link", "#xml-toggle", "#copy-xml", "#save-copy", "#theme-toggle"]) {
        await expect(page.locator(id)).toBeVisible();
    }
});

test("dashed operators highlight the same as solid ones", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.fill("#source", "aws:lambda a\naws:lambda b\na -.- b");
    await expect(page.locator("#status")).toBeEmpty({ timeout: 15_000 });
    const operators = await page.locator('#syntax-highlight .token-operator:has-text("-.-")').count();
    expect(operators).toBeGreaterThan(0);
});

test("downloads match current source and xml, and stale xml cannot download", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    const dslDownload = page.waitForEvent("download");
    await page.click("#download-dsl");
    const dslPath = await (await dslDownload).path();
    const dslText = await readFile(dslPath!, "utf8");
    await expect(page.locator("#source")).toHaveValue(dslText);

    const drawioDownload = page.waitForEvent("download");
    await page.click("#download-drawio");
    const drawioPath = await (await drawioDownload).path();
    const drawioText = await readFile(drawioPath!, "utf8");
    expect(drawioText).toContain("<mxfile");

    await page.fill("#source", "bogus syntax {{{");
    await expect(page.locator("#status")).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#download-drawio")).toBeDisabled();
});
