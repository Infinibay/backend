/**
 * InfinizationService - Singleton service for VM operations via infinization library.
 *
 * This service replaces direct libvirt-node usage with the infinization library,
 * providing a unified API for VM lifecycle management, health monitoring,
 * and state synchronization.
 *
 * @example
 * ```typescript
 * const infinization = await getInfinization()
 * const result = await infinization.createVM(config)
 * ```
 */

import logger from '@main/logger'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Infinization, VMEventData, type InfinizationConfig } from '@infinibay/infinization'
import prisma from '../utils/database'
import { getEventManager, EventAction } from './EventManager'
// Read-only import of the canonical disk-op markers (constants owned elsewhere).
import { DISK_OP_STATUSES, OFF_STATUS } from '../constants/machine-status'
import { reconcileOrphanedMoveMarkers } from './node/VMMigrationService'
import { loadOverlaySelfIdentity } from './node/overlayIdentity'
import { reconcileOrphanedMaintenanceLocks } from './MaintenanceService'
import { getGpuBrokerService, extractGpuPolicy, type DepartmentGpuPolicy } from './GpuBrokerService'

const debug = logger.child({ module: 'infinization-service' })

// Configuration from environment variables
const INFINIZATION_CONFIG = {
  diskDir: process.env.INFINIZATION_DISK_DIR || '/var/lib/infinization/disks',
  qmpSocketDir: process.env.INFINIZATION_SOCKET_DIR || '/opt/infinibay/sockets',
  pidfileDir: process.env.INFINIZATION_PID_DIR || '/opt/infinibay/pids',
  healthMonitorInterval: parseInt(process.env.INFINIZATION_HEALTH_INTERVAL || '30000', 10),
  autoStartHealthMonitor: process.env.INFINIZATION_AUTO_HEALTH !== 'false'
}

// Singleton instance
let infinizationInstance: Infinization | null = null
let initializationPromise: Promise<Infinization> | null = null

/**
 * Gets or creates the Infinization singleton instance.
 *
 * This function is safe to call multiple times - it will return the same
 * instance and handle concurrent initialization properly.
 *
 * @returns Promise resolving to the initialized Infinization instance
 * @throws Error if initialization fails
 */
export async function getInfinization (): Promise<Infinization> {
  // Return existing instance if available
  if (infinizationInstance) {
    return infinizationInstance
  }

  // Return pending initialization if in progress
  if (initializationPromise) {
    return initializationPromise
  }

  // Start initialization
  initializationPromise = initializeInfinization()

  try {
    infinizationInstance = await initializationPromise
    return infinizationInstance
  } finally {
    initializationPromise = null
  }
}

/**
 * Resolve the owning Node.id for THIS host so infinization can node-scope its
 * enumeration/orphan reads (the G0 fix). Looked up by node name
 * (`INFINIBAY_NODE_NAME` || hostname), matching LocalNodeRegistrationService.
 *
 * Returns `undefined` when the local node is not yet registered (e.g. a fresh
 * install before setupNode), in which case infinization runs UNSCOPED — which is
 * exactly the safe single-host behaviour (every local VM belongs to this host).
 * Read-only and fail-soft: a DB error must not block VM-service startup.
 */
// Cache of THIS host's resolved Node.id. A node's identity is stable for the
// process lifetime, so once we resolve it successfully we keep it — a later
// transient DB error must NOT make us "forget" who we are, because the
// NodeDispatcher relies on a stable answer to avoid wrong-host execution (G0):
// losing the identity for one VM op would make a remote-owned VM look routable
// locally. Only a successful resolution is cached; undefined (unregistered /
// transient error) is retried on the next call.
let cachedLocalNodeId: string | undefined

export async function resolveLocalNodeId (): Promise<string | undefined> {
  if (cachedLocalNodeId) return cachedLocalNodeId
  const name = process.env.INFINIBAY_NODE_NAME || os.hostname()
  try {
    const node = await prisma.node.findFirst({ where: { name }, select: { id: true } })
    if (!node) {
      logger.warn(`⚠️  Local Node '${name}' not registered yet — infinization runs UN-scoped (single-host). Register the node (setupNode) and restart to enable node scoping.`)
      return undefined
    }
    cachedLocalNodeId = node.id
    return node.id
  } catch (error) {
    logger.warn(`⚠️  Could not resolve local nodeId (continuing UN-scoped): ${String(error)}`)
    return undefined
  }
}

