#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode, ElkPoint } from "elkjs/lib/elk-api.js";

type ElkLayoutEngine = {
  layout(graph: ElkNode): Promise<ElkNode>;
};
type ElkConstructor = new () => ElkLayoutEngine;

type Direction = "right" | "left" | "down" | "up";
type LayoutEngine = "elk" | "dagre";
type EdgeOperator = "-->" | "-.->" | "---" | "-.-";

type AstNode = {
  id: string;
  type: string;
  label: string;
  parentId?: string;
  children: AstNode[];
  container: boolean;
  declarationOrder: number;
};

type AstEdge = {
  id: string;
  source: string;
  target: string;
  operator: EdgeOperator;
  label?: string;
  declarationOrder: number;
};

type DocumentAst = {
  direction: Direction;
  layoutEngine: LayoutEngine;
  nodes: AstNode[];
  edges: AstEdge[];
};

type FlatLayoutNode = {
  id: string;
  type: string;
  label: string;
  parentId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  container: boolean;
  declarationOrder: number;
};

type RoutedEdge = {
  id: string;
  source: string;
  target: string;
  operator: EdgeOperator;
  label?: string;
  points: ElkPoint[];
  declarationOrder: number;
};

type LayoutResult = {
  nodes: FlatLayoutNode[];
  edges: RoutedEdge[];
};

const CONTAINER_TYPES = new Set([
  "aws",
  "vpc",
  "subnet",
  "private_subnet",
  "public_subnet",
  "az",
  "group",
]);
const EDGE_RE =
  /^([A-Za-z_][\w-]*)\s*(-->|-\.->|---|-\.-)\s*([A-Za-z_][\w-]*)(?:\s*:\s*(.+?))?\s*$/;
const DIRECTION_RE = /^direction\s+(right|left|down|up)$/;
const LAYOUT_RE = /^layout\s+(elk|dagre)$/;
const DECLARATION_RE =
  /^([A-Za-z_][\w-]*)(?:\s+([A-Za-z_][\w-]*))?(?:\s+"((?:[^"\\]|\\.)*)")?\s*(\{)?$/;

type ResourceAppearance = {
  fill?: string;
  stroke?: string;
  widthScale?: number;
  heightScale?: number;
};

type ResourceDefinition =
  | (ResourceAppearance & { kind: "resourceIcon"; icon: string })
  | (ResourceAppearance & { kind: "shape"; shape: string })
  | { kind: "textBox" };

const CONFIG = {
  iconSize: 80,
  textBox: {
    minWidth: 160,
    maxWidth: 360,
    horizontalPadding: 32,
    lineHeight: 20,
    verticalPadding: 20,
  },
  container: {
    minWidth: 120,
    minHeight: 120,
  },
  layout: {
    nodeSpacing: 80,
    layerSpacing: 120,
    edgeNodeSpacing: 40,
  },
  elk: {
    // The inset between a group border/header and its contents. Increase
    // these values to give resources and routed edges more breathing room.
    groupPadding: {
      top: 40,
      left: 40,
      bottom: 40,
      right: 40,
    },
    containerNodeSpacing: 80,
    containerLayerSpacing: 80,
    rootPadding: "[top=40,left=40,bottom=40,right=40]",
  },
} as const;

