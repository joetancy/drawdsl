import type { LayoutConfig } from "../config.js";
import type { AstEdge, FlatLayoutNode, Point } from "../model.js";

const STEP = 20;
type Rect = { x: number; y: number; width: number; height: number };
type Group = { edges: AstEdge[]; obstacles: Rect[] };
export type FastRoute = { sourcePoint: Point; targetPoint: Point; bendPoints: Point[] };
type Grid = {
    originX: number; originY: number; columns: number; rows: number;
    blocked: Uint8Array; horizontalBlocked: Uint8Array; verticalBlocked: Uint8Array;
    horizontalUsed: Uint16Array; verticalUsed: Uint16Array;
    horizontalCrossings: Uint16Array; verticalCrossings: Uint16Array;
};
type OpenEntry = { state: number; cost: number; score: number; order: number };

class MinHeap {
    private entries: OpenEntry[] = [];
    private order = 0;

    push(state: number, cost: number, score: number): void {
        const entry = { state, cost, score, order: this.order++ };
        let index = this.entries.push(entry) - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (!this.before(entry, this.entries[parent]!)) break;
            this.entries[index] = this.entries[parent]!;
            index = parent;
        }
        this.entries[index] = entry;
    }

    pop(): OpenEntry | undefined {
        const first = this.entries[0];
        const last = this.entries.pop();
        if (!first || !last || !this.entries.length) return first;
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            if (left >= this.entries.length) break;
            const child = right < this.entries.length && this.before(this.entries[right]!, this.entries[left]!) ? right : left;
            if (!this.before(this.entries[child]!, last)) break;
            this.entries[index] = this.entries[child]!;
            index = child;
        }
        this.entries[index] = last;
        return first;
    }

    private before(a: OpenEntry, b: OpenEntry): boolean {
        return a.score < b.score || (a.score === b.score && a.order < b.order);
    }
}

function indexFor(value: number, origin: number): number { return Math.round((value - origin) / STEP); }
function pointIndex(column: number, row: number, columns: number): number { return row * columns + column; }
function horizontalIndex(column: number, row: number, columns: number): number { return row * (columns - 1) + column; }
function verticalIndex(column: number, row: number, columns: number): number { return row * columns + column; }
function inRange(value: number, low: number, high: number): boolean { return value > low && value < high; }

function makeGrid(nodes: FlatLayoutNode[], obstacles: Rect[], clearance: number): Grid {
    const minX = Math.min(...nodes.map((node) => node.x)) - clearance - STEP * 3;
    const minY = Math.min(...nodes.map((node) => node.y)) - clearance - STEP * 3;
    const maxX = Math.max(...nodes.map((node) => node.x + node.width)) + clearance + STEP * 3;
    const maxY = Math.max(...nodes.map((node) => node.y + node.height)) + clearance + STEP * 3;
    const originX = Math.floor(minX / STEP) * STEP;
    const originY = Math.floor(minY / STEP) * STEP;
    const columns = Math.ceil((maxX - originX) / STEP) + 1;
    const rows = Math.ceil((maxY - originY) / STEP) + 1;
    if (columns > 1200 || rows > 1200) throw new Error("Fast routing grid is too large; use beautified routing");
    const grid: Grid = {
        originX, originY, columns, rows,
        blocked: new Uint8Array(columns * rows),
        horizontalBlocked: new Uint8Array(rows * Math.max(columns - 1, 0)),
        verticalBlocked: new Uint8Array(Math.max(rows - 1, 0) * columns),
        horizontalUsed: new Uint16Array(rows * Math.max(columns - 1, 0)),
        verticalUsed: new Uint16Array(Math.max(rows - 1, 0) * columns),
        horizontalCrossings: new Uint16Array(columns * rows),
        verticalCrossings: new Uint16Array(columns * rows),
    };
    for (const obstacle of obstacles) {
        const left = obstacle.x - clearance;
        const right = obstacle.x + obstacle.width + clearance;
        const top = obstacle.y - clearance;
        const bottom = obstacle.y + obstacle.height + clearance;
        for (let row = 0; row < rows; row += 1) {
            const y = originY + row * STEP;
            if (inRange(y, top, bottom)) {
                for (let column = 0; column < columns; column += 1) {
                    const x = originX + column * STEP;
                    if (inRange(x, left, right)) grid.blocked[pointIndex(column, row, columns)] = 1;
                }
                for (let column = 0; column < columns - 1; column += 1) {
                    const start = originX + column * STEP;
                    if (start < right && start + STEP > left) grid.horizontalBlocked[horizontalIndex(column, row, columns)] = 1;
                }
            }
            if (y > top && y < bottom) {
                for (let column = 0; column < columns; column += 1) {
                    const x = originX + column * STEP;
                    if (inRange(x, left, right)) grid.verticalBlocked[verticalIndex(column, row, columns)] = 1;
                }
            }
        }
    }
    return grid;
}

