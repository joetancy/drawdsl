import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { IndexeddbPersistence } from "y-indexeddb";

export function createCollaborationSession(roomId: string, secret: string) {
    const doc = new Y.Doc();
    const text = doc.getText("drawdsl");
    const persistence = new IndexeddbPersistence(`drawdsl:${roomId}`, doc);
    const metadata = doc.getMap<string>("session");
    const identityKey = `drawdsl.participant:${roomId}`;
    const id: string = crypto.randomUUID();
    const colors = ["#2563eb", "#7c3aed", "#15803d", "#be123c", "#b45309", "#0891b2"];
    const adjectives = ["Amber", "Brave", "Calm", "Clever", "Happy", "Quiet", "Swift", "Sunny"];
    const animals = ["Badger", "Falcon", "Fox", "Koala", "Otter", "Panda", "Robin", "Tiger"];
    const random = crypto.getRandomValues(new Uint8Array(3));
    let user = { id, name: `${adjectives[random[0]! % adjectives.length]} ${animals[random[1]! % animals.length]} ${id.slice(0, 4)}`, color: colors[random[2]! % colors.length]! };
    try {
        const saved: unknown = JSON.parse(sessionStorage.getItem(identityKey) ?? "null");
        if (saved && typeof saved === "object" && "id" in saved && "name" in saved && "color" in saved && typeof saved.id === "string" && typeof saved.name === "string" && typeof saved.color === "string") user = { id: saved.id, name: saved.name, color: saved.color };
        sessionStorage.setItem(identityKey, JSON.stringify(user));
    } catch { /* Presence still works when browser storage is unavailable. */ }
    const provider = new WebrtcProvider(roomId, doc, {
        password: secret,
        signaling: ["wss://signal.frappe.cloud", "wss://signal.shengchen.io", "wss://y-ben.fly.dev"],
    });
    return { doc, text, persistence, provider, metadata, user,
        introduce(isHost: boolean) {
            if (isHost && !metadata.has("host")) metadata.set("host", user.id);
            provider.awareness.setLocalStateField("user", user);
        },
        destroy: () => { provider.destroy(); void persistence.destroy(); doc.destroy(); },
    };
}
