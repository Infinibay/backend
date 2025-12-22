/**
 * GraphicPortService
 *
 * This service retrieves graphics port information for VMs.
 * With infinization, graphics configuration is stored in MachineConfiguration
 * during VM creation, so this service reads from the database.
 *
 * For running VMs, port information is set when the VM is created via
 * CreateMachineServiceV2 and stored in MachineConfiguration.
 *
 * Usage example:
 * ```
 * const graphicPortService = new GraphicPortService(prisma)
 * const port = await graphicPortService.getGraphicPort('vm-internal-name', 'spice')
 * console.log(`Graphics port: ${port}`)
 * ```
 */

import { PrismaClient } from '@prisma/client'
import { Debugger } from '@utils/debug'
import { getInfinization } from '@services/InfinizationService'

export class GraphicPortService {
  private debug: Debugger = new Debugger('graphic-port-service')
  private prisma: PrismaClient | null = null

  constructor (prisma?: PrismaClient) {
    this.prisma = prisma ?? null
  }

  /**
   * Retrieves the graphics port for a given VM.
   *
   * @param {string} domainName - The internal name of the VM.
   * @param {string} type - The graphics type ('spice' or 'vnc').
   * @returns {Promise<number>} - The port number, or -1 if not available.
   */
  async getGraphicPort (domainName: string, type: string): Promise<number> {
    this.debug.log(`Getting graphic port for domain: ${domainName}, type: ${type}`)

    try {
      // First, try to get from database
      if (this.prisma) {
        const machine = await this.prisma.machine.findFirst({
          where: { internalName: domainName },
          include: { configuration: true }
        })

        if (machine?.configuration) {
          const config = machine.configuration
          const storedProtocol = config.graphicProtocol?.toLowerCase()

          // Check if protocol matches and port is valid
          if (storedProtocol === type.toLowerCase()) {
            // Validate port explicitly - must be > 0 and <= 65535
            const port = config.graphicPort
            if (port !== null && port > 0 && port <= 65535) {
              this.debug.log(`Found valid ${type} port from DB: ${port}`)
              return port
            }

            // Check if configuration is corrupted (protocol set but port invalid)
            const validationError = this.validateGraphicConfig(config)
            if (validationError) {
              this.debug.log('warn', `Corrupted graphics config for ${domainName}: ${validationError}. Falling through to fallback path.`)
            }
          }
        }
      }

      // Fallback: Check if VM is running and try to get port from infinization
      try {
        const infinization = await getInfinization()

        // Find machine by internal name
        let machineId: string | null = null
        if (this.prisma) {
          const machine = await this.prisma.machine.findFirst({
            where: { internalName: domainName },
            select: { id: true }
          })
          machineId = machine?.id ?? null
        }

        if (machineId) {
          const status = await infinization.getVMStatus(machineId)
          if (status.processAlive) {
            // VM is running but we couldn't get port from DB
            // This shouldn't happen normally as port is set during creation
            this.debug.log('warn', `VM ${domainName} is running but no port in DB`)
          }
        }
      } catch {
        // Ignore infinization errors, just return -1
      }

      this.debug.log(`No ${type} port found for ${domainName}`)
      return -1
    } catch (error) {
      this.debug.log('error', `Failed to get graphic port: ${error}`)
      return -1
    }
  }

  /**
   * Gets complete graphics configuration for a VM.
   *
   * @param {string} domainName - The internal name of the VM.
   * @returns Graphics configuration or null if not configured or corrupted.
   */
  async getGraphicConfig (domainName: string): Promise<{
    port: number
    protocol: string
    password: string | null
    host: string
  } | null> {
    if (!this.prisma) {
      return null
    }

    try {
      const machine = await this.prisma.machine.findFirst({
        where: { internalName: domainName },
        include: { configuration: true }
      })

      if (!machine?.configuration) {
        return null
      }

      const config = machine.configuration

      // Return null if no graphics configuration was ever set
      // (both protocol and port are unset)
      const hasNoConfig = (config.graphicProtocol === null || config.graphicProtocol === undefined) &&
        (config.graphicPort === null || config.graphicPort === undefined)
      if (hasNoConfig) {
        this.debug.log(`No graphics configuration set for ${domainName}`)
        return null
      }

      // Validate configuration consistency
      // A valid configuration must have a port > 0 when protocol is set
      const isCorrupted = this.validateGraphicConfig(config)
      if (isCorrupted) {
        this.debug.log('warn', `Corrupted graphics config for ${domainName}: ${isCorrupted}`)
        return null
      }

      // Only return valid configuration with actual values
      // Don't synthesize defaults - if we got here, the config should be valid
      if (!config.graphicPort || config.graphicPort <= 0 || !config.graphicProtocol) {
        this.debug.log('warn', `Invalid graphics config values for ${domainName}: port=${config.graphicPort}, protocol=${config.graphicProtocol}`)
        return null
      }

      return {
        port: config.graphicPort,
        protocol: config.graphicProtocol,
        password: config.graphicPassword ?? null,
        host: config.graphicHost ?? '0.0.0.0'
      }
    } catch (error) {
      this.debug.log('error', `Failed to get graphic config: ${error}`)
      return null
    }
  }

