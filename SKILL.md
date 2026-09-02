# DrawDSL authoring skill

You create architecture diagrams using DrawDSL, a small text language that renders to editable draw.io diagrams.

## Rules

- Return only a valid DrawDSL document unless the user asks for explanation.
- Every resource declaration must use a namespace: `aws:lambda handler`, not `lambda handler`.
- Give every resource a short, unique, unnamespaced ID. Use that ID in edges.
- Use quoted labels only when a readable label is needed. Labels support `\n`, `\"`, and `\\`.
- Put related resources inside containers with braces.
- Use `#` for comments outside quoted labels.
- Do not use `core:layout` or `core:spacer` as edge endpoints.
- Prefer clear, modest diagrams. Add only resources and edges supported by the request.

## Syntax

Resources and containers:

```text
namespace:symbol id "Optional label"
aws:cloud cloud "AWS Cloud" {
    aws:region region "ap-southeast-1" {
        aws:lambda worker
    }
}
```

Edges:

```text
source --> target       # directed, solid
source -.-> target       # directed, dashed
source --- target        # undirected, solid
source -.- target        # undirected, dashed
source <--> target       # bidirectional, solid
source <-.-> target      # bidirectional, dashed
```

Pin an endpoint to a side with `T:`, `R:`, `B:`, or `L:`:

```text
R:api --> T:service
```

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

Document-level directives include `direction right|left|down|up`, `node-spacing N`, `layer-spacing N`, `edge-spacing N`, and `padding N`.

Use `core:layout` plus `grid-columns N` to place direct children in declaration order, left to right and then top to bottom. Nested layout containers can create columns without visible groups. Grid children may be connected, but layout containers cannot be edge endpoints:

```text
core:layout grid {
    grid-columns 5
    core:layout far_left {
        grid-columns 1
        aws:tgw internet_gateway
    }
    aws:lambda handler
    aws:dynamodb data
}
```

`grid-columns` must be inside a container and the container must have at least one child. Use `core:spacer` when an empty grid slot is needed.

## Before answering

Check that all edge endpoints are declared, IDs are unique, containers are closed, and every container declaration has `{}`. Keep the output valid DrawDSL and use the smallest diagram that communicates the requested architecture.

## Example

```text
direction right

aws:internet internet "Users"
aws:cloud cloud "AWS Cloud" {
    aws:region region "ap-southeast-1" {
        core:layout app_grid {
            grid-columns 3
            aws:apigw api "API Gateway"
            aws:lambda handler "Request handler"
            aws:dynamodb data "Application data"
        }
    }
}

internet --> api : HTTPS
api --> handler
handler --> data
```
