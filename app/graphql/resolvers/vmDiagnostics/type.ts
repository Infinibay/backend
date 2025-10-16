import { ObjectType, Field, Int, Float } from 'type-graphql'

@ObjectType()
export class InfiniServiceStatus {
  @Field()
    installed!: boolean

  @Field()
    running!: boolean

  @Field({ nullable: true })
    error?: string
}

@ObjectType({ description: 'Keep-alive heartbeat metrics for a VM connection' })
export class KeepAliveMetrics {
  @Field(() => Int, { description: 'Total keep-alive requests sent' })
    sentCount!: number

  @Field(() => Int, { description: 'Total keep-alive responses received' })
    receivedCount!: number

  @Field(() => Int, { description: 'Total keep-alive failures (cumulative)' })
    failureCount!: number

  @Field(() => Int, { description: 'Consecutive failures (resets on success)' })
    consecutiveFailures!: number

  @Field(() => Float, { description: 'Average round-trip time in milliseconds' })
    averageRtt!: number

  @Field({ nullable: true, description: 'Timestamp of last keep-alive request sent' })
    lastSent?: string

  @Field({ nullable: true, description: 'Timestamp of last keep-alive response received' })
    lastReceived?: string

  @Field({ nullable: true, description: 'Timestamp of last keep-alive failure' })
    lastFailure?: string

  @Field({ description: 'Keep-alive success rate as percentage (e.g., "95.5%" or "N/A")' })
    successRate!: string
}

@ObjectType()
export class VmConnectionInfo {
  @Field()
    vmId!: string

  @Field()
    isConnected!: boolean

  @Field()
    reconnectAttempts!: number

  @Field()
    lastMessageTime!: string

  @Field(() => KeepAliveMetrics, { nullable: true, description: 'Keep-alive heartbeat metrics' })
    keepAlive?: KeepAliveMetrics
}

@ObjectType()
export class SocketConnectionStats {
  @Field({ nullable: true })
    totalConnections?: number

  @Field({ nullable: true })
    activeConnections?: number

  @Field(() => [VmConnectionInfo], { nullable: true })
    connections?: VmConnectionInfo[]

  @Field({ nullable: true })
    isConnected?: boolean

  @Field({ nullable: true })
    reconnectAttempts?: number

  @Field({ nullable: true })
    lastMessageTime?: string
}

@ObjectType()
export class VmDiagnostics {
  @Field()
    vmId!: string

  @Field()
    vmName!: string

  @Field()
    vmStatus!: string

  @Field()
    timestamp!: string

  @Field(() => [String])
    diagnostics!: string[]

  @Field(() => [String])
    recommendations!: string[]

  @Field(() => InfiniServiceStatus)
    infiniService!: InfiniServiceStatus

  @Field(() => VmConnectionInfo, { nullable: true })
    connectionStats?: VmConnectionInfo

  @Field(() => [String])
    manualCommands!: string[]
}