/**
 * Internal initialization function.
 */
async function initializeInfinization (): Promise<Infinization> {
  // Check if running as root (required for nftables)
  if (process.getuid && process.getuid() !== 0) {
    logger.error('')
    logger.error('╔══════════════════════════════════════════════════════════════╗')
    logger.error('║  ERROR: Backend must run as root to use infinization         ║')
    logger.error('║                                                              ║')
    logger.error('║  Infinization requires root permissions for:                 ║')
    logger.error('║    - nftables firewall management                            ║')
    logger.error('║    - TAP network device creation                             ║')
    logger.error('║    - QEMU process management                                 ║')
    logger.error('║                                                              ║')
    logger.error('║  Run with: sudo npm run dev                                  ║')
    logger.error('╚══════════════════════════════════════════════════════════════╝')
    logger.error('')
    process.exit(1)
  }

  // Ensure all required directories exist before creating Infinization instance.
  // These directories are used by VMLifecycle for:
  // - diskDir: VM disk images (qcow2 files)
  // - qmpSocketDir: QMP sockets, InfiniService virtio-serial channels, and guest-agent sockets
  // - pidfileDir: QEMU process PID files
  const fs = await import('fs')

  const requiredDirs = [
    { path: INFINIZATION_CONFIG.diskDir, name: 'disk' },
    { path: INFINIZATION_CONFIG.qmpSocketDir, name: 'socket' },
    { path: INFINIZATION_CONFIG.pidfileDir, name: 'pidfile' }
  ]

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir.path)) {
      fs.mkdirSync(dir.path, { recursive: true, mode: 0o755 })
      logger.info(`📁 Created ${dir.name} directory: ${dir.path}`)
    }
  }

  logger.info('🚀 Initializing Infinization service...')

  const eventManager = getEventManager()

  // Node identity for the G0 node-scoped reconcile/reaper. Resolved BEFORE
  // initialize() so the startup reconcile + orphan scan inside it are already
  // scoped to THIS node's VMs.
  const nodeId = await resolveLocalNodeId()

  const infinization = new Infinization({
    // Pre-existing structural false-positive: Prisma's $extends client
    // (ExtendedPrismaClient) is runtime-compatible with infinization's
    // PrismaClientLike, but its overloaded `$transaction` signature does not
    // structurally match the single-signature interface, so tsc rejects the
    // assignment. The cast asserts the (real) runtime compatibility.
    prismaClient: prisma as unknown as InfinizationConfig['prismaClient'],
    eventManager,
    nodeId,
    diskDir: INFINIZATION_CONFIG.diskDir,
    qmpSocketDir: INFINIZATION_CONFIG.qmpSocketDir,
    pidfileDir: INFINIZATION_CONFIG.pidfileDir,
    healthMonitorInterval: INFINIZATION_CONFIG.healthMonitorInterval,
    autoStartHealthMonitor: INFINIZATION_CONFIG.autoStartHealthMonitor,
    // Department L2 overlay (07-networking.md §1): the master realizes segments
    // in-process for the departments it hosts (it is a VXLAN peer in the single-
    // gateway model). Undefined if this host has no WireGuard key yet.
    overlay: loadOverlaySelfIdentity()
  })

  await infinization.initialize()

  logger.info('✅ Infinization service initialized successfully')
  logger.info(`   - Node scope: ${nodeId ?? 'UNSCOPED (single-host)'}`)
  logger.info(`   - Disk directory: ${INFINIZATION_CONFIG.diskDir}`)
  logger.info(`   - QMP socket directory: ${INFINIZATION_CONFIG.qmpSocketDir}`)
  logger.info(`   - Health monitor: ${INFINIZATION_CONFIG.autoStartHealthMonitor ? 'enabled' : 'disabled'}`)

  // Subscribe to QMP events for real-time status updates
  subscribeToVMEvents(infinization)

  // Department L2 overlay periodic reconcile (07-networking.md §5). The master is
  // the overlay control plane; re-drive every cross-node department's segments +
  // gateway election on a timer so drift self-heals — after a node/master reboot the
  // VXLAN/WireGuard devices are gone, and any swallowed best-effort push during
  // placement/teardown is otherwise never retried. Master-only (this path runs only
  // in the control-plane backend). Best-effort; dynamic import avoids a static cycle.
  if (process.env.INFINIBAY_DISABLE_OVERLAY_RECONCILE !== '1') {
    const OVERLAY_RECONCILE_MS = Number(process.env.INFINIBAY_OVERLAY_RECONCILE_MS) || 90_000
    // In-flight guard: a slow pass (a node blocking on the mTLS timeout across many
    // departments) can exceed the interval; skip a tick rather than stack concurrent
    // passes that multiply outbound connection pressure.
    let reconcileInFlight = false
    const runReconcile = async (): Promise<void> => {
      if (reconcileInFlight) return
      reconcileInFlight = true
      try {
        const { OverlayCoordinatorService } = await import('./network/OverlayCoordinatorService')
        await new OverlayCoordinatorService(prisma as unknown as import('@prisma/client').PrismaClient).reconcileAll()
      } catch (err) {
        logger.warn(`Overlay reconcile pass failed: ${String(err)}`)
      } finally {
        reconcileInFlight = false
      }
    }
    const overlayTimer = setInterval(() => { void runReconcile() }, OVERLAY_RECONCILE_MS)
    if (typeof overlayTimer.unref === 'function') overlayTimer.unref()
    void runReconcile() // once at startup so a reboot re-realizes segments promptly
  }

  // Reconcile VMs stuck in transient states ('starting'/'powering_off_update'/
  // 'rebuilding') after a previous backend/QEMU crash. ORDER IS LOAD-BEARING:
  // this must run BEFORE attachToRunningVMs so VMs it promotes back to 'running'
  // are then picked up by the running-VM attach pass. Log-but-continue so a
  // reconcile failure never blocks startup.
  try {
    const summary = await infinization.reconcileStartupState()
    if (summary.totalChecked > 0) {
      logger.info(
        `🔧 Startup reconcile: ${summary.promotedToRunning.length} promoted to running, ` +
        `${summary.resetToOff.length} reset to off, ${summary.resetToError.length} reset to error, ` +
        `${summary.skipped.length} skipped`
      )
    }
  } catch (error) {
    logger.error('❌ Startup transient-state reconciliation failed:', error)
  }

  // Reconcile disk-op "status-as-lock" markers orphaned by a hard crash. The
  // H1 fix sets transient Machine.status = backing_up/restoring/snapshotting
  // around an exclusive qemu-img operation; if the backend (or host) dies
  // mid-op, the row is left STUCK in that marker forever, and every power-on
  // path refuses it (isDiskOperationInProgress) — the VM is permanently
  // un-startable with no live qemu-img holding the lock. The claiming process
  // is gone with the crash, so it is safe to release the marker back to 'off'.
  // Log-but-continue so a reconcile failure never blocks startup.
  await reconcileOrphanedDiskOpMarkers()

  // Clear golden-image capture freeze markers (Machine.goldenImageBuildId) orphaned by a
  // crash. GoldenImageService stamps this on the source VM for the whole capture and
  // clears it in a finally; a crash mid-capture strands it, freezing the desktop
  // (no console/power/etc.) forever with no live capture to clear it. Same fresh-boot
  // rationale as the disk-op markers above — safe to release. Log-but-continue.
  await reconcileOrphanedGoldenImageBuilds()

  // Reclaim VMs orphaned in the 'moving' migration status-lock by a crash mid
  // cross-node copy: same rationale as the disk-op markers above — the claiming
  // migration process is gone, so the marker can never clear itself and the VM is
  // stuck un-startable. Log-but-continue so a reconcile failure never blocks boot.
  try {
    const reclaimed = await reconcileOrphanedMoveMarkers(prisma)
    if (reclaimed > 0) logger.info(`♻️ Reconciled ${reclaimed} orphaned VM move marker(s)`)
  } catch (err) {
    logger.error('⚠️ Failed to reconcile orphaned move markers:', err)
  }

  // Release maintenance-task execution locks stranded in RUNNING by a crash (the
  // in-request try/finally can't cover a process death) so the task can run again.
  try {
    await reconcileOrphanedMaintenanceLocks(prisma)
  } catch (err) {
    logger.error('⚠️ Failed to reconcile orphaned maintenance locks:', err)
  }

  // Re-attach to running VMs (e.g., after backend restart)
  await attachToRunningVMs(infinization)

  // Recover pool desktops left in a transient/locked status by a crash:
  // 'rebuilding' -> 'error' (delta possibly half-written), stale 'starting' ->
  // 'off' (stranded boot). Dynamic import matches the lazy pattern above.
  try {
    const { reconcilePoolStatusesOnStartup } = await import('./pool/PoolReconcileService')
    await reconcilePoolStatusesOnStartup(prisma)
  } catch (err) {
    logger.warn(`Pool status reconcile failed: ${(err as Error).message}`)
  }

  return infinization
}

