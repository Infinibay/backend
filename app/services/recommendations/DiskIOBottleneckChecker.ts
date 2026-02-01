import { RecommendationChecker, RecommendationContext, RecommendationResult } from './BaseRecommendationChecker'

/**
 * DiskIOBottleneckChecker - Detects disk I/O performance bottlenecks and storage issues
 *
 * @description
 * Analyzes disk I/O patterns over time to identify performance bottlenecks that may impact
 * application performance. Uses historical metrics to calculate I/O rates, detect low
 * throughput periods, and identify high I/O utilization that indicates storage constraints.
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
 * 4. **I/O Utilization Analysis** (historical):
 *    - Extracts io_utilization_percent from each historical diskIOStats
 *    - Computes average and sustained high-utilization duration
 *    - Falls back to latestSnapshot.resourceOptInfo when historical data unavailable
 *
 * 5. **Bottleneck Detection Criteria**:
 *    - Critical: Avg I/O utilization >70% AND low throughput >80% AND sustained >2h
 *    - High: Avg I/O utilization >50% AND low throughput >60% AND sustained >1h
 *    - Medium: Avg I/O utilization >30% with intermittent low throughput,
 *      OR inconsistent pattern (high peak, low avg)
 *
 * @input
 * - context.historicalMetrics[].diskIOStats: Historical disk I/O statistics
 *   Format: { readBytes: number, writeBytes: number, ioUtilizationPercent?: number, timestamp: Date }
 * - context.latestSnapshot.resourceOptInfo: Fallback I/O wait statistics (legacy)
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
 *     avgIoUtilPercent: number,     // Average I/O utilization percentage
 *     highIoUtilHours: number,      // Hours spent in high I/O utilization
 *     ioUtilHigh: boolean,          // Whether I/O utilization is problematic
 *     metricsAnalyzed: number,      // Number of samples analyzed
 *     severity: string              // 'critical', 'high', or 'medium'
 *   }
 *
 * @thresholds
 * - Low throughput: <5 MB/s
 * - High I/O utilization: >70% (critical), >50% (high), >30% (medium)
 * - Minimum samples: 5 valid I/O rate calculations required
 */
export class DiskIOBottleneckChecker extends RecommendationChecker {
  getName (): string { return 'DiskIOBottleneckChecker' }
  getCategory (): string { return 'Performance' }

  private calculateHighIoUtilizationTime (
    metrics: { value: number; timestamp: Date }[],
    threshold: number
  ): number {
    if (metrics.length < 2) return 0

    let totalHighUtilMs = 0
    const sortedMetrics = [...metrics].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    for (let i = 0; i < sortedMetrics.length - 1; i++) {
      const current = sortedMetrics[i]
      const next = sortedMetrics[i + 1]

      if (current.value > threshold) {
        const timeSpanMs = next.timestamp.getTime() - current.timestamp.getTime()
        totalHighUtilMs += timeSpanMs
      }
    }

    return totalHighUtilMs / (1000 * 60 * 60)
  }

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
                const ioUtilizationPercent: number | undefined =
                  typeof ioData.ioUtilizationPercent === 'number' ? ioData.ioUtilizationPercent
                    : typeof ioData.io_utilization_percent === 'number' ? ioData.io_utilization_percent
                      : undefined

