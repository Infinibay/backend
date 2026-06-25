/**
 * One-shot reconciliation of pool desktops left in a transient/locked status by
 * a backend crash. Safe to run on every boot (idempotent).
 */
import { Logger } from 'winston'
import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'
import { OFF_STATUS, ERROR_STATUS, REBUILDING_STATUS, STARTING_STATUS } from '../../constants/machine-status'

export const STARTING_TTL_MS = 5 * 60 * 1000

export async function reconcilePoolStatusesOnStartup (
  prisma: PrismaClient,
  opts: { startingTtlMs?: number } = {}
): Promise<void> {
  const debug: Logger = logger.child({ module: 'pool-reconcile' })
  const startingTtlMs = opts.startingTtlMs ?? STARTING_TTL_MS
  try {
    // Any pooled machine still 'rebuilding' at startup is by definition a crashed
    // rebuild — its delta may be half-written. Park in 'error' so it stays out of
    // checkout until a later shutdown re-baselines it.
    const rebuilt = await prisma.machine.updateMany({
      where: { poolId: { not: null }, status: REBUILDING_STATUS },
      data: { status: ERROR_STATUS }
    })
    if (rebuilt.count > 0) debug.warn(`reconciled ${rebuilt.count} stale 'rebuilding' pool machine(s) -> error`)

    // Pooled machines stuck in 'starting' past the TTL are stranded boots (crash
    // between claim and power-on). Return them to 'off' so they rejoin the idle
    // set and can be claimed again. A boot that actually succeeded would already
    // be 'running'.
    const cutoff = new Date(Date.now() - startingTtlMs)
    const restarted = await prisma.machine.updateMany({
      where: { poolId: { not: null }, status: STARTING_STATUS, updatedAt: { lt: cutoff } },
      data: { status: OFF_STATUS }
    })
    if (restarted.count > 0) debug.warn(`reconciled ${restarted.count} stale 'starting' pool machine(s) -> off`)

    const errored = await prisma.machine.count({ where: { poolId: { not: null }, status: ERROR_STATUS } })
    if (errored > 0) debug.warn(`${errored} pool machine(s) in 'error' need operator/auto recovery`)
  } catch (err) {
    debug.error(`pool status reconcile failed: ${(err as Error).message}`)
  }
}