const RESOURCE_DEFINITIONS: Record<string, ResourceDefinition> = {
  text: { kind: "textBox" },
  internet: {
    kind: "shape",
    shape: "internet",
    fill: "#232F3D",
    stroke: "none",
    widthScale: 1,
    heightScale: 0.6,
  },
  apigateway: {
    kind: "resourceIcon",
    icon: "api_gateway",
    fill: "#E7157B",
  },
  app_config: { kind: "resourceIcon", icon: "app_config", fill: "#E7157B" },
  alb: {
    kind: "resourceIcon",
    icon: "application_load_balancer",
  },
  aoss: {
    kind: "resourceIcon",
    icon: "elasticsearch_service",
  },
  cloudfront: {
    kind: "resourceIcon",
    icon: "cloudfront",
    fill: "#8C4FFF",
  },
  backup: { kind: "resourceIcon", icon: "backup", fill: "#277116" },
  certificate_manager_2: {
    kind: "shape",
    shape: "certificate_manager_2",
    fill: "#BF0816",
    stroke: "none",
  },
  certificate_manager_3: {
    kind: "resourceIcon",
    icon: "certificate_manager_3",
    fill: "#C7131F",
  },
  client_vpn: { kind: "resourceIcon", icon: "client_vpn", fill: "#5A30B5" },
  cloudhsm: { kind: "resourceIcon", icon: "cloudhsm", fill: "#C7131F" },
  cloudtrail: { kind: "resourceIcon", icon: "cloudtrail", fill: "#BC1356" },
  cloudwatch_2: {
    kind: "resourceIcon",
    icon: "cloudwatch_2",
    fill: "#BC1356",
  },
  dynamodb: {
    kind: "resourceIcon",
    icon: "dynamodb",
    fill: "#C925D1",
  },
  ec2: { kind: "resourceIcon", icon: "ec2" },
  ecr: { kind: "resourceIcon", icon: "ecr" },
  ecs: { kind: "resourceIcon", icon: "ecs", fill: "#ED7100" },
  eks: { kind: "resourceIcon", icon: "eks" },
  elb: {
    kind: "resourceIcon",
    icon: "elastic_load_balancing",
  },
  elasticsearch_service: {
    kind: "resourceIcon",
    icon: "elasticsearch_service",
    fill: "#8C4FFF",
  },
  eni: {
    kind: "shape",
    shape: "elastic_network_interface",
    fill: "#8C4FFF",
    stroke: "none",
  },
  eventbridge: {
    kind: "resourceIcon",
    icon: "eventbridge",
  },
  endpoint: {
    kind: "shape",
    shape: "endpoint",
    fill: "#4D27AA",
    stroke: "none",
  },
  general: { kind: "resourceIcon", icon: "general", fill: "#1E262E" },
  generic_firewall: {
    kind: "shape",
    shape: "generic_firewall",
    fill: "#232F3E",
    stroke: "none",
  },
  guardduty: { kind: "resourceIcon", icon: "guardduty", fill: "#DD344C" },
  iam: {
    kind: "resourceIcon",
    icon: "identity_and_access_management",
  },
  illustration_desktop: {
    kind: "shape",
    shape: "illustration_desktop",
    fill: "#000000",
    stroke: "none",
  },
  illustration_users: {
    kind: "shape",
    shape: "illustration_users",
    fill: "#000000",
    stroke: "none",
  },
  inspector: { kind: "resourceIcon", icon: "inspector", fill: "#C7131F" },
  internetgateway: {
    kind: "shape",
    shape: "internet_gateway",
    fill: "#8C4FFF",
    stroke: "none",
  },
  kinesis_data_stream: {
    kind: "resourceIcon",
    icon: "kinesis_data_streams",
    fill: "#8C4FFF",
  },
  key_management_service: {
    kind: "resourceIcon",
    icon: "key_management_service",
    fill: "#C7131F",
  },
  lambda: {
    kind: "resourceIcon",
    icon: "lambda",
    fill: "#ED7100",
  },
  natgateway: {
    kind: "shape",
    shape: "nat_gateway",
    fill: "#8C4FFF",
    stroke: "none",
  },
  nlb: {
    kind: "shape",
    shape: "network_load_balancer",
    fill: "#8C4FFF",
    stroke: "none",
  },
  networkfirewall: {
    kind: "resourceIcon",
    icon: "network_firewall",
    fill: "#DD344C",
    stroke: "#ffffff",
  },
  network_firewall_endpoints: {
    kind: "shape",
    shape: "network_firewall_endpoints",
    fill: "#DD344C",
    stroke: "none",
  },
  rds: { kind: "resourceIcon", icon: "rds" },
  route53: {
    kind: "resourceIcon",
    icon: "route_53",
  },
  route_53_resolver: {
    kind: "shape",
    shape: "route_53_resolver",
    fill: "#4D27AA",
    stroke: "none",
  },
  role: { kind: "shape", shape: "role", fill: "#DD344C", stroke: "none" },
  s3: {
    kind: "resourceIcon",
    icon: "s3",
    fill: "#7AA116",
  },
  secretsmanager: {
    kind: "resourceIcon",
    icon: "secrets_manager",
  },
  security_hub: {
    kind: "resourceIcon",
    icon: "security_hub",
    fill: "#C7131F",
  },
  ses: {
    kind: "resourceIcon",
    icon: "simple_email_service",
  },
  simple_email_service: {
    kind: "resourceIcon",
    icon: "simple_email_service",
    fill: "#3334B9",
  },
  shield: {
    kind: "resourceIcon",
    icon: "shield_shield_advanced",
    fill: "#DD344C",
  },
  sns: {
    kind: "resourceIcon",
    icon: "sns",
    fill: "#E7157B",
  },
  sqs: {
    kind: "resourceIcon",
    icon: "simple_queue_service",
  },
  stepfunctions: {
    kind: "resourceIcon",
    icon: "step_functions",
  },
  tgw: {
    kind: "resourceIcon",
    icon: "transit_gateway",
  },
  tgwa: {
    kind: "shape",
    shape: "transit_gateway_attachment",
    fill: "#8C4FFF",
    stroke: "none",
  },
  vpcendpoint: {
    kind: "shape",
    shape: "endpoints",
    fill: "#8C4FFF",
    stroke: "none",
  },
  waf: {
    kind: "resourceIcon",
    icon: "waf",
    fill: "#DD344C",
  },
};