                if (readBytes > 0 || writeBytes > 0) {
                  return {
                    readBytes: readBytes as number,
                    writeBytes: writeBytes as number,
                    ioUtilizationPercent,
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
        .filter(m => m !== null) as { readBytes: number; writeBytes: number; ioUtilizationPercent?: number; timestamp: Date }[]

      if (ioMetrics.length < 5) {
        return results
      }

      // Calculate I/O rates between consecutive metrics (keep raw floats for precision)
      const ioRates = []
      for (let i = 1; i < ioMetrics.length; i++) {
        const current = ioMetrics[i]
        const previous = ioMetrics[i - 1]
        const timeDiffSeconds = (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000

        if (timeDiffSeconds > 0 && timeDiffSeconds < 3600) {
          const readRateMBs = Math.max(0, (current.readBytes - previous.readBytes) / (1024 * 1024)) / timeDiffSeconds
          const writeRateMBs = Math.max(0, (current.writeBytes - previous.writeBytes) / (1024 * 1024)) / timeDiffSeconds
          const totalRateMBs = readRateMBs + writeRateMBs

          ioRates.push({
            readRateMBs,
            writeRateMBs,
            totalRateMBs,
            timestamp: current.timestamp
          })
        }
      }

      if (ioRates.length < 3) {
        return results
      }

      const totalRates = ioRates.map(r => r.totalRateMBs)
      const avgTotalRate = totalRates.reduce((sum, rate) => sum + rate, 0) / totalRates.length
      const peakTotalRate = Math.max(...totalRates)

      const lowThroughputCount = totalRates.filter(rate => rate < 5).length
      const lowThroughputPercent = (lowThroughputCount / totalRates.length) * 100

      // Historical I/O utilization analysis
      const ioUtilMetrics = ioMetrics
        .filter(m => m.ioUtilizationPercent !== undefined)
        .map(m => ({ value: m.ioUtilizationPercent!, timestamp: m.timestamp }))

      let avgIoUtil = 0
      let highIoUtilHours = 0
      let ioUtilHigh = false
      let hasHistoricalIoUtil = false

      if (ioUtilMetrics.length >= 3) {
        hasHistoricalIoUtil = true
        avgIoUtil = ioUtilMetrics.reduce((sum, m) => sum + m.value, 0) / ioUtilMetrics.length
        highIoUtilHours = this.calculateHighIoUtilizationTime(ioUtilMetrics, 70)
        ioUtilHigh = avgIoUtil > 20 || highIoUtilHours > 2
      }

      // Fallback: use latestSnapshot.resourceOptInfo if no historical I/O utilization
      if (!hasHistoricalIoUtil && context.latestSnapshot?.resourceOptInfo) {
        try {
          const resourceData = typeof context.latestSnapshot.resourceOptInfo === 'string'
            ? JSON.parse(context.latestSnapshot.resourceOptInfo)
            : context.latestSnapshot.resourceOptInfo

          if (resourceData && typeof resourceData === 'object') {
            if (resourceData.ioWaitPercent || resourceData.await || resourceData.avgWait || resourceData.diskIOStats) {
              const ioStats = resourceData.diskIOStats || resourceData
              avgIoUtil = ioStats.ioWaitPercent || ioStats.await || ioStats.avgWait || 0
              ioUtilHigh = avgIoUtil > 20
            }
          }
        } catch (error) {
          console.warn('Failed to parse resource optimization data for I/O stats:', error)
        }
      }

      // Detection criteria combining throughput + I/O utilization trends
      const hasThroughputIssue = lowThroughputPercent > 60 || (avgTotalRate < 10 && peakTotalRate > 50)

      if (!hasThroughputIssue && !ioUtilHigh) {
        return results
      }

      let severity = 'medium'
      let message = ''
      let actionText = ''

      if (hasHistoricalIoUtil) {
        // Use richer criteria when we have historical I/O utilization
        if (avgIoUtil > 70 && lowThroughputPercent > 80 && highIoUtilHours > 2) {
          severity = 'critical'
          message = `VM experiencing severe disk I/O bottlenecks - average I/O utilization ${Math.round(avgIoUtil)}% sustained for ${highIoUtilHours.toFixed(1)}h and low throughput ${Math.round(lowThroughputPercent)}% of the time`
          actionText = 'Consider upgrading to faster storage (SSD), increasing IOPS allocation, or optimizing applications to reduce I/O operations'
        } else if (avgIoUtil > 50 && lowThroughputPercent > 60 && highIoUtilHours > 1) {
          severity = 'high'
          message = `VM experiencing high disk I/O utilization (${Math.round(avgIoUtil)}% average) with low throughput ${Math.round(lowThroughputPercent)}% of the time`
          actionText = 'Consider upgrading storage performance or investigating high I/O applications'
        } else if (avgIoUtil > 30 && lowThroughputPercent > 40) {
          severity = 'medium'
          message = `VM showing elevated disk I/O utilization (${Math.round(avgIoUtil)}% average) with low throughput (${Math.round(avgTotalRate)} MB/s) in ${Math.round(lowThroughputPercent)}% of measurements`
          actionText = 'Monitor disk performance and consider storage optimization or upgrade if applications are affected'
        } else if (avgTotalRate < 10 && peakTotalRate > 50) {
          severity = 'medium'
          message = `VM showing inconsistent disk I/O performance - peak throughput ${Math.round(peakTotalRate)} MB/s but average only ${Math.round(avgTotalRate)} MB/s`
          actionText = 'Investigate I/O patterns and consider storage optimization'
        } else {
          return results
        }
      } else {
        // Legacy path: no historical I/O utilization data
        if (ioUtilHigh && lowThroughputPercent > 80) {
          severity = 'critical'
          message = `VM experiencing severe disk I/O bottlenecks - average I/O wait time ${Math.round(avgIoUtil)}% and low throughput ${Math.round(lowThroughputPercent)}% of the time`
          actionText = 'Consider upgrading to faster storage (SSD), increasing IOPS allocation, or optimizing applications to reduce I/O operations'
        } else if (ioUtilHigh) {
          severity = 'medium'
          message = `VM experiencing high disk I/O wait times (${Math.round(avgIoUtil)}%) indicating storage bottlenecks`
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
      }

      results.push({
        type: 'OTHER',
        text: message,
        actionText,
        data: {
          checkType: 'DISK_IO_BOTTLENECK',
          avgThroughputMBs: Math.round(avgTotalRate * 10) / 10,
          peakThroughputMBs: Math.round(peakTotalRate * 10) / 10,
          lowThroughputPercent: Math.round(lowThroughputPercent),
          avgIoUtilPercent: Math.round(avgIoUtil * 10) / 10,
          highIoUtilHours: Math.round(highIoUtilHours * 10) / 10,
          ioUtilHigh,
          metricsAnalyzed: ioRates.length,
          severity
        }
      })
    } catch (error) {
      console.warn('Failed to analyze disk I/O bottlenecks:', error)
    }

    return results
  }
}
