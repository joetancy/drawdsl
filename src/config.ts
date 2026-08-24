import type { Direction } from "./model.js";

export type Insets = { top: number; right: number; bottom: number; left: number };

export type ParsedLayoutConfig = {
    direction?: Direction;
    nodeSpacing?: number;
    layerSpacing?: number;
    edgeSpacing?: number;
    padding?: number;
};

export type ContainerLayoutOptions = Omit<ParsedLayoutConfig, "edgeSpacing"> & {
    gridColumns?: number;
};

export type LayoutConfig = {
    direction: Direction;
    nodeSpacing: { root: number; resource: number; container: number };
    layerSpacing: number;
    edgeSpacing: number;
    padding: { root: Insets; container: Insets; layoutOnly: Insets };
    edgeEndpointClearance: number;
};

export const DRAWING_DEFAULTS = {
    iconSize: 80,
    textBox: {
        minWidth: 160,
        maxWidth: 360,
        horizontalPadding: 15,
        lineHeight: 20,
        verticalPadding: 15,
    },
    container: {
        minWidth: 240,
        minHeight: 120,
    },
} as const;

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
    direction: "right",
    nodeSpacing: { root: 240, resource: 80, container: 160 },
    layerSpacing: 240,
    edgeSpacing: 20,
    padding: {
        root: { top: 40, right: 40, bottom: 40, left: 40 },
        container: { top: 40, right: 80, bottom: 40, left: 80 },
        layoutOnly: { top: 0, right: 0, bottom: 0, left: 0 },
    },
    edgeEndpointClearance: 40,
};

const allSides = (value: number): Insets => ({ top: value, right: value, bottom: value, left: value });

function validateLayoutNumber(name: string, value: number, allowZero: boolean, prefix = ""): number {
    const minimum = allowZero ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > 10_000) {
        throw new Error(`${prefix}${name} must be an integer from ${minimum} to 10000`);
    }
    return value;
}

export function layoutNumber(name: string, raw: string | undefined, lineNumber: number, allowZero = false): number {
    const value = Number(raw);
    if (!raw || !/^\d+$/.test(raw)) return validateLayoutNumber(name, Number.NaN, allowZero, `Line ${lineNumber}: `);
    return validateLayoutNumber(name, value, allowZero, `Line ${lineNumber}: `);
}

export function normalizeLayoutConfig(parsed: ParsedLayoutConfig): LayoutConfig {
    if (parsed.nodeSpacing !== undefined) validateLayoutNumber("node-spacing", parsed.nodeSpacing, false);
    if (parsed.layerSpacing !== undefined) validateLayoutNumber("layer-spacing", parsed.layerSpacing, false);
    if (parsed.edgeSpacing !== undefined) validateLayoutNumber("edge-spacing", parsed.edgeSpacing, false);
    if (parsed.padding !== undefined) validateLayoutNumber("padding", parsed.padding, true);
    const nodeSpacing = parsed.nodeSpacing === undefined
        ? { ...DEFAULT_LAYOUT_CONFIG.nodeSpacing }
        : { root: parsed.nodeSpacing, resource: parsed.nodeSpacing, container: parsed.nodeSpacing };
    const padding = parsed.padding === undefined
        ? {
            root: { ...DEFAULT_LAYOUT_CONFIG.padding.root },
            container: { ...DEFAULT_LAYOUT_CONFIG.padding.container },
            layoutOnly: { ...DEFAULT_LAYOUT_CONFIG.padding.layoutOnly },
        }
        : { root: allSides(parsed.padding), container: allSides(parsed.padding), layoutOnly: allSides(parsed.padding) };
    return {
        direction: parsed.direction ?? DEFAULT_LAYOUT_CONFIG.direction,
        nodeSpacing,
        layerSpacing: parsed.layerSpacing ?? DEFAULT_LAYOUT_CONFIG.layerSpacing,
        edgeSpacing: parsed.edgeSpacing ?? DEFAULT_LAYOUT_CONFIG.edgeSpacing,
        padding,
        edgeEndpointClearance: DEFAULT_LAYOUT_CONFIG.edgeEndpointClearance,
    };
}
