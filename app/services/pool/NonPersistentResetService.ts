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
 *   - Runs only when `Machine.status === 'off'` AND the QEMU process is
 *     not alive (double-checked via infinization).
 *   - No-ops silently (with a log line) if preconditions fail. A future
 *     run on the same event is safe — recreating a qcow2 that already
 *     matches the backing state is idempotent.
 */

import fs from 'fs/promises'
import { execFile } from 'child_process'
import { Logger } from 'winston'
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { getInfinization } from '@services/InfinizationService'

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

    this.debug.info(
      `resetting non-persistent desktop machine=${machineId} ` +
      `(delta=${deltaPath} backing=${backingPath})`
    )

    // Unlink the stale delta (if present) then create a fresh thin clone.
    await fs.unlink(deltaPath).catch((err) => {
      if (err?.code !== 'ENOENT') {
        this.debug.warn(`unlink delta failed: ${err.message}`)
      }
    })
    await qemuImgCreateBacked(backingPath, deltaPath)

    this.debug.info(`machine=${machineId} reset to golden-image baseline`)
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
