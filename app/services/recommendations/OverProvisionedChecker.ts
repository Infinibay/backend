import { RecommendationChecker, RecommendationContext, RecommendationResult, DiskUsageData } from './BaseRecommendationChecker'

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
        const recommendedCores = Math.max(1, Math.ceil(allocatedCores * (peakCpuUsage / 100) * 1.2))
        const potentialSavings = allocatedCores - recommendedCores

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
            efficiency: Math.round((avgCpuUsage / 100) * 100),
            daysAnalyzed: Math.round(daysAnalyzed * 10) / 10
          }
        })
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
        const recommendedRamGB = Math.max(1, Math.ceil(allocatedRamGB * (peakRamUsage / 100) * 1.3))
        const potentialSavings = allocatedRamGB - recommendedRamGB

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
            efficiency: Math.round((avgRamUsage / 100) * 100),
            daysAnalyzed: Math.round(daysAnalyzed * 10) / 10
          }
        })
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
            const used = usageData.used || usageData.usedGB
            const total = usageData.total || usageData.totalGB
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