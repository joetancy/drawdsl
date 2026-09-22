import { resolve } from "node:path";
import { cp } from "node:fs/promises";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [{
        name: "copy-libavoid-wasm",
        async writeBundle(): Promise<void> {
            await cp(resolve(import.meta.dirname, "node_modules/libavoid-js/dist/libavoid.wasm"), resolve(import.meta.dirname, "dist/plugin/libavoid.wasm"));
        },
    }],
    build: {
        emptyOutDir: false,
        lib: { entry: resolve(import.meta.dirname, "src/plugin/drawio.ts"), formats: ["iife"], name: "DrawDslPlugin", fileName: "drawdsl-plugin" },
        outDir: "dist/plugin",
    },
});
