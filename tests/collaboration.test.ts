import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";

test("concurrent DrawDSL edits converge", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const aText = a.getText("drawdsl");
    const bText = b.getText("drawdsl");
    aText.insert(0, "abc");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    aText.insert(1, "X");
    bText.insert(3, "Y");
    const aUpdate = Y.encodeStateAsUpdate(a, Y.encodeStateVector(b));
    const bUpdate = Y.encodeStateAsUpdate(b, Y.encodeStateVector(a));
    Y.applyUpdate(a, bUpdate);
    Y.applyUpdate(b, aUpdate);
    assert.equal(aText.toString(), bText.toString());
    a.destroy();
    b.destroy();
});
