import { ObjectType, Field, ID, InputType, registerEnumType } from 'type-graphql'

// Enum for firewall templates
export enum FirewallTemplate {
  WEB_SERVER = 'WEB_SERVER',
  DATABASE = 'DATABASE',
  DESKTOP = 'DESKTOP',
  DEVELOPMENT = 'DEVELOPMENT'
}

registerEnumType(FirewallTemplate, {
  name: 'FirewallTemplate',
  description: 'Predefined firewall template configurations'
})

@ObjectType()
export class SimplifiedFirewallRule {
  @Field(() => ID, { nullable: true })
  id?: string

  @Field(() => String)
  port!: string // Can be number or "all"

  @Field()
  protocol!: string

  @Field()
  direction!: string // 'in' | 'out' | 'inout'

  @Field()
  action!: string // 'accept' | 'drop' | 'reject'

  @Field({ nullable: true })
  description?: string

  @Field(() => [String], { nullable: true })
  sources?: string[] // Which templates or custom rules created this
}

@ObjectType()
export class VMFirewallState {
  @Field(() => [String])
  appliedTemplates!: string[]

  @Field(() => [SimplifiedFirewallRule])
  customRules!: SimplifiedFirewallRule[]

  @Field(() => [SimplifiedFirewallRule])
  effectiveRules!: SimplifiedFirewallRule[]

  @Field(() => Date, { nullable: true })
  lastSync!: Date | null
}

@ObjectType()
export class FirewallTemplateInfo {
  @Field()
  name!: string

  @Field()
  description!: string

  @Field(() => [SimplifiedFirewallRule])
  rules!: SimplifiedFirewallRule[]
}

@InputType()
export class SimplifiedFirewallRuleInput {
  @Field()
  port!: string

  @Field()
  protocol!: string

  @Field()
  direction!: string

  @Field({ defaultValue: 'accept' })
  action!: string

  @Field({ nullable: true })
  description?: string
}

@InputType()
export class CreateSimplifiedFirewallRuleInput {
  @Field(() => ID)
  machineId!: string

  @Field()
  port!: string

  @Field({ defaultValue: 'tcp' })
  protocol!: string

  @Field({ defaultValue: 'in' })
  direction!: string

  @Field({ defaultValue: 'accept' })
  action!: string

  @Field({ nullable: true })
  description?: string
}

@InputType()
export class ApplyFirewallTemplateInput {
  @Field(() => ID)
  machineId!: string

  @Field(() => FirewallTemplate)
  template!: FirewallTemplate
}