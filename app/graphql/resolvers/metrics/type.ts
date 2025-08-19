import { ObjectType, Field, Int, Float, ID, InputType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'

@ObjectType()
export class SystemMetrics {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    machineId!: string

  @Field(() => Float)
    cpuUsagePercent!: number

  @Field(() => [Float])
    cpuCoresUsage!: number[]

  @Field(() => Float, { nullable: true })
    cpuTemperature?: number

  @Field(() => Float)
    totalMemoryKB!: number

  @Field(() => Float)
    usedMemoryKB!: number

  @Field(() => Float)
    availableMemoryKB!: number

  @Field(() => Float, { nullable: true })
    swapTotalKB?: number

  @Field(() => Float, { nullable: true })
    swapUsedKB?: number

  @Field(() => GraphQLJSONObject)
    diskUsageStats!: any

  @Field(() => GraphQLJSONObject)
    diskIOStats!: any

  @Field(() => GraphQLJSONObject)
    networkStats!: any

  @Field(() => Float)
    uptime!: number

  @Field(() => GraphQLJSONObject, { nullable: true })
    loadAverage?: any

  @Field(() => Date)
    timestamp!: Date
}

@ObjectType()
export class ProcessSnapshot {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    machineId!: string

  @Field(() => Int)
    processId!: number

  @Field(() => Int, { nullable: true })
    parentPid?: number

  @Field(() => String)
    name!: string

  @Field(() => String, { nullable: true })
    executablePath?: string

  @Field(() => String, { nullable: true })
    commandLine?: string

  @Field(() => Float)
    cpuUsagePercent!: number

  @Field(() => Float)
    memoryUsageKB!: number

  @Field(() => Float, { nullable: true })
    diskReadBytes?: number

  @Field(() => Float, { nullable: true })
    diskWriteBytes?: number

  @Field(() => String)
    status!: string

  @Field(() => Date, { nullable: true })
    startTime?: Date

  @Field(() => Date)
    timestamp!: Date
}

@ObjectType()
export class ApplicationUsage {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    machineId!: string

  @Field(() => String)
    executablePath!: string

  @Field(() => String)
    applicationName!: string

  @Field(() => String, { nullable: true })
    version?: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => String, { nullable: true })
    publisher?: string

  @Field(() => Date, { nullable: true })
    lastAccessTime?: Date

  @Field(() => Date, { nullable: true })
    lastModifiedTime?: Date

  @Field(() => Int)
    accessCount!: number

  @Field(() => Int)
    totalUsageMinutes!: number

  @Field(() => String, { nullable: true })
    iconFormat?: string

  @Field(() => Float, { nullable: true })
    fileSize?: number

  @Field(() => Date)
    firstSeen!: Date

  @Field(() => Date)
    lastSeen!: Date

  @Field(() => Boolean)
    isActive!: boolean
}

@ObjectType()
export class PortUsage {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    machineId!: string

  @Field(() => Int)
    port!: number

  @Field(() => String)
    protocol!: string

  @Field(() => String)
    state!: string

  @Field(() => Int, { nullable: true })
    processId?: number

  @Field(() => String, { nullable: true })
    processName?: string

  @Field(() => String, { nullable: true })
    executablePath?: string

  @Field(() => Boolean)
    isListening!: boolean

  @Field(() => Int)
    connectionCount!: number

  @Field(() => Date)
    lastActivity!: Date

  @Field(() => Date)
    timestamp!: Date
}

@ObjectType()
export class WindowsService {
  @Field(() => ID)
    id!: string

  @Field(() => String)
    machineId!: string

  @Field(() => String)
    serviceName!: string

  @Field(() => String)
    displayName!: string

  @Field(() => String, { nullable: true })
    description?: string

  @Field(() => String)
    startType!: string

  @Field(() => String)
    serviceType!: string

  @Field(() => String, { nullable: true })
    executablePath?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    dependencies?: any

  @Field(() => String)
    currentState!: string

  @Field(() => Int, { nullable: true })
    processId?: number

  @Field(() => Date, { nullable: true })
    lastStateChange?: Date

  @Field(() => Int)
    stateChangeCount!: number

  @Field(() => Boolean)
    isDefaultService!: boolean

  @Field(() => Float, { nullable: true })
    usageScore?: number

  @Field(() => Date)
    firstSeen!: Date

  @Field(() => Date)
    lastSeen!: Date
}

@InputType()
export class MetricsFilterInput {
  @Field(() => String, { nullable: true })
    machineId?: string

  @Field(() => Date, { nullable: true })
    startDate?: Date

  @Field(() => Date, { nullable: true })
    endDate?: Date

  @Field(() => Int, { nullable: true, defaultValue: 100 })
    limit?: number

  @Field(() => Int, { nullable: true, defaultValue: 0 })
    offset?: number
}

@InputType()
export class ProcessFilterInput {
  @Field(() => String, { nullable: true })
    machineId?: string

  @Field(() => String, { nullable: true })
    name?: string

  @Field(() => Date, { nullable: true })
    startDate?: Date

  @Field(() => Date, { nullable: true })
    endDate?: Date

  @Field(() => Int, { nullable: true, defaultValue: 20 })
    limit?: number
}

@ObjectType()
export class MachineMetricsSummary {
  @Field(() => String)
    machineId!: string

  @Field(() => SystemMetrics, { nullable: true })
    latestSystemMetrics?: SystemMetrics

  @Field(() => Int)
    totalDataPoints!: number

  @Field(() => Date, { nullable: true })
    firstDataPoint?: Date

  @Field(() => Date, { nullable: true })
    lastDataPoint?: Date

  @Field(() => Int)
    activeProcessCount!: number

  @Field(() => Int)
    openPortsCount!: number

  @Field(() => Int)
    installedApplicationsCount!: number
}
