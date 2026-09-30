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
    const hostIdentity = host.locator('#collaboration-participants [data-host="true"][data-you="true"]');
    await expect(hostIdentity).toHaveText(/^[A-Za-z]+ [A-Za-z]+ [a-f0-9]{4} · Host · You$/);
    const hostName = (await hostIdentity.innerText()).split(" · ")[0]!;
    await expect(host.locator("#collaboration-count")).toHaveText("1");
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
    await expect(guest.locator('#collaboration-participants [data-host="true"]')).toHaveText(`${hostName} · Host`);
    const guestIdentity = guest.locator('#collaboration-participants [data-you="true"]');
    await expect(guestIdentity).toHaveText(/^[A-Za-z]+ [A-Za-z]+ [a-f0-9]{4} · You$/);
    const guestName = (await guestIdentity.innerText()).split(" · ")[0]!;
    expect(guestName).not.toBe(hostName);
    await expect(host.locator("#collaboration-participants li")).toHaveCount(2);
    await expect(host.locator("#collaboration-count")).toHaveText("2");
    await guest.locator("#collaboration-close").click();
    await guest.locator("#source .cm-content").fill("aws:lambda guestedit");
    await expect(host.locator("#source .cm-content")).toContainText("aws:lambda guestedit");
    await host.locator("#source .cm-content").fill("aws:lambda hostedit");
    await expect(guest.locator("#source .cm-content")).toContainText("aws:lambda hostedit");
    await host.locator("#collaborate").click();
    await expect(host.locator("#collaboration-status")).toHaveText("2 participants · connected");
    await expect(host.locator('#collaboration-participants [data-you="false"]')).toHaveText(guestName);
    await host.reload();
    await expect(hostIdentity).toHaveText(`${hostName} · Host · You`);
    await expect(host.locator("#collaboration-status")).toHaveText("2 participants · connected");
    await guest.locator("#collaborate").click();
    await guest.locator("#collaboration-leave").click();
    await expect(host.locator("#collaboration-status")).toContainText("Waiting for another participant");
    await expect(host.locator("#collaboration-participants li")).toHaveCount(1);
    await guest.goto(invitation);
    await expect(guestIdentity).toHaveText(`${guestName} · You`);
    await expect(guest.locator("#collaboration-status")).toHaveText("2 participants · connected");
    await host.locator("#collaboration-leave").click();
    await expect(guest.locator("#collaboration-participants")).toContainText("Host is offline");
});
