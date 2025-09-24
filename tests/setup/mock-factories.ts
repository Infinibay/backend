import {
  User,
  Machine,
  Department,
  MachineTemplate,
  Application,
  MachineTemplateCategory,
  NWFilter,
  FWRule,
  FilterReference,
  Node,
  Disk,
  MachineConfiguration,
  PendingCommand,
  DepartmentConfiguration,
  SystemMetrics,
  ProcessSnapshot,
  ApplicationUsage,
  PortUsage,
  WindowsService,
  ServiceStateHistory
} from '@prisma/client'
import { randomBytes } from 'crypto'
import bcrypt from 'bcrypt'
import { OsEnum, MachineApplicationInputType } from '@resolvers/machine/type'

// Input type definitions for mock factories
interface UserInputOverrides {
  email?: string
  password?: string
  passwordConfirmation?: string
  firstName?: string
  lastName?: string
  role?: string
  [key: string]: unknown
}

interface MachineInputOverrides {
  name?: string
  templateId?: string
  departmentId?: string
  os?: OsEnum
  username?: string
  password?: string
  pciBus?: string | null
  applications?: MachineApplicationInputType[]
  [key: string]: unknown
}

interface DepartmentInputOverrides {
  name?: string
  internetSpeed?: number
  ipSubnet?: string
  [key: string]: unknown
}

interface ApplicationInputOverrides {
  name?: string
  description?: string
  version?: string
  os?: string[]
  installCommand?: { command: string }
  [key: string]: unknown
}

interface FirewallRuleInputOverrides {
  action?: string
  direction?: string
  priority?: number
  protocol?: string
  dstPortStart?: number
  dstPortEnd?: number
  srcIpAddress?: string
  dstIpAddress?: string
  [key: string]: unknown
}

// Generate random IDs
export const generateId = () => randomBytes(16).toString('hex')

// User factory
export function createMockUser (overrides?: Partial<User>): User {
  const id = overrides?.id || generateId()
  return {
    id,
    email: overrides?.email || `user-${id}@example.com`,
    password: overrides?.password || bcrypt.hashSync('password123', 10),
    deleted: overrides?.deleted ?? false,
    token: overrides?.token || `token-${id}`,
    firstName: overrides?.firstName || 'Test',
    lastName: overrides?.lastName || 'User',
    userImage: overrides?.userImage || null,
    role: overrides?.role || 'USER',
    createdAt: overrides?.createdAt || new Date()
  }
}

export function createMockAdminUser (overrides?: Partial<User>): User {
  return createMockUser({
    role: 'ADMIN',
    firstName: 'Admin',
    lastName: 'User',
    ...overrides
  })
}

// Department factory
export function createMockDepartment (overrides?: Partial<Department>): Department {
  const id = overrides?.id || generateId()
  return {
    id,
    name: overrides?.name || `Department-${id}`,
    createdAt: overrides?.createdAt || new Date(),
    internetSpeed: overrides?.internetSpeed || 100,
    ipSubnet: overrides?.ipSubnet || '192.168.1.0/24'
  }
}

// Machine Template Category factory
export function createMockMachineTemplateCategory (
  overrides?: Partial<MachineTemplateCategory>
): MachineTemplateCategory {
  const id = overrides?.id || generateId()
  return {
    id,
    name: overrides?.name || `Category-${id}`,
    description: overrides?.description || `Description for category ${id}`,
    createdAt: overrides?.createdAt || new Date()
  }
}

// Machine Template factory
export function createMockMachineTemplate (
  overrides?: Partial<MachineTemplate>
): MachineTemplate {
  const id = overrides?.id || generateId()
  return {
    id,
    name: overrides?.name || `Template-${id}`,
    description: overrides?.description || `Template description ${id}`,
    cores: overrides?.cores || 4,
    ram: overrides?.ram || 8,
    storage: overrides?.storage || 100,
    createdAt: overrides?.createdAt || new Date(),
    categoryId: overrides?.categoryId || null
  }
}

