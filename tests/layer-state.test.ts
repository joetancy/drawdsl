import assert from "node:assert/strict";
import test from "node:test";
import { LayerState } from "../src/layer-state.js";

const defaults = [{ id: "requests", visible: true }, { id: "events", visible: false }];

test("preview state starts from document defaults without mutating them", () => {
    const state = new LayerState();
    state.sync(defaults);
    assert.equal(state.visible("requests"), true);
    assert.equal(state.visible("events"), false);
    state.set("requests", false);
    assert.equal(state.visible("requests"), false);
    assert.equal(defaults[0]!.visible, true);
});

test("explicit choices survive recompilation while untouched layers follow new defaults", () => {
    const state = new LayerState();
    state.sync(defaults);
    state.set("requests", false);
    state.sync([{ id: "requests", visible: true }, { id: "events", visible: true }, { id: "new", visible: false }]);
    assert.equal(state.visible("requests"), false);
    assert.equal(state.visible("events"), true);
    assert.equal(state.visible("new"), false);
});

test("removed IDs lose their overrides before a later reintroduction", () => {
    const state = new LayerState();
    state.sync(defaults);
    state.set("requests", false);
    state.sync([{ id: "events", visible: false }]);
    state.sync(defaults);
    assert.equal(state.visible("requests"), true);
});

test("All flows, Architecture only and reset act on every current layer", () => {
    const state = new LayerState();
    state.sync(defaults);
    state.setAll(true);
    assert.ok(defaults.every((layer) => state.visible(layer.id)));
    state.setAll(false);
    assert.ok(defaults.every((layer) => !state.visible(layer.id)));
    state.reset();
    assert.equal(state.visible("requests"), true);
    assert.equal(state.visible("events"), false);
});

test("loading another document can reset choices even when its IDs are the same", () => {
    const state = new LayerState();
    state.sync(defaults);
    state.setAll(false);
    state.reset();
    state.sync(defaults);
    assert.equal(state.visible("requests"), true);
});

test("unknown and duplicate layer IDs fail without changing existing state", () => {
    const state = new LayerState();
    state.sync(defaults);
    assert.throws(() => state.set("missing", true), /Unknown preview layer/);
    assert.throws(() => state.visible("missing"), /Unknown preview layer/);
    assert.throws(() => state.sync([defaults[0]!, defaults[0]!]), /Duplicate preview layer ID/);
    assert.equal(state.visible("events"), false);
});
