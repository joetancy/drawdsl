# drawdsl 🪄

> A vibe-coded 🧑‍💻 architecture DSL that turns infrastructure ideas into editable draw.io diagrams 📐

`drawdsl` converts a small, namespaced architecture language into native draw.io XML. It ships with AWS icons ☁️, editable text, remote images and groups, and ELK orthogonal routing.

## Quick start

```bash
npm install
npm run generate -- examples/elk.drawdsl output.drawio
```

Open `output.drawio` in [diagrams.net](https://www.diagrams.net/) or draw.io Desktop. Generated nodes, groups, labels, and connectors remain editable.

Generate the bundled example:

```bash
npm run examples
```

This generates the bundled architecture example in `examples/`.

The example uses a multi-tier architecture with an AWS Region, nested VPCs, public and private subnets, Lambda, API Gateway, queues, databases, operational services, text resources, and all supported edge styles.

## A tiny example

```text
direction right

aws:internet internet "Public internet"
aws:cloud cloud "AWS Cloud" {
    aws:region singapore "ap-southeast-1" {
        aws:vpc app_vpc "Application VPC" {
            aws:lambda handler "Request handler"
            core:text note "Deployed by the platform team"
        }
    }
}

internet --> handler : HTTPS
```

Every declaration uses `namespace:name`. The namespace selects a symbol provider; the optional ID and quoted label follow it. IDs are unnamespaced and global within the document.

Connections support solid, dashed, directed, undirected, and bidirectional operators:

```text
source --> target       # directed, solid
source -.-> target      # directed, dashed
source --- target       # undirected, solid
source -.- target       # undirected, dashed
source <--> target      # bidirectional, solid
source <-.-> target     # bidirectional, dashed
```

Pin either end of an edge to a particular side by prefixing the endpoint ID with `T:`, `R:`, `B:`, or `L:`:

```text
lambda_main --> B:notifications_queue  # enter the queue from its bottom
R:lambda_main --> T:notifications_queue
```

These selectors mean top, right, bottom, and left respectively. They are honored by ELK’s router and preserved in draw.io.

Labels support `\"`, `\\`, and `\n` escapes. `#` starts a comment outside quoted labels. Unqualified declarations such as `lambda handler` are intentionally rejected.

## Built-in symbol providers

| Namespace | Purpose |
| --- | --- |
| `aws:*` | AWS resource icons, AWS shapes, and AWS containers |
| `core:text` | Editable text annotation |
| `core:image` | Image loaded from an HTTP(S) URL |
| `core:box` | Generic editable resource box |
| `core:group` | Provider-neutral container |
| `core:layout` | Invisible structural container for ELK layout |
| `core:spacer` | Anonymous invisible, icon-sized layout gap |

`core:text` may omit its ID when it is only an annotation: `core:text "Deployment notes"`. DrawDSL assigns it an internal ID automatically. Supply an ID when the text node needs to be referenced by an edge.

AWS aliases are namespace-local. For example, `aws:apigw`, `aws:igw`, `aws:kinesis`, `aws:nat`, `aws:nlb`, `aws:tgw`, `aws:tgwa`, and `aws:vpce` resolve to their canonical symbols.

Use `core:image` with a quoted HTTP(S) URL. The image is embedded as an editable draw.io image cell at a default size of 160×80; its displayed label is intentionally empty.

```text
core:image architecture_reference "https://example.com/architecture.png"
```

Provider definitions live in [src/symbols/aws.ts](src/symbols/aws.ts) and [src/symbols/core.ts](src/symbols/core.ts). To add another icon family, implement a `SymbolProvider` and register it in [src/symbols/registry.ts](src/symbols/registry.ts). Parsing, layout, and rendering consume the shared symbol model, so provider-specific details stay isolated.

## Containers and layout

AWS containers include `aws:cloud`, `aws:region`, `aws:vpc`, `aws:subnet`, `aws:private_subnet`, `aws:public_subnet`, and `aws:az`. `core:group` provides a neutral alternative. Containers use braces and can be nested.

Use `core:layout` for an invisible, structural container. It affects placement but does not create a draw.io cell, border, or label. This is useful when the visual architecture needs stable columns or grids without introducing another visible group.

Use `core:spacer` without an ID to reserve an empty, icon-sized grid slot. It is not rendered or available as an edge endpoint:

```text
aws:lambda first
core:spacer
aws:lambda third
```

```text
aws:vpc application {
    core:layout application_grid {
        grid-columns 2

        core:layout compute_column {
            grid-columns 1
            aws:lambda api
            aws:lambda worker
        }

        core:layout data_column {
            grid-columns 1
            aws:sqs jobs
            aws:dynamodb records
        }
    }
}

api --> jobs
worker --> records
```

`grid-columns` applies to a container’s direct children. Child subtrees are first sized, then placed into an exact declaration-ordered grid. Each column uses the width of its widest child, each row uses the height of its tallest child, and smaller children are centered within their cells. ELK uses those finished bounds when laying out the surrounding visible container. Resources inside a grid can still have edges. `core:layout` cannot be used as an edge endpoint.

Layout settings use the same flat, hyphenated syntax as the existing directives. Document-level values apply throughout the diagram; a setting inside a container overrides that container's direct-child layout:

```text
direction right
node-spacing 120
layer-spacing 180
edge-spacing 24
padding 40

core:layout application_grid {
    grid-columns 5
    node-spacing 60
    padding 20
}
```

`direction` accepts `right`, `left`, `down`, or `up`. `node-spacing`, `layer-spacing`, and `edge-spacing` accept integer pixel values from 1 to 10000; `padding` accepts 0 to 10000 and applies equally to all four sides. `edge-spacing` is document-only. Partial configuration is supported.

When omitted, root nodes use 240px spacing, resources inside containers use 80px, container-only siblings use 160px, layers use 240px, and routed edge lanes use 20px. Root padding is 40px; visible containers use 40px vertically and 80px horizontally; invisible `core:layout` containers have no padding. Explicit document-level `node-spacing` or `padding` replaces these tiered defaults.

Containers can also override the document flow direction for their non-grid children:

```text
core:group workers {
    direction down
    aws:lambda first
    aws:lambda second
}
```

Container directions support `right`, `left`, `down`, and `up`. A strict `grid-columns` layout remains grid-ordered, so its direction is ignored.

ELK positions the hierarchy and the orthogonal router uses the completed geometry. Visible containers unrelated to either endpoint remain routing obstacles, while source and destination ancestor containers stay traversable so connections can enter and leave them. `core:layout` is never an obstacle. Draw.io receives the resulting bendpoints and attachment points.

`edge-spacing` controls the global gap between overlapping parallel route segments. Edges are routed with their own container obstacles, then a final obstacle-aware lane pass applies the same spacing across routes from different container-routing passes. The endpoint clearance remains an internal 40px routing default. Shared-path nudging is enabled so edges are kept distinct. Perpendicular crossings are allowed and do not affect routing. When the available geometry cannot fit a lane, the router preserves an obstacle-free route instead of forcing an invalid one.

Explicit `T:`, `R:`, `B:`, and `L:` endpoint selectors remain available when a relationship needs a specific source or target side.

```text
direction right   # right, left, down, or up
```

## Commands

```bash
# Generate draw.io XML
npm run generate -- input.drawdsl output.drawio

# Validate DSL syntax and references
npm run lint -- input.drawdsl

# Format DSL with four-space indentation
npm run format -- input.drawdsl
npm run format:write -- input.drawdsl

# Lint or auto-format TypeScript
npm run lint:ts
npm run format:ts

# Type-check and test the compiler
npm run check
npm test
```

The test suite covers parsing, namespace resolution, formatting, provider styles, and draw.io rendering.