// Machine factory
export function createMockMachine (overrides?: Partial<Machine>): Machine {
  const id = overrides?.id || generateId()
  return {
    id,
    name: overrides?.name || `Machine-${id}`,
    internalName: overrides?.internalName || `vm-${id}`,
    status: overrides?.status || 'stopped',
    userId: overrides?.userId || null,
    templateId: overrides?.templateId || generateId(),
    os: overrides?.os || 'ubuntu-22.04',
    cpuCores: overrides?.cpuCores || 4,
    ramGB: overrides?.ramGB || 8,
    diskSizeGB: overrides?.diskSizeGB || 100,
    gpuPciAddress: overrides?.gpuPciAddress || null,
    firewallTemplates: overrides?.firewallTemplates || null,
    createdAt: overrides?.createdAt || new Date(),
    updatedAt: overrides?.updatedAt || new Date(),
    departmentId: overrides?.departmentId || null,
    localIP: overrides?.localIP || null,
    publicIP: overrides?.publicIP || null
  }
}

// Machine Configuration factory
export function createMockMachineConfiguration (
  overrides?: Partial<MachineConfiguration>
): MachineConfiguration {
  const id = overrides?.id || generateId()
  return {
    id,
    xml: overrides?.xml || { domain: { name: 'test-vm' } },
    graphicProtocol: overrides?.graphicProtocol || 'vnc',
    graphicPort: overrides?.graphicPort || 5900,
    graphicPassword: overrides?.graphicPassword || 'password123',
    graphicHost: overrides?.graphicHost || '192.168.1.100',
    assignedGpuBus: overrides?.assignedGpuBus || null,
    machineId: overrides?.machineId || generateId()
  }
}

// Application factory
export function createMockApplication (overrides?: Partial<Application>): Application {
  const id = overrides?.id || generateId()
  return {
    id,
    name: overrides?.name || `Application-${id}`,
    description: overrides?.description || `App description ${id}`,
    version: overrides?.version || '1.0.0',
    url: overrides?.url || `https://app-${id}.example.com`,
    icon: overrides?.icon || null,
    os: overrides?.os || ['windows', 'linux'],
    installCommand: overrides?.installCommand || { command: 'install.sh' },
    parameters: overrides?.parameters || {},
    createdAt: overrides?.createdAt || new Date()
  }
}

// Network Filter factory
export function createMockNWFilter (overrides?: Partial<NWFilter>): NWFilter {
  const id = overrides?.id || generateId()
  return {
    id,
    name: overrides?.name || `filter-${id}`,
    internalName: overrides?.internalName || `nwfilter-${id}`,
    uuid: overrides?.uuid || generateId(),
    description: overrides?.description || `Filter description ${id}`,
    chain: overrides?.chain || 'ipv4',
    type: overrides?.type || 'generic',
    priority: overrides?.priority || 500,
    stateMatch: overrides?.stateMatch ?? true,
    createdAt: overrides?.createdAt || new Date(),
    updatedAt: overrides?.updatedAt || new Date(),
    flushedAt: overrides?.flushedAt || null
  }
}

// Firewall Rule factory
export function createMockFWRule (overrides?: Partial<FWRule>): FWRule {
  const id = overrides?.id || generateId()
  return {
    id,
    nwFilterId: overrides?.nwFilterId || generateId(),
    action: overrides?.action || 'accept',
    direction: overrides?.direction || 'inout',
    priority: overrides?.priority || 500,
    protocol: overrides?.protocol || 'tcp',
    ipVersion: overrides?.ipVersion || 'ipv4',
    srcMacAddr: overrides?.srcMacAddr || null,
    srcIpAddr: overrides?.srcIpAddr || null,
    srcIpMask: overrides?.srcIpMask || null,
    dstIpAddr: overrides?.dstIpAddr || null,
    dstIpMask: overrides?.dstIpMask || null,
    srcPortStart: overrides?.srcPortStart || null,
    srcPortEnd: overrides?.srcPortEnd || null,
    dstPortStart: overrides?.dstPortStart || null,
    dstPortEnd: overrides?.dstPortEnd || null,
    state: overrides?.state || null,
    comment: overrides?.comment || null,
    createdAt: overrides?.createdAt || new Date(),
    updatedAt: overrides?.updatedAt || new Date()
  }
}

