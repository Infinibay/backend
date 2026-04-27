import { ObjectType, Field, ID, InputType, Int, registerEnumType } from 'type-graphql'

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum PoolType {
  PERSISTENT = 'persistent',
  NON_PERSISTENT = 'non-persistent',
}

registerEnumType(PoolType, { name: 'PoolType' })

// ---------------------------------------------------------------------------
// Object type
// ---------------------------------------------------------------------------

@ObjectType()
export class Pool {
  @Field(() => ID)
    id!: string

  @Field()
    name!: string

  @Field(() => ID)
    templateId!: string

  @Field(() => ID, { nullable: true })
    goldenImageId?: string

  @Field(() => ID)
    departmentId!: string

  @Field(() => PoolType)
    type!: PoolType

  @Field(() => Int)
    sizeMin!: number

  @Field(() => Int)
    sizeMax!: number

  @Field(() => Int, { nullable: true })
    idleTimeoutMinutes?: number

  @Field(() => Boolean)
    resetOnLogoff!: boolean

  @Field(() => Boolean)
    draining!: boolean

  @Field(() => Int, { description: 'Number of non-archived machines currently in the pool.' })
    currentSize!: number

  @Field()
    createdAt!: Date

  @Field()
    updatedAt!: Date
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

@InputType()
export class CreatePoolInput {
  @Field()
    name!: string

  @Field(() => ID)
    templateId!: string

  @Field(() => ID, { nullable: true })
    goldenImageId?: string

  @Field(() => ID)
    departmentId!: string

  @Field(() => PoolType, { nullable: true, defaultValue: PoolType.NON_PERSISTENT })
    type?: PoolType

  @Field(() => Int, { nullable: true, defaultValue: 0 })
    sizeMin?: number

  @Field(() => Int, { nullable: true, defaultValue: 10 })
    sizeMax?: number

  @Field(() => Int, { nullable: true })
    idleTimeoutMinutes?: number

  @Field({ nullable: true, defaultValue: true })
    resetOnLogoff?: boolean
}

@InputType()
export class UpdatePoolInput {
  @Field({ nullable: true })
    name?: string

  @Field(() => Int, { nullable: true })
    sizeMin?: number

  @Field(() => Int, { nullable: true })
    sizeMax?: number

  @Field(() => Int, { nullable: true })
    idleTimeoutMinutes?: number

  @Field({ nullable: true })
    resetOnLogoff?: boolean

  @Field({ nullable: true })
    draining?: boolean
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

@ObjectType()
export class PoolResult {
  @Field()
    success!: boolean

  @Field(() => Pool, { nullable: true })
    pool?: Pool

  @Field({ nullable: true })
    error?: string
}
