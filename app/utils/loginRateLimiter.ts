/**
 * In-memory login throttle.
 *
 * NOTE: This limiter is per-instance (single process). State lives in a local
 * Map and is NOT shared across multiple backend instances. For multi-instance
 * / horizontally-scaled deployments this MUST be backed by a shared store such
 * as Redis so that lockouts are enforced consistently across all instances.
 */

interface LoginAttempt {
  fails: number
  lockedUntil: number
}

interface LoginCheckResult {
  allowed: boolean
  retryAfterMs?: number
}

// Allow the first 5 failures with no lockout; backoff applies from the 6th.
const FREE_FAILURES = 5
// Base backoff applied to the first locking failure (the 6th).
const BASE_BACKOFF_MS = 1000
// Cap a single lockout at ~15 minutes.
const MAX_BACKOFF_MS = 15 * 60 * 1000
// Drop stale, unlocked entries that have not been touched for an hour.
const STALE_ENTRY_MS = 60 * 60 * 1000

const attempts = new Map<string, LoginAttempt & { updatedAt: number }>()

function pruneStale (now: number): void {
  for (const [key, entry] of attempts) {
    if (entry.lockedUntil <= now && (now - entry.updatedAt) > STALE_ENTRY_MS) {
      attempts.delete(key)
    }
  }
}

function computeLockedUntil (fails: number, now: number): number {
  if (fails <= FREE_FAILURES) {
    return 0
  }
  const exponent = fails - FREE_FAILURES - 1
  const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, exponent), MAX_BACKOFF_MS)
  return now + backoff
}

export function checkLoginAllowed (key: string): LoginCheckResult {
  const now = Date.now()
  pruneStale(now)

  const entry = attempts.get(key)
  if (!entry) {
    return { allowed: true }
  }

  if (now < entry.lockedUntil) {
    return { allowed: false, retryAfterMs: entry.lockedUntil - now }
  }

  return { allowed: true }
}

export function recordLoginFailure (key: string): void {
  const now = Date.now()
  pruneStale(now)

  const entry = attempts.get(key)
  const fails = (entry?.fails ?? 0) + 1
  const lockedUntil = computeLockedUntil(fails, now)

  attempts.set(key, { fails, lockedUntil, updatedAt: now })
}

export function recordLoginSuccess (key: string): void {
  attempts.delete(key)
}
