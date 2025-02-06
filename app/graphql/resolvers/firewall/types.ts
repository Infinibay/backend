import { ObjectType, Field, ID, Int, InputType } from "type-graphql";

@ObjectType()
export class VmPortInfo {
  @Field(() => ID)
  vmId: string = '';

  @Field()
  name: string = '';

  @Field(() => [PortInfo])
  ports: PortInfo[] = [];
}

@ObjectType()
export class PortInfo {
  @Field(() => Int)
  portStart: number = 0;

  @Field(() => Int)
  portEnd: number = 0;

  @Field()
  protocol: string = '';

  @Field()
  running: boolean = false;

  @Field()
  enabled: boolean = false;

  @Field()
  toEnable: boolean = false;

  @Field(() => Date)
  lastSeen: Date = new Date();
}

@ObjectType()
export class IpRange {
  @Field()
  start: string = '';

  @Field()
  end: string = '';
}

@ObjectType()
export class PortRange {
  @Field(() => Int)
  start: number = 0;

  @Field(() => Int)
  end: number = 0;
}

@ObjectType()
export class FirewallRuleGroup {
  @Field()
  name: string = '';

  @Field(() => [FirewallRule])
  rules: FirewallRule[] = [];
}

@ObjectType()
export class FirewallRule {
  @Field()
  protocol: 'tcp' | 'udp' | 'ip' = 'tcp';

  @Field(() => Int, { nullable: true })
  portNumber?: number;

  @Field(() => PortRange, { nullable: true })
  portRange?: PortRange;

  @Field(() => String, { nullable: true })
  ipv4?: string;

  @Field(() => IpRange, { nullable: true })
  ipv4Range?: IpRange;

  @Field(() => String, { nullable: true })
  ipv6?: string;

  @Field(() => IpRange, { nullable: true })
  ipv6Range?: IpRange;

  @Field()
  action: 'accept' | 'reject' | 'drop' = 'accept';
}

@ObjectType()
export class DepartmentPortInfo {
  @Field(() => ID)
  id: string = '';

  @Field(() => ID)
  departmentId: string = '';

  @Field(() => Int)
  portStart: number = 0;

  @Field(() => Int)
  portEnd: number = 0;

  @Field()
  protocol: string = '';

  @Field()
  enabled: boolean = false;

  @Field()
  toEnable: boolean = false;

  @Field(() => Date)
  lastSeen: Date = new Date();
}

@ObjectType()
export class DepartmentConfigurationInfo {
  @Field(() => ID)
  id: string = '';

  @Field(() => ID)
  departmentId: string = '';

  @Field()
  cleanTraffic: boolean = false;
}

@InputType()
export class UpdatePortStatusInput {
  @Field(() => ID)
  id: string = '';

  @Field()
  toEnable: boolean = false;
}

@InputType()
export class CreateDepartmentPortInput {
  @Field(() => ID)
  departmentId: string = '';

  @Field(() => Int)
  portStart: number = 0;

  @Field(() => Int)
  portEnd: number = 0;

  @Field()
  protocol: string = '';

  @Field()
  toEnable: boolean = false;
}

@InputType()
export class UpdateDepartmentConfigInput {
  @Field(() => ID)
  departmentId: string = '';

  @Field()
  cleanTraffic: boolean = false;
}