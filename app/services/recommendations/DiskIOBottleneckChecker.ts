import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'

/**
 * DiskIOBottleneckChecker - Detects disk I/O performance bottlenecks and storage issues
 *
 * @description
 * Analyzes disk I/O patterns over time to identify performance bottlenecks that may impact
 * application performance. Uses historical metrics to calculate I/O rates, detect low
 * throughput periods, and identify high I/O wait times that indicate storage constraints.
 *
 * @category Performance
 *
 * @analysis
 * 1. **Historical Analysis**: Requires minimum 10 historical metrics for trend analysis
 *
 * 2. **I/O Rate Calculation**: For each metric pair:
 *    - Calculates read/write rates: (current_bytes - previous_bytes) / time_diff
 *    - Tracks total throughput: read_rate + write_rate
 *    - Excludes invalid time differences (>1 hour or ≤0)
 *
 * 3. **Performance Metrics**:
 *    - Average throughput: Mean I/O rate across all samples
 *    - Peak throughput: Maximum I/O rate observed
 *    - Low throughput periods: Percentage of time with <5 MB/s
 *
 * 4. **I/O Wait Analysis**:
 *    - Extracts I/O wait percentage from resource optimization data
 *    - High I/O wait (>20%) indicates storage bottlenecks
 *
 * 5. **Bottleneck Detection Criteria**:
 *    - Severe: I/O wait >20% AND low throughput >80% of time
 *    - Medium: I/O wait >20% OR low throughput >60% of time
 *    - Inconsistent: High peak but low average (indicates sporadic issues)
 *
 * @input
 * - context.historicalMetrics[].diskIOStats: Historical disk I/O statistics
 *   Format: { readBytes: number, writeBytes: number, timestamp: Date }
 * - context.latestSnapshot.resourceOptInfo: Current I/O wait statistics
 *   Format: { ioWaitPercent?: number, await?: number, avgWait?: number }
 *
 * @output
 * RecommendationResult[] with:
 * - type: 'OTHER' (with checkType: 'DISK_IO_BOTTLENECK')
 * - text: Description of I/O performance issue
 * - actionText: Storage optimization recommendations
 * - data: {
 *     avgThroughputMBs: number,     // Average I/O rate
 *     peakThroughputMBs: number,    // Peak I/O rate
 *     lowThroughputPercent: number, // % of time with low throughput
 *     avgIoWaitPercent: number,     // I/O wait time percentage
 *     ioWaitHigh: boolean,          // Whether I/O wait is problematic
 *     metricsAnalyzed: number,      // Number of samples analyzed
 *     severity: string              // 'critical' or 'medium'
 *   }
 *
 * @thresholds
 * - Low throughput: <5 MB/s
 * - High I/O wait: >20%
 * - Severe bottleneck: Low throughput >80% of time + high I/O wait
 * - Medium bottleneck: Low throughput >60% of time OR high I/O wait
 * - Minimum samples: 5 valid I/O rate calculations required
 *
 * @example
 * ```typescript
 * // Input historicalMetrics with diskIOStats:
 * [
 *   { diskIOStats: { readBytes: 1000000, writeBytes: 500000 }, timestamp: new Date('2024-01-01T10:00:00Z') },
 *   { diskIOStats: { readBytes: 1200000, writeBytes: 600000 }, timestamp: new Date('2024-01-01T10:01:00Z') }
 * ]
 *
 * // Calculation: (300KB read + 100KB write) / 60s = 6.67 KB/s = 0.0065 MB/s (low throughput)
 *
 * // Output:
 * [{
 *   type: 'OTHER',
 *   text: 'VM showing low disk throughput (2 MB/s average) in 85% of measurements',
 *   actionText: 'Monitor disk performance and consider storage optimization...',
 *   data: {
 *     checkType: 'DISK_IO_BOTTLENECK',
 *     avgThroughputMBs: 2,
 *     peakThroughputMBs: 15,
 *     lowThroughputPercent: 85,
 *     avgIoWaitPercent: 12,
 *     ioWaitHigh: false,
 *     metricsAnalyzed: 25,
 *     severity: 'medium'
 *   }
 * }]
 * ```
 */
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