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

import logger from '@main/logger'
import { NodeDispatcher, masterIdentity } from '@services/node/NodeDispatcher'
import { httpsJsonPost } from '@services/node/clusterMtls'
import { getVirtioSocketWatcherService } from '../VirtioSocketWatcherService'
import { DELETE_FAILED_STATUS } from '../../constants/machine-status'

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
  private debug = logger.child({ module: 'machine-cleanup-v2' })
  private dispatcher: NodeDispatcher

  constructor (prisma: PrismaClient, dispatcher?: NodeDispatcher) {
    this.prisma = prisma
    // Multi-node routing: destroyVM (qemu kill + TAP/nftables teardown) runs on
    // the node that OWNS the VM (Machine.nodeId), not unconditionally on the
    // master. On a single-node cluster this resolves to the local infinization.
    this.dispatcher = dispatcher ?? new NodeDispatcher(prisma)
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

    this.debug.info(`Starting cleanup for VM ${machineId} at ${new Date(summary.startTime).toISOString()}`)

    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      include: {
        configuration: true
      }
    })

    if (!machine) {
      this.debug.warn(`Machine ${machineId} not found in database`)
      return
    }

    // 0. Best-effort reclaim of the ~1.2GB unattended install ISO in iso/temp.
    // The normal deleter (ejectAllCdroms) runs ONLY when infiniservice handshakes
    // (MetricsHandler.handleFirstInfiniserviceMessage → setupComplete); a VM whose
    // agent never installed leaves its temp ISO on disk forever, and no step below
    // removes it. Do it BEFORE destroyVM, which kills QEMU and makes the QMP
    // block-device query impossible. Non-fatal; local-node/QMP-reachable only — the
    // age-based temp-ISO janitor (startup + hourly) covers stopped/crashed/remote VMs.
    try {
      const { ejectAllCdroms } = await import('../InfinizationService')
      await ejectAllCdroms(machineId)
    } catch (isoErr: any) {
      this.debug.warn(`Temp ISO reclaim before delete skipped for VM ${machineId}: ${isoErr?.message ?? isoErr}`)
    }

    // 1. Stop and clean up VM via infinization
    this.debug.info(`[1/6] Cleaning VM resources (TAP, firewall)`)
    const vmResourcesResult = await this.cleanupVMResources(machineId, summary)
    summary.operations.push(vmResourcesResult)
    summary.resourcesCleaned.vmResources = vmResourcesResult.success
    summary.resourcesCleaned.tapDevice = vmResourcesResult.success
    summary.resourcesCleaned.firewallChain = vmResourcesResult.success
    if (vmResourcesResult.error) summary.errors.push(vmResourcesResult.error)

    // ── Abort-on-physical-failure ──────────────────────────────────
    // If infinization.destroyVM (process kill + TAP teardown + nftables chain
    // removal) failed, the host still owns QEMU/TAP/firewall/disk resources.
    // Deleting the DB row now would orphan them with no handle to retry against.
    // Instead: KEEP the row, park it in DELETE_FAILED so an operator or a cron
    // can re-attempt cleanup, and surface the failure by throwing. All callers
    // (destroyMachine, PoolService.archiveMachine, GoldenImageService) already
    // treat a throw as a failed cleanup.
    if (!vmResourcesResult.success) {
      summary.endTime = Date.now()
      summary.totalDuration = summary.endTime - summary.startTime
      this.logCleanupSummary(summary)
      const reason = vmResourcesResult.error ?? 'physical VM teardown failed'
      this.debug.error(`Aborting DB delete for VM ${machineId}: ${reason} — marking ${DELETE_FAILED_STATUS} for retry`)
      try {
        await this.prisma.machine.update({
          where: { id: machineId },
          data: { status: DELETE_FAILED_STATUS }
        })
      } catch (markErr: any) {
        this.debug.warn(`Could not mark VM ${machineId} as ${DELETE_FAILED_STATUS}: ${markErr?.message ?? markErr}`)
      }
      throw new Error(`VM physical teardown failed; database row preserved for retry: ${reason}`)
    }

    // 2. Clean up disk files
    this.debug.info(`[2/6] Cleaning disk files`)
    const storedDiskPaths = Array.isArray(machine.configuration?.diskPaths)
      ? (machine.configuration?.diskPaths as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
      : []
    const diskResult = await this.cleanupDiskFiles(machine.internalName, storedDiskPaths, summary, machine.nodeId)
    summary.operations.push(diskResult)
    if (diskResult.error) summary.errors.push(diskResult.error)

    // 3. Clean up VirtioSocket connection
    this.debug.info(`[3/6] Cleaning VirtioSocket connection`)
    const virtioResult = await this.cleanupVirtioSocket(machineId, summary)
    summary.operations.push(virtioResult)
    summary.resourcesCleaned.virtioSocket = virtioResult.success
    if (virtioResult.error) summary.errors.push(virtioResult.error)

    // 4. Clean up InfiniService socket file
    this.debug.info(`[4/6] Cleaning InfiniService socket`)
    const infiniServiceResult = await this.cleanupInfiniServiceSocket(machineId, summary)
    summary.operations.push(infiniServiceResult)
    summary.resourcesCleaned.infiniServiceSocket = infiniServiceResult.success
    if (infiniServiceResult.error) summary.errors.push(infiniServiceResult.error)

    // 5. Clean up additional socket files (guest agent, etc)
    this.debug.info(`[5/6] Cleaning additional socket files (QMP, guest agent, TPM)`)
    const socketResult = await this.cleanupSocketFiles(machine.internalName, machineId, summary)
    summary.operations.push(socketResult)
    if (socketResult.error) summary.errors.push(socketResult.error)

    // 6. Remove database records
    this.debug.info(`[6/6] Cleaning database records`)
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
    this.debug.info(`===== CLEANUP SUMMARY FOR VM ${summary.vmId} =====`)
    this.debug.info(`Total Duration: ${summary.totalDuration}ms`)
    this.debug.info(`Started: ${new Date(summary.startTime).toISOString()}`)
    this.debug.info(`Completed: ${new Date(summary.endTime!).toISOString()}`)
    this.debug.info(``)
    this.debug.info(`Resources Cleaned:`)

    for (const op of summary.operations) {
      const status = op.success ? '✓' : '✗'
      this.debug.info(`  ${status} ${op.resource}: ${op.success ? 'Success' : 'Failed'} (${op.duration}ms)`)
      if (op.details) {
        this.debug.info(`    - ${op.details}`)
      }
    }

    if (summary.errors.length > 0) {
      this.debug.warn(``)
      this.debug.warn(`Errors Encountered: ${summary.errors.length}`)
      for (const error of summary.errors) {
        this.debug.warn(`  - ${error}`)
      }
    }

    this.debug.info(``)
    this.debug.info(`===== END CLEANUP SUMMARY =====`)
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

      const executor = await this.dispatcher.executorFor(machineId)

      this.debug.info(`Destroying VM resources for ${machineId} (TAP device: ${tapDeviceName}, Firewall chain: ${firewallChainName})`)
      const destroyResult = await executor.destroyVM(machineId)

      result.duration = Date.now() - startTime

      // Defensive: a malformed/undefined return must be treated as failure.
      // With the abort-on-physical-failure guard in cleanupVM, this success flag
      // is now load-bearing for whether the DB row is deleted, so destroyVM must
      // return an explicit { success: true } for cleanup to proceed.
      if (!destroyResult?.success) {
        result.success = false
        result.error = `Failed to destroy VM resources: ${destroyResult?.error}`
        this.debug.warn(`✗ Failed to destroy VM resources after ${result.duration}ms: ${destroyResult.error}`)
      } else {
        result.success = true
        result.details = `TAP: ${tapDeviceName}, Firewall: ${firewallChainName}`
        this.debug.info(`✓ VM resources destroyed successfully in ${result.duration}ms (TAP: ${tapDeviceName}, Firewall: ${firewallChainName})`)
      }
    } catch (error: any) {
      result.duration = Date.now() - startTime
      result.success = false
      result.error = `Error during VM resource cleanup: ${error.message}`
      this.debug.error(`✗ Error during VM resource cleanup after ${result.duration}ms: ${error.message}`)
    }

    return result
  }

  /**
   * Cleans up disk files for the VM.
   *
   * Multi-node: a VM owned by a REMOTE node has its qcow2 on that node's local
   * filesystem (the migration adapter pushed it there), NOT on the master. A plain
   * local `unlink` here would only ever ENOENT and silently leak the disk on the
   * node. So when `ownerNodeId` names a node that is not this host, we ALSO dispatch
   * `/agent/disk/delete` to that node's agent (the same mTLS verb the migration
   * reclaim uses) for each candidate path. The local unlink is still attempted (it
   * covers single-host and shared-storage layouts where the disk IS reachable here);
   * both are best-effort and non-fatal — a surviving disk is a storage leak to sweep,
   * never a reason to fail the VM delete (only the physical VM teardown aborts it).
   */
  private async cleanupDiskFiles (internalName: string, storedDiskPaths: string[], summary: CleanupSummary, ownerNodeId?: string | null): Promise<ResourceCleanupResult> {
    const startTime = Date.now()
    const result: ResourceCleanupResult = {
      resource: 'Disk Files',
      success: false,
      duration: 0
    }

    // The AUTHORITATIVE disk locations are the absolute paths persisted on the
    // machine configuration at create time (the same paths infinization boots).
    // Delete those first. The pattern-based reconstruction below is only a legacy
    // fallback for rows that never stored diskPaths — and it must be rooted at the
    // REAL disk dir. The old default (`/var/lib/infinization/disks`) did not match
    // where disks actually live (`$INFINIBAY_BASE_DIR/disks`, e.g.
    // /opt/infinibay/disks), so when INFINIZATION_DISK_DIR was unset every delete
    // silently missed the disk (ENOENT) and LEAKED it while reporting success.
    const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
    const diskDir = process.env.INFINIZATION_DISK_DIR ?? path.join(baseDir, 'disks')
    const candidates = new Set<string>([
      ...storedDiskPaths,
      path.join(diskDir, `${internalName}.qcow2`),
      path.join(diskDir, `${internalName}-main.qcow2`),
      path.join(diskDir, `${internalName}-0.qcow2`)
    ])
    const diskPatterns = Array.from(candidates)

    this.debug.info(`Removing disk files for ${internalName} (${storedDiskPaths.length} stored path(s) + fallbacks)`)
    const removedFiles: string[] = []
    const errors: string[] = []

    for (const diskPath of diskPatterns) {
      try {
        await unlink(diskPath)
        removedFiles.push(diskPath)
        summary.resourcesCleaned.diskFiles.push(diskPath)
        this.debug.info(`✓ Removed disk file: ${diskPath}`)
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          errors.push(`${diskPath}: ${e.message}`)
          this.debug.warn(`⚠ Could not remove disk file ${diskPath}: ${e.message}`)
        }
      }
    }

    // Remote-node disk: when the VM is owned by another node, its qcow2 lives on
    // THAT node's local filesystem — the local unlinks above only ENOENT'd. Dispatch
    // the delete to the owning node's agent so the disk is actually reclaimed.
    if (ownerNodeId) {
      let localNodeId: string | undefined
      try {
        const { resolveLocalNodeId } = await import('../InfinizationService')
        localNodeId = await resolveLocalNodeId()
      } catch {
        // Local node identity unresolved → treat as single-host and skip the remote
        // step (mis-routing a delete to the wrong host would be worse than a leak).
      }
      if (localNodeId && ownerNodeId !== localNodeId) {
        const remote = await this.deleteDisksOnNode(ownerNodeId, diskPatterns)
        for (const p of remote.removed) {
          if (!removedFiles.includes(p)) { removedFiles.push(p); summary.resourcesCleaned.diskFiles.push(p) }
        }
        for (const e of remote.errors) errors.push(e)
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

    this.debug.info(`Disk cleanup completed in ${result.duration}ms: ${removedFiles.length}/${diskPatterns.length} files removed`)

    return result
  }

  /**
   * Delete a VM's disk file(s) on a REMOTE node via its agent's mTLS
   * `POST /agent/disk/delete` verb (the same path the migration source-reclaim uses).
   * Best-effort: returns which paths were actually removed plus human-readable errors
   * (unreachable node, non-2xx, path outside the node's disk store). Never throws.
   *
   * Requires cluster mTLS — the disk verbs are mTLS-only on the agent (a filesystem-
   * mutating surface must never ride the pre-mTLS shared token). With mTLS off we can't
   * safely reach the node, so the disk is reported as leaked rather than mis-deleted.
   */
  private async deleteDisksOnNode (nodeId: string, diskPaths: string[]): Promise<{ removed: string[], errors: string[] }> {
    const removed: string[] = []
    const errors: string[] = []
    if (diskPaths.length === 0) return { removed, errors }

    if (process.env.INFINIBAY_CLUSTER_MTLS !== '1') {
      errors.push(`remote disk delete needs cluster mTLS (INFINIBAY_CLUSTER_MTLS=1); disk(s) left on node ${nodeId}`)
      return { removed, errors }
    }

    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { name: true, address: true, agentPort: true, status: true }
    })
    if (!node || !node.address) {
      errors.push(`cannot reach node ${nodeId} to delete disk(s) (no address; status=${node?.status ?? 'unknown'})`)
      return { removed, errors }
    }

    for (const p of diskPaths) {
      try {
        const r = await httpsJsonPost(
          `https://${node.address}:${node.agentPort}/agent/disk/delete`,
          { path: p },
          masterIdentity(),
          { expectedCn: node.name }
        )
        if (r.status < 200 || r.status >= 300) {
          errors.push(`${p} on ${node.name}: HTTP ${r.status} ${r.text.slice(0, 160)}`)
          continue
        }
        let body: { ok?: boolean, deleted?: boolean }
        try { body = JSON.parse(r.text) as typeof body } catch { errors.push(`${p} on ${node.name}: non-JSON response`); continue }
        if (body.ok !== true) { errors.push(`${p} on ${node.name}: agent reported failure`); continue }
        // deleted:false means the file was already gone — a clean no-op, not an error.
        if (body.deleted === true) {
          removed.push(p)
          this.debug.info(`✓ Removed remote disk on ${node.name}: ${p}`)
        }
      } catch (e: any) {
        errors.push(`${p} on ${node.name}: ${e?.message ?? String(e)}`)
      }
    }
    return { removed, errors }
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
      this.debug.info(`Cleaning VirtioSocket connection for VM ${machineId}`)
      const virtioSocketWatcher = getVirtioSocketWatcherService()
      await virtioSocketWatcher.cleanupVmConnection(machineId)
      result.duration = Date.now() - startTime
      result.success = true
      result.details = `Connection cleaned for ${machineId}`
      this.debug.info(`✓ VirtioSocket connection cleaned in ${result.duration}ms`)
    } catch (e: any) {
      result.duration = Date.now() - startTime
      result.success = false
      result.error = `VirtioSocket cleanup skipped (service not initialized): ${e.message}`
      this.debug.warn(`⚠ VirtioSocket cleanup skipped (service not initialized): ${e.message}`)
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

    this.debug.info(`Removing InfiniService socket: ${socketPath}`)

    try {
      await unlink(socketPath)
      result.duration = Date.now() - startTime
      result.success = true
      result.details = socketPath
      this.debug.info(`✓ InfiniService socket removed in ${result.duration}ms: ${socketPath}`)
    } catch (e: any) {
      result.duration = Date.now() - startTime
      if (e.code === 'ENOENT') {
        result.success = true
        result.details = 'Socket not found (already cleaned)'
        this.debug.info(`InfiniService socket not found (already cleaned): ${socketPath}`)
      } else {
        result.success = false
        result.error = `Could not remove InfiniService socket: ${e.message}`
        this.debug.warn(`⚠ Could not remove InfiniService socket: ${e.message}`)
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

    this.debug.info(`Removing additional socket files (QMP, guest agent, infini, TPM)`)
    const removedSockets: string[] = []
    const errors: string[] = []

    for (const socketPath of socketPaths) {
      try {
        await unlink(socketPath)
        removedSockets.push(socketPath)
        summary.resourcesCleaned.socketFiles.push(socketPath)
        this.debug.info(`✓ Removed socket: ${socketPath}`)
      } catch (e: any) {
        if (e.code !== 'ENOENT') {
          errors.push(`${socketPath}: ${e.message}`)
          this.debug.warn(`⚠ Could not remove socket ${socketPath}: ${e.message}`)
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

    this.debug.info(`Socket cleanup completed in ${result.duration}ms: ${removedSockets.length}/${socketPaths.length} sockets removed`)

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

    this.debug.info(`Removing database records for VM ${machineId}`)

    try {
      let appCount = 0
      let pendingCmdCount = 0
      let scriptCount = 0
      let firewallRuleCount = 0

      await this.prisma.$transaction(async tx => {
        // Delete machine configuration
        if (configurationId) {
          this.debug.info(`Deleting machine configuration...`)
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
        this.debug.info(`Deleting ${appCount} machine applications...`)

        // Delete pending commands
        const pendingCmdResult = await tx.pendingCommand.deleteMany({
          where: { machineId }
        })
        pendingCmdCount = pendingCmdResult.count
        this.debug.info(`Deleting ${pendingCmdCount} pending commands...`)

        // Delete script executions
        const scriptResult = await tx.scriptExecution.deleteMany({
          where: { machineId }
        })
        scriptCount = scriptResult.count
        this.debug.info(`Deleting ${scriptCount} script executions...`)

        // Delete firewall rules and ruleset
        this.debug.info(`Deleting firewall ruleset...`)
        firewallRuleCount = await this.cleanupFirewallRuleSet(tx, machineId)

        // Delete machine
        this.debug.info(`Deleting machine record...`)
        await tx.machine.delete({
          where: { id: machineId }
        })
      })

      result.duration = Date.now() - startTime
      result.success = true
      result.details = `Configuration, ${appCount} applications, ${pendingCmdCount} pending commands, ${scriptCount} scripts, ${firewallRuleCount} firewall rules`
      this.debug.info(`✓ Database records removed in ${result.duration}ms (config, ${appCount} apps, ${pendingCmdCount} pending commands, ${scriptCount} scripts, ${firewallRuleCount} firewall rules, machine)`)
    } catch (e: any) {
      result.duration = Date.now() - startTime
      result.success = false
      result.error = `Failed to remove database records: ${e.message}`
      this.debug.error(`✗ Failed to remove database records after ${result.duration}ms: ${e.message}`)
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
      this.debug.info(`Cleaning firewall ruleset for VM ${vmId}`)

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

        this.debug.info(`Found firewall ruleset ${ruleSetId} with ${ruleCount} rules`)

        // Delete all rules in the rule set
        await tx.firewallRule.deleteMany({
          where: { ruleSetId }
        })
        this.debug.info(`Deleted ${ruleCount} firewall rules`)

        // Delete the rule set itself
        await tx.firewallRuleSet.delete({
          where: { id: ruleSetId }
        })
        this.debug.info(`✓ Deleted firewall ruleset ${ruleSetId}`)

        return ruleCount
      } else {
        this.debug.info(`No firewall ruleset found (already cleaned)`)
        return 0
      }
    } catch (e: any) {
      this.debug.warn(`⚠ Error cleaning firewall ruleset: ${e.message}`)
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
    this.debug.info(`Cleaning runtime resources for VM ${machineId} (deleteDisks: ${deleteDisks})`)

    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      include: { configuration: true }
    })

    if (!machine) {
      this.debug.warn(`Machine ${machineId} not found`)
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
      const storedDiskPaths = Array.isArray(machine.configuration?.diskPaths)
        ? (machine.configuration?.diskPaths as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      const diskResult = await this.cleanupDiskFiles(machine.internalName, storedDiskPaths, summary, machine.nodeId)
      summary.operations.push(diskResult)
    }

    const virtioResult = await this.cleanupVirtioSocket(machineId, summary)
    summary.operations.push(virtioResult)

    const socketResult = await this.cleanupSocketFiles(machine.internalName, machineId, summary)
    summary.operations.push(socketResult)

    const totalDuration = Date.now() - startTime
    const successCount = summary.operations.filter(op => op.success).length
    this.debug.info(`Runtime resources cleaned in ${totalDuration}ms (${successCount}/${summary.operations.length} operations successful)`)
  }
}
