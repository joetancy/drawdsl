# drawdsl

`drawdsl` converts a namespaced architecture DSL into editable draw.io XML. ELK is the default layout engine; Dagre is available for compact layered layouts.

## Usage

```bash
npm install
npm run generate -- input.drawdsl output.drawio
npm run lint -- input.drawdsl
npm run format -- input.drawdsl
npm run format:write -- input.drawdsl
```

`lint` parses the file without generating output. `format` prints canonical four-space indentation; `format:write` updates the source file.

## Namespaced DSL

Every declaration must use `namespace:name`. The namespace selects a symbol provider and the name selects a symbol in that provider:

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

Unqualified declarations such as `lambda handler` are rejected with a migration hint. Node IDs remain unnamespaced and are global across the document. Labels support `\"`, `\\`, and `\n` escapes. `#` starts a comment outside quoted labels.

For an existing file, the included one-time migrator prefixes declarations with the built-in namespaces:

```bash
node --import tsx scripts/migrate-namespaces.ts old.drawdsl
```

The built-in providers are:

- `aws:*` — AWS resource icons, AWS shapes, and AWS group containers.
- `core:text` — editable text annotation.
- `core:box` — generic editable resource box.
- `core:group` — generic container.

Provider definitions live in [src/symbols/aws.ts](src/symbols/aws.ts) and [src/symbols/core.ts](src/symbols/core.ts). Add another provider by implementing `SymbolProvider` and registering it in [src/symbols/registry.ts](src/symbols/registry.ts); the parser, layout engines, and renderer consume the shared symbol model and do not need provider-specific changes.

AWS aliases are namespace-local, for example `aws:apigw`, `aws:igw`, `aws:kinesis`, `aws:nat`, `aws:nlb`, `aws:tgw`, `aws:tgwa`, and `aws:vpce`.

## Containers, directions, and layouts

AWS containers include `aws:cloud`, `aws:vpc`, `aws:subnet`, `aws:private_subnet`, `aws:public_subnet`, and `aws:az`. `core:group` is a provider-neutral container. Containers open with `{` and close with `}`.

```text
direction right   # right, left, down, or up
layout elk        # elk or dagre
```

ELK provides hierarchy-aware orthogonal routing and editable bendpoints. Dagre provides a compact layered arrangement but simpler routing. Compare the bundled inputs with:

```bash
npm run examples
```

## Development

```bash
npm run check
npm test
```

The parser, formatter, provider registry, and draw.io renderer are covered by tests in `tests/`.
