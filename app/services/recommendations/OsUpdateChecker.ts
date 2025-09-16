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