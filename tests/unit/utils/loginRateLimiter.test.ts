import { describe, it, expect } from '@jest/globals'
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess
} from '@utils/loginRateLimiter'

// The limiter keeps in-memory state in a module-level Map keyed by the login
// key. To keep these pure unit tests isolated from one another we use a UNIQUE
// key per test case so state from one test cannot bleed into another.

// Mirror of the impl constants (app/utils/loginRateLimiter.ts):
//   FREE_FAILURES = 5  -> first 5 failures are free, the 6th triggers lockout.
const FREE_FAILURES = 5

describe('loginRateLimiter', () => {
  it('allows login for an unseen key', () => {
    const result = checkLoginAllowed('unseen-key')

    expect(result.allowed).toBe(true)
    expect(result.retryAfterMs).toBeUndefined()
  })

  it('still allows login after exactly FREE_FAILURES failures (no lockout yet)', () => {
    const key = 'free-failures-key'

    for (let i = 0; i < FREE_FAILURES; i++) {
      recordLoginFailure(key)
    }

    const result = checkLoginAllowed(key)
    expect(result.allowed).toBe(true)
    expect(result.retryAfterMs).toBeUndefined()
  })

  it('locks out and reports a positive retryAfterMs once the threshold is exceeded', () => {
    const key = 'lockout-key'

    // FREE_FAILURES free attempts, then one more to trip the lockout.
    for (let i = 0; i < FREE_FAILURES + 1; i++) {
      recordLoginFailure(key)
    }

    const result = checkLoginAllowed(key)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeDefined()
    expect(result.retryAfterMs as number).toBeGreaterThan(0)
  })

  it('escalates the backoff (longer retryAfterMs) as failures keep accumulating', () => {
    const firstLockKey = 'escalate-first'
    for (let i = 0; i < FREE_FAILURES + 1; i++) {
      recordLoginFailure(firstLockKey)
    }
    const firstLock = checkLoginAllowed(firstLockKey)

    const secondLockKey = 'escalate-second'
    for (let i = 0; i < FREE_FAILURES + 2; i++) {
      recordLoginFailure(secondLockKey)
    }
    const secondLock = checkLoginAllowed(secondLockKey)

    expect(firstLock.allowed).toBe(false)
    expect(secondLock.allowed).toBe(false)
    expect(secondLock.retryAfterMs as number).toBeGreaterThan(firstLock.retryAfterMs as number)
  })

  it('clears the lock on recordLoginSuccess so the key is allowed again', () => {
    const key = 'success-clears-key'

    for (let i = 0; i < FREE_FAILURES + 1; i++) {
      recordLoginFailure(key)
    }
    expect(checkLoginAllowed(key).allowed).toBe(false)

    recordLoginSuccess(key)

    const result = checkLoginAllowed(key)
    expect(result.allowed).toBe(true)
    expect(result.retryAfterMs).toBeUndefined()
  })

  it('resets the failure count after a success (subsequent failures get the free window again)', () => {
    const key = 'reset-count-key'

    for (let i = 0; i < FREE_FAILURES + 1; i++) {
      recordLoginFailure(key)
    }
    expect(checkLoginAllowed(key).allowed).toBe(false)

    recordLoginSuccess(key)

    // After the reset, FREE_FAILURES failures should once again be tolerated
    // without a lockout because the internal counter started from zero.
    for (let i = 0; i < FREE_FAILURES; i++) {
      recordLoginFailure(key)
    }
    expect(checkLoginAllowed(key).allowed).toBe(true)
  })

  it('treats different keys as independent', () => {
    const lockedKey = 'independent-locked'
    const otherKey = 'independent-other'

    for (let i = 0; i < FREE_FAILURES + 1; i++) {
      recordLoginFailure(lockedKey)
    }

    // The locked key is denied...
    expect(checkLoginAllowed(lockedKey).allowed).toBe(false)
    // ...while an unrelated key is unaffected.
    expect(checkLoginAllowed(otherKey).allowed).toBe(true)
  })

  it('recordLoginSuccess on an unknown key is a no-op (still allowed)', () => {
    expect(() => recordLoginSuccess('never-seen-key')).not.toThrow()
    expect(checkLoginAllowed('never-seen-key').allowed).toBe(true)
  })
})
