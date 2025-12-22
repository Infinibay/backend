/**
 * DepartmentNetworkService - Manages network infrastructure for departments.
 *
 * This service creates isolated networks for each department:
 * - Linux bridge for Layer 2 connectivity
 * - dnsmasq for DHCP within the subnet
 * - NAT (masquerade) for internet access
 *
 * @example
 * ```typescript
 * const networkService = new DepartmentNetworkService(prisma)
 * await networkService.configureNetwork(departmentId, '10.10.100.0/24')
 * ```
 */

import { PrismaClient, Department } from '@prisma/client'
import { BridgeManager, DepartmentNatService, TapDeviceManager } from '@infinibay/infinization'
import { execSync, spawn } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { Debugger } from '../../utils/debug'

// ===========================================================================
// Network Cleanup Types
// ===========================================================================

/**
 * Result of verifying network cleanup completeness
 */
export interface NetworkCleanupVerification {
  bridgeRemoved: boolean
  dnsmasqStopped: boolean
  natRemoved: boolean
  filesRemoved: boolean
  allClean: boolean
  details: {
    bridgeName: string
    remainingInterfaces?: string[]
    runningDnsmasqPid?: number
    remainingFiles?: string[]
  }
}

/**
 * Result of force destroy operation
 */
export interface ForceDestroyResult {
  success: boolean
  operations: {
    tapDevicesCleanup: { attempted: boolean; success: boolean; error?: string }
    dnsmasqStop: { attempted: boolean; success: boolean; error?: string }
    natRemoval: { attempted: boolean; success: boolean; error?: string }
    bridgeDestruction: { attempted: boolean; success: boolean; error?: string }
    fileCleanup: { attempted: boolean; success: boolean; error?: string }
    databaseUpdate: { attempted: boolean; success: boolean; error?: string }
    systemFilesCleanup: { attempted: boolean; success: boolean; error?: string }
  }
}

const debug = new Debugger('dept-network')

/** Configuration directories */
const DNSMASQ_CONFIG_DIR = '/etc/infinibay/dnsmasq.d'
const DNSMASQ_RUN_DIR = '/opt/infinibay/run/dnsmasq'
const DNSMASQ_LOG_DIR = '/var/log/infinibay'
const SYSCTL_CONFIG_DIR = '/etc/sysctl.d'
const SYSCTL_CONFIG_FILE = '/etc/sysctl.d/99-infinibay-bridge.conf'
const MODULES_LOAD_DIR = '/etc/modules-load.d'
const MODULES_LOAD_FILE = '/etc/modules-load.d/infinibay-bridge.conf'

/** Bridge name prefix (max 15 chars total for Linux) */
const BRIDGE_PREFIX = 'infinibr-'

/** Reserved subnets that cannot be used */
const RESERVED_SUBNETS = [
  '127.0.0.0/8',      // Loopback
  '169.254.0.0/16',   // Link-local
  '224.0.0.0/4',      // Multicast
  '240.0.0.0/4',      // Reserved
  '0.0.0.0/8'         // Invalid
]

export interface SubnetConfig {
  subnet: string          // "10.10.100.0/24"
  networkAddress: string  // "10.10.100.0"
  gatewayIP: string       // "10.10.100.1"
  dhcpStart: string       // "10.10.100.10"
  dhcpEnd: string         // "10.10.100.254"
  netmask: string         // "24"
  bridgeName: string      // "infinibr-abc123"
  dnsServers?: string[]   // DNS servers for DHCP clients (defaults to Google/Cloudflare)
  ntpServers?: string[]   // NTP servers (IP addresses only) for DHCP option 42 (hostnames will be filtered out)
  mtu?: number            // MTU for network interfaces (default: 1500)
}

// ===========================================================================
// Diagnostic Types
// ===========================================================================

interface BridgeDiagnostics {
  exists: boolean
  isUp: boolean
  ipAddresses: string[]
  attachedInterfaces: string[]
  mtu?: number
  state?: string
}

interface DnsmasqDiagnostics {
  isRunning: boolean
  pid?: number
  pidMatches: boolean
  configPath: string
  configExists: boolean
  leasePath: string
  leaseFileExists: boolean
  logPath: string
  logExists: boolean
  listeningPort: boolean
  recentLogLines?: string[]
}

interface BrNetfilterDiagnostics {
  moduleLoaded: boolean
  callIptables: number
  callIp6tables: number
  callArptables: number
  persistenceFileExists: boolean
}

interface NatDiagnostics {
  ruleExists: boolean
  tableExists: boolean
  chainExists: boolean
  ipForwardingEnabled: boolean
  ruleDetails?: string
}

interface QemuProcessInfo {
  pid: number
  command: string
}

interface TapDeviceInfo {
  name: string
  hasCarrier: boolean
  isOrphaned: boolean
  state: string
  connectedToQemu: boolean
  qemuProcess?: QemuProcessInfo
  attachedToBridge: boolean
}

interface TapDevicesDiagnostics {
  totalDevices: number
  devicesWithCarrier: number
  orphanedDevices: number
  devicesWithoutCarrier: number
  devicesWithoutQemuProcess: number
  unbridgedOrphanedDevices: number
  devices: TapDeviceInfo[]
}

export interface DepartmentNetworkDiagnostics {
  departmentId: string
  departmentName: string
  timestamp: Date
  bridge: BridgeDiagnostics
  dnsmasq: DnsmasqDiagnostics
  brNetfilter: BrNetfilterDiagnostics
  nat: NatDiagnostics
  tapDevices: TapDevicesDiagnostics
  recommendations: string[]
  manualCommands: string[]
}

export interface DhcpTrafficCapture {
  bridgeName: string
  duration: number
  packets: string[]
  summary: {
    totalPackets: number
    discoverPackets: number
    offerPackets: number
    requestPackets: number
    ackPackets: number
  }
}

/** Flag to track if bridge netfilter has been configured in this process */
let bridgeNetfilterConfigured = false

