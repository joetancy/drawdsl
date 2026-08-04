import { isRenderable, type AstEdge, type AstNode, type Direction, type DocumentAst, type EdgeOperator, type NodeSide, type SymbolRef } from "./model.js";
import { qualifiedCandidates, resolveSymbol } from "./symbols/registry.js";

const EDGE_RE = /^(?:([TRBLtrbl]):)?([A-Za-z_][\w-]*)\s*(<-->|<-\.->|-->|-\.->|---|-\.-)\s*(?:([TRBLtrbl]):)?([A-Za-z_][\w-]*)(?:\s*:\s*(.+?))?\s*$/;
const DIRECTION_RE = /^direction\s+(right|left|down|up)$/;
const DEFAULT_LAYOUT_RE = /^layout\s+elk$/;
const GRID_COLUMNS_RE = /^grid-columns\s+([1-9]\d*)$/;
const NODE_SPACING_RE = /^node-spacing\s+([1-9]\d*)$/;
const DECLARATION_RE = /^([A-Za-z_][\w-]*):([A-Za-z_][\w-]*)(?:\s+([A-Za-z_][\w-]*))?(?:\s+"((?:[^"\\]|\\.)*)")?\s*(\{)?$/;
const UNQUALIFIED_RE = /^([A-Za-z_][\w-]*)\b/;

function scanLine(line: string): { commentIndex: number; unclosedQuote: boolean } {
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === '"') quoted = !quoted;
        if (c === "#" && !quoted) return { commentIndex: i, unclosedQuote: quoted };
    }
    return { commentIndex: -1, unclosedQuote: quoted };
}

