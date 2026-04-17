import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { CacheManager } from '../../../../app/services/recommendations/CacheManager'
import { ServiceConfiguration } from '../../../../app/services/recommendations/types'
import logger from '@main/logger'

const mockConfig: ServiceConfiguration = {
  cacheTTLMinutes: 5,
  maxCacheSize: 3, // Small for testing eviction
  enablePerformanceMonitoring: true,
  enableContextCaching: true,
  contextCacheTTLMinutes: 10,
  performanceLoggingThreshold: 1000,
  maxRetries: 3,
  retryDelayMs: 1000
}

describe('CacheManager', () => {
  let cacheManager: CacheManager
  beforeEach(() => {
    cacheManager = new CacheManager(mockConfig)
    jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'debug').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with empty caches and zero stats', () => {
      const sizes = cacheManager.getCacheSizes()
      expect(sizes.cacheSize).toBe(0)
      expect(sizes.contextCacheSize).toBe(0)

      const stats = cacheManager.getStats()
      expect(stats.mainCacheHits).toBe(0)
      expect(stats.mainCacheMisses).toBe(0)
      expect(stats.contextCacheHits).toBe(0)
      expect(stats.contextCacheMisses).toBe(0)
    })
  })

  describe('main cache (getFromCache / setCache)', () => {
    it('should store and retrieve data', () => {
      cacheManager.setCache('key1', { data: 'value1' }, 60000)
      const result = cacheManager.getFromCache('key1')

      expect(result).toEqual({ data: 'value1' })
    })

    it('should return null for non-existent key', () => {
      const result = cacheManager.getFromCache('nonexistent')
      expect(result).toBeNull()
    })

    it('should return null and delete expired entries', () => {
      cacheManager.setCache('key1', 'data', 100) // 100ms TTL

      // Advance system time past TTL
      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 200)
      const result = cacheManager.getFromCache('key1')
      expect(result).toBeNull()
      expect(cacheManager.getCacheSizes().cacheSize).toBe(0)
      jest.useRealTimers()
    })

    it('should track cache hits and misses', () => {
      cacheManager.setCache('key1', 'data', 60000)
      cacheManager.getFromCache('key1') // hit
      cacheManager.getFromCache('nonexistent') // miss

      const stats = cacheManager.getStats()
      expect(stats.mainCacheHits).toBe(1)
      expect(stats.mainCacheMisses).toBe(1)
    })

    it('should count expired entry as miss', () => {
      cacheManager.setCache('key1', 'data', 100)

      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 200)
      cacheManager.getFromCache('key1') // miss (expired)

      const stats = cacheManager.getStats()
      expect(stats.mainCacheMisses).toBe(1)
      expect(stats.mainCacheHits).toBe(0)
      jest.useRealTimers()
    })

    it('should evict oldest entry when cache is full', () => {
      cacheManager.setCache('key1', 'data1', 60000)
      cacheManager.setCache('key2', 'data2', 60000)
      cacheManager.setCache('key3', 'data3', 60000) // cache is full (maxCacheSize=3)
      cacheManager.setCache('key4', 'data4', 60000) // should evict key1

      expect(cacheManager.getFromCache('key1')).toBeNull() // evicted
      expect(cacheManager.getFromCache('key4')).toEqual('data4')
      expect(cacheManager.getCacheSizes().cacheSize).toBe(3)
    })

    it('should update cache size stat after set', () => {
      cacheManager.setCache('key1', 'data', 60000)
      expect(cacheManager.getStats().mainCacheSize).toBe(1)
    })
  })

  describe('context cache (getFromContextCache / setContextCache)', () => {
    const mockContext = {
      vmId: 'vm-1',
      historicalMetrics: [],
      recentProcessSnapshots: [],
      portUsage: [],
      machineConfig: null
    }

    it('should store and retrieve context', () => {
      cacheManager.setContextCache('ctx-1', mockContext, 60000)
      const result = cacheManager.getFromContextCache('ctx-1')

      expect(result).toEqual(mockContext)
    })

    it('should return null for non-existent context key', () => {
      const result = cacheManager.getFromContextCache('nonexistent')
      expect(result).toBeNull()
    })

    it('should return null for expired context entries', () => {
      cacheManager.setContextCache('ctx-1', mockContext, 100)

      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 200)
      const result = cacheManager.getFromContextCache('ctx-1')
      expect(result).toBeNull()
      jest.useRealTimers()
    })

    it('should track context cache hits and misses', () => {
      cacheManager.setContextCache('ctx-1', mockContext, 60000)
      cacheManager.getFromContextCache('ctx-1') // hit
      cacheManager.getFromContextCache('nonexistent') // miss

      const stats = cacheManager.getStats()
      expect(stats.contextCacheHits).toBe(1)
      expect(stats.contextCacheMisses).toBe(1)
    })

    it('should evict oldest context entry when context cache is full (50 entries)', () => {
      // Fill up to 50 entries
      for (let i = 0; i < 50; i++) {
        cacheManager.setContextCache(`ctx-${i}`, { ...mockContext, vmId: `vm-${i}` }, 60000)
      }
      expect(cacheManager.getCacheSizes().contextCacheSize).toBe(50)

      // Add one more - should evict first entry
      cacheManager.setContextCache('ctx-50', { ...mockContext, vmId: 'vm-50' }, 60000)

      expect(cacheManager.getFromContextCache('ctx-0')).toBeNull() // evicted
      expect(cacheManager.getFromContextCache('ctx-50')).toBeDefined() // present
      expect(cacheManager.getCacheSizes().contextCacheSize).toBe(50)
    })

    it('should update context cache size stat after set', () => {
      cacheManager.setContextCache('ctx-1', mockContext, 60000)
      expect(cacheManager.getStats().contextCacheSize).toBe(1)
    })
  })

  describe('areRecommendationsStale', () => {
    it('should return true for recommendations older than 24 hours', () => {
      const oldDate = new Date()
      oldDate.setHours(oldDate.getHours() - 25)

      expect(cacheManager.areRecommendationsStale(oldDate)).toBe(true)
    })

    it('should return false for recent recommendations', () => {
      const recentDate = new Date()
      recentDate.setHours(recentDate.getHours() - 1)

      expect(cacheManager.areRecommendationsStale(recentDate)).toBe(false)
    })

    it('should return false for recommendations exactly at the boundary (edge)', () => {
      const boundaryDate = new Date()
      boundaryDate.setHours(boundaryDate.getHours() - 24)

      // 24 hours ago should NOT be stale (strictly less than)
      expect(cacheManager.areRecommendationsStale(boundaryDate)).toBe(false)
    })
  })

  describe('clearCaches', () => {
    it('should clear both caches', () => {
      cacheManager.setCache('key1', 'data', 60000)
      cacheManager.setContextCache('ctx-1', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000)

      cacheManager.clearCaches()

      expect(cacheManager.getCacheSizes().cacheSize).toBe(0)
      expect(cacheManager.getCacheSizes().contextCacheSize).toBe(0)
      expect(cacheManager.getFromCache('key1')).toBeNull()
      expect(cacheManager.getFromContextCache('ctx-1')).toBeNull()
    })

    it('should reset cache size stats', () => {
      cacheManager.setCache('key1', 'data', 60000)
      cacheManager.clearCaches()

      const stats = cacheManager.getStats()
      expect(stats.mainCacheSize).toBe(0)
      expect(stats.contextCacheSize).toBe(0)
    })

    it('should log clear message', () => {
      cacheManager.clearCaches()
      expect(logger.info).toHaveBeenCalledWith('🧹 CacheManager: all caches cleared')
    })
  })

  describe('performMaintenance', () => {
    it('should clean expired main cache entries', () => {
      cacheManager.setCache('expired1', 'data', 100)
      cacheManager.setCache('valid1', 'data', 60000)

      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 200)
      const result = cacheManager.performMaintenance()

      expect(result.cacheCleanedCount).toBe(1)
      expect(result.contextCacheCleanedCount).toBe(0)
      expect(cacheManager.getCacheSizes().cacheSize).toBe(1)
      jest.useRealTimers()
    })

    it('should clean expired context cache entries', () => {
      cacheManager.setContextCache('expired-ctx', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 100)
      cacheManager.setContextCache('valid-ctx', { vmId: 'vm-2', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000)

      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 200)
      const result = cacheManager.performMaintenance()

      expect(result.cacheCleanedCount).toBe(0)
      expect(result.contextCacheCleanedCount).toBe(1)
      jest.useRealTimers()
    })

    it('should clean both caches and return counts', () => {
      cacheManager.setCache('expired-main', 'data', 100)
      cacheManager.setCache('valid-main', 'data', 60000)
      cacheManager.setContextCache('expired-ctx', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 100)
      cacheManager.setContextCache('valid-ctx', { vmId: 'vm-2', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000)

      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 200)
      const result = cacheManager.performMaintenance()

      expect(result.cacheCleanedCount).toBe(1)
      expect(result.contextCacheCleanedCount).toBe(1)
      expect(cacheManager.getCacheSizes().cacheSize).toBe(1)
      expect(cacheManager.getCacheSizes().contextCacheSize).toBe(1)
      jest.useRealTimers()
    })

    it('should return zeros when nothing is expired', () => {
      cacheManager.setCache('valid', 'data', 60000)

      const result = cacheManager.performMaintenance()
      expect(result.cacheCleanedCount).toBe(0)
      expect(result.contextCacheCleanedCount).toBe(0)
    })

    it('should not log when nothing was cleaned', () => {
      cacheManager.performMaintenance()
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('maintenance')
      )
    })

    it('should log when entries were cleaned', () => {
      cacheManager.setCache('expired', 'data', 100)

      jest.useFakeTimers()
      jest.setSystemTime(Date.now() + 200)
      cacheManager.performMaintenance()
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('CacheManager maintenance')
      )
      jest.useRealTimers()
    })
  })

  describe('getCacheSizes', () => {
    it('should return correct sizes', () => {
      cacheManager.setCache('k1', 'd1', 60000)
      cacheManager.setCache('k2', 'd2', 60000)
      cacheManager.setContextCache('c1', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000)

      const sizes = cacheManager.getCacheSizes()
      expect(sizes.cacheSize).toBe(2)
      expect(sizes.contextCacheSize).toBe(1)
    })
  })

  describe('getStats', () => {
    it('should return a copy of stats (not reference)', () => {
      const stats1 = cacheManager.getStats()
      stats1.mainCacheHits = 999

      const stats2 = cacheManager.getStats()
      expect(stats2.mainCacheHits).toBe(0)
    })
  })

  describe('getMainCache / getContextCache (debug)', () => {
    it('should return the actual cache maps', () => {
      cacheManager.setCache('key1', 'data', 60000)
      const mainCache = cacheManager.getMainCache()
      expect(mainCache.get('key1')).toBeDefined()
      expect(mainCache.get('key1')!.data).toBe('data')
    })

    it('should return the actual context cache maps', () => {
      const mockCtx = { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }
      cacheManager.setContextCache('ctx-1', mockCtx, 60000)
      const contextCache = cacheManager.getContextCache()
      expect(contextCache.get('ctx-1')).toBeDefined()
      expect(contextCache.get('ctx-1')!.data).toEqual(mockCtx)
    })
  })
})
