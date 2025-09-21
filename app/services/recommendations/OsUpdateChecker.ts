import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'

interface WindowsUpdate {
  title?: string
  name?: string
  kb_number?: string
  severity?: string
  importance?: string
  is_security_update?: boolean
  security?: boolean
  size_bytes?: number
  download_size?: number
}

interface UpdateStatus {
  pending_updates?: WindowsUpdate[]
  reboot_required?: boolean
  automatic_updates_enabled?: boolean
  last_check_date?: string
  pending_reboot_updates?: number
}

/**
 * OsUpdateChecker - Monitors Windows Update status and recommends system maintenance
 *
 * @description
 * Analyzes Windows Update information to identify pending updates, security patches,
 * and system maintenance needs. Prioritizes critical and security updates while
 * tracking update configuration and reboot requirements.
 *
 * @category Maintenance
 *
 * @analysis
 * 1. **Update Check Staleness**: Last check >7 days indicates outdated status
 * 2. **Update Classification**:
 *    - Critical: Immediate installation required
 *    - Important: High priority for system stability
 *    - Security: Patches for known vulnerabilities
 *    - Optional: Non-critical improvements
 * 3. **Configuration Analysis**:
 *    - Automatic updates disabled
 *    - Pending reboot requirements
 * 4. **Severity Assessment**: Critical > Important > Security > Optional
 *
 * @input
 * - context.latestSnapshot.windowsUpdateInfo: Windows Update status data
 *
 * Format:
 * ```typescript
 * {
 *   pending_updates: [
 *     {
 *       title: "Security Update for Windows 10",
 *       kb_number: "KB5021233",
 *       severity: "Critical",
 *       is_security_update: true,
 *       size_bytes: 512000000
 *     }
 *   ],
 *   reboot_required: true,
 *   automatic_updates_enabled: false,
 *   last_check_date: "2024-01-15T10:30:00Z"
 * }
 * ```
 *
 * @output
 * RecommendationResult[] with:
 * - type: 'OS_UPDATE_AVAILABLE'
 * - text: Summary of Windows Update issues
 * - actionText: Specific remediation steps
 * - data: {
 *     flags: string[],                    // Issue indicators
 *     severity: 'critical' | 'high' | 'medium' | 'low',
 *     totalUpdates: number,              // Total pending updates
 *     criticalCount: number,             // Critical updates
 *     securityCount: number,             // Security updates
 *     totalSizeMB: number,               // Download size
 *     rebootRequired: boolean,           // Restart needed
 *     automaticUpdatesDisabled: boolean, // Config issue
 *     updateTitles: string[]             // Update names (first 10)
 *   }
 *
 * @flags
 * - 'stale_check_date': Last check >7 days ago
 * - 'pending_updates': Updates available for installation
 * - 'reboot_required': System restart needed
 * - 'auto_updates_disabled': Automatic updates turned off
 *
 * @severity_logic
 * - **Critical**: Any critical updates present
 * - **High**: Important updates (no critical)
 * - **Medium**: Security/optional updates, config issues
 * - **Low**: Default baseline
 *
 * @example
 * ```typescript
 * // Input with critical security updates
 * windowsUpdateInfo: {
 *   pending_updates: [
 *     { title: "Critical Security Update", severity: "Critical", is_security_update: true, size_bytes: 100MB },
 *     { title: "Feature Update", severity: "Important", size_bytes: 2GB }
 *   ],
 *   reboot_required: true,
 *   automatic_updates_enabled: false
 * }
 *
 * // Output:
 * [{
 *   type: 'OS_UPDATE_AVAILABLE',
 *   text: 'Windows Update issues detected on VM-Server-01: 2 updates available (1 critical, 1 important, 1 security), system restart required, automatic updates disabled',
 *   actionText: 'Address Windows Update issues on VM-Server-01: install pending updates, restart computer, enable automatic updates through Settings > Update & Security > Windows Update',
 *   data: {
 *     flags: ['pending_updates', 'reboot_required', 'auto_updates_disabled'],
 *     severity: 'critical',
 *     totalUpdates: 2,
 *     criticalCount: 1,
 *     importantCount: 1,
 *     securityCount: 1,
 *     totalSizeMB: 2148,
 *     rebootRequired: true,
 *     automaticUpdatesDisabled: true
 *   }
 * }]
 * ```
 */
