/**
 * DetectStuckInstalls Cron Job
 *
 * Host-side safety net for hung unattended installs. The "install finished"
 * signal (first infiniservice handshake -> setupComplete=true) only fires on
 * SUCCESS; its absence is exactly the hung state, so we cannot wait for it. A VM
 * whose install never completes keeps QEMU running forever with status stuck and
 * setupComplete=false and no error.
 *
 * This job fails an install that has been running longer than the per-OS budget
 * (getInstallationTimeout) since installStartedAt — BUT only after corroborating
 * that the install has actually stalled. The wall-clock budget is the OUTER
 * bound, not the trigger: a legitimately slow install (large image, slow mirror,
 * Windows cumulative updates) can legitimately exceed a generic budget while
 * still writing to disk, and force-killing it mid-write corrupts the qcow2 and
 * destroys hours of work (audit L141).
 *
 * Before force-stopping, we gate on a corroborating stalled-progress signal:
 *   1. Sample the install disk twice over a short sub-window (fs.stat the qcow2
 *      -> compare size+mtime). A growing or freshly-touched disk = live install.
 *   2. Query QMP run-state. A VM still actively 'running' its CPU is not hung in
 *      the way that warrants a kill (it may be mid-update with no disk write yet,
 *      so QMP-running alone keeps it alive for one more tick).
 * Only when the disk is unchanged across the window AND QMP is not actively
 * running do we force-stop. Purely host-side, OS-agnostic, survives backend
 * restarts (the anchor is a DB column).
 */
import logger from '@main/logger'
import fs from 'fs'
import path from 'path'
import { CronJob } from 'cron'
import {
  getInstallationTimeout,
  isValidOSType,
  OS_INSTALLATION_TIMEOUTS
} from '@infinibay/infinization'
import type { OSType } from '@infinibay/infinization'
import prisma from '../utils/database'
import { getEventManager } from '../services/EventManager'
import { getInfinization, getInfinizationConfig } from '../services/InfinizationService'

const debug = logger.child({ module: 'cron:detect-stuck-installs' })

/**
 * Sub-window over which we sample the install disk a second time to detect
 * write progress. Short enough to keep each tick cheap, long enough that even a
 * trickle of qemu-img writes bumps mtime/size. qcow2 metadata + L2 table writes
 * during an active install land well inside this window.
 */
const PROGRESS_SAMPLE_WINDOW_MS = 5000

/**
 * Conservative outer bound applied to VMs whose `os` is NOT one of the OSes with
 * a known install budget (OS_INSTALLATION_TIMEOUTS). The library's
 * getInstallationTimeout silently falls back to a 60-minute DEFAULT for any
 * unmapped OS — too aggressive for custom/large images, which is exactly when an
 * operator picks a non-standard OS. Rather than silently kill on a generic
 * budget, we apply a much larger bound (4h) and warn once per detection so the
 * operator sees the VM is unmapped. Still bounded so a truly wedged VM is
 * eventually reaped instead of running forever.
 */
const UNMAPPED_OS_TIMEOUT_MS = 4 * 60 * 60 * 1000

/**
 * A single fs.stat sample of the install disk. `null` when the disk could not be
 * stat'd (missing path or stat error).
 */
export interface DiskSample {
  /** File size in bytes. */
  size: number
  /** Last-modified time in epoch ms. */
  mtimeMs: number
}

/**
 * Pure decision function: given the elapsed time vs the budget, two disk samples
 * taken across the sub-window, and the QMP run-state, decide whether the install
 * is genuinely stalled and should be force-stopped.
 *
 * Exported for unit testing (no DB / no I/O) — see tests/unit/crons.
 *
 * Decision table (only reached once elapsed > budget):
 *  - disk grew or was touched (size or mtime changed)            -> KEEP (live)
 *  - QMP reports the guest CPU actively 'running'                -> KEEP (busy)
 *  - disk unchanged AND QMP not actively running                 -> STOP (stalled)
 *  - disk could not be sampled at all (both samples null)        -> STOP (the
 *      install disk vanished/unreadable past the budget — itself a failure;
 *      and we have no progress signal to justify keeping it alive)
 *
 * @param firstSample  disk stat taken at the start of the sub-window (or null)
 * @param secondSample disk stat taken at the end of the sub-window (or null)
 * @param qmpStatus    QMP run-state ('running'|'paused'|'shutdown'|...) or null
 * @returns true if the install should be force-stopped
 */
export function isInstallStalled (
  firstSample: DiskSample | null,
  secondSample: DiskSample | null,
  qmpStatus: string | null
): boolean {
  // Any measurable disk progress across the window => the install is alive.
  if (firstSample && secondSample) {
    const grew = secondSample.size !== firstSample.size
    const touched = secondSample.mtimeMs !== firstSample.mtimeMs
    if (grew || touched) {
      return false
    }
  }

  // No disk progress. If QMP says the guest CPU is still actively running, give
  // it one more tick rather than killing a VM that is busy (e.g. applying
  // updates in memory before the next disk flush).
  if (qmpStatus === 'running') {
    return false
  }

  // Disk unchanged (or unreadable) AND the guest is not actively running:
  // corroborated stall -> safe to force-stop.
  return true
}

/**
 * Resolve the primary install disk (qcow2) path for a candidate VM. The install
 * writes to disk0: configuration.diskPaths[0] when present, else the
 * deterministic `${diskDir}/${internalName}.qcow2` that CreateMachineServiceV2
 * uses. Returns null when no path can be resolved.
 */
