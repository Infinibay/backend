/**
 * PoolRefill Cron Job
 *
 * Once a minute, iterates every non-draining Pool and ensures
 * `currentSize >= sizeMin` — spawning linked-clone desktops via
 * PoolService.runRefillTick(). The per-tick cap inside runRefillTick
 * (default 3) keeps QEMU from thundering when a big pool is cold-starting.
 */
import logger from '@main/logger'
import { CronJob } from 'cron'
import prisma from '../utils/database'
import { PoolService } from '../services/PoolService'

const debug = logger.child({ module: 'cron:pool-refill' })

const service = new PoolService(prisma)

// Every minute. Cheap when no pools need refilling (two tiny queries).
const PoolRefillJob = new CronJob('*/1 * * * *', async () => {
  try {
    await service.runRefillTick({ maxPerPoolPerTick: 3 })
  } catch (error) {
    debug.error(`PoolRefill tick failed: ${(error as Error).message}`)
  }
})

export default PoolRefillJob
