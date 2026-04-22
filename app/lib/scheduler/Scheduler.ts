/**
 * Scheduler — Minimal in-process cron scheduler.
 *
 * A single tick interval (default: every 30 seconds) evaluates all registered
 * jobs and fires those whose last-fired minute is behind the wall clock.
 * Jobs that fail just log; they don't crash the tick loop. This is enough for
 * dynamic, DB-backed schedules like backups — it's not meant to replace the
 * full `cron` package for sub-minute precision.
 */

import logger from '@main/logger'

import { CronExpression } from './CronExpression'

export interface ScheduledHandle {
  readonly id: string
  stop (): void
  getNextRunDate (): string | undefined
}

interface JobEntry {
  id: string
  expression: CronExpression
  callback: () => void | Promise<void>
  lastFiredMinute: number | null
}

export interface SchedulerOptions {
  /** Tick interval in milliseconds (default: 30_000). */
  tickMs?: number
}

export class Scheduler {
  private readonly jobs: Map<string, JobEntry> = new Map()
  private readonly tickMs: number
  private timer: NodeJS.Timeout | null = null
  private nextJobId = 1

  constructor (options: SchedulerOptions = {}) {
    this.tickMs = options.tickMs ?? 30_000
  }

  /**
   * Registers a cron expression and callback. The returned handle can be
   * used to cancel the schedule. Throws if the expression is invalid.
   */
  schedule (cronExpression: string, callback: () => void | Promise<void>): ScheduledHandle {
    const expression = new CronExpression(cronExpression)
    const id = `job-${this.nextJobId++}`

    const entry: JobEntry = {
      id,
      expression,
      callback,
      lastFiredMinute: minuteKey(new Date())
    }
    this.jobs.set(id, entry)

    if (this.timer === null) this.start()

    return {
      id,
      stop: () => { this.jobs.delete(id) },
      getNextRunDate: () => {
        try {
          return entry.expression.next(new Date()).toISOString()
        } catch {
          return undefined
        }
      }
    }
  }

  /** Starts the tick loop. Idempotent. */
  start (): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => { this.tick() }, this.tickMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  /** Stops the tick loop and discards all jobs. */
  stop (): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.jobs.clear()
  }

  /** Returns the number of active jobs. */
  get size (): number {
    return this.jobs.size
  }

  /**
   * Evaluates all jobs against `now` and fires any that match and haven't
   * fired this minute yet. Exposed for tests; normally invoked by the timer.
   */
  tick (now: Date = new Date()): void {
    const minute = minuteKey(now)
    for (const entry of this.jobs.values()) {
      if (entry.lastFiredMinute === minute) continue
      if (!entry.expression.matches(now)) continue

      entry.lastFiredMinute = minute
      try {
        const result = entry.callback()
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => {
            logger.error(`Scheduler job '${entry.id}' threw: ${err instanceof Error ? err.message : String(err)}`)
          })
        }
      } catch (err) {
        logger.error(`Scheduler job '${entry.id}' threw: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
}

function minuteKey (date: Date): number {
  return Math.floor(date.getTime() / 60_000)
}
