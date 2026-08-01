import type { SymbolDefinition, SymbolProvider, SymbolRef } from "../model.js";
import { awsProvider } from "./aws.js";
import { coreProvider } from "./core.js";

const providers = new Map<string, SymbolProvider>([
    [coreProvider.namespace, coreProvider],
    [awsProvider.namespace, awsProvider],
]);

export function registeredNamespaces(): string[] {
    return [...providers.keys()].sort();
}

export function qualifiedCandidates(name: string): string[] {
    const candidates: string[] = [];
    for (const provider of providers.values()) {
        const canonical = provider.aliases?.[name] ?? name;
        if (provider.symbols[canonical]) candidates.push(`${provider.namespace}:${canonical}`);
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

    const canonicalName = provider.aliases?.[ref.name] ?? ref.name;
    const definition = provider.symbols[canonicalName];
    if (!definition) {
        const names = Object.keys(provider.symbols).filter((name) => name.includes(ref.name)).slice(0, 3);
        const hint = names.length ? `; did you mean ${names.map((name) => `${ref.namespace}:${name}`).join(", ")}` : "";
        throw new Error(`unknown symbol "${ref.namespace}:${ref.name}"${hint}`);
    }
    return { ref: { namespace: ref.namespace, name: canonicalName }, definition };
}