/**
 * Subscribes to infinization EventHandler events and forwards them to the backend EventManager.
 *
 * This enables real-time VM status updates via WebSocket instead of relying on polling.
 */
function subscribeToVMEvents (infinization: Infinization): void {
  const eventHandler = infinization.getEventHandler()
  const eventManager = getEventManager()

  // Map infinization status to backend event actions
  const statusToAction: Record<string, EventAction> = {
    'off': 'power_off',
    'running': 'power_on',
    'suspended': 'suspend'
  }

  // Listen for all VM events
  eventHandler.on('vm:event', async (eventData: VMEventData) => {
    const action: EventAction = statusToAction[eventData.newStatus] || 'update'

    debug.debug(`QMP event: ${eventData.event} for VM ${eventData.vmId} (${eventData.previousStatus} -> ${eventData.newStatus})`)

    try {
      // Fetch full VM data for the event payload
      const vm = await prisma.machine.findUnique({
        where: { id: eventData.vmId },
        include: {
          user: true,
          template: true,
          department: true,
          configuration: true
        }
      })

      if (vm) {
        await eventManager.dispatchEvent('vms', action, vm)
        debug.debug(`Dispatched vms:${action} event for VM ${vm.name}`)
      }

      // Non-persistent pool reset: when a pool-owned VM shuts down,
      // wipe its qcow2 delta so the next connect sees the golden-
      // image baseline. Fire-and-forget — failures shouldn't block
      // other event handlers.
      if (eventData.newStatus === 'off' && vm?.poolId) {
        void (async () => {
          try {
            const { getNonPersistentResetService } = await import('./pool/NonPersistentResetService')
            const resetService = getNonPersistentResetService(prisma)
            await resetService.handleShutdown(eventData.vmId)
          } catch (err) {
            debug.warn(`Non-persistent reset failed for VM ${eventData.vmId}: ${(err as Error).message}`)
          }
        })()
      }
    } catch (error) {
      debug.error(`Failed to dispatch event for VM ${eventData.vmId}: ${error}`)
    }
  })

  // Fast-path hung-install detection: a boot/install RESET loop during the
  // pre-setup phase marks the VM 'error' without waiting out the whole per-OS
  // install timeout. QMP RESET is emitted from QEMU start (before any OS).
  eventHandler.on('vm:reset', (data: VMEventData) => {
    void (async () => {
      try {
        const { handleInstallReset } = await import('./installMonitor/InstallResetTracker')
        await handleInstallReset(prisma, data.vmId)
      } catch (err) {
        debug.warn(`install reset handler failed for VM ${data?.vmId}: ${(err as Error).message}`)
      }
    })()
  })

  // Listen for disconnect events (QMP socket closed). OBSERVABILITY ONLY: with
  // the EventHandler reconnect fix (audit H9, owned by LIB-CORE2), a transient
  // QMP socket blip no longer detaches the VM — the library keeps it attached
  // and attempts to reconnect, emitting 'vm:reconnect' on success or 'vm:stale'
  // on permanent failure. So a 'vm:disconnect' here is NOT a crash signal and
  // must NOT trigger any state mutation; we only log it. Crash detection is the
  // HealthMonitor's job; the actionable signal is 'vm:stale' below.
  eventHandler.on('vm:disconnect', (data: { vmId: string; timestamp?: Date }) => {
    debug.debug(`QMP disconnect for VM ${data.vmId} (transient — awaiting reconnect/stale)`)
  })

  // QMP reconnected after a transient blip. State changes (SHUTDOWN/POWERDOWN)
  // emitted while the socket was down may have been missed, so re-sync this VM's
  // status from the source of truth and re-dispatch to the UI. The library
  // performs its own internal re-sync (queryStatus -> updateStatusDirect); here
  // we additionally surface the recovered state to the frontend.
  //
  // CROSS-UNIT CONTRACT (LIB-CORE2): event name 'vm:reconnect'. The library
  // currently emits a raw QMPClient 'reconnect' and re-emits 'vm:stale' on
  // failure; the parallel H9 fix is expected to re-emit reconnect success as
  // 'vm:reconnect'. Subscribing now is forward-compatible (a no-match handler
  // is harmless). If the library names it differently, update this string.
  eventHandler.on('vm:reconnect', (data: { vmId: string; timestamp?: Date }) => {
    void (async () => {
      logger.info(`🔌 QMP reconnected for VM ${data.vmId} — re-syncing status`)
      try {
        const vm = await prisma.machine.findUnique({
          where: { id: data.vmId },
          include: { user: true, template: true, department: true, configuration: true }
        })
        if (vm) {
          await eventManager.dispatchEvent('vms', 'update', vm)
        }
      } catch (err) {
        debug.warn(`Failed to re-sync VM ${data.vmId} after reconnect: ${(err as Error).message}`)
      }
    })()
  })

  // QMP reconnect exhausted its attempts: the client is permanently dead and
  // state sync for this VM has stopped. The DB row will silently drift from
  // reality until an operator re-attaches/reconciles. Surface it as an
  // actionable, persistent warning by recording it on the VM's lastError and
  // re-dispatching so the UI can flag the machine as needs-attention. We do NOT
  // flip Machine.status here — the process may well still be running; we only
  // mark that we've lost our window onto it.
  //
  // CROSS-UNIT CONTRACT (LIB-CORE2): event name 'vm:stale' with payload
  // { vmId, reason }. Verified emitted today at EventHandler reconnectFailed
  // listener (infinization/src/sync/EventHandler.ts:196).
  eventHandler.on('vm:stale', (data: { vmId: string; reason?: string }) => {
    void (async () => {
      const reason = data.reason ?? 'qmp_state_sync_lost'
      logger.warn(
        `⚠️  VM ${data.vmId} is STALE (${reason}): QMP state sync stopped — ` +
        'status may be drifting. Needs operator re-attach/reconcile.'
      )
      try {
        const updated = await prisma.machine.update({
          where: { id: data.vmId },
          data: {
            configuration: {
              update: { lastError: `QMP state sync lost (${reason}) — VM status may be stale; needs re-attach` }
            }
          },
          include: { user: true, template: true, department: true, configuration: true }
        })
        await eventManager.dispatchEvent('vms', 'update', updated)
      } catch (err) {
        debug.warn(`Failed to mark VM ${data.vmId} as stale: ${(err as Error).message}`)
      }
    })()
  })

  logger.info('📡 Subscribed to QMP events for real-time status updates')
}

