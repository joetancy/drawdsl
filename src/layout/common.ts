import { CONFIG } from "../config.js";
import type { AstNode, DocumentAst, FlatLayoutNode, Point } from "../model.js";

export function dimensions(node: AstNode): { width: number; height: number } {
  if (node.definition.role === "container") return { width: CONFIG.container.minWidth, height: CONFIG.container.minHeight };
  if (node.definition.role === "annotation") {
    const lines = node.label.split("\n");
    const longest = Math.max(...lines.map((line) => line.length), 1);
    return {
      width: Math.min(CONFIG.textBox.maxWidth, Math.max(CONFIG.textBox.minWidth, longest * 7 + CONFIG.textBox.horizontalPadding)),
      height: lines.length * CONFIG.textBox.lineHeight + CONFIG.textBox.verticalPadding,
    };
  }
  return { width: CONFIG.iconSize * (node.definition.widthScale ?? 1), height: CONFIG.iconSize * (node.definition.heightScale ?? 1) };
}

export function flattenAst(nodes: AstNode[]): Map<string, AstNode> {
  const result = new Map<string, AstNode>();
  const visit = (node: AstNode): void => { result.set(node.id, node); node.children.forEach(visit); };
  nodes.forEach(visit);
  return result;
}

export function byDeclarationOrder<T extends { declarationOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.declarationOrder - b.declarationOrder);
}

export function simplifyWaypoints(points: Point[]): Point[] {
  const simplified: Point[] = [];
  for (const point of points) {
    const previous = simplified.at(-1);
    if (previous && point.x === previous.x && point.y === previous.y) continue;
    simplified.push(point);
    while (simplified.length >= 3) {
      const before = simplified.at(-3)!;
      const middle = simplified.at(-2)!;
      const after = simplified.at(-1)!;
      if (!((before.x === middle.x && middle.x === after.x) || (before.y === middle.y && middle.y === after.y))) break;
      simplified.splice(-2, 1);
    }
  }
  return simplified;
}

export function sharedContainerOrigin(source: string, target: string, layoutNodes: Map<string, FlatLayoutNode>): Point {
  const ancestors = new Set<string>();
  for (let id: string | undefined = source; id; id = layoutNodes.get(id)?.parentId) ancestors.add(id);
  for (let id: string | undefined = target; id; id = layoutNodes.get(id)?.parentId) {
    if (ancestors.has(id)) {
      const container = layoutNodes.get(id);
      return { x: container?.x ?? 0, y: container?.y ?? 0 };
    }
  }
  return { x: 0, y: 0 };
}

export function elkDirection(direction: DocumentAst["direction"]): string { return { right: "RIGHT", left: "LEFT", down: "DOWN", up: "UP" }[direction]; }
export function dagreDirection(direction: DocumentAst["direction"]): string { return { right: "LR", left: "RL", down: "TB", up: "BT" }[direction]; }
