import { ObjectType, Field, Int, Float, ID, registerEnumType } from 'type-graphql'

/**
 * Process information type for GraphQL
 */
@ObjectType()
export class ProcessInfo {
  @Field(() => Int)
    pid!: number

  @Field()
    name!: string

  @Field(() => Float)
    cpuUsage!: number

  @Field(() => Int)
    memoryKb!: number

  @Field()
    status!: string

  @Field({ nullable: true })
    commandLine?: string

  @Field({ nullable: true })
    user?: string

  @Field({ nullable: true })
    startTime?: Date
}

/**
 * Result of process control operations
 */
@ObjectType()
export class ProcessControlResult {
  @Field()
    success!: boolean

  @Field()
    message!: string

  @Field(() => Int, { nullable: true })
    pid?: number

  @Field({ nullable: true })
    processName?: string

  @Field({ nullable: true })
    error?: string
}

/**
 * Enum for process sorting options
 */
export enum ProcessSortBy {
  CPU = 'CPU',
  MEMORY = 'MEMORY',
  PID = 'PID',
  NAME = 'NAME'
}

registerEnumType(ProcessSortBy, {
  name: 'ProcessSortBy',
  description: 'Options for sorting processes'
})