/**
 * Releases disk-op "status-as-lock" markers (backing_up / restoring /
 * snapshotting) orphaned by a hard crash, flipping the affected Machine rows
 * back to 'off'.
 *
 * Rationale: these markers are claimed only around an exclusive qemu-img
 * operation on a STOPPED VM (see constants/machine-status.ts). They are not QEMU
 * states — there is never a live QEMU process to probe. If the process that set
 * the marker dies before clearing it, the row is stuck and refused by every
 * power-on path (isDiskOperationInProgress). On a fresh boot no disk op can
 * still be in flight (the backend just started), so any surviving marker is by
 * definition orphaned and safe to clear to 'off'. We deliberately reset to
 * 'off' (not 'error'): the on-disk qcow2 may be fine; the operator can simply
 * retry the operation. Errors are logged and swallowed so startup proceeds.
 *
 * @returns the count of rows reset (for logging/tests)
 */
export async function reconcileOrphanedDiskOpMarkers (): Promise<number> {
  try {
    const stuck = await prisma.machine.findMany({
      where: { status: { in: DISK_OP_STATUSES as unknown as string[] } },
      select: { id: true, name: true, status: true }
    })

    if (stuck.length === 0) {
      return 0
    }

    for (const vm of stuck) {
      logger.warn(
        `🔧 VM ${vm.name} (${vm.id}) left in transient disk-op status '${vm.status}' ` +
        `by a crash — resetting to '${OFF_STATUS}' (operation can be retried)`
      )
    }

    const result = await prisma.machine.updateMany({
      where: { status: { in: DISK_OP_STATUSES as unknown as string[] } },
      data: { status: OFF_STATUS }
    })

    logger.info(`🔧 Disk-op marker reconcile: reset ${result.count} orphaned VM(s) to '${OFF_STATUS}'`)
    return result.count
  } catch (error) {
    logger.error('❌ Disk-op marker reconciliation failed:', error)
    return 0
  }
}

