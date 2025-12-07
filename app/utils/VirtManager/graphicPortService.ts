/**
 * GraphicPortService
 *
 * This service retrieves graphics port information for VMs.
 * With infinivirt, graphics configuration is stored in MachineConfiguration
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
import { getInfinivirt } from '@services/InfinivirtService'

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

          // Check if protocol matches
          if (storedProtocol === type.toLowerCase() && config.graphicPort) {
            this.debug.log(`Found ${type} port from DB: ${config.graphicPort}`)
            return config.graphicPort
          }
        }
      }

      // Fallback: Check if VM is running and try to get port from infinivirt
      try {
        const infinivirt = await getInfinivirt()

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
          const status = await infinivirt.getVMStatus(machineId)
          if (status.processAlive) {
            // VM is running but we couldn't get port from DB
            // This shouldn't happen normally as port is set during creation
            this.debug.log('warn', `VM ${domainName} is running but no port in DB`)
          }
        }
      } catch {
        // Ignore infinivirt errors, just return -1
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
   * @returns Graphics configuration or null.
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
      return {
        port: config.graphicPort ?? -1,
        protocol: config.graphicProtocol ?? 'spice',
        password: config.graphicPassword ?? null,
        host: config.graphicHost ?? '0.0.0.0'
      }
    } catch (error) {
      this.debug.log('error', `Failed to get graphic config: ${error}`)
      return null
    }
  }
}

// Export a factory function for backward compatibility
export function createGraphicPortService (prisma: PrismaClient): GraphicPortService {
  return new GraphicPortService(prisma)
}
