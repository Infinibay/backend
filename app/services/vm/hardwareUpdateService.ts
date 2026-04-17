import { PrismaClient } from '@prisma/client'
import { Logger } from 'winston'
import logger from '@main/logger'// TODO: This service needs to be migrated to use infinization instead of libvirt-node
// For now, hardware updates should be done by recreating the VM with new settings

/**
 * Service responsible for updating VM hardware configurations
 *
 * @deprecated This service used libvirt-node which has been replaced by infinization.
 * Hardware updates are not currently supported - VMs should be recreated with new settings.
 */
export class HardwareUpdateService {
  private prisma: PrismaClient
  private debug: Logger
  private machineId: string

  constructor (prisma: PrismaClient, machineId: string) {
    this.prisma = prisma
    this.machineId = machineId
    this.debug = logger.child({ module: 'hardware-update-service' })
  }

  /**
   * Main method to update VM hardware
   * @deprecated Hardware updates via libvirt are not currently supported.
   * VMs managed by infinization should be recreated with new settings.
   */
  async updateHardware (): Promise<void> {
    this.debug.warn(`Hardware update requested for ${this.machineId} but this feature is temporarily disabled`)
    this.debug.warn('VMs should be recreated with new hardware settings instead')

    // Update status to indicate the operation is not supported
    await this.prisma.machine.update({
      where: { id: this.machineId },
      data: { status: 'off' }
    })

    throw new Error('Hardware updates are temporarily disabled. Please delete and recreate the VM with new settings.')
  }
}
