import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// Local headless peers cannot resolve each other's mDNS ICE hostnames on every runner.
test.use({ launchOptions: { args: ["--disable-features=WebRtcHideLocalIpsWithMdns", "--allow-loopback-in-peer-connection"] } });

async function setup(page: Page): Promise<void> {
    await page.route("https://viewer.diagrams.net/js/viewer-static.min.js", (route) => route.fulfill({ contentType: "application/javascript", body: "window.GraphViewer={processElements(){}}" }));
}

test("manual pairing syncs separate browsers and keeps XML local", async ({ page: host, browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext();
    const guest = await context.newPage();
    const otherGuest = await context.newPage();
    const errors: string[] = [];
    for (const page of [host, guest, otherGuest]) {
        await setup(page);
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("websocket", () => errors.push("Unexpected signaling WebSocket"));
    }
    if (!process.env.DRAWDSL_LIVE_WEBRTC) {
        // Exercise pairing, chunking and Yjs deterministically without depending on runner UDP/NAT.
        const peers = new Map<string, Page>();
        const pairs = new Map<string, string>();
        for (const page of [host, guest, otherGuest]) {
            await page.exposeFunction("rtcRegister", (id: string) => { peers.set(id, page); });
            await page.exposeFunction("rtcPair", async (a: string, b: string) => {
                pairs.set(a, b); pairs.set(b, a);
                for (const id of [a, b]) await peers.get(id)!.evaluate((id) => {
                    const peer = (window as unknown as { rtcPeers: Record<string, { open(): void }> }).rtcPeers[id]!;
                    peer.open();
                }, id);
            });
            await page.exposeFunction("rtcSend", async (id: string, data: number[]) => {
                const remote = pairs.get(id)!;
                await peers.get(remote)!.evaluate(({ remote, data }) => {
                    (window as unknown as { rtcPeers: Record<string, { channel: { onmessage?: (event: { data: ArrayBuffer }) => void } }> }).rtcPeers[remote]!.channel.onmessage?.({ data: new Uint8Array(data).buffer });
                }, { remote, data });
            });
            await page.addInitScript(() => {
                const api = window as unknown as {
                    rtcRegister(id: string): Promise<void>;
                    rtcPair(a: string, b: string): Promise<void>;
                    rtcSend(id: string, data: number[]): Promise<void>;
                    rtcPeers: Record<string, Peer>;
                };
                class Channel {
                    readyState = "connecting";
                    binaryType = "arraybuffer";
                    onopen?: () => void;
                    onclose?: () => void;
                    onmessage?: (event: { data: ArrayBuffer }) => void;
                    constructor(private id: string) {}
                    send(data: Uint8Array) { void api.rtcSend(this.id, [...data]); }
                    close() { this.readyState = "closed"; this.onclose?.(); }
                }
                class Peer {
                    id = crypto.randomUUID();
                    channel = new Channel(this.id);
                    localDescription?: { type: string; sdp: string; toJSON(): { type: string; sdp: string } };
                    signalingState = "stable";
                    iceGatheringState = "complete";
                    ondatachannel?: (event: { channel: Channel }) => void;
                    constructor() { api.rtcPeers[this.id] = this; void api.rtcRegister(this.id); }
                    createDataChannel() { return this.channel; }
                    async createOffer() { return { type: "offer", sdp: this.id }; }
                    async createAnswer() { return { type: "answer", sdp: this.id }; }
                    async setLocalDescription(description: { type: string; sdp: string }) {
                        this.localDescription = { ...description, toJSON: () => description };
                        this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
                    }
                    async setRemoteDescription(description: { type: string; sdp: string }) {
                        if (description.type === "offer") this.ondatachannel?.({ channel: this.channel });
                        else { this.signalingState = "stable"; await api.rtcPair(this.id, description.sdp); }
                    }
                    open() { this.channel.readyState = "open"; this.channel.onopen?.(); }
                    close() { this.channel.close(); }
                }
                api.rtcPeers = {};
                window.RTCPeerConnection = Peer as unknown as typeof RTCPeerConnection;
            });
        }
    }
    try {
        await host.goto("./");
        await expect(host.locator("#copy-xml")).toBeEnabled({ timeout: 30000 });
        await host.locator("#source .cm-content").fill("aws:lambda shared");
        await host.locator("#collaborate").click();
        await expect(host.locator("#collaboration-link")).toHaveValue(/#pair=/, { timeout: 30000 });
        const invitation = await host.locator("#collaboration-link").inputValue();
        await guest.goto(invitation);
        await expect(guest.locator("#collaboration-link")).toHaveValue(/#pair=/, { timeout: 30000 });
        const answer = await guest.locator("#collaboration-link").inputValue();
        await host.locator("#collaboration-answer").fill(answer);
        await host.locator("#collaboration-connect").click();
        await expect(host.locator("#collaboration-status")).toContainText("Connected", { timeout: 30000 });
        await expect(guest.locator("#source .cm-content")).toContainText("aws:lambda shared");
        await host.locator("#collaboration-close").click();
        await guest.locator("#collaboration-close").click();
        await guest.locator("#source .cm-content").fill("aws:lambda changed");
        await expect(host.locator("#source .cm-content")).toContainText("aws:lambda changed");
        const largeSource = "# " + "x".repeat(40000) + "\naws:lambda changed";
        await guest.locator("#source .cm-content").fill(largeSource);
        await expect(host.locator("#source .cm-content")).toContainText("# xxxxx");
        await host.locator("#export-menu > summary").click();
        const download = host.waitForEvent("download");
        await host.locator("#download-dsl").click();
        expect(await readFile((await (await download).path())!, "utf8")).toBe(largeSource);
        await host.locator("#export-menu > summary").click();
        await expect(host.locator("#xml-toggle")).toBeEnabled();
        await host.locator("#xml-toggle").click();
        await expect(host.locator("#source .cm-content")).toContainText("mxfile");
        await expect(guest.locator("#source .cm-content")).not.toContainText("mxfile");
        await guest.locator("#source .cm-content").fill("aws:lambda newest");
        await host.locator("#xml-toggle").click();
        await expect(host.locator("#source .cm-content")).toContainText("aws:lambda newest");
        await host.locator("#collaborate").click();
        await host.locator("#collaboration-invite").click();
        await expect.poll(() => host.locator("#collaboration-link").inputValue()).not.toBe(invitation);
        await expect(host.locator("#collaboration-link")).toHaveValue(/#pair=/, { timeout: 30000 });
        await otherGuest.goto(await host.locator("#collaboration-link").inputValue());
        await expect(otherGuest.locator("#collaboration-link")).toHaveValue(/#pair=/, { timeout: 30000 });
        await host.locator("#collaboration-answer").fill(await otherGuest.locator("#collaboration-link").inputValue());
        await host.locator("#collaboration-connect").click();
        await expect(otherGuest.locator("#source .cm-content")).toContainText("aws:lambda newest");
        await otherGuest.locator("#collaboration-close").click();
        await otherGuest.locator("#source .cm-content").fill("aws:lambda relayed");
        await expect(guest.locator("#source .cm-content")).toContainText("aws:lambda relayed");
        await guest.reload();
        await expect(guest.locator("#collaboration-link")).toHaveValue(/#pair=/, { timeout: 30000 });
        await expect(guest.locator("#source .cm-content")).toContainText("aws:lambda relayed");
        await host.reload();
        await expect(host.locator("#collaboration-link")).toHaveValue(/#pair=/, { timeout: 30000 });
        await expect(host.locator("#source .cm-content")).toContainText("aws:lambda relayed");
        expect(errors).toEqual([]);
    } finally { await context.close(); }
});
