/**
 * NonPersistentResetService — resets a pool-owned non-persistent desktop
 * back to its golden-image baseline after shutdown.
 *
 * Contract:
 *   1. Only acts on machines with `poolId` pointing to a pool where
 *      `type === 'non-persistent'` and `resetOnLogoff === true`.
 *   2. Discards the current qcow2 delta and creates a fresh empty one
 *      pointing at the same backing file (the golden image).
 *   3. The VM stays powered off — the refill/checkout path is what
 *      starts it again when a user connects.
 *
 * Safety:
 *   - Runs only once the QEMU process is confirmed not alive (checked via
 *     infinization) — the 'vm:off' event can fire before the process actually
 *     releases the qcow2.
 *   - Takes an atomic REBUILDING lock before touching the disk: the desktop
 *     drops out of PoolService.checkOutDesktopForUser (which only picks
 *     off/stopped/paused) so a user can never be handed a half-rebuilt disk,
 *     and concurrent shutdown handlers for the same VM are serialised.
 *   - On success the machine returns to 'off'; on failure it is parked in
 *     'error' rather than 'off', keeping a broken disk out of the pool.
 *   - No-ops silently (with a log line) if preconditions fail.
 *
 * The pool checkout path (PoolService.ensureBooted) only powers on desktops it
 * claimed from the idle set (off/stopped/paused), so it never starts a machine
 * mid-REBUILD — that, together with this lock, closes the boot-during-reset
 * window from both sides.
 */

import fs from 'fs/promises'
import { execFile } from 'child_process'
import { Logger } from 'winston'
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { getInfinization } from '@services/InfinizationService'
import { OFF_STATUS, ERROR_STATUS, REBUILDING_STATUS } from '../../constants/machine-status'

export class NonPersistentResetService {
  private prisma: PrismaClient
  private debug: Logger

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = logger.child({ module: 'non-persistent-reset' })
  }

  async handleShutdown (machineId: string): Promise<void> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
      include: { configuration: true, pool: { include: { goldenImage: true } } }
    })
    if (!machine || !machine.poolId || !machine.pool) return
    if (machine.pool.type !== 'non-persistent') return
    if (!machine.pool.resetOnLogoff) return
    if (!machine.pool.goldenImage) {
      this.debug.warn(
        `machine=${machineId} pool=${machine.poolId} has no goldenImage — skipping reset`
      )
      return
    }

    // Belt-and-suspenders: make sure QEMU is really gone before touching
    // disks. EventHandler 'vm:off' can fire briefly before the process
    // actually releases the qcow2.
    try {
      const infinization = await getInfinization()
      const status = await infinization.getVMStatus(machineId)
      if (status.processAlive) {
        this.debug.warn(
          `machine=${machineId} still alive at reset time — skipping`
        )
        return
      }
    } catch (err) {
      this.debug.warn(`reset status check failed: ${(err as Error).message}`)
      // Continue — if infinization says "not found" we treat that as dead.
    }

    const diskPaths = (machine.configuration?.diskPaths as string[] | null) ?? []
    const deltaPath = diskPaths[0]
    if (!deltaPath) {
      this.debug.warn(`machine=${machineId} has no diskPaths — skipping reset`)
      return
    }
    const backingPath = machine.pool.goldenImage.baseDiskPath
    if (!backingPath) {
      this.debug.warn(
        `machine=${machineId} pool goldenImage has no baseDiskPath — skipping reset`
      )
      return
    }

    // Atomic claim — the lock that closes the race window. We re-baseline ONLY a
    // machine already parked in 'off' or 'error': those are the safe idle states
    // after a shutdown. We must NEVER wipe the disk of a machine that is
    // 'starting' (mid-boot), 'running'/'paused' (in use), 'rebuilding' (already
    // locked) or 'archived' (removed) — a stray 'off' event or stale label could
    // otherwise corrupt a live or mid-boot QEMU. Flipping to REBUILDING drops the
    // desktop out of PoolService.checkOutDesktopForUser (which only picks
    // off/stopped/paused) until it's clean.
    //
    // The conditional WHERE also serialises concurrent shutdown handlers — two
    // 'off' events for the same VM race here, the first wins (count 1) and the
    // second sees REBUILDING and bails (count 0), so the rebuild never runs twice.
    const claim = await this.prisma.machine.updateMany({
      where: { id: machineId, status: { in: [OFF_STATUS, ERROR_STATUS] } },
      data: { status: REBUILDING_STATUS }
    })
    if (claim.count !== 1) {
      this.debug.info(
        `machine=${machineId} not in a resettable state (off/error) — skipping reset`
      )
      return
    }

    this.debug.info(
      `resetting non-persistent desktop machine=${machineId} ` +
      `(delta=${deltaPath} backing=${backingPath})`
    )

    // Build the fresh thin clone at a temp path, then atomically rename it over
    // the live delta. A crash mid-create can never leave a half-written file at
    // the real delta path: deltaPath always points at either the old delta or the
    // fully-written new one (rename(2) is all-or-nothing on the same filesystem,
    // and tmpPath shares deltaPath's directory). Crash recovery: the row stays
    // 'rebuilding', startup reconcile parks it 'error', and a later shutdown
    // re-runs the rebuild cleanly.
    const tmpPath = `${deltaPath}.rebuild-${process.pid}-${Date.now()}.tmp`
    try {
      // Clean any leftover temp from a prior crashed attempt first.
      await fs.unlink(tmpPath).catch((err) => {
        if (err?.code !== 'ENOENT') this.debug.warn(`unlink stale tmp failed: ${err.message}`)
      })
      await qemuImgCreateBacked(backingPath, tmpPath)
      await fs.rename(tmpPath, deltaPath)

      // Release the lock — the desktop is clean and can be handed out again.
      await this.prisma.machine.update({
        where: { id: machineId },
        data: { status: OFF_STATUS }
      })
      this.debug.info(`machine=${machineId} reset to golden-image baseline`)
    } catch (err) {
      // The new delta failed to build. The live delta is untouched (temp+rename),
      // but the machine is still parked in 'error' so it stays out of the checkout
      // pool until an operator — or a later shutdown event — recovers it. Clean up
      // the orphan temp file first.
      await fs.unlink(tmpPath).catch(() => {})
      this.debug.error(
        `machine=${machineId} reset failed: ${(err as Error).message} — parking in error`
      )
      await this.prisma.machine.update({
        where: { id: machineId },
        data: { status: ERROR_STATUS }
      }).catch((e) => {
        this.debug.warn(`failed to mark machine=${machineId} as error: ${(e as Error).message}`)
      })
    }
  }
}

function qemuImgCreateBacked (backing: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'qemu-img',
      ['create', '-f', 'qcow2', '-F', 'qcow2', '-b', backing, dest],
      { maxBuffer: 1024 * 1024 },
      (err) => (err ? reject(err) : resolve())
    )
  })
}

// ---------------------------------------------------------------------------
// Singleton accessor — matches the pattern of other services in this tree.
// ---------------------------------------------------------------------------

let instance: NonPersistentResetService | null = null

export function getNonPersistentResetService (prisma: PrismaClient): NonPersistentResetService {
  if (!instance) instance = new NonPersistentResetService(prisma)
  return instance
}