/**
 * Clear golden-image build freeze markers (Machine.goldenImageBuildId) orphaned by a
 * hard crash. GoldenImageService stamps the in-progress GoldenImage id on the source VM
 * for the WHOLE capture and clears it in a finally; if the backend (or host) dies
 * mid-capture, the fire-and-forget orchestration is gone and the marker would freeze the
 * desktop forever (every guard refuses console/power/delete/move/hardware). On a fresh
 * boot no capture can still be in flight, so any surviving marker is orphaned: clear it,
 * and fail its GoldenImage row if still 'building' (its disk was never sealed). Errors
 * are logged and swallowed so startup proceeds.
 *
 * @returns the count of markers cleared (for logging/tests)
 */
export async function reconcileOrphanedGoldenImageBuilds (): Promise<number> {
  try {
    const stuck = await prisma.machine.findMany({
      where: { goldenImageBuildId: { not: null } },
      select: { id: true, name: true, goldenImageBuildId: true }
    })

    if (stuck.length === 0) {
      return 0
    }

    for (const vm of stuck) {
      logger.warn(
        `🔧 VM ${vm.name} (${vm.id}) left frozen for golden-image build ` +
        `${vm.goldenImageBuildId} by a crash — clearing the marker (build never finished)`
      )
      // Fail the orphaned build so it doesn't sit 'building' forever.
      if (vm.goldenImageBuildId) {
        await prisma.goldenImage.updateMany({
          where: { id: vm.goldenImageBuildId, status: 'building' },
          data: {
            status: 'failed',
            notes: '[build failed] backend restarted while the capture was in progress'
          }
        })
      }
    }

    const result = await prisma.machine.updateMany({
      where: { goldenImageBuildId: { not: null } },
      data: { goldenImageBuildId: null }
    })

    logger.info(`🔧 Golden-image build reconcile: cleared ${result.count} orphaned freeze marker(s)`)
    return result.count
  } catch (error) {
    logger.error('❌ Golden-image build marker reconciliation failed:', error)
    return 0
  }
}

