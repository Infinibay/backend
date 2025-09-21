import { AppError, ErrorCode } from '@utils/errors/ErrorHandler'

export interface PortRange {
  start: number
  end: number
  description?: string
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings?: string[]
}

export interface ConflictDetection {
  hasConflicts: boolean
  conflicts: Array<{
    existing: PortRange
    new: PortRange
    description: string
  }>
}

export interface CommonPort {
  port: number
  name: string
  description: string
  protocol: 'tcp' | 'udp' | 'both'
}

export class PortValidationService {
  private static readonly MIN_PORT = 1
  private static readonly MAX_PORT = 65535
  private static readonly WELL_KNOWN_PORTS_END = 1023
  private static readonly REGISTERED_PORTS_END = 49151

  // Common ports by protocol
  private static readonly COMMON_TCP_PORTS: CommonPort[] = [
    { port: 22, name: 'SSH', description: 'Secure Shell', protocol: 'tcp' },
    { port: 80, name: 'HTTP', description: 'Hypertext Transfer Protocol', protocol: 'tcp' },
    { port: 443, name: 'HTTPS', description: 'HTTP Secure', protocol: 'tcp' },
    { port: 3389, name: 'RDP', description: 'Remote Desktop Protocol', protocol: 'tcp' },
    { port: 3306, name: 'MySQL', description: 'MySQL Database', protocol: 'tcp' },
    { port: 5432, name: 'PostgreSQL', description: 'PostgreSQL Database', protocol: 'tcp' },
    { port: 3000, name: 'Dev Server', description: 'Common development server port', protocol: 'tcp' },
    { port: 8080, name: 'Alt HTTP', description: 'Alternative HTTP port', protocol: 'tcp' },
    { port: 8443, name: 'Alt HTTPS', description: 'Alternative HTTPS port', protocol: 'tcp' }
  ]

  private static readonly COMMON_UDP_PORTS: CommonPort[] = [
    { port: 53, name: 'DNS', description: 'Domain Name System', protocol: 'udp' },
    { port: 67, name: 'DHCP Server', description: 'Dynamic Host Configuration Protocol', protocol: 'udp' },
    { port: 68, name: 'DHCP Client', description: 'Dynamic Host Configuration Protocol', protocol: 'udp' },
    { port: 123, name: 'NTP', description: 'Network Time Protocol', protocol: 'udp' },
    { port: 161, name: 'SNMP', description: 'Simple Network Management Protocol', protocol: 'udp' }
  ]

  /**
   * Validates a port string format and returns validation result
   */
  validatePortString (portString: string): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (portString === null || portString === undefined || typeof portString !== 'string') {
      errors.push('Port string is required and must be a string')
      return { isValid: false, errors, warnings }
    }

    const trimmed = portString.trim()
    if (!trimmed) {
      errors.push('Port string cannot be empty')
      return { isValid: false, errors, warnings }
    }

    // Handle special cases
    if (trimmed.toLowerCase() === 'all') {
      return { isValid: true, errors: [], warnings: ['Using "all" opens all ports - ensure this is intended'] }
    }

    // Split by comma for multiple ports/ranges
    const parts = trimmed.split(',').map(part => part.trim()).filter(part => part.length > 0)

    if (parts.length === 0) {
      errors.push('No valid port entries found')
      return { isValid: false, errors, warnings }
    }

    for (const part of parts) {
      const partValidation = this.validatePortPart(part)
      errors.push(...partValidation.errors)
      warnings.push(...(partValidation.warnings || []))
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }

  /**
   * Validates a single port or port range part
   */
  private validatePortPart (part: string): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Check for range format (e.g., "80-90")
    // But avoid matching negative numbers like "-1"
    if (part.includes('-') && !part.startsWith('-')) {
      const rangeParts = part.split('-')

      if (rangeParts.length !== 2) {
        errors.push(`Invalid range format: "${part}". Use format "start-end"`)
        return { isValid: false, errors }
      }

      const [startStr, endStr] = rangeParts

      if (!startStr.trim() || !endStr.trim()) {
        errors.push(`Invalid range format: "${part}". Both start and end ports are required`)
        return { isValid: false, errors }
      }

      const start = this.parsePort(startStr.trim())
      const end = this.parsePort(endStr.trim())

      if (start === null) {
        errors.push(`Invalid start port in range: "${startStr}"`)
      }
      if (end === null) {
        errors.push(`Invalid end port in range: "${endStr}"`)
      }

      if (start !== null && end !== null) {
        if (start > end) {
          errors.push(`Invalid range: start port ${start} is greater than end port ${end}`)
        }
        if (end - start > 1000) {
          warnings.push(`Large port range (${start}-${end}) may impact performance`)
        }
      }
    } else {
      // Single port
      const port = this.parsePort(part)
      if (port === null) {
        errors.push(`Invalid port: "${part}"`)
      } else if (port <= PortValidationService.WELL_KNOWN_PORTS_END) {
        warnings.push(`Port ${port} is in the well-known ports range (1-1023)`)
      }
    }

