/**
 * CronExpression — 5-field cron parser and matcher, zero-dependency.
 *
 * Fields: minute (0-59), hour (0-23), day-of-month (1-31),
 *         month (1-12), day-of-week (0-6, where 0 = Sunday, 7 also accepted).
 *
 * Supported syntax per field:
 *   *             — any value
 *   N             — literal
 *   N-M           — inclusive range
 *   N,M,...       — list
 *   * / S         — step over full range
 *   N-M / S       — step over range
 */

type FieldName = 'minute' | 'hour' | 'dom' | 'month' | 'dow'

interface FieldSpec {
  name: FieldName
  min: number
  max: number
}

const FIELDS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 6 }
]

export class CronExpression {
  private readonly minutes: Set<number>
  private readonly hours: Set<number>
  private readonly doms: Set<number>
  private readonly months: Set<number>
  private readonly dows: Set<number>
  private readonly domRestricted: boolean
  private readonly dowRestricted: boolean

  constructor (public readonly expression: string) {
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression '${expression}': expected 5 fields, got ${parts.length}`
      )
    }

    this.minutes = parseField(parts[0], FIELDS[0])
    this.hours = parseField(parts[1], FIELDS[1])
    this.doms = parseField(parts[2], FIELDS[2])
    this.months = parseField(parts[3], FIELDS[3])
    this.dows = normalizeDow(parseField(parts[4], FIELDS[4], true))

    this.domRestricted = parts[2] !== '*'
    this.dowRestricted = parts[4] !== '*'
  }

  /**
   * Returns true if the given date matches this cron expression (to the minute).
   */
  matches (date: Date): boolean {
    if (!this.minutes.has(date.getMinutes())) return false
    if (!this.hours.has(date.getHours())) return false
    if (!this.months.has(date.getMonth() + 1)) return false
    return this.dayMatches(date)
  }

  /**
   * Returns the next Date (> baseDate, rounded up to the next minute) that
   * matches this expression. Walks forward minute by minute; capped at a
   * 5-year search window to avoid pathological loops on unsatisfiable
   * expressions.
   */
  next (baseDate: Date = new Date()): Date {
    const candidate = new Date(baseDate.getTime())
    candidate.setSeconds(0, 0)
    candidate.setMinutes(candidate.getMinutes() + 1)

    const limit = new Date(baseDate.getTime())
    limit.setFullYear(limit.getFullYear() + 5)

    while (candidate.getTime() <= limit.getTime()) {
      if (!this.months.has(candidate.getMonth() + 1)) {
        candidate.setMonth(candidate.getMonth() + 1, 1)
        candidate.setHours(0, 0, 0, 0)
        continue
      }
      if (!this.dayMatches(candidate)) {
        candidate.setDate(candidate.getDate() + 1)
        candidate.setHours(0, 0, 0, 0)
        continue
      }
      if (!this.hours.has(candidate.getHours())) {
        candidate.setHours(candidate.getHours() + 1, 0, 0, 0)
        continue
      }
      if (!this.minutes.has(candidate.getMinutes())) {
        candidate.setMinutes(candidate.getMinutes() + 1, 0, 0)
        continue
      }
      return candidate
    }

    throw new Error(`No next run found within 5 years for '${this.expression}'`)
  }

  /**
   * Day-of-month and day-of-week are OR'd together when both are restricted
   * (Vixie cron semantics). When only one is restricted, only that one applies.
   */
  private dayMatches (date: Date): boolean {
    const domMatch = this.doms.has(date.getDate())
    const dowMatch = this.dows.has(date.getDay())
    if (this.domRestricted && this.dowRestricted) return domMatch || dowMatch
    if (this.domRestricted) return domMatch
    if (this.dowRestricted) return dowMatch
    return true
  }
}

function parseField (raw: string, spec: FieldSpec, allow7ForDow: boolean = false): Set<number> {
  const values = new Set<number>()
  const max = allow7ForDow ? 7 : spec.max

  for (const token of raw.split(',')) {
    const [rangePart, stepPart] = token.split('/')
    const step = stepPart === undefined ? 1 : parseIntStrict(stepPart, `step in '${token}'`)
    if (step < 1) {
      throw new Error(`Invalid step '${stepPart}' in field '${spec.name}'`)
    }

    let start: number
    let end: number
    if (rangePart === '*') {
      start = spec.min
      end = spec.max
    } else if (rangePart.includes('-')) {
      const [s, e] = rangePart.split('-')
      start = parseIntStrict(s, `range start in '${token}'`)
      end = parseIntStrict(e, `range end in '${token}'`)
    } else {
      start = parseIntStrict(rangePart, `value in '${token}'`)
      end = stepPart === undefined ? start : spec.max
    }

    if (start < spec.min || start > max || end < spec.min || end > max || start > end) {
      throw new Error(
        `Field '${spec.name}' value out of bounds in '${token}' (allowed ${spec.min}-${spec.max})`
      )
    }

    for (let v = start; v <= end; v += step) values.add(v)
  }

  return values
}

function normalizeDow (set: Set<number>): Set<number> {
  if (set.has(7)) {
    set.delete(7)
    set.add(0)
  }
  return set
}

function parseIntStrict (raw: string, context: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`Expected integer for ${context}, got '${raw}'`)
  return parseInt(raw, 10)
}
