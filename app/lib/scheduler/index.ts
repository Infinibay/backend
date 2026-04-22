import type { ScheduleAdapter, ScheduledJob } from '@infinibay/infinization'

import { CronExpression } from './CronExpression'
import { Scheduler, ScheduledHandle } from './Scheduler'

export { CronExpression } from './CronExpression'
export { Scheduler } from './Scheduler'
export type { ScheduledHandle, SchedulerOptions } from './Scheduler'

/**
 * Process-wide Scheduler singleton. Lazily created on first access so tests
 * that don't touch scheduling don't start timers.
 */
let instance: Scheduler | null = null

export function getScheduler (): Scheduler {
  if (instance === null) instance = new Scheduler()
  return instance
}

/** For tests: replace the singleton with a custom instance, or reset to null. */
export function setSchedulerForTesting (s: Scheduler | null): void {
  if (instance !== null && instance !== s) instance.stop()
  instance = s
}

/**
 * Adapter that plugs our Scheduler into infinization's `BackupScheduler`.
 */
export function createScheduleAdapter (scheduler: Scheduler = getScheduler()): ScheduleAdapter {
  return {
    schedule (cronExpression: string, callback: () => void): ScheduledJob {
      const handle: ScheduledHandle = scheduler.schedule(cronExpression, callback)
      return {
        stop: () => handle.stop(),
        getNextRunDate: () => handle.getNextRunDate()
      }
    }
  }
}

/** Describe a cron expression in plain English for UI display. */
export function describeCron (expression: string): string {
  try {
    new CronExpression(expression)
  } catch {
    return 'Invalid schedule'
  }

  const parts = expression.trim().split(/\s+/)
  const [minute, hour, dom, month, dow] = parts

  if (minute === '0' && hour === '0' && dom === '*' && month === '*' && dow === '*') {
    return 'Daily at midnight'
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    return `Daily at ${pad(hour)}:${pad(minute)}`
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && month === '*' && /^\d+$/.test(dow)) {
    return `Weekly on ${dayName(parseInt(dow, 10))} at ${pad(hour)}:${pad(minute)}`
  }
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && /^\d+$/.test(dom) && month === '*' && dow === '*') {
    return `Monthly on day ${dom} at ${pad(hour)}:${pad(minute)}`
  }
  return `Custom schedule: ${expression}`
}

function pad (v: string): string {
  return v.padStart(2, '0')
}

function dayName (n: number): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][n % 7]
}
