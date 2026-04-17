import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { PerformanceTracker } from '../../../../app/services/recommendations/PerformanceTracker'
import { ServiceConfiguration } from '../../../../app/services/recommendations/types'
import logger from '@main/logger'

const mockConfig: ServiceConfiguration = {
  cacheTTLMinutes: 5,
  maxCacheSize: 100,
  enablePerformanceMonitoring: true,
  enableContextCaching: true,
  contextCacheTTLMinutes: 10,
  performanceLoggingThreshold: 1000,
  maxRetries: 3,
  retryDelayMs: 1000
}

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker
  let consoleSpy: any

  beforeEach(() => {
    tracker = new PerformanceTracker(mockConfig)
    consoleSpy = jest.spyOn(logger, 'debug').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    jest.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with default metrics', () => {
      const metrics = tracker.getMetrics()

      expect(metrics.totalGenerations).toBe(0)
      expect(metrics.averageGenerationTime).toBe(0)
      expect(metrics.cacheHitRate).toBe(0)
      expect(metrics.cacheHits).toBe(0)
      expect(metrics.cacheMisses).toBe(0)
      expect(metrics.contextBuildTime).toBe(0)
      expect(metrics.checkerTimes).toBeInstanceOf(Map)
      expect(metrics.checkerTimes.size).toBe(0)
      expect(metrics.errorCount).toBe(0)
      expect(metrics.lastError).toBeNull()
    })
  })

  describe('updateCacheHitRate', () => {
    it('should increment cache hits and update rate', () => {
      tracker.updateCacheHitRate(true)
      const metrics = tracker.getMetrics()

      expect(metrics.cacheHits).toBe(1)
      expect(metrics.cacheMisses).toBe(0)
      expect(metrics.cacheHitRate).toBe(1)
    })

    it('should increment cache misses and update rate', () => {
      tracker.updateCacheHitRate(false)
      const metrics = tracker.getMetrics()

      expect(metrics.cacheHits).toBe(0)
      expect(metrics.cacheMisses).toBe(1)
      expect(metrics.cacheHitRate).toBe(0)
    })

    it('should calculate correct hit rate over multiple calls', () => {
      // 3 hits, 1 miss = 75%
      tracker.updateCacheHitRate(true)
      tracker.updateCacheHitRate(true)
      tracker.updateCacheHitRate(true)
      tracker.updateCacheHitRate(false)

      const metrics = tracker.getMetrics()
      expect(metrics.cacheHits).toBe(3)
      expect(metrics.cacheMisses).toBe(1)
      expect(metrics.cacheHitRate).toBeCloseTo(0.75)
    })

    it('should handle alternating hits and misses', () => {
      tracker.updateCacheHitRate(true)
      tracker.updateCacheHitRate(false)
      tracker.updateCacheHitRate(true)
      tracker.updateCacheHitRate(false)

      const metrics = tracker.getMetrics()
      expect(metrics.cacheHitRate).toBeCloseTo(0.5)
    })
  })

  describe('updateAverageTime', () => {
    it('should return new time when average is 0', () => {
      const result = tracker.updateAverageTime(0, 100)
      expect(result).toBe(100)
    })

    it('should compute correct moving average', () => {
      tracker.updateMetrics(100, 5) // totalGenerations = 1, avg = 100
      const metrics = tracker.getMetrics()
      expect(metrics.averageGenerationTime).toBe(100)

      tracker.updateMetrics(200, 3) // totalGenerations = 2, avg = (100*1 + 200) / 2 = 150
      const metrics2 = tracker.getMetrics()
      expect(metrics2.averageGenerationTime).toBeCloseTo(150)
    })
  })

  describe('updateMetrics', () => {
    it('should increment total generations', () => {
      tracker.updateMetrics(100, 5)
      expect(tracker.getMetrics().totalGenerations).toBe(1)

      tracker.updateMetrics(200, 3)
      expect(tracker.getMetrics().totalGenerations).toBe(2)
    })

    it('should update average generation time', () => {
      tracker.updateMetrics(100, 5)
      tracker.updateMetrics(200, 3)
      tracker.updateMetrics(300, 2)

      const metrics = tracker.getMetrics()
      expect(metrics.averageGenerationTime).toBeCloseTo(200)
    })

    it('should log debug message', () => {
      tracker.updateMetrics(150, 7)
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Generated 7 recommendations in 150ms')
      )
    })
  })

  describe('updateContextBuildTime', () => {
    it('should update context build time with first value', () => {
      tracker.updateContextBuildTime(50)
      expect(tracker.getMetrics().contextBuildTime).toBe(50)
    })

    it('should update context build time using updateAverageTime with current totalGenerations', () => {
      // updateAverageTime uses totalGenerations as divisor count
      // With totalGenerations=1: ((currentAvg * 0) + newTime) / 1 = newTime
      tracker.updateMetrics(100, 5) // totalGenerations = 1
      tracker.updateContextBuildTime(50) // ((0*0)+50)/1 = 50
      tracker.updateContextBuildTime(150) // ((50*0)+150)/1 = 150 (still totalGenerations=1)
      expect(tracker.getMetrics().contextBuildTime).toBe(150)

      // With totalGenerations=2: ((currentAvg * 1) + newTime) / 2
      tracker.updateMetrics(200, 3) // totalGenerations = 2
      tracker.updateContextBuildTime(250) // ((150*1)+250)/2 = 200
      expect(tracker.getMetrics().contextBuildTime).toBe(200)
    })
  })

  describe('updateCheckerTime', () => {
    it('should store checker time for new checker', () => {
      tracker.updateCheckerTime('DiskSpaceChecker', 200)

      const metrics = tracker.getMetrics()
      expect(metrics.checkerTimes.get('DiskSpaceChecker')).toBe(200)
    })

    it('should update checker time using updateAverageTime with current totalGenerations', () => {
      tracker.updateMetrics(100, 5) // totalGenerations = 1
      tracker.updateCheckerTime('DiskSpaceChecker', 200) // ((0*0)+200)/1 = 200
      tracker.updateCheckerTime('DiskSpaceChecker', 400) // ((200*0)+400)/1 = 400

      expect(tracker.getMetrics().checkerTimes.get('DiskSpaceChecker')).toBe(400)

      // With totalGenerations=2: ((400*1)+600)/2 = 500
      tracker.updateMetrics(200, 3) // totalGenerations = 2
      tracker.updateCheckerTime('DiskSpaceChecker', 600)
      expect(tracker.getMetrics().checkerTimes.get('DiskSpaceChecker')).toBe(500)
    })

    it('should track multiple checkers independently', () => {
      tracker.updateCheckerTime('DiskSpaceChecker', 200)
      tracker.updateCheckerTime('PortConflictChecker', 50)

      const m = tracker.getMetrics()
      expect(m.checkerTimes.get('DiskSpaceChecker')).toBe(200)
      expect(m.checkerTimes.get('PortConflictChecker')).toBe(50)
      expect(m.checkerTimes.size).toBe(2)
    })
  })

  describe('recordError', () => {
    it('should increment error count', () => {
      tracker.recordError('test error')
      expect(tracker.getMetrics().errorCount).toBe(1)

      tracker.recordError('another error')
      expect(tracker.getMetrics().errorCount).toBe(2)
    })

    it('should store last error message', () => {
      tracker.recordError('first error')
      expect(tracker.getMetrics().lastError).toBe('first error')

      tracker.recordError('second error')
      expect(tracker.getMetrics().lastError).toBe('second error')
    })
  })

  describe('logPerformanceSummary', () => {
    beforeEach(() => {
      jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
    })

    it('should not log when performance monitoring is disabled', () => {
      const disabledConfig = { ...mockConfig, enablePerformanceMonitoring: false }
      const disabledTracker = new PerformanceTracker(disabledConfig)

      disabledTracker.logPerformanceSummary('vm-1', 5000, 1000, new Map(), 5)
      expect(logger.info).not.toHaveBeenCalled()
    })

    it('should log when total time exceeds threshold', () => {
      const slowCheckers = new Map<string, number>()
      tracker.logPerformanceSummary('vm-1', 2000, 500, slowCheckers, 10)

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Performance summary for VM vm-1')
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Total time: 2000ms')
      )
    })

    it('should log slow checkers (> 1000ms)', () => {
      const slowCheckers = new Map<string, number>([
        ['SlowChecker', 1500],
        ['FastChecker', 200]
      ])

      tracker.logPerformanceSummary('vm-1', 500, 100, slowCheckers, 3)

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Slow checkers')
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SlowChecker: 1500ms')
      )
    })

    it('should not log fast checkers', () => {
      const fastCheckers = new Map<string, number>([
        ['FastChecker', 200]
      ])

      tracker.logPerformanceSummary('vm-1', 500, 100, fastCheckers, 3)

      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Slow checkers')
      )
    })
  })

  describe('getMetrics', () => {
    it('should return a copy of metrics (not reference)', () => {
      const metrics1 = tracker.getMetrics()
      metrics1.totalGenerations = 999

      const metrics2 = tracker.getMetrics()
      expect(metrics2.totalGenerations).toBe(0)
    })

    it('should return a copy of checkerTimes map', () => {
      tracker.updateCheckerTime('TestChecker', 100)
      const metrics = tracker.getMetrics()
      expect(metrics.checkerTimes).toBeInstanceOf(Map)
      expect(metrics.checkerTimes.get('TestChecker')).toBe(100)
    })
  })

  describe('getServiceHealth', () => {
    it('should report healthy when errors are low and response is fast', () => {
      tracker.updateMetrics(100, 5) // avg time 100ms, 0 errors

      const health = tracker.getServiceHealth(10, 5)

      expect(health.isHealthy).toBe(true)
      expect(health.cacheSize).toBe(10)
      expect(health.contextCacheSize).toBe(5)
    })

    it('should report unhealthy when error count is high', () => {
      for (let i = 0; i < 15; i++) {
        tracker.recordError(`error ${i}`)
      }

      const health = tracker.getServiceHealth(10, 5)
      expect(health.isHealthy).toBe(false)
    })

    it('should report unhealthy when average time is too high', () => {
      tracker.updateMetrics(35000, 5) // 35 seconds avg

      const health = tracker.getServiceHealth(10, 5)
      expect(health.isHealthy).toBe(false)
    })

    it('should include configuration copy', () => {
      const health = tracker.getServiceHealth(10, 5)
      expect(health.configuration.cacheTTLMinutes).toBe(5)
      expect(health.configuration.maxCacheSize).toBe(100)
    })

    it('should include performance metrics copy', () => {
      tracker.updateMetrics(100, 5)
      tracker.recordError('test error')

      const health = tracker.getServiceHealth(10, 5)
      expect(health.performanceMetrics.totalGenerations).toBe(1)
      expect(health.performanceMetrics.errorCount).toBe(1)
      expect(health.performanceMetrics.lastError).toBe('test error')
    })
  })

  describe('reset', () => {
    it('should reset all metrics to default values', () => {
      // Populate some data
      tracker.updateMetrics(100, 5)
      tracker.updateCacheHitRate(true)
      tracker.recordError('test error')
      tracker.updateCheckerTime('TestChecker', 200)

      // Reset
      tracker.reset()

      const metrics = tracker.getMetrics()
      expect(metrics.totalGenerations).toBe(0)
      expect(metrics.averageGenerationTime).toBe(0)
      expect(metrics.cacheHits).toBe(0)
      expect(metrics.cacheMisses).toBe(0)
      expect(metrics.errorCount).toBe(0)
      expect(metrics.lastError).toBeNull()
      expect(metrics.checkerTimes.size).toBe(0)
    })

    it('should log reset message', () => {
      tracker.reset()
      expect(logger.info).toHaveBeenCalledWith('📊 PerformanceTracker metrics reset')
    })
  })

  describe('logStats', () => {
    it('should log stats when monitoring is enabled and generations > 0', () => {
      tracker.updateMetrics(150, 5)
      tracker.updateCacheHitRate(true)
      tracker.recordError('test error')

      tracker.logStats()

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VMRecommendationService performance stats')
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Total generations: 1')
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Average time: 150ms')
      )
    })

    it('should not log when monitoring is disabled', () => {
      const disabledConfig = { ...mockConfig, enablePerformanceMonitoring: false }
      const disabledTracker = new PerformanceTracker(disabledConfig)
      disabledTracker.updateMetrics(100, 5)

      disabledTracker.logStats()
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('performance stats')
      )
    })

    it('should not log when no generations have occurred', () => {
      tracker.logStats()
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('performance stats')
      )
    })

    it('should log last error when present', () => {
      tracker.updateMetrics(100, 5)
      tracker.recordError('something went wrong')

      tracker.logStats()
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last error: something went wrong')
      )
    })
  })
})