// Filter Reference factory
export function createMockFilterReference (overrides?: Partial<FilterReference>): FilterReference {
  const id = overrides?.id || generateId()
  return {
    id,
    sourceFilterId: overrides?.sourceFilterId || generateId(),
    targetFilterId: overrides?.targetFilterId || generateId(),
    createdAt: overrides?.createdAt || new Date()
  }
}

// Node factory
export function createMockNode (overrides?: Partial<Node>): Node {
  const id = overrides?.id || generateId()
  return {
    id,
    name: overrides?.name || `Node-${id}`,
    currentRaid: overrides?.currentRaid || 'RAID1',
    nextRaid: overrides?.nextRaid || null,
    cpuFlags: overrides?.cpuFlags || { vmx: true, svm: false },
    ram: overrides?.ram || 32768,
    cores: overrides?.cores || 16
  }
}

// Disk factory
export function createMockDisk (overrides?: Partial<Disk>): Disk {
  const id = overrides?.id || generateId()
  return {
    id,
    path: overrides?.path || `/dev/sda${id}`,
    nodeId: overrides?.nodeId || generateId(),
    status: overrides?.status || 'healthy'
  }
}

// Pending Command factory
export function createMockPendingCommand (overrides?: Partial<PendingCommand>): PendingCommand {
  const id = overrides?.id || generateId()
  return {
    id,
    machineId: overrides?.machineId || generateId(),
    command: overrides?.command || 'UPDATE_SOFTWARE',
    parameters: overrides?.parameters || {},
    createdAt: overrides?.createdAt || new Date()
  }
}

// Department Configuration factory
export function createMockDepartmentConfiguration (
  overrides?: Partial<DepartmentConfiguration>
): DepartmentConfiguration {
  const id = overrides?.id || generateId()
  return {
    id,
    departmentId: overrides?.departmentId || generateId(),
    cleanTraffic: overrides?.cleanTraffic ?? false,
    createdAt: overrides?.createdAt || new Date(),
    updatedAt: overrides?.updatedAt || new Date()
  }
}

// System Metrics factory (InfiniService)
export function createMockSystemMetrics (overrides?: Partial<SystemMetrics>): SystemMetrics {
  const id = overrides?.id || generateId()
  return {
    id,
    machineId: overrides?.machineId || generateId(),
    cpuUsagePercent: overrides?.cpuUsagePercent || 25.5,
    cpuCoresUsage: overrides?.cpuCoresUsage || [25.0, 30.0, 20.0, 35.0],
    cpuTemperature: overrides?.cpuTemperature || 65.0,
    totalMemoryKB: overrides?.totalMemoryKB || BigInt(8192000),
    usedMemoryKB: overrides?.usedMemoryKB || BigInt(4096000),
    availableMemoryKB: overrides?.availableMemoryKB || BigInt(4096000),
    swapTotalKB: overrides?.swapTotalKB || BigInt(2048000),
    swapUsedKB: overrides?.swapUsedKB || BigInt(512000),
    diskUsageStats: overrides?.diskUsageStats || { '/': { total: 100000, used: 50000, free: 50000 } },
    diskIOStats: overrides?.diskIOStats || { read: 1000000, write: 500000 },
    networkStats: overrides?.networkStats || { rx: 1000000, tx: 500000 },
    uptime: overrides?.uptime || BigInt(86400),
    loadAverage: overrides?.loadAverage || [1.5, 1.2, 0.9],
    timestamp: overrides?.timestamp || new Date()
  }
}