/**
 * Re-attaches to VMs that were running before the backend was restarted.
 *
 * This ensures we receive QMP events for VMs that are still running.
 */
async function attachToRunningVMs (infinization: Infinization): Promise<void> {
  try {
    const runningVMs = await prisma.machine.findMany({
      where: { status: 'running' },
      include: { configuration: true }
    })

    if (runningVMs.length === 0) {
      logger.info('📋 No running VMs to attach to')
      return
    }

    logger.info(`📋 Attaching to ${runningVMs.length} running VM(s)...`)

    for (const vm of runningVMs) {
      const qmpSocketPath = vm.configuration?.qmpSocketPath

      if (!qmpSocketPath) {
        debug.debug(`VM ${vm.name} (${vm.id}) has no QMP socket path, skipping`)
        continue
      }

      try {
        await infinization.attachToRunningVM(vm.id, qmpSocketPath)
        debug.debug(`Attached to VM ${vm.name} (${vm.id})`)
      } catch (error) {
        // VM might have crashed between DB query and attach attempt
        debug.warn(`Failed to attach to VM ${vm.name} (${vm.id}): ${error}`)
      }

      // infinigpu: re-adopt a GPU VM's surviving device server and rebuild its host broker
      // ticket. The device (detached) + QEMU (-daemonize) keep running across a backend restart,
      // so the guest's GPU never drops — but the in-memory broker ledger and the console
      // resolver's pixel-port lookup are lost on restart. Restoring them here keeps `Connect`
      // working and the shared-GPU capacity accounting correct after a restart. A VM with no
      // GPU (or whose device did NOT survive) returns undefined and is skipped — fail-open, this
      // must never block QMP reconciliation.
      try {
        const pixelPort = await infinization.reattachInfinigpuServer(vm.id)
        if (pixelPort != null && vm.departmentId) {
          const dept = await prisma.department.findUnique({ where: { id: vm.departmentId } })
          const policy: DepartmentGpuPolicy | null = dept ? extractGpuPolicy(dept as unknown as DepartmentGpuPolicy) : null
          if (policy?.gpuEnabled) {
            getGpuBrokerService().readmit({ vmId: vm.id, departmentId: vm.departmentId, policy, pixelPort })
            debug.debug(`Re-adopted infinigpu device + restored broker ticket for VM ${vm.name} (${vm.id}) on pixelPort ${pixelPort}`)
          }
        }
      } catch (gpuErr) {
        debug.warn(`infinigpu re-adopt failed for VM ${vm.name} (${vm.id}): ${gpuErr}`)
      }
    }

    logger.info('✅ Finished attaching to running VMs')
  } catch (error) {
    logger.error('❌ Error attaching to running VMs:', error)
    // Don't fail initialization - health monitor will catch crashed VMs
  }
}

