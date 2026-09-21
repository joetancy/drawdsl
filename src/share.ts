export const SHARE_VERSION = "1";
export const ENCODED_LIMIT = 1_048_576;
export const DECODED_LIMIT = 2_097_152;

export type ShareKind =
    | { kind: "empty" }
    | { kind: "legacy"; dsl: string }
    | { kind: "compressed"; version: string; payload: string };

export function parseShareHash(hash: string): ShareKind {
    const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const payload = params.get("z");
    // Compressed links take precedence when both forms are present.
    if (payload !== null) return { kind: "compressed", version: params.get("v") ?? "", payload };
    const legacy = params.get("dsl");
    if (legacy !== null) return { kind: "legacy", dsl: legacy };
    return { kind: "empty" };
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
    let normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
        throw new Error("Could not read the shared DrawDSL link (invalid encoding)");
    }
    normalized = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    let binary: string;
    try {
        binary = atob(normalized);
    } catch {
        throw new Error("Could not read the shared DrawDSL link (invalid encoding)");
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, tooLarge: string): Promise<Uint8Array> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limit) {
                await reader.cancel().catch(() => {});
                throw new Error(tooLarge);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

export async function compressDsl(value: string): Promise<string> {
    const input = new TextEncoder().encode(value);
    const compressed = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = await readBounded(compressed, DECODED_LIMIT * 2, "Diagram is too large to share");
    return bytesToBase64Url(bytes);
}

export async function decompressDsl(value: string): Promise<string> {
    if (value.length > ENCODED_LIMIT) throw new Error("Shared link is too large (over 1 MiB encoded)");
    const bytes = base64UrlToBytes(value);
    let decompressed: ReadableStream<Uint8Array>;
    try {
        decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    } catch {
        throw new Error("Could not read the shared DrawDSL link (unsupported compression)");
    }
    let expanded: Uint8Array;
    try {
        expanded = await readBounded(decompressed, DECODED_LIMIT, "Shared link expands to more than 2 MiB");
    } catch (error) {
        if (error instanceof Error && /more than 2 MiB/.test(error.message)) throw error;
        throw new Error("Could not read the shared DrawDSL link", { cause: error });
    }
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(expanded);
    } catch {
        throw new Error("Could not read the shared DrawDSL link (invalid text)");
    }
}

export async function buildShareHash(dslSource: string): Promise<string> {
    const rawHash = `dsl=${encodeURIComponent(dslSource)}`;
    try {
        const compressedHash = `v=${SHARE_VERSION}&z=${await compressDsl(dslSource)}`;
        return compressedHash.length < rawHash.length ? compressedHash : rawHash;
    } catch {
        // Compression Streams are unavailable; raw links remain shareable.
        return rawHash;
    }
}

export async function resolveShareDsl(hash: string): Promise<{ dsl: string | null; error?: string }> {
    const parsed = parseShareHash(hash);
    if (parsed.kind === "empty") return { dsl: null };
    if (parsed.kind === "legacy") return { dsl: parsed.dsl };
    if (parsed.version !== SHARE_VERSION) {
        return { dsl: null, error: `Unsupported shared link version "${parsed.version || "missing"}"` };
    }
    if (!parsed.payload) return { dsl: null, error: "Could not read the shared DrawDSL link" };
    try {
        return { dsl: await decompressDsl(parsed.payload) };
    } catch (error) {
        if (error instanceof Error && /decompression unavailable/i.test(error.message)) {
            return { dsl: null, error: "This compressed link cannot be opened because decompression is unavailable in this browser" };
        }
        return { dsl: null, error: error instanceof Error ? error.message : "Could not read the shared DrawDSL link" };
    }
}
