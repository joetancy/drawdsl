import assert from "node:assert/strict";
import test from "node:test";
import {
    applyFolds,
    computeFoldRegions,
    lineColToOffset,
    mergeDisplayEdit,
    offsetToLineCol,
    remapFolds,
} from "../src/fold.js";

const NESTED = `direction right

aws:cloud cloud "Cloud" {
    aws:region region "R" {
        aws:lambda fn
    }
}

fn --> fn`;

test("fold regions cover nested blocks with physical lines", () => {
    const regions = computeFoldRegions(NESTED);
    assert.deepEqual(regions, [{ start: 2, end: 6 }, { start: 3, end: 5 }]);
});

test("fold regions ignore braces in edge labels, comments, and strings", () => {
    const regions = computeFoldRegions("aws:lambda a\naws:lambda b\na --> b : brace {\n# closing }\n");
    assert.deepEqual(regions, []);
    const unclosed = computeFoldRegions('aws:cloud c "C" {\naws:lambda fn\n');
    assert.deepEqual(unclosed, []);
});

test("applyFolds hides region bodies and maps both directions", () => {
    const regions = computeFoldRegions(NESTED);
    const { text, maps } = applyFolds(NESTED, regions, new Set([2]));
    assert.deepEqual(text.split("\n"), ["direction right", "", 'aws:cloud cloud "Cloud" {', "", "fn --> fn"]);
    assert.deepEqual(maps.displayToFull, [0, 1, 2, 7, 8]);
    assert.equal(maps.fullToDisplay[4], undefined);
    assert.equal(maps.fullToDisplay[8], 4);
});

test("merge keeps hidden lines across visible edits", () => {
    const regions = computeFoldRegions(NESTED);
    const folded = new Set([2]);
    const { text, maps } = applyFolds(NESTED, regions, folded);
    const edited = text.replace("direction right", "direction down");
    const merge = mergeDisplayEdit(NESTED, maps.displayToFull, text, edited);
    assert.ok(merge.full.includes("aws:lambda fn"));
    assert.ok(merge.full.startsWith("direction down"));
    const next = remapFolds(regions, folded, merge.fullStart, merge.fullEnd, merge.insertedCount, computeFoldRegions(merge.full));
    assert.deepEqual([...next], [2]);
});

test("merge shifts folds after inserted lines and drops overlapping ones", () => {
    const source = 'aws:cloud c "C" {\n    aws:lambda fn\n}\n';
    const regions = computeFoldRegions(source);
    const folded = new Set([0]);
    const { text, maps } = applyFolds(source, regions, folded);
    assert.deepEqual(text.split("\n"), ['aws:cloud c "C" {', ""]);
    const inserted = `# note\n${text}`;
    const merge = mergeDisplayEdit(source, maps.displayToFull, text, inserted);
    const next = remapFolds(regions, folded, merge.fullStart, merge.fullEnd, merge.insertedCount, computeFoldRegions(merge.full));
    assert.deepEqual([...next], [1]);

    const openerDeleted = "";
    const drop = mergeDisplayEdit(source, maps.displayToFull, text, openerDeleted);
    const dropped = remapFolds(regions, folded, drop.fullStart, drop.fullEnd, drop.insertedCount, computeFoldRegions(drop.full));
    assert.deepEqual([...dropped], []);
    assert.ok(drop.full.includes("aws:lambda fn"));
});

test("offset helpers round-trip", () => {
    const lines = ["ab", "cde", ""];
    assert.deepEqual(offsetToLineCol(lines, 4), { line: 1, col: 1 });
    assert.equal(lineColToOffset(lines, 1, 1), 4);
    assert.equal(lineColToOffset(lines, 99, 99), 8);
});
