/**
 * MachineCleanupServiceV2 - VM cleanup using infinization.
 *
 * This service replaces the libvirt-based MachineCleanupService with
 * infinization, providing direct QEMU management.
 *
 * Key differences from V1:
 * - Uses infinization.destroyVM() for full cleanup (process, TAP, firewall chain)
 * - No nwfilter cleanup needed (infinization uses nftables)
 * - Keeps database and VirtioSocket cleanup logic
 */

import { PrismaClient } from '@prisma/client'
import { unlink } from 'fs/promises'
import path from 'path'

import { Debugger } from '../../utils/debug'
import { getInfinization } from '@services/InfinizationService'
import { getVirtioSocketWatcherService } from '../VirtioSocketWatcherService'

interface ResourceCleanupResult {
  resource: string
  success: boolean
  duration: number
  details?: string
  error?: string
}

interface CleanupSummary {
  vmId: string
  startTime: number
  endTime?: number
  totalDuration?: number
  operations: ResourceCleanupResult[]
  resourcesCleaned: {
    vmResources: boolean
    tapDevice: boolean
    firewallChain: boolean
    diskFiles: string[]
    virtioSocket: boolean
    infiniServiceSocket: boolean
    socketFiles: string[]
    databaseRecords: boolean
  }
  errors: string[]
}

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
   * 1. Stops the VM if running (via infinization)
   * 2. Deletes VM resources (disks, network, firewall)
   * 3. Cleans up VirtioSocket connections
   * 4. Removes all database records
   *
   * @param machineId - The ID of the machine to clean up
   */
  async cleanupVM (machineId: string): Promise<void> {
    const summary: CleanupSummary = {
      vmId: machineId,
      startTime: Date.now(),
      operations: [],
      resourcesCleaned: {
        vmResources: false,
        tapDevice: false,
        firewallChain: false,
        diskFiles: [],
        virtioSocket: false,
        infiniServiceSocket: false,
        socketFiles: [],
        databaseRecords: false
      },
      errors: []
    }

    this.debug.log('info', `Starting cleanup for VM ${machineId} at ${new Date(summary.startTime).toISOString()}`)

    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      include: {
        configuration: true
      }
    })

    if (!machine) {
      this.debug.log('warn', `Machine ${machineId} not found in database`)
      return
    }

    // 1. Stop and clean up VM via infinization
    this.debug.log('info', `[1/6] Cleaning VM resources (TAP, firewall)`)
    const vmResourcesResult = await this.cleanupVMResources(machineId, summary)
    summary.operations.push(vmResourcesResult)
    summary.resourcesCleaned.vmResources = vmResourcesResult.success
    summary.resourcesCleaned.tapDevice = vmResourcesResult.success
    summary.resourcesCleaned.firewallChain = vmResourcesResult.success
    if (vmResourcesResult.error) summary.errors.push(vmResourcesResult.error)

    // 2. Clean up disk files
    this.debug.log('info', `[2/6] Cleaning disk files`)
    const diskResult = await this.cleanupDiskFiles(machine.internalName, summary)
    summary.operations.push(diskResult)
    if (diskResult.error) summary.errors.push(diskResult.error)

    // 3. Clean up VirtioSocket connection
    this.debug.log('info', `[3/6] Cleaning VirtioSocket connection`)
    const virtioResult = await this.cleanupVirtioSocket(machineId, summary)
    summary.operations.push(virtioResult)
    summary.resourcesCleaned.virtioSocket = virtioResult.success
    if (virtioResult.error) summary.errors.push(virtioResult.error)

    // 4. Clean up InfiniService socket file
    this.debug.log('info', `[4/6] Cleaning InfiniService socket`)
    const infiniServiceResult = await this.cleanupInfiniServiceSocket(machineId, summary)
    summary.operations.push(infiniServiceResult)
    summary.resourcesCleaned.infiniServiceSocket = infiniServiceResult.success
    if (infiniServiceResult.error) summary.errors.push(infiniServiceResult.error)

    // 5. Clean up additional socket files (guest agent, etc)
    this.debug.log('info', `[5/6] Cleaning additional socket files (QMP, guest agent, TPM)`)
    const socketResult = await this.cleanupSocketFiles(machine.internalName, machineId, summary)
    summary.operations.push(socketResult)
    if (socketResult.error) summary.errors.push(socketResult.error)

    // 6. Remove database records
    this.debug.log('info', `[6/6] Cleaning database records`)
    let dbCleanupError: Error | null = null

    try {
      const dbResult = await this.cleanupDatabaseRecords(machineId, machine.configuration?.id, summary)
      summary.operations.push(dbResult)
      summary.resourcesCleaned.databaseRecords = dbResult.success
      if (dbResult.error) summary.errors.push(dbResult.error)
    } catch (e: any) {
      dbCleanupError = e
      const dbResult: ResourceCleanupResult = {
        resource: 'Database Records',
        success: false,
        duration: 0,
        error: `Failed to remove database records: ${e.message}`
      }
      summary.operations.push(dbResult)
      summary.errors.push(dbResult.error!)
    } finally {
      // Generate final summary - always executed even if DB cleanup fails
      summary.endTime = Date.now()
      summary.totalDuration = summary.endTime - summary.startTime
      this.logCleanupSummary(summary)
    }

    // Propagate the exception after logging the summary
    if (dbCleanupError) {
      throw dbCleanupError
    }
  }

  /**
   * Logs the cleanup summary with detailed statistics.
   */
  private logCleanupSummary (summary: CleanupSummary): void {
    this.debug.log('info', `===== CLEANUP SUMMARY FOR VM ${summary.vmId} =====`)
    this.debug.log('info', `Total Duration: ${summary.totalDuration}ms`)
    this.debug.log('info', `Started: ${new Date(summary.startTime).toISOString()}`)
    this.debug.log('info', `Completed: ${new Date(summary.endTime!).toISOString()}`)
    this.debug.log('info', ``)
    this.debug.log('info', `Resources Cleaned:`)

    for (const op of summary.operations) {
      const status = op.success ? '✓' : '✗'
      this.debug.log('info', `  ${status} ${op.resource}: ${op.success ? 'Success' : 'Failed'} (${op.duration}ms)`)
      if (op.details) {
        this.debug.log('info', `    - ${op.details}`)
      }
    }

    if (summary.errors.length > 0) {
      this.debug.log('warn', ``)
      this.debug.log('warn', `Errors Encountered: ${summary.errors.length}`)
      for (const error of summary.errors) {
        this.debug.log('warn', `  - ${error}`)
      }
    }

    this.debug.log('info', ``)
    this.debug.log('info', `===== END CLEANUP SUMMARY =====`)
  }

  /**
   * Destroys VM resources via infinization.
   * This permanently removes TAP device, firewall rules, and stops the process.
   *
   * IMPORTANT: This calls infinization.destroyVM() which:
   * - Stops QEMU process if running
   * - Permanently destroys TAP device (ip link del)
   * - Permanently removes nftables firewall chain and all rules
   * - Clears machine configuration from database
   *
   * This is different from stop() which only detaches resources for reuse.
   */
  private async cleanupVMResources (machineId: string, summary: CleanupSummary): Promise<ResourceCleanupResult> {
    const startTime = Date.now()
    const result: ResourceCleanupResult = {
      resource: 'VM Resources (TAP/Firewall)',
      success: false,
      duration: 0
    }

    try {
      // Query machine configuration and firewall ruleset for real device names
      const machineWithConfig = await this.prisma.machine.findUnique({
        where: { id: machineId },
        include: {
          configuration: true,
          firewallRuleSet: true
        }
      })

      // Get real TAP device name and firewall chain name from database
      const tapDeviceName = machineWithConfig?.configuration?.tapDeviceName ?? `tap-${machineId}`
      const firewallChainName = machineWithConfig?.firewallRuleSet?.internalName ?? `chain-${machineId}`

      const infinization = await getInfinization()

      this.debug.log('info', `Destroying VM resources for ${machineId} (TAP device: ${tapDeviceName}, Firewall chain: ${firewallChainName})`)
      const destroyResult = await infinization.destroyVM(machineId)

      result.duration = Date.now() - startTime

      if (!destroyResult.success) {
        result.success = false
        result.error = `Failed to destroy VM resources: ${destroyResult.error}`
        this.debug.log('warn', `✗ Failed to destroy VM resources after ${result.duration}ms: ${destroyResult.error}`)
      } else {
        result.success = true
        result.details = `TAP: ${tapDeviceName}, Firewall: ${firewallChainName}`
        this.debug.log('info', `✓ VM resources destroyed successfully in ${result.duration}ms (TAP: ${tapDeviceName}, Firewall: ${firewallChainName})`)
      }
    } catch (error: any) {
      result.duration = Date.now() - startTime
      result.success = false
      result.error = `Error during VM resource cleanup: ${error.message}`
      this.debug.log('error', `✗ Error during VM resource cleanup after ${result.duration}ms: ${error.message}`)
    }

    return result
  }

  /**
   * Cleans up disk files for the VM.
   */
  private async cleanupDiskFiles (internalName: string, summary: CleanupSummary): Promise<ResourceCleanupResult> {
    const startTime = Date.now()
    const result: ResourceCleanupResult = {
      resource: 'Disk Files',
      success: false,
      duration: 0
    }

    const diskDir = process.env.INFINIZATION_DISK_DIR ?? '/var/lib/infinization/disks'
    const diskPatterns = [
      path.join(diskDir, `${internalName}.qcow2`),
      path.join(diskDir, `${internalName}-main.qcow2`),
      path.join(diskDir, `${internalName}-0.qcow2`)
    ]

    this.debug.log('info', `Removing disk files for ${internalName}`)
    const removedFiles: string[] = []
    const errors: string[] = []

    for (const diskPath of diskPatterns) {
      try {
        await unlink(diskPath)
        removedFiles.push(diskPath)
        summary.resourcesCleaned.diskFiles.push(diskPath)
        this.debug.log('info', `✓ Removed disk file: ${diskPath}`)
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          errors.push(`${diskPath}: ${e.message}`)
          this.debug.log('warn', `⚠ Could not remove disk file ${diskPath}: ${e.message}`)
        }
      }
    }

    result.duration = Date.now() - startTime
    result.details = removedFiles.length > 0
      ? removedFiles.join(', ')
      : 'No disk files found'

    if (errors.length > 0) {
      result.error = errors.join('; ')
      result.success = false
    } else {
      result.success = true
    }

    this.debug.log('info', `Disk cleanup completed in ${result.duration}ms: ${removedFiles.length}/${diskPatterns.length} files removed`)

    return result
  }

  /**
   * Cleans up VirtioSocket connection.
   */
  private async cleanupVirtioSocket (machineId: string, summary: CleanupSummary): Promise<ResourceCleanupResult> {
    const startTime = Date.now()
    const result: ResourceCleanupResult = {
      resource: 'VirtioSocket',
      success: false,
      duration: 0
    }

    try {
      this.debug.log('info', `Cleaning VirtioSocket connection for VM ${machineId}`)
      const virtioSocketWatcher = getVirtioSocketWatcherService()
      await virtioSocketWatcher.cleanupVmConnection(machineId)
      result.duration = Date.now() - startTime
      result.success = true
      result.details = `Connection cleaned for ${machineId}`
      this.debug.log('info', `✓ VirtioSocket connection cleaned in ${result.duration}ms`)
    } catch (e: any) {
      result.duration = Date.now() - startTime
      result.success = false
      result.error = `VirtioSocket cleanup skipped (service not initialized): ${e.message}`
      this.debug.log('warn', `⚠ VirtioSocket cleanup skipped (service not initialized): ${e.message}`)
    }

    return result
  }

  /**
   * Cleans up InfiniService socket file.
   */
  private async cleanupInfiniServiceSocket (machineId: string, summary: CleanupSummary): Promise<ResourceCleanupResult> {
    const startTime = Date.now()
    const result: ResourceCleanupResult = {
      resource: 'InfiniService Socket',
      success: false,
      duration: 0
    }

    const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
    const socketPath = path.join(baseDir, 'sockets', `${machineId}.socket`)

    this.debug.log('info', `Removing InfiniService socket: ${socketPath}`)

    try {
      await unlink(socketPath)
      result.duration = Date.now() - startTime
      result.success = true
      result.details = socketPath
      this.debug.log('info', `✓ InfiniService socket removed in ${result.duration}ms: ${socketPath}`)
    } catch (e: any) {
      result.duration = Date.now() - startTime
      if (e.code === 'ENOENT') {
        result.success = true
        result.details = 'Socket not found (already cleaned)'
        this.debug.log('info', `InfiniService socket not found (already cleaned): ${socketPath}`)
      } else {
        result.success = false
        result.error = `Could not remove InfiniService socket: ${e.message}`
        this.debug.log('warn', `⚠ Could not remove InfiniService socket: ${e.message}`)
      }
    }

    return result
  }

  /**
   * Cleans up additional socket files (QMP, guest agent, infiniservice channels).
   */
  private async cleanupSocketFiles (internalName: string, machineId: string, summary: CleanupSummary): Promise<ResourceCleanupResult> {
    const startTime = Date.now()
    const result: ResourceCleanupResult = {
      resource: 'Additional Sockets',
      success: false,
      duration: 0
    }

    const socketDir = process.env.INFINIZATION_SOCKET_DIR ?? '/opt/infinibay/sockets'

    const socketPaths = [
      path.join(socketDir, `${internalName}.qmp`),
      path.join(socketDir, `${internalName}-ga.sock`),
      path.join(socketDir, `${machineId}.socket`),
      path.join(socketDir, `${internalName}-tpm.sock`)
    ]

    this.debug.log('info', `Removing additional socket files (QMP, guest agent, infini, TPM)`)
    const removedSockets: string[] = []
    const errors: string[] = []

    for (const socketPath of socketPaths) {
      try {
        await unlink(socketPath)
        removedSockets.push(socketPath)
        summary.resourcesCleaned.socketFiles.push(socketPath)
        this.debug.log('info', `✓ Removed socket: ${socketPath}`)
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          errors.push(`${socketPath}: ${e.message}`)
          this.debug.log('warn', `⚠ Could not remove socket ${socketPath}: ${e.message}`)
        }
      }
    }

    result.duration = Date.now() - startTime
    result.details = removedSockets.length > 0
      ? `QMP, Guest Agent, Infini, TPM (${removedSockets.length} removed)`
      : 'No socket files found'

    if (errors.length > 0) {
      result.error = errors.join('; ')
      result.success = false
    } else {
      result.success = true
    }

    this.debug.log('info', `Socket cleanup completed in ${result.duration}ms: ${removedSockets.length}/${socketPaths.length} sockets removed`)

    return result
  }

  /**
   * Removes all database records for the VM.
   */
  private async cleanupDatabaseRecords (
    machineId: string,
    configurationId: string | undefined,
    summary: CleanupSummary
  ): Promise<ResourceCleanupResult> {
    const startTime = Date.now()
    const result: ResourceCleanupResult = {
      resource: 'Database Records',
      success: false,
      duration: 0
    }

    this.debug.log('info', `Removing database records for VM ${machineId}`)

    try {
      let appCount = 0
      let pendingCmdCount = 0
      let scriptCount = 0
      let firewallRuleCount = 0

      await this.prisma.$transaction(async tx => {
        // Delete machine configuration
        if (configurationId) {
          this.debug.log('info', `Deleting machine configuration...`)
          await tx.machineConfiguration.delete({
            where: { machineId }
          }).catch(() => {
            // May not exist
          })
        }

        // Delete machine applications
        const appResult = await tx.machineApplication.deleteMany({
          where: { machineId }
        })
        appCount = appResult.count
        this.debug.log('info', `Deleting ${appCount} machine applications...`)

        // Delete pending commands
        const pendingCmdResult = await tx.pendingCommand.deleteMany({
          where: { machineId }
        })
        pendingCmdCount = pendingCmdResult.count
        this.debug.log('info', `Deleting ${pendingCmdCount} pending commands...`)

        // Delete script executions
        const scriptResult = await tx.scriptExecution.deleteMany({
          where: { machineId }
        })
        scriptCount = scriptResult.count
        this.debug.log('info', `Deleting ${scriptCount} script executions...`)

        // Delete firewall rules and ruleset
        this.debug.log('info', `Deleting firewall ruleset...`)
        firewallRuleCount = await this.cleanupFirewallRuleSet(tx, machineId)

        // Delete machine
        this.debug.log('info', `Deleting machine record...`)
        await tx.machine.delete({
          where: { id: machineId }
        })
      })

      result.duration = Date.now() - startTime
      result.success = true
      result.details = `Configuration, ${appCount} applications, ${pendingCmdCount} pending commands, ${scriptCount} scripts, ${firewallRuleCount} firewall rules`
      this.debug.log('info', `✓ Database records removed in ${result.duration}ms (config, ${appCount} apps, ${pendingCmdCount} pending commands, ${scriptCount} scripts, ${firewallRuleCount} firewall rules, machine)`)
    } catch (e: any) {
      result.duration = Date.now() - startTime
      result.success = false
      result.error = `Failed to remove database records: ${e.message}`
      this.debug.log('error', `✗ Failed to remove database records after ${result.duration}ms: ${e.message}`)
      throw e
    }

    return result
  }

  /**
   * Cleans up the VM's FirewallRuleSet and all associated rules.
   * @returns The number of firewall rules deleted
   */
  private async cleanupFirewallRuleSet (tx: any, vmId: string): Promise<number> {
    try {
      this.debug.log('info', `Cleaning firewall ruleset for VM ${vmId}`)

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
        const ruleCount = vm.firewallRuleSet.rules.length

        this.debug.log('info', `Found firewall ruleset ${ruleSetId} with ${ruleCount} rules`)

        // Delete all rules in the rule set
        await tx.firewallRule.deleteMany({
          where: { ruleSetId }
        })
        this.debug.log('info', `Deleted ${ruleCount} firewall rules`)

        // Delete the rule set itself
        await tx.firewallRuleSet.delete({
          where: { id: ruleSetId }
        })
        this.debug.log('info', `✓ Deleted firewall ruleset ${ruleSetId}`)

        return ruleCount
      } else {
        this.debug.log('info', `No firewall ruleset found (already cleaned)`)
        return 0
      }
    } catch (e: any) {
      this.debug.log('warn', `⚠ Error cleaning firewall ruleset: ${e.message}`)
      // Don't throw - allow VM deletion to proceed
      return 0
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
    const startTime = Date.now()
    this.debug.log('info', `Cleaning runtime resources for VM ${machineId} (deleteDisks: ${deleteDisks})`)

    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId }
    })

    if (!machine) {
      this.debug.log('warn', `Machine ${machineId} not found`)
      return
    }

    // Create a temporary summary for tracking (not logged at end since this is a partial cleanup)
    const summary: CleanupSummary = {
      vmId: machineId,
      startTime,
      operations: [],
      resourcesCleaned: {
        vmResources: false,
        tapDevice: false,
        firewallChain: false,
        diskFiles: [],
        virtioSocket: false,
        infiniServiceSocket: false,
        socketFiles: [],
        databaseRecords: false
      },
      errors: []
    }

    const vmResult = await this.cleanupVMResources(machineId, summary)
    summary.operations.push(vmResult)

    if (deleteDisks) {
      const diskResult = await this.cleanupDiskFiles(machine.internalName, summary)
      summary.operations.push(diskResult)
    }

    const virtioResult = await this.cleanupVirtioSocket(machineId, summary)
    summary.operations.push(virtioResult)

    const socketResult = await this.cleanupSocketFiles(machine.internalName, machineId, summary)
    summary.operations.push(socketResult)

    const totalDuration = Date.now() - startTime
    const successCount = summary.operations.filter(op => op.success).length
    this.debug.log('info', `Runtime resources cleaned in ${totalDuration}ms (${successCount}/${summary.operations.length} operations successful)`)
  }
}