const PRIVATE_SUBNET_STYLE = [
  "grIcon=mxgraph.aws4.group_security_group",
  "grStroke=0",
  "strokeColor=#00A4A6",
  "fillColor=#E6F6F7",
  "fontColor=#147EBA",
];

const CONTAINER_DEFINITIONS: Record<string, readonly string[]> = {
  aws: [
    "grIcon=mxgraph.aws4.group_aws_cloud_alt",
    "strokeColor=#232F3E",
    "fillColor=none",
    "fontColor=#232F3E",
  ],
  vpc: [
    "grIcon=mxgraph.aws4.group_vpc2",
    "strokeColor=#8C4FFF",
    "fillColor=none",
    "fontColor=#AAB7B8",
  ],
  subnet: PRIVATE_SUBNET_STYLE,
  private_subnet: PRIVATE_SUBNET_STYLE,
  public_subnet: [
    "grIcon=mxgraph.aws4.group_security_group",
    "grStroke=0",
    "strokeColor=#7AA116",
    "fillColor=#F2F6E8",
    "fontColor=#248814",
  ],
  az: [
    "grIcon=mxgraph.aws4.group_availability_zone",
    "strokeColor=#147EBA",
    "fillColor=none",
    "fontColor=#147EBA",
  ],
  group: ["strokeColor=#879196", "fillColor=none", "fontColor=#232F3E"],
};

const ALIASES: Record<string, string> = {
  apigw: "apigateway",
  igw: "internetgateway",
  internet_gateway: "internetgateway",
  kinesis: "kinesis_data_stream",
  kinesisdatastream: "kinesis_data_stream",
  kinesis_data_streams: "kinesis_data_stream",
  nat: "natgateway",
  nat_gateway: "natgateway",
  networkloadbalancer: "nlb",
  network_load_balancer: "nlb",
  transitgateway: "tgw",
  transit_gateway: "tgw",
  transitgatewayattachment: "tgwa",
  transit_gateway_attachment: "tgwa",
  vpce: "vpcendpoint",
  textbox: "text",
};

function scanLine(line: string): { commentIndex: number; unclosedQuote: boolean } {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === "#" && !quoted) return { commentIndex: i, unclosedQuote: quoted };
  }
  return { commentIndex: -1, unclosedQuote: quoted };
}

function stripComment(line: string): string {
  const { commentIndex } = scanLine(line);
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}

function hasUnclosedQuote(line: string): boolean {
  return scanLine(line).unclosedQuote;
}

function unescapeQuoted(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function unquoteLabel(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescapeQuoted(trimmed.slice(1, -1));
  }
  return trimmed;
}

