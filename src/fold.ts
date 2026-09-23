import { hasUnclosedQuote, isBlockOpener, stripComment } from "./parser.js";

export type FoldRegion = { start: number; end: number };

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
