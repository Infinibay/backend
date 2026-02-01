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

interface WindowsUpdateStatus {
  pending_updates?: WindowsUpdate[]
  reboot_required?: boolean
  reboot_required_since?: string
  automatic_updates_enabled?: boolean
  last_check_date?: string
  pending_reboot_updates?: number
}

interface LinuxPendingUpdate {
  package_name?: string
  current_version?: string
  available_version?: string
  repository?: string
  is_security?: boolean
  architecture?: string
}

interface LinuxUpdateStatus {
  pending_updates?: LinuxPendingUpdate[]
  security_updates_count?: number
  total_pending_count?: number
  package_manager?: string
  reboot_required?: boolean
  reboot_required_since?: string
  distro?: string
}

/**
 * OsUpdateChecker - Monitors OS update status and recommends system maintenance
 *
 * @description
 * Analyzes update information for both Windows and Linux VMs to identify pending
 * updates, security patches, and system maintenance needs. Prioritizes critical
 * and security updates while tracking update configuration and reboot requirements.
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
 *     rebootPendingDays?: number,        // Days since reboot required
 *     rebootRequiredSince?: string,      // Timestamp when reboot became required
 *     rebootUrgent?: boolean,            // true if pending >7 days (critical)
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
 * - **Critical**: Any critical updates present OR reboot pending >7 days
 * - **High**: Important updates (no critical) OR reboot pending 3-7 days
 * - **Medium**: Security/optional updates, config issues, reboot pending <3 days
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
 *   reboot_required_since: "2025-10-08T12:30:00Z",
 *   automatic_updates_enabled: false
 * }
 *
 * // Output:
 * [{
 *   type: 'OS_UPDATE_AVAILABLE',
 *   text: 'Windows Update issues detected on VM-Server-01: 2 updates available (1 critical, 1 important, 1 security), system restart required (pending 8 days), automatic updates disabled',
 *   actionText: 'Address Windows Update issues on VM-Server-01: install pending updates, restart computer immediately (pending 8 days), enable automatic updates through Settings > Update & Security > Windows Update',
 *   data: {
 *     flags: ['pending_updates', 'reboot_required', 'auto_updates_disabled'],
 *     severity: 'critical',
 *     totalUpdates: 2,
 *     criticalCount: 1,
 *     importantCount: 1,
 *     securityCount: 1,
 *     totalSizeMB: 2148,
 *     rebootRequired: true,
 *     rebootPendingDays: 8,
 *     rebootRequiredSince: '2025-10-08T12:30:00Z',
 *     rebootUrgent: true,
 *     automaticUpdatesDisabled: true
 *   }
 * }]
 * ```
 */
export class OsUpdateChecker extends RecommendationChecker {
  getName (): string { return 'OsUpdateChecker' }
  getCategory (): string { return 'Maintenance' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const os = context.machineConfig?.os?.toLowerCase() || ''
    const isWindows = os.includes('windows')
    const isLinux = os.includes('linux') || os.includes('ubuntu') || os.includes('fedora') || os.includes('debian') || os.includes('centos') || os.includes('rhel')

    if (isWindows && context.latestSnapshot?.windowsUpdateInfo) {
      return this.analyzeWindows(context)
    }

    if (isLinux && context.latestSnapshot?.linuxUpdateInfo) {
      return this.analyzeLinux(context)
    }

    return []
  }

