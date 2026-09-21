import { hasUnclosedQuote, isBlockOpener, stripComment } from "./parser.js";

export type FoldRegion = { start: number; end: number };

export type FoldMaps = { displayToFull: number[]; fullToDisplay: (number | undefined)[] };

export function computeFoldRegions(source: string): FoldRegion[] {
    const physical = source.split(/\r?\n/);
    const regions: FoldRegion[] = [];
    const stack: number[] = [];
    let logical = "";
    let logicalStart = 0;
    const flush = (physicalEnd: number): void => {
        const code = stripComment(logical).trim();
        if (isBlockOpener(code)) stack.push(logicalStart);
        else if (code === "}" && stack.length) {
            const start = stack.pop()!;
            if (physicalEnd > start) regions.push({ start, end: physicalEnd });
        }
        logical = "";
    };
    for (let index = 0; index < physical.length; index += 1) {
        if (!logical) logicalStart = index;
        logical += (logical ? "\n" : "") + physical[index]!;
        if (!hasUnclosedQuote(logical)) flush(index);
    }
    if (logical) flush(physical.length - 1);
    return regions.sort((a, b) => a.start - b.start);
}

export function applyFolds(full: string, regions: FoldRegion[], foldedStarts: ReadonlySet<number>): { text: string; maps: FoldMaps } {
    const fullLines = full.split("\n");
    const hidden = new Set<number>();
    for (const region of regions) {
        if (!foldedStarts.has(region.start)) continue;
        for (let line = region.start + 1; line <= region.end; line += 1) hidden.add(line);
    }
    const displayToFull: number[] = [];
    const fullToDisplay: (number | undefined)[] = fullLines.map(() => undefined);
    const displayLines: string[] = [];
    fullLines.forEach((line, index) => {
        if (hidden.has(index)) return;
        fullToDisplay[index] = displayLines.length;
        displayToFull.push(index);
        displayLines.push(line);
    });
    return { text: displayLines.join("\n"), maps: { displayToFull, fullToDisplay } };
}

export type DisplayEdit = {
    full: string;
    fullStart: number;
    fullEnd: number;
    insertedCount: number;
    newDisplayToFull: number[];
};

// Reconciles a textarea edit (whole displayed lines) back into full coordinates.
// Folded lines have no displayed presence, so edits can only shift or drop folds, never corrupt them.
export function mergeDisplayEdit(oldFull: string, oldDisplayToFull: number[], oldDisplay: string, newDisplay: string): DisplayEdit {
    const oldLines = oldDisplay.split("\n");
    const newLines = newDisplay.split("\n");
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix += 1;
    const fullLines = oldFull.split("\n");
    const oldChangeEnd = oldLines.length - suffix;
    let fullStart: number;
    let fullEnd: number;
    if (prefix >= oldChangeEnd) {
        fullStart = fullEnd = prefix === 0 ? 0 : (oldDisplayToFull[prefix - 1] ?? fullLines.length - 1) + 1;
    } else {
        fullStart = oldDisplayToFull[prefix] ?? 0;
        fullEnd = (oldDisplayToFull[oldChangeEnd - 1] ?? fullLines.length - 1) + 1;
    }
    const inserted = newLines.slice(prefix, newLines.length - suffix);
    const full = [...fullLines.slice(0, fullStart), ...inserted, ...fullLines.slice(fullEnd)].join("\n");
    const oldChangedCount = oldChangeEnd - prefix;
    const delta = inserted.length - (fullEnd - fullStart);
    const newDisplayToFull = newLines.map((_, index) => {
        if (index < prefix) return oldDisplayToFull[index] ?? 0;
        if (index < prefix + inserted.length) return fullStart + (index - prefix);
        return (oldDisplayToFull[index - inserted.length + oldChangedCount] ?? fullLines.length - 1) + delta;
    });
    return { full, fullStart, fullEnd, insertedCount: inserted.length, newDisplayToFull };
}

export function remapFolds(oldRegions: FoldRegion[], oldFolded: ReadonlySet<number>, fullStart: number, fullEnd: number, insertedCount: number, newRegions: FoldRegion[]): Set<number> {
    const delta = insertedCount - (fullEnd - fullStart);
    const validStarts = new Set(newRegions.map((region) => region.start));
    const next = new Set<number>();
    for (const region of oldRegions) {
        if (!oldFolded.has(region.start)) continue;
        if (fullEnd <= region.start) {
            const shifted = region.start + delta;
            if (validStarts.has(shifted)) next.add(shifted);
        } else if (fullStart > region.end) {
            if (validStarts.has(region.start)) next.add(region.start);
        }
        // Overlapping edits drop the fold so hidden lines reappear instead of corrupting.
    }
    return next;
}

export function offsetToLineCol(lines: string[], offset: number): { line: number; col: number } {
    let rest = Math.max(0, offset);
    for (let line = 0; line < lines.length; line += 1) {
        if (rest <= lines[line]!.length) return { line, col: rest };
        rest -= lines[line]!.length + 1;
    }
    const last = Math.max(0, lines.length - 1);
    return { line: last, col: lines[last]?.length ?? 0 };
}

export function lineColToOffset(lines: string[], line: number, col: number): number {
    let offset = 0;
    for (let index = 0; index < Math.min(line, lines.length); index += 1) offset += lines[index]!.length + 1;
    return offset + Math.min(col, lines[Math.min(line, Math.max(0, lines.length - 1))]?.length ?? 0);
}
