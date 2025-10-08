import { Field, ID, Int, ObjectType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { RuleAction, RuleDirection, RuleSetType } from '@prisma/client'

// Register enums for GraphQL
registerEnumType(RuleSetType, {
  name: 'RuleSetType',
  description: 'Type of firewall rule set (Department or VM)'
})

registerEnumType(RuleAction, {
  name: 'RuleAction',
  description: 'Action to take on matched traffic'
})

registerEnumType(RuleDirection, {
  name: 'RuleDirection',
  description: 'Direction of network traffic'
})

export enum ConflictType {
  DUPLICATE = 'DUPLICATE',
  CONTRADICTORY = 'CONTRADICTORY',
  PORT_OVERLAP = 'PORT_OVERLAP',
  PRIORITY_CONFLICT = 'PRIORITY_CONFLICT'
}

registerEnumType(ConflictType, {
  name: 'ConflictType',
  description: 'Type of rule conflict'
})

// ============================================================================
// FirewallRule Type
// ============================================================================

@ObjectType()
export class FirewallRuleType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    ruleSetId!: string

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

  @Field(() => String)
    protocol!: string

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

  @Field(() => Boolean)
    overridesDept!: boolean

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}

// ============================================================================
// FirewallRuleSet Type
// ============================================================================

@ObjectType()
export class FirewallRuleSetType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string

  @Field(() => String)
    internalName!: string

  @Field(() => RuleSetType)
    entityType!: RuleSetType

  @Field(() => String)
    entityId!: string

  @Field(() => Int)
    priority!: number

  @Field(() => Boolean)
    isActive!: boolean

  @Field(() => String, { nullable: true })
    libvirtUuid?: string

  @Field(() => String, { nullable: true })
    xmlContent?: string

  @Field(() => Date, { nullable: true })
    lastSyncedAt?: Date

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date

  @Field(() => [FirewallRuleType])
    rules!: FirewallRuleType[]
}

// ============================================================================
// Validation Types
// ============================================================================

@ObjectType()
export class RuleConflictType {
  @Field(() => ConflictType)
    type!: ConflictType

  @Field(() => String)
    message!: string

  @Field(() => [FirewallRuleType])
    affectedRules!: FirewallRuleType[]
}

// ============================================================================
// Effective Rule Set (VM rules merged with department)
// ============================================================================

@ObjectType()
export class EffectiveRuleSetType {
  @Field(() => ID)
    vmId!: string

  @Field(() => [FirewallRuleType])
    departmentRules!: FirewallRuleType[]

  @Field(() => [FirewallRuleType])
    vmRules!: FirewallRuleType[]

  @Field(() => [FirewallRuleType])
    effectiveRules!: FirewallRuleType[]

  @Field(() => [RuleConflictType])
    conflicts!: RuleConflictType[]
}

@ObjectType()
export class ValidationResultType {
  @Field(() => Boolean)
    isValid!: boolean

  @Field(() => [RuleConflictType])
    conflicts!: RuleConflictType[]

  @Field(() => [String])
    warnings!: string[]
}

// ============================================================================
// Operation Result Types
// ============================================================================

@ObjectType()
export class FlushResultType {
  @Field(() => Boolean)
    success!: boolean

  @Field(() => ID)
    vmId!: string

  @Field(() => Int)
    rulesApplied!: number

  @Field(() => String)
    libvirtFilterName!: string

  @Field(() => Date)
    timestamp!: Date
}

@ObjectType()
export class SyncResultType {
  @Field(() => Boolean)
    success!: boolean

  @Field(() => Int)
    filtersCreated!: number

  @Field(() => Int)
    filtersUpdated!: number

  @Field(() => Int)
    vmsUpdated!: number

  @Field(() => [String])
    errors!: string[]
}

@ObjectType()
export class CleanupResultType {
  @Field(() => Boolean)
    success!: boolean

  @Field(() => Int)
    filtersRemoved!: number

  @Field(() => [String])
    filterNames!: string[]
}

@ObjectType()
export class LibvirtFilterInfoType {
  @Field(() => String)
    name!: string

  @Field(() => String, { nullable: true })
    uuid?: string
}