type Side = "top" | "right" | "bottom" | "left";
function sides(source: FlatLayoutNode, target: FlatLayoutNode, edge: AstEdge): [Side, Side] {
    const dx = target.x + target.width / 2 - source.x - source.width / 2;
    const dy = target.y + target.height / 2 - source.y - source.height / 2;
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const sourceSide = edge.sourceSide ?? (horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top");
    const targetSide = edge.targetSide ?? (horizontal ? dx >= 0 ? "left" : "right" : dy >= 0 ? "top" : "bottom");
    return [sourceSide, targetSide];
}

function pointOnSide(node: FlatLayoutNode, side: Side, grid: Grid): Point {
    const choose = (low: number, high: number, origin: number, center: number): number => {
        const first = Math.ceil((low - origin) / STEP);
        const last = Math.floor((high - origin) / STEP);
        const index = first <= last ? Math.max(first, Math.min(last, Math.round((center - origin) / STEP))) : Math.round((center - origin) / STEP);
        return origin + index * STEP;
    };
    if (side === "left" || side === "right") {
        const x = side === "left" ? node.x : node.x + node.width;
        const y = choose(node.y, node.y + node.height, grid.originY, node.y + node.height / 2);
        return { x, y };
    }
    const y = side === "top" ? node.y : node.y + node.height;
    const x = choose(node.x, node.x + node.width, grid.originX, node.x + node.width / 2);
    return { x, y };
}

function routeCost(grid: Grid, from: number, to: number, direction: number, previousDirection: number, edgeSpacing: number): number {
    const stepPenalty = STEP;
    const bendPenalty = previousDirection === 4 || previousDirection === direction ? 0 : edgeSpacing * 2;
    const row = Math.floor(to / grid.columns);
    const column = to % grid.columns;
    const crossingCount = direction === 0 || direction === 2
        ? grid.verticalCrossings[to]!
        : grid.horizontalCrossings[to]!;
    const horizontal = direction === 0 || direction === 2;
    const exactIndex = horizontal
        ? horizontalIndex(Math.min(from % grid.columns, column), row, grid.columns)
        : verticalIndex(column, Math.min(Math.floor(from / grid.columns), row), grid.columns);
    const exactCongestion = horizontal ? grid.horizontalUsed[exactIndex]! : grid.verticalUsed[exactIndex]!;
    let nearby = 0;
    const radius = Math.max(1, Math.ceil(edgeSpacing / STEP));
    for (let offset = 1; offset <= radius; offset += 1) {
        if (horizontal) {
            for (const adjacentRow of [row - offset, row + offset]) if (adjacentRow >= 0 && adjacentRow < grid.rows) nearby += grid.horizontalUsed[horizontalIndex(Math.min(from % grid.columns, column), adjacentRow, grid.columns)]! / offset;
        } else {
            for (const adjacentColumn of [column - offset, column + offset]) if (adjacentColumn >= 0 && adjacentColumn < grid.columns) nearby += grid.verticalUsed[verticalIndex(adjacentColumn, Math.min(Math.floor(from / grid.columns), row), grid.columns)]! / offset;
        }
    }
    return stepPenalty + bendPenalty + crossingCount * edgeSpacing * 8 + exactCongestion * edgeSpacing * 4 + nearby * edgeSpacing * 0.2;
}

function findPath(grid: Grid, start: Point, goal: Point, spacing: number): Point[] | undefined {
    const startColumn = indexFor(start.x, grid.originX);
    const startRow = indexFor(start.y, grid.originY);
    const goalColumn = indexFor(goal.x, grid.originX);
    const goalRow = indexFor(goal.y, grid.originY);
    const startCell = pointIndex(startColumn, startRow, grid.columns);
    const goalCell = pointIndex(goalColumn, goalRow, grid.columns);
    if (grid.blocked[startCell] || grid.blocked[goalCell]) return undefined;
    const stateCount = grid.columns * grid.rows * 5;
    const costs = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
    const parents = new Int32Array(stateCount).fill(-1);
    const initial = startCell * 5 + 4;
    const heuristic = (cell: number): number => {
        const row = Math.floor(cell / grid.columns);
        const column = cell % grid.columns;
        return (Math.abs(goalColumn - column) + Math.abs(goalRow - row)) * STEP;
    };
    const open = new MinHeap();
    costs[initial] = 0;
    open.push(initial, 0, heuristic(startCell));
    const moves = [[1, 0, 0], [0, 1, 1], [-1, 0, 2], [0, -1, 3]] as const;
    let finalState = -1;
    while (true) {
        const current = open.pop();
        if (!current) break;
        if (current.cost !== costs[current.state]) continue;
        const cell = Math.floor(current.state / 5);
        const previousDirection = current.state % 5;
        if (cell === goalCell) { finalState = current.state; break; }
        const row = Math.floor(cell / grid.columns);
        const column = cell % grid.columns;
        for (const [dx, dy, direction] of moves) {
            const nextColumn = column + dx;
            const nextRow = row + dy;
            if (nextColumn < 0 || nextColumn >= grid.columns || nextRow < 0 || nextRow >= grid.rows) continue;
            const nextCell = pointIndex(nextColumn, nextRow, grid.columns);
            if (grid.blocked[nextCell]) continue;
            if (direction === 0 && grid.horizontalBlocked[horizontalIndex(column, row, grid.columns)]) continue;
            if (direction === 2 && grid.horizontalBlocked[horizontalIndex(nextColumn, row, grid.columns)]) continue;
            if (direction === 1 && grid.verticalBlocked[verticalIndex(column, row, grid.columns)]) continue;
            if (direction === 3 && grid.verticalBlocked[verticalIndex(column, nextRow, grid.columns)]) continue;
            const nextState = nextCell * 5 + direction;
            const nextCost = current.cost + routeCost(grid, cell, nextCell, direction, previousDirection, spacing);
            if (nextCost >= costs[nextState]!) continue;
            costs[nextState] = nextCost;
            parents[nextState] = current.state;
            open.push(nextState, nextCost, nextCost + heuristic(nextCell));
        }
    }
    if (finalState < 0) return undefined;
    const cells: number[] = [];
    for (let state = finalState; state >= 0; state = parents[state]!) cells.push(Math.floor(state / 5));
    cells.reverse();
    const points = cells.map((cell) => ({ x: grid.originX + (cell % grid.columns) * STEP, y: grid.originY + Math.floor(cell / grid.columns) * STEP }));
    return points.filter((point, index) => index === 0 || index === points.length - 1
        || !((points[index - 1]!.x === point.x && point.x === points[index + 1]!.x) || (points[index - 1]!.y === point.y && point.y === points[index + 1]!.y)));
}

function recordPath(grid: Grid, points: Point[]): void {
    for (let index = 1; index < points.length; index += 1) {
        const start = points[index - 1]!;
        const end = points[index]!;
        const startColumn = indexFor(start.x, grid.originX);
        const endColumn = indexFor(end.x, grid.originX);
        const startRow = indexFor(start.y, grid.originY);
        const endRow = indexFor(end.y, grid.originY);
        const horizontal = startRow === endRow;
        const sign = horizontal ? Math.sign(endColumn - startColumn) : Math.sign(endRow - startRow);
        const count = Math.max(Math.abs(endColumn - startColumn), Math.abs(endRow - startRow));
        for (let step = 0; step < count; step += 1) {
            const column = startColumn + (horizontal ? step * sign : 0);
            const row = startRow + (horizontal ? 0 : step * sign);
            const edge = horizontal ? horizontalIndex(Math.min(column, column + sign), row, grid.columns) : verticalIndex(column, Math.min(row, row + sign), grid.columns);
            if (horizontal) grid.horizontalUsed[edge] = Math.min(65535, grid.horizontalUsed[edge]! + 1);
            else grid.verticalUsed[edge] = Math.min(65535, grid.verticalUsed[edge]! + 1);
            const cell = pointIndex(column, row, grid.columns);
            const nextCell = pointIndex(column + (horizontal ? sign : 0), row + (horizontal ? 0 : sign), grid.columns);
            if (horizontal) {
                grid.horizontalCrossings[cell] = Math.min(65535, grid.horizontalCrossings[cell]! + 1);
                grid.horizontalCrossings[nextCell] = Math.min(65535, grid.horizontalCrossings[nextCell]! + 1);
            } else {
                grid.verticalCrossings[cell] = Math.min(65535, grid.verticalCrossings[cell]! + 1);
                grid.verticalCrossings[nextCell] = Math.min(65535, grid.verticalCrossings[nextCell]! + 1);
            }
        }
    }
}

function routeEdge(grid: Grid, nodesById: Map<string, FlatLayoutNode>, edge: AstEdge, clearance: number, edgeSpacing: number): FastRoute | undefined {
    const source = nodesById.get(edge.source);
    const target = nodesById.get(edge.target);
    if (!source || !target) return undefined;
    const [preferredSource, preferredTarget] = sides(source, target, edge);
    // Leads extend beyond the endpoint clearance zone while staying on the grid.
    const outside = (point: Point, side: Side): Point => {
        const distance = clearance + STEP;
        return side === "left" ? { x: grid.originX + Math.floor((point.x - distance - grid.originX) / STEP) * STEP, y: point.y }
            : side === "right" ? { x: grid.originX + Math.ceil((point.x + distance - grid.originX) / STEP) * STEP, y: point.y }
                : side === "top" ? { x: point.x, y: grid.originY + Math.floor((point.y - distance - grid.originY) / STEP) * STEP }
                    : { x: point.x, y: grid.originY + Math.ceil((point.y + distance - grid.originY) / STEP) * STEP };
    };
    const allSides: Side[] = ["right", "bottom", "left", "top"];
    const opposite: Record<Side, Side> = { right: "left", left: "right", top: "bottom", bottom: "top" };
    const sourceSides = edge.sourceSide ? [preferredSource] : [preferredSource, ...allSides.filter((side) => side !== preferredSource)];
    const targetSides = edge.targetSide ? [preferredTarget] : [preferredTarget, ...allSides.filter((side) => side !== preferredTarget)];
    const candidates = edge.sourceSide && edge.targetSide
        ? [{ sourceSide: preferredSource, targetSide: preferredTarget }]
        : edge.sourceSide
            ? targetSides.map((targetSide) => ({ sourceSide: preferredSource, targetSide }))
            : edge.targetSide
                ? sourceSides.map((sourceSide) => ({ sourceSide, targetSide: preferredTarget }))
                : sourceSides.map((sourceSide) => ({ sourceSide, targetSide: opposite[sourceSide] }));
    for (const { sourceSide, targetSide } of candidates) {
        const start = pointOnSide(source, sourceSide, grid);
        const end = pointOnSide(target, targetSide, grid);
        const startLead = outside(start, sourceSide);
        const endLead = outside(end, targetSide);
        const path = findPath(grid, startLead, endLead, edgeSpacing);
        if (!path) continue;
        recordPath(grid, path);
        const points = [start, startLead, ...path.slice(1, -1), endLead, end];
        const compressed = points.filter((point, index) => index === 0 || index === points.length - 1
            || !((points[index - 1]!.x === point.x && point.x === points[index + 1]!.x) || (points[index - 1]!.y === point.y && point.y === points[index + 1]!.y)));
        return { sourcePoint: start, targetPoint: end, bendPoints: compressed.slice(1, -1) };
    }
    return undefined;
}

export function routeFastEdges(groups: Group[], nodes: FlatLayoutNode[], config: LayoutConfig): Map<string, FastRoute> {
    const routes = new Map<string, FastRoute>();
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    for (const group of groups) {
        const graphNodes = group.edges.flatMap((edge) => [nodesById.get(edge.source), nodesById.get(edge.target)]).filter((node): node is FlatLayoutNode => !!node);
        const uniqueNodes = new Map([...nodes, ...graphNodes].map((node) => [node.id, node]));
        if (!uniqueNodes.size) continue;
        let grid: Grid;
        try {
            grid = makeGrid([...uniqueNodes.values()], group.obstacles, config.edgeEndpointClearance);
        } catch {
            continue;
        }
        for (const edge of group.edges) {
            const route = routeEdge(grid, nodesById, edge, config.edgeEndpointClearance, config.edgeSpacing);
            if (route) routes.set(edge.id, route);
        }
    }
    return routes;
}