export class OsUpdateChecker extends RecommendationChecker {
  getName (): string { return 'OsUpdateChecker' }
  getCategory (): string { return 'Maintenance' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.latestSnapshot?.windowsUpdateInfo) {
      return results
    }

    try {
      const updateData = typeof context.latestSnapshot.windowsUpdateInfo === 'string'
        ? JSON.parse(context.latestSnapshot.windowsUpdateInfo)
        : context.latestSnapshot.windowsUpdateInfo

      if (!updateData || typeof updateData !== 'object') {
        console.warn('VMRecommendationService: Invalid windowsUpdateInfo format')
        return results
      }

      const flags: string[] = []
      const details: Record<string, string | number | boolean | (string | undefined)[]> = {}
      const issues: string[] = []
      const actions: string[] = []
      let highestSeverity = 'low'

      const lastCheckResult = this.parseAndCalculateDaysSince(updateData.last_check_date)
      if (lastCheckResult.isValid && lastCheckResult.daysSince > 7) {
        flags.push('stale_check_date')
        details.lastCheckDate = updateData.last_check_date
        details.daysSinceLastCheck = lastCheckResult.daysSince
        issues.push(`last checked ${lastCheckResult.daysSince} days ago`)
        actions.push('check for updates')
        if (highestSeverity === 'low') highestSeverity = 'medium'
      }

      const pendingUpdates = updateData.pending_updates || []
      if (Array.isArray(pendingUpdates) && pendingUpdates.length > 0) {
        flags.push('pending_updates')

        const criticalUpdates = pendingUpdates.filter(u => u.severity === 'Critical' || u.importance === 'Critical')
        const importantUpdates = pendingUpdates.filter(u => u.severity === 'Important' || u.importance === 'Important')
        const securityUpdates = pendingUpdates.filter(u => u.is_security_update === true || u.security === true)

        const totalSizeMB = pendingUpdates.reduce((sum, update) => {
          const sizeBytes = update.size_bytes || update.download_size || 0
          return sum + (sizeBytes / (1024 * 1024))
        }, 0)

        details.totalUpdates = pendingUpdates.length
        details.criticalCount = criticalUpdates.length
        details.importantCount = importantUpdates.length
        details.securityCount = securityUpdates.length
        details.optionalCount = pendingUpdates.length - criticalUpdates.length - importantUpdates.length
        details.totalSizeMB = Math.round(totalSizeMB)
        details.updateTitles = pendingUpdates.slice(0, 10).map((u: WindowsUpdate) => u.title || u.name || u.kb_number).filter(Boolean)

        issues.push(`${pendingUpdates.length} updates available (${criticalUpdates.length} critical, ${importantUpdates.length} important, ${securityUpdates.length} security)`)
        actions.push('install pending updates')

        if (criticalUpdates.length > 0) {
          highestSeverity = 'critical'
        } else if (importantUpdates.length > 0 && (highestSeverity === 'low' || highestSeverity === 'medium')) {
          highestSeverity = 'high'
        } else if (highestSeverity === 'low') {
          highestSeverity = 'medium'
        }
      }

      if (updateData.reboot_required === true) {
        flags.push('reboot_required')
        details.rebootRequired = true
        details.updatesPendingReboot = updateData.pending_reboot_updates || 0
        issues.push('system restart required')
        actions.push('restart computer')
        if (highestSeverity === 'low') highestSeverity = 'medium'
      }

      if (updateData.automatic_updates_enabled === false) {
        flags.push('auto_updates_disabled')
        details.automaticUpdatesDisabled = true
        issues.push('automatic updates disabled')
        actions.push('enable automatic updates')
        if (highestSeverity === 'low') highestSeverity = 'medium'
      }

      if (flags.length > 0) {
        const vmName = context.machineConfig?.name || 'VM'
        const text = `Windows Update issues detected on ${vmName}: ${issues.join(', ')}`
        const actionText = `Address Windows Update issues on ${vmName}: ${actions.join(', ')} through Settings > Update & Security > Windows Update`

        results.push({
          type: 'OS_UPDATE_AVAILABLE',
          text,
          actionText,
          data: {
            flags,
            severity: highestSeverity,
            ...details
          }
        })
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse windowsUpdateInfo:', error)
    }

    return results
  }
}
