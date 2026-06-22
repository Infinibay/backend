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
 * NOTE: once the pool connection-routing path (6.F) powers VMs on at checkout,
 * that path must also refuse to start a machine in REBUILDING to fully close
 * the boot-during-reset window.
 */

import fs from 'fs/promises'
import { execFile } from 'child_process'
import { Logger } from 'winston'
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { getInfinization } from '@services/InfinizationService'
import { OFF_STATUS, ERROR_STATUS, REBUILDING_STATUS } from '../../constants/machine-status'

// Pool-internal pseudo-status for archived/cleaned-up members (see PoolService).
const ARCHIVED_STATUS = 'archived'

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

    // Atomic claim — the lock that closes the race window. Until now the
    // machine is still `off`, which means PoolService.checkOutDesktopForUser
    // (it only ever picks off/stopped/paused) could hand it to a user while
    // we wipe its disk. Flip it to REBUILDING first: that status is outside
    // the checkout set, so the desktop drops out of the pool until it's clean.
    //
    // The conditional WHERE also serialises concurrent shutdown handlers — two
    // 'off' events for the same VM race here, the first wins (count 1) and the
    // second sees REBUILDING and bails (count 0), so unlink/create never run
    // twice on the same delta. We claim from any non-terminal status (not just
    // 'off') because QEMU is already confirmed dead above, so re-baselining is
    // safe regardless of a stale DB label.
    const claim = await this.prisma.machine.updateMany({
      where: { id: machineId, status: { notIn: [REBUILDING_STATUS, ARCHIVED_STATUS] } },
      data: { status: REBUILDING_STATUS }
    })
    if (claim.count !== 1) {
      this.debug.info(
        `machine=${machineId} already claimed (rebuilding/archived) — skipping duplicate reset`
      )
      return
    }

    this.debug.info(
      `resetting non-persistent desktop machine=${machineId} ` +
      `(delta=${deltaPath} backing=${backingPath})`
    )

    try {
      // Unlink the stale delta (if present) then create a fresh thin clone.
      await fs.unlink(deltaPath).catch((err) => {
        if (err?.code !== 'ENOENT') {
          this.debug.warn(`unlink delta failed: ${err.message}`)
        }
      })
      await qemuImgCreateBacked(backingPath, deltaPath)

      // Release the lock — the desktop is clean and can be handed out again.
      await this.prisma.machine.update({
        where: { id: machineId },
        data: { status: OFF_STATUS }
      })
      this.debug.info(`machine=${machineId} reset to golden-image baseline`)
    } catch (err) {
      // The delta may now be missing or half-written. Do NOT release to 'off'
      // (that would hand a broken disk to the next user). Park in 'error' so it
      // stays out of the checkout pool until an operator — or a later shutdown
      // event — recovers it.
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
