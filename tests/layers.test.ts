import assert from "node:assert/strict";
import test from "node:test";
import { DslError } from "../src/model.js";
import { parseDsl, isBlockOpener } from "../src/parser.js";
import { formatDsl } from "../src/formatter.js";
import { computeFoldRegions } from "../src/fold.js";

const nodes = "core:text a \"A\"\ncore:text b \"B\"\ncore:text c \"C\"\n";

function rejects(source: string, message: RegExp, line?: number): void {
    assert.throws(() => parseDsl(source), (error: unknown) => {
        assert.ok(error instanceof DslError);
        assert.match(error.message, message);
        if (line !== undefined) assert.equal(error.line, line);
        return true;
    });
}

test("unassigned edges use the default Connections layer", () => {
    const ast = parseDsl(`${nodes}a --> b\nb --> c [layer=connections]`);
    assert.deepEqual(ast.layers, [{ id: "connections", label: "Connections", visible: true, declarationOrder: -1 }]);
    assert.deepEqual(ast.edges.map((edge) => edge.layerId), ["connections", "connections"]);
});

test("layer blocks assign edge membership and style defaults", () => {
    const ast = parseDsl(`${nodes}color green = #16A\nlayer events "Event flow" [color=green, width=2, visible=false] {\na -.-> b : Change event\nb --> c [color=#ABC, width=3] : Update\n}`);
    assert.equal(ast.nodes.length, 3);
    assert.equal(ast.layers[1]!.label, "Event flow");
    assert.equal(ast.layers[1]!.visible, false);
    assert.equal(ast.edges[0]!.layerId, "events");
    assert.equal(ast.edges[0]!.color, "#1166AA");
    assert.equal(ast.edges[0]!.width, 2);
    assert.equal(ast.edges[1]!.color, "#AABBCC");
    assert.equal(ast.edges[1]!.width, 3);
});

test("inline layer references resolve after parsing and accept explicit overrides", () => {
    const ast = parseDsl(`${nodes}a --> b [layer=requests, width=4]\nlayer requests [color=#123456, width=2] {\nb --> c [layer=requests]\n}`);
    assert.equal(ast.layers[1]!.label, "requests");
    assert.deepEqual(ast.edges.map((edge) => edge.layerId), ["requests", "requests"]);
    assert.deepEqual(ast.edges.map((edge) => edge.color), ["#123456", "#123456"]);
    assert.deepEqual(ast.edges.map((edge) => edge.width), [4, 2]);
});

test("chains inherit a layer and keep side attachments", () => {
    const ast = parseDsl(`${nodes}layer requests [color=#ABC] {\nR:a --> L:b -.-> T:c\n}`);
    assert.deepEqual(ast.edges.map((edge) => edge.layerId), ["requests", "requests"]);
    assert.deepEqual(ast.edges.map((edge) => edge.color), ["#AABBCC", "#AABBCC"]);
    assert.equal(ast.edges[0]!.sourceSide, "right");
    assert.equal(ast.edges[1]!.targetSide, "top");
});

test("layer and node IDs have separate namespaces", () => {
    const ast = parseDsl(`${nodes}layer a {\na --> b\n}\nlayer constructor {\nb --> c\n}`);
    assert.equal(ast.layers[1]!.id, ast.nodes[0]!.id);
    assert.equal(ast.edges[1]!.layerId, "constructor");
});

test("layers are metadata and do not add nodes or change node ownership", () => {
    const source = "core:group services {\ncore:text a\ncore:text b\n}\n";
    const baseline = parseDsl(source);
    const layered = parseDsl(`${source}layer requests {\na --> b\n}`);
    assert.deepEqual(layered.nodes, baseline.nodes);
    assert.deepEqual(layered.layout, baseline.layout);
});

test("formatter and folding recognize layers without treating label braces as blocks", () => {
    const source = `${nodes}layer requests "Request { flow }" { # comment\na --> b : "A { label }"\n}\n`;
    const formatted = formatDsl(source);
    assert.ok(formatted.includes('\n    a --> b : "A { label }"\n'));
    assert.equal(formatDsl(formatted), formatted);
    assert.deepEqual(parseDsl(formatted), parseDsl(source));
    assert.deepEqual(computeFoldRegions(source), [{ start: 3, end: 5 }]);
    assert.equal(isBlockOpener("layer requests {"), true);
    assert.equal(isBlockOpener("layer requests \"Not a block {\""), false);
});

test("layer labels preserve escaped and multiline text", () => {
    const source = nodes + String.raw`layer requests "First\nSecond \"quoted\"" {
a --> b
}`;
    assert.equal(parseDsl(source).layers[1]!.label, 'First\nSecond "quoted"');
    const multiline = `${nodes}layer requests "First\nSecond" {\na --> b\n}`;
    assert.equal(parseDsl(multiline).layers[1]!.label, "First\nSecond");
    assert.equal(parseDsl(formatDsl(multiline)).layers[1]!.label, "First\nSecond");
});

test("unknown, duplicate, reserved and conflicting layer assignments fail", () => {
    rejects(`${nodes}a --> b [layer=missing]`, /unknown edge layer: missing/, 4);
    rejects(`${nodes}layer requests {\n}\nlayer requests {\n}`, /duplicate layer ID/);
    rejects(`${nodes}layer connections {\n}`, /reserved/);
    rejects(`${nodes}a --> b [layer=requests, layer=requests]`, /duplicate edge layer/);
    rejects(`${nodes}a --> b [layer=bad:id]`, /invalid layer ID/);
    rejects(`${nodes}layer requests {\na --> b [layer=connections]\n}`, /conflicts with containing layer/);
});

test("layer scopes reject nodes, directives, nesting and missing closing braces", () => {
    rejects(`${nodes}layer requests {\ncore:text extra\n}`, /only edges are allowed/, 5);
    rejects(`${nodes}layer requests {\ndirection down\n}`, /only edges are allowed/);
    rejects(`${nodes}layer requests {\ncolor green = #123\n}`, /only edges are allowed/);
    rejects(`${nodes}layer requests {\nlayer events {\n}\n}`, /cannot be nested/);
    rejects("core:group services {\nlayer requests {\n}\n}", /must be top-level/);
    rejects(`${nodes}layer requests {\na --> b`, /unclosed layer: requests/, 4);
});

test("layer options reject invalid values and duplicates", () => {
    for (const option of ["visible=yes", "width=0", "color=missing", "unknown=1", "visible=true, visible=false", "width=1, width=2", "color=#123, color=#456"]) {
        rejects(`${nodes}layer requests [${option}] {\n}`, /invalid|must be|duplicate|positive|greater/);
    }
});