export function stripComment(line: string): string {
    const { commentIndex } = scanLine(line);
    return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

export function hasUnclosedQuote(line: string): boolean {
    return scanLine(line).unclosedQuote;
}

function unescapeQuoted(value: string): string {
    return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function unquoteLabel(value?: string): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    return trimmed.startsWith('"') && trimmed.endsWith('"')
        ? unescapeQuoted(trimmed.slice(1, -1))
        : trimmed;
}

function nodeSide(value: string | undefined): NodeSide | undefined {
    if (!value) return undefined;
    const sides: Record<"T" | "R" | "B" | "L", NodeSide> = { T: "top", R: "right", B: "bottom", L: "left" };
    return sides[value.toUpperCase() as keyof typeof sides];
}

function parseSymbol(raw: string, lineNumber: number): { ref: SymbolRef; definition: ReturnType<typeof resolveSymbol>["definition"] } {
    const match = raw.match(/^([^:]+):(.+)$/);
    if (!match) {
        const candidates = qualifiedCandidates(raw);
        const hint = candidates.length ? `; use ${candidates[0]}` : "";
        throw new Error(`Line ${lineNumber}: symbol "${raw}" must be namespaced${hint}`);
    }
    const resolved = resolveSymbol({ namespace: match[1]!, name: match[2]! });
    return resolved;
}

export function parseDsl(source: string): DocumentAst {
    const rootNodes: AstNode[] = [];
    const edges: AstEdge[] = [];
    const stack: AstNode[] = [];
    const ids = new Set<string>();
    let direction: Direction = "right";
    let order = 0;
    let anonymousNodeCount = 0;

    const sourceLines = source.split(/\r?\n/);
    for (let index = 0; index < sourceLines.length; index += 1) {
        const lineNumber = index + 1;
        let rawLine = sourceLines[index]!;
        while (hasUnclosedQuote(rawLine)) {
            index += 1;
            if (index >= sourceLines.length) throw new Error(`Line ${lineNumber}: unclosed quoted label`);
            rawLine += `\n${sourceLines[index]!}`;
        }
        const line = stripComment(rawLine).trim();
        if (!line) continue;
        if (line === "}") {
            if (!stack.length) throw new Error(`Line ${lineNumber}: unexpected }`);
            stack.pop();
            continue;
        }
        if (DEFAULT_LAYOUT_RE.test(line)) {
            if (stack.length) throw new Error(`Line ${lineNumber}: layout must be top-level`);
            continue;
        }
        const directionMatch = line.match(DIRECTION_RE);
        if (directionMatch) {
            const container = stack.at(-1);
            if (!container) direction = directionMatch[1] as Direction;
            else {
                if (container.direction !== undefined) throw new Error(`Line ${lineNumber}: direction is already set for container ${container.id}`);
                container.direction = directionMatch[1] as Direction;
            }
            continue;
        }
        const gridColumnsMatch = line.match(GRID_COLUMNS_RE);
        if (gridColumnsMatch) {
            const container = stack.at(-1);
            if (!container) throw new Error(`Line ${lineNumber}: grid-columns must be inside a container`);
            if (container.gridColumns !== undefined) throw new Error(`Line ${lineNumber}: grid-columns is already set for container ${container.id}`);
            container.gridColumns = Number(gridColumnsMatch[1]);
            continue;
        }
        const nodeSpacingMatch = line.match(NODE_SPACING_RE);
        if (nodeSpacingMatch) {
            const container = stack.at(-1);
            if (!container) throw new Error(`Line ${lineNumber}: node-spacing must be inside a container`);
            if (container.nodeSpacing !== undefined) throw new Error(`Line ${lineNumber}: node-spacing is already set for container ${container.id}`);
            container.nodeSpacing = Number(nodeSpacingMatch[1]);
            continue;
        }
        const edgeMatch = line.match(EDGE_RE);
        if (edgeMatch) {
            edges.push({
                id: `edge_${edges.length + 1}_${edgeMatch[2]}_${edgeMatch[5]}`,
                source: edgeMatch[2]!,
                target: edgeMatch[5]!,
                sourceSide: nodeSide(edgeMatch[1]),
                targetSide: nodeSide(edgeMatch[4]),
                operator: edgeMatch[3] as EdgeOperator,
                label: unquoteLabel(edgeMatch[6]),
                declarationOrder: order++,
            });
            continue;
        }

        const declarationMatch = line.match(DECLARATION_RE);
        if (!declarationMatch) {
            const first = line.match(UNQUALIFIED_RE)?.[1];
            if (first && qualifiedCandidates(first).length) {
                throw new Error(`Line ${lineNumber}: symbol "${first}" must be namespaced; use ${qualifiedCandidates(first)[0]}`);
            }
            throw new Error(`Line ${lineNumber}: unsupported syntax: ${rawLine}`);
        }
        const symbol = parseSymbol(`${declarationMatch[1]}:${declarationMatch[2]}`, lineNumber);
        const explicitId = declarationMatch[3];
        const quotedLabel = declarationMatch[4];
        const opensBlock = Boolean(declarationMatch[5]);
        const container = symbol.definition.role === "container";
        if (opensBlock && !container) throw new Error(`Line ${lineNumber}: resource property blocks are not implemented`);
        if (!opensBlock && container) throw new Error(`Line ${lineNumber}: container ${symbol.ref.name} must open a block with {`);

        let id = explicitId ?? symbol.ref.name;
        if (!explicitId && symbol.definition.render === false) {
            do {
                anonymousNodeCount += 1;
                id = `__${symbol.ref.namespace}_${symbol.ref.name}_${anonymousNodeCount}`;
            } while (ids.has(id));
        }
        const label = quotedLabel !== undefined ? unescapeQuoted(quotedLabel) : explicitId ?? symbol.definition.defaultLabel ?? symbol.ref.name;
        if (ids.has(id)) throw new Error(`Line ${lineNumber}: duplicate node ID ${id}`);
        ids.add(id);
        const parent = stack.at(-1);
        const node: AstNode = {
            id,
            symbol: symbol.ref,
            definition: symbol.definition,
            label,
            parentId: parent?.id,
            children: [],
            declarationOrder: order++,
        };
        if (parent) parent.children.push(node); else rootNodes.push(node);
        if (opensBlock) stack.push(node);
    }
    if (stack.length) throw new Error(`Unclosed container: ${stack.at(-1)!.id}`);
    const nodesById = new Map<string, AstNode>();
    const pendingNodes = [...rootNodes];
    while (pendingNodes.length) {
        const node = pendingNodes.pop()!;
        nodesById.set(node.id, node);
        pendingNodes.push(...node.children);
    }
    for (const edge of edges) {
        if (!ids.has(edge.source)) throw new Error(`Unknown edge source: ${edge.source}`);
        if (!ids.has(edge.target)) throw new Error(`Unknown edge target: ${edge.target}`);
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        if (source?.definition.layoutOnly) throw new Error(`Layout-only container cannot be an edge endpoint: ${edge.source}`);
        if (target?.definition.layoutOnly) throw new Error(`Layout-only container cannot be an edge endpoint: ${edge.target}`);
        if (source && !isRenderable(source)) throw new Error(`Invisible node cannot be an edge endpoint: ${edge.source}`);
        if (target && !isRenderable(target)) throw new Error(`Invisible node cannot be an edge endpoint: ${edge.target}`);
    }
    const containers = [...rootNodes];
    while (containers.length) {
        const container = containers.pop()!;
        if (container.gridColumns === undefined) {
            containers.push(...container.children);
            continue;
        }
        if (!container.children.length) throw new Error(`grid-columns requires at least one child (container ${container.id})`);
        containers.push(...container.children);
    }
    return { direction, nodes: rootNodes, edges };
}
