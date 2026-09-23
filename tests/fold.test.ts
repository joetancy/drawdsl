import assert from "node:assert/strict";
import test from "node:test";
import { computeFoldRegions } from "../src/fold.js";

test("fold regions cover nested blocks with physical lines", () => {
    const source = `direction right

aws:cloud cloud "Cloud" {
    aws:region region "R" {
        aws:lambda fn
    }
}

fn --> fn`;
    assert.deepEqual(computeFoldRegions(source), [{ start: 2, end: 6 }, { start: 3, end: 5 }]);
});

test("fold regions ignore braces in labels and comments", () => {
    assert.deepEqual(computeFoldRegions("aws:lambda a\naws:lambda b\na --> b : brace {\n# closing }\n"), []);
    assert.deepEqual(computeFoldRegions('aws:cloud c "C" {\naws:lambda fn\n'), []);
});