function canonicalType(type: string): string {
  return ALIASES[type] ?? type;
}

function parseDsl(source: string): DocumentAst {
  const rootNodes: AstNode[] = [];
  const edges: AstEdge[] = [];
  const stack: AstNode[] = [];
  const ids = new Set<string>();
  let direction: Direction = "right";
  let layoutEngine: LayoutEngine = "elk";
  let order = 0;

  const sourceLines = source.split(/\r?\n/);
  for (let index = 0; index < sourceLines.length; index += 1) {
    const lineNumber = index + 1;
    let rawLine = sourceLines[index]!;
    while (hasUnclosedQuote(rawLine)) {
      index += 1;
      if (index >= sourceLines.length) {
        throw new Error(`Line ${lineNumber}: unclosed quoted label`);
      }
      rawLine += `\n${sourceLines[index]!}`;
    }
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    if (line === "}") {
      if (stack.length === 0)
        throw new Error(`Line ${lineNumber}: unexpected }`);
      stack.pop();
      continue;
    }

    const directionMatch = line.match(DIRECTION_RE);
    if (directionMatch) {
      if (stack.length > 0)
        throw new Error(`Line ${lineNumber}: direction must be top-level`);
      direction = directionMatch[1] as Direction;
      continue;
    }

    const layoutMatch = line.match(LAYOUT_RE);
    if (layoutMatch) {
      if (stack.length > 0)
        throw new Error(`Line ${lineNumber}: layout must be top-level`);
      layoutEngine = layoutMatch[1] as LayoutEngine;
      continue;
    }

    const edgeMatch = line.match(EDGE_RE);
    if (edgeMatch) {
      const sourceId = edgeMatch[1]!;
      const operator = edgeMatch[2]! as EdgeOperator;
      const targetId = edgeMatch[3]!;
      edges.push({
        id: `edge_${edges.length + 1}_${sourceId}_${targetId}`,
        source: sourceId,
        target: targetId,
        operator,
        label: unquoteLabel(edgeMatch[4]),
        declarationOrder: order++,
      });
      continue;
    }

    const declarationMatch = line.match(DECLARATION_RE);
    if (!declarationMatch)
      throw new Error(`Line ${lineNumber}: unsupported syntax: ${rawLine}`);

    const rawType = declarationMatch[1]!;
    const type = canonicalType(rawType);
    const explicitId = declarationMatch[2];
    const quotedLabel = declarationMatch[3];
    const opensBlock = Boolean(declarationMatch[4]);
    const container = CONTAINER_TYPES.has(type);

    if (opensBlock && !container) {
      throw new Error(
        `Line ${lineNumber}: resource property blocks are not implemented in v1`,
      );
    }
    if (!opensBlock && container) {
      throw new Error(
        `Line ${lineNumber}: container ${type} must open a block with {`,
      );
    }

    let id: string;
    let label: string;

    if (quotedLabel !== undefined) {
      id = explicitId ?? type;
      label = unescapeQuoted(quotedLabel);
    } else if (explicitId !== undefined) {
      id = explicitId;
      label = explicitId;
    } else {
      id = type;
      label = type === "internet" ? "Internet" : type;
    }

    if (ids.has(id))
      throw new Error(`Line ${lineNumber}: duplicate node ID ${id}`);
    ids.add(id);

    const parent = stack.at(-1);
    const node: AstNode = {
      id,
      type,
      label,
      parentId: parent?.id,
      children: [],
      container,
      declarationOrder: order++,
    };

    if (parent) parent.children.push(node);
    else rootNodes.push(node);

    if (opensBlock) stack.push(node);
  }

  if (stack.length > 0)
    throw new Error(`Unclosed container: ${stack.at(-1)!.id}`);

  for (const edge of edges) {
    if (!ids.has(edge.source))
      throw new Error(`Unknown edge source: ${edge.source}`);
    if (!ids.has(edge.target))
      throw new Error(`Unknown edge target: ${edge.target}`);
  }

  return { direction, layoutEngine, nodes: rootNodes, edges };
}

