import type { EdgeOperator, FlatLayoutNode, RoutedEdge } from "../model.js";

function xmlEscape(value: string): string {
    return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;").replaceAll("\n", "&#xa;");
}
function styleString(tokens: readonly string[]): string { return `${tokens.join(";")};`; }

function nodeStyle(node: FlatLayoutNode): string {
    const drawio = node.definition.drawio;
    if (node.definition.role === "container") {
        return styleString([
            "points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]]",
            "outlineConnect=0", "gradientColor=none", "html=1", "whiteSpace=wrap", "fontSize=12", "fontStyle=0", "container=1", "pointerEvents=0", "collapsible=0", "recursiveResize=0", `shape=${drawio.shape}`, "verticalAlign=top", "align=left", "spacingLeft=30", "dashed=0",
            ...(drawio.fill ? [`fillColor=${drawio.fill}`] : []), ...(drawio.stroke ? [`strokeColor=${drawio.stroke}`] : []), ...(drawio.styles ?? []),
        ]);
    }
    if (node.definition.role === "annotation") {
        return styleString([`shape=${drawio.shape}`, ...(drawio.styles ?? []), ...(drawio.fill ? [`fillColor=${drawio.fill}`] : []), ...(drawio.stroke ? [`strokeColor=${drawio.stroke}`] : [])]);
    }
    return styleString(["sketch=0", "outlineConnect=0", "fontColor=#232F3E", "gradientColor=none", `fillColor=${drawio.fill ?? "#527FFF"}`, `strokeColor=${drawio.stroke ?? "#ffffff"}`, "dashed=0", "verticalLabelPosition=bottom", "verticalAlign=top", "align=center", "html=1", "fontSize=12", "fontStyle=0", "aspect=fixed", "pointerEvents=1", `shape=${drawio.shape}`, ...(drawio.resIcon ? [`resIcon=${drawio.resIcon}`] : []), ...(drawio.styles ?? [])]);
}

function edgeStyle(operator: EdgeOperator): string {
    const directed = operator === "-->" || operator === "-.->";
    const dashed = operator === "-.->" || operator === "-.-";
    return styleString(["edgeStyle=orthogonalEdgeStyle", "rounded=0", "orthogonalLoop=1", "jettySize=auto", "html=1", "strokeWidth=1", `endArrow=${directed ? "block" : "none"}`, `endFill=${directed ? "1" : "0"}`, "startArrow=none", `dashed=${dashed ? "1" : "0"}`]);
}

export function renderDrawio(nodes: FlatLayoutNode[], edges: RoutedEdge[]): string {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<mxfile host="app.diagrams.net" agent="drawdsl" version="26.0.0" type="device">',
        '  <diagram id="drawdsl" name="Architecture">',
        '    <mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">',
        "      <root>", '        <mxCell id="0"/>', '        <mxCell id="1" parent="0"/>',
    ];
    const ordered = [...nodes].sort((a, b) => Number(b.definition.role === "container") - Number(a.definition.role === "container") || a.declarationOrder - b.declarationOrder);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of ordered) {
        const parent = node.parentId ?? "1"; const parentNode = node.parentId ? byId.get(node.parentId) : undefined;
        const x = parentNode ? node.x - parentNode.x : node.x; const y = parentNode ? node.y - parentNode.y : node.y;
        lines.push(`        <mxCell id="${xmlEscape(node.id)}" value="${xmlEscape(node.label)}" style="${xmlEscape(nodeStyle(node))}" vertex="1" parent="${xmlEscape(parent)}">`);
        lines.push(`          <mxGeometry x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${node.width.toFixed(2)}" height="${node.height.toFixed(2)}" as="geometry"/>`, "        </mxCell>");
    }
    for (const edge of edges) {
        lines.push(`        <mxCell id="${xmlEscape(edge.id)}" value="${xmlEscape(edge.label ?? "")}" style="${xmlEscape(edgeStyle(edge.operator))}" edge="1" parent="1" source="${xmlEscape(edge.source)}" target="${xmlEscape(edge.target)}">`, '          <mxGeometry relative="1" as="geometry">');
        if (edge.points.length) {
            lines.push('            <Array as="points">');
            for (const point of edge.points) lines.push(`              <mxPoint x="${point.x.toFixed(2)}" y="${point.y.toFixed(2)}"/>`);
            lines.push("            </Array>");
        }
        lines.push("          </mxGeometry>", "        </mxCell>");
    }
    lines.push("      </root>", "    </mxGraphModel>", "  </diagram>", "</mxfile>");
    return `${lines.join("\n")}\n`;
}
