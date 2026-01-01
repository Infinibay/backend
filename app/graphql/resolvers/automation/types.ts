import { Field, ID, Int, Float, ObjectType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import {
  AutomationScope,
  AutomationStatus,
  AutomationExecutionStatus,
  BlockOutputType,
  AutomationRecommendationStatus,
  RecommendationSeverity,
  RecommendationUserAction,
  OS
} from '@prisma/client'

// ============================================================================
// Register Prisma Enums for GraphQL
// ============================================================================

registerEnumType(AutomationScope, {
  name: 'AutomationScope',
  description: 'Scope of automation targeting'
})

registerEnumType(AutomationStatus, {
  name: 'AutomationStatus',
  description: 'Workflow status of an automation'
})

registerEnumType(AutomationExecutionStatus, {
  name: 'AutomationExecutionStatus',
  description: 'Status of an automation execution'
})

registerEnumType(BlockOutputType, {
  name: 'BlockOutputType',
  description: 'Output type of a custom block'
})

registerEnumType(AutomationRecommendationStatus, {
  name: 'AutomationRecommendationStatus',
  description: 'Status of an automation recommendation'
})

registerEnumType(RecommendationSeverity, {
  name: 'RecommendationSeverity',
  description: 'Severity level of a recommendation'
})

registerEnumType(RecommendationUserAction, {
  name: 'RecommendationUserAction',
  description: 'User action taken on a recommendation'
})

// Custom enum for snooze durations (ISO 8601 format)
export enum SnoozeDuration {
  PT1H = 'PT1H', // 1 hour
  PT4H = 'PT4H', // 4 hours
  PT24H = 'PT24H', // 24 hours
  P7D = 'P7D' // 7 days
}

registerEnumType(SnoozeDuration, {
  name: 'SnoozeDuration',
  description: 'Duration for snoozing a recommendation (ISO 8601)'
})

// Enum for automation events
export enum AutomationEventTypeEnum {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  DELETED = 'DELETED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
  TRIGGERED = 'TRIGGERED',
  EXECUTION_STARTED = 'EXECUTION_STARTED',
  EXECUTION_COMPLETED = 'EXECUTION_COMPLETED',
  EXECUTION_FAILED = 'EXECUTION_FAILED'
}

registerEnumType(AutomationEventTypeEnum, {
  name: 'AutomationEventType',
  description: 'Type of automation event'
})

// ============================================================================
// User Type (partial, for relations)
// ============================================================================

@ObjectType()
export class AutomationUserType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string

  @Field(() => String, { nullable: true })
    email?: string
}

// ============================================================================
// Department Type (partial, for relations)
// ============================================================================

@ObjectType()
export class AutomationDepartmentType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string
}

// ============================================================================
// Machine Type (partial, for relations)
// ============================================================================

@ObjectType()
export class AutomationMachineType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string

  @Field(() => OS, { nullable: true })
    osType?: OS
}

// ============================================================================
// Script Type (partial, for relations)
// ============================================================================

@ObjectType()
export class AutomationScriptRefType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string

  @Field(() => OS)
    os!: OS
}

// ============================================================================
// SystemScript Type
// ============================================================================

@ObjectType()
export class SystemScriptType {
  @Field(() => ID)
    id!: string

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

  @Field(() => String)
    category!: string

  @Field(() => [String])
    requiredHealthFields!: string[]

  @Field(() => Boolean)
    isEnabled!: boolean

  @Field(() => AutomationUserType, { nullable: true })
    createdBy?: AutomationUserType

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}

// ============================================================================
// CustomBlock Types
// ============================================================================

@ObjectType()
export class CustomBlockInputType {
  @Field(() => String)
    name!: string

  @Field(() => String)
    type!: string

  @Field(() => String)
    label!: string

  @Field(() => Boolean)
    required!: boolean

  @Field(() => GraphQLJSONObject, { nullable: true })
    defaultValue?: Record<string, unknown>
}

@ObjectType()
export class CustomBlockType {
  @Field(() => ID)
    id!: string

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

  @Field(() => [CustomBlockInputType])
    inputs!: CustomBlockInputType[]

  @Field(() => BlockOutputType)
    outputType!: BlockOutputType

  @Field(() => [OS])
    supportedOS!: OS[]

  @Field(() => Boolean)
    isBuiltIn!: boolean

  @Field(() => Boolean)
    isEnabled!: boolean

  @Field(() => AutomationUserType, { nullable: true })
    createdBy?: AutomationUserType

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}

// ============================================================================
// Blockly Toolbox Types
// ============================================================================