  private async analyzeWindows (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    try {
      const updateData: WindowsUpdateStatus = typeof context.latestSnapshot!.windowsUpdateInfo === 'string'
        ? JSON.parse(context.latestSnapshot!.windowsUpdateInfo)
        : context.latestSnapshot!.windowsUpdateInfo

      if (!updateData || typeof updateData !== 'object') {
        console.warn('VMRecommendationService: Invalid windowsUpdateInfo format')
        return results
      }

      const flags: string[] = []
      const details: Record<string, unknown> = {}
      const issues: string[] = []
      const actions: string[] = []
      let highestSeverity = 'low'

      const lastCheckResult = this.parseAndCalculateDaysSince(updateData.last_check_date)
      if (lastCheckResult.isValid && lastCheckResult.daysSince > 7) {
        flags.push('stale_check_date')
        if (updateData.last_check_date) {
          details.lastCheckDate = updateData.last_check_date
        }
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

        // Add full update objects for frontend display
        details.updates = pendingUpdates.slice(0, 20).map((u: WindowsUpdate) => ({
          title: u.title || u.name || 'Unknown Update',
          kb: u.kb_number || null,
          type: u.severity || (u.is_security_update ? 'Security' : 'Update'),
          size: u.size_bytes ? `${Math.round(u.size_bytes / (1024 * 1024))} MB` : null,
          requiresReboot: true
        }))

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

        // Track reboot age if available
        if (updateData.reboot_required_since) {
          const rebootAgeResult = this.parseAndCalculateDaysSince(updateData.reboot_required_since)
          if (rebootAgeResult.isValid && rebootAgeResult.daysSince > 0) {
            details.rebootPendingDays = rebootAgeResult.daysSince
            details.rebootRequiredSince = updateData.reboot_required_since

            // Update issue text with reboot age
            issues.push(`system restart required (pending ${rebootAgeResult.daysSince} days)`)

            // Escalate severity based on reboot age and set urgency flag
            if (rebootAgeResult.daysSince > 7) {
              // Critical: Reboot overdue (>7 days)
              highestSeverity = 'critical'
              details.rebootUrgent = true
              actions.push(`restart computer immediately (pending ${rebootAgeResult.daysSince} days)`)
            } else if (rebootAgeResult.daysSince >= 3) {
              // High: Reboot should happen soon (3-7 days)
              if (highestSeverity === 'low' || highestSeverity === 'medium') {
                highestSeverity = 'high'
              }
              actions.push(`restart as soon as possible (pending ${rebootAgeResult.daysSince} days)`)
            } else {
              // Medium: Reboot needed but not urgent (<3 days)
              if (highestSeverity === 'low') {
                highestSeverity = 'medium'
              }
              actions.push('restart computer')
            }
          } else {
            // Fallback if parsing failed or days is 0
            issues.push('system restart required')
            actions.push('restart computer')
            if (highestSeverity === 'low') highestSeverity = 'medium'
          }
        } else {
          // Fallback if reboot_required_since not available
          issues.push('system restart required')
          actions.push('restart computer')
          if (highestSeverity === 'low') highestSeverity = 'medium'
        }
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
        const text = `System updates available for ${vmName}: ${issues.join(', ')}`
        const actionText = `Update ${vmName}: ${actions.join(', ')} through Settings > Update & Security > Windows Update`

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

  private async analyzeLinux (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    try {
      const updateData: LinuxUpdateStatus = typeof context.latestSnapshot!.linuxUpdateInfo === 'string'
        ? JSON.parse(context.latestSnapshot!.linuxUpdateInfo)
        : context.latestSnapshot!.linuxUpdateInfo

      if (!updateData || typeof updateData !== 'object') {
        console.warn('VMRecommendationService: Invalid linuxUpdateInfo format')
        return results
      }

      const flags: string[] = []
      const details: Record<string, unknown> = {}
      const issues: string[] = []
      const actions: string[] = []
      let highestSeverity = 'low'

      const distro = updateData.distro || 'Linux'
      const packageManager = updateData.package_manager || 'apt'
      const upgradeCmd = packageManager === 'dnf' ? 'sudo dnf upgrade' : packageManager === 'yum' ? 'sudo yum update' : 'sudo apt upgrade'

      details.distro = distro
      details.packageManager = packageManager

      const pendingUpdates = updateData.pending_updates || []
      const totalPending = updateData.total_pending_count ?? pendingUpdates.length
      const securityCount = updateData.security_updates_count ?? pendingUpdates.filter(u => u.is_security === true).length

      if (totalPending > 0) {
        flags.push('pending_updates')

        details.totalUpdates = totalPending
        details.securityCount = securityCount
        details.updateTitles = pendingUpdates.slice(0, 10).map((u: LinuxPendingUpdate) => u.package_name).filter(Boolean)

        // Add full update objects for frontend display
        details.updates = pendingUpdates.slice(0, 20).map((u: LinuxPendingUpdate) => ({
          title: u.package_name || 'Unknown Package',
          currentVersion: u.current_version || null,
          availableVersion: u.available_version || null,
          type: u.is_security ? 'Security' : 'Update',
          repository: u.repository || null
        }))

        const updateSummary = securityCount > 0
          ? `${totalPending} updates available (${securityCount} security)`
          : `${totalPending} updates available`
        issues.push(updateSummary)
        actions.push(`install pending updates with \`${upgradeCmd}\``)

        // Severity based on security updates and total count
        if (securityCount > 0) {
          highestSeverity = 'critical'
        } else if (totalPending > 20) {
          highestSeverity = 'high'
        } else {
          highestSeverity = 'medium'
        }
      }

      if (updateData.reboot_required === true) {
        flags.push('reboot_required')
        details.rebootRequired = true

        if (updateData.reboot_required_since) {
          const rebootAgeResult = this.parseAndCalculateDaysSince(updateData.reboot_required_since)
          if (rebootAgeResult.isValid && rebootAgeResult.daysSince > 0) {
            details.rebootPendingDays = rebootAgeResult.daysSince
            details.rebootRequiredSince = updateData.reboot_required_since
            issues.push(`system reboot required (pending ${rebootAgeResult.daysSince} days)`)

            if (rebootAgeResult.daysSince > 3) {
              if (highestSeverity !== 'critical') highestSeverity = 'high'
              details.rebootUrgent = true
              actions.push(`reboot system immediately (pending ${rebootAgeResult.daysSince} days)`)
            } else {
              if (highestSeverity === 'low') highestSeverity = 'medium'
              actions.push('reboot system')
            }
          } else {
            issues.push('system reboot required')
            actions.push('reboot system')
            if (highestSeverity === 'low') highestSeverity = 'medium'
          }
        } else {
          issues.push('system reboot required')
          actions.push('reboot system')
          if (highestSeverity === 'low') highestSeverity = 'medium'
        }
      }

      if (flags.length > 0) {
        const vmName = context.machineConfig?.name || 'VM'
        const text = `System updates available for ${vmName} (${distro}): ${issues.join(', ')}`
        const actionText = `Update ${vmName}: ${actions.join(', ')}`

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
      console.warn('VMRecommendationService: Failed to parse linuxUpdateInfo:', error)
    }

    return results
  }
}
