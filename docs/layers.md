# Connection layers

Use one architecture with a separate connection layer for each data flow. Nodes and containers are declared once. This feature works in the standalone DrawDSL editor and in exported `.drawio` files. A plugin is not required.

## Example

```text
direction right
color requestColor = #2563EB
color eventColor = #15803D

aws:apigw api "API Gateway"
aws:lambda handler "Request handler"
aws:dynamodb data "Application data"

layer requests "Request flow" [color=requestColor, width=2] {
    api --> handler : Invoke
    handler --> data : Read / write
}

layer events "Event flow" [color=eventColor, visible=false] {
    data -.-> handler : Change event
}
```

The Architecture layer contains the nodes and their container hierarchy. Each named layer contains its edges and edge labels. Edges without an assignment belong to the implicit Connections layer.

The complete example is in [`examples/flows.drawdsl`](../examples/flows.drawdsl).

## Layer declarations

```text
layer layer_id "Optional display name" [color=colorName, width=2, visible=false] {
    source --> target : Optional edge label
}
```

A layer ID starts with a letter or underscore. Later characters may also include digits or hyphens. It must be unique among layers. Node IDs and layer IDs have separate namespaces, so a node and a layer can use the same ID.

The display name defaults to the layer ID. It supports the same quoted text and escapes as node labels.

| Option | Default | Meaning |
| --- | --- | --- |
| `visible` | `true` | Initial visibility in the preview and export. Accepts only `true` or `false`. |
| `color` | No layer default | Default edge color. Accepts a previously declared color constant, `#RGB`, or `#RRGGBB`. |
| `width` | No layer default | Default edge width. Accepts an integer from 1 to 10000. |

An explicit edge color or width overrides its layer default. Without an edge or layer width, the renderer uses width 1.

Layer blocks must be at document level and can contain only edges, comments, or blank lines. They cannot contain nodes, containers, layout directives, color declarations, or other layers. They do not create a visible box or affect container ownership.

## Assign an edge outside a layer block

```text
api --> handler [layer=requests] : Invoke

layer requests "Request flow" [color=#2563EB] {
}
```

Forward references are supported. The layer declaration may appear after the edge. Empty named layers are retained in the preview and export.

An edge inside a layer block inherits that layer. An explicit assignment to the same layer is permitted. An assignment to a different layer is an error, not an override.

Chains inherit their containing layer:

```text
layer requests {
    R:api --> L:handler --> data
}
```

Chain segments remain separate edges. For labels or per-edge options, use separate binary edge statements.

The ID `connections` is reserved for the implicit Connections layer. It cannot be declared as a named layer, but an edge may explicitly use `[layer=connections]`.

## Preview controls

The **Connection layers** panel provides individual checkboxes and three actions:

- **All flows** shows every connection layer.
- **Architecture only** hides every connection layer but keeps all nodes and containers visible.
- **Reset layers** restores the visibility defaults from the current DSL.

The number beside a layer name is its edge count. Each edge belongs to one layer. All flows is a control, not another layer or another copy of the edges.

Explicit preview choices survive successful source edits and theme changes while the same layer IDs remain. Removed IDs lose their previous choices. Loading a saved diagram or reloading a shared link starts from that document's defaults. On a compile error, the previous successful preview remains available, with a warning.

**Preview choices do not change the source, saved DSL, share link, XML view, clipboard export, or downloaded `.drawio` file.** Set `visible=false` in the DSL to save or share an initially hidden layer.

## Stable layout

DrawDSL positions the full architecture and routes all edges together, including initially hidden edges. A visibility switch does not call the compiler, ELK, or libavoid.

The current diagrams.net viewer changes native layer visibility in place. Nodes, edge waypoints, labels, zoom, and pan remain stable during switches. An older viewer without the graph callback can redraw the cached XML without another layout pass.

Editing the actual topology can still change the automatic layout. Visibility layers are not the same as ELK layout ranks. The `layer-spacing` directive still controls spacing between layout ranks; it does not separate connection layers.

## Native draw.io export

```bash
npm run generate -- examples/flows.drawdsl flows.drawio
```

Open `flows.drawio` in diagrams.net or draw.io Desktop. Use its native Layers panel to show or hide flows. All layers are exported, including hidden ones.

The graph root contains the Architecture cell `1` and connection-layer cells named `layer:connections`, `layer:requests`, and so on. Nodes keep their container parents. Each edge uses its layer as its parent and keeps its original source and target IDs. Layer cells have no geometry offset, so routed waypoints remain in diagram coordinates.

The low-level render functions accept layer metadata as a third argument:

```ts
const layout = await layoutDocument(parseDsl(source));
const xml = renderDrawio(layout.nodes, layout.edges, layout.layers);
```

`compileDrawDsl(source)` and the CLI pass this metadata automatically. Two-argument rendering remains valid for edges on the default Connections layer. Named edges without matching layer metadata fail explicitly.

The legacy plugin importer is outside this feature's scope and is not a supported way to import the layered output. Use the standalone app or open the exported file directly.

## Tests

```bash
npm run check
npm run lint:ts
npm test
npm run web:build
npm run test:web
```

The default browser tests use a deterministic viewer adapter. They test state, labels, geometry, exports, saved/shared diagrams, and keyboard use without a third-party network dependency.

The native-viewer smoke test needs network access to the existing diagrams.net viewer:

```bash
DRAWDSL_LIVE_VIEWER=1 npx playwright test web-tests/layers-live.spec.ts
```

CI runs both suites and saves browser screenshots and failure traces as the `browser-test-evidence` artifact.
