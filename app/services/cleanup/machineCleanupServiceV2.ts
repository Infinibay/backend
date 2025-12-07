/**
 * MachineCleanupServiceV2 - VM cleanup using infinivirt.
 *
 * This service replaces the libvirt-based MachineCleanupService with
 * infinivirt, providing direct QEMU management.
 *
 * Key differences from V1:
 * - Uses infinivirt.stopVM() instead of libvirt domain destroy
 * - Uses infinivirt.deleteVM() for full cleanup (process, disks, firewall)
 * - No nwfilter cleanup needed (infinivirt uses nftables)
 * - Keeps database and VirtioSocket cleanup logic
 */

import { PrismaClient } from '@prisma/client'
import { existsSync, unlinkSync } from 'fs'
import path from 'path'

import { Debugger } from '../../utils/debug'
import { getInfinivirt } from '@services/InfinivirtService'
import { getVirtioSocketWatcherService } from '../VirtioSocketWatcherService'

export class MachineCleanupServiceV2 {
  private prisma: PrismaClient
  private debug = new Debugger('machine-cleanup-v2')

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
  }

  /**
   * Cleans up a VM and all associated resources.
   *
   * This method:
   * 1. Stops the VM if running (via infinivirt)
   * 2. Deletes VM resources (disks, network, firewall)
   * 3. Cleans up VirtioSocket connections
   * 4. Removes all database records
   *
   * @param machineId - The ID of the machine to clean up
   */
  async cleanupVM (machineId: string): Promise<void> {
    this.debug.log(`Starting cleanup for VM ${machineId}`)

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

    // 1. Stop and clean up VM via infinivirt
    await this.cleanupVMResources(machineId)

    // 2. Clean up disk files
    await this.cleanupDiskFiles(machine.internalName)

    // 3. Clean up VirtioSocket connection
    await this.cleanupVirtioSocket(machineId)

    // 4. Clean up InfiniService socket file
    await this.cleanupInfiniServiceSocket(machineId)

    // 5. Clean up additional socket files (guest agent, etc)
    await this.cleanupSocketFiles(machine.internalName)

    // 6. Remove database records
    await this.cleanupDatabaseRecords(machineId, machine.configuration?.id)

    this.debug.log(`Successfully cleaned up VM ${machineId}`)
  }

  /**
   * Stops and cleans up VM resources via infinivirt.
   */
  private async cleanupVMResources (machineId: string): Promise<void> {
    try {
      const infinivirt = await getInfinivirt()

      // Check if VM is running
      const status = await infinivirt.getVMStatus(machineId)

      if (status.processAlive) {
        this.debug.log(`Stopping running VM ${machineId}`)
        const stopResult = await infinivirt.stopVM(machineId, {
          force: true,
          graceful: false
        })

        if (!stopResult.success) {
          this.debug.log('warn', `Failed to stop VM: ${stopResult.error}`)
        }
      }

      // Note: VM resource cleanup (TAP, firewall) is handled by infinivirt's stopVM
      // Disk cleanup is handled separately in cleanupDiskFiles
      this.debug.log(`VM process stopped for ${machineId}`)
    } catch (error: any) {
      this.debug.log('warn', `Error during VM resource cleanup: ${error.message}`)
      // Continue with other cleanup steps
    }
  }

  /**
   * Cleans up disk files for the VM.
   */
  private async cleanupDiskFiles (internalName: string): Promise<void> {
    const diskDir = process.env.INFINIVIRT_DISK_DIR ?? '/var/lib/infinivirt/disks'
    const diskPatterns = [
      path.join(diskDir, `${internalName}.qcow2`),
      path.join(diskDir, `${internalName}-main.qcow2`),
      path.join(diskDir, `${internalName}-0.qcow2`)
    ]

    for (const diskPath of diskPatterns) {
      try {
        if (existsSync(diskPath)) {
          unlinkSync(diskPath)
          this.debug.log(`Removed disk file: ${diskPath}`)
        }
      } catch (e) {
        this.debug.log(`Error removing disk ${diskPath}: ${String(e)}`)
      }
    }
  }

  /**
   * Cleans up VirtioSocket connection.
   */
  private async cleanupVirtioSocket (machineId: string): Promise<void> {
    try {
      const virtioSocketWatcher = getVirtioSocketWatcherService()
      await virtioSocketWatcher.cleanupVmConnection(machineId)
      this.debug.log(`Cleaned up VirtioSocket connection for machine ${machineId}`)
    } catch (e) {
      // VirtioSocketWatcherService might not be initialized
      this.debug.log(`Note: Could not clean up VirtioSocket connection: ${String(e)}`)
    }
  }

  /**
   * Cleans up InfiniService socket file.
   */
  private async cleanupInfiniServiceSocket (machineId: string): Promise<void> {
    try {
      const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
      const socketPath = path.join(baseDir, 'sockets', `${machineId}.socket`)

      if (existsSync(socketPath)) {
        unlinkSync(socketPath)
        this.debug.log(`Removed InfiniService socket file: ${socketPath}`)
      }
    } catch (e) {
      this.debug.log(`Error removing InfiniService socket file: ${String(e)}`)
    }
  }

  /**
   * Cleans up additional socket files (QMP, guest agent, infiniservice channels).
   */
  private async cleanupSocketFiles (internalName: string): Promise<void> {
    const socketDir = process.env.INFINIVIRT_SOCKET_DIR ?? '/var/run/infinivirt'

    const socketPaths = [
      path.join(socketDir, `${internalName}.qmp`),
      path.join(socketDir, 'ga', `${internalName}.sock`),
      path.join(socketDir, 'infini', `${internalName}.sock`),
      path.join(socketDir, 'tpm', `${internalName}.sock`)
    ]

    for (const socketPath of socketPaths) {
      try {
        if (existsSync(socketPath)) {
          unlinkSync(socketPath)
          this.debug.log(`Removed socket file: ${socketPath}`)
        }
      } catch (e) {
        this.debug.log(`Error removing socket ${socketPath}: ${String(e)}`)
      }
    }
  }

  /**
   * Removes all database records for the VM.
   */
  private async cleanupDatabaseRecords (
    machineId: string,
    configurationId: string | undefined
  ): Promise<void> {
    await this.prisma.$transaction(async tx => {
      try {
        // Delete machine configuration
        if (configurationId) {
          await tx.machineConfiguration.delete({
            where: { machineId }
          }).catch(() => {
            // May not exist
          })
        }

        // Delete machine applications
        await tx.machineApplication.deleteMany({
          where: { machineId }
        })

        // Delete script executions
        await tx.scriptExecution.deleteMany({
          where: { machineId }
        })

        // Delete firewall rules and ruleset
        await this.cleanupFirewallRuleSet(tx, machineId)

        // Delete machine
        await tx.machine.delete({
          where: { id: machineId }
        })

        this.debug.log(`Removed database records for VM ${machineId}`)
      } catch (e) {
        this.debug.log(`Error removing DB records: ${String(e)}`)
        throw e
      }
    })
  }

  /**
   * Cleans up the VM's FirewallRuleSet and all associated rules.
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
      // Don't throw - allow VM deletion to proceed
    }
  }

  /**
   * Cleans up only runtime resources without deleting database records.
   * Useful for resetting a VM to a clean state without removing it.
   *
   * @param machineId - The ID of the machine
   * @param deleteDisks - Whether to delete disk files (default: false)
   */
  async cleanupRuntimeResources (machineId: string, deleteDisks: boolean = false): Promise<void> {
    this.debug.log(`Cleaning up runtime resources for VM ${machineId}`)

    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId }
    })

    if (!machine) {
      this.debug.log(`Machine ${machineId} not found`)
      return
    }

    await this.cleanupVMResources(machineId)

    if (deleteDisks) {
      await this.cleanupDiskFiles(machine.internalName)
    }

    await this.cleanupVirtioSocket(machineId)
    await this.cleanupSocketFiles(machine.internalName)

    this.debug.log(`Cleaned up runtime resources for VM ${machineId}`)
  }
}
