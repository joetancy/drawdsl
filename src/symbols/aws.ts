import type { SymbolDefinition, SymbolProvider } from "../model.js";

const AWS4 = "mxgraph.aws4";

function resource(
    icon: string,
    fill = "#527FFF",
    stroke = "#ffffff",
): SymbolDefinition {
    return {
        role: "resource",
        drawio: {
            shape: `${AWS4}.resourceIcon`,
            resIcon: `${AWS4}.${icon}`,
            fill,
            stroke,
        },
    };
}

function shape(
    name: string,
    fill = "#527FFF",
    stroke = "none",
    dimensions?: Pick<SymbolDefinition, "widthScale" | "heightScale">,
): SymbolDefinition {
    return {
        role: "resource",
        drawio: { shape: `${AWS4}.${name}`, fill, stroke },
        ...dimensions,
    };
}

function group(
    fill: string,
    stroke: string,
    icon: string,
    fontColor: string,
    suppressBorder = false,
    dashed = false,
): SymbolDefinition {
    return {
        role: "container",
        drawio: {
            shape: `${AWS4}.group`,
            fill,
            stroke,
            styles: [
                `grIcon=${AWS4}.${icon}`,
                ...(suppressBorder ? ["grStroke=0"] : []),
                `fontColor=${fontColor}`,
                ...(dashed ? ["dashed=1"] : []),
            ],
        },
    };
}

const symbols: Record<string, SymbolDefinition> = {
    cloud: group("none", "#232F3E", "group_aws_cloud_alt", "#232F3E"),
    vpc: group("none", "#8C4FFF", "group_vpc2", "#AAB7B8"),
    subnet: group("#E6F6F7", "#00A4A6", "group_security_group", "#147EBA", true),
    private_subnet: group(
        "#E6F6F7",
        "#00A4A6",
        "group_security_group",
        "#147EBA",
        true,
    ),
    public_subnet: group(
        "#F2F6E8",
        "#7AA116",
        "group_security_group",
        "#248814",
        true,
    ),
    az: group("none", "#147EBA", "group_availability_zone", "#147EBA"),
    region: group("none", "#00A4A6", "group_region", "#147EBA", false, true),
    internet: shape("internet", "#232F3D", "none", {
        widthScale: 1,
        heightScale: 0.6,
    }),
    apigateway: resource("api_gateway", "#E7157B"),
    app_config: resource("app_config", "#E7157B"),
    alb: shape("application_load_balancer", "#8C4FFF"),
    aoss: resource("elasticsearch_service"),
    backup: resource("backup", "#277116"),
    certificate_manager_2: shape("certificate_manager_2", "#BF0816"),
    certificate_manager_3: resource("certificate_manager_3", "#C7131F"),
    client_vpn: resource("client_vpn", "#5A30B5"),
    cloudfront: resource("cloudfront", "#8C4FFF"),
    cloudhsm: resource("cloudhsm", "#C7131F"),
    cloudtrail: resource("cloudtrail", "#BC1356"),
    cloudwatch_2: resource("cloudwatch_2", "#BC1356"),
    dynamodb: resource("dynamodb", "#C925D1"),
    ec2: resource("ec2"),
    ecr: resource("ecr"),
    ecs: resource("ecs", "#ED7100"),
    eks: resource("eks"),
    elb: resource("elastic_load_balancing"),
    elasticsearch_service: resource("elasticsearch_service", "#8C4FFF"),
    eni: shape("elastic_network_interface", "#8C4FFF"),
    endpoint: shape("endpoint", "#4D27AA"),
    eventbridge: resource("eventbridge"),
    general: resource("general", "#1E262E"),
    generic_firewall: shape("generic_firewall", "#232F3E"),
    guardduty: resource("guardduty", "#DD344C"),
    iam: resource("identity_and_access_management"),
    inspector: resource("inspector", "#C7131F"),
    internetgateway: shape("internet_gateway", "#8C4FFF"),
    key_management_service: resource("key_management_service", "#C7131F"),
    kinesis_data_stream: resource("kinesis_data_streams", "#8C4FFF"),
    lambda: resource("lambda", "#ED7100"),
    natgateway: shape("nat_gateway", "#8C4FFF"),
    network_firewall_endpoints: shape("network_firewall_endpoints", "#DD344C"),
    networkfirewall: resource("network_firewall", "#DD344C"),
    nlb: shape("network_load_balancer", "#8C4FFF"),
    rds: resource("rds"),
    role: shape("role", "#DD344C"),
    route53: resource("route_53"),
    route_53_resolver: shape("route_53_resolver", "#4D27AA"),
    s3: resource("s3", "#7AA116"),
    secretsmanager: resource("secrets_manager"),
    security_hub: resource("security_hub", "#C7131F"),
    ses: resource("simple_email_service", "#3334B9"),
    shield: resource("shield_shield_advanced", "#DD344C"),
    simple_email_service: resource("simple_email_service", "#3334B9"),
    sns: resource("sns", "#E7157B"),
    sqs: resource("sqs", "#E7157B"),
    stepfunctions: resource("step_functions"),
    tgw: resource("transit_gateway"),
    tgwa: shape("transit_gateway_attachment", "#8C4FFF"),
    vpcendpoint: shape("endpoints", "#8C4FFF"),
    waf: resource("waf", "#DD344C"),
};

export const awsProvider: SymbolProvider = {
    namespace: "aws",
    symbols,
    aliases: {
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
    },
};