// Process Snapshot factory
export function createMockProcessSnapshot (overrides?: Partial<ProcessSnapshot>): ProcessSnapshot {
  const id = overrides?.id || generateId()
  return {
    id,
    machineId: overrides?.machineId || generateId(),
    processId: overrides?.processId || 1234,
    parentPid: overrides?.parentPid || 1,
    name: overrides?.name || 'test-process.exe',
    executablePath: overrides?.executablePath || '/usr/bin/test-process',
    commandLine: overrides?.commandLine || 'test-process --daemon',
    cpuUsagePercent: overrides?.cpuUsagePercent || 10.5,
    memoryUsageKB: overrides?.memoryUsageKB || BigInt(1024000),
    diskReadBytes: overrides?.diskReadBytes || BigInt(500000),
    diskWriteBytes: overrides?.diskWriteBytes || BigInt(250000),
    status: overrides?.status || 'running',
    startTime: overrides?.startTime || new Date(Date.now() - 3600000),
    timestamp: overrides?.timestamp || new Date()
  }
}

// Application Usage factory
export function createMockApplicationUsage (
  overrides?: Partial<ApplicationUsage>
): ApplicationUsage {
  const id = overrides?.id || generateId()
  return {
    id,
    machineId: overrides?.machineId || generateId(),
    executablePath: overrides?.executablePath || 'C:\\Program Files\\TestApp\\test.exe',
    applicationName: overrides?.applicationName || 'TestApp',
    version: overrides?.version || '1.0.0',
    description: overrides?.description || 'Test application',
    publisher: overrides?.publisher || 'Test Publisher',
    lastAccessTime: overrides?.lastAccessTime || new Date(),
    lastModifiedTime: overrides?.lastModifiedTime || new Date(Date.now() - 86400000),
    accessCount: overrides?.accessCount || 10,
    totalUsageMinutes: overrides?.totalUsageMinutes || 120,
    iconData: overrides?.iconData || null,
    iconFormat: overrides?.iconFormat || null,
    fileSize: overrides?.fileSize || BigInt(10485760),
    firstSeen: overrides?.firstSeen || new Date(Date.now() - 604800000),
    lastSeen: overrides?.lastSeen || new Date(),
    isActive: overrides?.isActive || true
  }
}

// Port Usage factory
export function createMockPortUsage (overrides?: Partial<PortUsage>): PortUsage {
  const id = overrides?.id || generateId()
  return {
    id,
    machineId: overrides?.machineId || generateId(),
    port: overrides?.port || 8080,
    protocol: overrides?.protocol || 'TCP',
    state: overrides?.state || 'LISTENING',
    processId: overrides?.processId || 1234,
    processName: overrides?.processName || 'node.exe',
    executablePath: overrides?.executablePath || '/usr/bin/node',
    isListening: overrides?.isListening !== undefined ? overrides.isListening : true,
    connectionCount: overrides?.connectionCount || 5,
    lastActivity: overrides?.lastActivity || new Date(),
    timestamp: overrides?.timestamp || new Date()
  }
}

// Windows Service factory
export function createMockWindowsService (overrides?: Partial<WindowsService>): WindowsService {
  const id = overrides?.id || generateId()
  return {
    id,
    machineId: overrides?.machineId || generateId(),
    serviceName: overrides?.serviceName || 'TestService',
    displayName: overrides?.displayName || 'Test Service Display',
    description: overrides?.description || 'Test service for testing purposes',
    startType: overrides?.startType || 'Automatic',
    serviceType: overrides?.serviceType || 'Win32OwnProcess',
    executablePath: overrides?.executablePath || 'C:\\Windows\\System32\\svchost.exe',
    dependencies: overrides?.dependencies || null,
    currentState: overrides?.currentState || 'Running',
    processId: overrides?.processId || 1234,
    lastStateChange: overrides?.lastStateChange || new Date(),
    stateChangeCount: overrides?.stateChangeCount || 0,
    isDefaultService: overrides?.isDefaultService !== undefined ? overrides.isDefaultService : false,
    usageScore: overrides?.usageScore || 0.5,
    firstSeen: overrides?.firstSeen || new Date(),
    lastSeen: overrides?.lastSeen || new Date()
  }
}

