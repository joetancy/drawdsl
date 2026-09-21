import { performance } from "node:perf_hooks";
import process from "node:process";
import { parseDsl } from "../src/parser.js";
import { positionWithElk } from "../src/layout/elk.js";
import { routeDiagram } from "../src/layout/routing.js";
import { renderDrawio } from "../src/render/drawio.js";

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function makeDsl(resources: number, seed: number): string {
    const random = mulberry32(seed);
    const lines = ["direction right", ""];
    const perGroup = 10;
    const groups = Math.max(1, Math.ceil(resources / perGroup));
    const ids: string[] = [];
    let made = 0;
    for (let group = 0; group < groups && made < resources; group += 1) {
        lines.push(`core:group g${group} "Group ${group}" {`);
        const count = Math.min(perGroup, resources - made);
        for (let i = 0; i < count; i += 1) {
            const id = `n${made}`;
            ids.push(id);
            lines.push(`    aws:lambda ${id} "Node ${made}"`);
            made += 1;
        }
        lines.push("}", "");
    }
    for (let i = 1; i < ids.length; i += 1) lines.push(`${ids[i - 1]} --> ${ids[i]}`);
    for (let i = 0; i < Math.floor(ids.length / 4); i += 1) {
        const from = ids[Math.floor(random() * ids.length)]!;
        const to = ids[Math.floor(random() * ids.length)]!;
        if (from !== to) lines.push(`${from} -.-> ${to} : cross`);
    }
    return `${lines.join("\n")}\n`;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(label: string, resources: number): Promise<void> {
    const dsl = makeDsl(resources, 42);
    const parseSamples: number[] = [];
    const placeSamples: number[] = [];
    const routeSamples: number[] = [];
    const renderSamples: number[] = [];
    const totalSamples: number[] = [];
    let nodes = 0;
    let edges = 0;
    // Warm-up.
    for (let i = 0; i < 2; i += 1) {
        const ast = parseDsl(dsl);
        const placed = await positionWithElk(ast, ast.layout);
        const routed = await routeDiagram(placed, ast.edges, ast.layout);
        renderDrawio(placed, routed);
    }
    for (let i = 0; i < 5; i += 1) {
        let start = performance.now();
        const ast = parseDsl(dsl);
        parseSamples.push(performance.now() - start);
        start = performance.now();
        const placed = await positionWithElk(ast, ast.layout);
        placeSamples.push(performance.now() - start);
        start = performance.now();
        const routed = await routeDiagram(placed, ast.edges, ast.layout);
        routeSamples.push(performance.now() - start);
        start = performance.now();
        renderDrawio(placed, routed);
        renderSamples.push(performance.now() - start);
        nodes = placed.length;
        edges = routed.length;
        totalSamples.push(parseSamples[i]! + placeSamples[i]! + routeSamples[i]! + renderSamples[i]!);
    }
    console.log(
        `${label}: nodes=${nodes} edges=${edges} ` +
        `parse=${median(parseSamples).toFixed(1)}ms ` +
        `place=${median(placeSamples).toFixed(1)}ms ` +
        `route=${median(routeSamples).toFixed(1)}ms ` +
        `render=${median(renderSamples).toFixed(1)}ms ` +
        `total=${median(totalSamples).toFixed(1)}ms (median of 5, 2 warm-up)`,
    );
}

console.log(`node=${process.version} platform=${process.platform}-${process.arch}`);
await measure("small ", 25);
await measure("medium", 100);
await measure("large ", 300);
