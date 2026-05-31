import { PrismaClient } from '@prisma/client'
import { Logger } from 'winston'
import logger from '@main/logger'

/**
 * Service responsible for updating VM hardware configurations
 *
 * Hardware updates on running VMs require QEMU hotplug support (CPU, memory, disk).
 * Currently, hardware changes are applied on next VM restart via the standard
 * infinization startVM flow which reads the updated configuration from the database.
 *
 * For live hotplug operations, use VMLifecycle.updateHardware() in infinization.
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
   * Update VM hardware configuration.
   *
   * This method reads the machine's current configuration from the database
   * and schedules a hardware update. For running VMs, changes will be applied
   * on next restart. For stopped VMs, changes take effect on next start.
   */
  async updateHardware (): Promise<void> {
    this.debug.info(`Hardware update requested for ${this.machineId}`)

    // Check if VM is currently running
    const machine = await this.prisma.machine.findUnique({
      where: { id: this.machineId },
      select: { status: true, name: true }
    })

    if (!machine) {
      throw new Error(`Machine ${this.machineId} not found`)
    }

    if (machine.status === 'running') {
      // VM is running — hardware changes will be applied on next restart.
      // Infinization reads the latest DB config when starting a VM.
      this.debug.info(
        `Machine "${machine.name}" is running. Hardware changes will be applied on next restart. ` +
        'To apply immediately, stop and start the VM.'
      )
    } else {
      this.debug.info(
        `Machine "${machine.name}" is not running. Hardware changes will be applied on next start.`
      )
    }
  }
}
