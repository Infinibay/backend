import debug from 'debug'
import { PackageCapabilities } from './types'

const log = debug('infinibay:packages:capabilities')

/**
 * Capability types that packages can request
 */
export type CapabilityType = 'network' | 'storage' | 'cron' | 'remediation'

/**
 * Result of a capability check
 */
export interface CapabilityCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * Manages capability validation and enforcement for packages
 */
export class CapabilityManager {
  /**
   * Validate capabilities declared in a manifest
   * Returns list of warnings/issues
   */
  static validateCapabilities(capabilities: PackageCapabilities): string[] {
    const warnings: string[] = []

    // Validate network domains
    if (capabilities.network) {
      for (const domain of capabilities.network) {
        if (!this.isValidDomain(domain)) {
          warnings.push(`Invalid network domain: ${domain}`)
        }
        // Warn about broad wildcards
        if (domain === '*' || domain.startsWith('*.')) {
          warnings.push(`Broad network access requested: ${domain}`)
        }
      }
    }

    // Validate cron expression
    if (capabilities.cron) {
      if (!this.isValidCron(capabilities.cron)) {
        warnings.push(`Invalid cron expression: ${capabilities.cron}`)
      }
    }

    // Warn about dangerous capabilities
    if (capabilities.remediation) {
      warnings.push('Package requests ability to execute remediation scripts on VMs')
    }

    return warnings
  }

  /**
   * Check if a domain is valid
   */
  private static isValidDomain(domain: string): boolean {
    // Allow wildcards like *.example.com
    const pattern = /^(\*\.)?[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/
    return pattern.test(domain)
  }

  /**
   * Check if a cron expression is valid (basic validation)
   */
  private static isValidCron(cron: string): boolean {
    // Basic cron format: minute hour day month weekday
    const parts = cron.split(' ')
    return parts.length === 5
  }

  /**
   * Get a human-readable description of capabilities
   */
  static describeCapabilities(capabilities: PackageCapabilities): string[] {
    const descriptions: string[] = []

    if (capabilities.network && capabilities.network.length > 0) {
      descriptions.push(`Network access to: ${capabilities.network.join(', ')}`)
    }

    if (capabilities.storage) {
      descriptions.push('Local storage for persisting data')
    }

    if (capabilities.cron) {
      descriptions.push(`Scheduled execution: ${capabilities.cron}`)
    }

    if (capabilities.remediation) {
      descriptions.push('Execute remediation scripts on VMs (HIGH PRIVILEGE)')
    }

    if (descriptions.length === 0) {
      descriptions.push('No special capabilities required')
    }

    return descriptions
  }

  /**
   * Check if a network request is allowed for a package
   */
  static checkNetworkAccess(
    declaredDomains: string[] | undefined,
    requestedUrl: string
  ): CapabilityCheckResult {
    if (!declaredDomains || declaredDomains.length === 0) {
      return { allowed: false, reason: 'Package has no network capabilities declared' }
    }

    try {
      const url = new URL(requestedUrl)
      const hostname = url.hostname

      for (const domain of declaredDomains) {
        if (domain === '*') {
          return { allowed: true }
        }

        if (domain.startsWith('*.')) {
          // Wildcard domain match
          const baseDomain = domain.slice(2)
          if (hostname === baseDomain || hostname.endsWith('.' + baseDomain)) {
            return { allowed: true }
          }
        } else {
          // Exact match
          if (hostname === domain) {
            return { allowed: true }
          }
        }
      }

      return {
        allowed: false,
        reason: `Domain ${hostname} not in allowed list: ${declaredDomains.join(', ')}`
      }
    } catch {
      return { allowed: false, reason: 'Invalid URL' }
    }
  }

  /**
   * Check if storage access is allowed
   */
  static checkStorageAccess(declaredStorage: boolean | undefined): CapabilityCheckResult {
    if (declaredStorage) {
      return { allowed: true }
    }
    return { allowed: false, reason: 'Package has not declared storage capability' }
  }

  /**
   * Check if remediation is allowed
   */
  static checkRemediationAccess(declaredRemediation: boolean | undefined): CapabilityCheckResult {
    if (declaredRemediation) {
      return { allowed: true }
    }
    return { allowed: false, reason: 'Package has not declared remediation capability' }
  }

  /**
   * Log capability usage for auditing
   */
  static logCapabilityUsage(
    packageName: string,
    capability: CapabilityType,
    details: string,
    allowed: boolean
  ): void {
    if (allowed) {
      log('Package %s used capability %s: %s', packageName, capability, details)
    } else {
      log('Package %s DENIED capability %s: %s', packageName, capability, details)
    }
  }
}

/**
 * Format capabilities for CLI display
 */
export function formatCapabilitiesForDisplay(capabilities: PackageCapabilities): string {
  const lines: string[] = []

  if (capabilities.network && capabilities.network.length > 0) {
    lines.push(`  Network access: ${capabilities.network.join(', ')}`)
  }

  if (capabilities.storage) {
    lines.push('  Local storage')
  }

  if (capabilities.cron) {
    lines.push(`  Scheduled execution: ${capabilities.cron}`)
  }

  if (capabilities.remediation) {
    lines.push('  Execute remediation scripts (HIGH PRIVILEGE)')
  }

  if (lines.length === 0) {
    lines.push('  (No special capabilities)')
  }

  return lines.join('\n')
}
