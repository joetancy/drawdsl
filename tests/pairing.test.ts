import assert from "node:assert/strict";
import test from "node:test";
import { buildPairingLink, readPairingLink } from "../src/collaboration/pairing.js";

test("pairing URLs keep descriptions in the fragment and reject invalid input", () => {
    const pairing = { roomId: "room-123", id: "peer-123", description: { type: "offer" as const, sdp: "v=0\r\na=fingerprint:sha-256 A:B\r\n" } };
    const link = buildPairingLink("https://example.com/drawdsl/?room=old#dsl=old", pairing);
    assert.deepEqual(readPairingLink(link), pairing);
    assert.equal(new URL(link).search, "");
    assert.equal(readPairingLink("https://example.com/#dsl=hello"), null);
    assert.throws(() => readPairingLink("https://example.com/#pair=null"), /Invalid/);
    assert.throws(() => readPairingLink("https://example.com/#pair=%7B"), /Invalid/);
    assert.throws(() => readPairingLink("https://example.com/#pair=" + "x".repeat(100001)), /too large/);
});
