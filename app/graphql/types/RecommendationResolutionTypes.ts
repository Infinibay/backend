import { ObjectType, Field, ID, Int, InputType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { ResolutionStatus } from '@prisma/client'

registerEnumType(ResolutionStatus, {
  name: 'ResolutionStatus',
  description: 'Lifecycle state of an auto-resolve execution for a VM recommendation'
})

@ObjectType({ description: 'Auto-resolve execution for a VM recommendation' })
export class RecommendationResolutionType {
  @Field(() => ID)
    id!: string

  @Field(() => ID)
    recommendationId!: string

  @Field(() => ID)
    machineId!: string

  @Field(() => String, { description: 'Key identifying which resolver handler ran (e.g. install_updates, reboot)' })
    actionKey!: string

  @Field(() => ResolutionStatus)
    status!: ResolutionStatus

  @Field(() => Int, { description: '0-100 progress indicator' })
    progress!: number

  @Field(() => String, { nullable: true })
    progressMessage?: string | null

  @Field(() => GraphQLJSONObject, { nullable: true })
    params?: Record<string, unknown> | null

  @Field(() => GraphQLJSONObject, { nullable: true })
    result?: Record<string, unknown> | null

  @Field(() => String, { nullable: true })
    error?: string | null

  @Field(() => ID)
    triggeredByUserId!: string

  @Field(() => Date, { nullable: true })
    startedAt?: Date | null

  @Field(() => Date, { nullable: true })
    completedAt?: Date | null

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}

@InputType({ description: 'Parameters for resolveRecommendation. Pass confirmed=true for destructive actions.' })
export class ResolveRecommendationParamsInput {
  @Field(() => Boolean, { nullable: true, description: 'User confirmation for destructive actions (reboot, install updates)' })
    confirmed?: boolean

  @Field(() => Date, { nullable: true, description: 'When to run the action (for schedule_reboot)' })
    scheduledAt?: Date

  @Field(() => [String], { nullable: true, description: 'Specific package names to update (defaults to all)' })
    packages?: string[]

  @Field(() => Boolean, { nullable: true, description: 'Filter to security updates only' })
    securityOnly?: boolean
}
