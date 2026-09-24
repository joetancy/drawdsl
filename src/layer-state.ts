export type LayerVisibility = { id: string; visible: boolean };

/** Explicit preview choices are separate from the document's default visibility. */
export class LayerState {
    private defaults = new Map<string, boolean>();
    private overrides = new Map<string, boolean>();

    sync(layers: readonly LayerVisibility[]): void {
        const defaults = new Map(layers.map((layer) => [layer.id, layer.visible]));
        if (defaults.size !== layers.length) throw new Error("Duplicate preview layer ID");
        this.defaults = defaults;
        for (const id of this.overrides.keys()) {
            if (!defaults.has(id)) this.overrides.delete(id);
        }
    }

    visible(id: string): boolean {
        if (!this.defaults.has(id)) throw new Error(`Unknown preview layer: ${id}`);
        return this.overrides.get(id) ?? this.defaults.get(id)!;
    }

    set(id: string, visible: boolean): void {
        if (!this.defaults.has(id)) throw new Error(`Unknown preview layer: ${id}`);
        this.overrides.set(id, visible);
    }

    setAll(visible: boolean): void {
        for (const id of this.defaults.keys()) this.overrides.set(id, visible);
    }

    reset(): void {
        this.overrides.clear();
    }
}
