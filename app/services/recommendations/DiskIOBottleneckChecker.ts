import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'

export class DiskIOBottleneckChecker extends RecommendationChecker {
  getName (): string { return 'DiskIOBottleneckChecker' }
  getCategory (): string { return 'Performance' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (context.historicalMetrics.length < 10) {
      return results
    }

    try {
      const ioMetrics = context.historicalMetrics
        .map(m => {
          if (m.diskIOStats) {
            try {
              const ioData = typeof m.diskIOStats === 'string'
                ? JSON.parse(m.diskIOStats)
                : m.diskIOStats

              if (ioData && typeof ioData === 'object') {
                const readBytes = ioData.readBytes || ioData.diskReadBytes || ioData.bytesRead || 0
                const writeBytes = ioData.writeBytes || ioData.diskWriteBytes || ioData.bytesWrite || 0

                if (readBytes > 0 || writeBytes > 0) {
                  return {
                    readMB: Math.round(readBytes / (1024 * 1024)),
                    writeMB: Math.round(writeBytes / (1024 * 1024)),
                    totalMB: Math.round((readBytes + writeBytes) / (1024 * 1024)),
                    timestamp: m.timestamp
                  }
                }
              }
            } catch (error) {
              console.warn('Failed to parse diskIOStats:', error)
            }
          }
          return null
        })
        .filter(m => m !== null) as { readMB: number; writeMB: number; totalMB: number; timestamp: Date }[]

      if (ioMetrics.length < 5) {
        return results
      }

      const ioRates = []
      for (let i = 1; i < ioMetrics.length; i++) {
        const current = ioMetrics[i]
        const previous = ioMetrics[i - 1]
        const timeDiffSeconds = (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000

        if (timeDiffSeconds > 0 && timeDiffSeconds < 3600) {
          const readRate = Math.max(0, (current.readMB - previous.readMB) / timeDiffSeconds)
          const writeRate = Math.max(0, (current.writeMB - previous.writeMB) / timeDiffSeconds)
          const totalRate = readRate + writeRate

          ioRates.push({
            readRate,
            writeRate,
            totalRate,
            timestamp: current.timestamp
          })
        }
      }

      if (ioRates.length < 3) {
        return results
      }

      const totalRates = ioRates.map(r => r.totalRate)
      const avgTotalRate = totalRates.reduce((sum, rate) => sum + rate, 0) / totalRates.length
      const peakTotalRate = Math.max(...totalRates)

      const lowThroughputCount = totalRates.filter(rate => rate < 5).length
      const lowThroughputPercent = (lowThroughputCount / totalRates.length) * 100

      let ioWaitHigh = false
      let avgIoWait = 0

      if (context.latestSnapshot?.resourceOptInfo) {
        try {
          const resourceData = typeof context.latestSnapshot.resourceOptInfo === 'string'
            ? JSON.parse(context.latestSnapshot.resourceOptInfo)
            : context.latestSnapshot.resourceOptInfo

          if (resourceData && typeof resourceData === 'object') {
            if (resourceData.ioWaitPercent || resourceData.await || resourceData.avgWait || resourceData.diskIOStats) {
              const ioStats = resourceData.diskIOStats || resourceData
              avgIoWait = ioStats.ioWaitPercent || ioStats.await || ioStats.avgWait || 0
              ioWaitHigh = avgIoWait > 20
            }
          }
        } catch (error) {
          console.warn('Failed to parse resource optimization data for I/O stats:', error)
        }
      }

      if (lowThroughputPercent > 60 || ioWaitHigh || (avgTotalRate < 10 && peakTotalRate > 50)) {
        let severity = 'medium'
        let message = ''
        let actionText = ''

        if (ioWaitHigh && lowThroughputPercent > 80) {
          severity = 'critical'
          message = `VM experiencing severe disk I/O bottlenecks - average I/O wait time ${Math.round(avgIoWait)}% and low throughput ${Math.round(lowThroughputPercent)}% of the time`
          actionText = 'Consider upgrading to faster storage (SSD), increasing IOPS allocation, or optimizing applications to reduce I/O operations'
        } else if (ioWaitHigh) {
          severity = 'medium'
          message = `VM experiencing high disk I/O wait times (${Math.round(avgIoWait)}%) indicating storage bottlenecks`
          actionText = 'Consider upgrading storage performance or investigating high I/O applications'
        } else if (lowThroughputPercent > 60) {
          severity = 'medium'
          message = `VM showing low disk throughput (${Math.round(avgTotalRate)} MB/s average) in ${Math.round(lowThroughputPercent)}% of measurements`
          actionText = 'Monitor disk performance and consider storage optimization or upgrade if applications are affected'
        } else {
          severity = 'medium'
          message = `VM showing inconsistent disk I/O performance - peak throughput ${Math.round(peakTotalRate)} MB/s but average only ${Math.round(avgTotalRate)} MB/s`
          actionText = 'Investigate I/O patterns and consider storage optimization'
        }

        results.push({
          type: 'OTHER',
          text: message,
          actionText,
          data: {
            checkType: 'DISK_IO_BOTTLENECK',
            avgThroughputMBs: Math.round(avgTotalRate),
            peakThroughputMBs: Math.round(peakTotalRate),
            lowThroughputPercent: Math.round(lowThroughputPercent),
            avgIoWaitPercent: Math.round(avgIoWait),
            ioWaitHigh,
            metricsAnalyzed: ioRates.length,
            severity
          }
        })
      }
    } catch (error) {
      console.warn('Failed to analyze disk I/O bottlenecks:', error)
    }

    return results
  }
}