/**
 * Shuts down the Infinization service gracefully.
 *
 * Should be called during application shutdown to clean up resources.
 */
export async function shutdownInfinization (): Promise<void> {
  if (!infinizationInstance) {
    return
  }

  logger.info('🛑 Shutting down Infinization service...')

  try {
    await infinizationInstance.shutdown()
    logger.info('✅ Infinization service shut down successfully')
  } catch (error) {
    logger.error('❌ Error shutting down Infinization:', error)
    throw error
  } finally {
    infinizationInstance = null
    initializationPromise = null
  }
}

/**
 * Checks if Infinization is initialized.
 */
export function isInfinizationInitialized (): boolean {
  return infinizationInstance !== null && infinizationInstance.isInitialized()
}

/**
 * Gets the current configuration (for debugging/logging).
 */
export function getInfinizationConfig (): typeof INFINIZATION_CONFIG {
  return { ...INFINIZATION_CONFIG }
}

/**
 * Ejects all CD-ROM devices from a VM after installation completes.
 *
 * This removes Windows ISO, VirtIO drivers ISO, and autounattend ISO.
 * After ejection, temporary ISOs in the temp directory are deleted.
 * The operation is non-blocking and tolerant to failures.
 *
 * @param vmId - The VM identifier
 */
export async function ejectAllCdroms (vmId: string): Promise<void> {
  const infinization = await getInfinization()
  const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
  const tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR ?? path.join(baseDir, 'iso', 'temp')

  try {
    // Query block devices to find CD-ROMs
    const blocks = await infinization.queryBlockDevices(vmId)
    const tempIsosToDelete: string[] = []

    // Find and eject all CD-ROM devices
    for (const block of blocks) {
      if (block.removable) {
        // Capture ISO path before ejecting if it's in the temp directory
        if (block.inserted?.file) {
          const isoPath = block.inserted.file
          if (isoPath.startsWith(tempIsoDir)) {
            tempIsosToDelete.push(isoPath)
          }
        }

        debug.debug(`Ejecting CD-ROM device: ${block.device} from VM ${vmId}`)
        try {
          await infinization.ejectCdrom(vmId, block.device)
          debug.debug(`CD-ROM device ${block.device} ejected successfully`)
        } catch (ejectError: any) {
          // Individual eject failures shouldn't stop the process
          debug.warn(`Failed to eject ${block.device}: ${ejectError.message}`)
        }
      }
    }

    debug.debug(`All CD-ROMs ejected from VM ${vmId}`)

    // Delete temporary ISOs after successful ejection
    for (const isoPath of tempIsosToDelete) {
      try {
        await fs.promises.unlink(isoPath)
        debug.debug(`Deleted temp ISO: ${isoPath}`)
      } catch (unlinkError: any) {
        // Non-fatal: log warning but don't fail the operation
        debug.warn(`Failed to delete temp ISO ${isoPath}: ${unlinkError.message}`)
      }
    }

    if (tempIsosToDelete.length > 0) {
      debug.debug(`Cleaned up ${tempIsosToDelete.length} temporary ISO(s) for VM ${vmId}`)
    }
  } catch (error: any) {
    debug.warn(`Failed to eject CD-ROMs from VM ${vmId}: ${error.message}`)
    // Non-fatal: VM can continue running with ISOs mounted
  }
}

