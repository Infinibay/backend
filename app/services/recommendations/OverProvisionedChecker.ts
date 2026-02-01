import { RecommendationChecker, RecommendationContext, RecommendationResult, DiskUsageData } from './BaseRecommendationChecker'

/**
 * OverProvisionedChecker - Detects over-allocated resources through temporal usage analysis
 *
 * @description
 * Analyzes resource utilization patterns over time to identify VMs with excessive resource
 * allocation. Uses historical metrics to calculate average and peak usage, identifying
 * opportunities for resource optimization without impacting performance.
 *
 * @category Resource Optimization
 *
 * @analysis
 * 1. **Temporal Analysis**: Requires minimum 5 days of metrics for reliable trends
 * 2. **CPU Analysis**:
 *    - Average usage <30% over 5+ days indicates over-provisioning
 *    - Recommendation: Reduce to 120% of peak usage (safety buffer)
 * 3. **RAM Analysis**:
 *    - Average usage <40% over 5+ days indicates over-provisioning
 *    - Recommendation: Reduce to 130% of peak usage (safety buffer)
 * 4. **Disk Analysis**:
 *    - Usage <50% AND allocated >2x used space indicates over-provisioning
 *    - Recommendation: Reduce to 150% of used space
 *
 * @input
 * - context.machineConfig: VM resource allocation (cpuCores, ramGB, diskSizeGB)
 * - context.historicalMetrics: Time-series resource usage data
 * - context.latestSnapshot.diskSpace: Current disk usage across drives
 *
 * @output
 * RecommendationResult[] with:
 * - type: 'OVER_PROVISIONED'
 * - text: Description of over-allocation with current usage stats
 * - actionText: Specific resource reduction recommendations
 * - data: {
 *     resourceType: 'CPU' | 'RAM' | 'DISK',
 *     allocatedCores/GB: number,      // Current allocation
 *     avgUsagePercent: number,        // Average utilization
 *     peakUsagePercent: number,       // Peak utilization
 *     recommendedCores/GB: number,    // Suggested allocation
 *     potentialSavings: number,       // Resources that can be freed
 *     efficiency: number,             // Current efficiency score
 *     daysAnalyzed: number           // Analysis time span
 *   }
 *
 * @thresholds
 * - CPU over-provisioned: Average <30% over 5+ days
 * - RAM over-provisioned: Average <40% over 5+ days
 * - Disk over-provisioned: Usage <50% AND allocated >2x used
 * - Minimum analysis period: 5 days of metrics
 * - Safety buffers: CPU 20%, RAM 30%, Disk 50%
 *
 * @example
 * ```typescript
 * // VM with 8 cores averaging 15% CPU usage over 7 days
 * machineConfig: { cpuCores: 8, ramGB: 16 }
 * metrics: [{ cpuUsagePercent: 15, timestamp: ... }, ...] // 7 days
 *
 * // Output:
 * [{
 *   type: 'OVER_PROVISIONED',
 *   text: 'VM has 8 CPU cores allocated but only uses 15% on average',
 *   actionText: 'Consider reducing allocated CPU cores to 4 to optimize resource utilization',
 *   data: {
 *     resourceType: 'CPU',
 *     allocatedCores: 8,
 *     avgUsagePercent: 15,
 *     peakUsagePercent: 28,
 *     recommendedCores: 4,
 *     potentialSavings: 4,
 *     efficiency: 15,
 *     daysAnalyzed: 7.2
 *   }
 * }]
 * ```
 */
export class OverProvisionedChecker extends RecommendationChecker {
  getName (): string { return 'OverProvisionedChecker' }
  getCategory (): string { return 'Resource Optimization' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.machineConfig || context.historicalMetrics.length < 5) {
      return results
    }

    const allocatedCores = context.machineConfig.cpuCores || 1
    const allocatedRamGB = context.machineConfig.ramGB || 1
    const allocatedDiskGB = context.machineConfig.diskSizeGB || 1

    const cpuMetrics = context.historicalMetrics
      .map(m => ({
        value: m.cpuUsagePercent,
        timestamp: m.timestamp
      }))
      .filter(m => m.value !== null && m.value !== undefined) as { value: number; timestamp: Date }[]

    const ramMetrics = context.historicalMetrics
      .map(m => {
        if (m.totalMemoryKB && m.usedMemoryKB) {
          const totalMem = typeof m.totalMemoryKB === 'bigint' ? Number(m.totalMemoryKB) : m.totalMemoryKB
          const usedMem = typeof m.usedMemoryKB === 'bigint' ? Number(m.usedMemoryKB) : m.usedMemoryKB
          return {
            value: (usedMem / totalMem) * 100,
            timestamp: m.timestamp
          }
        }
        return null
      })
      .filter(m => m !== null) as { value: number; timestamp: Date }[]

