import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { IndexeddbPersistence } from "y-indexeddb";

export function createCollaborationSession(roomId: string, secret: string) {
    const doc = new Y.Doc();
    const text = doc.getText("drawdsl");
    const persistence = new IndexeddbPersistence(`drawdsl:${roomId}`, doc);
    const provider = new WebrtcProvider(roomId, doc, {
        password: secret,
        signaling: ["wss://signal.frappe.cloud", "wss://signal.shengchen.io", "wss://y-ben.fly.dev"],
    });
    return { doc, text, persistence, provider, destroy: () => { provider.destroy(); void persistence.destroy(); doc.destroy(); } };
}
