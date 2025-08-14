import { ObjectType, Field } from 'type-graphql'

@ObjectType()
export class InfiniServiceStatus {
  @Field()
  installed!: boolean

  @Field()
  running!: boolean

  @Field({ nullable: true })
  error?: string
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

  @Field(() => SocketConnectionStats, { nullable: true })
  connectionStats?: SocketConnectionStats

  @Field(() => [String])
  manualCommands!: string[]
}