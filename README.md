# drawdsl 🪄

> A vibe-coded 🧑‍💻 architecture DSL that turns infrastructure ideas into editable draw.io diagrams 📐

`drawdsl` converts a small, namespaced architecture language into native draw.io XML. It ships with AWS icons ☁️, editable text and groups, ELK orthogonal routing, and Dagre layered layouts.

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

The examples use the same multi-tier architecture with nested VPCs, public and private subnets, Lambda, API Gateway, queues, databases, operational services, text resources, and all supported edge styles. This makes the ELK/Dagre layout differences visible on a more realistic graph.

## A tiny example

```text
layout elk
direction right

aws:internet internet "Public internet"
aws:cloud cloud "AWS Cloud" {
    aws:vpc app_vpc "Application VPC" {
        aws:lambda handler "Request handler"
        core:text note "Deployed by the platform team"
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
| `core:box` | Generic editable resource box |
| `core:group` | Provider-neutral container |

AWS aliases are namespace-local. For example, `aws:apigw`, `aws:igw`, `aws:kinesis`, `aws:nat`, `aws:nlb`, `aws:tgw`, `aws:tgwa`, and `aws:vpce` resolve to their canonical symbols.

Provider definitions live in [src/symbols/aws.ts](src/symbols/aws.ts) and [src/symbols/core.ts](src/symbols/core.ts). To add another icon family, implement a `SymbolProvider` and register it in [src/symbols/registry.ts](src/symbols/registry.ts). Parsing, layout, and rendering consume the shared symbol model, so provider-specific details stay isolated.

## Containers and layout

AWS containers include `aws:cloud`, `aws:vpc`, `aws:subnet`, `aws:private_subnet`, `aws:public_subnet`, and `aws:az`. `core:group` provides a neutral alternative. Containers use braces and can be nested.

```text
direction right   # right, left, down, or up
layout elk        # elk or dagre
```

- **ELK** is the default. It provides hierarchy-aware orthogonal routing and editable bendpoints.
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
