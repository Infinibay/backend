/**
 * Performance tracking for the recommendation service.
 * Extracted from VMRecommendationService to improve modularity.
 */

import logger from '@main/logger'
import { ServiceConfiguration } from './types'

/**
 * Performance metrics data structure
 */
export interface PerformanceMetrics {
  totalGenerations: number
  averageGenerationTime: number
  cacheHitRate: number
  cacheHits: number
  cacheMisses: number
  contextBuildTime: number
  checkerTimes: Map<string, number>
  errorCount: number
  lastError: string | null
}

/**
 * Service health status returned by getServiceHealth()
 */
export interface ServiceHealth {
  isHealthy: boolean
  cacheSize: number
  contextCacheSize: number
  performanceMetrics: PerformanceMetrics
  configuration: ServiceConfiguration
}

/**
 * Performance tracker for monitoring recommendation generation performance.
 * Encapsulates all performance-related state and operations.
 */
export class PerformanceTracker {
  private metrics: PerformanceMetrics
  private config: ServiceConfiguration

  constructor (config: ServiceConfiguration) {
    this.config = config
    this.metrics = this.initializeMetrics()
  }

  /**
   * Initialize performance metrics to default values
   */
  private initializeMetrics (): PerformanceMetrics {
    return {
      totalGenerations: 0,
      averageGenerationTime: 0,
      cacheHitRate: 0,
      cacheHits: 0,
      cacheMisses: 0,
      contextBuildTime: 0,
      checkerTimes: new Map<string, number>(),
      errorCount: 0,
      lastError: null
    }
  }

  /**
   * Update cache hit rate based on cache hit/miss
   */
  updateCacheHitRate (isHit: boolean): void {
    if (isHit) {
      this.metrics.cacheHits++
    } else {
      this.metrics.cacheMisses++
    }

    const total = this.metrics.cacheHits + this.metrics.cacheMisses
    this.metrics.cacheHitRate = this.metrics.cacheHits / total
  }

  /**
   * Update average time metric using exponential moving average
   */
  updateAverageTime (currentAverage: number, newTime: number): number {
    const count = this.metrics.totalGenerations || 1
    return ((currentAverage * (count - 1)) + newTime) / count
  }

  /**
   * Update performance metrics after recommendation generation
   */
  updateMetrics (totalTime: number, recommendationCount: number): void {
    this.metrics.totalGenerations++
    this.metrics.averageGenerationTime = this.updateAverageTime(
      this.metrics.averageGenerationTime,
      totalTime
    )

    logger.debug(`📊 Generated ${recommendationCount} recommendations in ${totalTime}ms (avg: ${Math.round(this.metrics.averageGenerationTime)}ms)`)
  }

  /**
   * Update context build time
   */
  updateContextBuildTime (contextBuildTime: number): void {
    this.metrics.contextBuildTime = this.updateAverageTime(this.metrics.contextBuildTime, contextBuildTime)
  }

  /**
   * Update individual checker time
   */
  updateCheckerTime (checkerName: string, checkerTime: number): void {
    const existingTime = this.metrics.checkerTimes.get(checkerName) || 0
    this.metrics.checkerTimes.set(checkerName, this.updateAverageTime(existingTime, checkerTime))
  }

  /**
   * Record an error
   */
  recordError (errorMessage: string): void {
    this.metrics.errorCount++
    this.metrics.lastError = errorMessage
  }

  /**
   * Log performance summary
   */
  logPerformanceSummary (
    vmId: string,
    totalTime: number,
    contextTime: number,
    checkerTimes: Map<string, number>,
    recommendationCount: number
  ): void {
    if (!this.config.enablePerformanceMonitoring) return

    const slowCheckers = Array.from(checkerTimes.entries())
      .filter(([, time]) => time > 1000) // > 1 second
      .sort((a, b) => b[1] - a[1])

    if (totalTime > this.config.performanceLoggingThreshold || slowCheckers.length > 0) {
      logger.info(`📊 Performance summary for VM ${vmId}:`)
      logger.info(`   - Total time: ${totalTime}ms`)
      logger.info(`   - Context build: ${contextTime}ms`)
      logger.info(`   - Recommendations: ${recommendationCount}`)

      if (slowCheckers.length > 0) {
        logger.info('   - Slow checkers:')
        slowCheckers.forEach(([name, time]) => {
          logger.info(`     • ${name}: ${time}ms`)
        })
      }
    }
  }

  /**
   * Get current metrics (copy to prevent external mutation)
   */
  getMetrics (): PerformanceMetrics {
    return { ...this.metrics }
  }

  /**
   * Get service health status
   */
  getServiceHealth (cacheSize: number, contextCacheSize: number): ServiceHealth {
    const recentErrorThreshold = 10 // Consider unhealthy if more than 10 errors recently
    const slowResponseThreshold = 30000 // 30 seconds

    const isHealthy =
      this.metrics.errorCount < recentErrorThreshold &&
      this.metrics.averageGenerationTime < slowResponseThreshold

    return {
      isHealthy,
      cacheSize,
      contextCacheSize,
      performanceMetrics: { ...this.metrics },
      configuration: { ...this.config }
    }
  }

  /**
   * Reset performance metrics to initial state
   */
  reset (): void {
    this.metrics = this.initializeMetrics()
    logger.info('📊 PerformanceTracker metrics reset')
  }

  /**
   * Log performance statistics (used during maintenance)
   */
  logStats (): void {
    if (this.config.enablePerformanceMonitoring && this.metrics.totalGenerations > 0) {
      logger.debug('📊 VMRecommendationService performance stats:')
      logger.debug(`   - Total generations: ${this.metrics.totalGenerations}`)
      logger.debug(`   - Average time: ${Math.round(this.metrics.averageGenerationTime)}ms`)
      logger.debug(`   - Cache hit rate: ${(this.metrics.cacheHitRate * 100).toFixed(1)}%`)
      logger.debug(`   - Error count: ${this.metrics.errorCount}`)

      if (this.metrics.lastError) {
        logger.debug(`   - Last error: ${this.metrics.lastError}`)
      }
    }
  }
}
