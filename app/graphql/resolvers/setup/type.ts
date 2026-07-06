import { ObjectType, Field } from 'type-graphql'

@ObjectType()
export class DyummyType {
  @Field(() => String)
    value: string = ''
}

/** One first-run onboarding step and whether it is satisfied. */
@ObjectType()
export class SetupStepType {
  @Field(() => String)
    key: string = ''

  @Field(() => String)
    label: string = ''

  @Field(() => Boolean)
    done: boolean = false
}

/** First-run setup status driving the /setup redirect gate and wizard. */
@ObjectType()
export class SetupStatusType {
  /** True once completeSetup has run — /setup is then closed forever. */
  @Field(() => Boolean)
    completed: boolean = false

  /** pending | in_progress | completed */
  @Field(() => String)
    phase: string = 'pending'

  /** Admin was seeded with the insecure dev default → force a password change. */
  @Field(() => Boolean)
    devModeAdmin: boolean = false

  @Field(() => [SetupStepType])
    steps: SetupStepType[] = []
}
