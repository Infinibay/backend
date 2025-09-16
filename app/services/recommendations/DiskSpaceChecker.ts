import { RecommendationChecker, RecommendationContext, RecommendationResult, DiskUsageData } from './BaseRecommendationChecker'

/**
 * DiskSpaceChecker - Monitors disk space usage and alerts on critical or warning levels
 *
 * @description
 * Analyzes disk usage across all drives and generates recommendations when space is running low.
 * Uses configurable thresholds to determine severity levels and provides actionable guidance.
 *
 * @category Storage
 *
 * @analysis
 * 1. Extracts disk usage data from VM health snapshot
 * 2. Calculates usage percentage for each drive: (used / total) * 100
 * 3. Compares against configurable thresholds:
 *    - Critical: >95% (default) - Immediate action required
 *    - Warning: >85% (default) - Proactive cleanup recommended
 * 4. Generates recommendations with specific drive details and available space
 *
 * @input
 * - context.latestSnapshot.diskSpace: JSON object containing disk usage information
 *   Format: { "C:": { "used": 85.6, "total": 100.0, "usedGB": 85.6, "totalGB": 100.0 } }
 *
 * @output
 * RecommendationResult[] with:
 * - type: 'DISK_SPACE_LOW'
 * - text: Human-readable description of disk usage
 * - actionText: Specific cleanup recommendations
 * - data: { drive, usedGB, totalGB, availableGB, usagePercent, severity }
 *
 * @configuration
 * Environment variables:
 * - DISK_SPACE_CRITICAL_THRESHOLD: Critical usage percentage (default: 95)
 * - DISK_SPACE_WARNING_THRESHOLD: Warning usage percentage (default: 85)
 *
 * @example
 * ```typescript
 * // Input snapshot.diskSpace:
 * {
 *   "C:": { "used": 92.5, "total": 100.0 },
 *   "D:": { "used": 45.2, "total": 500.0 }
 * }
 *
 * // Output:
 * [{
 *   type: 'DISK_SPACE_LOW',
 *   text: 'Drive C: is running low on space (92.5GB of 100GB used, 93%)',
 *   actionText: 'Free up space by deleting unnecessary files...',
 *   data: { drive: 'C:', usedGB: 92.5, totalGB: 100, usagePercent: 93, severity: 'medium' }
 * }]
 * ```
 */
export class DiskSpaceChecker extends RecommendationChecker {
  getName (): string { return 'DiskSpaceChecker' }
  getCategory (): string { return 'Storage' }

  /**
   * Gets the critical disk space threshold from environment variables
   * @returns Critical threshold percentage (default: 95%)
   */
  private getCriticalThreshold (): number {
    return parseInt(process.env.DISK_SPACE_CRITICAL_THRESHOLD || '95', 10)
  }

  /**
   * Gets the warning disk space threshold from environment variables
   * @returns Warning threshold percentage (default: 85%)
   */
  private getWarningThreshold (): number {
    return parseInt(process.env.DISK_SPACE_WARNING_THRESHOLD || '85', 10)
  }

  /**
   * Analyzes disk space usage across all drives and generates recommendations
   *
   * @param context - Recommendation context containing VM health snapshot
   * @returns Array of recommendations for drives with low space
   */
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