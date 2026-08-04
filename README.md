# drawdsl 🪄

> A vibe-coded 🧑‍💻 architecture DSL that turns infrastructure ideas into editable draw.io diagrams 📐

`drawdsl` converts a small, namespaced architecture language into native draw.io XML. It ships with AWS icons ☁️, editable text, remote images and groups, ELK orthogonal routing, and Dagre layered layouts.

## Quick start

```bash
npm install
npm run generate -- examples/elk.drawdsl output.drawio
```

Open `output.drawio` in [diagrams.net](https://www.diagrams.net/) or draw.io Desktop. Generated nodes, groups, labels, and connectors remain editable.

Try both layout engines:

```bash
npm run examples
```

This generates the bundled ELK and Dagre examples in `examples/`.

The examples use the same multi-tier architecture with an AWS Region, nested VPCs, public and private subnets, Lambda, API Gateway, queues, databases, operational services, text resources, and all supported edge styles. This makes the ELK/Dagre layout differences visible on a more realistic graph.

## A tiny example

```text
layout elk
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

`grid-columns` applies to a container’s direct children and is supported with `layout elk`. Child subtrees are first sized, then placed into an exact declaration-ordered grid. Each column uses the width of its widest child, each row uses the height of its tallest child, and smaller children are centered within their cells. ELK uses those finished bounds when laying out the surrounding visible container. Resources inside a grid can still have edges. `core:layout` cannot be used as an edge endpoint.

Use `node-spacing` inside an ELK container to override its direct-child gap without changing the global defaults:

```text
core:layout application_grid {
    grid-columns 5
    node-spacing 140
}
```

ELK containers can also override the document flow direction for their non-grid children:

```text
core:group workers {
    direction down
    aws:lambda first
    aws:lambda second
}
```

Container directions support `right`, `left`, `down`, and `up`. A strict `grid-columns` layout remains grid-ordered, so its direction is ignored.

This keeps the two concerns separate: ELK positions the hierarchy and Libavoid routes the completed geometry with orthogonal, obstacle-aware connectors. For each edge group, visible containers unrelated to either endpoint become routing obstacles; the source and destination ancestor containers stay traversable so connections can still enter and leave them. `core:layout` is never an obstacle. A final global lane pass then offsets shared internal segments and avoidable crossings when the adjusted path remains clear of that edge's obstacles. Draw.io receives the resulting bendpoints and attachment points, so edge origins are spread across resource boundaries instead of all leaving from a single side.

Global ELK layout defaults are in `src/config.ts`. `edgeNudgingDistance` controls the spacing Libavoid and the lane pass aim to keep between parallel route segments; `edgeCrossingPenalty` makes crossing an existing edge more expensive.

```text
direction right   # right, left, down, or up
layout elk        # elk or dagre
```

- **ELK** is the default. It supports layout-only grids, hierarchy-aware placement, and Libavoid orthogonal routing.
- **Dagre** provides a compact layered arrangement with simpler connector routing.

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
