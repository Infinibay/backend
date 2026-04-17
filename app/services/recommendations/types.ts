/**
 * Shared types for the recommendation system.
 * These are extracted from VMRecommendationService to improve modularity.
 */

import { VMRecommendation } from '@prisma/client'

/**
 * Result type for recommendation operations.
 * Wraps success/failure with either recommendations or error message.
 */
export type RecommendationOperationResult = {
  success: true;
  recommendations: VMRecommendation[];
} | {
  success: false;
  error: string; // generic, e.g., 'Service unavailable' or 'Failed to generate recommendations'
}

/**
 * Cache entry structure for storing cached data with TTL.
 */
export interface CacheEntry<T = any> {
  data: T
  timestamp: number
  ttl: number
}

/**
 * Service configuration for VMRecommendationService.
 */
export interface ServiceConfiguration {
  cacheTTLMinutes: number
  maxCacheSize: number
  enablePerformanceMonitoring: boolean
  enableContextCaching: boolean
  contextCacheTTLMinutes: number
  performanceLoggingThreshold: number
  maxRetries: number
  retryDelayMs: number
}
