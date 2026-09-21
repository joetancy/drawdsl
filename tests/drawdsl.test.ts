import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatDsl } from "../src/formatter.js";
import { parseDsl } from "../src/parser.js";
import { qualifiedCandidates, resolveSymbol } from "../src/symbols/registry.js";
import { renderDrawio } from "../src/render/drawio.js";
import { layoutDocument } from "../src/layout/index.js";
import { enforceGlobalEdgeSpacing } from "../src/layout/routing.js";
import { DEFAULT_LAYOUT_CONFIG } from "../src/config.js";

test("requires namespaces and resolves aliases", () => {
    const ast = parseDsl('aws:apigw gateway "Gateway"\ncore:text note "Hello"\n gateway --> note');
    assert.equal(ast.nodes[0]?.symbol.name, "apigateway");
    assert.equal(ast.edges.length, 1);
    assert.throws(() => parseDsl("lambda handler"), /must be namespaced/);
    assert.doesNotThrow(() => parseDsl("layout elk\naws:lambda handler"));
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

test("edge endpoint selectors pin routes to a node side", async () => {
    const ast = parseDsl(`aws:lambda sender
aws:sqs queue
R:sender --> B:queue`);
    const edge = ast.edges[0]!;
    assert.equal(edge.source, "sender");
    assert.equal(edge.target, "queue");
    assert.equal(edge.sourceSide, "right");
    assert.equal(edge.targetSide, "bottom");

    const layout = await layoutDocument(ast);
    const queue = layout.nodes.find((node) => node.id === "queue")!;
    const routed = layout.edges[0]!;
    assert.ok(Math.abs(routed.targetPoint!.x - (queue.x + queue.width / 2)) < 0.001);
    assert.ok(Math.abs(routed.targetPoint!.y - (queue.y + queue.height)) < 0.001);
    const points = [routed.sourcePoint!, ...routed.points, routed.targetPoint!];
    const distance = (first: { x: number; y: number }, second: { x: number; y: number }): number => Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
    assert.ok(distance(points[0]!, points[1]!) >= DEFAULT_LAYOUT_CONFIG.edgeEndpointClearance);
    assert.ok(distance(points.at(-2)!, points.at(-1)!) >= DEFAULT_LAYOUT_CONFIG.edgeEndpointClearance);

    const xml = renderDrawio(layout.nodes, layout.edges);
    assert.match(xml, /exitX=1\.0000;exitY=0\.5000/);
    assert.match(xml, /entryX=0\.5000;entryY=1\.0000/);
});

test("formatter uses four-space indentation", () => {
    const formatted = formatDsl('aws:cloud cloud "Cloud" {\naws:lambda fn\n}\n');
    assert.match(formatted, /\n {4}aws:lambda fn\n/);
});

test("core text nodes may omit an ID", () => {
    const ast = parseDsl('core:text "First note"\ncore:text "Second note"');
    assert.deepEqual(ast.nodes.map((node) => node.label), ["First note", "Second note"]);
    assert.match(ast.nodes[0]?.id ?? "", /^__core_text_\d+$/);
    assert.match(ast.nodes[1]?.id ?? "", /^__core_text_\d+$/);
    assert.notEqual(ast.nodes[0]?.id, ast.nodes[1]?.id);
});

test("provider styles retain fully qualified draw.io shapes", () => {
    const { ref, definition } = resolveSymbol({ namespace: "aws", name: "sns" });
    const result = renderDrawio([{ id: "topic", symbol: ref, definition, label: "SNS", x: 0, y: 0, width: 80, height: 80, declarationOrder: 0 }], []);
    assert.match(result, /mxgraph\.aws4\.sns/);
    assert.match(result, /fillColor=#E7157B/);

    const sqs = resolveSymbol({ namespace: "aws", name: "sqs" });
    assert.equal(sqs.definition.drawio.resIcon, "mxgraph.aws4.sqs");

    const nlb = resolveSymbol({ namespace: "aws", name: "nlb" });
    const alb = resolveSymbol({ namespace: "aws", name: "alb" });
    assert.equal(nlb.definition.drawio.shape, "mxgraph.aws4.network_load_balancer");
    assert.equal(alb.definition.drawio.shape, "mxgraph.aws4.application_load_balancer");
    assert.equal(nlb.definition.drawio.fill, "#8C4FFF");
    assert.equal(alb.definition.drawio.fill, "#8C4FFF");
});

test("AWS general icons render without resource tiles", () => {
    for (const name of ["client", "corporate_data_center", "general", "mobile_client", "traditional_server", "user", "users"]) {
        const { definition } = resolveSymbol({ namespace: "aws", name });
        assert.equal(definition.drawio.shape, `mxgraph.aws4.${name}`);
        assert.equal(definition.drawio.resIcon, undefined);
        assert.equal(definition.drawio.fill, "#232F3D");
        assert.equal(definition.drawio.stroke, "none");
    }
});

test("core images render as image cells without a visible label", () => {
    const ast = parseDsl('core:image reference "https://example.com/reference.png"');
    const image = ast.nodes[0]!;
    const xml = renderDrawio([{ id: image.id, symbol: image.symbol, definition: image.definition, label: image.label, x: 0, y: 0, width: 160, height: 80, declarationOrder: 0 }], []);
    assert.match(xml, /shape=image/);
    assert.match(xml, /imageAspect=1/);
    assert.match(xml, /image=https:\/\/example.com\/reference.png/);
    assert.match(xml, /value=""/);
});

test("anonymous spacers reserve layout space without rendering", async () => {
    const ast = parseDsl(`core:layout row {
    grid-columns 3
    aws:lambda first
    core:spacer
    aws:lambda third
}
core:spacer`);
    const spacers = ast.nodes.flatMap((node) => [node, ...node.children]).filter((node) => node.symbol.name === "spacer");
    assert.equal(spacers.length, 2);
    assert.notEqual(spacers[0]?.id, spacers[1]?.id);
    assert.match(spacers[0]?.id ?? "", /^__core_spacer_\d+$/);
    assert.throws(() => parseDsl("core:spacer\naws:lambda fn\n__core_spacer_1 --> fn"), /Invisible node cannot be an edge endpoint/);

    const layout = await layoutDocument(ast);
    const spacer = layout.nodes.find((node) => node.id === spacers[0]?.id)!;
    assert.equal(spacer.width, 80);
    const xml = renderDrawio(layout.nodes, layout.edges);
    assert.doesNotMatch(xml, /__core_spacer_/);
});

test("AWS cloud and VPC groups keep their borders", () => {
    const cloud = resolveSymbol({ namespace: "aws", name: "cloud" }).definition;
    const vpc = resolveSymbol({ namespace: "aws", name: "vpc" }).definition;
    const region = resolveSymbol({ namespace: "aws", name: "region" }).definition;
    assert.equal(cloud.drawio.styles?.includes("grStroke=0"), false);
    assert.equal(vpc.drawio.styles?.includes("grStroke=0"), false);
    assert.equal(region.drawio.styles?.includes("grIcon=mxgraph.aws4.group_region"), true);
    assert.equal(region.drawio.styles?.includes("dashed=1"), true);
    assert.equal(region.drawio.stroke, "#00A4A6");
});

test("layout-only grids accept connected children and stay invisible in draw.io", async () => {
    const ast = parseDsl(`core:group workers {
    core:layout columns {
        grid-columns 2
        node-spacing 140
        aws:lambda worker_a
        aws:lambda worker_b
        aws:lambda worker_c
        aws:lambda worker_d
    }
}
worker_a --> worker_d`);
    const columns = ast.nodes[0]?.children[0];
    assert.equal(columns?.layout?.gridColumns, 2);
    assert.equal(columns?.definition.layoutOnly, true);
    assert.throws(() => parseDsl("grid-columns 3"), /must be inside a container/);
    assert.throws(() => parseDsl("core:group workers {\n    grid-columns 2\n}"), /requires at least one child/);
    assert.throws(() => parseDsl("core:layout structure {\n    aws:lambda worker\n}\nstructure --> worker"), /Layout-only container cannot be an edge endpoint/);

    const layout = await layoutDocument(ast);
    const workers = layout.nodes.filter((node) => node.parentId === "columns");
    assert.equal(new Set(workers.map((node) => node.x)).size, 2);
    assert.equal(new Set(workers.map((node) => node.y)).size, 2);
    const workerA = layout.nodes.find((node) => node.id === "worker_a")!;
    const workerB = layout.nodes.find((node) => node.id === "worker_b")!;
    assert.equal(workerB.x - (workerA.x + workerA.width), 140);
    const group = layout.nodes.find((node) => node.id === "workers")!;
    for (const worker of workers) {
        assert.ok(worker.x >= group.x && worker.y >= group.y);
        assert.ok(worker.x + worker.width <= group.x + group.width);
        assert.ok(worker.y + worker.height <= group.y + group.height);
    }
    const route = layout.edges[0]!;
    assert.ok(route.sourcePoint && route.targetPoint);
    const routePoints = [route.sourcePoint!, ...route.points, route.targetPoint!];
    for (let index = 1; index < routePoints.length; index += 1) {
        const previous = routePoints[index - 1]!;
        const current = routePoints[index]!;
        assert.ok(previous.x === current.x || previous.y === current.y);
    }
    const xml = renderDrawio(layout.nodes, layout.edges);
    assert.doesNotMatch(xml, /id="columns"/);
    assert.match(xml, /parent="workers"/);
    assert.match(xml, /exitPerimeter=1/);
});

test("grid columns preserve declaration order and center mixed-size groups", async () => {
    const ast = parseDsl(`core:layout application_grid {
    grid-columns 3
    core:layout left {
        grid-columns 1
        aws:lambda left_a
    }
    core:layout centre {
        grid-columns 1
        aws:lambda centre_a
        aws:lambda centre_b
        aws:lambda centre_c
    }
    core:layout right {
        grid-columns 1
        aws:lambda right_a
        aws:lambda right_b
    }
}`);
    const layout = await layoutDocument(ast);
    const left = layout.nodes.find((node) => node.id === "left")!;
    const centre = layout.nodes.find((node) => node.id === "centre")!;
    const right = layout.nodes.find((node) => node.id === "right")!;
    assert.ok(left.x < centre.x && centre.x < right.x);
    assert.equal(left.y + left.height / 2, centre.y + centre.height / 2);
    assert.equal(centre.y + centre.height / 2, right.y + right.height / 2);
    assert.equal(centre.x - (left.x + left.width), DEFAULT_LAYOUT_CONFIG.nodeSpacing.container);
    assert.equal(right.x - (centre.x + centre.width), DEFAULT_LAYOUT_CONFIG.nodeSpacing.container);
});

test("containers use square-ish grids unless a local direction is explicit", async () => {
    const ast = parseDsl(`core:group automatic {
    aws:lambda one
    aws:lambda two
    aws:lambda three
    aws:lambda four
    aws:lambda five
    aws:lambda six
}
core:group nine {
    aws:lambda a
    aws:lambda b
    aws:lambda c
    aws:lambda d
    aws:lambda e
    aws:lambda f
    aws:lambda g
    aws:lambda h
    aws:lambda i
}
core:group directed {
    direction down
    aws:lambda first
    aws:lambda second
    first --> second
}`);
    const layout = await layoutDocument(ast);
    const automatic = layout.nodes.filter((node) => node.parentId === "automatic");
    assert.equal(new Set(automatic.map((node) => node.x)).size, 3);
    assert.equal(new Set(automatic.map((node) => node.y)).size, 2);
    const nine = layout.nodes.filter((node) => node.parentId === "nine");
    assert.equal(new Set(nine.map((node) => node.x)).size, 3);
    assert.equal(new Set(nine.map((node) => node.y)).size, 3);
    const first = layout.nodes.find((node) => node.id === "first")!;
    const second = layout.nodes.find((node) => node.id === "second")!;
    assert.equal(first.x, second.x);
    assert.ok(first.y < second.y);
});

test("Libavoid routes around unrelated visible containers", async () => {
    const ast = parseDsl(`core:layout row {
    grid-columns 3
    core:group left {
        aws:lambda source
    }
    core:group blocker {
        aws:sqs obstacle
    }
    core:group right {
        aws:lambda target
    }
}
source --> target`);
    const layout = await layoutDocument(ast);
    const blocker = layout.nodes.find((node) => node.id === "blocker")!;
    const edge = layout.edges[0]!;
    const points = [edge.sourcePoint!, ...edge.points, edge.targetPoint!];
    const crossesInterior = (start: { x: number; y: number }, end: { x: number; y: number }): boolean => {
        if (start.x === end.x) {
            return start.x > blocker.x && start.x < blocker.x + blocker.width
                && Math.max(start.y, end.y) > blocker.y && Math.min(start.y, end.y) < blocker.y + blocker.height;
        }
        return start.y > blocker.y && start.y < blocker.y + blocker.height
            && Math.max(start.x, end.x) > blocker.x && Math.min(start.x, end.x) < blocker.x + blocker.width;
    };
    for (let index = 1; index < points.length; index += 1) {
        assert.equal(crossesInterior(points[index - 1]!, points[index]!), false);
    }
});

test("global edge spacing does not add bends solely to separate routes", () => {
    const edges = [
        { id: "first", source: "source_a", target: "target_a", operator: "-->" as const, declarationOrder: 0 },
        { id: "second", source: "source_b", target: "target_b", operator: "-->" as const, declarationOrder: 1 },
    ];
    const routes = new Map([
        ["first", { sourcePoint: { x: 0, y: 0 }, bendPoints: [{ x: 0, y: 50 }, { x: 200, y: 50 }], targetPoint: { x: 200, y: 100 } }],
        ["second", { sourcePoint: { x: 20, y: 0 }, bendPoints: [{ x: 20, y: 62 }, { x: 180, y: 62 }], targetPoint: { x: 180, y: 100 } }],
    ]);

    enforceGlobalEdgeSpacing([], edges, routes, DEFAULT_LAYOUT_CONFIG);

    assert.equal(routes.get("first")!.bendPoints.length, 2);
    assert.equal(routes.get("second")!.bendPoints.length, 2);
});

test("global edge spacing preserves a clear straight route", () => {
    const edges = [
        { id: "bent", source: "source_a", target: "target_a", operator: "-->" as const, declarationOrder: 0 },
        { id: "straight", source: "source_b", target: "target_b", operator: "-->" as const, declarationOrder: 1 },
    ];
    const routes = new Map([
        ["bent", { sourcePoint: { x: 60, y: -80 }, bendPoints: [{ x: 60, y: 0 }, { x: 140, y: 0 }], targetPoint: { x: 140, y: -80 } }],
        ["straight", { sourcePoint: { x: 0, y: 12 }, bendPoints: [{ x: 40, y: 12 }, { x: 40, y: 32 }, { x: 160, y: 32 }, { x: 160, y: 12 }], targetPoint: { x: 200, y: 12 } }],
    ]);
    enforceGlobalEdgeSpacing([], edges, routes, DEFAULT_LAYOUT_CONFIG);
    assert.deepEqual(routes.get("straight")!.bendPoints, []);
});

test("route cleanup removes offset jogs while preserving ports, obstacles, and separate edges", () => {
    const symbol = resolveSymbol({ namespace: "aws", name: "lambda" });
    for (const vertical of [false, true]) {
        const point = (x: number, y: number) => vertical ? { x: y, y: x } : { x, y };
        const nodes = [
            { id: "source", symbol: symbol.ref, definition: symbol.definition, label: "Source", ...point(0, 0), width: 80, height: 80, declarationOrder: 0 },
            { id: "target", symbol: symbol.ref, definition: symbol.definition, label: "Target", ...point(300, 0), width: 80, height: 80, declarationOrder: 1 },
        ];
        const edge = { id: "edge", source: "source", target: "target", operator: "-->" as const, declarationOrder: 0 };
        for (const fixed of [false, true]) {
            const routes = new Map([[edge.id, { sourcePoint: point(80, 30), bendPoints: [point(180, 30), point(180, 40)], targetPoint: point(300, 40) }]]);
            const pinned = { ...edge, sourceSide: vertical ? "bottom" as const : "right" as const, targetSide: vertical ? "top" as const : "left" as const };
            enforceGlobalEdgeSpacing(nodes, [fixed ? pinned : edge], routes, DEFAULT_LAYOUT_CONFIG);
            assert.equal(routes.get(edge.id)!.bendPoints.length, fixed ? 2 : 0);
            assert.deepEqual(routes.get(edge.id)!.targetPoint, point(300, fixed ? 40 : 30));
        }
        const blocker = { ...nodes[0]!, id: "blocker", ...point(160, 0), width: vertical ? 80 : 40, height: vertical ? 40 : 80 };
        const detour = [point(120, 30), point(120, -60), point(260, -60), point(260, 40)];
        const routes = new Map([[edge.id, { sourcePoint: point(80, 30), bendPoints: detour, targetPoint: point(300, 40) }]]);
        enforceGlobalEdgeSpacing([...nodes, blocker], [edge], routes, DEFAULT_LAYOUT_CONFIG);
        assert.deepEqual(routes.get(edge.id)!.bendPoints, detour);

        const other = { ...edge, id: "other", declarationOrder: 1 };
        const shared = new Map([
            [edge.id, { sourcePoint: point(80, 30), bendPoints: [point(180, 30), point(180, 40)], targetPoint: point(300, 40) }],
            [other.id, { sourcePoint: point(80, 30), bendPoints: [], targetPoint: point(300, 30) }],
        ]);
        enforceGlobalEdgeSpacing(nodes, [edge, other], shared, DEFAULT_LAYOUT_CONFIG);
        assert.deepEqual(shared.get(edge.id)!.sourcePoint, point(80, 40));
        assert.deepEqual(shared.get(edge.id)!.bendPoints, []);
    }
    const edge = { id: "internal", source: "source", target: "target", operator: "-->" as const, declarationOrder: 0 };
    const routes = new Map([[edge.id, { sourcePoint: { x: 0, y: 0 }, bendPoints: [{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 110 }, { x: 300, y: 110 }], targetPoint: { x: 300, y: 200 } }]]);
    enforceGlobalEdgeSpacing([], [edge], routes, DEFAULT_LAYOUT_CONFIG);
    assert.equal(routes.get(edge.id)!.bendPoints.length, 2);
});

test("edges clear visible group borders without blocking perpendicular crossings", () => {
    const group = resolveSymbol({ namespace: "core", name: "group" });
    const icon = resolveSymbol({ namespace: "aws", name: "lambda" });
    for (const vertical of [false, true]) {
        for (const mirrored of [false, true]) {
            const point = (x: number, y: number) => vertical ? { x: mirrored ? -y : y, y: x } : { x, y: mirrored ? -y : y };
            const rect = (x: number, y: number, width: number, height: number) => {
                const a = point(x, y);
                const b = point(x + width, y + height);
                return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
            };
            const container = { id: "group", symbol: group.ref, definition: group.definition, label: "Group", ...rect(100, 100, 300, 300), declarationOrder: 0 };
            const source = { id: "source", symbol: icon.ref, definition: icon.definition, label: "Source", ...rect(-40, -80, 80, 80), declarationOrder: 1 };
            const target = { ...source, id: "target", parentId: "group", ...rect(260, 200, 80, 80), declarationOrder: 2 };
            const edge = { id: "edge", source: "source", target: "target", operator: "-->" as const, declarationOrder: 0 };
            for (const hidden of [false, true]) {
                const nodes = [{ ...container, definition: { ...container.definition, layoutOnly: hidden } }, source, target];
                const routes = new Map([[edge.id, { sourcePoint: point(0, 0), bendPoints: [point(0, 100), point(300, 100)], targetPoint: point(300, 200) }]]);
                enforceGlobalEdgeSpacing(nodes, [edge], routes, DEFAULT_LAYOUT_CONFIG);
                assert.deepEqual(routes.get(edge.id)!.bendPoints, [point(0, hidden ? 100 : mirrored ? 140 : 60), point(300, hidden ? 100 : mirrored ? 140 : 60)]);
                assert.deepEqual(routes.get(edge.id)!.sourcePoint, point(0, 0));
                assert.deepEqual(routes.get(edge.id)!.targetPoint, point(300, 200));
                // Straightening and lane spacing must not put the edge back on the border.
                enforceGlobalEdgeSpacing(nodes, [edge], routes, DEFAULT_LAYOUT_CONFIG);
                assert.deepEqual(routes.get(edge.id)!.bendPoints, [point(0, hidden ? 100 : mirrored ? 140 : 60), point(300, hidden ? 100 : mirrored ? 140 : 60)]);
            }
            const blocker = { ...source, id: "blocker", ...rect(100, -20, 100, 80) };
            const routes = new Map([[edge.id, { sourcePoint: point(0, 0), bendPoints: [point(0, 100), point(300, 100)], targetPoint: point(300, 200) }]]);
            enforceGlobalEdgeSpacing([container, source, target, blocker], [edge], routes, DEFAULT_LAYOUT_CONFIG);
            assert.deepEqual(routes.get(edge.id)!.bendPoints, [point(0, 140), point(300, 140)]);

            const crossing = new Map([[edge.id, { sourcePoint: point(300, 0), bendPoints: [], targetPoint: point(300, 200) }]]);
            enforceGlobalEdgeSpacing([container, { ...source, ...rect(260, -80, 80, 80) }, target], [edge], crossing, DEFAULT_LAYOUT_CONFIG);
            assert.deepEqual(crossing.get(edge.id)!.bendPoints, []);
        }
    }
});

test("border cleanup uses narrow lanes and ignores unchanged shared segments", () => {
    const group = resolveSymbol({ namespace: "core", name: "group" });
    const nodes = [100, 140].map((y, i) => ({ id: `group${i}`, symbol: group.ref, definition: group.definition, label: "", x: 100, y, width: 300, height: 300, declarationOrder: i }));
    const edge = { id: "edge", source: "source", target: "target", operator: "-->" as const, declarationOrder: 0 };
    // The source belongs to both nested groups, so their borders can be crossed.
    const icon = resolveSymbol({ namespace: "aws", name: "lambda" });
    const source = { id: "source", symbol: icon.ref, definition: icon.definition, label: "", parentId: "group1", x: 260, y: 220, width: 80, height: 80, declarationOrder: 2 };
    const other = { ...edge, id: "other", declarationOrder: 1 };
    const routes = new Map([
        [edge.id, { sourcePoint: { x: 300, y: 220 }, bendPoints: [{ x: 300, y: 100 }, { x: 0, y: 100 }], targetPoint: { x: 0, y: 0 } }],
        [other.id, { sourcePoint: { x: 300, y: 220 }, bendPoints: [], targetPoint: { x: 300, y: 180 } }],
    ]);
    // An obstacle blocks the outer lane, leaving the 40-unit gap between borders.
    const blocker = { ...source, id: "blocker", parentId: undefined, x: 100, y: -20, width: 100, height: 80 };
    const innerBlocker = { ...blocker, id: "innerBlocker", y: 180 };
    enforceGlobalEdgeSpacing([{ ...nodes[0]!, height: 400 }, { ...nodes[1]!, parentId: "group0" }, source, blocker, innerBlocker], [edge, other], routes, DEFAULT_LAYOUT_CONFIG);
    assert.deepEqual(routes.get(edge.id)!.bendPoints, [{ x: 300, y: 120 }, { x: 0, y: 120 }]);
});

test("straightening runs after border clearance moves the final lane", () => {
    const group = resolveSymbol({ namespace: "core", name: "group" });
    const icon = resolveSymbol({ namespace: "aws", name: "users" });
    const sourceGroup = { id: "sourceGroup", symbol: group.ref, definition: group.definition, label: "", x: 1160, y: 555, width: 560, height: 320, declarationOrder: 0 };
    const targetGroup = { ...sourceGroup, id: "targetGroup", x: 600, y: 840, width: 400, height: 160 };
    const source = { id: "source", symbol: icon.ref, definition: icon.definition, label: "", parentId: sourceGroup.id, x: 1560, y: 755, width: 80, height: 80, declarationOrder: 1 };
    const target = { ...source, id: "target", parentId: targetGroup.id, x: 840, y: 880 };
    const edge = { id: "edge", source: source.id, target: target.id, operator: "-->" as const, declarationOrder: 0 };
    const routes = new Map([[edge.id, { sourcePoint: { x: 1576, y: 835 }, bendPoints: [{ x: 1576, y: 896 }], targetPoint: { x: 920, y: 896 } }]]);
    enforceGlobalEdgeSpacing([sourceGroup, targetGroup, source, target], [edge], routes, DEFAULT_LAYOUT_CONFIG);
    assert.deepEqual(routes.get(edge.id)!.bendPoints, [{ x: 1576, y: 915 }]);
    assert.deepEqual(routes.get(edge.id)!.targetPoint, { x: 920, y: 915 });
});

test("container-scoped ELK direction controls local layered layout", async () => {
    const ast = parseDsl(`direction right
core:group workers {
    direction down
    aws:lambda first
    aws:lambda second
    first --> second
}`);
    assert.equal(ast.nodes[0]?.layout?.direction, "down");
    const layout = await layoutDocument(ast);
    const first = layout.nodes.find((node) => node.id === "first")!;
    const second = layout.nodes.find((node) => node.id === "second")!;
    assert.equal(first.x, second.x);
    assert.ok(first.y < second.y);

    assert.throws(() => parseDsl("core:group workers {\n    direction down\n    direction right\n}"), /direction is already set/);
    assert.throws(() => parseDsl("core:group workers {\n    layer-bound 2\n}"), /unsupported syntax/);
    assert.equal(parseDsl("node-spacing 140\naws:lambda fn").layout.nodeSpacing.root, 140);
});

test("omitted and partial layout configuration normalize without running layout", () => {
    const defaults = parseDsl("aws:lambda fn");
    assert.deepEqual(defaults.layout, DEFAULT_LAYOUT_CONFIG);

    const partial = parseDsl(`node-spacing 50
edge-spacing 30
aws:lambda fn`);
    assert.deepEqual(partial.layout.nodeSpacing, { root: 50, resource: 50, container: 50 });
    assert.equal(partial.layout.edgeSpacing, 30);
    assert.equal(partial.layout.layerSpacing, DEFAULT_LAYOUT_CONFIG.layerSpacing);
    assert.deepEqual(partial.layout.padding, DEFAULT_LAYOUT_CONFIG.padding);
});

test("document node spacing is inherited and a container override wins locally", async () => {
    const ast = parseDsl(`node-spacing 50
core:layout outer {
    grid-columns 2
    aws:lambda first
    aws:lambda second
}
core:layout local {
    grid-columns 2
    node-spacing 15
    aws:lambda third
    aws:lambda fourth
}`);
    const layout = await layoutDocument(ast);
    const node = (id: string) => layout.nodes.find((item) => item.id === id)!;
    assert.equal(node("second").x - node("first").x - node("first").width, 50);
    assert.equal(node("fourth").x - node("third").x - node("third").width, 15);
});

test("document layer spacing changes deterministic layered geometry", async () => {
    const layout = await layoutDocument(parseDsl(`layer-spacing 123
aws:lambda source
aws:sqs target
source --> target`));
    const source = layout.nodes.find((node) => node.id === "source")!;
    const target = layout.nodes.find((node) => node.id === "target")!;
    assert.equal(target.x - source.x - source.width, 123);
});

test("padding applies at the root and can be overridden by a container", async () => {
    const layout = await layoutDocument(parseDsl(`padding 17
core:group inherited {
    aws:lambda first
}
core:group overridden {
    padding 5
    aws:lambda second
}`));
    const node = (id: string) => layout.nodes.find((item) => item.id === id)!;
    assert.equal(node("inherited").x, 17);
    assert.equal(node("first").x - node("inherited").x, 17);
    assert.equal(node("second").x - node("overridden").x, 5);
});

test("layout settings reject invalid values, duplicates, and invalid scope", () => {
    assert.throws(() => parseDsl("node-spacing 0\naws:lambda fn"), /Line 1: node-spacing must be an integer from 1 to 10000/);
    assert.throws(() => parseDsl("layer-spacing 1.5\naws:lambda fn"), /Line 1: layer-spacing/);
    assert.throws(() => parseDsl("padding -1\naws:lambda fn"), /Line 1: padding must be an integer from 0 to 10000/);
    assert.throws(() => parseDsl("edge-spacing 10001\naws:lambda fn"), /Line 1: edge-spacing/);
    assert.throws(() => parseDsl("node-spacing 10\nnode-spacing 20\naws:lambda fn"), /Line 2: node-spacing is already set at document level/);
    assert.throws(() => parseDsl("core:group g {\nedge-spacing 20\n}"), /Line 2: edge-spacing must be top-level/);
});

test("explicit edge spacing does not add bends to preserve a preferred lane gap", () => {
    const config = parseDsl("edge-spacing 40\naws:lambda fn").layout;
    const edges = [
        { id: "first", source: "source_a", target: "target_a", operator: "-->" as const, declarationOrder: 0 },
        { id: "second", source: "source_b", target: "target_b", operator: "-->" as const, declarationOrder: 1 },
    ];
    const routes = new Map([
        ["first", { sourcePoint: { x: 0, y: 0 }, bendPoints: [{ x: 0, y: 50 }, { x: 200, y: 50 }], targetPoint: { x: 200, y: 100 } }],
        ["second", { sourcePoint: { x: 20, y: 0 }, bendPoints: [{ x: 20, y: 62 }, { x: 180, y: 62 }], targetPoint: { x: 180, y: 100 } }],
    ]);
    enforceGlobalEdgeSpacing([], edges, routes, config);
    assert.equal(routes.get("first")!.bendPoints.length, 2);
    assert.equal(routes.get("second")!.bendPoints.length, 2);
});

test("labels decode backslash, quote, and newline escapes in one pass", () => {
    const ast = parseDsl('aws:lambda newline "a\\nb"\naws:lambda slash "a\\\\nb"\naws:lambda quote "a\\"b"\naws:lambda backslash "a\\\\b"');
    assert.deepEqual(ast.nodes.map((node) => node.label), ["a\nb", "a\\nb", 'a"b', "a\\b"]);
});

test("formatter output is idempotent and re-parses to the same document", () => {
    const source = 'direction right\n\naws:cloud cloud "Cloud" {\naws:lambda fn "Fn"\n}\naws:sqs queue\n\nfn --> queue : work\n';
    const formatted = formatDsl(source);
    assert.equal(formatDsl(formatted), formatted);
    const before = parseDsl(source);
    const after = parseDsl(formatted);
    assert.deepEqual(after.nodes.map((node) => node.id), before.nodes.map((node) => node.id));
    assert.deepEqual(after.edges.map((edge) => [edge.source, edge.target, edge.label]), before.edges.map((edge) => [edge.source, edge.target, edge.label]));
});

test("the bundled legacy DrawDSL file still parses, lays out, and renders", async () => {
    const source = await readFile(new URL("../examples/elk.drawdsl", import.meta.url), "utf8");
    const ast = parseDsl(source);
    const layout = await layoutDocument(ast);
    const xml = renderDrawio(layout.nodes, layout.edges);
    assert.equal(layout.nodes.length > 10, true);
    assert.equal(layout.edges.length > 10, true);
    assert.match(xml, /<mxfile/);
    assert.match(xml, /id="cloud"/);
    assert.match(xml, /id="edge:1:internet:cdn"/);
});

test("inherited Object.prototype names are not symbols", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
        assert.throws(() => resolveSymbol({ namespace: "core", name }), /unknown symbol/);
        assert.throws(() => resolveSymbol({ namespace: "aws", name }), /unknown symbol/);
        assert.throws(() => parseDsl(`core:${name} x`), /unknown symbol/);
        assert.deepEqual(qualifiedCandidates(name), []);
    }
    // Existing aliases and symbols still resolve.
    assert.equal(resolveSymbol({ namespace: "aws", name: "apigw" }).ref.name, "apigateway");
    assert.equal(resolveSymbol({ namespace: "core", name: "box" }).ref.name, "box");
});

test("edge IDs cannot collide with user node IDs", async () => {
    const ast = parseDsl("core:box a\ncore:box b\ncore:box edge_1_a_b\na --> b");
    const layout = await layoutDocument(ast);
    const xml = renderDrawio(layout.nodes, layout.edges);
    const ids = [...xml.matchAll(/<mxCell id="([^"]+)"/g)].map((m) => m[1]!);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes("edge_1_a_b"));
    assert.ok(ids.some((id) => id!.startsWith("edge:")));
    assert.match(xml, /source="a" target="b"/);
});

test("core:image requires a quoted absolute HTTP(S) URL", () => {
    assert.throws(() => parseDsl("core:image x"), /core:image requires a quoted absolute HTTP/);
    assert.throws(() => parseDsl('core:image x "javascript:alert(1)"'), /core:image requires a quoted absolute HTTP/);
    assert.throws(() => parseDsl('core:image x "relative/path.png"'), /core:image requires a quoted absolute HTTP/);
    assert.throws(() => parseDsl('core:image x "ftp://example.com/a.png"'), /core:image requires a quoted absolute HTTP/);
    assert.throws(() => parseDsl('core:image x "https://example.com/a;shape=rectangle.png"'), /must not contain ";"/);
    const ast = parseDsl('core:image reference "https://example.com/a.png?query=1&other=2#frag"');
    assert.equal(ast.nodes[0]?.label, "https://example.com/a.png?query=1&other=2#frag");
});

test("labels display literally and style URLs cannot inject keys", async () => {
    const ast = parseDsl('core:box a "<b>literal</b> & text"\ncore:box b "plain"\na --> b : "<i>edge</i> & more"');
    const layout = await layoutDocument(ast);
    const xml = renderDrawio(layout.nodes, layout.edges);
    // Double-encoded so draw.io with html=1 shows literal text.
    assert.match(xml, /&amp;lt;b&amp;gt;literal&amp;lt;\/b&amp;gt; &amp;amp; text/);
    assert.match(xml, /&amp;lt;i&amp;gt;edge&amp;lt;\/i&amp;gt; &amp;amp; more/);
    assert.doesNotMatch(xml, /value="[^"]*<b>/);
});
