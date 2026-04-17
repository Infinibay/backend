/**
 * Cache management for the recommendation service.
 * Extracted from VMRecommendationService to improve modularity.
 */
import logger from '@main/logger'
import { CacheEntry, ServiceConfiguration } from './types'
import { RecommendationContext } from './BaseRecommendationChecker'

/**
 * Cache statistics for monitoring and logging
 */
export interface CacheStats {
  mainCacheSize: number
  contextCacheSize: number
  mainCacheHits: number
  mainCacheMisses: number
  contextCacheHits: number
  contextCacheMisses: number
}

/**
 * Cache manager for handling recommendation and context caching.
 * Encapsulates all caching-related state and operations.
 */
export class CacheManager {
  private cache = new Map<string, CacheEntry>()
  private contextCache = new Map<string, CacheEntry>()
  private config: ServiceConfiguration
  private stats: CacheStats

  constructor (config: ServiceConfiguration) {
    this.config = config
    this.stats = {
      mainCacheSize: 0,
      contextCacheSize: 0,
      mainCacheHits: 0,
      mainCacheMisses: 0,
      contextCacheHits: 0,
      contextCacheMisses: 0
    }
  }

  /**
   * Get data from main cache
   */
  getFromCache (key: string): any | null {
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      this.stats.mainCacheHits++
      return entry.data
    }

    if (entry) {
      this.cache.delete(key) // Clean up expired entry
    }

    this.stats.mainCacheMisses++
    return null
  }

  /**
   * Set data in main cache
   */
  setCache (key: string, data: any, ttl: number): void {
    // Implement cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })

    this.stats.mainCacheSize = this.cache.size
  }

  /**
   * Get data from context cache
   */
  getFromContextCache (key: string): RecommendationContext | null {
    const entry = this.contextCache.get(key)
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      this.stats.contextCacheHits++
      return entry.data
    }

    if (entry) {
      this.contextCache.delete(key) // Clean up expired entry
    }

    this.stats.contextCacheMisses++
    return null
  }

  /**
   * Set data in context cache
   */
  setContextCache (key: string, data: RecommendationContext, ttl: number): void {
    // Context cache has separate size limit
    const contextCacheMaxSize = 50
    if (this.contextCache.size >= contextCacheMaxSize) {
      const firstKey = this.contextCache.keys().next().value
      if (firstKey) {
        this.contextCache.delete(firstKey)
      }
    }

    this.contextCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })

    this.stats.contextCacheSize = this.contextCache.size
  }

  /**
   * Check if recommendations are stale based on creation date
   */
  areRecommendationsStale (lastCreated: Date): boolean {
    const dayAgo = new Date()
    dayAgo.setHours(dayAgo.getHours() - 24)
    return lastCreated < dayAgo
  }

  /**
   * Clear all caches
   */
  clearCaches (): void {
    this.cache.clear()
    this.contextCache.clear()
    this.stats.mainCacheSize = 0
    this.stats.contextCacheSize = 0
    logger.info('🧹 CacheManager: all caches cleared')
  }

  /**
   * Perform maintenance - clean expired cache entries
   */
  performMaintenance (): { cacheCleanedCount: number; contextCacheCleanedCount: number } {
    let cacheCleanedCount = 0
    let contextCacheCleanedCount = 0

    const now = Date.now()

    // Clean main cache
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= entry.ttl) {
        this.cache.delete(key)
        cacheCleanedCount++
      }
    }

    // Clean context cache
    for (const [key, entry] of this.contextCache.entries()) {
      if (now - entry.timestamp >= entry.ttl) {
        this.contextCache.delete(key)
        contextCacheCleanedCount++
      }
    }

    // Update stats
    this.stats.mainCacheSize = this.cache.size
    this.stats.contextCacheSize = this.contextCache.size

    if (cacheCleanedCount > 0 || contextCacheCleanedCount > 0) {
      logger.info(`🧹 CacheManager maintenance: cleaned ${cacheCleanedCount} main cache entries, ${contextCacheCleanedCount} context cache entries`)
    }

    return { cacheCleanedCount, contextCacheCleanedCount }
  }

  /**
   * Get cache sizes
   */
  getCacheSizes (): { cacheSize: number; contextCacheSize: number } {
    return {
      cacheSize: this.cache.size,
      contextCacheSize: this.contextCache.size
    }
  }

  /**
   * Get cache statistics
   */
  getStats (): CacheStats {
    return { ...this.stats }
  }

  /**
   * Get context cache map (for testing/debugging)
   */
  getContextCache (): Map<string, CacheEntry> {
    return this.contextCache
  }

  /**
   * Get main cache map (for testing/debugging)
   */
  getMainCache (): Map<string, CacheEntry> {
    return this.cache
  }
}
