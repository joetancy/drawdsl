import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { buildPairingLink, readPairingLink, type Pairing } from "./pairing.js";

export function createCollaborationSession(roomId: string, onStatus: (peers: number, error?: string) => void) {
    const doc = new Y.Doc();
    const text = doc.getText("drawdsl");
    const persistence = new IndexeddbPersistence(`drawdsl:${roomId}`, doc);
    const connections = new Map<string, RTCPeerConnection>();
    const channels = new Set<RTCDataChannel>();
    const status = () => onStatus([...channels].filter((channel) => channel.readyState === "open").length);
    const send = (channel: RTCDataChannel, update: Uint8Array) => {
        // ponytail: cap queued updates for small rooms; add bufferedAmount backpressure for bulk documents.
        if (update.length + channel.bufferedAmount > 8 * 1024 * 1024) {
            channel.close();
            onStatus(0, "Update exceeds the 8 MiB connection limit; reduce the document and pair again");
            return;
        }
        for (let offset = 0; offset < update.length; offset += 12000) {
            const chunk = update.subarray(offset, offset + 12000);
            const frame = new Uint8Array(chunk.length + 1);
            frame[0] = offset + chunk.length === update.length ? 1 : 0;
            frame.set(chunk, 1);
            channel.send(frame);
        }
    };
    const broadcast = (update: Uint8Array, origin: unknown) => {
        for (const channel of channels) if (channel !== origin && channel.readyState === "open") send(channel, update);
    };
    doc.on("update", broadcast);
    const attach = (channel: RTCDataChannel) => {
        channels.add(channel);
        channel.binaryType = "arraybuffer";
        let chunks: Uint8Array[] = [];
        let size = 0;
        channel.onopen = () => { send(channel, Y.encodeStateAsUpdate(doc)); status(); };
        channel.onclose = () => { channels.delete(channel); status(); };
        channel.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
            try {
                if (!(data instanceof ArrayBuffer) || data.byteLength < 2) throw new Error("Invalid update");
                const frame = new Uint8Array(data);
                size += frame.length - 1;
                if (size > 8 * 1024 * 1024 || frame[0]! > 1) throw new Error("Update too large or invalid");
                chunks.push(frame.subarray(1));
                if (frame[0] === 1) {
                    const update = new Uint8Array(size);
                    let offset = 0;
                    for (const chunk of chunks) { update.set(chunk, offset); offset += chunk.length; }
                    chunks = []; size = 0;
                    Y.applyUpdate(doc, update, channel);
                }
            } catch { channel.close(); }
        };
    };
    const createPeer = (id: string) => {
        const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
        connections.set(id, peer);
        peer.ondatachannel = ({ channel }) => attach(channel);
        peer.onconnectionstatechange = () => {
            if (peer.connectionState === "failed") {
                peer.onconnectionstatechange = null;
                peer.close(); connections.delete(id);
                onStatus([...channels].filter((channel) => channel.readyState === "open").length, "Connection failed. Try a new invitation or another network; some networks require a TURN relay.");
            }
        };
        return peer;
    };
    const localDescription = async (peer: RTCPeerConnection, description: RTCSessionDescriptionInit) => {
        await peer.setLocalDescription(description);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { peer.onicegatheringstatechange = null; reject(new Error("Connection candidates timed out; try a new invitation")); }, 20000);
            const check = () => {
                if (peer.iceGatheringState === "complete") { clearTimeout(timer); peer.onicegatheringstatechange = null; resolve(); }
            };
            peer.onicegatheringstatechange = check;
            check();
        });
        return peer.localDescription!.toJSON();
    };
    return {
        doc, text, persistence,
        async invite(base: string) {
            for (const [id, peer] of connections) if (peer.signalingState === "have-local-offer") { peer.close(); connections.delete(id); }
            const id = crypto.randomUUID();
            const peer = createPeer(id);
            attach(peer.createDataChannel("drawdsl"));
            const description = await localDescription(peer, await peer.createOffer());
            return buildPairingLink(base, { roomId, id, description });
        },
        async answer(base: string, pairing: Pairing) {
            const peer = createPeer(pairing.id);
            await peer.setRemoteDescription(pairing.description);
            const description = await localDescription(peer, await peer.createAnswer());
            return buildPairingLink(base, { roomId, id: pairing.id, description });
        },
        async accept(link: string) {
            const pairing = readPairingLink(link);
            if (!pairing || pairing.roomId !== roomId || pairing.description.type !== "answer") throw new Error("Paste an answer link for this session");
            const peer = connections.get(pairing.id);
            if (!peer || peer.signalingState !== "have-local-offer") throw new Error("This invitation is expired or already used; create a new invitation");
            await peer.setRemoteDescription(pairing.description);
        },
        destroy() {
            doc.off("update", broadcast);
            for (const channel of channels) channel.close();
            for (const peer of connections.values()) peer.close();
            void persistence.destroy();
            doc.destroy();
        },
    };
}
