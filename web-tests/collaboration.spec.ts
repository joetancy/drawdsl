import { test, expect } from "@playwright/test";

test("room links survive edits and tabs synchronize source", async ({ page: host, context }) => {
    const guest = await context.newPage();
    for (const page of [host, guest]) {
        // Test BroadcastChannel synchronization without depending on public signaling uptime.
        await page.routeWebSocket("wss://**", () => {});
        await page.route("https://viewer.diagrams.net/js/viewer-static.min.js", (route) => route.fulfill({ contentType: "application/javascript", body: "window.GraphViewer={processElements(){}}" }));
    }
    await host.goto("./");
    await expect(host.locator("#copy-xml")).toBeEnabled({ timeout: 30000 });
    await host.locator("#source .cm-content").fill("aws:lambda shared");
    await host.locator("#collaborate").click();
    await expect(host.locator("#collaboration-status")).toContainText("Waiting for another participant");
    const invitation = await host.locator("#collaboration-link").inputValue();
    expect(invitation).toContain("#key=");
    await host.locator("#collaboration-close").click();
    await host.locator("#source .cm-content").fill("aws:lambda updated");
    // The snapshot URL timer runs after three seconds.
    await host.waitForTimeout(3200);
    expect(host.url()).toBe(invitation);
    await guest.goto(invitation);
    await expect(guest.locator("#source .cm-content")).toContainText("aws:lambda updated");
    await expect(guest.locator("#collaboration-status")).toHaveText("2 participants · connected");
    await guest.locator("#collaboration-close").click();
    await guest.locator("#source .cm-content").fill("aws:lambda guestedit");
    await expect(host.locator("#source .cm-content")).toContainText("aws:lambda guestedit");
    await host.locator("#source .cm-content").fill("aws:lambda hostedit");
    await expect(guest.locator("#source .cm-content")).toContainText("aws:lambda hostedit");
    await host.locator("#collaborate").click();
    await expect(host.locator("#collaboration-status")).toHaveText("2 participants · connected");
    await guest.locator("#collaborate").click();
    await guest.locator("#collaboration-leave").click();
    await expect(host.locator("#collaboration-status")).toContainText("Waiting for another participant");
});
