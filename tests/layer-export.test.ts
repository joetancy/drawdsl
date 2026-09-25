import assert from "node:assert/strict";
import test from "node:test";
import { compileDrawDsl } from "../src/compiler.js";
import { layoutDocument } from "../src/layout/index.js";
import { parseDsl } from "../src/parser.js";
import { renderDrawio, renderMxGraphModel } from "../src/render/drawio.js";
import { resolveSymbol } from "../src/symbols/registry.js";
import type { AstLayer, FlatLayoutNode, RoutedEdge } from "../src/model.js";

const source = `direction right
core:group frontend "Frontend" {
    aws:apigw api "API"
}
core:group backend "Backend" {
    core:group services "Services" {
        aws:lambda handler "Handler"
    }
}
layer requests "Request flow" [color=#2563EB] {
    api --> handler : Invoke
}
layer events "Event flow" [visible=false] {
    handler -.-> api : Notify
}`;

function cell(xml: string, id: string): string {
    const result = xml.split("\n").find((line) => line.includes(`<mxCell id="${id}"`) || line.includes(`<object id="${id}"`));
    assert.ok(result, `Missing cell ${id}`);
    return result;
}

test("compiler exports named root layers and cross-layer endpoints", async () => {
    const xml = await compileDrawDsl(source);
    assert.match(cell(xml, "1"), /<object id="1" label="Architecture" drawdslSource=".*"><mxCell parent="0"\/>/);
    assert.match(cell(xml, "layer:connections"), /value="Connections" parent="0" visible="1"/);
    assert.match(cell(xml, "layer:requests"), /value="Request flow" parent="0" visible="1"/);
    assert.match(cell(xml, "layer:events"), /value="Event flow" parent="0" visible="0"/);
    assert.match(cell(xml, "api"), /vertex="1" parent="frontend"/);
    assert.match(cell(xml, "handler"), /vertex="1" parent="services"/);
    assert.match(cell(xml, "edge:1:api:handler"), /parent="layer:requests" source="api" target="handler"/);
    assert.match(cell(xml, "edge:2:handler:api"), /parent="layer:events" source="handler" target="api"/);
    assert.equal((xml.match(/edge="1"/g) ?? []).length, 2);
});

test("initial visibility changes neither placement nor routing", async () => {
    const hiddenAst = parseDsl(source);
    const shownAst = parseDsl(source.replace("visible=false", "visible=true"));
    const hidden = await layoutDocument(hiddenAst);
    const shown = await layoutDocument(shownAst);
    assert.deepEqual(hidden.nodes, shown.nodes);
    assert.deepEqual(hidden.edges, shown.edges);
    assert.equal(hidden.layers, hiddenAst.layers);
    assert.equal(hidden.edges.length, 2);
    const hiddenXml = renderDrawio(hidden.nodes, hidden.edges, hidden.layers);
    const shownXml = renderDrawio(shown.nodes, shown.edges, shown.layers);
    assert.equal(hiddenXml.replace('visible="0"', 'visible="1"'), shownXml);
});

test("root layers preserve container-relative node geometry and absolute waypoints", () => {
    const group = resolveSymbol({ namespace: "core", name: "group" });
    const text = resolveSymbol({ namespace: "core", name: "text" });
    const nodes: FlatLayoutNode[] = [
        { id: "outer", symbol: group.ref, definition: group.definition, label: "Outer", x: 100, y: 200, width: 200, height: 200, declarationOrder: 0 },
        { id: "a", symbol: text.ref, definition: text.definition, label: "A", parentId: "outer", x: 120, y: 230, width: 40, height: 40, declarationOrder: 1 },
        { id: "b", symbol: text.ref, definition: text.definition, label: "B", x: 500, y: 230, width: 40, height: 40, declarationOrder: 2 },
    ];
    const edges: RoutedEdge[] = [{ id: "edge:1:a:b", source: "a", target: "b", operator: "-->", layerId: "requests", label: "Invoke", points: [{ x: 350, y: 250 }, { x: 350, y: 270 }], declarationOrder: 3 }];
    const layers: AstLayer[] = [{ id: "requests", label: "Requests", visible: false, declarationOrder: 0 }];
    const xml = renderMxGraphModel(nodes, edges, layers);
    assert.match(xml, /x="20.00" y="30.00" width="40.00" height="40.00"/);
    assert.match(xml, /<mxPoint x="350.00" y="250.00"\/>/);
    assert.match(xml, /<mxPoint x="350.00" y="270.00"\/>/);
    assert.match(cell(xml, "edge:1:a:b"), /value="Invoke".*parent="layer:requests"/);
});

test("parallel flows share nodes but have distinct edge and layer cells", async () => {
    const xml = await compileDrawDsl("core:text requests\ncore:text b\nlayer requests {\nrequests --> b\n}\nlayer events {\nrequests -.-> b\n}");
    const ids = [...xml.matchAll(/<mxCell id="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.filter((id) => id === "requests").length, 1);
    assert.ok(ids.includes("layer:requests"));
    assert.equal((xml.match(/vertex="1"/g) ?? []).length, 2);
    assert.equal((xml.match(/edge="1"/g) ?? []).length, 2);
});

test("layer titles use XML escaping rather than HTML label escaping", () => {
    const layers: AstLayer[] = [{ id: "requests", label: 'A & <B> "C"\nD', visible: true, declarationOrder: 0 }];
    const xml = renderMxGraphModel([], [], layers);
    assert.match(cell(xml, "layer:requests"), /value="A &amp; &lt;B&gt; &quot;C&quot;&#xa;D"/);
    assert.doesNotMatch(cell(xml, "layer:requests"), /&amp;amp;/);
});

test("low-level renderers supply Connections and reject missing or duplicate layers", () => {
    const edge: RoutedEdge = { id: "edge:1:a:b", source: "a", target: "b", operator: "-->", points: [], declarationOrder: 0 };
    assert.match(cell(renderMxGraphModel([], [edge]), edge.id), /parent="layer:connections"/);
    assert.throws(() => renderMxGraphModel([], [{ ...edge, layerId: "missing" }]), /Unknown edge layer/);
    const layer: AstLayer = { id: "requests", label: "Requests", visible: true, declarationOrder: 0 };
    assert.throws(() => renderMxGraphModel([], [], [layer, layer]), /Duplicate connection layer/);
});
