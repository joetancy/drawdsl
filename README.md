# drawdsl

`drawdsl` is a deterministic TypeScript command-line tool for turning a small AWS-oriented architecture DSL into an editable draw.io (`.drawio`) diagram. It uses ELK to lay out nodes and containers, then writes native draw.io XML with AWS 4 icons and group shapes.

## Getting started

Install the project dependencies:

```bash
npm install
```

Generate the bundled example:

```bash
npm run example
```

This creates `examples/aws.drawio`. Open that file in [diagrams.net](https://www.diagrams.net/) or draw.io Desktop, where every generated item remains editable.

To convert another source file:

```bash
npm run generate -- input.drawdsl output.drawio
```

The CLI requires both paths. It exits with an error when parsing fails, an ID is duplicated, or an edge refers to a node that was not declared.

## DSL at a glance

Each non-empty line is one declaration, connection, container delimiter, or direction setting. `#` starts a comment unless it appears inside a quoted label.

```text
direction right
layout elk

internet "Public internet"

aws production "Production AWS Account" {
  cloudfront website "rental.example.gov.sg"
  waf web_acl "Web ACL"
  s3 frontend "Frontend"
}

internet --> website : HTTPS
website -.- web_acl
website -.-> frontend : "Origin request"
```

Whitespace is flexible. IDs and types may contain letters, numbers, underscores, and hyphens, but must begin with a letter or underscore.

### Direction

Set the overall ELK layout direction with one of:

```text
direction right
direction left
direction down
direction up
```

If omitted, the direction is `right`. It is a top-level setting and cannot appear inside a container block.

### Layout engine

ELK is the default layout engine. It is the best choice for diagrams with nested groups and many connectors because it provides orthogonal routing and exports ELK's bendpoints as editable draw.io waypoints.

Use Dagre for a lighter, compact Sugiyama-style layered layout:

```text
layout dagre
direction down
```

`layout` is a top-level setting. Its values are `elk` and `dagre`; omitting it is the same as `layout elk`. Dagre supports the same resource, container, direction, and connection syntax, but its connector routing is simpler.

The paired [ELK example](examples/elk.drawdsl) and [Dagre example](examples/dagre.drawdsl) use the same input graph, so they are directly comparable. Generate both with:

```bash
npm run examples
```

### Nodes

The normal declaration form is:

```text
type id "Displayed label"
```

The ID and label are optional:

```text
cloudfront website "Website"  # explicit ID and label
cloudfront website            # label defaults to "website"
cloudfront "Website"          # ID defaults to "cloudfront"
cloudfront                    # ID is "cloudfront"; label is "cloudfront"
internet                      # label is "Internet"
```

IDs are global across the whole document, including nested containers. Use explicit IDs whenever a type occurs more than once. Quoted labels support `\"`, `\\`, and `\n` escapes.

Recognised resources render as AWS icons. An unrecognised type is still valid and renders as a neutral rounded rectangle, which makes the DSL usable for custom systems too.

Use `text` to add an editable annotation box. Its width and height are calculated from the label; `textbox` is an alias. Labels may span literal lines or use `\n`.

```text
text deployment_note "Deploys only from the approved CI pipeline"
textbox owner_note "Platform team owns this VPC"
```

### AWS resource types

The following resource keywords have an AWS-specific icon or shape:

```text
internet          general               illustration_desktop  illustration_users
apigateway        alb                   nlb                   elb
cloudfront        waf                   shield                cloudhsm
client_vpn        internetgateway       natgateway            endpoint
vpcendpoint       eni                   tgw                   tgwa
route53           route_53_resolver     lambda                dynamodb
s3                sqs                   sns                   eventbridge
kinesis_data_stream ecr                 ecs                   eks
elasticsearch_service aoss              rds                   iam
role              secretsmanager        key_management_service certificate_manager_2
certificate_manager_3 cloudwatch_2      cloudtrail            backup
guardduty         inspector             security_hub          networkfirewall
network_firewall_endpoints generic_firewall app_config         ses
simple_email_service stepfunctions
text
```

These aliases are accepted:

| Alias | Canonical type |
| --- | --- |
| `api_gateway` | `apigateway` |
| `igw`, `internet_gateway` | `internetgateway` |
| `kinesis`, `kinesisdatastream`, `kinesis_data_streams` | `kinesis_data_stream` |
| `nat`, `nat_gateway` | `natgateway` |
| `networkloadbalancer`, `network_load_balancer` | `nlb` |
| `transitgateway`, `transit_gateway` | `tgw` |
| `transitgatewayattachment`, `transit_gateway_attachment` | `tgwa` |
| `vpce` | `vpcendpoint` |
| `textbox` | `text` |

For AWS icons with a longer resource name, use the keyword exactly as listed above. For example:

```text
client_vpn staff_vpn "Staff VPN"
route_53_resolver inbound_dns "Inbound Resolver"
network_firewall_endpoints firewall_endpoints "Network Firewall endpoints"
key_management_service kms "KMS"
security_hub security_hub "Security Hub"
illustration_users users "Application users"
```

### Containers

Containers use the same declaration form followed by `{`, and must be closed with `}`. They can be nested.

```text
aws cloud "AWS Cloud" {
  vpc app_vpc "Application VPC" {
    public_subnet public_web "Public subnet" {
      alb ingress "Application Load Balancer"
    }
    private_subnet private_app "Private subnet" {
      lambda handler "Application handler"
    }
  }
}
```

Supported container types are `aws`, `vpc`, `subnet`, `private_subnet`, `public_subnet`, `az`, and `group`. `subnet` and `private_subnet` use the private-subnet style; `public_subnet` uses a distinct public-subnet style. A container without `{` is an error, as is a `{` block on a resource declaration.

### Connections

Connections can appear inside or outside containers and may connect any two declared IDs:

```text
source --> target       # directed, solid
source -.-> target      # directed, dashed
source --- target       # undirected, solid
source -.- target       # undirected, dashed
source --> target : HTTPS
source --> target : "HTTPS via CloudFront"
```

An edge label is optional and is displayed in draw.io. Lines are validated after all declarations have been read, so forward references are allowed.

## Layout and output

ELK uses the layered algorithm with the selected direction, orthogonal routing, and hierarchy support for nested containers. It determines node positions, container sizes, and intermediate connector bends. Those bends are written as editable draw.io edge waypoints, while the connector endpoints remain attached to their source and target cells.

The generated file has one page named `Architecture` and uses draw.io's AWS 4 library styles for supported AWS resources and containers.

## Development

The project currently has no automated test suite. The example generation command is the practical end-to-end smoke test:

```bash
npm run example
npm run generate -- examples/dagre.drawdsl examples/dagre.drawio
npm run examples
```
