import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LAYOUT_CONFIG } from "../src/config.js";
import { simplifyWaypoints } from "../src/layout/common.js";
import { enforceGlobalEdgeSpacing, routeDiagram, type RoutingDiagnostics } from "../src/layout/routing.js";
import type { AstEdge, FlatLayoutNode, Point, RoutedEdge } from "../src/model.js";
import { resolveSymbol } from "../src/symbols/registry.js";

const icon = resolveSymbol({ namespace: "aws", name: "lambda" });
const group = resolveSymbol({ namespace: "core", name: "group" });
const node = (id: string, x: number, y: number, parentId?: string): FlatLayoutNode => ({
    id, symbol: icon.ref, definition: icon.definition, label: id, x, y, width: 80, height: 80, declarationOrder: 0, parentId,
});
const pointsFor = (edge: RoutedEdge): Point[] => [edge.sourcePoint!, ...edge.points, edge.targetPoint!];

function assertGeometry(nodes: FlatLayoutNode[], edges: RoutedEdge[]): void {
    for (const edge of edges) {
        const points = pointsFor(edge);
        for (let i = 1; i < points.length; i += 1) {
            const a = points[i - 1]!;
            const b = points[i]!;
            assert.ok(a.x === b.x || a.y === b.y, `${edge.id} must be orthogonal`);
            for (const obstacle of nodes.filter((item) => item.definition.role !== "container")) {
                const crosses = a.x === b.x
                    ? a.x > obstacle.x && a.x < obstacle.x + obstacle.width && Math.max(a.y, b.y) > obstacle.y && Math.min(a.y, b.y) < obstacle.y + obstacle.height
                    : a.y > obstacle.y && a.y < obstacle.y + obstacle.height && Math.max(a.x, b.x) > obstacle.x && Math.min(a.x, b.x) < obstacle.x + obstacle.width;
                assert.equal(crosses, false, `${edge.id} must avoid ${obstacle.id}`);
            }
        }
    }
}

test("incoming and outgoing edges get distinct ordered ports across container routing groups", async () => {
    for (const vertical of [false, true]) {
        const p = (x: number, y: number): Point => vertical ? { x: y, y: x } : { x, y };
        const nodes = ["a", "b", "c"].map((id, i) => node(id, p(0, i * 160).x, p(0, i * 160).y, `group${i}`));
        const hubPosition = p(400, 160);
        nodes.push(node("hub", hubPosition.x, hubPosition.y));
        for (let i = 0; i < 3; i += 1) {
            const position = p(-60, i * 160 - 40);
            nodes.push({ ...node(`group${i}`, position.x, position.y), symbol: group.ref, definition: group.definition, width: vertical ? 160 : 200, height: vertical ? 200 : 160 });
        }
        const side = vertical ? "top" : "left";
        const edges: AstEdge[] = ["c", "a", "b"].map((source, declarationOrder) => ({ id: source, source, target: "hub", targetSide: side, operator: "-->", declarationOrder }));
        edges.push({ id: "out", source: "hub", target: "b", sourceSide: side, operator: "-->", declarationOrder: 3 });
        for (const quality of ["fast", "beautiful"] as const) {
            let diagnostics: RoutingDiagnostics | undefined;
            const routed = await routeDiagram(nodes, edges, DEFAULT_LAYOUT_CONFIG, quality, (result) => { diagnostics = result; });
            assertGeometry(nodes, routed);
            const positions = routed.map((edge) => edge.id === "out" ? edge.sourcePoint! : edge.targetPoint!).map((point) => vertical ? point.x : point.y);
            assert.equal(new Set(positions).size, 4);
            const sorted = [...positions].sort((a, b) => a - b);
            assert.ok(sorted.slice(1).every((value, i) => value - sorted[i]! >= DEFAULT_LAYOUT_CONFIG.edgeSpacing - 1e-7), JSON.stringify({ vertical, quality, positions }));
            assert.ok(positions[1]! < positions[2]! && positions[2]! < positions[0]!);
            assert.equal(diagnostics!.sharedSegmentPairs, 0);
            assert.equal(diagnostics!.crowdedSides, 0);
            assert.deepEqual(await routeDiagram(nodes, edges, DEFAULT_LAYOUT_CONFIG, quality), routed);
        }
    }
});

test("approach repair removes a rectangular dogleg while preserving pinned endpoints", () => {
    const nodes = [node("source", 0, 100), node("target", 400, 100)];
    const edge: AstEdge = { id: "edge", source: "source", target: "target", sourceSide: "right", targetSide: "left", operator: "-->", declarationOrder: 0 };
    const route = { sourcePoint: { x: 80, y: 140 }, targetPoint: { x: 400, y: 160 }, bendPoints: [{ x: 180, y: 140 }, { x: 180, y: 80 }, { x: 300, y: 80 }, { x: 300, y: 160 }] };
    enforceGlobalEdgeSpacing(nodes, [edge], new Map([[edge.id, route]]), DEFAULT_LAYOUT_CONFIG);
    assert.deepEqual(route.sourcePoint, { x: 80, y: 140 });
    assert.deepEqual(route.targetPoint, { x: 400, y: 160 });
    assert.equal(route.bendPoints.length, 2);
    assert.ok(route.bendPoints.every((point) => point.x > 80 && point.x < 400 && point.y >= 140 && point.y <= 160));
});

test("crowded pinned sides are reported without merging their attachment points", async () => {
    const nodes = [node("hub", 400, 0), ...Array.from({ length: 6 }, (_, i) => node(`n${i}`, 0, i * 160))];
    const edges: AstEdge[] = nodes.slice(1).map((source, declarationOrder) => ({ id: source.id, source: source.id, target: "hub", targetSide: "left", operator: "-->", declarationOrder }));
    let diagnostics: RoutingDiagnostics | undefined;
    const routed = await routeDiagram(nodes, edges, DEFAULT_LAYOUT_CONFIG, "beautiful", (result) => { diagnostics = result; });
    assertGeometry(nodes, routed);
    assert.equal(new Set(routed.map((edge) => edge.targetPoint!.y)).size, 6);
    assert.equal(diagnostics!.crowdedSides, 1);
    assert.ok(diagnostics!.spacingConflictPairs > 0);
});

test("waypoint simplification preserves reversals so they cannot hide obstacle-crossing shortcuts", () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 0 }];
    assert.deepEqual(simplifyWaypoints(points), points);
});

test("closed padded grid corridors retry with valid orthogonal routes", async () => {
    const nodes = Array.from({ length: 9 }, (_, i) => node(`n${i}`, (i % 3) * 160, Math.floor(i / 3) * 160));
    nodes.push(node("target", 800, 170));
    const edges: AstEdge[] = [{ id: "edge", source: "n4", target: "target", operator: "-->", declarationOrder: 0 }];
    for (const quality of ["fast", "beautiful"] as const) {
        assertGeometry(nodes, await routeDiagram(nodes, edges, DEFAULT_LAYOUT_CONFIG, quality));
    }
});

test("an obstructed pinned side fails instead of returning a diagonal through an obstacle", async () => {
    const nodes = [node("source", 0, 0), node("target", 400, 0), { ...node("blocker", 80, -80), width: 160, height: 240 }];
    const edges: AstEdge[] = [{ id: "edge", source: "source", target: "target", sourceSide: "right", targetSide: "left", operator: "-->", declarationOrder: 0 }];
    await assert.rejects(routeDiagram(nodes, edges, DEFAULT_LAYOUT_CONFIG), /Could not route edge source → target/);
});
