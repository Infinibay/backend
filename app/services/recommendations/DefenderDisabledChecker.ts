import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'

interface DefenderStatus {
  enabled?: boolean
  real_time_protection?: boolean
  signature_age_days?: number
  threats_detected?: number
  recent_threats?: unknown[]
  last_quick_scan?: string
  last_full_scan?: string
  last_signature_update?: string
  engine_version?: string
  scan_history?: unknown[]
}

/**
 * DefenderDisabledChecker - Monitors Windows Defender security status and configuration
 *
 * @description
 * Analyzes Windows Defender status to ensure proper antivirus protection is active.
 * Checks main protection settings, signature freshness, and scan history.
 *
 * @category Security
 *
 * @analysis
 * 1. Main protection: Defender enabled/disabled
 * 2. Real-time protection: Active monitoring status
 * 3. Signature age: >3 days (medium), >7 days (high), >14 days (critical)
 * 4. Scan history: No recent scans or >7 days since last scan
 *
 * @input
 * - context.latestSnapshot.defenderStatus: Defender configuration and status
 *
 * @output
 * - type: 'DEFENDER_DISABLED'
 * - Severity: 'critical' (disabled), 'high' (real-time off), 'medium' (outdated)
 * - Specific configuration issues and remediation steps
 *
 * @checks
 * - Defender completely disabled (critical)
 * - Real-time protection disabled (high)
 * - Outdated virus signatures (medium/high)
 * - Missing scan history (medium)
 */
export class DefenderDisabledChecker extends RecommendationChecker {
  getName (): string { return 'DefenderDisabledChecker' }
  getCategory (): string { return 'Security' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.latestSnapshot?.defenderStatus) {
      return results
    }

    try {
      const defenderData = typeof context.latestSnapshot.defenderStatus === 'string'
        ? JSON.parse(context.latestSnapshot.defenderStatus)
        : context.latestSnapshot.defenderStatus

      if (!defenderData || typeof defenderData !== 'object') {
        console.warn('VMRecommendationService: Invalid defenderStatus format')
        return results
      }

      if (defenderData.enabled === false) {
        results.push({
          type: 'DEFENDER_DISABLED',
          text: 'Windows Defender antivirus protection is disabled',
          actionText: 'Enable Windows Defender through Settings > Update & Security > Windows Security',
          data: {
            defenderDisabled: true,
            realTimeProtection: defenderData.real_time_protection || false,
            lastQuickScan: defenderData.last_quick_scan,
            lastFullScan: defenderData.last_full_scan,
            signatureAge: defenderData.signature_age_days,
            severity: 'critical'
          }
        })
      } else if (defenderData.real_time_protection === false) {
        const vmName = context.machineConfig?.name || 'VM'
        results.push({
          type: 'DEFENDER_DISABLED',
          text: `Windows Defender real-time protection is disabled on ${vmName}`,
          actionText: `Enable real-time protection on ${vmName} in Windows Security > Virus & threat protection settings`,
          data: {
            realTimeProtectionDisabled: true,
            defenderEnabled: true,
            lastQuickScan: defenderData.last_quick_scan,
            lastFullScan: defenderData.last_full_scan,
            signatureAge: defenderData.signature_age_days,
            severity: 'high'
          }
        })
      }

      if (defenderData.enabled !== false) {
        const signatureAge = defenderData.signature_age_days
        if (typeof signatureAge === 'number' && signatureAge !== 999) {
          const vmName = context.machineConfig?.name || 'VM'
          if (signatureAge > 7) {
            results.push({
              type: 'DEFENDER_DISABLED',
              text: `Windows Defender virus signatures on ${vmName} are ${signatureAge} days old`,
              actionText: `Update virus signatures on ${vmName} through Windows Security > Virus & threat protection > Check for updates`,
              data: {
                outdatedSignatures: true,
                signatureAgeDays: signatureAge,
                lastSignatureUpdate: defenderData.last_signature_update,
                engineVersion: defenderData.engine_version,
                severity: signatureAge > 14 ? 'critical' : 'high'
              }
            })
          } else if (signatureAge > 3) {
            results.push({
              type: 'DEFENDER_DISABLED',
              text: `Windows Defender virus signatures on ${vmName} are ${signatureAge} days old`,
              actionText: `Update virus signatures on ${vmName} through Windows Security > Virus & threat protection > Check for updates`,
              data: {
                outdatedSignatures: true,
                signatureAgeDays: signatureAge,
                lastSignatureUpdate: defenderData.last_signature_update,
                engineVersion: defenderData.engine_version,
                severity: 'medium'
              }
            })
          }
        }

        const lastQuickScan = defenderData.last_quick_scan
        const lastFullScan = defenderData.last_full_scan

        if (!lastQuickScan && !lastFullScan) {
          results.push({
            type: 'DEFENDER_DISABLED',
            text: 'No recent Windows Defender scans detected',
            actionText: 'Run a quick scan through Windows Security > Virus & threat protection',
            data: {
              noRecentScans: true,
              lastQuickScan: null,
              lastFullScan: null,
              scanHistory: defenderData.scan_history || [],
              severity: 'medium'
            }
          })
        } else {
          const quickScanResult = this.parseAndCalculateDaysSince(lastQuickScan)
          const fullScanResult = this.parseAndCalculateDaysSince(lastFullScan)

          let mostRecentDays: number | null = null
          if (quickScanResult.isValid && fullScanResult.isValid) {
            mostRecentDays = Math.min(quickScanResult.daysSince, fullScanResult.daysSince)
          } else if (quickScanResult.isValid) {
            mostRecentDays = quickScanResult.daysSince
          } else if (fullScanResult.isValid) {
            mostRecentDays = fullScanResult.daysSince
          }

          if (mostRecentDays !== null && mostRecentDays > 7) {
            results.push({
              type: 'DEFENDER_DISABLED',
              text: `Last Windows Defender scan was ${mostRecentDays} days ago`,
              actionText: 'Run a quick scan through Windows Security > Virus & threat protection',
              data: {
                outdatedScans: true,
                daysSinceLastScan: mostRecentDays,
                lastQuickScan,
                lastFullScan,
                severity: mostRecentDays > 14 ? 'medium' : 'low'
              }
            })
          }
        }
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse defenderStatus:', error)
    }

    return results
  }
}