/** Resolve the temp-ISO age threshold from env (INFINIBAY_ISO_TEMP_MAX_AGE_HOURS), default 24h. */
function resolveIsoTempMaxAgeMs (): number {
  const hours = Number(process.env.INFINIBAY_ISO_TEMP_MAX_AGE_HOURS)
  return (Number.isFinite(hours) && hours > 0 ? hours : 24) * 60 * 60 * 1000
}

/**
 * Age-based reaper for orphaned unattended-install ISOs in the temp dir.
 *
 * The normal deleter ({@link ejectAllCdroms}) only runs when a guest's infiniservice
 * agent handshakes (→ setupComplete). A VM whose agent never installs, or that is
 * deleted before install completes, would otherwise leak its ~1.2GB temp ISO forever
 * (the VM-delete path cannot target it — the path is a random UUID not persisted to
 * the DB). A successful install ejects within minutes, so any temp ISO whose mtime is
 * older than `maxAgeMs` (default 24h, well past the longest install timeout) is
 * definitively orphaned and safe to remove. On Linux, unlinking an ISO still held open
 * by a running QEMU is safe — QEMU keeps its fd and the space frees when it closes —
 * so this can never corrupt an in-progress install.
 *
 * Best-effort and non-throwing: safe to call at startup and on an interval.
 *
 * @param maxAgeMs - Age threshold; files with mtime older than this are deleted.
 * @returns number of ISOs reclaimed.
 */
export async function reapStaleTempIsos (maxAgeMs: number = resolveIsoTempMaxAgeMs()): Promise<number> {
  const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
  const tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR ?? path.join(baseDir, 'iso', 'temp')

  let entries: string[]
  try {
    entries = await fs.promises.readdir(tempIsoDir)
  } catch (err: any) {
    // ENOENT just means no VM has ever generated a temp ISO yet — nothing to do.
    if (err?.code !== 'ENOENT') {
      debug.warn(`Temp-ISO janitor: cannot read ${tempIsoDir}: ${err?.message ?? err}`)
    }
    return 0
  }

  const now = Date.now()
  let reclaimed = 0
  for (const name of entries) {
    if (!name.endsWith('.iso')) continue
    const isoPath = path.join(tempIsoDir, name)
    try {
      const st = await fs.promises.stat(isoPath)
      if (!st.isFile()) continue
      const ageMs = now - st.mtimeMs
      if (ageMs < maxAgeMs) continue
      await fs.promises.unlink(isoPath)
      reclaimed++
      debug.info(`Temp-ISO janitor: reclaimed orphaned ${isoPath} (age ${Math.round(ageMs / 3_600_000)}h)`)
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        debug.warn(`Temp-ISO janitor: failed on ${isoPath}: ${err?.message ?? err}`)
      }
    }
  }
  if (reclaimed > 0) {
    debug.info(`Temp-ISO janitor: reclaimed ${reclaimed} orphaned temp ISO(s) from ${tempIsoDir}`)
  }
  return reclaimed
}

