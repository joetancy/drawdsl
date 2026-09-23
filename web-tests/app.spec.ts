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

async function openMenu(page: Page, id: string): Promise<void> {
    const details = page.locator(`#${id}`);
    if (!await details.evaluate((element) => (element as HTMLDetailsElement).open)) await details.locator(":scope > summary").click();
}

test("compile failure disables export and recovery re-enables it", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.locator("#source .cm-content").fill("this is not valid {{{");
    await expect(page.locator("#status")).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#copy-xml")).toBeDisabled();
    await page.locator("#source .cm-content").fill(STARTER);
    await expect(page.locator("#status")).toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#copy-xml")).toBeEnabled();
    await expect(page.locator("#goto-error")).toBeHidden();
});

test("error line button focuses the offending line", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.locator("#source .cm-content").fill(`${STARTER}\ncore:nosuch thing`);
    await expect(page.locator("#goto-error")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#goto-error")).toContainText("line 4");
    await page.click("#goto-error");
    await expect(page.locator("#source .cm-content")).toBeFocused();
});

test("rapid edits resolve to the latest source", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.locator("#source .cm-content").fill("bogus syntax {{{");
    await page.locator("#source .cm-content").fill(STARTER);
    await expect(page.locator("#status")).toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#copy-xml")).toBeEnabled();
});

test("xml view switches and returns to dsl", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.click("#xml-toggle");
    await expect(page.locator("#source .cm-content")).toContainText(/mxfile/, { timeout: 15_000 });
    await expect(page.locator("#source")).toHaveAttribute("aria-label", /XML/);
    await page.click("#xml-toggle");
    await expect(page.locator("#source")).toHaveAttribute("aria-label", /DrawDSL/);
});

test("save, load, and delete flow with empty state and active styling", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await openMenu(page, "saved-menu");
    await expect(page.locator("#saved-reset")).toBeHidden();
    await page.fill("#save-name", "P08 diagram");
    await page.click("#save-copy");
    await expect(page.locator("#saved-diagrams-list .saved-item.active")).toContainText("P08 diagram");
    await expect(page.locator("#saved-empty")).toBeHidden();
    // Dirty guard: edit then cancel the confirm dialog.
    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.locator("#source .cm-content").fill(`${STARTER}\n# dirty`);
    await expect(page.locator("#source .cm-content")).toContainText(/# dirty/);
    await page.locator("#saved-diagrams-list .saved-load").click();
    await expect(page.locator("#source .cm-content")).toContainText(/# dirty/);
    // Accept load via dialog.
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator("#saved-diagrams-list .saved-load").click();
    await expect(page.locator("#source .cm-content")).not.toContainText(/# dirty/);
    await openMenu(page, "saved-menu");
    await page.locator("#saved-diagrams-list .saved-delete").click();
    await page.click("#delete-accept");
    await openMenu(page, "saved-menu");
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
    await openMenu(page, "saved-menu");
    await expect(page.locator("#saved-reset")).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.click("#saved-reset");
    await expect(page.locator("#saved-empty")).toBeVisible();
});

test("legacy and bad share links behave", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./#dsl=aws%3Alambda%20shared");
    await expect(page.locator("#source .cm-content")).toContainText(/aws:lambda shared/, { timeout: 15_000 });
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
    await expect(page.locator("#source .cm-content")).toContainText(/mxfile/, { timeout: 15_000 });
    await expect(page.locator("#preview")).toContainText(/Your diagram compiled/);
});

test("invalid initial source shows an actionable empty-preview state", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./#dsl=this%20is%20not%20valid");
    await expect(page.locator("#status")).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#preview")).toContainText("Fix the DSL error to render a diagram.");
    await expect(page.locator("#preview-status")).toContainText("Compilation failed");
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
    await openMenu(page, "export-menu");
    await page.click("#copy-xml");
    await expect(page.locator("#status")).toContainText(/denied/, { timeout: 15_000 });
});

test("keyboard can leave the editor in both directions", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.locator("#source .cm-content").click();
    await expect(page.locator("#source .cm-content")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#source .cm-content")).not.toBeFocused();
    await page.locator("#source .cm-content").click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#format-dsl")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#xml-toggle")).toBeFocused();
});

test("narrow viewport keeps essential controls reachable", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await openMenu(page, "export-menu");
    await openMenu(page, "saved-menu");
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(361);
    for (const id of ["#format-dsl", "#copy-share-link", "#xml-toggle", "#copy-xml", "#save-copy", "#theme-toggle"]) {
        await expect(page.locator(id)).toBeVisible();
    }
    const menuBox = await page.locator("#saved-menu .menu-panel").boundingBox();
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(360);
});

