# drawdsl 🪄

> A vibe-coded 🧑‍💻 architecture DSL that turns infrastructure ideas into editable draw.io diagrams 📐

`drawdsl` converts a small, namespaced architecture language into native draw.io XML. It ships with AWS icons ☁️, editable text, remote images and groups, ELK orthogonal routing, and first-class connection layers for switching between data flows without duplicating the architecture.

## Quick start

```bash
npm install
npm run generate -- examples/example.drawdsl output.drawio
```

Open `output.drawio` in [diagrams.net](https://www.diagrams.net/) or draw.io Desktop. Generated nodes, groups, labels, and connectors remain editable. The original DSL is embedded as a `drawdslSource` custom property on the Architecture layer; it is a snapshot and does not track later edits made in draw.io.

Generate the bundled example:

```bash
npm run examples
```

This generates the bundled architecture example in `examples/`.

The bundled examples cover multi-tier AWS architecture, nested containers, grids, routing controls, all edge styles, and connection layers with shared style defaults, hidden flows, chained edges, endpoint pinning, inline layer assignment, and native draw.io layer export.

## A tiny example

Linear relationships can be written as a chain; each segment remains a distinct edge:

```text
internet --> gateway --> handler --> data
```

Declare the nodes as usual. Chain labels are not supported; use a separate binary edge when it needs a label.

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

Every resource declaration uses `namespace:name`. The namespace selects a symbol provider; the optional ID and quoted label follow it. Node IDs are unnamespaced and global within the document. Connection layer IDs use a separate namespace.

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

These selectors mean top, right, bottom, and left respectively. They are honored by the router and preserved in draw.io.

Set an edge's color and width with bracketed options. Hex colors accept `#RGB` and `#RRGGBB`; define a named color once and reuse it:

```text
color primary = #f90
color alert = #D13212

source --> target [color=primary, width=3] : HTTPS
target -.-> source [color=alert]
source --- target [color=#123ABC, width=2]
```

Color constants must be declared at document level before use. Edge width is a positive integer from 1 to 10000. An edge can inherit its color and width from a connection layer. Without an edge or layer default, width is 1 and color is draw.io's default.

Set a `core:group` background using the same constants or a hex value:

```text
color panel = #EEF2F7
core:group services "Services" [background=panel] {
    col 2
    aws:lambda api
    aws:lambda worker
}
```

Labels support `\"`, `\\`, and `\n` escapes. `#` starts a comment outside quoted labels except when it begins a hex color value. Unqualified declarations such as `lambda handler` are intentionally rejected.

## Connection layers

Declare the architecture once, then put each data flow on a separate connection layer. Nodes and containers stay on Architecture. Unassigned edges use Connections. No plugin is required.

```text
color requestColor = #2563EB
color eventColor = #15803D

aws:apigw api "API Gateway"
aws:lambda handler "Request handler"
aws:dynamodb data "Application data"
aws:sqs queue "Event queue"

# Unassigned: implicit Connections layer.
api --> handler : HTTPS

# Layer-level style defaults + chained edges + endpoint pinning.
layer requests "Request flow" [color=requestColor, width=2] {
    R:api --> L:handler --> data
}

# Hidden-by-default flow + explicit per-edge override.
layer events "Event flow" [color=eventColor, width=2, visible=false] {
    handler -.-> queue : Publish
    queue --> data [color=#0F766E, width=3] : Persist
}
```

Layers are top-level, edge-only metadata scopes, not layout containers. Each edge belongs to exactly one layer. Chains inherit the containing layer, and an explicit edge color or width overrides the layer default.

Edges declared outside a layer block can use `[layer=...]`, including forward references:

```text
handler --> audit [layer=audit] : Write audit record

layer audit "Audit flow" [color=#7C3AED, visible=false] {
}
```

The ID `connections` is reserved for the implicit default layer. Layer IDs and node IDs use separate namespaces.

Use the preview checkboxes, **All flows**, **Architecture only**, or **Reset layers** to compare flows without recompiling, rerunning ELK, or rerouting edges. Nodes, waypoints, labels, zoom, and pan remain stable. Preview choices survive edits and theme changes, but do not change the source or canonical export. Use `visible=false` in the DSL when a flow should be saved or shared as initially hidden.

Exported `.drawio` files contain native root-level layers for Connections and every named flow, while nodes remain on Architecture. The original DSL is stored on the Architecture layer as the `drawdslSource` custom property, so the source travels with the diagram as a snapshot. Open the file directly in draw.io and use its Layers panel.

See the [complete layer reference](docs/layers.md) and the [capability example](examples/flows.drawdsl).

```bash
npm run generate -- examples/flows.drawdsl flows.drawio
```

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

Use `core:image` with a quoted absolute HTTP(S) URL. The image is embedded as an editable draw.io image cell at a default size of 160×80; its displayed label is intentionally empty. URLs containing `;` are rejected because `;` delimits draw.io styles.

```text
core:image architecture_reference "https://example.com/architecture.png"
```

Provider definitions live in [src/symbols/aws.ts](src/symbols/aws.ts) and [src/symbols/core.ts](src/symbols/core.ts). To add another icon family, implement a `SymbolProvider` and register it in [src/symbols/registry.ts](src/symbols/registry.ts). Parsing, layout, and rendering consume the shared symbol model, so provider-specific details stay isolated.

## Containers and layout

AWS containers include `aws:cloud`, `aws:region`, `aws:vpc`, `aws:subnet`, `aws:private_subnet`, `aws:public_subnet`, and `aws:az`. `core:group` provides a neutral alternative. Containers use braces and can be nested.

Use `core:layout` for an invisible, structural container. Its ID is optional; when omitted, a unique internal ID is generated. It affects placement but does not create a draw.io cell, border, or label. This is useful when the visual architecture needs stable columns or grids without introducing another visible group.

Use `core:spacer` without an ID to reserve an empty, icon-sized grid slot. It is not rendered or available as an edge endpoint:

```text
aws:lambda first
core:spacer
aws:lambda third
```

```text
aws:vpc application {
    core:layout application_grid {
        col 2

        core:layout compute_column {
            col 1
            aws:lambda api
            aws:lambda worker
        }

        core:layout data_column {
            col 1
            aws:sqs jobs
            aws:dynamodb records
        }
    }
}

api --> jobs
worker --> records
```

`col N` sets a container’s direct-child grid column count. Child subtrees are first sized, then placed into an exact declaration-ordered grid. When omitted, containers automatically use `ceil(sqrt(child count))` columns (six children use three columns; nine use three). Each column uses the width of its widest child, each row uses the height of its tallest child, and smaller children are centered within their cells. ELK uses those finished bounds when laying out the surrounding visible container. Resources inside a grid can still have edges. `core:layout` cannot be used as an edge endpoint.

Layout settings use the same flat, hyphenated syntax as the existing directives. Document-level values apply throughout the diagram; a setting inside a container overrides that container's direct-child layout:

```text
direction right
node-spacing 120
layer-spacing 180
edge-spacing 24
padding 40

core:layout application_grid {
    col 5
    node-spacing 60
    padding 20
}
```

`direction` accepts `right`, `left`, `down`, or `up`. `node-spacing`, `layer-spacing`, and `edge-spacing` accept integer pixel values from 1 to 10000; `padding` accepts 0 to 10000 and applies equally to all four sides. `col` accepts 1 to 10000 and must be inside a container with at least one child. `edge-spacing` is document-only. Each directive may be set only once per document or container; duplicates fail. Partial configuration is supported.

`layer-spacing` controls ELK layout ranks, not connection visibility layers.

Labels support `\n`, `\"`, and `\\` escapes, including literal multiline quoted labels; CRLF line endings parse like LF. Errors report the offending source line in both the CLI and the playground, where a Go-to-line button focuses the editor.

When omitted, root nodes use 240px spacing, resources inside containers use 80px, container-only siblings use 160px, layout ranks use 240px, and routed edge lanes use 20px. Root padding is 40px; visible containers use 40px vertically and 80px horizontally; invisible `core:layout` containers have no padding. Explicit document-level `node-spacing` or `padding` replaces these tiered defaults.

Containers can also override the document flow direction for their non-grid children:

```text
core:group workers {
    direction down
    aws:lambda first
    aws:lambda second
}
```

Container directions support `right`, `left`, `down`, and `up`. A local `direction` opts that container into ELK layout; explicit `col` remains grid-ordered and takes precedence. The document direction still controls only the top-level layout.

ELK positions the hierarchy and the orthogonal router uses the completed geometry. Visible containers unrelated to either endpoint remain routing obstacles, while source and destination ancestor containers stay traversable so connections can enter and leave them. `core:layout` is never an obstacle. Draw.io receives the resulting bendpoints and attachment points.

`edge-spacing` sets the target pitch for clear, overlapping parallel route segments. The obstacle-aware cleanup equalizes movable interior runs and separates closer lanes; fixed endpoint stubs, junctions, and obstacles can prevent uniform spacing near nodes or turns. A straight route is not bent solely to create a parallel lane. Unrelated visible container borders receive the internal 40px routing clearance; source and destination ancestors remain traversable. Perpendicular crossings are allowed and do not affect routing.

Explicit `T:`, `R:`, `B:`, and `L:` endpoint selectors remain available when a relationship needs a specific source or target side.

```text
direction right   # right, left, down, or up
```

## Commands

Development and CI use Node 24 (`engines.node >= 24`).

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

Browser regressions run against the production build. The default suite uses a stubbed diagrams.net viewer for repeatable app and adapter checks:

```bash
npm run web:build
npm run test:web
```

A separate smoke test loads the native viewer. It needs network access:

```bash
DRAWDSL_LIVE_VIEWER=1 npx playwright test web-tests/layers-live.spec.ts
```

CI runs both suites. The native test checks real edge labels and layer switches and saves desktop and mobile screenshots. Screenshots and failure traces are available in the `browser-test-evidence` artifact.

The test suite covers parsing, namespace resolution, layout, routing, formatting, provider styles, connection layers, and draw.io rendering.

## Web playground

Run the browser playground locally:

```bash
npm run web:dev
```

Production builds are written to `dist/`:

```bash
npm run web:build
npm run web:preview
```

The repository deploys the playground to `https://joetancy.github.io/drawdsl/` on pushes to `main`. In GitHub, select **Settings → Pages → Build and deployment → Source → GitHub Actions** once to enable it.

Use **Copy share link** to copy a self-contained link to the current DSL. The playground stores the diagram in the URL fragment, compressing it when that produces a shorter link; no diagram data is sent to or stored by a backend. The URL updates three seconds after you stop typing, while the copy button always creates the current link immediately. Anyone with the link can read its contents, so do not include secrets. Compressed links use `#v=1&z=...` and take precedence over legacy `#dsl=...` links; unsupported versions are rejected. Share imports are limited to 1 MiB encoded and 2 MiB decoded DSL.

The editor highlights DSL syntax and reports errors inline, with a Go-to-line button for diagnostics. Containers and connection layer blocks collapse via the fold gutter chevrons (or **Fold all**); folded lines stay part of the diagram. Use **Format DrawDSL** to normalize indentation, **Show draw.io XML** to inspect the generated output (with **Copy draw.io XML** to copy it), and **Dark mode** to toggle the preview theme. **Download .drawdsl** saves the exact current source (even invalid drafts) and **Download .drawio** saves the current successful output with the source embedded as `drawdslSource`; failed compiles cannot download stale XML. The embedded DSL is a snapshot and won’t reflect later edits in draw.io. Filenames reuse the loaded diagram name with a safe fallback. **DSL guide** and **SKILL.md** open the authoring help; the skill text is loaded from `SKILL.md` and can be copied for LLM-assisted diagramming.

Use **Saved** to keep named diagrams in this browser's local storage (via **Save copy**, with **Save** updating the loaded diagram). Saved diagrams stay on the device until deleted and are never sent anywhere.

## Recent fixes

- Labels decode `\n`, `\"`, and `\\` in a single pass, so a literal `\\n` stays backslash-plus-n instead of becoming a newline.
- Parallel edges between the same nodes are all passed to ELK instead of being collapsed to one.
- The playground skill dialog loads `SKILL.md` at build time instead of shipping a second copy in `index.html`.
- CI runs type-check, lint, and tests on pull requests as well as `main`.