function elkDirection(direction: Direction): string {
  return { right: "RIGHT", left: "LEFT", down: "DOWN", up: "UP" }[direction];
}

function dagreDirection(direction: Direction): string {
  return { right: "LR", left: "RL", down: "TB", up: "BT" }[direction];
}

function dimensions(node: AstNode): { width: number; height: number } {
  if (node.container) {
    return {
      width: CONFIG.container.minWidth,
      height: CONFIG.container.minHeight,
    };
  }

  const definition = RESOURCE_DEFINITIONS[node.type];
  if (definition?.kind === "textBox") {
    const lines = node.label.split("\n");
    const longestLine = Math.max(...lines.map((line) => line.length), 1);
    return {
      width: Math.min(
        CONFIG.textBox.maxWidth,
        Math.max(
          CONFIG.textBox.minWidth,
          longestLine * 7 + CONFIG.textBox.horizontalPadding,
        ),
      ),
      height:
        lines.length * CONFIG.textBox.lineHeight +
        CONFIG.textBox.verticalPadding,
    };
  }
  return {
    width: CONFIG.iconSize * (definition?.widthScale ?? 1),
    height: CONFIG.iconSize * (definition?.heightScale ?? 1),
  };
}

function toElkNode(node: AstNode): ElkNode {
  const size = dimensions(node);
  const groupPadding = CONFIG.elk.groupPadding;
  const layoutOptions: Record<string, string> = {};
  if (node.container) {
    layoutOptions["elk.algorithm"] = "layered";
    layoutOptions["elk.padding"] =
      `[top=${groupPadding.top},left=${groupPadding.left},bottom=${groupPadding.bottom},right=${groupPadding.right}]`;
    layoutOptions["elk.spacing.nodeNode"] = String(
      CONFIG.elk.containerNodeSpacing,
    );
    layoutOptions["elk.layered.spacing.nodeNodeBetweenLayers"] = String(
      CONFIG.elk.containerLayerSpacing,
    );
  }
  return {
    id: node.id,
    width: size.width,
    height: size.height,
    children: node.children.map(toElkNode),
    layoutOptions:
      Object.keys(layoutOptions).length > 0 ? layoutOptions : undefined,
  };
}

function buildElkGraph(ast: DocumentAst): ElkNode {
  const edges: ElkExtendedEdge[] = ast.edges.map((edge) => ({
    id: edge.id,
    sources: [edge.source],
    targets: [edge.target],
    labels: edge.label
      ? [
          {
            id: `${edge.id}_label`,
            text: edge.label,
            width: Math.max(40, edge.label.length * 7),
            height: 18,
          },
        ]
      : undefined,
  }));

  return {
    id: "root",
    children: ast.nodes.map(toElkNode),
    edges,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": elkDirection(ast.direction),
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": String(CONFIG.layout.nodeSpacing),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(
        CONFIG.layout.layerSpacing,
      ),
      "elk.spacing.edgeNode": String(CONFIG.layout.edgeNodeSpacing),
      "elk.padding": CONFIG.elk.rootPadding,
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
  };
}

function flattenAst(nodes: AstNode[]): Map<string, AstNode> {
  const map = new Map<string, AstNode>();
  const visit = (node: AstNode): void => {
    map.set(node.id, node);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return map;
}

function byDeclarationOrder<T extends { declarationOrder: number }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => a.declarationOrder - b.declarationOrder);
}

function flattenLayout(
  root: ElkNode,
  astMap: Map<string, AstNode>,
): FlatLayoutNode[] {
  const result: FlatLayoutNode[] = [];
  const visit = (
    node: ElkNode,
    absoluteX: number,
    absoluteY: number,
    parentId?: string,
  ): void => {
    const astNode = astMap.get(node.id);
    if (!astNode) return;
    const x = absoluteX + (node.x ?? 0);
    const y = absoluteY + (node.y ?? 0);
    result.push({
      id: node.id,
      type: astNode.type,
      label: astNode.label,
      parentId,
      x,
      y,
      width: node.width ?? dimensions(astNode).width,
      height: node.height ?? dimensions(astNode).height,
      container: astNode.container,
      declarationOrder: astNode.declarationOrder,
    });
    node.children?.forEach((child) => visit(child, x, y, node.id));
  };
  root.children?.forEach((node) => visit(node, 0, 0));
  return byDeclarationOrder(result);
}

