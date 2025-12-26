import { ObjectType, Field, ID, Int, InputType, GraphQLTimestamp, registerEnumType } from 'type-graphql'
import { FirewallPolicy } from '@prisma/client'
import GraphQLJSON from 'graphql-type-json'

registerEnumType(FirewallPolicy, {
  name: 'FirewallPolicy',
  description: 'Política de firewall del departamento: ALLOW_ALL (Permitir Todo) o BLOCK_ALL (Bloquear Todo)'
})

@ObjectType()
export class DepartmentType {
  @Field(() => ID)
    id: string = ''

  @Field()
    name: string = ''

  @Field()
    createdAt: Date = new Date()

  @Field(() => Int, { nullable: true })
    internetSpeed?: number

  @Field({ nullable: true })
    ipSubnet?: string

  @Field(() => Number, { nullable: true })
    totalMachines?: number

  @Field({ nullable: true })
    bridgeName?: string

  @Field({ nullable: true })
    gatewayIP?: string

  @Field(() => [String], { nullable: true })
    dnsServers?: string[]

  @Field(() => [String], { nullable: true })
    ntpServers?: string[]

  @Field(() => FirewallPolicy)
    firewallPolicy: FirewallPolicy = 'BLOCK_ALL'

  @Field({ nullable: true })
    firewallDefaultConfig?: string

  @Field(() => GraphQLJSON, { nullable: true })
    firewallCustomRules?: any
}

@InputType()
export class UpdateDepartmentNameInput {
  @Field(() => ID)
    id: string = ''

  @Field(() => String)
    name: string = ''
}

@InputType()
export class UpdateDepartmentNetworkInput {
  @Field(() => ID)
    id: string = ''

  @Field(() => [String], { nullable: true })
    dnsServers?: string[]

  @Field(() => [String], { nullable: true })
    ntpServers?: string[]
}

@InputType()
export class CreateDepartmentFirewallInput {
  @Field(() => FirewallPolicy, { defaultValue: 'BLOCK_ALL' })
    firewallPolicy: FirewallPolicy = 'BLOCK_ALL'

  @Field({ nullable: true, defaultValue: 'allow_outbound' })
    firewallDefaultConfig?: string

  @Field(() => GraphQLJSON, { nullable: true })
    firewallCustomRules?: any
}

@InputType()
export class UpdateDepartmentFirewallPolicyInput {
  @Field(() => FirewallPolicy)
    firewallPolicy: FirewallPolicy = 'BLOCK_ALL'

  @Field()
    firewallDefaultConfig: string = 'allow_outbound'

  @Field(() => GraphQLJSON, { nullable: true })
    firewallCustomRules?: any
}

// ===========================================================================
// Network Diagnostics Types
// ===========================================================================

@ObjectType()
class BridgeDiagnosticsType {
  @Field()
    exists: boolean = false

  @Field()
    isUp: boolean = false

  @Field(() => [String])
    ipAddresses: string[] = []

  @Field(() => [String])
    attachedInterfaces: string[] = []

  @Field(() => Int, { nullable: true })
    mtu?: number

  @Field({ nullable: true })
    state?: string
}

@ObjectType()
class DnsmasqDiagnosticsType {
  @Field()
    isRunning: boolean = false

  @Field(() => Int, { nullable: true })
    pid?: number

  @Field()
    pidMatches: boolean = false

  @Field()
    configPath: string = ''

  @Field()
    configExists: boolean = false

  @Field()
    leasePath: string = ''

  @Field()
    leaseFileExists: boolean = false

  @Field()
    logPath: string = ''

  @Field()
    logExists: boolean = false

  @Field()
    listeningPort: boolean = false

  @Field(() => [String], { nullable: true })
    recentLogLines?: string[]
}

@ObjectType()
class BrNetfilterDiagnosticsType {
  @Field()
    moduleLoaded: boolean = false

  @Field(() => Int)
    callIptables: number = -1

  @Field(() => Int)
    callIp6tables: number = -1

  @Field(() => Int)
    callArptables: number = -1

  @Field()
    persistenceFileExists: boolean = false
}

@ObjectType()
class NatDiagnosticsType {
  @Field()
    ruleExists: boolean = false

  @Field()
    tableExists: boolean = false

  @Field()
    chainExists: boolean = false

  @Field()
    ipForwardingEnabled: boolean = false

  @Field({ nullable: true })
    ruleDetails?: string
}

@ObjectType()
export class DepartmentNetworkDiagnosticsType {
  @Field()
    departmentId: string = ''

  @Field()
    departmentName: string = ''

  @Field(() => GraphQLTimestamp)
    timestamp: Date = new Date()

  @Field(() => BridgeDiagnosticsType)
    bridge: BridgeDiagnosticsType = new BridgeDiagnosticsType()

  @Field(() => DnsmasqDiagnosticsType)
    dnsmasq: DnsmasqDiagnosticsType = new DnsmasqDiagnosticsType()

  @Field(() => BrNetfilterDiagnosticsType)
    brNetfilter: BrNetfilterDiagnosticsType = new BrNetfilterDiagnosticsType()

  @Field(() => NatDiagnosticsType)
    nat: NatDiagnosticsType = new NatDiagnosticsType()

  @Field(() => [String])
    recommendations: string[] = []

  @Field(() => [String])
    manualCommands: string[] = []
}

@ObjectType()
class DhcpPacketSummaryType {
  @Field(() => Int)
    totalPackets: number = 0

  @Field(() => Int)
    discoverPackets: number = 0

  @Field(() => Int)
    offerPackets: number = 0

  @Field(() => Int)
    requestPackets: number = 0

  @Field(() => Int)
    ackPackets: number = 0
}

@ObjectType()
export class DhcpTrafficCaptureType {
  @Field()
    bridgeName: string = ''

  @Field(() => Int)
    duration: number = 0

  @Field(() => [String])
    packets: string[] = []

  @Field(() => DhcpPacketSummaryType)
    summary: DhcpPacketSummaryType = new DhcpPacketSummaryType()
}
