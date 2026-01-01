import { Field, ID, InputType, Int } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import {
  AutomationScope,
  AutomationStatus,
  AutomationExecutionStatus,
  AutomationRecommendationStatus,
  RecommendationSeverity,
  BlockOutputType,
  OS
} from '@prisma/client'
import { SnoozeDuration } from './types'

// ============================================================================
// Automation Inputs
// ============================================================================

@InputType()
export class CreateAutomationInput {
  @Field(() => String)
    name!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => GraphQLJSONObject)
    blocklyWorkspace!: Record<string, unknown>

  @Field(() => AutomationScope, { nullable: true, defaultValue: AutomationScope.ALL_VMS })
    targetScope?: AutomationScope

  @Field(() => ID, { nullable: true })
    departmentId?: string

  @Field(() => [ID], { nullable: true, description: 'VMs to include (for SPECIFIC_VMS scope)' })
    targetMachineIds?: string[]

  @Field(() => [ID], { nullable: true, description: 'VMs to exclude (for EXCLUDE_VMS scope)' })
    excludeMachineIds?: string[]

  @Field(() => Int, { nullable: true, defaultValue: 100 })
    priority?: number

  @Field(() => Int, { nullable: true, defaultValue: 60 })
    cooldownMinutes?: number

  @Field(() => String, { nullable: true })
    recommendationType?: string

  @Field(() => String, { nullable: true })
    recommendationText?: string

  @Field(() => String, { nullable: true })
    recommendationActionText?: string
}

@InputType()
export class UpdateAutomationInput {
  @Field(() => String, { nullable: true })
    name?: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    blocklyWorkspace?: Record<string, unknown>

  @Field(() => AutomationScope, { nullable: true })
    targetScope?: AutomationScope

  @Field(() => ID, { nullable: true })
    departmentId?: string

  @Field(() => [ID], { nullable: true, description: 'VMs to include (for SPECIFIC_VMS scope)' })
    targetMachineIds?: string[]

  @Field(() => [ID], { nullable: true, description: 'VMs to exclude (for EXCLUDE_VMS scope)' })
    excludeMachineIds?: string[]

  @Field(() => Int, { nullable: true })
    priority?: number

  @Field(() => Int, { nullable: true })
    cooldownMinutes?: number

  @Field(() => String, { nullable: true })
    recommendationType?: string

  @Field(() => String, { nullable: true })
    recommendationText?: string

  @Field(() => String, { nullable: true })
    recommendationActionText?: string
}

@InputType()
export class AutomationFiltersInput {
  @Field(() => [AutomationStatus], { nullable: true })
    status?: AutomationStatus[]

  @Field(() => Boolean, { nullable: true })
    isEnabled?: boolean

  @Field(() => ID, { nullable: true })
    departmentId?: string

  @Field(() => String, { nullable: true })
    search?: string

  @Field(() => ID, { nullable: true })
    createdById?: string
}

@InputType()
export class AutomationExecutionFiltersInput {
  @Field(() => ID, { nullable: true })
    automationId?: string

  @Field(() => ID, { nullable: true })
    machineId?: string

  @Field(() => [AutomationExecutionStatus], { nullable: true })
    status?: AutomationExecutionStatus[]

  @Field(() => Boolean, { nullable: true })
    evaluationResult?: boolean

  @Field(() => Date, { nullable: true })
    dateFrom?: Date

  @Field(() => Date, { nullable: true })
    dateTo?: Date
}

// ============================================================================
// Script Linking Inputs
// ============================================================================

@InputType()
export class LinkScriptToAutomationInput {
  @Field(() => ID)
    automationId!: string

  @Field(() => ID, { nullable: true, description: 'ID of regular script (mutually exclusive with systemScriptId)' })
    scriptId?: string

  @Field(() => ID, { nullable: true, description: 'ID of system script (mutually exclusive with scriptId)' })
    systemScriptId?: string

  @Field(() => OS)
    os!: OS

  @Field(() => Int, { nullable: true, defaultValue: 0 })
    executionOrder?: number

  @Field(() => Boolean, { nullable: true, defaultValue: true })
    executeOnTrigger?: boolean
}

// ============================================================================
// Custom Block Inputs
// ============================================================================

@InputType()
export class CustomBlockInputDef {
  @Field(() => String)
    name!: string

  @Field(() => String)
    type!: string

  @Field(() => String)
    label!: string

  @Field(() => Boolean, { nullable: true, defaultValue: false })
    required?: boolean

  @Field(() => GraphQLJSONObject, { nullable: true })
    defaultValue?: Record<string, unknown>
}

@InputType()
export class CreateCustomBlockInput {
  @Field(() => String)
    name!: string

  @Field(() => String)
    displayName!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => String)
    category!: string

  @Field(() => GraphQLJSONObject)
    blockDefinition!: Record<string, unknown>

  @Field(() => String)
    generatorCode!: string

  @Field(() => [CustomBlockInputDef])
    inputs!: CustomBlockInputDef[]

  @Field(() => BlockOutputType)
    outputType!: BlockOutputType

  @Field(() => [OS], { nullable: true, defaultValue: [OS.WINDOWS, OS.LINUX] })
    supportedOS?: OS[]
}

@InputType()
export class UpdateCustomBlockInput {
  @Field(() => String, { nullable: true })
    displayName?: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => String, { nullable: true })
    category?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    blockDefinition?: Record<string, unknown>

  @Field(() => String, { nullable: true })
    generatorCode?: string

  @Field(() => [CustomBlockInputDef], { nullable: true })
    inputs?: CustomBlockInputDef[]

  @Field(() => BlockOutputType, { nullable: true })
    outputType?: BlockOutputType

  @Field(() => [OS], { nullable: true })
    supportedOS?: OS[]

  @Field(() => Boolean, { nullable: true })
    isEnabled?: boolean
}

// ============================================================================
// Recommendation Inputs
// ============================================================================

@InputType()
export class RecommendationFiltersInput {
  @Field(() => ID, { nullable: true })
    machineId?: string

  @Field(() => ID, { nullable: true })
    automationId?: string

  @Field(() => [AutomationRecommendationStatus], { nullable: true })
    status?: AutomationRecommendationStatus[]

  @Field(() => [RecommendationSeverity], { nullable: true })
    severity?: RecommendationSeverity[]
}

// ============================================================================
// System Script Inputs
// ============================================================================

@InputType()
export class CreateSystemScriptInput {
  @Field(() => String)
    name!: string

  @Field(() => String)
    displayName!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => String, { nullable: true })
    codeWindows?: string

  @Field(() => String, { nullable: true })
    codeLinux?: string

  @Field(() => String, { nullable: true, defaultValue: 'General' })
    category?: string

  @Field(() => [String], { nullable: true, defaultValue: [] })
    requiredHealthFields?: string[]
}

@InputType()
export class UpdateSystemScriptInput {
  @Field(() => String, { nullable: true })
    displayName?: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => String, { nullable: true })
    codeWindows?: string

  @Field(() => String, { nullable: true })
    codeLinux?: string

  @Field(() => String, { nullable: true })
    category?: string

  @Field(() => [String], { nullable: true })
    requiredHealthFields?: string[]

  @Field(() => Boolean, { nullable: true })
    isEnabled?: boolean
}