function sharedContainerOrigin(
  source: string,
  target: string,
  layoutNodes: Map<string, FlatLayoutNode>,
): { x: number; y: number } {
  const sourceAncestors = new Set<string>();
  for (
    let id: string | undefined = source;
    id;
    id = layoutNodes.get(id)?.parentId
  ) {
    sourceAncestors.add(id);
  }

  for (
    let id: string | undefined = target;
    id;
    id = layoutNodes.get(id)?.parentId
  ) {
    if (sourceAncestors.has(id)) {
      const container = layoutNodes.get(id);
      return { x: container?.x ?? 0, y: container?.y ?? 0 };
    }
  }

  // Edges that span separate root-level branches are already in root space.
  return { x: 0, y: 0 };
}

function simplifyWaypoints(points: ElkPoint[]): ElkPoint[] {
  const simplified: ElkPoint[] = [];
  for (const point of points) {
    const previous = simplified.at(-1);
    if (previous && point.x === previous.x && point.y === previous.y) continue;

    simplified.push(point);
    while (simplified.length >= 3) {
      const before = simplified.at(-3)!;
      const middle = simplified.at(-2)!;
      const after = simplified.at(-1)!;
      const collinear =
        (before.x === middle.x && middle.x === after.x) ||
        (before.y === middle.y && middle.y === after.y);
      if (!collinear) break;
      simplified.splice(-2, 1);
    }
  }
  return simplified;
}

function routedEdges(
  root: ElkNode,
  ast: DocumentAst,
  layoutNodes: FlatLayoutNode[],
): RoutedEdge[] {
  const astEdges = new Map(ast.edges.map((edge) => [edge.id, edge]));
  const layoutById = new Map(layoutNodes.map((node) => [node.id, node]));
  const result: RoutedEdge[] = [];
  for (const edge of root.edges ?? []) {
    const original = astEdges.get(edge.id);
    if (!original) continue;
    const origin = sharedContainerOrigin(
      original.source,
      original.target,
      layoutById,
    );
    const points: ElkPoint[] = [];
    for (const section of edge.sections ?? []) {
      for (const bend of section.bendPoints ?? []) {
        // ELK routes edges in the coordinate system of their lowest shared
        // container; draw.io root-level edges need absolute coordinates.
        points.push({ x: bend.x + origin.x, y: bend.y + origin.y });
      }
    }
    result.push({
      ...original,
      // Source and target remain attached to their draw.io cells. Only ELK's
      // intermediate bends become draw.io waypoints.
      points: simplifyWaypoints(points),
    });
  }
  return byDeclarationOrder(result);
}

async function layoutWithElk(ast: DocumentAst): Promise<LayoutResult> {
  const elk = new (ELK as unknown as ElkConstructor)();
  const laidOut = await elk.layout(buildElkGraph(ast));
  const nodes = flattenLayout(laidOut, flattenAst(ast.nodes));
  return { nodes, edges: routedEdges(laidOut, ast, nodes) };
}

type DagreNodeLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type DagreEdgeLayout = {
  points?: ElkPoint[];
};

function dagreAnchor(node: AstNode): string {
  if (!node.container) return node.id;
  return node.children.length > 0 ? dagreAnchor(node.children[0]!) : node.id;
}