// Service State History factory
export function createMockServiceStateHistory (overrides?: Partial<ServiceStateHistory>): ServiceStateHistory {
  const id = overrides?.id || generateId()
  return {
    id,
    serviceId: overrides?.serviceId || generateId(),
    fromState: overrides?.fromState || 'Stopped',
    toState: overrides?.toState || 'Running',
    reason: overrides?.reason || 'Manual start',
    timestamp: overrides?.timestamp || new Date()
  }
}

// Helper functions for creating related data
export function createMockMachineWithRelations () {
  const user = createMockUser()
  const department = createMockDepartment()
  const template = createMockMachineTemplate()
  const machine = createMockMachine({
    userId: user.id,
    departmentId: department.id,
    templateId: template.id
  })
  const configuration = createMockMachineConfiguration({
    machineId: machine.id
  })

  return {
    user,
    department,
    template,
    machine,
    configuration
  }
}

export function createMockDepartmentWithMachines (machineCount: number = 3) {
  const department = createMockDepartment()
  const template = createMockMachineTemplate()
  const machines = Array.from({ length: machineCount }, () =>
    createMockMachine({
      departmentId: department.id,
      templateId: template.id
    })
  )
  const configuration = createMockDepartmentConfiguration({
    departmentId: department.id
  })

  return {
    department,
    template,
    machines,
    configuration
  }
}

export function createMockNetworkFilterWithRules (ruleCount: number = 5) {
  const filter = createMockNWFilter()
  const rules = Array.from({ length: ruleCount }, (_, index) =>
    createMockFWRule({
      nwFilterId: filter.id,
      priority: (index + 1) * 100
    })
  )

  return {
    filter,
    rules
  }
}

// Batch creation helpers
export function createMockUsers (count: number = 5): User[] {
  return Array.from({ length: count }, () => createMockUser())
}

export function createMockMachines (count: number = 5): Machine[] {
  const template = createMockMachineTemplate()
  return Array.from({ length: count }, () =>
    createMockMachine({ templateId: template.id })
  )
}

export function createMockDepartments (count: number = 3): Department[] {
  return Array.from({ length: count }, () => createMockDepartment())
}

export function createMockApplications (count: number = 5): Application[] {
  return Array.from({ length: count }, () => createMockApplication())
}

// GraphQL input type factories
export function createMockUserInput (overrides?: UserInputOverrides) {
  const password = overrides?.password || 'SecurePass123!'
  return {
    email: overrides?.email || `test-${Date.now()}@example.com`,
    password,
    passwordConfirmation: overrides?.passwordConfirmation || password,
    firstName: overrides?.firstName || 'Test',
    lastName: overrides?.lastName || 'User',
    role: overrides?.role || 'USER',
    ...overrides
  }
}

export function createMockMachineInput (overrides?: MachineInputOverrides) {
  return {
    name: overrides?.name || `Test Machine ${Date.now()}`,
    templateId: overrides?.templateId || generateId(),
    departmentId: overrides?.departmentId || generateId(),
    os: overrides?.os || OsEnum.WINDOWS10,
    username: overrides?.username || 'testuser',
    password: overrides?.password || 'testpassword123',
    pciBus: overrides?.pciBus || null,
    applications: overrides?.applications || [],
    ...overrides
  }
}

export function createMockDepartmentInput (overrides?: DepartmentInputOverrides) {
  return {
    name: overrides?.name || `Test Department ${Date.now()}`,
    internetSpeed: overrides?.internetSpeed || 100,
    ipSubnet: overrides?.ipSubnet || '192.168.1.0/24',
    ...overrides
  }
}

export function createMockApplicationInput (overrides?: ApplicationInputOverrides) {
  return {
    name: overrides?.name || `Test App ${Date.now()}`,
    description: overrides?.description || 'Test application',
    version: overrides?.version || '1.0.0',
    os: overrides?.os || ['windows', 'linux'],
    installCommand: overrides?.installCommand || { command: 'install.sh' },
    ...overrides
  }
}

export function createMockFirewallRuleInput (overrides?: FirewallRuleInputOverrides) {
  return {
    action: overrides?.action || 'accept',
    direction: overrides?.direction || 'in',
    priority: overrides?.priority || 500,
    protocol: overrides?.protocol || 'tcp',
    dstPortStart: overrides?.dstPortStart || 80,
    dstPortEnd: overrides?.dstPortEnd || 80,
    comment: overrides?.comment || 'Test rule',
    ...overrides
  }
}

