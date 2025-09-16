import { RecommendationChecker, RecommendationContext, RecommendationResult, DiskUsageData } from './BaseRecommendationChecker'

export class DiskSpaceChecker extends RecommendationChecker {
  getName (): string { return 'DiskSpaceChecker' }
  getCategory (): string { return 'Storage' }

  private getCriticalThreshold (): number {
    return parseInt(process.env.DISK_SPACE_CRITICAL_THRESHOLD || '95', 10)
  }

  private getWarningThreshold (): number {
    return parseInt(process.env.DISK_SPACE_WARNING_THRESHOLD || '85', 10)
  }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []
    const criticalThreshold = this.getCriticalThreshold()
    const warningThreshold = this.getWarningThreshold()

    console.debug(`VM Recommendations: DiskSpaceChecker using thresholds - Critical: ${criticalThreshold}%, Warning: ${warningThreshold}%`)

    const diskUsage = this.extractDiskSpaceData(context)
    if (!diskUsage) {
      return results
    }

    try {
      for (const [drive, usage] of Object.entries(diskUsage)) {
        if (usage && typeof usage === 'object') {
          const usageData = usage as DiskUsageData
          const used = usageData.used || usageData.usedGB || 0
          const total = usageData.total || usageData.totalGB || 1
          const percentage = total > 0 ? Math.round((used / total) * 100) : 0
          const available = total - used

          if (percentage >= criticalThreshold) {
            results.push({
              type: 'DISK_SPACE_LOW',
              text: `Drive ${drive} is critically low on space (${used}GB of ${total}GB used, ${percentage}%)`,
              actionText: 'Immediately free up space by deleting unnecessary files, moving data to another drive, or expanding the disk',
              data: {
                drive,
                usedGB: used,
                totalGB: total,
                availableGB: available,
                usagePercent: percentage,
                severity: 'critical'
              }
            })
          } else if (percentage >= warningThreshold) {
            results.push({
              type: 'DISK_SPACE_LOW',
              text: `Drive ${drive} is running low on space (${used}GB of ${total}GB used, ${percentage}%)`,
              actionText: 'Free up space by deleting unnecessary files, moving data to another drive, or expanding the disk',
              data: {
                drive,
                usedGB: used,
                totalGB: total,
                availableGB: available,
                usagePercent: percentage,
                severity: 'medium'
              }
            })
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse disk space info:', error)
    }

    return results
  }
}