function layoutWithDagre(ast: DocumentAst): LayoutResult {
  const astNodes = flattenAst(ast.nodes);
  const graph = new graphlib.Graph({ compound: true, multigraph: true });
  graph.setGraph({
    rankdir: dagreDirection(ast.direction),
    nodesep: CONFIG.layout.nodeSpacing,
    ranksep: CONFIG.layout.layerSpacing,
    edgesep: CONFIG.layout.edgeNodeSpacing,
    marginx: 40,
    marginy: 40,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of astNodes.values()) {
    const size = dimensions(node);
    graph.setNode(node.id, size);
  }
  for (const node of astNodes.values()) {
    if (node.parentId) graph.setParent(node.id, node.parentId);
  }
  const dagreEdges = new Map<string, { source: string; target: string }>();
  for (const edge of ast.edges) {
    const source = dagreAnchor(astNodes.get(edge.source)!);
    const target = dagreAnchor(astNodes.get(edge.target)!);
    dagreEdges.set(edge.id, { source, target });
    graph.setEdge(source, target, {}, edge.id);
  }

  dagreLayout(graph);

  const nodes = [...astNodes.values()]
    .map((node): FlatLayoutNode => {
      const layout = graph.node(node.id) as DagreNodeLayout;
      return {
        id: node.id,
        type: node.type,
        label: node.label,
        parentId: node.parentId,
        x: layout.x - layout.width / 2,
        y: layout.y - layout.height / 2,
        width: layout.width,
        height: layout.height,
        container: node.container,
        declarationOrder: node.declarationOrder,
      };
    });
  const orderedNodes = byDeclarationOrder(nodes);

  const edges = ast.edges
    .map((edge): RoutedEdge => {
      const dagreEdge = dagreEdges.get(edge.id)!;
      const layout = graph.edge(
        dagreEdge.source,
        dagreEdge.target,
        edge.id,
      ) as DagreEdgeLayout;
      return {
        ...edge,
        // Dagre provides endpoint coordinates too. draw.io calculates those
        // from source/target cells, so retain only the intermediate waypoints.
        // Container connections use a child anchor for ranking; omit their
        // route because it belongs to that anchor rather than the container.
        points:
          dagreEdge.source === edge.source && dagreEdge.target === edge.target
            ? simplifyWaypoints((layout.points ?? []).slice(1, -1))
            : [],
      };
    });
  const orderedEdges = byDeclarationOrder(edges);

  return { nodes: orderedNodes, edges: orderedEdges };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("\n", "&#xa;");
}

function styleString(tokens: readonly string[]): string {
  return `${tokens.join(";")};`;
}

function nodeStyle(node: FlatLayoutNode): string {
  if (node.container) {
    const base = [
      "points=[[0,0],[0.25,0],[0.5,0],[0.75,0],[1,0],[1,0.25],[1,0.5],[1,0.75],[1,1],[0.75,1],[0.5,1],[0.25,1],[0,1],[0,0.75],[0,0.5],[0,0.25]]",
      "outlineConnect=0",
      "gradientColor=none",
      "html=1",
      "whiteSpace=wrap",
      "fontSize=12",
      "fontStyle=0",
      "container=1",
      "pointerEvents=0",
      "collapsible=0",
      "recursiveResize=0",
      "shape=mxgraph.aws4.group",
      "verticalAlign=top",
      "align=left",
      "spacingLeft=30",
      "dashed=0",
    ];

    const containerStyle =
      CONTAINER_DEFINITIONS[node.type] ?? CONTAINER_DEFINITIONS.group ?? [];

    return styleString([...base, ...containerStyle]);
  }

  const definition = RESOURCE_DEFINITIONS[node.type];
  if (!definition) {
    return "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#64748b;fontSize=12;";
  }

  if (definition.kind === "textBox") {
    return styleString([
      "shape=rectangle",
      "rounded=0",
      "whiteSpace=wrap",
      "html=1",
      "fillColor=#ffffff",
      "strokeColor=#64748b",
      "fontColor=#232F3E",
      "align=left",
      "verticalAlign=middle",
      "spacing=8",
      "fontSize=14",
    ]);
  }

  const fill = definition.fill ?? "#527FFF";
  const stroke = definition.stroke ?? "#ffffff";

  if (definition.kind === "shape") {
    return styleString([
      "sketch=0",
      "outlineConnect=0",
      "fontColor=#232F3E",
      "gradientColor=none",
      `fillColor=${fill}`,
      `strokeColor=${stroke}`,
      "dashed=0",
      "verticalLabelPosition=bottom",
      "verticalAlign=top",
      "align=center",
      "html=1",
      "fontSize=12",
      "fontStyle=0",
      "aspect=fixed",
      "pointerEvents=1",
      `shape=mxgraph.aws4.${definition.shape}`,
    ]);
  }

  return styleString([
    "shape=mxgraph.aws4.resourceIcon",
    `resIcon=mxgraph.aws4.${definition.icon}`,
    `fillColor=${fill}`,
    `strokeColor=${stroke}`,
    "verticalLabelPosition=bottom",
    "verticalAlign=top",
    "align=center",
    "html=1",
    "fontSize=12",
  ]);
}

function edgeStyle(operator: EdgeOperator): string {
  const directed = operator === "-->" || operator === "-.->";
  const dashed = operator === "-.->" || operator === "-.-";
  return styleString([
    "edgeStyle=orthogonalEdgeStyle",
    "rounded=0",
    "orthogonalLoop=1",
    "jettySize=auto",
    "html=1",
    "strokeWidth=1",
    `endArrow=${directed ? "block" : "none"}`,
    `endFill=${directed ? "1" : "0"}`,
    "startArrow=none",
    `dashed=${dashed ? "1" : "0"}`,
  ]);
}

function renderDrawio(nodes: FlatLayoutNode[], edges: RoutedEdge[]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<mxfile host="app.diagrams.net" agent="drawdsl" version="26.0.0" type="device">',
  );
  lines.push('  <diagram id="drawdsl" name="Architecture">');
  lines.push(
    '    <mxGraphModel grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">',
  );
  lines.push("      <root>");
  lines.push('        <mxCell id="0"/>');
  lines.push('        <mxCell id="1" parent="0"/>');

  // Containers first so draw.io creates parent cells before children.
  const orderedNodes = [...nodes].sort(
    (a, b) =>
      Number(b.container) - Number(a.container) ||
      a.declarationOrder - b.declarationOrder,
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of orderedNodes) {
    const parent = node.parentId ?? "1";
    const parentNode = node.parentId ? byId.get(node.parentId) : undefined;
    const relativeX = parentNode ? node.x - parentNode.x : node.x;
    const relativeY = parentNode ? node.y - parentNode.y : node.y;
    lines.push(
      `        <mxCell id="${xmlEscape(node.id)}" value="${xmlEscape(node.label)}" style="${xmlEscape(nodeStyle(node))}" vertex="1" parent="${xmlEscape(parent)}">`,
    );
    lines.push(
      `          <mxGeometry x="${relativeX.toFixed(2)}" y="${relativeY.toFixed(2)}" width="${node.width.toFixed(2)}" height="${node.height.toFixed(2)}" as="geometry"/>`,
    );
    lines.push("        </mxCell>");
  }

  for (const edge of edges) {
    lines.push(
      `        <mxCell id="${xmlEscape(edge.id)}" value="${xmlEscape(edge.label ?? "")}" style="${xmlEscape(edgeStyle(edge.operator))}" edge="1" parent="1" source="${xmlEscape(edge.source)}" target="${xmlEscape(edge.target)}">`,
    );
    lines.push('          <mxGeometry relative="1" as="geometry">');
    if (edge.points.length > 0) {
      lines.push('            <Array as="points">');
      for (const point of edge.points) {
        lines.push(
          `              <mxPoint x="${point.x.toFixed(2)}" y="${point.y.toFixed(2)}"/>`,
        );
      }
      lines.push("            </Array>");
    }
    lines.push("          </mxGeometry>");
    lines.push("        </mxCell>");
  }

  lines.push("      </root>");
  lines.push("    </mxGraphModel>");
  lines.push("  </diagram>");
  lines.push("</mxfile>");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg || !outputArg) {
    console.error("Usage: npx tsx src/drawdsl.ts input.drawdsl output.drawio");
    process.exitCode = 2;
    return;
  }

  const source = await readFile(inputArg, "utf8");
  const ast = parseDsl(source);
  const { nodes, edges } =
    ast.layoutEngine === "dagre"
      ? layoutWithDagre(ast)
      : await layoutWithElk(ast);
  await writeFile(outputArg, renderDrawio(nodes, edges), "utf8");
  console.log(`Created ${outputArg}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
