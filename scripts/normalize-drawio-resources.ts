import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { RESOURCE_ALIASES } from "../src/symbols/resource-aliases.js";

type RawResource = { provider: string; title: string; tags: string; style: string; width: number; height: number; type: string; drawioShape: string };
const namespaceMap: Record<string, string> = { "mxgraph.aws4": "aws", "mxgraph.azure": "azure", "mxgraph.azure2": "azure", "mxgraph.gcp": "gcp", "mxgraph.gcp2": "gcp" };
const providerTitle: Record<string, string> = { aws: "AWS", azure: "Azure", gcp: "Google Cloud" };
const displayTitle = (provider: string, title: string, name: string): string => {
    const label = title || name.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return label.toLowerCase().startsWith(providerTitle[provider]!.toLowerCase()) ? label : `${providerTitle[provider]} ${label}`;
};
export function getResourceShape(style: string): string | undefined {
    for (const key of ["resIcon", "grIcon", "shape"]) {
        const value = style.match(new RegExp(`(?:^|;)${key}=([^;]+)`))?.[1];
        if (value && value !== "mxgraph.aws4.resourceIcon" && value !== "mxgraph.aws4.group") return value;
    }
    return undefined;
}

export function normalizeResources(raw: RawResource[]) {
    const output: Record<string, { title: string; drawioShape: string; style: string; width: number; height: number; tags: string[] }> = {};
    const origins = new Map<string, RawResource>();
    let skipped = 0;
    let collisionsResolved = 0;
    for (const item of raw) {
        const shape = getResourceShape(item.style) ?? item.drawioShape;
        const prefix = shape.split(".").slice(0, 2).join(".");
        const provider = namespaceMap[prefix];
        if (!provider || provider !== item.provider || item.type !== "vertex") { skipped++; continue; }
        const name = shape.split(".").at(-1)!.replace(/[^a-zA-Z0-9_-]/g, "_");
        let id = `${provider}:${name}`;
        const previous = origins.get(id);
        if (previous) {
            // Newer Azure/GCP libraries win only for an identical resource name; distinct styles are ambiguity, not an arbitrary overwrite.
            const previousPrefix = getResourceShape(previous.style)?.split(".").slice(0, 2).join(".");
            if (previousPrefix !== prefix && previous.style !== item.style && ["mxgraph.azure2", "mxgraph.gcp2"].includes(prefix)) {
                origins.set(id, item);
                output[id] = { title: displayTitle(provider, item.title, name), drawioShape: shape, style: item.style, width: item.width, height: item.height, tags: item.tags.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) };
                continue;
            }
            if (previous.style !== item.style) {
                const colorMatch = item.style.match(/(?:^|;)(fillColor|strokeColor)=(#[\da-f]{3,8})/i);
                id = colorMatch
                    ? `${id}_${colorMatch[1] === "fillColor" ? "fill" : "stroke"}_${colorMatch[2]!.slice(1).toLowerCase()}`
                    : `${id}_variant_${createHash("sha1").update(item.style).digest("hex").slice(0, 8)}`;
                console.warn(`Resolved style variant collision as ${id}`);
                if (origins.has(id)) id = `${id}_variant_${createHash("sha1").update(item.style).digest("hex").slice(0, 8)}`;
                if (origins.has(id)) throw new Error(`Unresolved resource collision for ${id}: ${previous.drawioShape} and ${shape}`);
                collisionsResolved++;
            } else { skipped++; continue; }
        }
        origins.set(id, item);
        output[id] = { title: displayTitle(provider, item.title, name), drawioShape: shape, style: item.style, width: item.width, height: item.height, tags: item.tags.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) };
    }
    const sorted = Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
    return { resources: sorted, skipped, collisionsResolved };
}

if (process.argv[1]?.endsWith("normalize-drawio-resources.ts")) {
    const raw = JSON.parse(await readFile(new URL("../src/generated/drawio-resources.raw.json", import.meta.url), "utf8")) as RawResource[];
    const { resources, skipped, collisionsResolved } = normalizeResources(raw);
    const counts = Object.fromEntries(["aws", "azure", "gcp"].map((provider) => [provider, Object.keys(resources).filter((id) => id.startsWith(`${provider}:`)).length]));
    for (const [provider, minimum] of Object.entries({ aws: 300, azure: 80, gcp: 80 })) if (counts[provider]! < minimum) throw new Error(`Provider catalogue incomplete: ${provider} has ${counts[provider]} resources; expected at least ${minimum}`);
    for (const [id, item] of Object.entries(resources)) if (!item.style || !Number.isFinite(item.width) || !Number.isFinite(item.height) || item.width <= 0 || item.height <= 0) throw new Error(`Invalid style or dimensions: ${id}`);
    for (const required of ["aws:lambda", "aws:s3", "aws:dynamodb"]) if (!resources[required]) throw new Error(`Missing required resource ${required}`);
    for (const required of ["azure:virtual_machine", "gcp:big_query"]) if (!resources[required]) throw new Error(`Missing cloud provider smoke resource ${required}`);
    for (const [provider, aliases] of Object.entries(RESOURCE_ALIASES)) for (const [alias, target] of Object.entries(aliases)) if (!resources[`${provider}:${target}`]) throw new Error(`Alias ${provider}:${alias} points to missing resource ${provider}:${target}`);
    const ts = `export const DRAWIO_RESOURCES = ${JSON.stringify(resources, null, 4)} as const;\n\nexport type DrawioResourceId = keyof typeof DRAWIO_RESOURCES;\n`;
    await writeFile(new URL("../src/generated/drawio-resources.json", import.meta.url), `${JSON.stringify(resources, null, 2)}\n`);
    await writeFile(new URL("../src/generated/drawio-resources.ts", import.meta.url), ts);
    const aliases = Object.values(RESOURCE_ALIASES).reduce((total, entries) => total + Object.keys(entries).length, 0);
    console.log(`Draw.io resources generated\nAWS: ${counts.aws}\nAzure: ${counts.azure}\nGCP: ${counts.gcp}\nTotal: ${Object.keys(resources).length}\nDuplicates removed: ${skipped}\nAliases: ${aliases}\nCollisions resolved: ${collisionsResolved}\nUnresolved collisions: 0\nResources skipped: ${skipped}`);
}
