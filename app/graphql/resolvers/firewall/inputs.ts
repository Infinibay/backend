import { Field, InputType, Int } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { RuleAction, RuleDirection } from '@prisma/client'

// ============================================================================
// Firewall Rule Inputs
// ============================================================================

@InputType()
export class CreateFirewallRuleInput {
  @Field(() => String)
    name!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => RuleAction)
    action!: RuleAction

  @Field(() => RuleDirection)
    direction!: RuleDirection

  @Field(() => Int)
    priority!: number

  @Field(() => String, { nullable: true, defaultValue: 'all' })
    protocol?: string

  @Field(() => Int, { nullable: true })
    srcPortStart?: number

  @Field(() => Int, { nullable: true })
    srcPortEnd?: number

  @Field(() => Int, { nullable: true })
    dstPortStart?: number

  @Field(() => Int, { nullable: true })
    dstPortEnd?: number

  @Field(() => String, { nullable: true })
    srcIpAddr?: string

  @Field(() => String, { nullable: true })
    srcIpMask?: string

  @Field(() => String, { nullable: true })
    dstIpAddr?: string

  @Field(() => String, { nullable: true })
    dstIpMask?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    connectionState?: Record<string, boolean>

  @Field(() => Boolean, { nullable: true, defaultValue: false })
    overridesDept?: boolean
}

@InputType()
export class UpdateFirewallRuleInput {
  @Field(() => String, { nullable: true })
    name?: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => RuleAction, { nullable: true })
    action?: RuleAction

  @Field(() => RuleDirection, { nullable: true })
    direction?: RuleDirection

  @Field(() => Int, { nullable: true })
    priority?: number

  @Field(() => String, { nullable: true })
    protocol?: string

  @Field(() => Int, { nullable: true })
    srcPortStart?: number

  @Field(() => Int, { nullable: true })
    srcPortEnd?: number

  @Field(() => Int, { nullable: true })
    dstPortStart?: number

  @Field(() => Int, { nullable: true })
    dstPortEnd?: number

  @Field(() => String, { nullable: true })
    srcIpAddr?: string

  @Field(() => String, { nullable: true })
    srcIpMask?: string

  @Field(() => String, { nullable: true })
    dstIpAddr?: string

  @Field(() => String, { nullable: true })
    dstIpMask?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    connectionState?: Record<string, boolean>

  @Field(() => Boolean, { nullable: true })
    overridesDept?: boolean
}
