import { RecommendationChecker, RecommendationContext, RecommendationResult, DiskUsageData } from './BaseRecommendationChecker'

export class UnderProvisionedChecker extends RecommendationChecker {
  getName (): string { return 'UnderProvisionedChecker' }
  getCategory (): string { return 'Resource Optimization' }

  private calculateHighUsageTime (
    metrics: { value: number; timestamp: Date }[],
    threshold: number
  ): number {
    if (metrics.length < 2) return 0

    let totalHighUsageMs = 0
    const sortedMetrics = [...metrics].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    for (let i = 0; i < sortedMetrics.length - 1; i++) {
      const current = sortedMetrics[i]
      const next = sortedMetrics[i + 1]

      if (current.value > threshold) {
        const timeSpanMs = next.timestamp.getTime() - current.timestamp.getTime()
        totalHighUsageMs += timeSpanMs
      }
    }

    return totalHighUsageMs / (1000 * 60 * 60)
  }

  private calculateLowAvailableTime (
    metrics: { availableMB: number; totalMB: number; timestamp: Date }[],
    thresholdMB: number,
    thresholdPercent: number
  ): number {
    if (metrics.length < 2) return 0

    let totalLowAvailableMs = 0
    const sortedMetrics = [...metrics].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    for (let i = 0; i < sortedMetrics.length - 1; i++) {
      const current = sortedMetrics[i]
      const next = sortedMetrics[i + 1]

      const availablePercent = current.totalMB > 0 ? (current.availableMB / current.totalMB) * 100 : 0
      const isLowAvailable = current.availableMB < thresholdMB || availablePercent < thresholdPercent

      if (isLowAvailable) {
        const timeSpanMs = next.timestamp.getTime() - current.timestamp.getTime()
        totalLowAvailableMs += timeSpanMs
      }
    }

    return totalLowAvailableMs / (1000 * 60 * 60)
  }

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

    const swapMetrics = context.historicalMetrics
      .map(m => {
        if (m.swapTotalKB && m.swapUsedKB) {
          const totalSwap = typeof m.swapTotalKB === 'bigint' ? Number(m.swapTotalKB) : m.swapTotalKB
          const usedSwap = typeof m.swapUsedKB === 'bigint' ? Number(m.swapUsedKB) : m.swapUsedKB
          return {
            usagePercent: totalSwap > 0 ? (usedSwap / totalSwap) * 100 : 0,
            usedMB: Math.round(usedSwap / 1024),
            totalMB: Math.round(totalSwap / 1024),
            timestamp: m.timestamp
          }
        }
        return null
      })
      .filter(m => m !== null) as { usagePercent: number; usedMB: number; totalMB: number; timestamp: Date }[]

    const availableMemoryMetrics = context.historicalMetrics
      .map(m => {
        if (m.availableMemoryKB && m.totalMemoryKB) {
          const availableKB = typeof m.availableMemoryKB === 'bigint' ? Number(m.availableMemoryKB) : m.availableMemoryKB
          const totalKB = typeof m.totalMemoryKB === 'bigint' ? Number(m.totalMemoryKB) : m.totalMemoryKB
          return {
            availableMB: Math.round(availableKB / 1024),
            totalMB: Math.round(totalKB / 1024),
            timestamp: m.timestamp
          }
        }
        return null
      })
      .filter(m => m !== null) as { availableMB: number; totalMB: number; timestamp: Date }[]

