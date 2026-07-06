import { PrismaClient } from '@prisma/client'
import logger from '@main/logger'

/**
 * First-run setup state helpers.
 *
 * `setupMode` (the auth-context flag consulted by `checkSetupModeAccess`) is
 * open while `AppSettings.setupCompleted === false`. Both GraphQL context
 * builders call {@link isSetupOpen} once per request, so the answer is cached
 * to avoid a DB round-trip on every operation. The cache is invalidated by
 * {@link invalidateSetupCache} when `completeSetup` closes the window (and would
 * also refresh naturally after the short TTL below).
 */

const debug = logger.child({ module: 'setup-state' })

// Short positive TTL so an out-of-band flip (e.g. a direct DB edit or a future
// "re-open setup" admin action) is picked up without a restart, while the hot
// path stays a cheap in-memory read for the common case.
const CACHE_TTL_MS = 5_000

let cachedOpen: boolean | null = null
let cachedAt = 0

/**
 * True when first-run setup is still open (`AppSettings.setupCompleted === false`).
 * Fail-safe: if the row is missing or the read throws, returns `false`
 * (setup CLOSED) so a DB hiccup never silently unlocks the SETUP_MODE resolvers.
 */
export async function isSetupOpen (prisma: PrismaClient, now: number = Date.now()): Promise<boolean> {
  if (cachedOpen !== null && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedOpen
  }
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'default-settings' },
      select: { setupCompleted: true }
    })
    // No settings row yet → treat as CLOSED (fail-closed). A fresh install gets
    // its row from the seed with setupCompleted=false, which opens setup.
    cachedOpen = settings ? settings.setupCompleted === false : false
  } catch (err) {
    debug.warn('isSetupOpen read failed; treating setup as closed', { err: (err as Error)?.message })
    cachedOpen = false
  }
  cachedAt = now
  return cachedOpen
}

/** Drop the cached setup-open flag so the next read hits the DB. */
export function invalidateSetupCache (): void {
  cachedOpen = null
  cachedAt = 0
}
