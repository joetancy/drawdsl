import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const VALID = 'aws:lambda handler "Handler"\n';
const INVALID = "core:nosuch thing\n";

type Result = { code: number | null; stdout: string; stderr: string };

function runCli(args: string[], cwd: string): Promise<Result> {
    return new Promise((resolve) => {
        execFile(
            process.execPath,
            ["--import", "tsx", join(cwd, "src/drawdsl.ts"), ...args],
            { cwd },
            (error, stdout, stderr) => {
                const code = error && typeof (error as { code?: unknown }).code === "number"
                    ? (error as { code: number }).code
                    : 0;
                resolve({ code, stdout: String(stdout), stderr: String(stderr) });
            },
        );
    });
}

async function withTemp(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "drawdsl-cli-"));
    try {
        await fn(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

const repoRoot = new URL("..", import.meta.url).pathname;

test("cli generates xml, checks, and formats via subprocesses", async () => {
    await withTemp(async (dir) => {
        const input = join(dir, "in.drawdsl");
        const output = join(dir, "out.drawio");
        await writeFile(input, VALID, "utf8");

        const generated = await runCli([input, output], repoRoot);
        assert.equal(generated.code, 0);
        assert.match(generated.stdout, /Created/);
        assert.match(await readFile(output, "utf8"), /<mxfile/);

        const checked = await runCli(["--check", input], repoRoot);
        assert.equal(checked.code, 0);
        assert.match(checked.stdout, /Valid/);

        const formatted = await runCli(["--format", input], repoRoot);
        assert.equal(formatted.code, 0);
        assert.ok(formatted.stdout.includes("aws:lambda handler"));

        const before = await readFile(input, "utf8");
        const writeFormatted = await runCli(["--format", "--write", input], repoRoot);
        assert.equal(writeFormatted.code, 0);
        assert.match(writeFormatted.stdout, /Formatted/);
        assert.ok((await readFile(input, "utf8")).length >= before.length);
    });
});

test("cli failures use exit 1 and leave files untouched", async () => {
    await withTemp(async (dir) => {
        const input = join(dir, "bad.drawdsl");
        const output = join(dir, "out.drawio");
        await writeFile(input, INVALID, "utf8");
        await writeFile(output, "ORIGINAL", "utf8");

        const generated = await runCli([input, output], repoRoot);
        assert.equal(generated.code, 1);
        assert.match(generated.stderr, /unknown symbol/);
        assert.equal(await readFile(output, "utf8"), "ORIGINAL");

        const checked = await runCli(["--check", input], repoRoot);
        assert.equal(checked.code, 1);

        const formatted = await runCli(["--format", "--write", input], repoRoot);
        assert.equal(formatted.code, 1);
        assert.equal(await readFile(input, "utf8"), INVALID);

        const missing = await runCli(["--check", join(dir, "missing.drawdsl")], repoRoot);
        assert.equal(missing.code, 1);
    });
});

test("cli usage errors use exit 2", async () => {
    for (const args of [[], ["only-one"], ["--check"], ["--check", "a", "b"], ["--format"], ["--format", "--write"]]) {
        const result = await runCli(args, repoRoot);
        assert.equal(result.code, 2, JSON.stringify(args));
        assert.match(result.stderr, /Usage/);
    }
});
