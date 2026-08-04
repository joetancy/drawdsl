import type { SymbolProvider } from "../model.js";

export const coreProvider: SymbolProvider = {
    namespace: "core",
    symbols: {
        text: {
            role: "annotation",
            drawio: {
                shape: "rectangle",
                fill: "#ffffff",
                stroke: "#64748b",
                styles: [
                    "rounded=0",
                    "whiteSpace=wrap",
                    "html=1",
                    "fontColor=#232F3E",
                    "align=left",
                    "verticalAlign=middle",
                    "spacing=8",
                    "fontSize=14",
                ],
            },
        },
        image: {
            role: "resource",
            widthScale: 2,
            drawio: {
                shape: "image",
                styles: ["imageAspect=0", "aspect=fixed", "html=1"],
            },
        },
        group: {
            role: "container",
            drawio: {
                shape: "rectangle",
                fill: "none",
                stroke: "#879196",
                styles: ["rounded=1", "fontColor=#232F3E"],
            },
        },
        layout: {
            role: "container",
            layoutOnly: true,
            drawio: {
                shape: "rectangle",
            },
        },
        spacer: {
            role: "resource",
            render: false,
            defaultLabel: "",
            drawio: {
                shape: "rectangle",
            },
        },
        box: {
            role: "resource",
            drawio: {
                shape: "rectangle",
                fill: "#ffffff",
                stroke: "#64748b",
                styles: ["rounded=1", "whiteSpace=wrap", "html=1"],
            },
        },
    },
};
