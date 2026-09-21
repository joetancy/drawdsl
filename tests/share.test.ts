import assert from "node:assert/strict";
import test from "node:test";
import {
    buildShareHash,
    compressDsl,
    decompressDsl,
    parseShareHash,
    resolveShareDsl,
} from "../src/share.js";

test("share round trips preserve unicode, backslashes, newlines, and empty docs", async () => {
    for (const dsl of [
        "",
        "aws:lambda fn \"héllo 🌍\"\nfn --> fn",
        'aws:lambda slash "a\\\\nb"\nline2\nline3',
        "direction right\n\naws:lambda a\n",
    ]) {
        const hash = await buildShareHash(dsl);
        const { dsl: resolved, error } = await resolveShareDsl(`#${hash}`);
        assert.equal(error, undefined);
        assert.equal(resolved, dsl);
    }
});

test("legacy links are preserved and compressed links take precedence", async () => {
    assert.deepEqual(parseShareHash("#dsl=hello%20world"), { kind: "legacy", dsl: "hello world" });
    const compressed = await compressDsl("aws:lambda fn");
    const both = parseShareHash(`#dsl=legacy&v=1&z=${compressed}`);
    assert.equal(both.kind, "compressed");
    const legacy = await resolveShareDsl("#dsl=hello%20world");
    assert.equal(legacy.dsl, "hello world");
});

test("unsupported versions and bad payloads fail persistently", async () => {
    const badVersion = await resolveShareDsl("#v=999&z=abc");
    assert.equal(badVersion.dsl, null);
    assert.match(badVersion.error ?? "", /Unsupported shared link version/);

    const badEncoding = await resolveShareDsl("#v=1&z=!!!");
    assert.equal(badEncoding.dsl, null);
    assert.match(badEncoding.error ?? "", /Could not read/);

    const badGzip = await resolveShareDsl(`#v=1&z=${btoa("not-gzip").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`);
    assert.equal(badGzip.dsl, null);
    assert.match(badGzip.error ?? "", /Could not read/);
});

test("oversized payloads are rejected", async () => {
    const tooLong = `v=1&z=${"a".repeat(1_048_577)}`;
    const encoded = await resolveShareDsl(`#${tooLong}`);
    assert.equal(encoded.dsl, null);
    assert.match(encoded.error ?? "", /too large/i);

    // Valid gzip that expands beyond the limit.
    const big = await compressDsl("a".repeat(3_000_000));
    const expanded = await resolveShareDsl(`#v=1&z=${big}`);
    assert.equal(expanded.dsl, null);
    assert.match(expanded.error ?? "", /more than 2 MiB/);
});

test("decompression stops at the limit instead of buffering everything", async () => {
    // A highly compressible payload stays small encoded but huge decoded.
    const payload = await compressDsl("x".repeat(3_000_000));
    assert.ok(payload.length < 1_048_576);
    await assert.rejects(() => decompressDsl(payload), /more than 2 MiB/);
});
