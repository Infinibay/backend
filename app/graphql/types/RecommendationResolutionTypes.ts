import { ObjectType, Field, ID, Int, InputType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { ResolutionStatus } from '@prisma/client'
import { UserInputError } from '@utils/errors'

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

  // Defense-in-depth bound on the package list. type-graphql's class-validator
  // pipeline is not enabled here (buildSchema's `validate` defaults to false and
  // class-validator is not a dependency), so field decorators would be no-ops;
  // instead we validate at the input boundary via this setter, which type-graphql
  // invokes when it Object.assigns the decoded args onto a fresh instance.
  // Rejecting oversized/malformed arrays stops the install-updates handler from
  // fanning out an unbounded number of sequential per-package guest commands (each
  // with a 5-minute timeout) and confines names to a safe charset before they reach
  // the privileged guest agent. Validated input is stored as an own enumerable
  // `packages` data property (shadowing this accessor) so the persisted params and
  // the GraphQL output keep their exact original shape.
  @Field(() => [String], { nullable: true, description: 'Specific package names to update (defaults to all)' })
  get packages (): string[] | undefined {
    return undefined
  }

  set packages (value: string[] | undefined) {
    if (value != null) {
      if (!Array.isArray(value) || value.length > 100) {
        throw new UserInputError('Too many package names (maximum 100).')
      }
      for (const name of value) {
        if (typeof name !== 'string' || name.length > 200 ||
            !/^[A-Za-z0-9][A-Za-z0-9._+:~-]*$/.test(name)) {
          throw new UserInputError('Invalid package name.')
        }
      }
    }
    Object.defineProperty(this, 'packages', { value, enumerable: true, writable: true, configurable: true })
  }

  @Field(() => Boolean, { nullable: true, description: 'Filter to security updates only' })
    securityOnly?: boolean
}