test("repo link points at the project", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await expect(page.locator("#repo-link")).toHaveAttribute("href", "https://github.com/joetancy/drawdsl");
});

test("containers fold and unfold from the gutter", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.locator("#source .cm-foldGutter .cm-gutterElement").nth(3).click();
    await expect(page.locator("#source .cm-content")).not.toContainText(/Request handler/);
    await expect(page.locator("#source .cm-content")).toContainText(/aws:cloud cloud/);
    // Compilation still sees the folded lines.
    await expect(page.locator("#copy-xml")).toBeEnabled();
    await page.locator("#source .cm-foldGutter .cm-gutterElement").nth(3).click();
    await expect(page.locator("#source .cm-content")).toContainText(/Request handler/);
});

test("edits outside a fold keep it folded", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.locator("#source .cm-foldGutter .cm-gutterElement").nth(3).click();
    await expect(page.locator("#source .cm-content")).not.toContainText(/Request handler/);
    await page.locator("#source .cm-content").click();
    await page.keyboard.press("Home");
    await page.keyboard.type("# folded survives\n");
    await expect(page.locator("#source .cm-content")).not.toContainText(/Request handler/);
    await expect(page.locator("#status")).toBeEmpty({ timeout: 15_000 });
});

test("fold-all toggle and error navigation with folds", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.click("#fold-toggle");
    await expect(page.locator("#fold-toggle")).toContainText("Unfold all");
    await expect(page.locator("#source .cm-content")).not.toContainText(/Request handler/);
    await page.click("#fold-toggle");
    await expect(page.locator("#fold-toggle")).toContainText("Fold all");
    await expect(page.locator("#source .cm-content")).toContainText(/Request handler/);
    // Error on a visible line still navigates while another region stays folded.
    await page.locator("#source .cm-foldGutter .cm-gutterElement").nth(3).click();
    await page.locator("#source .cm-content").click();
    await page.keyboard.press("Home");
    await page.keyboard.type("bogus ");
    await expect(page.locator("#goto-error")).toBeVisible({ timeout: 15_000 });
    await page.click("#goto-error");
    await expect(page.locator("#source .cm-content")).toBeFocused();
    await expect(page.locator("#source .cm-content")).not.toContainText(/Request handler/);
});

test("dashed operators highlight the same as solid ones", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await page.locator("#source .cm-content").fill("aws:lambda a\naws:lambda b\na -.- b");
    await expect(page.locator("#status")).toBeEmpty({ timeout: 15_000 });
    const operatorHighlighted = await page.locator("#source .cm-content span").evaluateAll((tokens) => tokens.some((token) => token.textContent === "-.-"));
    expect(operatorHighlighted).toBe(true);
});

test("downloads match current source and xml, and stale xml cannot download", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await openMenu(page, "export-menu");
    const dslDownload = page.waitForEvent("download");
    await page.click("#download-dsl");
    const dslPath = await (await dslDownload).path();
    const dslText = await readFile(dslPath!, "utf8");
    const editorText = await page.locator("#source .cm-content").innerText();
    expect(editorText.replaceAll("\n", "")).toContain(dslText.replaceAll("\n", "").trimEnd());

    const drawioDownload = page.waitForEvent("download");
    await page.click("#download-drawio");
    const drawioPath = await (await drawioDownload).path();
    const drawioText = await readFile(drawioPath!, "utf8");
    expect(drawioText).toContain("<mxfile");

    await page.locator("#source .cm-content").fill("bogus syntax {{{");
    await expect(page.locator("#status")).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#download-drawio")).toBeDisabled();
});

test("workbench disclosures, theme, dialog, and preview status stay in sync", async ({ page }) => {
    await stubViewer(page);
    await stubClipboard(page);
    await page.goto("./");
    await ready(page);
    await expect(page.locator("#preview-status")).toContainText("Up to date");
    await page.locator("#source .cm-content").fill("not valid syntax");
    await expect(page.locator("#status")).toHaveAttribute("data-kind", "error", { timeout: 15_000 });
    await expect(page.locator("#preview-status")).toContainText("previous successful preview");

    await openMenu(page, "help-menu");
    await page.click("#guide-toggle");
    await expect(page.locator("#guide")).toBeVisible();
    await expect(page.locator("#guide")).toContainText("background=primary");
    await page.click("#guide-close");
    await expect(page.locator("#guide")).toBeHidden();
    await expect(page.locator("#guide-toggle")).toBeFocused();

    await page.click("#theme-toggle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const editorColor = await page.locator("#source .cm-content").evaluate((element) => getComputedStyle(element).color);
    expect(editorColor).not.toBe("rgb(23, 43, 77)");
    await page.click("#theme-toggle");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});
