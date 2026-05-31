import { Field, ID, Int, ObjectType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'

@ObjectType()
export class DiskType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    path!: string

  @Field(() => String)
    nodeId!: string

  @Field(() => String)
    status!: string

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date
}

@ObjectType()
export class NodeType {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    name!: string

  @Field(() => String)
    currentRaid!: string

  @Field(() => String, { nullable: true })
    nextRaid?: string | null

  @Field(() => GraphQLJSONObject)
    cpuFlags!: unknown

  @Field(() => Int)
    ram!: number

  @Field(() => Int)
    cores!: number

  @Field(() => Boolean)
    maintenanceMode!: boolean

  @Field(() => String)
    health!: string

  @Field(() => Int)
    diskCount!: number

  @Field(() => Int)
    healthyDiskCount!: number

  @Field(() => Int)
    availableCores!: number

  @Field(() => Int)
    availableRamGB!: number

  @Field(() => Int)
    machineCount!: number

  @Field(() => Int)
    runningMachineCount!: number

  @Field(() => Date)
    createdAt!: Date

  @Field(() => Date)
    updatedAt!: Date

  @Field(() => [DiskType])
    disks!: DiskType[]
}

@ObjectType()
export class NodeInventorySummary {
  @Field(() => Int)
    totalNodes!: number

  @Field(() => Int)
    onlineNodes!: number

  @Field(() => Int)
    staleNodes!: number

  @Field(() => Int)
    totalCores!: number

  @Field(() => Int)
    totalRam!: number

  @Field(() => Int)
    totalDisks!: number
}