// Pagination helpers
export function createMockPaginatedResponse<T> (
  items: T[],
  total?: number,
  page: number = 1,
  pageSize: number = 10
) {
  const actualTotal = total ?? items.length
  const start = (page - 1) * pageSize
  const paginatedItems = items.slice(start, start + pageSize)

  return {
    items: paginatedItems,
    total: actualTotal,
    page,
    pageSize,
    totalPages: Math.ceil(actualTotal / pageSize),
    hasNext: start + pageSize < actualTotal,
    hasPrevious: page > 1
  }
}

// Network mock
export function createMockNetwork (overrides?: Partial<{ name: string; active: boolean }>) {
  return {
    name: overrides?.name || 'test-network',
    active: overrides?.active !== undefined ? overrides.active : true,
    bridgeName: 'br0',
    ipAddress: '192.168.1.1',
    ipRange: '192.168.1.100-192.168.1.200',
    uuid: generateId()
  }
}

export function createNetworkInput () {
  return {
    name: `test-network-${Date.now()}`,
    ipRange: '192.168.1.0/24',
    bridgeName: 'br0'
  }
}

// Mock libvirt XML generators
export function createMockDomainXML (name: string = 'test-vm') {
  return `<?xml version="1.0"?>
<domain type="kvm">
  <name>${name}</name>
  <uuid>${generateId()}</uuid>
  <memory unit="KiB">8388608</memory>
  <currentMemory unit="KiB">8388608</currentMemory>
  <vcpu placement="static">4</vcpu>
  <os>
    <type arch="x86_64" machine="pc-q35-6.2">hvm</type>
    <boot dev="hd"/>
  </os>
  <devices>
    <disk type="file" device="disk">
      <driver name="qemu" type="qcow2"/>
      <source file="/var/lib/libvirt/images/${name}.qcow2"/>
      <target dev="vda" bus="virtio"/>
    </disk>
    <interface type="network">
      <mac address="52:54:00:${Math.random().toString(16).substr(2, 2)}:${Math.random().toString(16).substr(2, 2)}:${Math.random().toString(16).substr(2, 2)}"/>
      <source network="default"/>
      <model type="virtio"/>
    </interface>
    <graphics type="vnc" port="5900" autoport="yes" listen="0.0.0.0">
      <listen type="address" address="0.0.0.0"/>
    </graphics>
  </devices>
</domain>`
}

export function createMockNetworkXML (name: string = 'test-network') {
  return `<?xml version="1.0"?>
<network>
  <name>${name}</name>
  <uuid>${generateId()}</uuid>
  <forward mode="nat"/>
  <bridge name="virbr1" stp="on" delay="0"/>
  <ip address="192.168.100.1" netmask="255.255.255.0">
    <dhcp>
      <range start="192.168.100.2" end="192.168.100.254"/>
    </dhcp>
  </ip>
</network>`
}

export function createMockStoragePoolXML (name: string = 'test-pool') {
  return `<?xml version="1.0"?>
<pool type="dir">
  <name>${name}</name>
  <uuid>${generateId()}</uuid>
  <capacity unit="bytes">1099511627776</capacity>
  <allocation unit="bytes">0</allocation>
  <available unit="bytes">1099511627776</available>
  <source/>
  <target>
    <path>/var/lib/libvirt/images</path>
  </target>
</pool>`
}

export function createMockNWFilterXML (name: string = 'test-filter') {
  return `<?xml version="1.0"?>
<filter name="${name}" chain="ipv4" priority="500">
  <uuid>${generateId()}</uuid>
  <rule action="accept" direction="out" priority="100">
    <ip protocol="tcp" dstportstart="80" dstportend="80"/>
  </rule>
  <rule action="accept" direction="in" priority="200">
    <ip protocol="tcp" srcportstart="80" srcportend="80"/>
  </rule>
</filter>`
}