@ObjectType()
export class BlockDefinitionOutputType {
  @Field(() => String)
    type!: string

  @Field(() => String)
    message0!: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    args0?: Record<string, unknown>

  @Field(() => String, { nullable: true })
    output?: string

  @Field(() => Boolean, { nullable: true })
    previousStatement?: boolean

  @Field(() => Boolean, { nullable: true })
    nextStatement?: boolean

  @Field(() => Int)
    colour!: number

  @Field(() => String, { nullable: true })
    tooltip?: string

  @Field(() => String, { nullable: true })
    helpUrl?: string
}

@ObjectType()
export class ToolboxCategoryType {
  @Field(() => String)
    name!: string

  @Field(() => String)
    colour!: string

  @Field(() => [BlockDefinitionOutputType])
    blocks!: BlockDefinitionOutputType[]
}

@ObjectType()
export class BlocklyToolboxType {
  @Field(() => [ToolboxCategoryType])
    categories!: ToolboxCategoryType[]
}

// ============================================================================
// Validation Types
// ============================================================================

@ObjectType()
export class ValidationErrorType {
  @Field(() => String, { nullable: true })
    blockId?: string

  @Field(() => String)
    message!: string
}

@ObjectType()
export class ValidationWarningType {
  @Field(() => String, { nullable: true })
    blockId?: string

  @Field(() => String)
    message!: string
}

@ObjectType()
export class AutomationValidationResultType {
  @Field(() => Boolean)
    isValid!: boolean

  @Field(() => [ValidationErrorType])
    errors!: ValidationErrorType[]

  @Field(() => [ValidationWarningType])
    warnings!: ValidationWarningType[]
}

// ============================================================================
// Test Result Type
// ============================================================================

@ObjectType()
export class TestResultType {
  @Field(() => Boolean)
    success!: boolean

  @Field(() => Boolean, { nullable: true })
    result?: boolean

  @Field(() => String)
    generatedCode!: string

  @Field(() => Int)
    evaluationTimeMs!: number

  @Field(() => String, { nullable: true })
    error?: string

  @Field(() => [String])
    logs!: string[]
}

// ============================================================================
// AutomationTarget Type
// ============================================================================

@ObjectType()
export class AutomationTargetType {
  @Field(() => ID)
    id!: string

  @Field(() => AutomationMachineType)
    machine!: AutomationMachineType

  @Field(() => Date)
    createdAt!: Date
}

// ============================================================================
// AutomationScript Type (linking automation to remediation scripts)
// ============================================================================

@ObjectType()
export class AutomationScriptType {
  @Field(() => ID)
    id!: string

  @Field(() => AutomationScriptRefType, { nullable: true })
    script?: AutomationScriptRefType

  @Field(() => SystemScriptType, { nullable: true })
    systemScript?: SystemScriptType

  @Field(() => OS)
    os!: OS

  @Field(() => Int)
    executionOrder!: number

  @Field(() => Boolean)
    isEnabled!: boolean

  @Field(() => Boolean)
    executeOnTrigger!: boolean
}

// ============================================================================
// ScriptExecution Type (partial, for relations)
// ============================================================================

@ObjectType()
export class AutomationScriptExecutionType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    status!: string

  @Field(() => Date, { nullable: true })
    startedAt?: Date

  @Field(() => Date, { nullable: true })
    completedAt?: Date
}

// ============================================================================
// VMHealthSnapshot Type (partial, for relations)
// ============================================================================

@ObjectType()
export class AutomationSnapshotType {
  @Field(() => ID)
    id!: string

  @Field(() => Date)
    snapshotDate!: Date
}

// ============================================================================
// AutomationExecution Type
// ============================================================================

@ObjectType()
export class AutomationExecutionType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    automationId!: string

  @Field(() => AutomationMachineType)
    machine!: AutomationMachineType

  @Field(() => AutomationSnapshotType, { nullable: true })
    snapshot?: AutomationSnapshotType

  @Field(() => String)
    triggerReason!: string

  @Field(() => Boolean)
    evaluationResult!: boolean

  @Field(() => AutomationExecutionStatus)
    status!: AutomationExecutionStatus

  @Field(() => GraphQLJSONObject, { nullable: true })
    contextSnapshot?: Record<string, unknown>

  @Field(() => Int, { nullable: true })
    evaluationTimeMs?: number

  @Field(() => AutomationScriptExecutionType, { nullable: true })
    scriptExecution?: AutomationScriptExecutionType

  @Field(() => String, { nullable: true })
    error?: string

  @Field(() => Date)
    triggeredAt!: Date

  @Field(() => Date, { nullable: true })
    evaluatedAt?: Date

  @Field(() => Date, { nullable: true })
    completedAt?: Date
}

