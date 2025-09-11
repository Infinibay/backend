/**
 * Date Helper Utilities
 *
 * Provides safe date creation functions to prevent GraphQL DateTime serialization errors.
 * Always use these utilities when creating Date objects from external/untrusted data.
 */

/**
 * Safely creates a Date object from a string, returning undefined for invalid dates
 * @param dateString - The date string to parse
 * @param context - Optional context for debugging invalid dates
 * @returns A valid Date object or undefined
 */
export function safeCreateDate (dateString?: string | null, context?: string): Date | undefined {
  if (!dateString) return undefined

  const date = new Date(dateString)
  if (isNaN(date.getTime())) {
    if (context && process.env.NODE_ENV !== 'production') {
      console.warn(`Invalid date string in ${context}: ${dateString}`)
    }
    return undefined
  }

  return date
}

/**
 * Safely creates a Date object with a fallback value
 * @param dateString - The date string to parse
 * @param fallback - The fallback value to use if parsing fails
 * @returns A valid Date object or the fallback value
 */
export function safeCreateDateWithFallback (
  dateString?: string | null,
  fallback: Date | undefined = undefined
): Date | undefined {
  return safeCreateDate(dateString) ?? fallback
}

/**
 * Safely creates a Date object from an epoch timestamp (seconds since Unix epoch)
 * @param epoch - The epoch timestamp in seconds
 * @param context - Optional context for debugging invalid timestamps
 * @returns A valid Date object or undefined
 */
export function safeCreateDateFromEpoch (epoch?: number | null, context?: string): Date | undefined {
  if (!epoch || epoch <= 0) return undefined

  const date = new Date(epoch * 1000)
  if (isNaN(date.getTime())) {
    if (context && process.env.NODE_ENV !== 'production') {
      console.warn(`Invalid epoch timestamp in ${context}: ${epoch}`)
    }
    return undefined
  }

  return date
}

/**
 * Safely creates a Date object from milliseconds since Unix epoch
 * @param milliseconds - The timestamp in milliseconds
 * @param context - Optional context for debugging invalid timestamps
 * @returns A valid Date object or undefined
 */
export function safeCreateDateFromMilliseconds (milliseconds?: number | null, context?: string): Date | undefined {
  if (!milliseconds || milliseconds <= 0) return undefined

  const date = new Date(milliseconds)
  if (isNaN(date.getTime())) {
    if (context && process.env.NODE_ENV !== 'production') {
      console.warn(`Invalid millisecond timestamp in ${context}: ${milliseconds}`)
    }
    return undefined
  }

  return date
}

/**
 * Type definition for InfiniService epoch timestamp objects
 */
export interface InfiniServiceEpochTimestamp {
  secs_since_epoch: number
  nanos_since_epoch?: number
}

/**
 * Type for timestamp values that can come from InfiniService in multiple formats
 */
export type InfiniServiceTimestamp = string | InfiniServiceEpochTimestamp | null | undefined

/**
 * Safely parses InfiniService timestamp in any supported format
 * Handles both string ISO dates and epoch timestamp objects with nanosecond precision
 * @param timestamp - The timestamp in string or epoch object format
 * @param context - Optional context for debugging invalid timestamps
 * @returns A valid Date object or undefined
 */
export function parseInfiniServiceTimestamp (
  timestamp: InfiniServiceTimestamp,
  context?: string
): Date | undefined {
  if (!timestamp) return undefined

  // Handle string format (ISO date strings)
  if (typeof timestamp === 'string') {
    return safeCreateDate(timestamp, context)
  }

  // Handle epoch object format from Rust SystemTime serialization
  if (typeof timestamp === 'object' && 'secs_since_epoch' in timestamp) {
    // Convert to milliseconds with nanosecond precision
    const milliseconds = timestamp.secs_since_epoch * 1000 +
                        Math.floor((timestamp.nanos_since_epoch || 0) / 1_000_000)

    return safeCreateDateFromMilliseconds(milliseconds, context)
  }

  // Invalid format
  if (context && process.env.NODE_ENV !== 'production') {
    console.warn(`Invalid timestamp format in ${context}:`, timestamp)
  }

  return undefined
}
