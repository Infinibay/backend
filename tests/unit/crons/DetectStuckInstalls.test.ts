/**
 * Unit tests for the stuck-install progress gate (audit L141).
 *
 * These exercise the PURE decision function `isInstallStalled` — no DB, no FS,
 * no QMP — mirroring the testing pattern of UpdateVmStatus.test.ts
 * (classifyVmStatuses). The whole point of the fix is that the cron must NOT
 * force-kill an install that is still making disk progress, even after the
 * wall-clock budget is exceeded; it may only kill a corroborated stall.
 *
 * No Postgres required — written to run under the standard jest unit suite.
 */
import { isInstallStalled, type DiskSample } from '@main/crons/DetectStuckInstalls'

const sample = (size: number, mtimeMs: number): DiskSample => ({ size, mtimeMs })

describe('isInstallStalled (stuck-install corroboration gate)', () => {
  // ---- DO NOT KILL: install is still making progress -----------------------

  it('does NOT force-stop when the disk GREW across the window (live install)', () => {
    const first = sample(1_000_000, 1000)
    const second = sample(1_500_000, 1000) // size increased
    expect(isInstallStalled(first, second, 'running')).toBe(false)
    // even with a non-running QMP state, growth alone keeps it alive
    expect(isInstallStalled(first, second, null)).toBe(false)
    expect(isInstallStalled(first, second, 'paused')).toBe(false)
  })

  it('does NOT force-stop when the disk mtime advanced but size held (flush/rewrite)', () => {
    const first = sample(2_000_000, 1000)
    const second = sample(2_000_000, 3500) // touched, same size
    expect(isInstallStalled(first, second, null)).toBe(false)
  })

  it('does NOT force-stop a disk-quiet VM whose guest CPU is still actively running', () => {
    // No disk movement this window, but QMP says the guest is running (e.g.
    // applying updates in memory before the next flush) — give it another tick.
    const flat = sample(3_000_000, 1000)
    expect(isInstallStalled(flat, sample(3_000_000, 1000), 'running')).toBe(false)
  })

  // ---- KILL: corroborated stall --------------------------------------------

  it('force-stops when the disk is unchanged AND the guest is not actively running', () => {
    const flat = sample(3_000_000, 1000)
    expect(isInstallStalled(flat, sample(3_000_000, 1000), 'paused')).toBe(true)
    expect(isInstallStalled(flat, sample(3_000_000, 1000), 'shutdown')).toBe(true)
    expect(isInstallStalled(flat, sample(3_000_000, 1000), null)).toBe(true)
  })

  it('force-stops when the install disk cannot be sampled at all and QMP is not running', () => {
    // Missing/unreadable disk past the budget is itself a failure and gives no
    // progress signal to justify keeping the VM alive.
    expect(isInstallStalled(null, null, null)).toBe(true)
    expect(isInstallStalled(null, null, 'shutdown')).toBe(true)
  })

  it('keeps a VM alive on an unreadable disk only if QMP still reports running', () => {
    expect(isInstallStalled(null, null, 'running')).toBe(false)
  })

  // ---- Edge: partial sampling ----------------------------------------------

  it('treats a single-sided sample (only one stat succeeded) as no-progress signal', () => {
    // Cannot prove growth from one sample -> falls through to the QMP signal.
    expect(isInstallStalled(sample(1, 1), null, 'running')).toBe(false)
    expect(isInstallStalled(sample(1, 1), null, 'paused')).toBe(true)
    expect(isInstallStalled(null, sample(1, 1), null)).toBe(true)
  })

  it('does not flap: identical samples + non-running QMP is deterministically a stall', () => {
    const a = sample(42, 99)
    const b = sample(42, 99)
    expect(isInstallStalled(a, b, 'paused')).toBe(true)
    expect(isInstallStalled(a, b, 'paused')).toBe(true)
  })
})
