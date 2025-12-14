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
import { BridgeManager, DepartmentNatService } from '@infinibay/infinivirt'
import { spawn, ChildProcess, execSync } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import { Debugger } from '../../utils/debug'

const debug = new Debugger('dept-network')

/** Configuration directories */
const DNSMASQ_CONFIG_DIR = '/etc/infinibay/dnsmasq.d'
const DNSMASQ_RUN_DIR = '/opt/infinibay/run/dnsmasq'
const DNSMASQ_LOG_DIR = '/var/log/infinibay'

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
}

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
      // 3. Create bridge
      await this.bridgeManager.create(config.bridgeName)
      created.bridge = true
      debug.log('info', `Created bridge: ${config.bridgeName}`)

      // 4. Assign gateway IP to bridge
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
   * Stops dnsmasq, removes NAT, and destroys bridge.
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

    // 1. Stop dnsmasq
    if (department.dnsmasqPid) {
      await this.stopDnsmasq(department.dnsmasqPid)
    }

    // 2. Remove NAT
    await this.natService.removeMasquerade(department.bridgeName)

    // 3. Destroy bridge
    await this.bridgeManager.destroy(department.bridgeName)

    // 4. Clean up config files
    await this.cleanupConfigFiles(department.bridgeName)

    // 5. Update database
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
    const dirs = [DNSMASQ_CONFIG_DIR, DNSMASQ_RUN_DIR, DNSMASQ_LOG_DIR]
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true })
    }
  }

  /**
   * Starts dnsmasq for DHCP on a bridge.
   */
  private async startDnsmasq (config: SubnetConfig): Promise<number> {
    const configPath = path.join(DNSMASQ_CONFIG_DIR, `${config.bridgeName}.conf`)
    const pidPath = path.join(DNSMASQ_RUN_DIR, `${config.bridgeName}.pid`)
    const leasePath = path.join(DNSMASQ_RUN_DIR, `${config.bridgeName}.leases`)
    const logPath = path.join(DNSMASQ_LOG_DIR, `dnsmasq-${config.bridgeName}.log`)

    // Create config file
    const configContent = `# Infinibay dnsmasq config for ${config.bridgeName}
# Auto-generated - do not edit manually

interface=${config.bridgeName}
except-interface=lo
bind-interfaces

# DHCP configuration
dhcp-range=${config.dhcpStart},${config.dhcpEnd},24h
dhcp-option=option:router,${config.gatewayIP}
dhcp-option=option:dns-server,8.8.8.8,8.8.4.4

# Lease file
dhcp-leasefile=${leasePath}

# Logging
log-facility=${logPath}
log-dhcp
`
    await fs.writeFile(configPath, configContent)
    debug.log('info', `Created dnsmasq config: ${configPath}`)

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

      return pid
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to start dnsmasq: ${errorMessage}`)
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

      const newPid = await this.startDnsmasq(config)
      await this.prisma.department.update({
        where: { id: dept.id },
        data: { dnsmasqPid: newPid }
      })
    }
  }

  /**
   * Cleans up configuration files for a bridge.
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
}
