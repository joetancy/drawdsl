import { CONNECTIONS_LAYER_ID, DslError, isRenderable, type AstEdge, type AstLayer, type AstNode, type Direction, type DocumentAst, type EdgeOperator, type NodeSide, type SymbolRef } from "./model.js";
import { layoutNumber, normalizeLayoutConfig, type ContainerLayoutOptions, type ParsedLayoutConfig } from "./config.js";
import { qualifiedCandidates, resolveSymbol } from "./symbols/registry.js";

const EDGE_RE = /^(?:([TRBLtrbl]):)?([A-Za-z_][\w-]*)\s*(<-->|<-\.->|-->|-\.->|---|-\.-)\s*(?:([TRBLtrbl]):)?([A-Za-z_][\w-]*)(?:\s+\[([^\]]*)\])?(?:\s*:\s*(.+?))?\s*$/;
const CHAIN_OPERATOR_RE = /\s*(<-->|<-\.->|-->|-\.->|---|-\.-)\s*/g;
const ENDPOINT_RE = /^(?:([TRBLtrbl]):)?([A-Za-z_][\w-]*)$/;
const DIRECTION_RE = /^direction\s+(right|left|down|up)$/;
const DEFAULT_LAYOUT_RE = /^layout\s+elk$/;
const GRID_COLUMNS_RE = /^(col|grid-columns)\s+(\S+)$/;
const LAYOUT_SETTING_RE = /^(node-spacing|layer-spacing|edge-spacing|padding)(?:\s+(.*))?$/;
const COLOR_DECL_RE = /^color\s+([A-Za-z_][\w-]*)\s*=\s*(#\S+)$/;
const LAYER_RE = /^layer\s+([A-Za-z_][\w-]*)(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s+\[([^\]]*)\])?\s*\{$/;
const DECLARATION_RE = /^([A-Za-z_][\w-]*):([A-Za-z_][\w-]*)(?:\s+([A-Za-z_][\w-]*))?(?:\s+"((?:[^"\\]|\\.)*)")?(?:\s+\[([^\]]*)\])?\s*(\{)?$/;
const UNQUALIFIED_RE = /^([A-Za-z_][\w-]*)\b/;

