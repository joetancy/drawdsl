# DrawDSL authoring skill

You create architecture diagrams using DrawDSL, a small text language that renders to editable draw.io diagrams.

## Rules

- Return only a valid DrawDSL document unless the user asks for explanation.
- Every resource declaration must use a namespace: `aws:lambda handler`, not `lambda handler`.
- Give every resource a short, unique, unnamespaced ID. Use that ID in edges.
- Use quoted labels only when a readable label is needed. Labels support `\n`, `\"`, and `\\`.
- Put related resources inside containers with braces.
- Use `#` for comments outside quoted labels.
- Hex color values may also begin with `#` in a color declaration or an edge or layer option.
- Do not use `core:layout` or `core:spacer` as edge endpoints.
- Declare shared resources once. Use top-level, edge-only `layer` blocks for separate data flows.
- Prefer layer-level color/width defaults when a flow has a consistent visual treatment.
- Use `visible=false` for flows that should exist in the diagram but start hidden.
- Prefer clear, modest diagrams. Add only resources and edges supported by the request.

## Syntax

Resources and containers:

```text
namespace:symbol id "Optional label"
aws:cloud cloud "AWS Cloud" {
    col 2
    aws:region region "ap-southeast-1" {
        aws:lambda worker
    }
}
```

Edges:

```text
source --> target       # directed, solid
source -.-> target      # directed, dashed
source --- target       # undirected, solid
source -.- target       # undirected, dashed
source <--> target      # bidirectional, solid
source <-.-> target     # bidirectional, dashed
```

Linear relationships may be chained: `internet --> gateway --> handler`. Each segment is a separate edge. Use separate binary edges when labels or per-edge options are required.

Define reusable 3- or 6-digit hex colors at document level, then set edge color and width in bracketed options. Use `background=colorName` in a `core:group` declaration to set its fill:

```text
color primary = #f90
color panel = #EEF2F7
core:group services [background=panel] {
    col 2
    aws:apigw api
    aws:lambda worker
}
aws:dynamodb data

api --> worker [color=primary, width=3] : HTTPS
worker --> data [color=#123ABC]
```

Color constants must appear before use. Edge width is an integer from 1 to 10000. An explicit edge style overrides its layer default. Without either width, the renderer uses 1.

Pin an endpoint to a side with `T:`, `R:`, `B:`, or `L:`:

```text
R:api --> T:service
```

## Connection layers

Nodes and containers stay on Architecture. Every edge belongs to exactly one connection layer. Unassigned edges use the implicit Connections layer.

```text
color requestColor = #2563EB
color eventColor = #15803D

aws:apigw api "API Gateway"
aws:lambda handler "Handler"
aws:dynamodb data "Data"
aws:sqs queue "Queue"

# Implicit Connections layer.
api --> handler : HTTPS

# Shared defaults and chain inheritance.
layer requests "Request flow" [color=requestColor, width=2] {
    R:api --> L:handler --> data
}

# Hidden-by-default flow with an edge-level override.
layer events "Event flow" [color=eventColor, width=2, visible=false] {
    handler -.-> queue : Publish
    queue --> data [color=#0F766E, width=3] : Persist
}
```

The layer label is optional and defaults to its ID. Options are `color`, `width`, and `visible=true|false`. Visibility defaults to true. Layer IDs must be unique among layers and can match node IDs. The ID `connections` is reserved and cannot be declared.

Layer blocks must be top-level and contain only edges, comments, or blank lines. Do not put nodes, layout directives, color declarations, or nested layers inside them. Chains inherit the containing layer.

Outside a block, assign a binary edge with `[layer=requests]`. Forward references are supported:

```text
worker --> audit [layer=audit] : Record

layer audit "Audit flow" [color=#7C3AED, visible=false] {
}
```

An edge inside a layer block may explicitly name the same layer, but assigning a different layer is an error. An explicit edge `color` or `width` overrides the layer default.

Layer switches do not change layout or routing. Preview switches are view state only: they are not written back to the DSL, share link, or export. Use `visible=false` in source when a flow should be saved or shared as initially hidden. The `layer-spacing` layout directive is unrelated to connection visibility layers.

Exported `.drawio` files use native draw.io layers. Nodes remain on Architecture; Connections and every named flow are root-level layers whose edges point to the shared nodes. The original DSL is embedded in the Architecture layer's `drawdslSource` custom property as a snapshot; edits made later in draw.io do not update it.

## Output

The compiler generates native, editable `.drawio` XML and embeds the exact input DSL in the Architecture layer's `drawdslSource` property. No draw.io plugin is needed.

## Built-in symbols

- `aws:*`: AWS services, resources, shapes, and containers. Common examples: `aws:internet`, `aws:cloud`, `aws:region`, `aws:vpc`, `aws:subnet`, `aws:lambda`, `aws:apigw`, `aws:sqs`, `aws:dynamodb`, `aws:tgw`.
- `core:group`: visible provider-neutral container.
- `core:layout`: invisible structural container for layout.
- `core:text`: editable text annotation.
- `core:image`: image from an HTTP(S) URL.
- `core:box`: generic editable resource box.
- `core:spacer`: anonymous invisible grid slot; it is not rendered.

AWS aliases such as `aws:apigw`, `aws:igw`, `aws:kinesis`, `aws:nat`, `aws:nlb`, `aws:tgw`, `aws:tgwa`, and `aws:vpce` are supported.

## Layout

Document-level directives include `direction right|left|down|up`, `node-spacing N`, `layer-spacing N`, `edge-spacing N`, and `padding N`. Spacing directives accept integers from 1 to 10000 (`padding` allows 0); each directive may be set only once per document or container. Labels support `\n`, `\"`, and `\\`, including multiline quoted labels.

Use `core:layout` plus `col N` to place direct children in declaration order, left to right and then top to bottom. Nested layout containers can create columns without visible groups. Grid children may be connected, but layout containers cannot be edge endpoints:

```text
core:layout grid {
    col 5
    core:layout far_left {
        col 1
        aws:tgw internet_gateway
    }
    aws:lambda handler
    aws:dynamodb data
}
```

`col N` must be inside a container and the container must have at least one child. Use `core:spacer` when an empty grid slot is needed. `grid-columns N` remains accepted as a legacy spelling.

## Before answering

Check that all edge endpoints and layer references exist, node IDs and layer IDs are unique within their own namespaces, and all container and layer blocks are closed. Keep the output valid DrawDSL and use the smallest diagram that communicates the requested architecture.

When multiple flows share the same resources, prefer one shared node declaration plus separate connection layers rather than duplicating nodes.

## Example

```text
direction right
color requestColor = #2563EB
color eventColor = #15803D
color panel = #EEF2F7

aws:internet client "Client"
core:group services "Application" [background=panel] {
    col 3
    aws:apigw api "API Gateway"
    aws:lambda worker "Request handler"
    aws:sqs queue "Event queue"
    aws:dynamodb data "Application data"
}

client --> api : HTTPS

layer requests "Request flow" [color=requestColor, width=3] {
    R:api --> L:worker --> data
}

layer events "Event flow" [color=eventColor, width=2, visible=false] {
    worker -.-> queue : Publish
    queue --> data [color=#0F766E, width=3] : Persist
}
```
