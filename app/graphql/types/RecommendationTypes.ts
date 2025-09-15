import { ObjectType, Field, ID, registerEnumType, InputType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { RecommendationType } from '@prisma/client'

// Register Prisma enum for GraphQL
registerEnumType(RecommendationType, {
  name: 'RecommendationType',
  description: 'Types of VM recommendations that can be generated'
})

/**
 * VM recommendation object type
 */
@ObjectType()
export class VMRecommendationType {
  @Field(() => ID)
    id!: string

  @Field(() => ID)
    machineId!: string

  @Field(() => ID, { nullable: true })
    snapshotId?: string | null

  @Field(() => RecommendationType)
    type!: RecommendationType

  @Field(() => String)
    text!: string

  @Field(() => String)
    actionText!: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    data?: Record<string, any> | null

  @Field(() => Date)
    createdAt!: Date
}

/**
 * Input type for filtering recommendations
 */
@InputType()
export class RecommendationFilterInput {
  @Field(() => [RecommendationType], { nullable: true })
    types?: RecommendationType[]

  @Field(() => Date, { nullable: true })
    createdAfter?: Date

  @Field(() => Date, { nullable: true })
    createdBefore?: Date

  @Field(() => Number, { nullable: true })
    limit?: number
}

/**
 * Response type for recommendation operations
 */
@ObjectType()
export class RecommendationResponse {
  @Field(() => Boolean)
    success!: boolean

  @Field(() => String, { nullable: true })
    message?: string

  @Field(() => [VMRecommendationType])
    recommendations!: VMRecommendationType[]

  @Field(() => String, { nullable: true })
    error?: string
}

/**
 * Aggregated recommendation statistics for a VM
 */
@ObjectType()
export class RecommendationStats {
  @Field(() => ID)
    machineId!: string

  @Field(() => Number)
    totalRecommendations!: number

  @Field(() => Number)
    criticalRecommendations!: number

  @Field(() => Number)
    warningRecommendations!: number

  @Field(() => Number)
    infoRecommendations!: number

  @Field(() => Date, { nullable: true })
    lastGeneratedDate?: Date

  @Field(() => [RecommendationType])
    mostCommonTypes!: RecommendationType[]

  @Field(() => Number)
    resolvedCount!: number
}