    // Analyze CPU under-provisioning
    if (cpuMetrics.length >= 5) {
      const cpuValues = cpuMetrics.map(m => m.value)
      const avgCpuUsage = cpuValues.reduce((sum, usage) => sum + usage, 0) / cpuValues.length
      const peakCpuUsage = Math.max(...cpuValues)
      const hoursHighUsage = this.calculateHighUsageTime(cpuMetrics, 85)

      if (hoursHighUsage > 2 && peakCpuUsage > 90) {
        const recommendedCores = Math.ceil(allocatedCores * 1.5)
        const performanceImpact = hoursHighUsage > 6 ? 'high' : 'medium'

        results.push({
          type: 'UNDER_PROVISIONED',
          text: `VM frequently runs out of CPU resources - usage exceeds 85% for ${Math.round(hoursHighUsage)} hours in analyzed period`,
          actionText: `Consider increasing CPU allocation from ${allocatedCores} to ${recommendedCores} cores to improve performance`,
          data: {
            resourceType: 'CPU',
            currentCores: allocatedCores,
            avgUsagePercent: Math.round(avgCpuUsage),
            peakUsagePercent: Math.round(peakCpuUsage),
            hoursHighUsage: Math.round(hoursHighUsage),
            recommendedCores,
            performanceImpact,
            metricsAnalyzed: cpuMetrics.length,
            highUsageFrequency: Math.round((cpuValues.filter(u => u > 85).length / cpuValues.length) * 100)
          }
        })
      }
    }

    // Analyze RAM under-provisioning with swap indicators
    if (ramMetrics.length >= 5) {
      const ramValues = ramMetrics.map(m => m.value)
      const avgRamUsage = ramValues.reduce((sum, usage) => sum + usage, 0) / ramValues.length
      const peakRamUsage = Math.max(...ramValues)
      const hoursHighUsage = this.calculateHighUsageTime(ramMetrics, 90)

      // Analyze swap usage patterns
      let swapPressure = false
      let avgSwapUsage = 0
      let peakSwapUsage = 0
      let swapUsageCount = 0
      let hoursSwapUsed = 0

      if (swapMetrics.length > 0) {
        const swapValues = swapMetrics.map(m => m.usagePercent)
        avgSwapUsage = swapValues.reduce((sum, usage) => sum + usage, 0) / swapValues.length
        peakSwapUsage = Math.max(...swapValues)
        swapUsageCount = swapValues.filter(usage => usage > 10).length

        const swapHighUsageMetrics = swapMetrics
          .filter(m => m.usagePercent > 10)
          .map(m => ({ value: m.usagePercent, timestamp: m.timestamp }))
        hoursSwapUsed = this.calculateHighUsageTime(swapHighUsageMetrics, 10)

        swapPressure = swapUsageCount > 0 && (avgSwapUsage > 5 || peakSwapUsage > 20)
      }

      // Analyze available memory patterns
      let lowAvailableMemHours = 0
      let avgAvailableMB = 0
      let minAvailableMB = 0
      let availablePressure = false

      if (availableMemoryMetrics.length > 0) {
        const availableValues = availableMemoryMetrics.map(m => m.availableMB)
        avgAvailableMB = availableValues.reduce((sum, available) => sum + available, 0) / availableValues.length
        minAvailableMB = Math.min(...availableValues)

        lowAvailableMemHours = this.calculateLowAvailableTime(availableMemoryMetrics, 512, 10)
        availablePressure = lowAvailableMemHours > 1 && (avgAvailableMB < 1024 || minAvailableMB < 256)
      }

      const memoryPressure = hoursHighUsage > 1 && peakRamUsage > 95
      const shouldRecommend = memoryPressure || swapPressure || availablePressure

      if (shouldRecommend) {
        const severePressure = swapPressure && availablePressure
        const recommendedRamGB = Math.ceil(allocatedRamGB * (severePressure ? 2.5 : swapPressure ? 2.0 : 1.5))
        const performanceImpact = (hoursHighUsage > 4 || hoursSwapUsed > 2 || lowAvailableMemHours > 4) ? 'high' : 'medium'

        let message = ''
        let actionText = ''

        if (severePressure) {
          message = `VM is critically memory-constrained - RAM usage exceeds 90% for ${Math.round(hoursHighUsage)} hours, swap is heavily used (${Math.round(avgSwapUsage)}% average), and available memory is low for ${Math.round(lowAvailableMemHours)} hours`
          actionText = `Urgently increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB - multiple memory pressure indicators detected`
        } else if (swapPressure && memoryPressure) {
          message = `VM is severely memory-constrained - RAM usage exceeds 90% for ${Math.round(hoursHighUsage)} hours and swap is heavily used (${Math.round(avgSwapUsage)}% average, ${Math.round(peakSwapUsage)}% peak)`
          actionText = `Urgently increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB - swap usage indicates severe memory pressure`
        } else if (availablePressure && memoryPressure) {
          message = `VM is memory-constrained - RAM usage exceeds 90% for ${Math.round(hoursHighUsage)} hours and available memory is frequently low (${Math.round(avgAvailableMB)}MB average, ${minAvailableMB}MB minimum)`
          actionText = `Increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to improve memory availability`
        } else if (swapPressure) {
          message = `VM is using swap memory heavily (${Math.round(avgSwapUsage)}% average, ${Math.round(peakSwapUsage)}% peak) indicating insufficient RAM`
          actionText = `Increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to reduce swap usage and improve performance`
        } else if (availablePressure) {
          message = `VM has frequently low available memory (${Math.round(avgAvailableMB)}MB average, ${minAvailableMB}MB minimum) for ${Math.round(lowAvailableMemHours)} hours`
          actionText = `Increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to improve memory availability`
        } else {
          message = `VM frequently runs out of memory - usage exceeds 90% for ${Math.round(hoursHighUsage)} hours in analyzed period`
          actionText = `Consider increasing RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to improve performance`
        }

        results.push({
          type: 'UNDER_PROVISIONED',
          text: message,
          actionText,
          data: {
            resourceType: 'RAM',
            currentGB: allocatedRamGB,
            avgUsagePercent: Math.round(avgRamUsage),
            peakUsagePercent: Math.round(peakRamUsage),
            hoursHighUsage: Math.round(hoursHighUsage),
            recommendedGB: recommendedRamGB,
            performanceImpact,
            metricsAnalyzed: ramMetrics.length,
            highUsageFrequency: Math.round((ramValues.filter(u => u > 90).length / ramValues.length) * 100),
            swapPressure,
            avgSwapUsage: Math.round(avgSwapUsage),
            peakSwapUsage: Math.round(peakSwapUsage),
            hoursSwapUsed: Math.round(hoursSwapUsed),
            swapMetricsAnalyzed: swapMetrics.length,
            availablePressure,
            avgAvailableMB: Math.round(avgAvailableMB),
            minAvailableMB,
            lowAvailableMemHours: Math.round(lowAvailableMemHours),
            availableMetricsAnalyzed: availableMemoryMetrics.length
          }
        })
      }
    }

