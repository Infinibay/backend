import { RecommendationChecker, RecommendationContext, RecommendationResult, ThreatTimelineInfo } from './BaseRecommendationChecker'

interface ThreatInfo {
  name?: string
  threat_name?: string
  status?: string
  severity_id?: number
  detection_time?: string
  detected_at?: string
  quarantine_time?: string
}

export class DefenderThreatChecker extends RecommendationChecker {
  getName (): string { return 'DefenderThreatChecker' }
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
        console.warn('VMRecommendationService: Invalid defenderStatus format for threat analysis')
        return results
      }

      const threatsDetected = defenderData.threats_detected || 0
      const recentThreats = defenderData.recent_threats || []

      if (threatsDetected > 0 || (Array.isArray(recentThreats) && recentThreats.length > 0)) {
        const activeThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          threat.status &&
          (threat.status.toLowerCase() === 'active' || threat.status.toLowerCase() === 'detected')
        )

        const quarantinedThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          threat.status &&
          threat.status.toLowerCase() === 'quarantined'
        )

        const highSeverityThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          typeof threat.severity_id === 'number' &&
          threat.severity_id >= 4
        )

        const mediumSeverityThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          typeof threat.severity_id === 'number' &&
          threat.severity_id >= 2 && threat.severity_id < 4
        )

        if (activeThreats.length > 0) {
          const threatNames = activeThreats.slice(0, 3).map((t: ThreatInfo) => t.name || t.threat_name || 'Unknown threat')

          results.push({
            type: 'DEFENDER_THREAT',
            text: `${activeThreats.length} active security threats detected by Windows Defender`,
            actionText: 'Immediately review and remove threats through Windows Security > Virus & threat protection > Protection history',
            data: {
              activeThreats: activeThreats.length,
              totalThreats: threatsDetected,
              threatNames,
              highSeverityCount: highSeverityThreats.length,
              detectionDates: activeThreats.slice(0, 5).map((t: ThreatInfo) => t.detection_time || t.detected_at),
              severity: 'critical'
            }
          })
        } else if (highSeverityThreats.length > 0) {
          const threatName = highSeverityThreats[0].name || highSeverityThreats[0].threat_name || 'Unknown threat'

          results.push({
            type: 'DEFENDER_THREAT',
            text: `High-severity threat detected: ${threatName}`,
            actionText: 'Immediately review and remove this threat through Windows Security',
            data: {
              highSeverityThreats: highSeverityThreats.length,
              totalThreats: threatsDetected,
              threatName,
              severityId: highSeverityThreats[0].severity_id,
              detectionTime: highSeverityThreats[0].detection_time || highSeverityThreats[0].detected_at,
              status: highSeverityThreats[0].status,
              severity: 'high'
            }
          })
        } else if (quarantinedThreats.length > 0) {
          results.push({
            type: 'DEFENDER_THREAT',
            text: `${quarantinedThreats.length} threats quarantined by Windows Defender`,
            actionText: 'Review quarantined threats and ensure they are properly removed',
            data: {
              quarantinedThreats: quarantinedThreats.length,
              totalThreats: threatsDetected,
              threatNames: quarantinedThreats.slice(0, 5).map((t: ThreatInfo) => t.name || t.threat_name || 'Unknown threat'),
              quarantineDates: quarantinedThreats.slice(0, 5).map((t: ThreatInfo) => t.quarantine_time || t.detection_time),
              severity: 'medium'
            }
          })
        } else if (threatsDetected > 0) {
          const recentActivity = recentThreats.some((threat: ThreatInfo) => {
            const dateResult = this.parseAndCalculateDaysSince(threat.detection_time || threat.detected_at)
            return dateResult.isValid && dateResult.daysSince <= 7
          })

          if (recentActivity) {
            results.push({
              type: 'DEFENDER_THREAT',
              text: 'Recent security threat activity detected (last 7 days)',
              actionText: 'Monitor system security and consider running a full system scan',
              data: {
                totalThreats: threatsDetected,
                recentActivity: true,
                mediumSeverityCount: mediumSeverityThreats.length,
                threatTimeline: recentThreats.slice(0, 5).map((t: ThreatInfo) => ({
                  name: t.name || t.threat_name,
                  detectionTime: t.detection_time || t.detected_at,
                  status: t.status,
                  severity: t.severity_id
                })),
                severity: 'medium'
              }
            })
          }
        }
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse defenderStatus for threat analysis:', error)
    }

    return results
  }
}