// ============================================================================
// AutomationRecommendation Type
// ============================================================================

@ObjectType()
export class AutomationRecommendationType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    automationId!: string

  @Field(() => AutomationMachineType)
    machine!: AutomationMachineType

  @Field(() => AutomationExecutionType, { nullable: true })
    execution?: AutomationExecutionType

  @Field(() => String)
    title!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => RecommendationSeverity)
    severity!: RecommendationSeverity

  @Field(() => AutomationRecommendationStatus)
    status!: AutomationRecommendationStatus

  @Field(() => RecommendationUserAction, { nullable: true })
    userAction?: RecommendationUserAction

  @Field(() => AutomationUserType, { nullable: true })
    actionTakenBy?: AutomationUserType

  @Field(() => Date, { nullable: true })
    actionTakenAt?: Date

  @Field(() => Date, { nullable: true })
    snoozeUntil?: Date

  @Field(() => String, { nullable: true })
    dismissReason?: string

  @Field(() => AutomationScriptRefType, { nullable: true })
    script?: AutomationScriptRefType

  @Field(() => SystemScriptType, { nullable: true })
    systemScript?: SystemScriptType

  @Field(() => AutomationScriptExecutionType, { nullable: true })
    scriptExecution?: AutomationScriptExecutionType

  @Field(() => Date, { nullable: true })
    autoResolvedAt?: Date

  @Field(() => String, { nullable: true })
    autoResolveReason?: string

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}

// ============================================================================
// Main Automation Type
// ============================================================================

@ObjectType()
export class AutomationType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string

  @Field(() => String, { nullable: true })
    description?: string

  // Blockly state
  @Field(() => GraphQLJSONObject)
    blocklyWorkspace!: Record<string, unknown>

  @Field(() => String)
    generatedCode!: string

  @Field(() => Boolean)
    isCompiled!: boolean

  @Field(() => String, { nullable: true })
    compiledCode?: string

  @Field(() => String, { nullable: true })
    compilationError?: string

  // Targeting
  @Field(() => AutomationScope)
    targetScope!: AutomationScope

  @Field(() => AutomationDepartmentType, { nullable: true })
    department?: AutomationDepartmentType

  @Field(() => [AutomationTargetType])
    targets!: AutomationTargetType[]

  // Status
  @Field(() => AutomationStatus)
    status!: AutomationStatus

  @Field(() => Boolean)
    isEnabled!: boolean

  // Execution settings
  @Field(() => Int)
    priority!: number

  @Field(() => Int)
    cooldownMinutes!: number

  // Recommendation config
  @Field(() => String, { nullable: true })
    recommendationType?: string

  @Field(() => String, { nullable: true })
    recommendationText?: string

  @Field(() => String, { nullable: true })
    recommendationActionText?: string

  // Relations
  @Field(() => [AutomationScriptType])
    automationScripts!: AutomationScriptType[]

  @Field(() => [AutomationExecutionType])
    recentExecutions!: AutomationExecutionType[]

  // Stats (computed fields)
  @Field(() => Int)
    executionCount!: number

  @Field(() => Date, { nullable: true })
    lastTriggeredAt?: Date

  @Field(() => Float, { nullable: true })
    triggerRate?: number

  // Audit
  @Field(() => AutomationUserType, { nullable: true })
    createdBy?: AutomationUserType

  @Field(() => AutomationUserType, { nullable: true })
    approvedBy?: AutomationUserType

  @Field(() => Date, { nullable: true })
    approvedAt?: Date

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}

// ============================================================================
// Automation Event Type (for subscriptions)
// ============================================================================

@ObjectType()
export class AutomationEventType {
  @Field(() => AutomationEventTypeEnum)
    type!: AutomationEventTypeEnum

  @Field(() => AutomationType, { nullable: true })
    automation?: AutomationType

  @Field(() => AutomationExecutionType, { nullable: true })
    execution?: AutomationExecutionType

  @Field(() => Date)
    timestamp!: Date
}

// ============================================================================
// Automation Template Type
// ============================================================================

@ObjectType()
export class AutomationTemplateType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => String)
    category!: string

  @Field(() => String, { nullable: true })
    recommendationType?: string

  @Field(() => GraphQLJSONObject)
    blocklyWorkspace!: Record<string, unknown>

  @Field(() => Boolean)
    isEnabled!: boolean

  @Field(() => Int)
    usageCount!: number

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}
