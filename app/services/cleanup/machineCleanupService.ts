import { PrismaClient, RuleSetType } from '@prisma/client'
import { Connection, Machine as VirtualMachine } from '@infinibay/libvirt-node'
import * as libvirtNode from '@infinibay/libvirt-node'

import { Debugger } from '../../utils/debug'
import { getVirtioSocketWatcherService } from '../VirtioSocketWatcherService'
import { NWFilterXMLGeneratorService } from '../firewall/NWFilterXMLGeneratorService'
import { XMLGenerator } from '../../utils/VirtManager/xmlGenerator'

import { existsSync, unlinkSync } from 'fs'
import path from 'path'

// Access NWFilter from module to work around TypeScript typing
const NWFilter = (libvirtNode as any).NWFilter

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
        configuration: true
      }
    })
    if (!machine) {
      this.debug.log(`Machine ${machineId} not found`)
      return
    }

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
          try {
            await domain.destroy()
          } catch (e) {
            this.debug.log(`Error destroying domain ${machine.internalName}: ${String(e)}`)
          }
        }

        // Delete VM-related files
        for (const file of filesToDelete) {
          if (existsSync(file)) {
            try {
              unlinkSync(file)
            } catch (e) {
              this.debug.log(`Error deleting file ${file}: ${String(e)}`)
            }
          }
        }

        // Undefine VM domain
        if (domain) {
          try {
            await domain.undefine()
          } catch (e) {
            this.debug.log(`Error undefining domain ${machine.internalName}: ${String(e)}`)
          }
        }

        // Clean up VM's nwfilter
        await this.cleanupVMFirewallFilter(conn, machineId)
      }
    } catch (e) {
      this.debug.log(`Error cleaning up libvirt resources: ${String(e)}`)
    } finally {
      if (conn) {
        try {
          conn.close()
        } catch (e) {
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
        // Delete machine configuration
        if (machine.configuration) {
          await tx.machineConfiguration.delete({ where: { machineId: machine.id } })
        }

        // Delete machine applications
        await tx.machineApplication.deleteMany({ where: { machineId: machine.id } })

        // Delete firewall rules and ruleset
        await this.cleanupFirewallRuleSet(tx, machineId)

        // Delete machine
        await tx.machine.delete({ where: { id: machine.id } })

        this.debug.log(`Successfully cleaned up VM ${machineId}`)
      } catch (e) {
        this.debug.log(`Error removing DB records: ${String(e)}`)
        throw e
      }
    })
  }

  /**
   * Cleans up the VM's nwfilter from libvirt
   * @param conn - Libvirt connection
   * @param vmId - VM ID
   */
  private async cleanupVMFirewallFilter (conn: Connection, vmId: string): Promise<void> {
    try {
      const xmlGenerator = new NWFilterXMLGeneratorService()
      const filterName = xmlGenerator.generateFilterName(RuleSetType.VM, vmId)

      // Try to lookup and undefine the filter
      const filter = NWFilter.lookupByName(conn, filterName)

      if (filter) {
        try {
          filter.undefine()
          this.debug.log(`Successfully removed nwfilter ${filterName}`)
        } catch (e) {
          this.debug.log(`Error undefining nwfilter ${filterName}: ${String(e)}`)
        }
      } else {
        this.debug.log(`NWFilter ${filterName} not found (may have been already deleted)`)
      }
    } catch (e) {
      // Filter doesn't exist or error looking it up - not critical
      this.debug.log(`Note: Could not cleanup nwfilter for VM ${vmId}: ${String(e)}`)
    }
  }

  /**
   * Cleans up the VM's FirewallRuleSet and all associated rules from database
   * @param tx - Prisma transaction client
   * @param vmId - VM ID
   */
  private async cleanupFirewallRuleSet (tx: any, vmId: string): Promise<void> {
    try {
      // Find VM's firewall rule set
      const vm = await tx.machine.findUnique({
        where: { id: vmId },
        include: {
          firewallRuleSet: {
            include: {
              rules: true
            }
          }
        }
      })

      if (vm?.firewallRuleSet) {
        const ruleSetId = vm.firewallRuleSet.id

        // Delete all rules in the rule set
        await tx.firewallRule.deleteMany({
          where: { ruleSetId }
        })

        // Delete the rule set itself
        await tx.firewallRuleSet.delete({
          where: { id: ruleSetId }
        })

        this.debug.log(`Cleaned up FirewallRuleSet ${ruleSetId} with ${vm.firewallRuleSet.rules.length} rules`)
      }
    } catch (e) {
      this.debug.log(`Error cleaning up FirewallRuleSet: ${String(e)}`)
      // Don't throw - allow VM deletion to proceed even if firewall cleanup fails
    }
  }
}
