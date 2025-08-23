import { ObjectType, Field, ID, InputType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'

@ObjectType()
export class ServiceInfo {
  @Field(() => String)
  name: string = ''

  @Field(() => String)
  displayName: string = ''

  @Field(() => String)
  status: string = ''

  @Field(() => String, { nullable: true })
  description?: string

  @Field(() => Boolean)
  canStart: boolean = false

  @Field(() => Boolean)
  canStop: boolean = false

  @Field(() => Boolean)
  canRestart: boolean = false

  @Field(() => String, { nullable: true })
  startupType?: string
}

@ObjectType()
export class PackageInfo {
  @Field(() => String)
  name: string = ''

  @Field(() => String)
  version: string = ''

  @Field(() => String, { nullable: true })
  description?: string

  @Field(() => String, { nullable: true })
  publisher?: string

  @Field(() => String, { nullable: true })
  installDate?: string

  @Field(() => Number, { nullable: true })
  size?: number

  @Field(() => String)
  source: string = '' // winget, apt, yum, dnf, snap, etc
}

@ObjectType()
export class VMSnapshot {
  @Field(() => String)
  name: string = ''

  @Field(() => String, { nullable: true })
  description?: string

  @Field(() => Date)
  createdAt: Date = new Date()

  @Field(() => String)
  state: string = ''

  @Field(() => Boolean)
  current: boolean = false

  @Field(() => String, { nullable: true })
  parent?: string
}

@ObjectType()
export class SimplifiedFirewallRule {
  @Field(() => ID)
  id: string = ''

  @Field(() => String)
  name: string = ''

  @Field(() => String)
  direction: string = '' // inbound/outbound

  @Field(() => String)
  action: string = '' // allow/deny

  @Field(() => String, { nullable: true })
  protocol?: string

  @Field(() => Number, { nullable: true })
  port?: number

  @Field(() => String, { nullable: true })
  portRange?: string

  @Field(() => String, { nullable: true })
  sourceIp?: string

  @Field(() => String, { nullable: true })
  destinationIp?: string

  @Field(() => String, { nullable: true })
  application?: string

  @Field(() => Number)
  priority: number = 1000

  @Field(() => Boolean)
  enabled: boolean = true
}

@InputType()
export class ServiceActionInput {
  @Field(() => String)
  vmId: string = ''

  @Field(() => String)
  serviceName: string = ''

  @Field(() => String)
  action: string = '' // start, stop, restart, enable, disable
}

@InputType()
export class PackageActionInput {
  @Field(() => String)
  vmId: string = ''

  @Field(() => String)
  packageName: string = ''

  @Field(() => String)
  action: string = '' // install, remove, update

  @Field(() => String, { nullable: true })
  version?: string

  @Field(() => String, { nullable: true })
  source?: string // winget, apt, etc
}

@InputType()
export class CreateSnapshotInput {
  @Field(() => String)
  vmId: string = ''

  @Field(() => String)
  name: string = ''

  @Field(() => String, { nullable: true })
  description?: string
}

@InputType()
export class CreateSimplifiedFirewallRuleInput {
  @Field(() => String)
  vmId: string = ''

  @Field(() => String)
  name: string = ''

  @Field(() => String)
  direction: string = ''

  @Field(() => String)
  action: string = ''

  @Field(() => String, { nullable: true })
  protocol?: string

  @Field(() => Number, { nullable: true })
  port?: number

  @Field(() => String, { nullable: true })
  portRange?: string

  @Field(() => String, { nullable: true })
  sourceIp?: string

  @Field(() => String, { nullable: true })
  destinationIp?: string

  @Field(() => String, { nullable: true })
  application?: string

  @Field(() => Number, { nullable: true })
  priority?: number

  @Field(() => Boolean, { nullable: true })
  enabled?: boolean
}

@ObjectType()
export class CommandResult {
  @Field(() => Boolean)
  success: boolean = false

  @Field(() => String, { nullable: true })
  output?: string

  @Field(() => String, { nullable: true })
  error?: string

  @Field(() => Number)
  exitCode: number = 0
}