    return { isValid: errors.length === 0, errors, warnings }
  }

  /**
   * Parses a port string to number, returns null if invalid
   */
  private parsePort (portStr: string): number | null {
    const num = parseInt(portStr, 10)

    if (isNaN(num) || !Number.isInteger(num)) {
      return null
    }

    if (num < PortValidationService.MIN_PORT || num > PortValidationService.MAX_PORT) {
      return null
    }

    return num
  }

  /**
   * Parses a port string into an array of PortRange objects
   */
  parsePortString (portString: string): PortRange[] {
    const validation = this.validatePortString(portString)
    if (!validation.isValid) {
      throw new AppError(
        `Invalid port string: ${validation.errors.join(', ')}`,
        ErrorCode.VALIDATION_ERROR,
        400
      )
    }

    const trimmed = portString.trim()

    // Handle special case "all"
    if (trimmed.toLowerCase() === 'all') {
      return [{ start: PortValidationService.MIN_PORT, end: PortValidationService.MAX_PORT }]
    }

    const ranges: PortRange[] = []
    const parts = trimmed.split(',').map(part => part.trim()).filter(part => part.length > 0)

    for (const part of parts) {
      if (part.includes('-') && !part.startsWith('-')) {
        // Range format
        const [startStr, endStr] = part.split('-')
        const start = this.parsePort(startStr.trim())!
        const end = this.parsePort(endStr.trim())!
        ranges.push({ start, end })
      } else {
        // Single port
        const port = this.parsePort(part)!
        ranges.push({ start: port, end: port })
      }
    }

    return ranges
  }

  /**
   * Detects conflicts between existing port ranges and new ranges
   */
  detectPortConflicts (existingRanges: PortRange[], newRanges: PortRange[]): ConflictDetection {
    const conflicts: Array<{
      existing: PortRange
      new: PortRange
      description: string
    }> = []

    for (const newRange of newRanges) {
      for (const existingRange of existingRanges) {
        if (this.rangesOverlap(existingRange, newRange)) {
          conflicts.push({
            existing: existingRange,
            new: newRange,
            description: `Port range ${newRange.start}-${newRange.end} overlaps with existing range ${existingRange.start}-${existingRange.end}`
          })
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts
    }
  }

  /**
   * Checks if two port ranges overlap
   */
  private rangesOverlap (range1: PortRange, range2: PortRange): boolean {
    return range1.start <= range2.end && range2.start <= range1.end
  }

  /**
   * Optimizes port ranges by merging adjacent and overlapping ranges
   */
  optimizePortRanges (ranges: PortRange[]): PortRange[] {
    if (ranges.length <= 1) {
      return [...ranges]
    }

    // Sort ranges by start port
    const sortedRanges = ranges.slice().sort((a, b) => a.start - b.start)
    const optimized: PortRange[] = []
    let current = { ...sortedRanges[0] }

    for (let i = 1; i < sortedRanges.length; i++) {
      const next = sortedRanges[i]

      // Check if ranges can be merged (overlapping or adjacent)
      if (current.end >= next.start - 1) {
        // Merge ranges
        current.end = Math.max(current.end, next.end)
      } else {
        // Add current range and start new one
        optimized.push(current)
        current = { ...next }
      }
    }

    // Add the last range
    optimized.push(current)

    return optimized
  }

  /**
   * Returns common ports for a given protocol
   */
  getCommonPorts (protocol: 'tcp' | 'udp' | 'all' = 'all'): CommonPort[] {
    switch (protocol) {
    case 'tcp':
      return [...PortValidationService.COMMON_TCP_PORTS]
    case 'udp':
      return [...PortValidationService.COMMON_UDP_PORTS]
    case 'all':
      return [
        ...PortValidationService.COMMON_TCP_PORTS,
        ...PortValidationService.COMMON_UDP_PORTS
      ]
    default:
      return []
    }
  }

  /**
   * Formats a PortRange back to string representation
   */
  formatPortRange (range: PortRange): string {
    if (range.start === range.end) {
      return range.start.toString()
    }

    if (range.start === PortValidationService.MIN_PORT && range.end === PortValidationService.MAX_PORT) {
      return 'all'
    }

    return `${range.start}-${range.end}`
  }

  /**
   * Formats multiple PortRange objects to a single string
   */
  formatPortRanges (ranges: PortRange[]): string {
    return ranges.map(range => this.formatPortRange(range)).join(',')
  }

  /**
   * Validates that a port string doesn't create conflicts with existing rules
   */
  validatePortStringWithConflicts (portString: string, existingRanges: PortRange[]): ValidationResult {
    const baseValidation = this.validatePortString(portString)
    if (!baseValidation.isValid) {
      return baseValidation
    }

    const newRanges = this.parsePortString(portString)
    const conflictDetection = this.detectPortConflicts(existingRanges, newRanges)

    if (conflictDetection.hasConflicts) {
      const conflictErrors = conflictDetection.conflicts.map(conflict => conflict.description)
      return {
        isValid: false,
        errors: conflictErrors,
        warnings: baseValidation.warnings
      }
    }

    return baseValidation
  }
}