function resolveInstallDiskPath (vm: {
  internalName?: string | null
  configuration?: { diskPaths?: unknown } | null
}): string | null {
  const diskPaths = vm.configuration?.diskPaths
  if (Array.isArray(diskPaths) && diskPaths.length > 0 && typeof diskPaths[0] === 'string') {
    return diskPaths[0]
  }
  if (vm.internalName) {
    return path.join(getInfinizationConfig().diskDir, `${vm.internalName}.qcow2`)
  }
  return null
}

/** fs.stat the disk into a DiskSample, or null on any error/missing path. */
async function sampleDisk (diskPath: string | null): Promise<DiskSample | null> {
  if (!diskPath) return null
  try {
    const st = await fs.promises.stat(diskPath)
    return { size: st.size, mtimeMs: st.mtimeMs }
  } catch {
    return null
  }
}

/** Resolve the effective install budget for a VM's OS (outer bound only). */
function resolveTimeoutMs (os: string): { timeoutMs: number; unmapped: boolean } {
  if (isValidOSType(os) && Object.prototype.hasOwnProperty.call(OS_INSTALLATION_TIMEOUTS, os)) {
    return { timeoutMs: getInstallationTimeout(os as OSType), unmapped: false }
  }
  // Unmapped/custom OS: do not silently inherit the library's 60-min default.
  return { timeoutMs: UNMAPPED_OS_TIMEOUT_MS, unmapped: true }
}

async function runDetectStuckInstalls (): Promise<void> {
  // Candidates: powered-on VMs still in the pre-setup install phase with a
  // recorded boot anchor and a live QEMU pid.
  const candidates = await prisma.machine.findMany({
    where: {
      status: { in: ['running', 'starting'] },
      configuration: {
        setupComplete: { not: true },
        installStartedAt: { not: null },
        qemuPid: { not: null }
      }
    },
    include: { configuration: true }
  })

  const now = Date.now()
  for (const vm of candidates) {
    const startedAt = vm.configuration?.installStartedAt
    if (!startedAt) continue

    const { timeoutMs, unmapped } = resolveTimeoutMs(vm.os ?? '')
    const elapsedMs = now - startedAt.getTime()
    if (elapsedMs <= timeoutMs) continue

    const minutes = Math.round(timeoutMs / 60000)
    if (unmapped) {
      debug.warn(
        `VM ${vm.name} (${vm.id}) has an unmapped OS '${vm.os ?? '<none>'}' — ` +
        `using a conservative ${minutes}m bound instead of the generic 60m default`
      )
    }

    // CORROBORATE before killing. Sample the install disk across a short window
    // and check QMP run-state; only force-stop a genuinely stalled install.
    const diskPath = resolveInstallDiskPath(vm)
    const firstSample = await sampleDisk(diskPath)
    await new Promise(resolve => setTimeout(resolve, PROGRESS_SAMPLE_WINDOW_MS))
    const secondSample = await sampleDisk(diskPath)

    let qmpStatus: string | null = null
    try {
      const infinization = await getInfinization()
      const status = await infinization.getVMStatus(vm.id)
      qmpStatus = status.qmpStatus
    } catch (err) {
      // QMP unreachable: leave qmpStatus null. A null run-state does NOT keep the
      // VM alive — only an explicit 'running' does — so an unreachable QMP falls
      // through to the disk-progress signal alone.
      debug.debug(`Could not query QMP run-state for VM ${vm.id}: ${(err as Error).message}`)
    }

    if (!isInstallStalled(firstSample, secondSample, qmpStatus)) {
      debug.info(
        `VM ${vm.name} (${vm.id}) exceeded its ${minutes}m install budget ` +
        `(${Math.round(elapsedMs / 60000)}m elapsed) but is still making progress ` +
        `(disk grew or QMP running) — NOT killing this tick`
      )
      continue
    }

    debug.warn(
      `VM ${vm.name} (${vm.id}) install exceeded its ${minutes}m budget ` +
      `(${Math.round(elapsedMs / 60000)}m elapsed) and shows no disk progress ` +
      `(qmp=${qmpStatus ?? 'unreachable'}) — marking as error`
    )

    // Best-effort force-stop the hung QEMU before flipping status.
    try {
      const infinization = await getInfinization()
      await infinization.stopVM(vm.id, { graceful: false, force: true })
    } catch (err) {
      debug.warn(`Failed to stop hung install VM ${vm.id}: ${(err as Error).message}`)
    }

    try {
      const updated = await prisma.machine.update({
        where: { id: vm.id },
        data: {
          status: 'error',
          configuration: {
            update: { lastError: `Installation timed out after ${minutes} minutes (no disk progress)` }
          }
        },
        include: { user: true, template: true, department: true, configuration: true }
      })
      try {
        await getEventManager().dispatchEvent('vms', 'update', updated)
      } catch (eventErr) {
        debug.warn(`Failed to emit update event for stuck-install VM ${vm.id}: ${(eventErr as Error).message}`)
      }
    } catch (err) {
      debug.error(`Failed to mark stuck-install VM ${vm.id} as error: ${(err as Error).message}`)
    }
  }
}

// Every 2 minutes. Cheap: a single indexed query that returns nothing once all
// installs have completed.
const DetectStuckInstallsJob = new CronJob('*/2 * * * *', async () => {
  try {
    await runDetectStuckInstalls()
  } catch (error) {
    debug.error(`DetectStuckInstalls tick failed: ${(error as Error).message}`)
  }
})

export default DetectStuckInstallsJob
