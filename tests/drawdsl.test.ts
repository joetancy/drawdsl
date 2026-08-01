import assert from "node:assert/strict";
import test from "node:test";
import { formatDsl } from "../src/formatter.js";
import { parseDsl } from "../src/parser.js";
import { resolveSymbol } from "../src/symbols/registry.js";
import { renderDrawio } from "../src/render/drawio.js";

test("requires namespaces and resolves aliases", () => {
    const ast = parseDsl('aws:apigw gateway "Gateway"\ncore:text note "Hello"\n gateway --> note');
    assert.equal(ast.nodes[0]?.symbol.name, "apigateway");
    assert.equal(ast.edges.length, 1);
    assert.throws(() => parseDsl("lambda handler"), /must be namespaced/);
});

test("supports bidirectional solid and dashed connections", () => {
    const ast = parseDsl("aws:lambda source\naws:sns target\nsource <--> target\ntarget <-.-> source");
    assert.deepEqual(ast.edges.map((edge) => edge.operator), ["<-->", "<-.->"]);
    assert.throws(() => parseDsl("aws:lambda source\naws:sns target\nsource <-- target"), /unsupported syntax/);
    assert.throws(() => parseDsl("aws:lambda source\naws:sns target\nsource <-.- target"), /unsupported syntax/);

    const lambda = resolveSymbol({ namespace: "aws", name: "lambda" });
    const sns = resolveSymbol({ namespace: "aws", name: "sns" });
    const xml = renderDrawio(
        [
            { id: "source", symbol: lambda.ref, definition: lambda.definition, label: "Source", x: 0, y: 0, width: 80, height: 80, declarationOrder: 0 },
            { id: "target", symbol: sns.ref, definition: sns.definition, label: "Target", x: 200, y: 0, width: 80, height: 80, declarationOrder: 1 },
        ],
        [{ ...ast.edges[0]!, points: [] }],
    );
    assert.match(xml, /startArrow=block/);
    assert.match(xml, /endArrow=block/);
});

test("formatter uses four-space indentation", () => {
    const formatted = formatDsl('aws:cloud cloud "Cloud" {\naws:lambda fn\n}\n');
    assert.match(formatted, /\n {4}aws:lambda fn\n/);
});

test("provider styles retain fully qualified draw.io shapes", () => {
    const { ref, definition } = resolveSymbol({ namespace: "aws", name: "sns" });
    const result = renderDrawio([{ id: "topic", symbol: ref, definition, label: "SNS", x: 0, y: 0, width: 80, height: 80, declarationOrder: 0 }], []);
    assert.match(result, /mxgraph\.aws4\.sns/);
    assert.match(result, /fillColor=#E7157B/);
});

test("AWS cloud and VPC groups keep their borders", () => {
    const cloud = resolveSymbol({ namespace: "aws", name: "cloud" }).definition;
    const vpc = resolveSymbol({ namespace: "aws", name: "vpc" }).definition;
    assert.equal(cloud.drawio.styles?.includes("grStroke=0"), false);
    assert.equal(vpc.drawio.styles?.includes("grStroke=0"), false);
});