export class DepartmentNetworkService {
  private prisma: PrismaClient
  private bridgeManager: BridgeManager
  private natService: DepartmentNatService

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.bridgeManager = new BridgeManager()
    this.natService = new DepartmentNatService()
  }

  /**
   * Configures network infrastructure for a department.
   * Creates bridge, assigns IP, starts DHCP, and configures NAT.
   *
   * @param departmentId - The department ID
   * @param subnet - Subnet in CIDR notation (e.g., "10.10.100.0/24")
   * @throws Error if configuration fails
   */
  async configureNetwork (departmentId: string, subnet: string): Promise<void> {
    debug.log('info', `Configuring network for department ${departmentId}: ${subnet}`)

    // 1. Validate and parse subnet
    const config = this.parseSubnet(subnet, departmentId)
    await this.validateSubnet(subnet, departmentId)

    // Fetch department to get configurable DNS/NTP/MTU settings
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { dnsServers: true, ntpServers: true, mtu: true }
    })
    if (department) {
      config.dnsServers = department.dnsServers
      config.ntpServers = department.ntpServers
      config.mtu = department.mtu ?? undefined
    }

    // 2. Create directories
    await this.ensureDirectories()

    // Track what was created for rollback on failure
    const created = {
      bridge: false,
      ip: false,
      dnsmasq: false,
      nat: false
    }

    try {
      // 3. Configure bridge netfilter settings (must be done before creating bridges)
      // This disables iptables/nftables filtering for bridge traffic, allowing DHCP to work
      await this.configureBridgeNetfilter()

      // 4. Create bridge
      await this.bridgeManager.create(config.bridgeName)
      created.bridge = true
      debug.log('info', `Created bridge: ${config.bridgeName}`)

      // 5. Assign gateway IP to bridge
      const ipWithCidr = `${config.gatewayIP}/${config.netmask}`
      await this.bridgeManager.assignIP(config.bridgeName, ipWithCidr)
      created.ip = true
      debug.log('info', `Assigned IP: ${ipWithCidr} to ${config.bridgeName}`)

      // 5. Start dnsmasq for DHCP
      const dnsmasqPid = await this.startDnsmasq(config)
      created.dnsmasq = true
      debug.log('info', `Started dnsmasq with PID: ${dnsmasqPid}`)

      // 6. Configure NAT
      await this.natService.addMasquerade(subnet, config.bridgeName)
      created.nat = true
      debug.log('info', `Configured NAT for ${subnet}`)

      // 7. Update database
      await this.prisma.department.update({
        where: { id: departmentId },
        data: {
          ipSubnet: subnet,
          bridgeName: config.bridgeName,
          gatewayIP: config.gatewayIP,
          dhcpRangeStart: config.dhcpStart,
          dhcpRangeEnd: config.dhcpEnd,
          dnsmasqPid
        }
      })

      debug.log('info', `Network configured successfully for department ${departmentId}`)
    } catch (error) {
      // Rollback on failure
      debug.log('error', `Network configuration failed, rolling back: ${error}`)
      await this.rollback(config, created)
      throw error
    }
  }

  /**
   * Destroys network infrastructure for a department.
   * Stops dnsmasq, removes NAT, and destroys bridge with verification.
   *
   * @param departmentId - The department ID
   */
  async destroyNetwork (departmentId: string): Promise<void> {
    debug.log('info', `Destroying network for department ${departmentId}`)

    const department = await this.prisma.department.findUnique({
      where: { id: departmentId }
    })

    if (!department) {
      debug.log('warn', `Department ${departmentId} not found`)
      return
    }

    if (!department.bridgeName) {
      debug.log('info', `Department ${departmentId} has no network configured`)
      return
    }

    const bridgeName = department.bridgeName

    // 1. Clean up orphaned TAP devices connected to the bridge BEFORE destroying it
    await this.cleanupOrphanedTapDevices(bridgeName)

    // 2. Stop dnsmasq (try stored PID first, then fallback to pkill by bridge name)
    if (department.dnsmasqPid) {
      await this.stopDnsmasq(department.dnsmasqPid)
    }
    // Fallback: kill any dnsmasq process associated with this bridge
    // This handles cases where PID is stale (server restart) or null
    try {
      execSync(`pkill -f "dnsmasq.*${bridgeName}"`, { stdio: 'pipe' })
      debug.log('info', `Killed dnsmasq by bridge name: ${bridgeName}`)
    } catch {
      // No process found or already killed - ignore
    }

    // Verify dnsmasq is stopped
    const dnsmasqStopped = await this.verifyDnsmasqStopped(bridgeName)
    if (!dnsmasqStopped) {
      debug.log('warn', `dnsmasq may still be running for ${bridgeName} - continuing cleanup`)
    }

    // 3. Remove NAT
    await this.natService.removeMasquerade(bridgeName)

    // Verify NAT removed
    const natRemoved = !(await this.natService.hasMasquerade(bridgeName))
    if (!natRemoved) {
      debug.log('warn', `NAT rules may still exist for ${bridgeName} - continuing cleanup`)
    }

    // 4. Destroy bridge
    await this.bridgeManager.destroy(bridgeName)

    // Verify bridge destroyed
    const bridgeDestroyed = !(await this.bridgeManager.exists(bridgeName))
    if (!bridgeDestroyed) {
      debug.log('warn', `Bridge ${bridgeName} may still exist - continuing cleanup`)
    }

    // 5. Clean up config files
    await this.cleanupConfigFiles(bridgeName)

    // Verify files removed
    const filesRemoved = await this.verifyConfigFilesRemoved(bridgeName)
    if (!filesRemoved) {
      debug.log('warn', `Some config files may still exist for ${bridgeName}`)
    }

    // 6. Update database
    await this.prisma.department.update({
      where: { id: departmentId },
      data: {
        bridgeName: null,
        gatewayIP: null,
        dhcpRangeStart: null,
        dhcpRangeEnd: null,
        dnsmasqPid: null
      }
    })

    // 7. Clean up system files if this was the last department with a configured network
    await this.cleanupSystemFilesIfLastDepartment()

    // 8. Final verification and summary
    const verification = await this.verifyNetworkCleanup(bridgeName)
    debug.log('info', `Network cleanup verification for ${bridgeName}:`)
    debug.log('info', `  - Bridge removed: ${verification.bridgeRemoved}`)
    debug.log('info', `  - dnsmasq stopped: ${verification.dnsmasqStopped}`)
    debug.log('info', `  - NAT removed: ${verification.natRemoved}`)
    debug.log('info', `  - Files removed: ${verification.filesRemoved}`)
    debug.log('info', `  - All clean: ${verification.allClean}`)

    if (!verification.allClean) {
      debug.log('warn', `Incomplete cleanup for ${bridgeName}: ${JSON.stringify(verification.details)}`)
    }

    debug.log('info', `Network destroyed for department ${departmentId}`)
  }

  /**
   * Gets the bridge name for a department.
   *
   * @param departmentId - The department ID
   * @returns Bridge name or null if not configured
   */
  async getBridgeForDepartment (departmentId: string): Promise<string | null> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { bridgeName: true }
    })

    return department?.bridgeName ?? null
  }

  /**
   * Restores all department networks after server restart.
   * Recreates bridges and restarts dnsmasq for departments with configured networks.
   */
  async restoreAllNetworks (): Promise<void> {
    debug.log('info', 'Restoring all department networks')

    // Configure bridge netfilter settings first - critical for DHCP to work after reboot
    // This ensures br_netfilter is loaded and sysctls are set before creating bridges
    await this.configureBridgeNetfilter()

    // Initialize NAT service
    await this.natService.initialize()

    // Ensure directories exist (they may not exist on first boot or if cleared)
    await this.ensureDirectories()

    const departments = await this.prisma.department.findMany({
      where: {
        bridgeName: { not: null },
        ipSubnet: { not: null }
      }
    })

    for (const dept of departments) {
      if (!dept.ipSubnet || !dept.bridgeName) continue

      try {
        // Check if bridge exists
        const bridgeExists = await this.bridgeManager.exists(dept.bridgeName)

        if (!bridgeExists) {
          debug.log('info', `Restoring network for department ${dept.name}`)
          // Recreate the network
          const config = this.parseSubnet(dept.ipSubnet, dept.id)
          config.bridgeName = dept.bridgeName // Use existing bridge name
          config.dnsServers = dept.dnsServers
          config.ntpServers = dept.ntpServers

          // Create bridge and assign IP
          await this.bridgeManager.create(config.bridgeName)
          const ipWithCidr = `${config.gatewayIP}/${config.netmask}`
          await this.bridgeManager.assignIP(config.bridgeName, ipWithCidr)

          // Start dnsmasq
          const dnsmasqPid = await this.startDnsmasq(config)

          // Configure NAT
          await this.natService.addMasquerade(dept.ipSubnet, config.bridgeName)

          // Update PID in database
          await this.prisma.department.update({
            where: { id: dept.id },
            data: { dnsmasqPid }
          })

          debug.log('info', `Restored network for department ${dept.name}`)
        } else {
          // Bridge exists, just ensure dnsmasq is running
          await this.ensureDnsmasqRunning(dept)
          // Ensure NAT is configured
          const hasNat = await this.natService.hasMasquerade(dept.bridgeName)
          if (!hasNat) {
            await this.natService.addMasquerade(dept.ipSubnet, dept.bridgeName)
          }
          debug.log('info', `Network already active for department ${dept.name}`)
        }
      } catch (error) {
        debug.log('error', `Failed to restore network for department ${dept.name}: ${error}`)
      }
    }

    debug.log('info', 'Finished restoring department networks')
  }

  // ===========================================================================
  // Diagnostic Methods
  // ===========================================================================

  /**
   * Performs a comprehensive diagnostic of department network infrastructure.
   * Checks bridge, dnsmasq, br_netfilter, and NAT status.
   *
   * @param departmentId - The department ID to diagnose
   * @returns Complete network diagnostics including recommendations
   */
  async diagnoseDepartmentNetwork (departmentId: string): Promise<DepartmentNetworkDiagnostics> {
    debug.log('info', `Starting network diagnostics for department ${departmentId}`)

    // Get department from database
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId }
    })

    if (!department) {
      throw new Error(`Department ${departmentId} not found`)
    }

    if (!department.bridgeName) {
      throw new Error(`Department ${department.name} has no network configured`)
    }

    const bridgeName = department.bridgeName
    const configPath = path.join(DNSMASQ_CONFIG_DIR, `${bridgeName}.conf`)
    const leasePath = path.join(DNSMASQ_RUN_DIR, `${bridgeName}.leases`)
    const logPath = path.join(DNSMASQ_LOG_DIR, `dnsmasq-${bridgeName}.log`)

    // Run all diagnostic checks
    const [bridge, dnsmasq, brNetfilter, nat, tapDevices] = await Promise.all([
      this.checkBridgeStatus(bridgeName),
      this.checkDnsmasqStatus(department, configPath, leasePath, logPath),
      this.checkBrNetfilter(),
      this.checkNatStatus(bridgeName, department.ipSubnet || ''),
      this.checkTapDevicesStatus(bridgeName)
    ])

    // Log TAP devices diagnostics
    debug.log('info',
      `TAP devices on ${bridgeName}: ${tapDevices.totalDevices} total, ` +
      `${tapDevices.devicesWithCarrier} with carrier, ` +
      `${tapDevices.orphanedDevices} orphaned, ` +
      `${tapDevices.devicesWithoutCarrier} without carrier`
    )

    if (tapDevices.devicesWithoutCarrier > 0) {
      debug.log('warn',
        `TAP devices without carrier detected: ${tapDevices.devices.filter(d => !d.hasCarrier).map(d => d.name).join(', ')}`
      )
    }

    // Generate recommendations based on findings
    const recommendations = this.generateRecommendations(bridge, dnsmasq, brNetfilter, nat, tapDevices, bridgeName)

    // Generate manual debugging commands
    const manualCommands = this.generateManualCommands(bridgeName, logPath, tapDevices)

    const diagnostics: DepartmentNetworkDiagnostics = {
      departmentId,
      departmentName: department.name,
      timestamp: new Date(),
      bridge,
      dnsmasq,
      brNetfilter,
      nat,
      tapDevices,
      recommendations,
      manualCommands
    }

    debug.log('info', `Network diagnostics complete for department ${departmentId}`)
    return diagnostics
  }

  /**
   * Captures DHCP traffic on a department's bridge for debugging.
   * Uses tcpdump to capture DHCP discover/offer/request/ack packets.
   * Runs asynchronously to avoid blocking the Node event loop.
   *
   * @param departmentId - The department ID
   * @param durationSeconds - Duration to capture (5-120 seconds, default 30)
   * @returns Captured packets with summary statistics
   */
  async captureDhcpTraffic (departmentId: string, durationSeconds: number = 30): Promise<DhcpTrafficCapture> {
    // Validate duration
    if (durationSeconds < 5 || durationSeconds > 120) {
      throw new Error('Duration must be between 5 and 120 seconds')
    }

    // Get department from database
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId }
    })

    if (!department) {
      throw new Error(`Department ${departmentId} not found`)
    }

    if (!department.bridgeName) {
      throw new Error(`Department ${department.name} has no network configured`)
    }

    const bridgeName = department.bridgeName

    // Verify bridge exists
    const bridgeExists = await this.bridgeManager.exists(bridgeName)
    if (!bridgeExists) {
      throw new Error(`Bridge ${bridgeName} does not exist`)
    }

    debug.log('info', `Starting DHCP traffic capture on ${bridgeName} for ${durationSeconds}s`)

    return new Promise<DhcpTrafficCapture>((resolve, reject) => {
      const packets: string[] = []
      let discoverPackets = 0
      let offerPackets = 0
      let requestPackets = 0
      let ackPackets = 0

      // Spawn tcpdump process with line-buffered output
      const tcpdumpProcess = spawn('tcpdump', [
        '-i', bridgeName,
        '-n',
        'port 67 or port 68',
        '-v',
        '-l' // Line-buffered output for incremental capture
      ])

      // Set up timeout to stop tcpdump after duration
      const timeoutId = setTimeout(() => {
        tcpdumpProcess.kill('SIGTERM')
      }, durationSeconds * 1000)

      /**
       * Parses a line of tcpdump output and updates packet counters.
       */
      const parseLine = (line: string): void => {
        if (line.trim() === '') return

        // Skip tcpdump header/footer lines
        if (line.includes('listening on') || line.includes('packets captured') ||
            line.includes('packets received') || line.includes('packets dropped')) {
          return
        }

        packets.push(line)

        // Count DHCP message types
        const lineLower = line.toLowerCase()
        if (lineLower.includes('dhcp discover') || lineLower.includes('bootp/dhcp, request')) {
          if (lineLower.includes('discover')) {
            discoverPackets++
          }
        }
        if (lineLower.includes('dhcp offer') || (lineLower.includes('bootp/dhcp, reply') && lineLower.includes('offer'))) {
          offerPackets++
        }
        if (lineLower.includes('dhcp request')) {
          requestPackets++
        }
        if (lineLower.includes('dhcp ack') || lineLower.includes('dhcp-ack')) {
          ackPackets++
        }
      }

      // tcpdump writes packet output to stdout
      let stdoutBuffer = ''
      tcpdumpProcess.stdout.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString()
        const lines = stdoutBuffer.split('\n')
        // Keep the last incomplete line in the buffer
        stdoutBuffer = lines.pop() || ''
        for (const line of lines) {
          parseLine(line)
        }
      })

      // tcpdump writes verbose info and stats to stderr
      let stderrBuffer = ''
      tcpdumpProcess.stderr.on('data', (data: Buffer) => {
        stderrBuffer += data.toString()
        const lines = stderrBuffer.split('\n')
        // Keep the last incomplete line in the buffer
        stderrBuffer = lines.pop() || ''
        for (const line of lines) {
          parseLine(line)
        }
      })

      tcpdumpProcess.on('close', (code) => {
        clearTimeout(timeoutId)

        // Process any remaining data in buffers
        if (stdoutBuffer.trim()) {
          parseLine(stdoutBuffer)
        }
        if (stderrBuffer.trim()) {
          parseLine(stderrBuffer)
        }

        debug.log('info', `DHCP capture complete: ${packets.length} packets captured (exit code: ${code})`)

        resolve({
          bridgeName,
          duration: durationSeconds,
          packets,
          summary: {
            totalPackets: packets.length,
            discoverPackets,
            offerPackets,
            requestPackets,
            ackPackets
          }
        })
      })

      tcpdumpProcess.on('error', (error) => {
        clearTimeout(timeoutId)
        debug.log('error', `DHCP capture failed: ${error.message}`)
        reject(new Error(`Failed to start tcpdump: ${error.message}`))
      })
    })
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Parses a CIDR subnet string into configuration.
   */
  private parseSubnet (subnet: string, departmentId: string): SubnetConfig {
    // Validate CIDR format
    const match = subnet.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/)
    if (!match) {
      throw new Error(`Invalid subnet format: ${subnet}. Expected CIDR notation (e.g., 10.10.100.0/24)`)
    }

    const [, networkAddress, netmask] = match
    const netmaskNum = parseInt(netmask, 10)

    if (netmaskNum < 8 || netmaskNum > 30) {
      throw new Error(`Invalid netmask /${netmask}. Must be between /8 and /30`)
    }

    // Parse network address octets
    const octets = networkAddress.split('.').map(Number)
    if (octets.some(o => o < 0 || o > 255)) {
      throw new Error(`Invalid IP address in subnet: ${subnet}`)
    }

    // Gateway is .1 of the subnet
    const gatewayIP = `${octets[0]}.${octets[1]}.${octets[2]}.1`

    // DHCP range: .10 to .254
    const dhcpStart = `${octets[0]}.${octets[1]}.${octets[2]}.10`
    const dhcpEnd = `${octets[0]}.${octets[1]}.${octets[2]}.254`

    // Generate bridge name (max 15 chars for Linux)
    const bridgeName = this.generateBridgeName(departmentId)

    return {
      subnet,
      networkAddress,
      gatewayIP,
      dhcpStart,
      dhcpEnd,
      netmask,
      bridgeName
    }
  }

  /**
   * Calculates network addresses from subnet configuration.
   * Used for generating DHCP options.
   */
  private calculateNetworkAddresses (config: SubnetConfig): {
    subnetMask: string
    broadcastAddress: string
  } {
    const netmaskNum = parseInt(config.netmask, 10)

    // Calculate subnet mask from CIDR notation
    // e.g., /24 -> 255.255.255.0, /16 -> 255.255.0.0
    const maskBits = netmaskNum === 0 ? 0 : ~((1 << (32 - netmaskNum)) - 1) >>> 0
    const subnetMask = [
      (maskBits >>> 24) & 255,
      (maskBits >>> 16) & 255,
      (maskBits >>> 8) & 255,
      maskBits & 255
    ].join('.')

    // Calculate broadcast address from network address and netmask
    const octets = config.networkAddress.split('.').map(Number)
    const networkNum = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]
    const hostBits = ~maskBits >>> 0
    const broadcastNum = (networkNum | hostBits) >>> 0
    const broadcastAddress = [
      (broadcastNum >>> 24) & 255,
      (broadcastNum >>> 16) & 255,
      (broadcastNum >>> 8) & 255,
      broadcastNum & 255
    ].join('.')

    return { subnetMask, broadcastAddress }
  }

  /**
   * Generates a unique bridge name for a department.
   */
  private generateBridgeName (departmentId: string): string {
    // "infinibr-" (9 chars) + 6 chars from ID = 15 chars (Linux limit)
    return `${BRIDGE_PREFIX}${departmentId.substring(0, 6)}`
  }

  /**
   * Validates that a subnet can be used.
   */
  private async validateSubnet (subnet: string, departmentId: string): Promise<void> {
    // Check reserved subnets
    for (const reserved of RESERVED_SUBNETS) {
      if (this.subnetsOverlap(subnet, reserved)) {
        throw new Error(`Subnet ${subnet} overlaps with reserved subnet ${reserved}`)
      }
    }

    // Check overlap with other departments
    const otherDepts = await this.prisma.department.findMany({
      where: {
        id: { not: departmentId },
        ipSubnet: { not: null }
      },
      select: { id: true, name: true, ipSubnet: true }
    })

    for (const dept of otherDepts) {
      if (dept.ipSubnet && this.subnetsOverlap(subnet, dept.ipSubnet)) {
        throw new Error(`Subnet ${subnet} overlaps with department "${dept.name}" (${dept.ipSubnet})`)
      }
    }
  }

  /**
   * Checks if two CIDR subnets overlap.
   */
  private subnetsOverlap (subnet1: string, subnet2: string): boolean {
    const parse = (cidr: string) => {
      const [ip, mask] = cidr.split('/')
      const octets = ip.split('.').map(Number)
      const ipNum = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]
      const maskBits = parseInt(mask, 10)
      const maskNum = maskBits === 0 ? 0 : ~((1 << (32 - maskBits)) - 1)
      return { start: ipNum & maskNum, end: (ipNum & maskNum) + ~maskNum }
    }

    const r1 = parse(subnet1)
    const r2 = parse(subnet2)

    return r1.start <= r2.end && r2.start <= r1.end
  }

  /**
   * Ensures required directories exist.
   */
  private async ensureDirectories (): Promise<void> {
    const dirs = [DNSMASQ_CONFIG_DIR, DNSMASQ_RUN_DIR, DNSMASQ_LOG_DIR, SYSCTL_CONFIG_DIR, MODULES_LOAD_DIR]
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true })
    }
  }

  /**
   * Checks if a kernel module is currently loaded.
   *
   * @param moduleName - Name of the kernel module to check
   * @returns true if module is loaded, false otherwise
   */
  private isModuleLoaded (moduleName: string): boolean {
    try {
      const output = execSync(`lsmod | grep ${moduleName}`, { encoding: 'utf8', stdio: 'pipe' })
      const isLoaded = output.includes(moduleName)
      debug.log('info', `Module ${moduleName} is ${isLoaded ? 'loaded' : 'not loaded'}`)
      return isLoaded
    } catch {
      debug.log('info', `Module ${moduleName} is not loaded`)
      return false
    }
  }

  /**
   * Loads a kernel module using modprobe.
   *
   * @param moduleName - Name of the kernel module to load
   * @returns true if module was loaded successfully, false otherwise
   */
  private loadKernelModule (moduleName: string): boolean {
    if (this.isModuleLoaded(moduleName)) {
      debug.log('info', `Module ${moduleName} is already loaded, skipping modprobe`)
      return true
    }

    try {
      debug.log('info', `Loading kernel module: ${moduleName}`)
      execSync(`modprobe ${moduleName}`, { stdio: 'pipe' })

      if (this.isModuleLoaded(moduleName)) {
        debug.log('info', `Successfully loaded kernel module: ${moduleName}`)
        return true
      } else {
        debug.log('error', `modprobe succeeded but module ${moduleName} is not visible in lsmod`)
        return false
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('error', `Failed to load kernel module ${moduleName}: ${errorMessage}`)
      return false
    }
  }

  /**
   * Persists kernel module load configuration to /etc/modules-load.d/
   * so the module is loaded automatically at boot.
   *
   * @param moduleName - Name of the kernel module to persist
   */
  private async persistModuleLoad (moduleName: string): Promise<void> {
    const content = `# Infinibay kernel module configuration
# Auto-generated - do not edit manually

# Load ${moduleName} module at boot for bridge netfilter configuration
${moduleName}
`

    try {
      // Ensure directory exists (may be called before ensureDirectories in restoreAllNetworks)
      await fs.mkdir(MODULES_LOAD_DIR, { recursive: true })
      await fs.writeFile(MODULES_LOAD_FILE, content)
      debug.log('info', `Created module persistence file: ${MODULES_LOAD_FILE}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('error', `Failed to create module persistence file: ${errorMessage}`)
    }
  }

  /**
   * Configures kernel parameters to allow DHCP traffic through Linux bridges.
   *
   * The br_netfilter kernel module causes bridge traffic to pass through
   * iptables/nftables, which can block DHCP broadcasts. By disabling these
   * filters for bridge traffic, we ensure DHCP works correctly for VMs.
   *
   * This method:
   * 1. Loads the br_netfilter kernel module if not already loaded
   * 2. Persists the module load for system reboots (/etc/modules-load.d/)
   * 3. Creates a persistent sysctl configuration file
   * 4. Applies the settings immediately
   *
   * @throws Error if br_netfilter module cannot be loaded (critical for DHCP)
   */
  private async configureBridgeNetfilter (): Promise<void> {
    // Skip if already configured in this process to avoid repeated work
    if (bridgeNetfilterConfigured) {
      debug.log('info', 'Bridge netfilter already configured in this process, skipping')
      return
    }

    debug.log('info', 'Configuring bridge netfilter settings for DHCP')

    // Step 1: Check and load br_netfilter module
    const moduleWasLoaded = this.isModuleLoaded('br_netfilter')
    if (!moduleWasLoaded) {
      const loadSuccess = this.loadKernelModule('br_netfilter')
      if (!loadSuccess) {
        throw new Error('Failed to load br_netfilter kernel module. DHCP will not work correctly.')
      }
    }

    // Step 2: Persist module load for reboots
    try {
      await this.persistModuleLoad('br_netfilter')
      await fs.access(MODULES_LOAD_FILE)
      debug.log('info', `Verified module persistence file exists: ${MODULES_LOAD_FILE}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Failed to persist module load (non-critical): ${errorMessage}`)
      // Continue - module is loaded in memory, persistence is nice-to-have
    }

    // Step 3: Create sysctl configuration
    const sysctlContent = `# Infinibay bridge netfilter configuration
# Disable iptables/nftables filtering for bridge traffic to allow DHCP
# Auto-generated - do not edit manually

# Disable iptables filtering for bridged IPv4 traffic
net.bridge.bridge-nf-call-iptables=0

# Disable ip6tables filtering for bridged IPv6 traffic
net.bridge.bridge-nf-call-ip6tables=0

# Disable arptables filtering for bridged ARP traffic
net.bridge.bridge-nf-call-arptables=0
`

    try {
      await fs.writeFile(SYSCTL_CONFIG_FILE, sysctlContent)
      debug.log('info', `Created sysctl config: ${SYSCTL_CONFIG_FILE}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Failed to write sysctl config: ${errorMessage}`)
    }

    // Step 4: Apply sysctl settings immediately
    try {
      execSync('sysctl -w net.bridge.bridge-nf-call-iptables=0', { stdio: 'pipe' })
      execSync('sysctl -w net.bridge.bridge-nf-call-ip6tables=0', { stdio: 'pipe' })
      execSync('sysctl -w net.bridge.bridge-nf-call-arptables=0', { stdio: 'pipe' })
      debug.log('info', 'Applied bridge netfilter sysctl settings')

      // Verify settings were applied
      const verifyIptables = execSync('sysctl net.bridge.bridge-nf-call-iptables', { encoding: 'utf8' }).trim()
      const verifyIp6tables = execSync('sysctl net.bridge.bridge-nf-call-ip6tables', { encoding: 'utf8' }).trim()
      const verifyArptables = execSync('sysctl net.bridge.bridge-nf-call-arptables', { encoding: 'utf8' }).trim()
      debug.log('info', `Verified: ${verifyIptables}`)
      debug.log('info', `Verified: ${verifyIp6tables}`)
      debug.log('info', `Verified: ${verifyArptables}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Failed to apply sysctl settings: ${errorMessage}`)
    }

    // Step 5: Final verification and summary
    try {
      const lsmodOutput = execSync('lsmod | grep br_netfilter', { encoding: 'utf8', stdio: 'pipe' }).trim()
      debug.log('info', `Module verification: ${lsmodOutput}`)
    } catch {
      debug.log('warn', 'br_netfilter not visible in lsmod during final verification')
    }

    debug.log('info', 'Bridge netfilter configuration complete:')
    debug.log('info', `  - Module loaded: yes`)
    debug.log('info', `  - Persistence file: ${MODULES_LOAD_FILE}`)
    debug.log('info', `  - Sysctl file: ${SYSCTL_CONFIG_FILE}`)

    // Mark as configured to avoid repeated work in this process
    bridgeNetfilterConfigured = true
  }

  /**
   * Validates a dnsmasq configuration file before starting the service.
   * Uses dnsmasq's built-in test mode to check syntax.
   */
  private validateDnsmasqConfig (configPath: string): void {
    try {
      execSync(`dnsmasq --test --conf-file=${configPath}`, {
        stdio: 'pipe'
      })
      debug.log('info', `dnsmasq config validated: ${configPath}`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid dnsmasq configuration: ${errorMessage}`)
    }
  }

  /**
   * Validates if a string is a valid IPv4 address.
   * @param ip - String to validate
   * @returns true if valid IPv4 address, false otherwise
   */
  private isValidIPv4 (ip: string): boolean {
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
    const match = ip.match(ipv4Regex)
    if (!match) return false

    // Check each octet is 0-255
    for (let i = 1; i <= 4; i++) {
      const octet = parseInt(match[i], 10)
      if (octet < 0 || octet > 255) return false
    }
    return true
  }

  /**
   * Starts dnsmasq for DHCP on a bridge.
   * Configures optimized DHCP settings for VM compatibility, especially Ubuntu autoinstall.
   */
  private async startDnsmasq (config: SubnetConfig): Promise<number> {
    const configPath = path.join(DNSMASQ_CONFIG_DIR, `${config.bridgeName}.conf`)
    const pidPath = path.join(DNSMASQ_RUN_DIR, `${config.bridgeName}.pid`)
    const leasePath = path.join(DNSMASQ_RUN_DIR, `${config.bridgeName}.leases`)
    const logPath = path.join(DNSMASQ_LOG_DIR, `dnsmasq-${config.bridgeName}.log`)

    // Calculate network addresses for DHCP options
    const networkAddresses = this.calculateNetworkAddresses(config)

    // DNS and NTP servers with fallback to public defaults
    const dnsServers = config.dnsServers && config.dnsServers.length > 0
      ? config.dnsServers
      : ['8.8.8.8', '8.8.4.4', '1.1.1.1']
    // Filter NTP servers to only include valid IP addresses (DHCP option 42 requires IPs, not hostnames)
    const ntpServers = config.ntpServers && config.ntpServers.length > 0
      ? config.ntpServers.filter(ntp => this.isValidIPv4(ntp))
      : [] // Empty array if no valid IPs - we'll skip DHCP option 42

    // Log if NTP servers were filtered out
    if (config.ntpServers && config.ntpServers.length > 0 && ntpServers.length === 0) {
      debug.log('warn', `All NTP servers filtered out (DHCP option 42 requires IP addresses): ${config.ntpServers.join(', ')}`)
    } else if (config.ntpServers && config.ntpServers.length > ntpServers.length) {
      const filtered = config.ntpServers.filter(ntp => !this.isValidIPv4(ntp))
      debug.log('warn', `Filtered out invalid NTP servers (not IP addresses): ${filtered.join(', ')}`)
    }

    // MTU configuration with fallback to standard Ethernet MTU
    const mtu = config.mtu ?? 1500

    // Create config file with optimized DHCP settings
    // See: https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html
    const configContent = `# ============================================================================
# Infinibay dnsmasq Configuration - ${config.bridgeName}
# ============================================================================
# Auto-generated configuration file - DO NOT EDIT MANUALLY
# Optimized for VM environments with fast DHCP acquisition
# Documentation: https://thekelleys.org.uk/dnsmasq/docs/dnsmasq-man.html
# ============================================================================

# ----------------------------------------------------------------------------
# Interface Binding
# ----------------------------------------------------------------------------
# Bind only to the department bridge interface
interface=${config.bridgeName}
except-interface=lo
bind-interfaces

# ----------------------------------------------------------------------------
# DHCP Server Configuration
# ----------------------------------------------------------------------------
# Authoritative mode: respond immediately without waiting for other DHCP servers
# This significantly reduces IP acquisition time (from ~10s to ~2s)
dhcp-authoritative

# DHCP address pool and lease configuration
# Lease time: 4h (suitable for development/lab environments)
dhcp-range=${config.dhcpStart},${config.dhcpEnd},${networkAddresses.subnetMask},4h
dhcp-lease-max=253

# ----------------------------------------------------------------------------
# DHCP Options (RFC 2132)
# ----------------------------------------------------------------------------
# Using numeric option codes for maximum client compatibility

# Option 1: Subnet Mask
dhcp-option=1,${networkAddresses.subnetMask}

# Option 3: Default Gateway/Router
dhcp-option=3,${config.gatewayIP}

# Option 6: DNS Servers (configurable per department)
dhcp-option=6,${dnsServers.join(',')}

# Option 15: Domain Name
dhcp-option=15,infinibay.local

# Option 26: Interface MTU (Maximum Transmission Unit)
dhcp-option=26,${mtu}

# Option 28: Broadcast Address
dhcp-option=28,${networkAddresses.broadcastAddress}

# Option 42: NTP Servers (configurable per department, requires IP addresses)
${ntpServers.length > 0 ? `dhcp-option=42,${ntpServers.join(',')}` : '# NTP servers not configured (requires IP addresses, not hostnames)'}

# ----------------------------------------------------------------------------
# DHCP Optimization for Virtual Machines
# ----------------------------------------------------------------------------
# Always broadcast DHCP responses (required for VMs without IP yet)
dhcp-broadcast

# Enable rapid commit (2-message exchange instead of 4-message)
# Speeds up DHCP for RFC 4039 compliant clients
dhcp-rapid-commit

# Force DHCP responses even without ARP entry
# Helps with VMs that have slow network stack initialization
dhcp-no-override

# No artificial delay in DHCP responses
dhcp-reply-delay=0

# Ignore client-provided hostnames to avoid naming conflicts
dhcp-ignore-names

# ----------------------------------------------------------------------------
# DNS Configuration
# ----------------------------------------------------------------------------
# Don't read /etc/resolv.conf for upstream DNS servers
no-resolv

# Query upstream servers in strict order (with timeout fallback)
strict-order

# Upstream DNS servers (configurable per department)
${dnsServers.map(dns => `server=${dns}`).join('\n')}

# DNS cache size (number of entries)
cache-size=1000

# ----------------------------------------------------------------------------
# File Paths
# ----------------------------------------------------------------------------
# DHCP lease database
dhcp-leasefile=${leasePath}

# Logging configuration
log-facility=${logPath}
log-dhcp
log-queries
`
    await fs.writeFile(configPath, configContent)

    debug.log('info', `Created dnsmasq config: ${configPath}`)
    debug.log('info', `DHCP range: ${config.dhcpStart} - ${config.dhcpEnd}`)
    debug.log('info', `Gateway: ${config.gatewayIP}, Subnet: ${networkAddresses.subnetMask}`)

    // Validate configuration before starting
    this.validateDnsmasqConfig(configPath)

    // Start dnsmasq
    try {
      execSync(`dnsmasq --conf-file=${configPath} --pid-file=${pidPath}`, {
        stdio: 'pipe'
      })

      // Read PID from file
      const pidContent = await fs.readFile(pidPath, 'utf8')
      const pid = parseInt(pidContent.trim(), 10)

      if (isNaN(pid)) {
        throw new Error('Failed to read dnsmasq PID')
      }

      debug.log('info', `dnsmasq started (PID: ${pid}) for ${config.bridgeName}`)

      // Verify dnsmasq is listening on DHCP port
      this.verifyDnsmasqListening(config.bridgeName)

      // Log DHCP leases for debugging
      try {
        const leasesContent = execSync(`cat ${leasePath} 2>/dev/null || echo "No leases yet"`, { encoding: 'utf8' })
        debug.log('info', `[DHCP] Current leases:\n${leasesContent}`)
      } catch {
        debug.log('info', '[DHCP] Lease file not accessible yet')
      }

      return pid
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('error', `Failed to start dnsmasq for ${config.bridgeName}: ${errorMessage}`)
      debug.log('error', `Config path: ${configPath}`)
      throw new Error(`Failed to start dnsmasq: ${errorMessage}`)
    }
  }

  /**
   * Verifies that dnsmasq is listening on the DHCP port (67).
   * Logs the result for diagnostics.
   */
  private verifyDnsmasqListening (bridgeName: string): void {
    try {
      // Check if dnsmasq is listening on UDP port 67
      const ssOutput = execSync('ss -ulnp | grep :67 || true', { encoding: 'utf8' })
      if (ssOutput.includes(':67')) {
        debug.log('info', `[DHCP] dnsmasq is listening on port 67`)
        debug.log('info', `[DHCP] ${ssOutput.trim()}`)
      } else {
        debug.log('warn', `[DHCP] dnsmasq may not be listening on port 67`)
      }

      // Log bridge configuration for debugging
      const bridgeInfo = execSync(`ip addr show ${bridgeName} 2>/dev/null || true`, { encoding: 'utf8' })
      if (bridgeInfo) {
        debug.log('info', `[BRIDGE] Configuration for ${bridgeName}:`)
        debug.log('info', bridgeInfo.trim())
      }

      // Log connected interfaces
      const bridgeLinks = execSync('bridge link show 2>/dev/null || true', { encoding: 'utf8' })
      if (bridgeLinks) {
        debug.log('info', `[BRIDGE] Connected interfaces:`)
        debug.log('info', bridgeLinks.trim())
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `[DHCP] Failed to verify dnsmasq status: ${errorMessage}`)
    }
  }

  /**
   * Stops a dnsmasq process.
   */
  private async stopDnsmasq (pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM')
      // Wait for process to exit
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Check if still running and force kill
      try {
        process.kill(pid, 0) // Check if alive
        process.kill(pid, 'SIGKILL')
        debug.log('info', `Force killed dnsmasq (PID: ${pid})`)
      } catch {
        // Process already exited
        debug.log('info', `Stopped dnsmasq (PID: ${pid})`)
      }
    } catch (error) {
      // Process might not exist
      debug.log('warn', `Could not stop dnsmasq (PID: ${pid}): ${error}`)
    }
  }

  /**
   * Restarts dnsmasq for a department to apply configuration changes (e.g., DNS/NTP servers).
   * Stops the current dnsmasq process and starts a new one with updated configuration.
   */
  async restartDnsmasq (departmentId: string): Promise<void> {
    const dept = await this.prisma.department.findUnique({
      where: { id: departmentId }
    })

    if (!dept || !dept.bridgeName || !dept.ipSubnet) {
      throw new Error(`Department ${departmentId} not found or has no network configured`)
    }

    // Stop existing dnsmasq if running
    if (dept.dnsmasqPid) {
      await this.stopDnsmasq(dept.dnsmasqPid)
    }

    // Build config with updated DNS/NTP/MTU settings
    const config = this.parseSubnet(dept.ipSubnet, dept.id)
    config.bridgeName = dept.bridgeName
    config.dnsServers = dept.dnsServers
    config.ntpServers = dept.ntpServers
    config.mtu = dept.mtu ?? undefined

    // Start new dnsmasq with updated config
    const newPid = await this.startDnsmasq(config)

    // Update PID in database
    await this.prisma.department.update({
      where: { id: departmentId },
      data: { dnsmasqPid: newPid }
    })

    debug.log('info', `Restarted dnsmasq for department ${departmentId} with new PID: ${newPid}`)
  }

  /**
   * Ensures dnsmasq is running for a department.
   */
  private async ensureDnsmasqRunning (dept: Department): Promise<void> {
    if (!dept.dnsmasqPid || !dept.bridgeName || !dept.ipSubnet) return

    // Check if process is running
    try {
      process.kill(dept.dnsmasqPid, 0)
      debug.log('info', `dnsmasq already running for ${dept.bridgeName} (PID: ${dept.dnsmasqPid})`)
    } catch {
      // Process not running, restart it
      debug.log('info', `Restarting dnsmasq for ${dept.bridgeName}`)
      const config = this.parseSubnet(dept.ipSubnet, dept.id)
      config.bridgeName = dept.bridgeName
      config.dnsServers = dept.dnsServers
      config.ntpServers = dept.ntpServers
      config.mtu = dept.mtu ?? undefined

      const newPid = await this.startDnsmasq(config)
      await this.prisma.department.update({
        where: { id: dept.id },
        data: { dnsmasqPid: newPid }
      })
    }
  }

  /**
   * Cleans up configuration files for a bridge and attempts to remove empty directories.
   */
  private async cleanupConfigFiles (bridgeName: string): Promise<void> {
    const files = [
      path.join(DNSMASQ_CONFIG_DIR, `${bridgeName}.conf`),
      path.join(DNSMASQ_RUN_DIR, `${bridgeName}.pid`),
      path.join(DNSMASQ_RUN_DIR, `${bridgeName}.leases`),
      path.join(DNSMASQ_LOG_DIR, `dnsmasq-${bridgeName}.log`)
    ]

    for (const file of files) {
      try {
        await fs.unlink(file)
        debug.log('info', `Removed: ${file}`)
      } catch {
        // File doesn't exist, ignore
      }
    }

    // Attempt to remove empty directories
    const directories = [DNSMASQ_CONFIG_DIR, DNSMASQ_RUN_DIR, DNSMASQ_LOG_DIR]
    for (const dir of directories) {
      await this.removeEmptyDirectory(dir)
    }
  }

  /**
   * Attempts to remove a directory if it's empty.
   * Silently ignores errors (directory not empty, doesn't exist, etc.)
   */
  private async removeEmptyDirectory (dirPath: string): Promise<void> {
    try {
      const contents = await fs.readdir(dirPath)
      if (contents.length === 0) {
        await fs.rmdir(dirPath)
        debug.log('info', `Removed empty directory: ${dirPath}`)
      }
    } catch {
      // Directory doesn't exist or couldn't be read/removed - ignore
    }
  }

  // ===========================================================================
  // Network Cleanup Helper Methods
  // ===========================================================================

  /**
   * Cleans up orphaned TAP devices connected to a bridge.
   * This must be called BEFORE destroying the bridge.
   */
  private async cleanupOrphanedTapDevices (bridgeName: string): Promise<void> {
    debug.log('info', `Checking for orphaned TAP devices on bridge ${bridgeName}`)

    try {
      // Get all interfaces attached to the bridge
      const interfaces = await this.bridgeManager.listInterfaces(bridgeName)

      if (interfaces.length === 0) {
        debug.log('info', `No interfaces attached to bridge ${bridgeName}`)
        return
      }

      debug.log('info', `Found ${interfaces.length} interfaces on bridge ${bridgeName}: ${interfaces.join(', ')}`)

      const tapManager = new TapDeviceManager()

      for (const iface of interfaces) {
        // Only clean up TAP devices (vnet-* or tap-* prefixes)
        if (!iface.startsWith('vnet-') && !iface.startsWith('tap-')) {
          debug.log('info', `Skipping non-TAP interface: ${iface}`)
          continue
        }

        debug.log('info', `Cleaning up orphaned TAP device: ${iface}`)

        try {
          // First, detach from the bridge
          await this.bridgeManager.removeInterface(bridgeName, iface)
          debug.log('info', `Detached ${iface} from bridge ${bridgeName}`)

          // Then, destroy the TAP device
          await tapManager.destroy(iface)
          debug.log('info', `Destroyed orphaned TAP device: ${iface}`)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          // Log warning but continue - device may be in use by an active VM
          debug.log('warn', `Could not cleanup TAP device ${iface}: ${errorMessage}`)
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Error checking for orphaned TAP devices: ${errorMessage}`)
    }
  }

  /**
   * Verifies that dnsmasq is stopped for a bridge.
   */
  private async verifyDnsmasqStopped (bridgeName: string): Promise<boolean> {
    try {
      // Check using pgrep
      const output = execSync(`pgrep -f "dnsmasq.*${bridgeName}" || true`, { encoding: 'utf8', stdio: 'pipe' })
      if (output.trim()) {
        debug.log('warn', `dnsmasq still running for ${bridgeName}: PIDs ${output.trim()}`)
        return false
      }

      // Also check if port 67 is still in use by dnsmasq for this bridge
      const ssOutput = execSync(`ss -ulnp | grep ":67 " | grep "${bridgeName}" || true`, { encoding: 'utf8', stdio: 'pipe' })
      if (ssOutput.trim()) {
        debug.log('warn', `dnsmasq may still be listening for ${bridgeName}`)
        return false
      }

      return true
    } catch {
      // If commands fail, assume it's stopped
      return true
    }
  }

  /**
   * Verifies that config files were removed for a bridge.
   */
  private async verifyConfigFilesRemoved (bridgeName: string): Promise<boolean> {
    const files = [
      path.join(DNSMASQ_CONFIG_DIR, `${bridgeName}.conf`),
      path.join(DNSMASQ_RUN_DIR, `${bridgeName}.pid`),
      path.join(DNSMASQ_RUN_DIR, `${bridgeName}.leases`),
      path.join(DNSMASQ_LOG_DIR, `dnsmasq-${bridgeName}.log`)
    ]

    let allRemoved = true
    for (const file of files) {
      try {
        await fs.access(file)
        debug.log('warn', `File still exists: ${file}`)
        allRemoved = false
      } catch {
        // File doesn't exist - good
      }
    }

    return allRemoved
  }

  /**
   * Cleans up system-wide configuration files if this is the last department
   * with a configured network.
   */
  private async cleanupSystemFilesIfLastDepartment (): Promise<void> {
    try {
      // Count departments with configured networks
      const count = await this.prisma.department.count({
        where: {
          bridgeName: { not: null }
        }
      })

      if (count > 0) {
        debug.log('info', `${count} department(s) still have configured networks, keeping system files`)
        return
      }

      debug.log('info', 'Last department network destroyed, cleaning up system files')

      // Remove sysctl config file
      try {
        await fs.unlink(SYSCTL_CONFIG_FILE)
        debug.log('info', `Removed system file: ${SYSCTL_CONFIG_FILE}`)
      } catch {
        // File doesn't exist or couldn't be removed
      }

      // Remove modules-load config file
      try {
        await fs.unlink(MODULES_LOAD_FILE)
        debug.log('info', `Removed system file: ${MODULES_LOAD_FILE}`)
      } catch {
        // File doesn't exist or couldn't be removed
      }

      // Reset the in-process flag so netfilter will be configured again if needed
      bridgeNetfilterConfigured = false

      debug.log('info', 'System files cleanup complete')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Error during system files cleanup: ${errorMessage}`)
    }
  }

  /**
   * Performs a complete verification of network cleanup.
   */
  private async verifyNetworkCleanup (bridgeName: string): Promise<NetworkCleanupVerification> {
    const result: NetworkCleanupVerification = {
      bridgeRemoved: true,
      dnsmasqStopped: true,
      natRemoved: true,
      filesRemoved: true,
      allClean: true,
      details: {
        bridgeName
      }
    }

    // Check bridge
    const bridgeExists = await this.bridgeManager.exists(bridgeName)
    if (bridgeExists) {
      result.bridgeRemoved = false
      result.allClean = false
      result.details.remainingInterfaces = await this.bridgeManager.listInterfaces(bridgeName)
    }

    // Check dnsmasq
    try {
      const psOutput = execSync(`pgrep -f "dnsmasq.*${bridgeName}" || true`, { encoding: 'utf8', stdio: 'pipe' })
      if (psOutput.trim()) {
        result.dnsmasqStopped = false
        result.allClean = false
        result.details.runningDnsmasqPid = parseInt(psOutput.trim().split('\n')[0], 10)
      }
    } catch {
      // Assume stopped if command fails
    }

    // Check NAT
    const hasNat = await this.natService.hasMasquerade(bridgeName)
    if (hasNat) {
      result.natRemoved = false
      result.allClean = false
    }

    // Check files
    const files = [
      path.join(DNSMASQ_CONFIG_DIR, `${bridgeName}.conf`),
      path.join(DNSMASQ_RUN_DIR, `${bridgeName}.pid`),
      path.join(DNSMASQ_RUN_DIR, `${bridgeName}.leases`),
      path.join(DNSMASQ_LOG_DIR, `dnsmasq-${bridgeName}.log`)
    ]

    const remainingFiles: string[] = []
    for (const file of files) {
      try {
        await fs.access(file)
        remainingFiles.push(file)
      } catch {
        // File doesn't exist - good
      }
    }

    if (remainingFiles.length > 0) {
      result.filesRemoved = false
      result.allClean = false
      result.details.remainingFiles = remainingFiles
    }

    return result
  }

  /**
   * Force destroys network infrastructure for a department.
   * Attempts each cleanup operation individually with error isolation.
   * Does not throw errors, returns status of each operation.
   *
   * @param departmentId - The department ID
   * @returns Result with status of each cleanup operation
   */
  async forceDestroyNetwork (departmentId: string): Promise<ForceDestroyResult> {
    debug.log('info', `Force destroying network for department ${departmentId}`)

    const result: ForceDestroyResult = {
      success: false,
      operations: {
        tapDevicesCleanup: { attempted: false, success: false },
        dnsmasqStop: { attempted: false, success: false },
        natRemoval: { attempted: false, success: false },
        bridgeDestruction: { attempted: false, success: false },
        fileCleanup: { attempted: false, success: false },
        databaseUpdate: { attempted: false, success: false },
        systemFilesCleanup: { attempted: false, success: false }
      }
    }

    const department = await this.prisma.department.findUnique({
      where: { id: departmentId }
    })

    if (!department) {
      debug.log('warn', `Department ${departmentId} not found for force destroy`)
      return result
    }

    const bridgeName = department.bridgeName
    if (!bridgeName) {
      debug.log('info', `Department ${departmentId} has no network configured`)
      result.success = true
      return result
    }

    // 1. Force cleanup TAP devices
    result.operations.tapDevicesCleanup.attempted = true
    try {
      await this.cleanupOrphanedTapDevices(bridgeName)
      result.operations.tapDevicesCleanup.success = true
    } catch (error) {
      result.operations.tapDevicesCleanup.error = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Force destroy: TAP cleanup failed: ${result.operations.tapDevicesCleanup.error}`)
    }

    // 2. Force stop dnsmasq
    result.operations.dnsmasqStop.attempted = true
    try {
      // Try graceful stop first
      if (department.dnsmasqPid) {
        await this.stopDnsmasq(department.dnsmasqPid)
      }
      // Then force kill by name
      try {
        execSync(`pkill -9 -f "dnsmasq.*${bridgeName}"`, { stdio: 'pipe' })
      } catch {
        // No process found - OK
      }
      result.operations.dnsmasqStop.success = true
    } catch (error) {
      result.operations.dnsmasqStop.error = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Force destroy: dnsmasq stop failed: ${result.operations.dnsmasqStop.error}`)
    }

    // 3. Force remove NAT
    result.operations.natRemoval.attempted = true
    try {
      await this.natService.removeMasquerade(bridgeName)
      result.operations.natRemoval.success = true
    } catch (error) {
      result.operations.natRemoval.error = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Force destroy: NAT removal failed: ${result.operations.natRemoval.error}`)
    }

    // 4. Force destroy bridge
    result.operations.bridgeDestruction.attempted = true
    try {
      // Try normal destruction first
      await this.bridgeManager.destroy(bridgeName)
      result.operations.bridgeDestruction.success = true
    } catch (error) {
      // Try aggressive deletion with ip link
      try {
        execSync(`ip link set ${bridgeName} down 2>/dev/null || true`, { stdio: 'pipe' })
        execSync(`ip link del ${bridgeName} 2>/dev/null || true`, { stdio: 'pipe' })
        result.operations.bridgeDestruction.success = true
      } catch {
        result.operations.bridgeDestruction.error = error instanceof Error ? error.message : String(error)
        debug.log('warn', `Force destroy: bridge destruction failed: ${result.operations.bridgeDestruction.error}`)
      }
    }

    // 5. Force cleanup files
    result.operations.fileCleanup.attempted = true
    try {
      await this.cleanupConfigFiles(bridgeName)
      result.operations.fileCleanup.success = true
    } catch (error) {
      result.operations.fileCleanup.error = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Force destroy: file cleanup failed: ${result.operations.fileCleanup.error}`)
    }

    // 6. Update database
    result.operations.databaseUpdate.attempted = true
    try {
      await this.prisma.department.update({
        where: { id: departmentId },
        data: {
          bridgeName: null,
          gatewayIP: null,
          dhcpRangeStart: null,
          dhcpRangeEnd: null,
          dnsmasqPid: null
        }
      })
      result.operations.databaseUpdate.success = true
    } catch (error) {
      result.operations.databaseUpdate.error = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Force destroy: database update failed: ${result.operations.databaseUpdate.error}`)
    }

    // 7. Clean up system files if last department
    result.operations.systemFilesCleanup.attempted = true
    try {
      await this.cleanupSystemFilesIfLastDepartment()
      result.operations.systemFilesCleanup.success = true
    } catch (error) {
      result.operations.systemFilesCleanup.error = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Force destroy: system files cleanup failed: ${result.operations.systemFilesCleanup.error}`)
    }

    // Determine overall success - all attempted operations must succeed
    const allOps = [
      result.operations.tapDevicesCleanup,
      result.operations.dnsmasqStop,
      result.operations.natRemoval,
      result.operations.bridgeDestruction,
      result.operations.fileCleanup,
      result.operations.databaseUpdate,
      result.operations.systemFilesCleanup
    ]
    // Only consider operations that were attempted
    result.success = allOps.every(op => !op.attempted || op.success)

    debug.log('info', `Force destroy completed for department ${departmentId}: success=${result.success}`)
    return result
  }

  /**
   * Rolls back partial network configuration on failure.
   */
  private async rollback (
    config: SubnetConfig,
    created: { bridge: boolean; ip: boolean; dnsmasq: boolean; nat: boolean }
  ): Promise<void> {
    debug.log('info', `Rolling back network configuration for ${config.bridgeName}`)

    if (created.nat) {
      try {
        await this.natService.removeMasquerade(config.bridgeName)
      } catch (e) {
        debug.log('error', `Rollback: Failed to remove NAT: ${e}`)
      }
    }

    if (created.dnsmasq) {
      // Try to kill dnsmasq by name
      try {
        execSync(`pkill -f "dnsmasq.*${config.bridgeName}"`, { stdio: 'pipe' })
      } catch {
        // Ignore
      }
    }

    if (created.bridge) {
      try {
        await this.bridgeManager.destroy(config.bridgeName)
      } catch (e) {
        debug.log('error', `Rollback: Failed to destroy bridge: ${e}`)
      }
    }

    // Clean up any config files
    await this.cleanupConfigFiles(config.bridgeName)
  }

  // ===========================================================================
  // Private Diagnostic Helper Methods
  // ===========================================================================

  /**
   * Checks the status of a bridge interface.
   */
  private async checkBridgeStatus (bridgeName: string): Promise<BridgeDiagnostics> {
    const result: BridgeDiagnostics = {
      exists: false,
      isUp: false,
      ipAddresses: [],
      attachedInterfaces: []
    }

    try {
      // Check if bridge exists
      result.exists = await this.bridgeManager.exists(bridgeName)

      if (!result.exists) {
        return result
      }

      // Get IP addresses
      result.ipAddresses = await this.bridgeManager.getIPs(bridgeName)

      // Get attached interfaces
      result.attachedInterfaces = await this.bridgeManager.listInterfaces(bridgeName)

      // Get detailed status from ip command
      try {
        const ipOutput = execSync(`ip -details link show ${bridgeName}`, { encoding: 'utf8', stdio: 'pipe' })

        // Check if UP (admin state)
        // Bridge can be administratively UP but operationally DOWN (no carrier/no VMs attached)
        // We consider it "up" if the admin flag is set: <...,UP> or <UP,...> or state UP
        result.isUp = ipOutput.includes('state UP') || ipOutput.includes(',UP>') || ipOutput.includes(',UP,') || ipOutput.includes('<UP,')

        // Extract MTU
        const mtuMatch = ipOutput.match(/mtu\s+(\d+)/)
        if (mtuMatch) {
          result.mtu = parseInt(mtuMatch[1], 10)
        }

        // Extract state
        const stateMatch = ipOutput.match(/state\s+(\w+)/)
        if (stateMatch) {
          result.state = stateMatch[1]
        }
      } catch (error) {
        debug.log('warn', `Failed to get detailed bridge status: ${error}`)
      }
    } catch (error) {
      debug.log('warn', `Failed to check bridge status for ${bridgeName}: ${error}`)
    }

    return result
  }

  /**
   * Checks the status of dnsmasq for a department.
   */
  private async checkDnsmasqStatus (
    department: Department,
    configPath: string,
    leasePath: string,
    logPath: string
  ): Promise<DnsmasqDiagnostics> {
    const result: DnsmasqDiagnostics = {
      isRunning: false,
      pidMatches: false,
      configPath,
      configExists: false,
      leasePath,
      leaseFileExists: false,
      logPath,
      logExists: false,
      listeningPort: false
    }

    try {
      // Check if config file exists
      try {
        await fs.access(configPath)
        result.configExists = true
      } catch {
        result.configExists = false
      }

      // Check if lease file exists
      try {
        await fs.access(leasePath)
        result.leaseFileExists = true
      } catch {
        result.leaseFileExists = false
      }

      // Check if log file exists
      try {
        await fs.access(logPath)
        result.logExists = true

        // Read last 50 lines of log
        try {
          const logContent = execSync(`tail -50 ${logPath}`, { encoding: 'utf8', stdio: 'pipe' })
          result.recentLogLines = logContent.split('\n').filter(line => line.trim() !== '')
        } catch {
          // Ignore read errors
        }
      } catch {
        result.logExists = false
      }

      // Check if process is running using stored PID
      if (department.dnsmasqPid) {
        result.pid = department.dnsmasqPid
        try {
          process.kill(department.dnsmasqPid, 0)
          result.isRunning = true
          result.pidMatches = true
        } catch {
          // Process not running
          result.isRunning = false
          result.pidMatches = false
        }
      }

      // Check if any dnsmasq is running for this bridge
      if (!result.isRunning && department.bridgeName) {
        try {
          const psOutput = execSync(`pgrep -f "dnsmasq.*${department.bridgeName}" || true`, { encoding: 'utf8', stdio: 'pipe' })
          if (psOutput.trim()) {
            result.isRunning = true
            result.pidMatches = false // Running but PID doesn't match stored
            const foundPid = parseInt(psOutput.trim().split('\n')[0], 10)
            if (!isNaN(foundPid)) {
              result.pid = foundPid
            }
          }
        } catch {
          // Ignore
        }
      }

      // Check if listening on port 67
      try {
        const ssOutput = execSync('ss -ulnp | grep :67 || true', { encoding: 'utf8', stdio: 'pipe' })
        result.listeningPort = ssOutput.includes(':67')
      } catch {
        // Ignore
      }
    } catch (error) {
      debug.log('warn', `Failed to check dnsmasq status: ${error}`)
    }

    return result
  }

  /**
   * Checks the status of br_netfilter kernel module and sysctls.
   */
  private async checkBrNetfilter (): Promise<BrNetfilterDiagnostics> {
    const result: BrNetfilterDiagnostics = {
      moduleLoaded: false,
      callIptables: -1,
      callIp6tables: -1,
      callArptables: -1,
      persistenceFileExists: false
    }

    try {
      // Check if module is loaded
      result.moduleLoaded = this.isModuleLoaded('br_netfilter')

      // Read sysctl values
      try {
        const iptablesOutput = execSync('sysctl -n net.bridge.bridge-nf-call-iptables 2>/dev/null || echo -1', { encoding: 'utf8', stdio: 'pipe' })
        result.callIptables = parseInt(iptablesOutput.trim(), 10)
      } catch {
        result.callIptables = -1
      }

      try {
        const ip6tablesOutput = execSync('sysctl -n net.bridge.bridge-nf-call-ip6tables 2>/dev/null || echo -1', { encoding: 'utf8', stdio: 'pipe' })
        result.callIp6tables = parseInt(ip6tablesOutput.trim(), 10)
      } catch {
        result.callIp6tables = -1
      }

      try {
        const arptablesOutput = execSync('sysctl -n net.bridge.bridge-nf-call-arptables 2>/dev/null || echo -1', { encoding: 'utf8', stdio: 'pipe' })
        result.callArptables = parseInt(arptablesOutput.trim(), 10)
      } catch {
        result.callArptables = -1
      }

      // Check persistence file
      try {
        await fs.access(MODULES_LOAD_FILE)
        result.persistenceFileExists = true
      } catch {
        result.persistenceFileExists = false
      }
    } catch (error) {
      debug.log('warn', `Failed to check br_netfilter status: ${error}`)
    }

    return result
  }

  /**
   * Checks the status of NAT rules for a bridge.
   */
  private async checkNatStatus (bridgeName: string, subnet: string): Promise<NatDiagnostics> {
    const result: NatDiagnostics = {
      ruleExists: false,
      tableExists: false,
      chainExists: false,
      ipForwardingEnabled: false
    }

    try {
      // Check if masquerade rule exists
      result.ruleExists = await this.natService.hasMasquerade(bridgeName)

      // Check nft table and chain
      try {
        const nftOutput = execSync('nft list chain ip infinibay_nat postrouting 2>/dev/null || true', { encoding: 'utf8', stdio: 'pipe' })
        result.tableExists = nftOutput.includes('infinibay_nat')
        result.chainExists = nftOutput.includes('postrouting')
        if (nftOutput.trim()) {
          result.ruleDetails = nftOutput.trim()
        }
      } catch {
        // Table/chain doesn't exist
      }

      // Check IP forwarding
      try {
        const forwardOutput = execSync('sysctl -n net.ipv4.ip_forward', { encoding: 'utf8', stdio: 'pipe' })
        result.ipForwardingEnabled = forwardOutput.trim() === '1'
      } catch {
        result.ipForwardingEnabled = false
      }
    } catch (error) {
      debug.log('warn', `Failed to check NAT status: ${error}`)
    }

    return result
  }

  /**
   * Finds the QEMU process that owns a TAP device by scanning /proc/{pid}/fd.
   * Returns process info if found, undefined otherwise.
   */
  private findQemuProcessForTap (tapName: string): QemuProcessInfo | undefined {
    try {
      // Use lsof to find processes with the TAP device open
      // lsof output format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
      const lsofOutput = execSync(`lsof /dev/net/tun 2>/dev/null || true`, { encoding: 'utf8', stdio: 'pipe' })

      if (!lsofOutput.trim()) {
        return undefined
      }

      // Parse lsof output to find QEMU processes
      const lines = lsofOutput.trim().split('\n')
      for (const line of lines) {
        if (line.startsWith('COMMAND')) continue // Skip header

        const parts = line.split(/\s+/)
        if (parts.length < 2) continue

        const command = parts[0]
        const pid = parseInt(parts[1], 10)

        // Check if this is a QEMU process
        if (!command.toLowerCase().includes('qemu')) continue

        // Verify this QEMU process owns this specific TAP device by checking its cmdline
        try {
          const cmdline = execSync(`cat /proc/${pid}/cmdline 2>/dev/null | tr '\\0' ' ' || true`, { encoding: 'utf8', stdio: 'pipe' })
          if (cmdline.includes(tapName)) {
            return { pid, command: cmdline.trim().substring(0, 200) } // Truncate long commands
          }
        } catch {
          // Process may have exited
          continue
        }
      }

      // Alternative: scan /proc/*/fd for the TAP device
      try {
        const procOutput = execSync(`ls -la /proc/*/fd 2>/dev/null | grep -E "net/tun" || true`, { encoding: 'utf8', stdio: 'pipe' })
        const procLines = procOutput.trim().split('\n')

        for (const procLine of procLines) {
          // Extract PID from path like /proc/12345/fd/6
          const pidMatch = procLine.match(/\/proc\/(\d+)\/fd/)
          if (!pidMatch) continue

          const pid = parseInt(pidMatch[1], 10)

          // Get the command name
          try {
            const comm = execSync(`cat /proc/${pid}/comm 2>/dev/null || true`, { encoding: 'utf8', stdio: 'pipe' }).trim()
            if (!comm.toLowerCase().includes('qemu')) continue

            // Check if this QEMU process references this TAP device
            const cmdline = execSync(`cat /proc/${pid}/cmdline 2>/dev/null | tr '\\0' ' ' || true`, { encoding: 'utf8', stdio: 'pipe' })
            if (cmdline.includes(tapName)) {
              return { pid, command: cmdline.trim().substring(0, 200) }
            }
          } catch {
            continue
          }
        }
      } catch {
        // Fallback failed, return undefined
      }

      return undefined
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Failed to find QEMU process for TAP ${tapName}: ${errorMessage}`)
      return undefined
    }
  }

  /**
   * Checks the status of TAP devices attached to a bridge and system-wide orphaned devices.
   * Detects orphaned devices, carrier status, QEMU process ownership, and unbridged devices.
   */
  private async checkTapDevicesStatus (bridgeName: string): Promise<TapDevicesDiagnostics> {
    const result: TapDevicesDiagnostics = {
      totalDevices: 0,
      devicesWithCarrier: 0,
      orphanedDevices: 0,
      devicesWithoutCarrier: 0,
      devicesWithoutQemuProcess: 0,
      unbridgedOrphanedDevices: 0,
      devices: []
    }

    const tapManager = new TapDeviceManager()
    const processedDevices = new Set<string>()

    try {
      // Step 1: Get all interfaces connected to the bridge
      const bridgedInterfaces = await this.bridgeManager.listInterfaces(bridgeName)

      // Filter only TAP devices (vnet-* or tap-* prefixes)
      const bridgedTapDevices = bridgedInterfaces.filter(iface => iface.startsWith('vnet-') || iface.startsWith('tap-'))

      // Step 2: Process bridged TAP devices
      for (const tapName of bridgedTapDevices) {
        processedDevices.add(tapName)

        try {
          const hasCarrier = await tapManager.hasCarrier(tapName)
          const isOrphaned = await tapManager.isOrphaned(tapName)
          const deviceStateOutput = await tapManager.getDeviceState(tapName)

          // Extract state from ip link show output (e.g., "state UP" or "state DOWN")
          const stateMatch = deviceStateOutput.match(/state\s+(\w+)/)
          const state = stateMatch ? stateMatch[1] : 'UNKNOWN'

          // Find QEMU process that owns this TAP device
          const qemuProcess = this.findQemuProcessForTap(tapName)

          // connectedToQemu is now based on explicit process linkage, not just carrier
          const connectedToQemu = qemuProcess !== undefined

          const deviceInfo: TapDeviceInfo = {
            name: tapName,
            hasCarrier,
            isOrphaned,
            state,
            connectedToQemu,
            qemuProcess,
            attachedToBridge: true
          }

          result.devices.push(deviceInfo)

          // Update counters
          if (hasCarrier) {
            result.devicesWithCarrier++
          }
          if (isOrphaned) {
            result.orphanedDevices++
          }
          if (!hasCarrier && !isOrphaned) {
            result.devicesWithoutCarrier++
          }
          if (!connectedToQemu) {
            result.devicesWithoutQemuProcess++
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          debug.log('warn', `Failed to check TAP device ${tapName}: ${errorMessage}`)

          // Add device with unknown state
          result.devices.push({
            name: tapName,
            hasCarrier: false,
            isOrphaned: false,
            state: 'ERROR',
            connectedToQemu: false,
            attachedToBridge: true
          })
          result.devicesWithoutCarrier++
          result.devicesWithoutQemuProcess++
        }
      }

      // Step 3: Scan system-wide TAP devices not attached to this bridge
      const allSystemTapDevices = await tapManager.listAllTapDevices()

      for (const tapName of allSystemTapDevices) {
        // Skip devices already processed (attached to bridge)
        if (processedDevices.has(tapName)) {
          continue
        }

        try {
          const hasCarrier = await tapManager.hasCarrier(tapName)
          const isOrphaned = await tapManager.isOrphaned(tapName)
          const deviceStateOutput = await tapManager.getDeviceState(tapName)

          // Extract state from ip link show output
          const stateMatch = deviceStateOutput.match(/state\s+(\w+)/)
          const state = stateMatch ? stateMatch[1] : 'UNKNOWN'

          // Find QEMU process that owns this TAP device
          const qemuProcess = this.findQemuProcessForTap(tapName)
          const connectedToQemu = qemuProcess !== undefined

          // Only include unbridged devices that are orphaned (persist on, no carrier)
          if (isOrphaned) {
            const deviceInfo: TapDeviceInfo = {
              name: tapName,
              hasCarrier,
              isOrphaned: true,
              state,
              connectedToQemu,
              qemuProcess,
              attachedToBridge: false
            }

            result.devices.push(deviceInfo)
            result.unbridgedOrphanedDevices++
            result.orphanedDevices++

            if (!connectedToQemu) {
              result.devicesWithoutQemuProcess++
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          debug.log('warn', `Failed to check unbridged TAP device ${tapName}: ${errorMessage}`)
        }
      }

      // Update total count
      result.totalDevices = result.devices.length

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      debug.log('warn', `Failed to check TAP devices status for ${bridgeName}: ${errorMessage}`)
    }

    return result
  }

  /**
   * Generates recommendations based on diagnostic findings.
   */
  private generateRecommendations (
    bridge: BridgeDiagnostics,
    dnsmasq: DnsmasqDiagnostics,
    brNetfilter: BrNetfilterDiagnostics,
    nat: NatDiagnostics,
    tapDevices: TapDevicesDiagnostics,
    bridgeName: string
  ): string[] {
    const recommendations: string[] = []

    // Bridge checks
    if (!bridge.exists) {
      recommendations.push(`Bridge ${bridgeName} does not exist. Run configureNetwork() to create it.`)
    } else if (!bridge.isUp) {
      recommendations.push(`Bridge ${bridgeName} is DOWN. Run: ip link set ${bridgeName} up`)
    }

    if (bridge.exists && bridge.ipAddresses.length === 0) {
      recommendations.push(`Bridge ${bridgeName} has no IP address. The gateway IP should be assigned.`)
    }

    // dnsmasq checks
    if (!dnsmasq.configExists) {
      recommendations.push(`dnsmasq config file missing at ${dnsmasq.configPath}. Run configureNetwork() to recreate.`)
    }

    if (!dnsmasq.isRunning) {
      recommendations.push('dnsmasq is not running. VMs will not get DHCP addresses. Restart the network service.')
    } else if (!dnsmasq.pidMatches) {
      recommendations.push('dnsmasq PID in database does not match running process. Update database or restart dnsmasq.')
    }

    if (!dnsmasq.listeningPort) {
      recommendations.push('dnsmasq is not listening on port 67. DHCP will not work. Check for port conflicts.')
    }

    // br_netfilter checks
    if (!brNetfilter.moduleLoaded) {
      recommendations.push('br_netfilter module not loaded. DHCP may be blocked. Run: modprobe br_netfilter')
    }

    if (brNetfilter.callIptables !== 0) {
      recommendations.push('net.bridge.bridge-nf-call-iptables is not 0. DHCP traffic may be filtered. Run: sysctl -w net.bridge.bridge-nf-call-iptables=0')
    }

    if (!brNetfilter.persistenceFileExists) {
      recommendations.push(`Module persistence file missing at ${MODULES_LOAD_FILE}. br_netfilter may not load on reboot.`)
    }

    // NAT checks
    if (!nat.ruleExists) {
      recommendations.push(`NAT masquerade rule missing for ${bridgeName}. VMs will not have internet access.`)
    }

    if (!nat.tableExists || !nat.chainExists) {
      recommendations.push('nftables table/chain for NAT not found. Run natService.initialize() to create.')
    }

    if (!nat.ipForwardingEnabled) {
      recommendations.push('IP forwarding is disabled. VMs will not have internet access. Run: sysctl -w net.ipv4.ip_forward=1')
    }

    // TAP devices checks
    if (tapDevices.orphanedDevices > 0) {
      recommendations.push(
        `Found ${tapDevices.orphanedDevices} orphaned TAP device(s) with persist flag and no carrier. ` +
        `These should be cleaned up: ${tapDevices.devices.filter(d => d.isOrphaned).map(d => d.name).join(', ')}`
      )
    }

    if (tapDevices.devicesWithoutCarrier > 0) {
      const devicesWithoutCarrier = tapDevices.devices.filter(d => !d.hasCarrier && !d.isOrphaned && d.attachedToBridge)
      if (devicesWithoutCarrier.length > 0) {
        recommendations.push(
          `Found ${devicesWithoutCarrier.length} TAP device(s) without carrier (QEMU not connected): ` +
          `${devicesWithoutCarrier.map(d => d.name).join(', ')}. ` +
          `VMs using these TAP devices will have no network connectivity. ` +
          `Check if QEMU processes are running and properly attached to TAP devices.`
        )
      }
    }

    // Devices without QEMU process ownership (regardless of carrier)
    if (tapDevices.devicesWithoutQemuProcess > 0) {
      const devicesWithoutQemu = tapDevices.devices.filter(d => !d.connectedToQemu)
      if (devicesWithoutQemu.length > 0) {
        const bridgedWithoutQemu = devicesWithoutQemu.filter(d => d.attachedToBridge)
        if (bridgedWithoutQemu.length > 0) {
          recommendations.push(
            `Found ${bridgedWithoutQemu.length} TAP device(s) on ${bridgeName} with no owning QEMU process: ` +
            `${bridgedWithoutQemu.map(d => d.name).join(', ')}. ` +
            `These devices may be stale from crashed VMs. ` +
            `Run 'lsof /dev/net/tun' and check /proc/*/cmdline to verify QEMU attachment.`
          )
        }
      }
    }

    // Unbridged orphaned devices (system-wide scan)
    if (tapDevices.unbridgedOrphanedDevices > 0) {
      const unbridgedOrphaned = tapDevices.devices.filter(d => !d.attachedToBridge && d.isOrphaned)
      if (unbridgedOrphaned.length > 0) {
        recommendations.push(
          `Found ${unbridgedOrphaned.length} orphaned TAP device(s) NOT attached to any bridge: ` +
          `${unbridgedOrphaned.map(d => d.name).join(', ')}. ` +
          `These devices have 'persist on' flag but no carrier and are not bridged. ` +
          `They should be cleaned up with 'ip link delete <device>'.`
        )
      }
    }

    if (tapDevices.totalDevices === 0 && bridge.exists) {
      recommendations.push(
        `No TAP devices found on bridge ${bridgeName}. ` +
        `If VMs should be running, check VM status and TAP device creation.`
      )
    }

    if (tapDevices.totalDevices > 0 && tapDevices.devicesWithCarrier === 0) {
      recommendations.push(
        `All TAP devices on ${bridgeName} have NO-CARRIER status. ` +
        `This indicates QEMU processes are not connected to their TAP devices. ` +
        `Possible causes: VMs not running, QEMU startup failure, permission issues on /dev/net/tun.`
      )
    }

    if (recommendations.length === 0) {
      recommendations.push('All network components appear to be functioning correctly.')
    }

    return recommendations
  }

  /**
   * Generates manual debugging commands for network troubleshooting.
   */
  private generateManualCommands (bridgeName: string, logPath: string, tapDevices: TapDevicesDiagnostics): string[] {
    const commands = [
      '# Verificar estado del bridge',
      `ip addr show ${bridgeName}`,
      'bridge link show',
      '',
      '# Verificar dispositivos TAP',
      'ip link show type tuntap',
      `bridge link show | grep ${bridgeName}`,
      '',
      '# Verificar dnsmasq',
      `ps aux | grep dnsmasq | grep ${bridgeName}`,
      'ss -ulnp | grep :67',
      `tail -50 ${logPath}`,
      '',
      '# Verificar br_netfilter',
      'lsmod | grep br_netfilter',
      'sysctl net.bridge.bridge-nf-call-iptables',
      `cat ${MODULES_LOAD_FILE}`,
      '',
      '# Verificar NAT',
      'nft list ruleset | grep infinibay',
      'sysctl net.ipv4.ip_forward',
      '',
      '# Capturar tráfico DHCP',
      `tcpdump -i ${bridgeName} -n port 67 or port 68 -v`
    ]

    // Add commands for specific TAP devices if found
    if (tapDevices.devices.length > 0) {
      commands.push('', '# Verificar estado de TAP devices específicos')
      for (const device of tapDevices.devices) {
        commands.push(`ip -d link show ${device.name}`)
      }

      commands.push('', '# Verificar propiedad de procesos QEMU sobre TAP devices')
      commands.push('lsof /dev/net/tun 2>/dev/null')
      commands.push('')
      commands.push('# Buscar procesos QEMU y verificar sus TAP devices')
      commands.push('for pid in $(pgrep -f qemu); do echo "=== PID $pid ==="; cat /proc/$pid/cmdline 2>/dev/null | tr "\\0" " "; echo; done')
      commands.push('')
      commands.push('# Verificar file descriptors de QEMU apuntando a /dev/net/tun')
      commands.push('ls -la /proc/*/fd 2>/dev/null | grep net/tun')

      // Add specific commands for devices without QEMU process
      const devicesWithoutQemu = tapDevices.devices.filter(d => !d.connectedToQemu)
      if (devicesWithoutQemu.length > 0) {
        commands.push('', '# TAP devices sin proceso QEMU propietario detectados:')
        for (const device of devicesWithoutQemu) {
          commands.push(`# - ${device.name} (bridged: ${device.attachedToBridge}, carrier: ${device.hasCarrier}, orphaned: ${device.isOrphaned})`)
        }
        commands.push('# Para limpiar dispositivos huérfanos:')
        for (const device of devicesWithoutQemu.filter(d => d.isOrphaned)) {
          commands.push(`# ip link delete ${device.name}`)
        }
      }

      // Add info for devices with QEMU process
      const devicesWithQemu = tapDevices.devices.filter(d => d.connectedToQemu && d.qemuProcess)
      if (devicesWithQemu.length > 0) {
        commands.push('', '# TAP devices con proceso QEMU propietario:')
        for (const device of devicesWithQemu) {
          commands.push(`# - ${device.name}: PID ${device.qemuProcess!.pid}`)
        }
      }

      // Add commands for unbridged orphaned devices
      const unbridgedOrphaned = tapDevices.devices.filter(d => !d.attachedToBridge && d.isOrphaned)
      if (unbridgedOrphaned.length > 0) {
        commands.push('', '# Dispositivos TAP huérfanos NO conectados al bridge:')
        for (const device of unbridgedOrphaned) {
          commands.push(`# - ${device.name} (should be cleaned up)`)
          commands.push(`# ip link delete ${device.name}`)
        }
      }
    }

    return commands
  }
}
