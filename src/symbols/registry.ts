import type { SymbolDefinition, SymbolProvider, SymbolRef } from "../model.js";
import { awsProvider } from "./aws.js";
import { coreProvider } from "./core.js";
import { DRAWIO_RESOURCES } from "../generated/drawio-resources.js";
import { RESOURCE_ALIASES } from "./resource-aliases.js";

const cloudSymbols = Object.fromEntries(Object.entries(DRAWIO_RESOURCES).map(([id, resource]) => {
    const namespace = id.split(":")[0]!;
    const name = id.slice(namespace.length + 1);
    const legacy = namespace === "aws" ? awsProvider.symbols[name] : undefined;
    const definition = legacy?.role === "container" ? legacy : {
        ...(legacy ?? { role: "resource" as const, drawio: { shape: resource.drawioShape } }),
        drawio: { ...(legacy?.drawio ?? { shape: resource.drawioShape }), style: resource.style },
        width: resource.width || legacy?.width,
        height: resource.height || legacy?.height,
        defaultLabel: resource.title || legacy?.defaultLabel,
    };
    return [id, definition];
}));
const cloudProviders: SymbolProvider[] = ["aws", "azure", "gcp"].map((namespace) => ({
    namespace,
    symbols: { ...(namespace === "aws" ? awsProvider.symbols : {}), ...Object.fromEntries(Object.entries(cloudSymbols).filter(([id]) => id.startsWith(`${namespace}:`)).map(([id, definition]) => [id.slice(namespace.length + 1), definition])) },
    aliases: { ...(namespace === "aws" ? awsProvider.aliases : {}), ...RESOURCE_ALIASES[namespace] },
}));

const providers = new Map<string, SymbolProvider>([
    [coreProvider.namespace, coreProvider],
    ...cloudProviders.map((provider) => [provider.namespace, provider] as const),
]);

export function registeredNamespaces(): string[] {
    return [...providers.keys()].sort();
}

export function registeredSymbols(): Array<{ label: string; detail: string }> {
    return [...providers.values()].flatMap((provider) => [
        ...Object.entries(provider.symbols).map(([name, definition]) => ({ label: `${provider.namespace}:${name}`, detail: definition.role })),
        ...Object.entries(provider.aliases ?? {}).map(([alias, name]) => ({ label: `${provider.namespace}:${alias}`, detail: `alias for ${provider.namespace}:${name}` })),
    ]).sort((a, b) => a.label.localeCompare(b.label));
}

export function qualifiedCandidates(name: string): string[] {
    const candidates: string[] = [];
    for (const provider of providers.values()) {
        const canonical = provider.aliases && Object.hasOwn(provider.aliases, name)
            && !Object.hasOwn(provider.symbols, name) ? provider.aliases[name]! : name;
        if (Object.hasOwn(provider.symbols, canonical)) candidates.push(`${provider.namespace}:${canonical}`);
    }
    return candidates.sort();
}

export function resolveSymbol(ref: SymbolRef): { ref: SymbolRef; definition: SymbolDefinition } {
    const provider = providers.get(ref.namespace);
    if (!provider) {
        throw new Error(
            `unknown symbol namespace "${ref.namespace}"; available namespaces: ${registeredNamespaces().join(", ")}`,
        );
    }

    const canonicalName = Object.hasOwn(provider.symbols, ref.name)
        ? ref.name
        : provider.aliases && Object.hasOwn(provider.aliases, ref.name) ? provider.aliases[ref.name]! : ref.name;
    const definition = Object.hasOwn(provider.symbols, canonicalName)
        ? provider.symbols[canonicalName]!
        : undefined;
    if (!definition) {
        const names = Object.keys(provider.symbols).filter((name) => name.includes(ref.name)).slice(0, 3);
        const hint = names.length ? `; did you mean ${names.map((name) => `${ref.namespace}:${name}`).join(", ")}` : "";
        throw new Error(`unknown symbol "${ref.namespace}:${ref.name}"${hint}`);
    }
    return { ref: { namespace: ref.namespace, name: canonicalName }, definition };
}