  /**
   * Validates graphics configuration consistency.
   * Returns an error message if corrupted, null if valid.
   */
  private validateGraphicConfig (config: {
    graphicPort: number | null
    graphicProtocol: string | null
    graphicPassword: string | null
    graphicHost: string | null
  }): string | null {
    // If protocol is set but port is -1 or null, configuration is corrupted
    if (config.graphicProtocol && (config.graphicPort === null || config.graphicPort === -1)) {
      return `protocol=${config.graphicProtocol} but port=${config.graphicPort}`
    }

    // If port is set but out of valid range (typically 5900-65535)
    if (config.graphicPort !== null && config.graphicPort !== -1) {
      if (config.graphicPort < 1 || config.graphicPort > 65535) {
        return `port ${config.graphicPort} is out of valid range`
      }
    }

    return null
  }

  /**
   * Repairs a corrupted graphics port by assigning a new valid port.
   * This is a manual recovery method and should be used with caution.
   *
   * @param {string} vmId - The VM ID (not internal name).
   * @param {number} newPort - The new port to assign (optional, will auto-select if not provided).
   * @returns {Promise<{success: boolean, port?: number, error?: string}>}
   */
  async repairGraphicPort (vmId: string, newPort?: number): Promise<{
    success: boolean
    port?: number
    error?: string
  }> {
    if (!this.prisma) {
      return { success: false, error: 'Prisma client not available' }
    }

    try {
      const machine = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: { configuration: true }
      })

      if (!machine) {
        return { success: false, error: 'Machine not found' }
      }

      if (!machine.configuration) {
        return { success: false, error: 'Machine has no configuration to repair' }
      }

      // Determine the port to use
      let portToAssign: number | undefined = newPort
      if (!portToAssign) {
        // Auto-select an available port in SPICE range (5900-5999)
        const availablePort = await this.findAvailablePort()
        if (!availablePort) {
          return { success: false, error: 'Could not find available port in range 5900-5999' }
        }
        portToAssign = availablePort
      }

      // Validate port is not already in use
      const existingConfig = await this.prisma.machineConfiguration.findFirst({
        where: {
          graphicPort: portToAssign,
          id: { not: machine.configuration.id }
        }
      })

      if (existingConfig) {
        return { success: false, error: `Port ${portToAssign} is already in use by another VM` }
      }

      // Update the configuration
      await this.prisma.machineConfiguration.update({
        where: { id: machine.configuration.id },
        data: { graphicPort: portToAssign }
      })

      this.debug.log(`Repaired graphics port for VM ${vmId} (${machine.name}): assigned port ${portToAssign}`)

      return { success: true, port: portToAssign }
    } catch (error) {
      this.debug.log('error', `Failed to repair graphics port for VM ${vmId}: ${error}`)
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Finds an available port in the SPICE range (5900-5999).
   */
  private async findAvailablePort (): Promise<number | null> {
    if (!this.prisma) {
      return null
    }

    // Get all currently used ports
    const usedPorts = await this.prisma.machineConfiguration.findMany({
      where: {
        graphicPort: { gte: 5900, lte: 5999 }
      },
      select: { graphicPort: true }
    })

    const usedPortSet = new Set(usedPorts.map(c => c.graphicPort))

    // Find first available port in range
    for (let port = 5900; port <= 5999; port++) {
      if (!usedPortSet.has(port)) {
        return port
      }
    }

    return null
  }
}

// Export a factory function for backward compatibility
export function createGraphicPortService (prisma: PrismaClient): GraphicPortService {
  return new GraphicPortService(prisma)
}
