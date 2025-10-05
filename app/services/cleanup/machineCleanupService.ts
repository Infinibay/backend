import { PrismaClient } from '@prisma/client'
import { Connection, Machine as VirtualMachine, NwFilter } from '@infinibay/libvirt-node'
import { XMLGenerator } from '../../utils/VirtManager/xmlGenerator'
import { Debugger } from '../../utils/debug'
import { unlinkSync, existsSync } from 'fs'
import { getVirtioSocketWatcherService } from '../VirtioSocketWatcherService'
import path from 'path'

export class MachineCleanupService {
  private prisma: PrismaClient
  private debug = new Debugger('machine-cleanup-service')

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
  }

  async cleanupVM (machineId: string): Promise<void> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      include: {
        configuration: true,
        nwFilters: { include: { nwFilter: true } }
      }
    })
    if (!machine) {
      this.debug.log(`Machine ${machineId} not found`)
      return
    }

    // Collect filter IDs for DB cleanup
    const filterIds = machine.nwFilters.map(vmf => vmf.nwFilter.id)

    // Prepare VM-related files for deletion
    let filesToDelete: string[] = []
    if (machine.configuration?.xml) {
      const xmlGen = new XMLGenerator('', '', '')
      xmlGen.load(machine.configuration.xml)

      // Get temp ISO directory path
      const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
      const tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR ?? path.join(baseDir, 'iso', 'temp')
      const permanentIsoDir = process.env.INFINIBAY_ISO_PERMANENT_DIR ?? path.join(baseDir, 'iso', 'permanent')

      filesToDelete = [
        xmlGen.getUefiVarFile(),
        ...xmlGen.getDisks()
      ].filter((file): file is string => {
        if (!file || !existsSync(file)) return false

        // Don't delete permanent ISOs (virtio-win, OS installation ISOs)
        if (file.includes(permanentIsoDir)) return false

        // Don't delete virtio drivers (legacy check for backward compatibility)
        if (file.includes('virtio')) return false

        // Only delete ISOs from temp directory
        if (file.endsWith('.iso') && !file.includes(tempIsoDir)) return false

        return true
      })
    }

    // Libvirt cleanup and resource removal
    let conn: Connection | null = null
    try {
      conn = Connection.open('qemu:///system')
      if (conn) {
        const domain = VirtualMachine.lookupByName(conn, machine.internalName)
        // Destroy VM domain
        if (domain) {
          try { await domain.destroy() } catch (e) {
            this.debug.log(`Error destroying domain ${machine.internalName}: ${String(e)}`)
          }
        }
        // Delete VM-related files
        for (const file of filesToDelete) {
          if (existsSync(file)) {
            try { unlinkSync(file) } catch (e) {
              this.debug.log(`Error deleting file ${file}: ${String(e)}`)
            }
          }
        }
        // Cleanup VM-specific filters in libvirt
        for (const vmf of machine.nwFilters) {
          try {
            const filter = await NwFilter.lookupByName(conn, vmf.nwFilter.internalName)
            if (filter) {
              await filter.undefine()
            }
          } catch (e) {
            this.debug.log(`Error undefining filter ${vmf.nwFilter.internalName}: ${String(e)}`)
          }
        }
        // Undefine VM domain
        if (domain) {
          try { await domain.undefine() } catch (e) {
            this.debug.log(`Error undefining domain ${machine.internalName}: ${String(e)}`)
          }
        }
      }
    } catch (e) {
      this.debug.log(`Error cleaning up libvirt resources: ${String(e)}`)
    } finally {
      if (conn) {
        try { conn.close() } catch (e) {
          this.debug.log(`Error closing libvirt connection: ${String(e)}`)
        }
      }
    }

    // Clean up VirtioSocket connection
    try {
      const virtioSocketWatcher = getVirtioSocketWatcherService()
      await virtioSocketWatcher.cleanupVmConnection(machine.id)
      this.debug.log(`Cleaned up VirtioSocket connection for machine ${machine.id}`)
    } catch (e) {
      // VirtioSocketWatcherService might not be initialized, which is fine
      this.debug.log(`Note: Could not clean up VirtioSocket connection: ${String(e)}`)
    }

    // Clean up InfiniService socket file
    try {
      const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
      const socketPath = path.join(baseDir, 'sockets', `${machine.id}.socket`)
      if (existsSync(socketPath)) {
        unlinkSync(socketPath)
        this.debug.log(`Removed InfiniService socket file: ${socketPath}`)
      }
    } catch (e) {
      this.debug.log(`Error removing InfiniService socket file: ${String(e)}`)
    }

    // Remove DB records in correct order
    await this.prisma.$transaction(async tx => {
      try {
        if (machine.configuration) {
          await tx.machineConfiguration.delete({ where: { machineId: machine.id } })
        }
        await tx.machineApplication.deleteMany({ where: { machineId: machine.id } })
        await tx.vMNWFilter.deleteMany({ where: { vmId: machine.id } })
        // Delete VM port records to satisfy foreign key constraint
        await tx.vmPort.deleteMany({ where: { vmId: machine.id } })
        // Delete VM-specific filters
        if (filterIds.length) {
          await tx.nWFilter.deleteMany({ where: { id: { in: filterIds } } })
        }
        await tx.machine.delete({ where: { id: machine.id } })
      } catch (e) {
        this.debug.log(`Error removing DB records: ${String(e)}`)
        throw e
      }
    })
  }
}
