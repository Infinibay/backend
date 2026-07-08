/**
 * BackupService — Backend wrapper around infinization's BackupService.
 *
 * Responsibilities:
 *  - Persist every backup operation to the Prisma `Backup` table.
 *  - Resolve VM disk paths from the Machine record.
 *  - Broadcast progress / completion / failure events through EventManager.
 *  - Translate domain errors into friendly shapes for the GraphQL layer.
 *
 * This is the only backend-side code that talks to infinization.BackupService
 * directly, so upstream changes are contained here.
 */

import path from 'path'
import { promises as fs } from 'fs'

import {
  BackupService as InfinizationBackupService,
  BackupType,
  BackupStatus,
  BackupCompression,
  BackupMetadata,
  BackupProgress,
  BackupResult as InfinizationBackupResult,
  BackupRestoreResult as InfinizationRestoreResult,
  DEFAULT_BACKUP_DIR,
  DEFAULT_BACKUP_COMPRESSION,
  BackupError,
  GuestAgentClient
} from '@infinibay/infinization'
import type {
  IsVmRunningProbe,
  GuestAgentFactory,
  GuestQuiesce
} from '@infinibay/infinization'
import type { PrismaClient, Backup as PrismaBackup } from '@prisma/client'

import logger from '@main/logger'
import { getEventManager } from '@services/EventManager'
import { VMOperationsService } from '@services/VMOperationsService'
import { getConfiguredStorageProvider } from '@services/storage'
import { resolveLocalNodeId } from '@services/InfinizationService'
import { RemoteDiskStaging, type StagingNode } from '@services/node/RemoteDiskStaging'
import { assertVmStopped } from '@utils/assertVmStopped'
import { ForbiddenError, NotFoundError, UserInputError } from '@utils/errors'
import {
  OFF_STATUS,
  ERROR_STATUS,
  BACKING_UP_STATUS,
  RESTORING_STATUS
} from '../constants/machine-status'

/**
 * Thrown when a disk operation cannot claim the VM because it is running, in
 * another disk op, or otherwise not in a stoppable (OFF/ERROR) state. Distinct
 * type so the resolver/tests can tell a "busy" refusal from a generic failure.
 */
export class VmBusyError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'VmBusyError'
  }
}

/**
 * Thrown by deleteBackup when an incremental backup still depends on the target
 * (audit H5). Deleting the base would orphan the chain.
 */
export class BackupDependencyError extends Error {
  /** DB ids of the dependent (orphan-risk) backups. */
  readonly dependentIds: string[]
  constructor (message: string, dependentIds: string[]) {
    super(message)
    this.name = 'BackupDependencyError'
    this.dependentIds = dependentIds
  }
}

export interface CreateBackupParams {
  vmId: string
  type: BackupType
  compression?: BackupCompression
  description?: string
  parentBackupId?: string
  tags?: string[]
  destinationDir?: string
  /** Optional explicit disk paths; defaults to Machine.diskPaths. */
  diskPaths?: string[]
  /** The user triggering the operation, for event routing. */
  triggeredBy?: string
  /** Optional schedule ID when the backup is fired by the scheduler. */
  scheduleId?: string
}

export interface RestoreBackupParams {
  vmId: string
  backupId: string
  diskPaths?: string[]
  overwriteExisting?: boolean
  /**
   * SNAPSHOT restore only: explicit opt-in to revert the live source disk in
   * place (destructive). Default false — the library refuses to clobber the
   * live source / materializes to a distinct target unless this is true. Ignored
   * for FULL/INCREMENTAL restores.
   */
  allowInPlaceSnapshotRevert?: boolean
  triggeredBy?: string
}

export class BackupService {
  private readonly prisma: PrismaClient
  private readonly infinization: InfinizationBackupService
  private readonly backupRootDir: string

  constructor (prisma: PrismaClient, infinization?: InfinizationBackupService) {
    this.prisma = prisma
    this.backupRootDir = process.env.INFINIZATION_BACKUP_DIR ?? DEFAULT_BACKUP_DIR

    if (infinization) {
      // Caller owns the infinization instance; we just wire events once. The
      // caller is responsible for injecting the live-disk probes (tests do not).
      this.infinization = infinization
    } else {
      // H6: inject the live-disk hardening probes so the library's guard against
      // backing up a LIVE qcow2 (crash-inconsistent / torn reads) actually
      // activates. Without these the guard is inert and a running VM's disk is
      // copied bare.
      this.infinization = new InfinizationBackupService({
        backupRootDir: this.backupRootDir,
        isVmRunning: this.buildIsVmRunningProbe(),
        guestAgentFactory: this.buildGuestAgentFactory()
      })
    }

    // Wire progress events exactly once regardless of construction path.
    // The check-then-set is synchronous within the Node.js event loop, so
    // no two concurrent `new BackupService()` calls can both pass the guard.
    if (!BackupService._progressWired) {
      this.wireProgressEvents()
      BackupService._progressWired = true
    }
  }

  /** Prevent duplicate wiring of global progress events. */
  static _progressWired = false

  /** Exposes the underlying infinization service so BackupScheduler can attach. */
  getInfinizationService (): InfinizationBackupService {
    return this.infinization
  }

