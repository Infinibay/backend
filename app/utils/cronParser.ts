import parser from 'cron-parser'

/**
 * Cron parser utility using cron-parser library for calculating next run times
 */
export class CronParser {
  /**
   * Parse a cron expression and calculate the next run time
   */
  static getNextRunTime (cronExpression: string, baseDate: Date = new Date()): Date {
    try {
      const interval = parser.parse(cronExpression, {
        currentDate: baseDate,
        tz: 'UTC'
      })
      return interval.next().toDate()
    } catch (error) {
      throw new Error(`Invalid cron expression: ${cronExpression}`)
    }
  }

  /**
   * Validate a cron expression
   */
  static isValidCronExpression (cronExpression: string): boolean {
    try {
      parser.parse(cronExpression)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get human-readable description of cron expression
   */
  static describeCronExpression (cronExpression: string): string {
    try {
      // Parse the expression to validate it
      parser.parse(cronExpression)

      // Simple descriptions for common patterns
      const parts = cronExpression.trim().split(/\s+/)
      if (parts.length >= 5) {
        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

        if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
          return 'Daily at midnight'
        }

        if (minute === '0' && hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
          return `Daily at ${hour}:00`
        }

        if (minute === '0' && hour === '0' && dayOfMonth === '*' && month === '*' && dayOfWeek === '0') {
          return 'Weekly on Sunday at midnight'
        }

        if (minute === '0' && hour === '0' && dayOfMonth === '1' && month === '*' && dayOfWeek === '*') {
          return 'Monthly on the 1st at midnight'
        }
      }

      return `Custom schedule: ${cronExpression}`
    } catch {
      return 'Invalid cron expression'
    }
  }

  /**
   * Get the next N run times for a cron expression
   */
  static getNextRunTimes (cronExpression: string, count: number = 5, baseDate: Date = new Date()): Date[] {
    try {
      const interval = parser.parse(cronExpression, {
        currentDate: baseDate,
        tz: 'UTC'
      })

      const dates: Date[] = []
      for (let i = 0; i < count; i++) {
        dates.push(interval.next().toDate())
      }
      return dates
    } catch (error) {
      throw new Error(`Invalid cron expression: ${cronExpression}`)
    }
  }
}

// Export singleton instance
export const cronParser = new CronParser()
