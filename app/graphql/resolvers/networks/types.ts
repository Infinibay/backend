import { Field, ObjectType, InputType } from "type-graphql";

@ObjectType()
export class NetworkBridge {
  @Field(() => String)
  name: string = "";

  @Field(() => String)
  stp: string = "on";

  @Field(() => String)
  delay: string = "0";
}

@ObjectType()
export class NetworkDhcpRange {
  @Field(() => String)
  start: string = "";

  @Field(() => String)
  end: string = "";
}

@ObjectType()
export class NetworkDhcp {
  @Field(() => NetworkDhcpRange)
  range: NetworkDhcpRange = new NetworkDhcpRange();
}

@ObjectType()
export class NetworkIp {
  @Field(() => String)
  address: string = "";

  @Field(() => String)
  netmask: string = "";

  @Field(() => NetworkDhcp, { nullable: true })
  dhcp?: NetworkDhcp;
}

@ObjectType()
export class Network {
  @Field(() => String)
  name: string = "";

  @Field(() => String)
  uuid: string = "";

  @Field(() => NetworkBridge)
  bridge: NetworkBridge = new NetworkBridge();

  @Field(() => NetworkIp)
  ip: NetworkIp = new NetworkIp();

  @Field(() => String, { nullable: true })
  description?: string;
}

// Input types for mutations
@InputType()
export class NetworkDhcpRangeInput {
  @Field(() => String)
  start: string = '';

  @Field(() => String)
  end: string = '';
}

@InputType()
export class NetworkIpConfigInput {
  @Field(() => String)
  address: string = '';

  @Field(() => String)
  netmask: string = '';

  @Field(() => NetworkDhcpRangeInput, { nullable: true })
  dhcp?: NetworkDhcpRangeInput;
}

@InputType()
export class CreateNetworkInput {
  @Field(() => String)
  name: string = '';

  @Field(() => String)
  bridgeName: string = '';

  @Field(() => String)
  description: string = '';

  @Field(() => NetworkIpConfigInput, { nullable: true })
  ipConfig?: NetworkIpConfigInput;

  @Field(() => Boolean, { nullable: true })
  enableIntraNetworkCommunication?: boolean;

  @Field(() => [String], { nullable: true })
  enabledServices?: string[];
}

@InputType()
export class IpRangeInput {
  @Field(() => String)
  networkName: string = "";

  @Field(() => String)
  start: string = "";

  @Field(() => String)
  end: string = "";
}

@InputType()
export class NetworkIpInput {
  @Field(() => String)
  networkName: string = "";

  @Field(() => String)
  address: string = "";

  @Field(() => String)
  netmask: string = "";
}

@InputType()
export class BridgeNameInput {
  @Field(() => String)
  networkName: string = "";

  @Field(() => String)
  bridgeName: string = "";
}

@InputType()
export class DeleteNetworkInput {
  @Field()
  name!: string;
}