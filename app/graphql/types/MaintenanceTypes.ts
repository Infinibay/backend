import { ObjectType, Field, ID, registerEnumType, InputType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { MaintenanceTaskType, MaintenanceStatus, MaintenanceTrigger } from '@prisma/client'

// Register Prisma enums for GraphQL
registerEnumType(MaintenanceTaskType, {
  name: 'MaintenanceTaskType',
  description: 'Types of maintenance tasks that can be performed'
})

registerEnumType(MaintenanceStatus, {
  name: 'MaintenanceStatus',
  description: 'Status of maintenance task execution'
})

registerEnumType(MaintenanceTrigger, {
  name: 'MaintenanceTrigger',
  description: 'What triggered the maintenance task execution'
})

/**
 * Maintenance task configuration and details
 */
@ObjectType()
export class MaintenanceTask {
  @Field(() => ID)
    id!: string

  @Field(() => ID)
    machineId!: string

  @Field(() => MaintenanceTaskType)
    taskType!: MaintenanceTaskType

  @Field()
    name!: string

  @Field(() => String, { nullable: true })
    description?: string | null

  @Field()
    isEnabled!: boolean

  @Field()
    isRecurring!: boolean

  @Field(() => String, { nullable: true })
    cronSchedule?: string | null

  @Field(() => Date, { nullable: true })
    runAt?: Date | null

  @Field(() => Date, { nullable: true })
    nextRunAt?: Date | null

  @Field(() => Date, { nullable: true })
    lastRunAt?: Date | null

  @Field()
    executionStatus!: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    parameters?: Record<string, any> | null

  @Field(() => ID)
    createdByUserId!: string

  @Field()
    createdAt!: Date

  @Field()
    updatedAt!: Date
}

/**
 * Maintenance task execution history
 */
@ObjectType()
export class MaintenanceHistory {
  @Field(() => ID)
    id!: string

  @Field(() => ID, { nullable: true })
    taskId?: string | null

  @Field(() => ID)
    machineId!: string

  @Field(() => MaintenanceTaskType)
    taskType!: MaintenanceTaskType

  @Field(() => MaintenanceStatus)
    status!: MaintenanceStatus

  @Field(() => MaintenanceTrigger)
    triggeredBy!: MaintenanceTrigger

  @Field(() => ID, { nullable: true })
    executedByUserId?: string | null

  @Field()
    executedAt!: Date

  @Field(() => Number, { nullable: true })
    duration?: number | null

  @Field(() => GraphQLJSONObject, { nullable: true })
    result?: Record<string, any> | null

  @Field(() => String, { nullable: true })
    error?: string | null

  @Field(() => GraphQLJSONObject, { nullable: true })
    parameters?: Record<string, any> | null
}

/**
 * Input type for creating maintenance tasks
 */
@InputType()
export class CreateMaintenanceTaskInput {
  @Field(() => ID)
    machineId!: string

  @Field(() => MaintenanceTaskType)
    taskType!: MaintenanceTaskType

  @Field()
    name!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field({ defaultValue: true })
    isEnabled!: boolean

  @Field({ defaultValue: false })
    isRecurring!: boolean

  @Field(() => String, { nullable: true })
    cronSchedule?: string

  @Field(() => Date, { nullable: true })
    runAt?: Date

  @Field(() => GraphQLJSONObject, { nullable: true })
    parameters?: Record<string, any>
}

/**
 * Input type for updating maintenance tasks
 */
@InputType()
export class UpdateMaintenanceTaskInput {
  @Field(() => ID)
    id!: string

  @Field(() => String, { nullable: true })
    name?: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field({ nullable: true })
    isEnabled?: boolean

  @Field({ nullable: true })
    isRecurring?: boolean

  @Field(() => String, { nullable: true })
    cronSchedule?: string

  @Field(() => Date, { nullable: true })
    runAt?: Date

  @Field(() => GraphQLJSONObject, { nullable: true })
    parameters?: Record<string, any>
}

/**
 * Input type for executing immediate maintenance
 */
@InputType()
export class ExecuteMaintenanceInput {
  @Field(() => ID)
    machineId!: string

  @Field(() => MaintenanceTaskType)
    taskType!: MaintenanceTaskType

  @Field(() => GraphQLJSONObject, { nullable: true })
    parameters?: Record<string, any>
}

/**
 * Response type for maintenance task operations
 */
@ObjectType()
export class MaintenanceTaskResponse {
  @Field()
    success!: boolean

  @Field(() => String, { nullable: true })
    message?: string

  @Field(() => MaintenanceTask, { nullable: true })
    task?: MaintenanceTask

  @Field(() => String, { nullable: true })
    error?: string
}

/**
 * Response type for maintenance execution operations
 */
@ObjectType()
export class MaintenanceExecutionResponse {
  @Field()
    success!: boolean

  @Field(() => String, { nullable: true })
    message?: string

  @Field(() => MaintenanceHistory, { nullable: true })
    execution?: MaintenanceHistory

  @Field(() => String, { nullable: true })
    error?: string
}

/**
 * Aggregated maintenance statistics for a VM
 */
@ObjectType()
export class MaintenanceStats {
  @Field(() => ID)
    machineId!: string

  @Field()
    totalTasks!: number

  @Field()
    enabledTasks!: number

  @Field()
    recurringTasks!: number

  @Field(() => Date, { nullable: true })
    lastExecutionDate?: Date

  @Field()
    totalExecutions!: number

  @Field()
    successfulExecutions!: number

  @Field()
    failedExecutions!: number

  @Field()
    pendingTasks!: number
}