  /**
   * Builds the `isVmRunning` probe the library uses to decide whether a
   * FULL/INCREMENTAL backup must quiesce / snapshot rather than read the bare
   * live disk (H6). Derived from the SAME authoritative runtime source as
   * `assertVmStopped`: VMOperationsService.getStatus() -> the live qemu process
   * probe (processAlive), NOT the drift-prone DB Machine.status column.
   *
   * Fail-closed contract (must match the library's null handling):
   *  - getStatus() returns null            => probe unavailable    -> return null
   *  - getStatus().processAlive === false  => provably stopped     -> return false
   *  - getStatus().processAlive !== false  => running / ambiguous  -> return true
   *  - getStatus() throws                  => indeterminate        -> return null
   *
   * Returning null (never a silent false) on an error/unknown state lets the
   * library FAIL CLOSED (throw VM_RUNNING / quiesce) instead of copying a disk
   * that might be live. `!== false` mirrors assertVmStopped: an undefined
   * processAlive inside a non-null object is treated as running.
   */
  private buildIsVmRunningProbe (): IsVmRunningProbe {
    const prisma = this.prisma
    return async (vmId: string): Promise<boolean | null> => {
      try {
        const ops = new VMOperationsService(prisma)
        const status = await ops.getStatus(vmId)
        // Null/undefined => the live probe could not be obtained. Do NOT coerce
        // to false; surface the unknown so the library fails closed.
        if (!status) return null
        return status.processAlive !== false
      } catch (err) {
        logger.warn(
          `isVmRunning probe failed for VM ${vmId}; returning null (fail-closed): ` +
          `${err instanceof Error ? err.message : String(err)}`
        )
        return null
      }
    }
  }

  /**
   * Builds the `guestAgentFactory` the library uses to quiesce a running guest
   * (guest-fsfreeze) before reading its live disk, yielding a
   * filesystem-consistent backup instead of a crash-consistent one (H6).
   *
   * Resolves the VM's guest-agent socket from machine.configuration
   * .guestAgentSocketPath (the same field VMOperationsService uses for
   * guest-exec). Returns:
   *  - null when the VM has no guest agent socket configured, OR the agent
   *    cannot be connected — the library then falls back to a transient
   *    snapshot. We never throw to the library here; a null fallback is safe.
   *  - a connected GuestAgentClient (which structurally satisfies the library's
   *    GuestQuiesce: fsFreeze/fsThaw/connect/disconnect/isConnected) otherwise.
   */
  private buildGuestAgentFactory (): GuestAgentFactory {
    const prisma = this.prisma
    return async (vmId: string): Promise<GuestQuiesce | null> => {
      let socketPath: string | null | undefined
      try {
        const machine = await prisma.machine.findUnique({
          where: { id: vmId },
          select: { configuration: { select: { guestAgentSocketPath: true } } }
        })
        socketPath = machine?.configuration?.guestAgentSocketPath
      } catch (err) {
        logger.warn(
          `guestAgentFactory: failed to resolve guest-agent socket for VM ${vmId}; ` +
          `falling back to transient snapshot: ${err instanceof Error ? err.message : String(err)}`
        )
        return null
      }

      if (!socketPath) {
        // No guest agent configured — library falls back to a transient snapshot.
        return null
      }

      try {
        const agent = new GuestAgentClient(socketPath)
        await agent.connect()
        return agent
      } catch (err) {
        logger.warn(
          `guestAgentFactory: could not connect guest agent at ${socketPath} for VM ${vmId}; ` +
          `falling back to transient snapshot: ${err instanceof Error ? err.message : String(err)}`
        )
        return null
      }
    }
  }

  /**
   * Any row left in IN_PROGRESS / PENDING belongs to a previous backend
   * process that died mid-operation. Mark them FAILED so the UI doesn't
   * show a forever-spinning bar. Call at boot.
   */
  async recoverOrphanedBackups (): Promise<number> {
    const res = await this.prisma.backup.updateMany({
      where: { status: { in: [BackupStatus.IN_PROGRESS, BackupStatus.PENDING] } },
      data: {
        status: BackupStatus.FAILED,
        errorMessage: 'Interrupted by backend restart',
        completedAt: new Date()
      }
    })
    if (res.count > 0) {
      logger.warn(`Recovered ${res.count} orphaned backup row(s) from previous run`)
    }
    return res.count
  }

  /**
   * Atomically claims a STOPPED VM row for an exclusive disk operation by
   * flipping its status to the given marker, but ONLY if it is currently OFF or
   * ERROR. This is the authoritative cross-service lock (audit H1): a concurrent
   * powerOn refuses the marker, and a second disk op sees `count === 0` and bails.
   * Returns true when this caller won the claim.
   */
  private async claimVm (vmId: string, marker: string): Promise<boolean> {
    const claimed = await this.prisma.machine.updateMany({
      where: { id: vmId, status: { in: [OFF_STATUS, ERROR_STATUS] } },
      data: { status: marker }
    })
    return claimed.count === 1
  }

