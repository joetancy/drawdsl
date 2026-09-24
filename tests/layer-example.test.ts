import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { compileDrawDsl } from "../src/compiler.js";
import { formatDsl } from "../src/formatter.js";
import { parseDsl } from "../src/parser.js";

const run = promisify(execFile);
const example = "examples/flows.drawdsl";

test("the multi-flow example formats, parses and compiles with all layers", async () => {
    const source = await readFile(example, "utf8");
    assert.equal(formatDsl(source), source);
    const ast = parseDsl(source);
    assert.deepEqual(ast.layers.map((layer) => layer.id), ["connections", "requests", "events"]);
    assert.deepEqual(ast.layers.map((layer) => layer.visible), [true, true, false]);
    const xml = await compileDrawDsl(source);
    assert.match(xml, /id="layer:events"[^>]*visible="0"/);
    assert.equal((xml.match(/edge="1"/g) ?? []).length, 6);
});

test("CLI generation and validation preserve named layers", async () => {
    const folder = await mkdtemp(join(tmpdir(), "drawdsl-layers-"));
    try {
        const output = join(folder, "flows.drawio");
        await run(process.execPath, ["--import", "tsx", "src/drawdsl.ts", "--check", example], { timeout: 30_000 });
        await run(process.execPath, ["--import", "tsx", "src/drawdsl.ts", example, output], { timeout: 30_000 });
        const xml = await readFile(output, "utf8");
        assert.match(xml, /parent="layer:requests"/);
        assert.match(xml, /parent="layer:events"/);
        assert.match(xml, /parent="layer:connections"/);
        assert.match(xml, /id="layer:events"[^>]*visible="0"/);
    } finally {
        await rm(folder, { recursive: true, force: true });
    }
});