    if (cpuMetrics.length >= 5) {
      const cpuValues = cpuMetrics.map(m => m.value)
      const avgCpuUsage = cpuValues.reduce((sum, usage) => sum + usage, 0) / cpuValues.length
      const peakCpuUsage = Math.max(...cpuValues)

      const timestamps = cpuMetrics.map(m => m.timestamp.getTime())
      const minTimestamp = Math.min(...timestamps)
      const maxTimestamp = Math.max(...timestamps)
      const daysAnalyzed = (maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24)

      if (avgCpuUsage < 30 && daysAnalyzed >= 5) {
        const recommendedCores = Math.min(allocatedCores, Math.max(1, Math.ceil(allocatedCores * (peakCpuUsage / 100) * 1.2)))
        const potentialSavings = allocatedCores - recommendedCores

        if (potentialSavings > 0) {
          results.push({
            type: 'OVER_PROVISIONED',
            text: `VM has ${allocatedCores} CPU cores allocated but only uses ${Math.round(avgCpuUsage)}% on average`,
            actionText: `Consider reducing allocated CPU cores to ${recommendedCores} to optimize resource utilization`,
            data: {
              resourceType: 'CPU',
              allocatedCores,
              avgUsagePercent: Math.round(avgCpuUsage),
              peakUsagePercent: Math.round(peakCpuUsage),
              recommendedCores,
              potentialSavings,
              efficiency: Math.round(avgCpuUsage),
              daysAnalyzed: Math.round(daysAnalyzed * 10) / 10
            }
          })
        }
      }
    }

    if (ramMetrics.length >= 5) {
      const ramValues = ramMetrics.map(m => m.value)
      const avgRamUsage = ramValues.reduce((sum, usage) => sum + usage, 0) / ramValues.length
      const peakRamUsage = Math.max(...ramValues)

      const timestamps = ramMetrics.map(m => m.timestamp.getTime())
      const minTimestamp = Math.min(...timestamps)
      const maxTimestamp = Math.max(...timestamps)
      const daysAnalyzed = (maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24)

      if (avgRamUsage < 40 && daysAnalyzed >= 5) {
        const recommendedRamGB = Math.min(allocatedRamGB, Math.max(1, Math.ceil(allocatedRamGB * (peakRamUsage / 100) * 1.3)))
        const potentialSavings = allocatedRamGB - recommendedRamGB

        if (potentialSavings > 0) {
          results.push({
            type: 'OVER_PROVISIONED',
            text: `VM has ${allocatedRamGB}GB RAM allocated but only uses ${Math.round(avgRamUsage)}% on average`,
            actionText: `Consider reducing allocated RAM to ${recommendedRamGB}GB to optimize resource utilization`,
            data: {
              resourceType: 'RAM',
              allocatedGB: allocatedRamGB,
              avgUsagePercent: Math.round(avgRamUsage),
              peakUsagePercent: Math.round(peakRamUsage),
              recommendedGB: recommendedRamGB,
              potentialSavingsGB: potentialSavings,
              efficiency: Math.round(avgRamUsage),
              daysAnalyzed: Math.round(daysAnalyzed * 10) / 10
            }
          })
        }
      }
    }

    const diskUsage = this.extractDiskSpaceData(context)
    if (diskUsage) {
      try {
        let totalUsedGB = 0
        let totalAvailableGB = 0

        for (const [, usage] of Object.entries(diskUsage)) {
          if (usage && typeof usage === 'object') {
            const usageData = usage as DiskUsageData
            const used = usageData.used ?? usageData.usedGB ?? usageData.used_gb
            const total = usageData.total ?? usageData.totalGB ?? usageData.total_gb
            if (typeof used === 'number' && typeof total === 'number') {
              totalUsedGB += used
              totalAvailableGB += total
            }
          }
        }

        const diskUsagePercent = totalAvailableGB > 0 ? (totalUsedGB / totalAvailableGB) * 100 : 0

        if (diskUsagePercent < 50 && allocatedDiskGB > totalUsedGB * 2) {
          const recommendedDiskGB = Math.max(10, Math.ceil(totalUsedGB * 1.5))
          const potentialSavings = allocatedDiskGB - recommendedDiskGB

          results.push({
            type: 'OVER_PROVISIONED',
            text: `VM has ${allocatedDiskGB}GB disk allocated but only uses ${Math.round(diskUsagePercent)}% (${Math.round(totalUsedGB)}GB)`,
            actionText: `Consider reducing allocated disk space to ${recommendedDiskGB}GB to optimize storage utilization`,
            data: {
              resourceType: 'DISK',
              allocatedGB: allocatedDiskGB,
              usedGB: Math.round(totalUsedGB),
              availableGB: Math.round(totalAvailableGB),
              usagePercent: Math.round(diskUsagePercent),
              recommendedGB: recommendedDiskGB,
              potentialSavingsGB: potentialSavings,
              efficiency: Math.round(diskUsagePercent)
            }
          })
        }
      } catch (error) {
        console.warn('Failed to analyze disk usage for over-provisioning:', error)
      }
    }

    return results
  }
}