  /**
   * Releases a disk-op claim, flipping the row back to OFF — but only if it is
   * still on the marker WE set (so we never clobber a status another flow may
   * have legitimately moved on to). Never throws: a failed release is logged,
   * because it runs in `finally` paths that must not mask the real error.
   * `recoverOrphanedBackups`-style boot recovery is the backstop if this is ever
   * skipped by a hard crash.
   */
  private async releaseVm (vmId: string, marker: string): Promise<void> {
    try {
      await this.prisma.machine.updateMany({
        where: { id: vmId, status: marker },
        data: { status: OFF_STATUS }
      })
    } catch (err) {
      logger.error(`Failed to release disk-op marker '${marker}' on VM ${vmId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Decide whether a backup/restore for `vmId` must stage the disk to/from a remote
   * node. Backups run centrally on the master, but with LOCAL (non-shared) storage a
   * VM that lives on a compute node has its qcow2 only on that node. Returns the node
   * to stage against, or null when no staging is needed:
   *   - shared storage (NFS/Ceph/shared-mount) → disk already reachable at the path;
   *   - the VM has no node or runs on the master's own node → already local.
   * Throws when the VM is on a node with no reachable address (can't stage).
   */
  private async resolveRemoteStaging (vmId: string): Promise<StagingNode | null> {
    // Shared storage: the disk is byte-reachable from the master at the same path.
    if ((await getConfiguredStorageProvider(this.prisma)).isShared()) return null

    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId },
      select: { nodeId: true }
    })
    const nodeId = machine?.nodeId
    if (!nodeId) return null // unassigned → treated as master-local

    // Fail CLOSED (audit): if we cannot resolve THIS master's own node identity we cannot
    // prove the VM is genuinely remote. Treat it as local (no staging) — a truly-remote VM
    // then fails its backup loudly rather than risk staging against the wrong host. The old
    // `localNodeId && …` form failed OPEN: a falsy localNodeId slipped straight through to
    // "remote", which combined with cleanup could delete a master-local VM's only disk.
    const localNodeId = await resolveLocalNodeId().catch(() => undefined)
    if (!localNodeId) return null
    if (nodeId === localNodeId) return null // runs on the master's own node

    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { name: true, address: true, agentPort: true }
    })
    if (!node || !node.address) {
      throw new Error(`VM ${vmId} is on node ${nodeId}, which has no reachable address — cannot stage its disk for backup/restore`)
    }

    // samePhysicalStore guard (mirrors AgentStorageMigrationAdapter.resolveLegs): a second
    // Node row for the master's own host (re-onboard / clone / rename) has a DIFFERENT id
    // but the SAME address:agentPort. Staging against it would pull the disk onto the master
    // where it already physically lives — treat address+port identity with the master's own
    // node as local (no staging).
    const localNode = await this.prisma.node.findUnique({
      where: { id: localNodeId },
      select: { address: true, agentPort: true }
    })
    if (localNode && localNode.address === node.address && localNode.agentPort === node.agentPort) return null

    return { name: node.name, address: node.address, agentPort: node.agentPort }
  }

  /** Master disk dir the staging helper materializes remote disks into (same path as the node's). */
  private get diskBaseDir (): string {
    return path.resolve(process.env.INFINIZATION_DISK_DIR ?? '/var/lib/infinization/disks')
  }

  /**
   * Creates a backup and persists it to the database. The record is inserted
   * with `IN_PROGRESS` up-front so the UI can show the in-flight operation.
   */
  async createBackup (params: CreateBackupParams): Promise<PrismaBackup> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: params.vmId },
      select: {
        id: true,
        name: true,
        userId: true,
        configuration: { select: { diskPaths: true } }
      }
    })
    if (!vm) {
      throw new Error(`VM ${params.vmId} not found`)
    }

    // Treat an empty array the same as "not provided": the UI sends [] to mean
    // "all of the VM's disks". Without this, `[] ?? default` keeps the empty
    // array and the operation fails the length check below.
    const diskPaths = (params.diskPaths && params.diskPaths.length > 0)
      ? params.diskPaths
      : this.resolveDiskPaths(vm.configuration?.diskPaths)
    if (diskPaths.length === 0) {
      throw new Error(`VM ${params.vmId} has no disk paths configured`)
    }

    // ── Atomic claim (audit H1) ──────────────────────────────────────────────
    // Flip the STOPPED VM row to BACKING_UP in a single conditional updateMany.
    // This is the durable lock that closes the TOCTOU on assertVmStopped: any
    // concurrent powerOn refuses a row in a disk-op marker, and a second backup/
    // snapshot sees count !== 1 and bails. The marker is owned by the background
    // worker below and released in its `finally` (or synchronously here if we
    // throw before handing it off).
    if (!await this.claimVm(params.vmId, BACKING_UP_STATUS)) {
      throw new VmBusyError(
        `VM ${vm.name} is busy or not stopped — cannot start a backup. ` +
        'Stop the VM (it must be OFF or ERROR) and ensure no other backup/restore/snapshot is in progress.'
      )
    }

    try {
      // Re-probe the live process AFTER the claim and BEFORE any qemu-img work.
      // The claim blocks new power-ons; this catches a power-on that slipped in
      // just before the claim (its qemu may still be alive). FAIL CLOSED — a null
      // probe is treated as "running", never "stopped".
      await assertVmStopped(this.prisma, params.vmId, vm.name)

      // Resolve remote-node staging while HOLDING the claim (audit, TOCTOU): backups run
      // centrally on the master, so a VM on a remote node with LOCAL storage must have its
      // disk pulled in before qemu-img and dropped after (null = local/shared → no staging).
      // Reading nodeId under the BACKING_UP lock closes the race where a concurrent migration
      // commits a nodeId change between resolve and claim. An unreachable node throws here and
      // the catch below releases the marker synchronously.
      const stagingNode = await this.resolveRemoteStaging(params.vmId)

      // A SNAPSHOT backup writes an INTERNAL qcow2 snapshot into the source disk in place — it
      // produces no external artifact. Staging a remote disk to a throwaway master scratch copy
      // and snapshotting THAT would put the snapshot in a file we then delete (cleanupLocal),
      // yielding a silent-success but empty, unrestorable backup while the node's real disk is
      // never snapshotted (audit). A snapshot can only be taken on the node's live disk, so
      // refuse it here rather than produce phantom data protection.
      if (stagingNode && params.type === BackupType.SNAPSHOT) {
        throw new UserInputError(
          `SNAPSHOT backups are not supported for VM ${vm.name}: it runs on remote node ${stagingNode.name} ` +
          'with local storage, and an internal snapshot can only be created on the node\'s live disk. ' +
          'Use a FULL or INCREMENTAL backup instead.'
        )
      }

      // Validate user-supplied paths before they reach qemu-img / mkdir: keep the
      // destination within the backup root and the source disks within the disk dir
      // (path-traversal + leading-dash arg-injection guard).
      const destinationDir = this.assertWithinBase(
        params.destinationDir ?? path.join(this.backupRootDir, vm.id),
        this.backupRootDir,
        'destinationDir'
      )
      const diskBaseDir = path.resolve(process.env.INFINIZATION_DISK_DIR ?? '/var/lib/infinization/disks')
      // Cross-tenant IDOR guard (authz): every VM's qcow2 lives flat in the shared
      // disk base dir, so base-dir confinement alone would let a caller name another
      // VM's disk. Additionally bind each requested diskPath to THIS VM's own
      // configured disks — @Can only authorized the caller against input.vmId.
      const ownDisks = new Set(
        this.resolveDiskPaths(vm.configuration?.diskPaths).map((d) => path.resolve(d))
      )
      const safeDiskPaths = diskPaths.map((p) => {
        const resolved = this.assertWithinBase(p, diskBaseDir, 'diskPath')
        if (!ownDisks.has(resolved)) {
          throw new ForbiddenError(`diskPath does not belong to VM ${vm.id}: ${p}`)
        }
        return resolved
      })
      const compression = params.compression ?? DEFAULT_BACKUP_COMPRESSION

      // Pre-insert a row so in-flight backups are visible to the UI.
      const pending = await this.prisma.backup.create({
        data: {
          backupId: 'pending-' + Date.now() + '-' + vm.id.slice(0, 8),
          vmId: vm.id,
          type: params.type,
          status: BackupStatus.IN_PROGRESS,
          compression,
          destinationDir,
          description: params.description,
          tags: params.tags ?? undefined,
          parentBackupId: params.parentBackupId,
          scheduleId: params.scheduleId
        }
      })

      this.dispatch('started', pending, params.triggeredBy).catch((err: unknown) => logger.error(`Failed to dispatch 'started' event for backup ${pending.id}: ${err instanceof Error ? err.message : String(err)}`))

      // Kick off the real work in the background so the GraphQL mutation
      // returns immediately. UI polls the row for progress/status. Ownership of
      // the BACKING_UP marker transfers here: runBackupInBackground releases it
      // in its own `finally` whether the convert succeeds or fails.
      void this.runBackupInBackground({
        pendingId: pending.id,
        vmId: vm.id,
        diskPaths: safeDiskPaths,
        destinationDir,
        type: params.type,
        compression,
        description: params.description,
        parentBackupId: params.parentBackupId,
        tags: params.tags,
        triggeredBy: params.triggeredBy,
        stagingNode
      })

      return pending
    } catch (err) {
      // We threw before handing the marker to the background worker (failed probe,
      // path validation, or row insert). Release synchronously so the VM is never
      // left stuck in BACKING_UP.
      await this.releaseVm(params.vmId, BACKING_UP_STATUS)
      throw err
    }
  }

  /** Persist a backup row as FAILED and dispatch the 'failed' event. Never throws. */
  private async persistBackupFailure (pendingId: string, message: string, triggeredBy?: string): Promise<void> {
    try {
      const updated = await this.prisma.backup.update({
        where: { id: pendingId },
        data: { status: BackupStatus.FAILED, errorMessage: message, completedAt: new Date() }
      })
      this.dispatch('failed', updated, triggeredBy).catch((err: unknown) => logger.error(`Failed to dispatch 'failed' event for backup ${pendingId}: ${err instanceof Error ? err.message : String(err)}`))
    } catch (dbErr) {
      logger.error(`failed to mark backup ${pendingId} as FAILED: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`)
    }
  }

  /**
   * Runs the actual infinization backup, updates the row, dispatches events.
   * Never throws — all failures are persisted as `FAILED`.
   */
  private async runBackupInBackground (args: {
    pendingId: string
    vmId: string
    diskPaths: string[]
    destinationDir: string
    type: BackupType
    compression: BackupCompression
    description?: string
    parentBackupId?: string
    tags?: string[]
    triggeredBy?: string
    stagingNode?: StagingNode | null
  }): Promise<void> {
    const {
      pendingId, vmId, diskPaths, destinationDir, type, compression,
      description, parentBackupId, tags, triggeredBy, stagingNode
    } = args

    // This worker OWNS the BACKING_UP marker that createBackup claimed. Release
    // it in `finally` so the VM returns to OFF whether the convert succeeds,
    // fails, or this method takes the early `return` in the catch below (audit
    // H1: the marker must ALWAYS be cleared on this async path).
    // ONE staging instance owns the scratch it creates and is the ONLY thing that may
    // delete it (cleanupLocal removes only paths it staged — never a real disk).
    const staging = stagingNode ? new RemoteDiskStaging(this.diskBaseDir, vmId) : null
    // The disks qemu-img actually reads: the VM's real paths, or master-local SCRATCH
    // paths when the disk was staged in from a remote node.
    let sourcePaths = diskPaths
    try {
    // Remote VM + local storage: pull its disk(s) into master-local scratch before
    // qemu-img touches them, and drop the scratch in `finally`. A pull failure marks
    // the backup FAILED (same as a convert failure) and returns.
    if (staging && stagingNode) {
      try {
        sourcePaths = await staging.stageIn(stagingNode, diskPaths)
      } catch (err) {
        const message = `disk staging from node ${stagingNode.name} failed: ${err instanceof Error ? err.message : String(err)}`
        logger.error(`backup ${pendingId}: ${message}`)
        await this.persistBackupFailure(pendingId, message, triggeredBy)
        return
      }
    }
    // --- Live progress wiring -------------------------------------------------
    let lastPersisted = -1
    const persistIfChanged = (pct: number): void => {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)))
      if (clamped === lastPersisted) return
      lastPersisted = clamped
      this.prisma.backup.update({
        where: { id: pendingId },
        data: { progressPercent: clamped }
      }).catch((err: unknown) => logger.debug(`Failed to persist progress ${clamped}% for backup ${pendingId}: ${err instanceof Error ? err.message : String(err)}`))
    }

    const onProgress = (p: BackupProgress): void => {
      if (p.vmId !== vmId) return
      persistIfChanged(p.overallProgress)
    }
    this.infinization.on('progress', onProgress)

    let totalSourceBytes = 0
    for (const src of sourcePaths) {
      try {
        const st = await fs.stat(src)
        totalSourceBytes += st.size
      } catch { /* ignore — disk might not exist; poller will degrade */ }
    }

    // infinization creates a per-backup subdir with a UUID we don't know
    // until the operation finishes. Snapshot existing subdirs now and treat
    // any new one as ours.
    const startTime = Date.now()
    const preExistingSubdirs = await this.listSubdirs(destinationDir)
    const poller = setInterval(() => {
      void (async () => {
        if (totalSourceBytes <= 0) return
        try {
          const subdirs = await this.listSubdirs(destinationDir)
          const newSubdirs = subdirs.filter((d) => !preExistingSubdirs.includes(d))
          let destBytes = 0
          for (const sub of newSubdirs) {
            const subPath = path.join(destinationDir, sub)
            // Keep only subdirs created after our backup started.
            try {
              const st = await fs.stat(subPath)
              if (st.mtimeMs < startTime - 5_000) continue
            } catch { continue }
            try {
              const files = await fs.readdir(subPath)
              for (const f of files) {
                if (!/^disk-\d+\.qcow2(\.gz)?$/.test(f)) continue
                try {
                  const fst = await fs.stat(path.join(subPath, f))
                  destBytes += fst.size
                } catch { /* file vanished mid-scan */ }
              }
            } catch { /* subdir gone */ }
          }
          const pct = (destBytes / totalSourceBytes) * 100
          persistIfChanged(Math.min(95, pct))
        } catch { /* destinationDir not yet created */ }
      })()
    }, 2000)

    let result: InfinizationBackupResult
    try {
      result = await this.infinization.createBackup({
        vmId,
        diskPaths: sourcePaths,
        destinationDir,
        type,
        compression,
        description,
        parentBackupId,
        tags
      })
    } catch (err) {
      clearInterval(poller)
      this.infinization.off('progress', onProgress)
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`backup ${pendingId} failed: ${message}`)
      await this.persistBackupFailure(pendingId, message, triggeredBy)
      return
    }
    clearInterval(poller)
    this.infinization.off('progress', onProgress)

    const metadata = await this.safeGetMetadata(result.backupId, vmId)

    try {
      const completed = await this.prisma.backup.update({
        where: { id: pendingId },
        data: {
          backupId: result.backupId,
          status: result.success ? BackupStatus.COMPLETED : BackupStatus.FAILED,
          diskPaths: result.disks as unknown as object,
          totalSize: BigInt(result.totalSize ?? 0),
          totalOriginalSize: BigInt(metadata?.totalOriginalSize ?? 0),
          durationMs: result.durationMs,
          errorMessage: result.error,
          progressPercent: result.success ? 100 : lastPersisted >= 0 ? lastPersisted : 0,
          completedAt: new Date()
        }
      })
      this.dispatch(result.success ? 'completed' : 'failed', completed, triggeredBy)
        .catch((err: unknown) => logger.error(`Failed to dispatch '${result.success ? 'completed' : 'failed'}' event for backup ${pendingId}: ${err instanceof Error ? err.message : String(err)}`))
    } catch (dbErr) {
      logger.error(`failed to finalize backup ${pendingId}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`)
    }
    } finally {
      // Drop the master-local scratch copies (remote VM + local storage) — the backup
      // artifact already lives in the backup dir; the staged raw disk is scratch. Only
      // ever deletes paths `staging` actually created, never a real disk.
      if (staging) {
        await staging.cleanupLocal()
      }
      // Release the disk-op claim. Safe on every exit (normal completion, the
      // early `return` in the infinization-error catch, or an unexpected throw).
      await this.releaseVm(vmId, BACKING_UP_STATUS)
    }
  }

  /**
   * Restores a backup. Reads the original disk paths from the VM record by
   * default; callers can override for partial restores.
   */
  async restoreBackup (params: RestoreBackupParams): Promise<InfinizationRestoreResult> {
    const vm = await this.prisma.machine.findUnique({
      where: { id: params.vmId },
      select: {
        id: true,
        userId: true,
        configuration: { select: { diskPaths: true } }
      }
    })
    if (!vm) throw new Error(`VM ${params.vmId} not found`)

    // Cross-tenant restore guard (authz): the @Can decorator authorized the caller
    // only against params.vmId — the supplied backupId is otherwise unbound, and
    // infinization's metadata lookup scans ALL VM directories and restores the
    // first match. Bind the backupId to THIS VM via the DB (match either the
    // infinization backupId column or the DB row id) before touching any disk.
    const backupRow = await this.prisma.backup.findFirst({
      where: { vmId: params.vmId, OR: [{ backupId: params.backupId }, { id: params.backupId }] },
      select: { backupId: true }
    })
    if (!backupRow) throw new NotFoundError(`Backup ${params.backupId} not found for VM ${params.vmId}`)
    const resolvedBackupId = backupRow.backupId
    // Defense-in-depth: never let a backupId become a path-traversal segment.
    if (/[\\/]|\.\./.test(resolvedBackupId)) throw new UserInputError('invalid backupId')

    // Empty array means "restore every disk to its original location" — the UI
    // sends [] for a full restore. infinization requires the target list to
    // match the backup's disk count, so resolve the paths from the VM record.
    const rawDiskPaths = (params.diskPaths && params.diskPaths.length > 0)
      ? params.diskPaths
      : this.resolveDiskPaths(vm.configuration?.diskPaths)
    if (rawDiskPaths.length === 0) {
      throw new Error(`VM ${params.vmId} has no disk paths configured for restore`)
    }
    // Restore OVERWRITES these target paths — validate them (no path-traversal,
    // no leading-dash arg-injection) before any disk is touched.
    const diskBaseDir = path.resolve(process.env.INFINIZATION_DISK_DIR ?? '/var/lib/infinization/disks')
    // Cross-tenant IDOR guard (authz): restore OVERWRITES these targets, so bind
    // each requested diskPath to THIS VM's own configured disks — base-dir
    // confinement alone would let a caller clobber another tenant's live disk.
    const ownDisks = new Set(
      this.resolveDiskPaths(vm.configuration?.diskPaths).map((d) => path.resolve(d))
    )
    const diskPaths = rawDiskPaths.map((p) => {
      const resolved = this.assertWithinBase(p, diskBaseDir, 'diskPath')
      if (!ownDisks.has(resolved)) {
        throw new ForbiddenError(`diskPath does not belong to VM ${vm.id}: ${p}`)
      }
      return resolved
    })

    // ── Atomic claim (audit H1) ──────────────────────────────────────────────
    // Claim the STOPPED VM as RESTORING before touching any disk. A concurrent
    // powerOn (or another disk op) is refused for the whole restore. Unlike
    // createBackup the restore is fully awaited here, so claim + release live in
    // this method's try/finally — no ownership handoff.
    if (!await this.claimVm(params.vmId, RESTORING_STATUS)) {
      throw new VmBusyError(
        `VM ${vm.id} is busy or not stopped — cannot restore. ` +
        'Stop the VM (it must be OFF or ERROR) and ensure no other backup/restore/snapshot is in progress.'
      )
    }

    // Resolved under the RESTORING lock (audit, TOCTOU) — see the finally for cleanup.
    let stagingNode: StagingNode | null = null
    let staging: RemoteDiskStaging | null = null
    try {
      // Restoring over a live qcow2 corrupts it (qemu-img convert vs the VM's write
      // lock). Re-probe the live process — fail closed — AFTER the claim and BEFORE
      // any disk is touched, to catch a power-on that slipped in just before it.
      // NOTE: multi-disk restore is still non-atomic in infinization (a failure on
      // disk N leaves disks 0..N-1 already overwritten); making it temp+atomic-rename
      // is a tracked follow-up. The stopped-guard removes the dominant corruption path.
      await assertVmStopped(this.prisma, params.vmId)

      // Resolve remote-node staging while HOLDING the RESTORING claim (closes the race
      // where a migration commits a nodeId change between resolve and claim).
      stagingNode = await this.resolveRemoteStaging(params.vmId)
      staging = stagingNode ? new RemoteDiskStaging(this.diskBaseDir, vm.id) : null

      // Remote VM + local storage: restore materializes the disk into master-local SCRATCH
      // (never the real flat path), which we push out to the node afterwards. beginMaterialize
      // clears any stale scratch and registers the targets for cleanup. Local/shared VMs
      // restore straight into their real disk paths.
      const restoreTargets = (staging && stagingNode)
        ? await staging.beginMaterialize(diskPaths)
        : diskPaths

      // Honor overwriteExisting=false on the REMOTE path too (audit): staging redirects the
      // restore write to freshly-cleared scratch, so infinization's own TARGET_EXISTS guard
      // checks an empty file and never fires — and the node push overwrites unconditionally.
      // Mirror the local behavior by checking the node's REAL disk before doing any work.
      if (staging && stagingNode && !(params.overwriteExisting ?? false)) {
        for (const p of diskPaths) {
          if (await staging.remoteExists(stagingNode, p)) {
            throw new UserInputError(
              `Disk already exists on node ${stagingNode.name} and overwriteExisting is false: ${p}. ` +
              'Set overwriteExisting to replace it.'
            )
          }
        }
      }

      // Announce the restore so the UI (and other sessions) can show activity
      // while the — potentially multi-minute — copy runs. The mutation itself
      // stays awaited and returns the final result.
      const startedEventManager = getEventManager()
      if (startedEventManager) {
        startedEventManager.dispatchEvent('backups', 'started', {
          id: params.backupId,
          vmId: vm.id,
          restoring: true
        }).catch((err: unknown) => logger.warn(`backups:restore started event failed: ${err instanceof Error ? err.message : String(err)}`))
      }

      const result = await this.infinization.restoreBackup({
        vmId: vm.id,
        backupId: resolvedBackupId,
        diskPaths: restoreTargets,
        overwriteExisting: params.overwriteExisting ?? false,
        // Default false: a normal restore of a SNAPSHOT-type backup never clobbers
        // the live source disk in place — the library materializes to a distinct
        // target or refuses. Only an explicit operator opt-in flips this to true.
        allowInPlaceSnapshotRevert: params.allowInPlaceSnapshotRevert ?? false
      })

      // Remote VM: the disk was just materialized into master-local scratch — push it out
      // to the owning node (each disk atomic + sha256-verified on the node) so the restore
      // lands where the VM actually runs. A push failure surfaces as the restore error. The
      // node writes a temp then renames, so the disk that FAILED to push is untouched; on a
      // multi-disk VM, disks pushed before the failure are already committed (non-atomic —
      // see pushBack) but no data is lost: the backup artifact survives, so a retry restores.
      if (staging && stagingNode && result.success) {
        await staging.pushBack(stagingNode, diskPaths)
      }

      // Restore is an event on its own — the UI wants to know the VM changed.
      const payload = {
        id: params.backupId,
        vmId: vm.id,
        success: result.success,
        durationMs: result.durationMs
      }
      const eventManager = getEventManager()
      if (eventManager) {
        eventManager.dispatchEvent('backups', result.success ? 'completed' : 'failed', payload, params.triggeredBy)
          .catch((err: unknown) => logger.warn(`backups:restore event failed: ${err instanceof Error ? err.message : String(err)}`))
      }

      return result
    } finally {
      // Drop the master-local scratch copy (remote restore). Best-effort; only ever
      // removes scratch `staging` created, never a real disk.
      if (staging) await staging.cleanupLocal()
      // Always release the RESTORING claim — success, qemu-img failure, or throw.
      await this.releaseVm(params.vmId, RESTORING_STATUS)
    }
  }

  /** Lists persisted backups for a VM, newest first. */
  async listBackups (vmId: string): Promise<PrismaBackup[]> {
    return this.prisma.backup.findMany({
      where: { vmId },
      orderBy: { createdAt: 'desc' }
    })
  }

  /**
   * Returns the DB ids of any backups that name `backup` as their parent, i.e.
   * incrementals that would be orphaned (and unrestorable) if `backup` were
   * deleted. We match against BOTH the infinization `backupId` (the public id the
   * UI passes as a parent) AND the DB `id`, so the guard holds regardless of which
   * identifier a caller stored in `parentBackupId`. Audit H5.
   */
  async findDependentBackupIds (backup: Pick<PrismaBackup, 'id' | 'backupId' | 'vmId'>): Promise<string[]> {
    const parents = [backup.backupId, backup.id].filter((p): p is string => typeof p === 'string' && p.length > 0)
    const dependents = await this.prisma.backup.findMany({
      where: {
        vmId: backup.vmId,
        id: { not: backup.id },
        parentBackupId: { in: parents }
      },
      select: { id: true }
    })
    return dependents.map((d) => d.id)
  }

  /**
   * Deletes a backup from disk and from the database. Refuses (audit H5) when an
   * incremental backup still names this one as its parent: removing the base would
   * orphan the whole chain and make those increments unrestorable. Delete the
   * dependent increments first (or let retention age the whole chain out).
   */
  async deleteBackup (dbId: string, triggeredBy?: string): Promise<void> {
    const backup = await this.prisma.backup.findUnique({ where: { id: dbId } })
    if (!backup) throw new Error(`Backup ${dbId} not found`)

    const dependents = await this.findDependentBackupIds(backup)
    if (dependents.length > 0) {
      throw new BackupDependencyError(
        `Cannot delete backup ${backup.backupId}: ${dependents.length} incremental backup(s) ` +
        'depend on it. Deleting the base would orphan the chain and make those increments ' +
        'unrestorable. Delete the dependent increments first.',
        dependents
      )
    }

    try {
      await this.infinization.deleteBackup(backup.backupId, backup.vmId)
    } catch (err) {
      // Missing on disk is fine; keep DB consistent by still removing the row.
      if (!isNotFound(err)) throw err
      logger.warn(`Backup ${backup.backupId} not found on disk; removing DB row only`)
    }

    await this.prisma.backup.delete({ where: { id: dbId } })

    this.dispatch('delete', backup, triggeredBy).catch((err: unknown) => logger.error(`Failed to dispatch 'delete' event for backup ${dbId}: ${err instanceof Error ? err.message : String(err)}`))
  }

  /**
   * Forward infinization progress events to the global EventManager so the
   * UI gets real-time updates without polling.
   */
  private wireProgressEvents (): void {
    this.infinization.on('progress', (progress: BackupProgress) => {
      const eventManager = getEventManager()
      if (!eventManager) return
      eventManager.dispatchEvent('backups', 'progress', {
        id: progress.backupId,
        vmId: progress.vmId,
        currentDisk: progress.currentDisk,
        totalDisks: progress.totalDisks,
        diskProgress: progress.diskProgress,
        overallProgress: progress.overallProgress,
        estimatedTimeRemainingMs: progress.estimatedTimeRemainingMs
      }).catch((err: unknown) => logger.warn(`Failed to dispatch progress event for backup ${progress.backupId}: ${err instanceof Error ? err.message : String(err)}`))
    })
  }

  private async dispatch (
    action: 'started' | 'completed' | 'failed' | 'delete',
    backup: PrismaBackup,
    triggeredBy?: string
  ): Promise<void> {
    const eventManager = getEventManager()
    if (!eventManager) return
    await eventManager.dispatchEvent('backups', action, {
      id: backup.id,
      backupId: backup.backupId,
      vmId: backup.vmId,
      type: backup.type,
      status: backup.status,
      totalSize: Number(backup.totalSize),
      createdAt: backup.createdAt,
      completedAt: backup.completedAt ?? undefined,
      errorMessage: backup.errorMessage ?? undefined,
      scheduleId: backup.scheduleId ?? undefined
    }, triggeredBy)
  }

  private async safeGetMetadata (backupId: string, vmId: string): Promise<BackupMetadata | null> {
    try {
      return await this.infinization.getBackupMetadata(backupId, vmId)
    } catch (err) {
      logger.debug(`Could not read manifest for backup ${backupId}: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  }

  private resolveDiskPaths (raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === 'string')
    return []
  }

  /**
   * Validates a client-supplied path before it reaches qemu-img: rejects names
   * starting with '-' (would be parsed as a qemu-img option even with spawn/no
   * shell), normalizes, and ensures it stays within `baseDir` (path-traversal
   * guard). Returns the resolved absolute path. Reject — never silently strip —
   * so callers get a clear error.
   */
  private assertWithinBase (candidate: string, baseDir: string, label: string): string {
    if (path.basename(candidate).startsWith('-')) {
      throw new Error(`${label} must not start with '-': ${candidate}`)
    }
    const resolvedBase = path.resolve(baseDir)
    const resolved = path.resolve(candidate)
    if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
      throw new Error(`${label} escapes the allowed directory: ${candidate}`)
    }
    return resolved
  }

  /** Returns subdirectory names inside `dir`, or [] if it doesn't exist. */
  private async listSubdirs (dir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let instance: BackupService | null = null
let instancePrisma: PrismaClient | null = null

export function getBackupService (prisma: PrismaClient): BackupService {
  // Return existing singleton only when the same PrismaClient is requested.
  // This prevents accidentally sharing service state across different DB connections.
  if (instance !== null && instancePrisma === prisma) {
    return instance
  }
  instance = new BackupService(prisma)
  instancePrisma = prisma
  return instance
}

/** For tests only. Resets the singleton so a fresh instance is created next call. */
export function resetBackupService (): void {
  instance = null
  instancePrisma = null
  BackupService._progressWired = false
}

function isNotFound (err: unknown): boolean {
  if (err instanceof BackupError) return err.code === 'BACKUP_NOT_FOUND'
  return false
}