function scanLine(line: string): { commentIndex: number; unclosedQuote: boolean } {
    let quoted = false;
    let escaped = false;
    for (let i = 0; i < line.length; i += 1) {
        const c = line[i];
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === '"') quoted = !quoted;
        if (c === "#" && !quoted && !line.slice(0, i).trimEnd().endsWith("=")) return { commentIndex: i, unclosedQuote: quoted };
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

export function isBlockOpener(code: string): boolean {
    return Boolean(code.match(DECLARATION_RE)?.[6]) || LAYER_RE.test(code);
}

function unescapeQuoted(value: string): string {
    // ponytail: single pass so `\\n` (backslash + n) is not decoded as newline.
    return value.replace(/\\(.)/g, (match, code: string) => code === "n" ? "\n" : code === '"' ? '"' : code === "\\" ? "\\" : match);
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

function hexColor(value: string): string | undefined {
    if (!/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return undefined;
    const hex = value.slice(1).toUpperCase();
    return `#${hex.length === 3 ? [...hex].map((digit) => digit.repeat(2)).join("") : hex}`;
}

function colorValue(value: string, colors: Map<string, string>): string | undefined {
    return hexColor(value) ?? colors.get(value);
}

type EdgeOptions = Pick<AstEdge, "color" | "width" | "layerId">;

function edgeOptions(raw: string | undefined, colors: Map<string, string>, lineNumber: number): EdgeOptions {
    if (raw === undefined) return {};
    const result: EdgeOptions = {};
    for (const option of raw.split(",")) {
        const match = option.trim().match(/^(color|width|layer)\s*=\s*(\S+)$/);
        if (!match) throw new DslError(`Line ${lineNumber}: invalid edge option: ${option.trim()}`, lineNumber);
        const key = match[1]!;
        const value = match[2]!;
        if (key === "layer") {
            if (result.layerId !== undefined) throw new DslError(`Line ${lineNumber}: duplicate edge layer`, lineNumber);
            if (!/^[A-Za-z_][\w-]*$/.test(value)) throw new DslError(`Line ${lineNumber}: invalid layer ID: ${value}`, lineNumber);
            result.layerId = value;
            continue;
        }
        if (key === "width") {
            if (result.width !== undefined) throw new DslError(`Line ${lineNumber}: duplicate edge width`, lineNumber);
            result.width = layoutNumber("edge-width", value, lineNumber);
            continue;
        }
        if (result.color !== undefined) throw new DslError(`Line ${lineNumber}: duplicate edge color`, lineNumber);
        const color = colorValue(value, colors);
        if (!color) throw new DslError(`Line ${lineNumber}: invalid or unknown edge color: ${value}`, lineNumber);
        result.color = color;
    }
    return result;
}

function layerOptions(raw: string | undefined, colors: Map<string, string>, lineNumber: number): Pick<AstLayer, "color" | "width" | "visible"> {
    const result: Pick<AstLayer, "color" | "width" | "visible"> = { visible: true };
    const seen = new Set<string>();
    if (raw === undefined) return result;
    for (const option of raw.split(",")) {
        const match = option.trim().match(/^(color|width|visible)\s*=\s*(\S+)$/);
        if (!match) throw new DslError(`Line ${lineNumber}: invalid layer option: ${option.trim()}`, lineNumber);
        const key = match[1]!;
        const value = match[2]!;
        if (seen.has(key)) throw new DslError(`Line ${lineNumber}: duplicate layer ${key}`, lineNumber);
        seen.add(key);
        if (key === "visible") {
            if (value !== "true" && value !== "false") throw new DslError(`Line ${lineNumber}: layer visible must be true or false`, lineNumber);
            result.visible = value === "true";
        } else {
            Object.assign(result, edgeOptions(option, colors, lineNumber));
        }
    }
    return result;
}

function parseEdgeChain(line: string): Array<{ id: string; side?: NodeSide; operator?: EdgeOperator }> | undefined {
    const operators = [...line.matchAll(CHAIN_OPERATOR_RE)];
    if (operators.length < 2) return undefined;
    const parts = line.split(CHAIN_OPERATOR_RE).filter((_, index) => index % 2 === 0);
    if (parts.length !== operators.length + 1) return undefined;
    const endpoints = parts.map((part) => part.trim().match(ENDPOINT_RE));
    if (endpoints.some((match) => !match)) return undefined;
    return endpoints.map((match, index) => ({
        id: match![2]!,
        side: nodeSide(match![1]),
        operator: index ? operators[index - 1]![1] as EdgeOperator : undefined,
    }));
}

function parseSymbol(raw: string, lineNumber: number): { ref: SymbolRef; definition: ReturnType<typeof resolveSymbol>["definition"] } {
    const match = raw.match(/^([^:]+):(.+)$/);
    if (!match) {
        const candidates = qualifiedCandidates(raw);
        const hint = candidates.length ? `; use ${candidates[0]}` : "";
        throw new DslError(`Line ${lineNumber}: symbol "${raw}" must be namespaced${hint}`, lineNumber);
    }
    try {
        return resolveSymbol({ namespace: match[1]!, name: match[2]! });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new DslError(`Line ${lineNumber}: ${message}`, lineNumber);
    }
}

export function parseDsl(source: string): DocumentAst {
    const rootNodes: AstNode[] = [];
    const edges: AstEdge[] = [];
    const layers: AstLayer[] = [{ id: CONNECTIONS_LAYER_ID, label: "Connections", visible: true, declarationOrder: -1 }];
    let activeLayer: AstLayer | undefined;
    const stack: AstNode[] = [];
    const ids = new Set<string>();
    const parsedLayout: ParsedLayoutConfig = {};
    const documentSettings = new Set<string>();
    const colors = new Map<string, string>();
    let order = 0;
    let anonymousNodeCount = 0;

    const sourceLines = source.split(/\r?\n/);
    for (let index = 0; index < sourceLines.length; index += 1) {
        const lineNumber = index + 1;
        let rawLine = sourceLines[index]!;
        while (hasUnclosedQuote(rawLine)) {
            index += 1;
            if (index >= sourceLines.length) throw new DslError(`Line ${lineNumber}: unclosed quoted label`, lineNumber);
            rawLine += `\n${sourceLines[index]!}`;
        }
        const line = stripComment(rawLine).trim();
        if (!line) continue;
        const layerMatch = line.match(LAYER_RE);
        if (layerMatch) {
            if (stack.length || activeLayer) throw new DslError(`Line ${lineNumber}: layers must be top-level and cannot be nested`, lineNumber);
            const id = layerMatch[1]!;
            if (id === CONNECTIONS_LAYER_ID) throw new DslError(`Line ${lineNumber}: layer ID ${id} is reserved for unassigned connections`, lineNumber);
            if (layers.some((layer) => layer.id === id)) throw new DslError(`Line ${lineNumber}: duplicate layer ID ${id}`, lineNumber);
            activeLayer = {
                id,
                label: layerMatch[2] === undefined ? id : unescapeQuoted(layerMatch[2]),
                ...layerOptions(layerMatch[3], colors, lineNumber),
                declarationOrder: layers.length,
                line: lineNumber,
            };
            layers.push(activeLayer);
            continue;
        }
        if (line === "}") {
            if (activeLayer) { activeLayer = undefined; continue; }
            if (!stack.length) throw new DslError(`Line ${lineNumber}: unexpected }`, lineNumber);
            stack.pop();
            continue;
        }
        // Parse a complete chain first: a selector colon is not an edge label separator.
        const chain = parseEdgeChain(line);
        const edgeMatch = chain ? null : line.match(EDGE_RE);
        if (activeLayer && !edgeMatch && !chain) throw new DslError(`Line ${lineNumber}: only edges are allowed inside layer ${activeLayer.id}`, lineNumber);
        const colorMatch = line.match(COLOR_DECL_RE);
        if (colorMatch) {
            if (stack.length) throw new DslError(`Line ${lineNumber}: color constants must be top-level`, lineNumber);
            const name = colorMatch[1]!;
            const color = hexColor(colorMatch[2]!);
            if (!color) throw new DslError(`Line ${lineNumber}: color must be a 3- or 6-digit hex value`, lineNumber);
            if (colors.has(name)) throw new DslError(`Line ${lineNumber}: color ${name} is already defined`, lineNumber);
            colors.set(name, color);
            continue;
        }
        if (DEFAULT_LAYOUT_RE.test(line)) {
            if (stack.length) throw new DslError(`Line ${lineNumber}: layout must be top-level`, lineNumber);
            continue;
        }
        const directionMatch = line.match(DIRECTION_RE);
        if (directionMatch) {
            const container = stack.at(-1);
            if (!container) {
                if (parsedLayout.direction !== undefined) throw new DslError(`Line ${lineNumber}: direction is already set at document level`, lineNumber);
                parsedLayout.direction = directionMatch[1] as Direction;
            } else {
                container.layout ??= {};
                if (container.layout.direction !== undefined) throw new DslError(`Line ${lineNumber}: direction is already set for container ${container.id}`, lineNumber);
                container.layout.direction = directionMatch[1] as Direction;
            }
            continue;
        }
        const gridColumnsMatch = line.match(GRID_COLUMNS_RE);
        if (gridColumnsMatch) {
            const container = stack.at(-1);
            const directive = gridColumnsMatch[1]!;
            const name = directive === "grid-columns" ? directive : "col";
            if (!container) throw new DslError(`Line ${lineNumber}: ${name} must be inside a container`, lineNumber);
            container.layout ??= {};
            if (container.layout.gridColumns !== undefined) throw new DslError(`Line ${lineNumber}: ${name} is already set for container ${container.id}`, lineNumber);
            container.layout.gridColumns = layoutNumber(name, gridColumnsMatch[2], lineNumber);
            continue;
        }
        const layoutSettingMatch = line.match(LAYOUT_SETTING_RE);
        if (layoutSettingMatch) {
            const name = layoutSettingMatch[1]!;
            const container = stack.at(-1);
            if (name === "edge-spacing" && container) throw new DslError(`Line ${lineNumber}: edge-spacing must be top-level`, lineNumber);
            const key = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()) as keyof ParsedLayoutConfig;
            const value = layoutNumber(name, layoutSettingMatch[2], lineNumber, name === "padding");
            if (container) {
                container.layout ??= {};
                if (container.layout[key as keyof ContainerLayoutOptions] !== undefined) throw new DslError(`Line ${lineNumber}: ${name} is already set for container ${container.id}`, lineNumber);
                Object.assign(container.layout, { [key]: value });
            } else {
                if (documentSettings.has(name)) throw new DslError(`Line ${lineNumber}: ${name} is already set at document level`, lineNumber);
                documentSettings.add(name);
                Object.assign(parsedLayout, { [key]: value });
            }
            continue;
        }
        if (edgeMatch) {
            const options = edgeOptions(edgeMatch[6], colors, lineNumber);
            if (activeLayer && options.layerId !== undefined && options.layerId !== activeLayer.id) throw new DslError(`Line ${lineNumber}: edge layer ${options.layerId} conflicts with containing layer ${activeLayer.id}`, lineNumber);
            edges.push({
                id: `edge:${edges.length + 1}:${edgeMatch[2]}:${edgeMatch[5]}`,
                source: edgeMatch[2]!,
                target: edgeMatch[5]!,
                sourceSide: nodeSide(edgeMatch[1]),
                targetSide: nodeSide(edgeMatch[4]),
                operator: edgeMatch[3] as EdgeOperator,
                label: unquoteLabel(edgeMatch[7]),
                ...options,
                layerId: options.layerId ?? activeLayer?.id ?? CONNECTIONS_LAYER_ID,
                declarationOrder: order++,
                line: lineNumber,
            });
            continue;
        }
        if (chain) {
            for (let position = 1; position < chain.length; position += 1) {
                const source = chain[position - 1]!;
                const target = chain[position]!;
                edges.push({
                    id: `edge:${edges.length + 1}:${source.id}:${target.id}`,
                    source: source.id,
                    target: target.id,
                    sourceSide: source.side,
                    targetSide: target.side,
                    operator: target.operator!,
                    layerId: activeLayer?.id ?? CONNECTIONS_LAYER_ID,
                    declarationOrder: order++,
                    line: lineNumber,
                });
            }
            continue;
        }

        const declarationMatch = line.match(DECLARATION_RE);
        if (!declarationMatch) {
            const first = line.match(UNQUALIFIED_RE)?.[1];
            if (first && qualifiedCandidates(first).length) {
                throw new DslError(`Line ${lineNumber}: symbol "${first}" must be namespaced; use ${qualifiedCandidates(first)[0]}`, lineNumber);
            }
            throw new DslError(`Line ${lineNumber}: unsupported syntax: ${rawLine}`, lineNumber);
        }
        const symbol = parseSymbol(`${declarationMatch[1]}:${declarationMatch[2]}`, lineNumber);
        const explicitId = declarationMatch[3];
        const quotedLabel = declarationMatch[4];
        const opensBlock = Boolean(declarationMatch[6]);
        let backgroundColor: string | undefined;
        const rawGroupOptions = declarationMatch[5];
        if (rawGroupOptions !== undefined) {
            if (symbol.ref.namespace !== "core" || symbol.ref.name !== "group") throw new DslError(`Line ${lineNumber}: background color is only supported on core:group`, lineNumber);
            const option = rawGroupOptions.trim().match(/^background\s*=\s*(\S+)$/);
            if (!option) throw new DslError(`Line ${lineNumber}: invalid group option: ${rawGroupOptions}`, lineNumber);
            backgroundColor = colorValue(option[1]!, colors);
            if (!backgroundColor) throw new DslError(`Line ${lineNumber}: invalid or unknown group background color: ${option[1]}`, lineNumber);
        }
        const label = quotedLabel !== undefined ? unescapeQuoted(quotedLabel) : explicitId ?? symbol.definition.defaultLabel ?? symbol.ref.name;
        if (symbol.ref.namespace === "core" && symbol.ref.name === "image") {
            if (quotedLabel === undefined) throw new DslError(`Line ${lineNumber}: core:image requires a quoted absolute HTTP(S) URL`, lineNumber);
            let url: URL;
            try {
                url = new URL(label);
            } catch {
                throw new DslError(`Line ${lineNumber}: core:image requires a quoted absolute HTTP(S) URL`, lineNumber);
            }
            if (url.protocol !== "http:" && url.protocol !== "https:") throw new DslError(`Line ${lineNumber}: core:image requires a quoted absolute HTTP(S) URL`, lineNumber);
            if (label.includes(";")) throw new DslError(`Line ${lineNumber}: core:image URL must not contain ";"`, lineNumber);
        }
        const container = symbol.definition.role === "container";
        if (opensBlock && !container) throw new DslError(`Line ${lineNumber}: resource property blocks are not implemented`, lineNumber);
        if (!opensBlock && container) throw new DslError(`Line ${lineNumber}: container ${symbol.ref.name} must open a block with {`, lineNumber);

        let id = explicitId ?? symbol.ref.name;
        const anonymousText = symbol.ref.namespace === "core" && symbol.ref.name === "text";
        if (!explicitId && (symbol.definition.render === false || symbol.definition.layoutOnly || anonymousText)) {
            do {
                anonymousNodeCount += 1;
                id = `__${symbol.ref.namespace}_${symbol.ref.name}_${anonymousNodeCount}`;
            } while (ids.has(id));
        }
        if (ids.has(id)) throw new DslError(`Line ${lineNumber}: duplicate node ID ${id}`, lineNumber);
        ids.add(id);
        const parent = stack.at(-1);
        const node: AstNode = {
            id,
            symbol: symbol.ref,
            definition: symbol.definition,
            label,
            ...(backgroundColor ? { backgroundColor } : {}),
            parentId: parent?.id,
            children: [],
            declarationOrder: order++,
            line: lineNumber,
        };
        if (parent) parent.children.push(node); else rootNodes.push(node);
        if (opensBlock) stack.push(node);
    }
    if (activeLayer) throw new DslError(`Line ${activeLayer.line}: unclosed layer: ${activeLayer.id}`, activeLayer.line);
    if (stack.length) {
        const unclosed = stack.at(-1)!;
        throw new DslError(`Line ${unclosed.line ?? "?"}: unclosed container: ${unclosed.id}`, unclosed.line);
    }
    const nodesById = new Map<string, AstNode>();
    const pendingNodes = [...rootNodes];
    while (pendingNodes.length) {
        const node = pendingNodes.pop()!;
        nodesById.set(node.id, node);
        if (node.layout?.gridColumns !== undefined && !node.children.length) throw new DslError(`Line ${node.line ?? "?"}: col requires at least one child (container ${node.id})`, node.line);
        pendingNodes.push(...node.children);
    }
    const layersById = new Map(layers.map((layer) => [layer.id, layer]));
    for (const edge of edges) {
        if (!ids.has(edge.source)) throw new DslError(`Line ${edge.line}: unknown edge source: ${edge.source}`, edge.line);
        if (!ids.has(edge.target)) throw new DslError(`Line ${edge.line}: unknown edge target: ${edge.target}`, edge.line);
        const source = nodesById.get(edge.source);
        const target = nodesById.get(edge.target);
        if (source?.definition.layoutOnly) throw new DslError(`Line ${edge.line}: Layout-only container cannot be an edge endpoint: ${edge.source}`, edge.line);
        if (target?.definition.layoutOnly) throw new DslError(`Line ${edge.line}: Layout-only container cannot be an edge endpoint: ${edge.target}`, edge.line);
        if (source && !isRenderable(source)) throw new DslError(`Line ${edge.line}: Invisible node cannot be an edge endpoint: ${edge.source}`, edge.line);
        if (target && !isRenderable(target)) throw new DslError(`Line ${edge.line}: Invisible node cannot be an edge endpoint: ${edge.target}`, edge.line);
        const layer = layersById.get(edge.layerId ?? CONNECTIONS_LAYER_ID);
        if (!layer) throw new DslError(`Line ${edge.line}: unknown edge layer: ${edge.layerId}`, edge.line);
        if (edge.color === undefined && layer.color !== undefined) edge.color = layer.color;
        if (edge.width === undefined && layer.width !== undefined) edge.width = layer.width;
    }
    return { layout: normalizeLayoutConfig(parsedLayout), nodes: rootNodes, edges, layers };
}
