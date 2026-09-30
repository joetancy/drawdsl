export type Pairing = { roomId: string; id: string; description: RTCSessionDescriptionInit };

export function buildPairingLink(base: string, pairing: Pairing): string {
    const url = new URL(base);
    url.search = "";
    url.hash = new URLSearchParams({ pair: JSON.stringify(pairing) }).toString();
    return url.href;
}

export function readPairingLink(link: string): Pairing | null {
    const value = new URLSearchParams(new URL(link).hash.slice(1)).get("pair");
    if (value === null) return null;
    if (value.length > 100000) throw new Error("Pairing link is too large");
    let pairing: Pairing;
    try { pairing = JSON.parse(value) as Pairing; } catch { throw new Error("Invalid pairing link"); }
    if (!pairing || typeof pairing.roomId !== "string" || !/^[\w-]{1,80}$/.test(pairing.roomId) || typeof pairing.id !== "string" || !/^[\w-]{1,80}$/.test(pairing.id) || !["offer", "answer"].includes(pairing.description?.type ?? "") || typeof pairing.description?.sdp !== "string") throw new Error("Invalid pairing link");
    return pairing;
}