    // Analyze disk under-provisioning
    const diskUsage = this.extractDiskSpaceData(context)
    if (diskUsage) {
      try {
        for (const [drive, usage] of Object.entries(diskUsage)) {
          if (usage && typeof usage === 'object') {
            const usageData = usage as DiskUsageData
            const used = usageData.used || usageData.usedGB || 0
            const total = usageData.total || usageData.totalGB || 1
            const percentage = total > 0 ? (used / total) * 100 : 0

            if (percentage > 90) {
              const currentDriveGB = Math.round(total)
              const recommendedDriveGB = Math.ceil(currentDriveGB * 1.3)
              const performanceImpact = percentage > 95 ? 'high' : 'medium'
              const additionalSpaceNeeded = recommendedDriveGB - currentDriveGB

              results.push({
                type: 'UNDER_PROVISIONED',
                text: `VM disk space is critically low - ${drive} drive usage is ${Math.round(percentage)}% (${Math.round(used)}GB of ${currentDriveGB}GB used)`,
                actionText: `Consider expanding ${drive} drive from ${currentDriveGB}GB to ${recommendedDriveGB}GB (add ${additionalSpaceNeeded}GB) to prevent performance issues`,
                data: {
                  resourceType: 'DISK',
                  drive,
                  currentDriveGB,
                  usedGB: Math.round(used),
                  totalGB: Math.round(total),
                  usagePercent: Math.round(percentage),
                  recommendedDriveGB,
                  additionalSpaceNeeded,
                  performanceImpact,
                  availableGB: Math.round(total - used),
                  machineConfigDiskGB: allocatedDiskGB
                }
              })
            }
          }
        }
      } catch (error) {
        console.warn('Failed to analyze disk usage for under-provisioning:', error)
      }
    }

    return results
  }
}