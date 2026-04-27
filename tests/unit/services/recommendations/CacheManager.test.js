"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const CacheManager_1 = require("../../../../app/services/recommendations/CacheManager");
const logger_1 = __importDefault(require("@main/logger"));
const mockConfig = {
    cacheTTLMinutes: 5,
    maxCacheSize: 3, // Small for testing eviction
    enablePerformanceMonitoring: true,
    enableContextCaching: true,
    contextCacheTTLMinutes: 10,
    performanceLoggingThreshold: 1000,
    maxRetries: 3,
    retryDelayMs: 1000
};
(0, globals_1.describe)('CacheManager', () => {
    let cacheManager;
    (0, globals_1.beforeEach)(() => {
        cacheManager = new CacheManager_1.CacheManager(mockConfig);
        globals_1.jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
        globals_1.jest.spyOn(logger_1.default, 'debug').mockImplementation(() => undefined);
    });
    (0, globals_1.afterEach)(() => {
        globals_1.jest.restoreAllMocks();
    });
    (0, globals_1.describe)('constructor', () => {
        (0, globals_1.it)('should initialize with empty caches and zero stats', () => {
            const sizes = cacheManager.getCacheSizes();
            (0, globals_1.expect)(sizes.cacheSize).toBe(0);
            (0, globals_1.expect)(sizes.contextCacheSize).toBe(0);
            const stats = cacheManager.getStats();
            (0, globals_1.expect)(stats.mainCacheHits).toBe(0);
            (0, globals_1.expect)(stats.mainCacheMisses).toBe(0);
            (0, globals_1.expect)(stats.contextCacheHits).toBe(0);
            (0, globals_1.expect)(stats.contextCacheMisses).toBe(0);
        });
    });
    (0, globals_1.describe)('main cache (getFromCache / setCache)', () => {
        (0, globals_1.it)('should store and retrieve data', () => {
            cacheManager.setCache('key1', { data: 'value1' }, 60000);
            const result = cacheManager.getFromCache('key1');
            (0, globals_1.expect)(result).toEqual({ data: 'value1' });
        });
        (0, globals_1.it)('should return null for non-existent key', () => {
            const result = cacheManager.getFromCache('nonexistent');
            (0, globals_1.expect)(result).toBeNull();
        });
        (0, globals_1.it)('should return null and delete expired entries', () => {
            cacheManager.setCache('key1', 'data', 100); // 100ms TTL
            // Advance system time past TTL
            globals_1.jest.useFakeTimers();
            globals_1.jest.setSystemTime(Date.now() + 200);
            const result = cacheManager.getFromCache('key1');
            (0, globals_1.expect)(result).toBeNull();
            (0, globals_1.expect)(cacheManager.getCacheSizes().cacheSize).toBe(0);
            globals_1.jest.useRealTimers();
        });
        (0, globals_1.it)('should track cache hits and misses', () => {
            cacheManager.setCache('key1', 'data', 60000);
            cacheManager.getFromCache('key1'); // hit
            cacheManager.getFromCache('nonexistent'); // miss
            const stats = cacheManager.getStats();
            (0, globals_1.expect)(stats.mainCacheHits).toBe(1);
            (0, globals_1.expect)(stats.mainCacheMisses).toBe(1);
        });
        (0, globals_1.it)('should count expired entry as miss', () => {
            cacheManager.setCache('key1', 'data', 100);
            globals_1.jest.useFakeTimers();
            globals_1.jest.setSystemTime(Date.now() + 200);
            cacheManager.getFromCache('key1'); // miss (expired)
            const stats = cacheManager.getStats();
            (0, globals_1.expect)(stats.mainCacheMisses).toBe(1);
            (0, globals_1.expect)(stats.mainCacheHits).toBe(0);
            globals_1.jest.useRealTimers();
        });
        (0, globals_1.it)('should evict oldest entry when cache is full', () => {
            cacheManager.setCache('key1', 'data1', 60000);
            cacheManager.setCache('key2', 'data2', 60000);
            cacheManager.setCache('key3', 'data3', 60000); // cache is full (maxCacheSize=3)
            cacheManager.setCache('key4', 'data4', 60000); // should evict key1
            (0, globals_1.expect)(cacheManager.getFromCache('key1')).toBeNull(); // evicted
            (0, globals_1.expect)(cacheManager.getFromCache('key4')).toEqual('data4');
            (0, globals_1.expect)(cacheManager.getCacheSizes().cacheSize).toBe(3);
        });
        (0, globals_1.it)('should update cache size stat after set', () => {
            cacheManager.setCache('key1', 'data', 60000);
            (0, globals_1.expect)(cacheManager.getStats().mainCacheSize).toBe(1);
        });
    });
    (0, globals_1.describe)('context cache (getFromContextCache / setContextCache)', () => {
        const mockContext = {
            vmId: 'vm-1',
            historicalMetrics: [],
            recentProcessSnapshots: [],
            portUsage: [],
            machineConfig: null
        };
        (0, globals_1.it)('should store and retrieve context', () => {
            cacheManager.setContextCache('ctx-1', mockContext, 60000);
            const result = cacheManager.getFromContextCache('ctx-1');
            (0, globals_1.expect)(result).toEqual(mockContext);
        });
        (0, globals_1.it)('should return null for non-existent context key', () => {
            const result = cacheManager.getFromContextCache('nonexistent');
            (0, globals_1.expect)(result).toBeNull();
        });
        (0, globals_1.it)('should return null for expired context entries', () => {
            cacheManager.setContextCache('ctx-1', mockContext, 100);
            globals_1.jest.useFakeTimers();
            globals_1.jest.setSystemTime(Date.now() + 200);
            const result = cacheManager.getFromContextCache('ctx-1');
            (0, globals_1.expect)(result).toBeNull();
            globals_1.jest.useRealTimers();
        });
        (0, globals_1.it)('should track context cache hits and misses', () => {
            cacheManager.setContextCache('ctx-1', mockContext, 60000);
            cacheManager.getFromContextCache('ctx-1'); // hit
            cacheManager.getFromContextCache('nonexistent'); // miss
            const stats = cacheManager.getStats();
            (0, globals_1.expect)(stats.contextCacheHits).toBe(1);
            (0, globals_1.expect)(stats.contextCacheMisses).toBe(1);
        });
        (0, globals_1.it)('should evict oldest context entry when context cache is full (50 entries)', () => {
            // Fill up to 50 entries
            for (let i = 0; i < 50; i++) {
                cacheManager.setContextCache(`ctx-${i}`, Object.assign(Object.assign({}, mockContext), { vmId: `vm-${i}` }), 60000);
            }
            (0, globals_1.expect)(cacheManager.getCacheSizes().contextCacheSize).toBe(50);
            // Add one more - should evict first entry
            cacheManager.setContextCache('ctx-50', Object.assign(Object.assign({}, mockContext), { vmId: 'vm-50' }), 60000);
            (0, globals_1.expect)(cacheManager.getFromContextCache('ctx-0')).toBeNull(); // evicted
            (0, globals_1.expect)(cacheManager.getFromContextCache('ctx-50')).toBeDefined(); // present
            (0, globals_1.expect)(cacheManager.getCacheSizes().contextCacheSize).toBe(50);
        });
        (0, globals_1.it)('should update context cache size stat after set', () => {
            cacheManager.setContextCache('ctx-1', mockContext, 60000);
            (0, globals_1.expect)(cacheManager.getStats().contextCacheSize).toBe(1);
        });
    });
    (0, globals_1.describe)('areRecommendationsStale', () => {
        (0, globals_1.it)('should return true for recommendations older than 24 hours', () => {
            const oldDate = new Date();
            oldDate.setHours(oldDate.getHours() - 25);
            (0, globals_1.expect)(cacheManager.areRecommendationsStale(oldDate)).toBe(true);
        });
        (0, globals_1.it)('should return false for recent recommendations', () => {
            const recentDate = new Date();
            recentDate.setHours(recentDate.getHours() - 1);
            (0, globals_1.expect)(cacheManager.areRecommendationsStale(recentDate)).toBe(false);
        });
        (0, globals_1.it)('should return false for recommendations exactly at the boundary (edge)', () => {
            const boundaryDate = new Date();
            boundaryDate.setHours(boundaryDate.getHours() - 24);
            // 24 hours ago should NOT be stale (strictly less than)
            (0, globals_1.expect)(cacheManager.areRecommendationsStale(boundaryDate)).toBe(false);
        });
    });
    (0, globals_1.describe)('clearCaches', () => {
        (0, globals_1.it)('should clear both caches', () => {
            cacheManager.setCache('key1', 'data', 60000);
            cacheManager.setContextCache('ctx-1', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000);
            cacheManager.clearCaches();
            (0, globals_1.expect)(cacheManager.getCacheSizes().cacheSize).toBe(0);
            (0, globals_1.expect)(cacheManager.getCacheSizes().contextCacheSize).toBe(0);
            (0, globals_1.expect)(cacheManager.getFromCache('key1')).toBeNull();
            (0, globals_1.expect)(cacheManager.getFromContextCache('ctx-1')).toBeNull();
        });
        (0, globals_1.it)('should reset cache size stats', () => {
            cacheManager.setCache('key1', 'data', 60000);
            cacheManager.clearCaches();
            const stats = cacheManager.getStats();
            (0, globals_1.expect)(stats.mainCacheSize).toBe(0);
            (0, globals_1.expect)(stats.contextCacheSize).toBe(0);
        });
        (0, globals_1.it)('should log clear message', () => {
            cacheManager.clearCaches();
            (0, globals_1.expect)(logger_1.default.info).toHaveBeenCalledWith('🧹 CacheManager: all caches cleared');
        });
    });
    (0, globals_1.describe)('performMaintenance', () => {
        (0, globals_1.it)('should clean expired main cache entries', () => {
            cacheManager.setCache('expired1', 'data', 100);
            cacheManager.setCache('valid1', 'data', 60000);
            globals_1.jest.useFakeTimers();
            globals_1.jest.setSystemTime(Date.now() + 200);
            const result = cacheManager.performMaintenance();
            (0, globals_1.expect)(result.cacheCleanedCount).toBe(1);
            (0, globals_1.expect)(result.contextCacheCleanedCount).toBe(0);
            (0, globals_1.expect)(cacheManager.getCacheSizes().cacheSize).toBe(1);
            globals_1.jest.useRealTimers();
        });
        (0, globals_1.it)('should clean expired context cache entries', () => {
            cacheManager.setContextCache('expired-ctx', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 100);
            cacheManager.setContextCache('valid-ctx', { vmId: 'vm-2', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000);
            globals_1.jest.useFakeTimers();
            globals_1.jest.setSystemTime(Date.now() + 200);
            const result = cacheManager.performMaintenance();
            (0, globals_1.expect)(result.cacheCleanedCount).toBe(0);
            (0, globals_1.expect)(result.contextCacheCleanedCount).toBe(1);
            globals_1.jest.useRealTimers();
        });
        (0, globals_1.it)('should clean both caches and return counts', () => {
            cacheManager.setCache('expired-main', 'data', 100);
            cacheManager.setCache('valid-main', 'data', 60000);
            cacheManager.setContextCache('expired-ctx', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 100);
            cacheManager.setContextCache('valid-ctx', { vmId: 'vm-2', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000);
            globals_1.jest.useFakeTimers();
            globals_1.jest.setSystemTime(Date.now() + 200);
            const result = cacheManager.performMaintenance();
            (0, globals_1.expect)(result.cacheCleanedCount).toBe(1);
            (0, globals_1.expect)(result.contextCacheCleanedCount).toBe(1);
            (0, globals_1.expect)(cacheManager.getCacheSizes().cacheSize).toBe(1);
            (0, globals_1.expect)(cacheManager.getCacheSizes().contextCacheSize).toBe(1);
            globals_1.jest.useRealTimers();
        });
        (0, globals_1.it)('should return zeros when nothing is expired', () => {
            cacheManager.setCache('valid', 'data', 60000);
            const result = cacheManager.performMaintenance();
            (0, globals_1.expect)(result.cacheCleanedCount).toBe(0);
            (0, globals_1.expect)(result.contextCacheCleanedCount).toBe(0);
        });
        (0, globals_1.it)('should not log when nothing was cleaned', () => {
            cacheManager.performMaintenance();
            (0, globals_1.expect)(logger_1.default.info).not.toHaveBeenCalledWith(globals_1.expect.stringContaining('maintenance'));
        });
        (0, globals_1.it)('should log when entries were cleaned', () => {
            cacheManager.setCache('expired', 'data', 100);
            globals_1.jest.useFakeTimers();
            globals_1.jest.setSystemTime(Date.now() + 200);
            cacheManager.performMaintenance();
            (0, globals_1.expect)(logger_1.default.info).toHaveBeenCalledWith(globals_1.expect.stringContaining('CacheManager maintenance'));
            globals_1.jest.useRealTimers();
        });
    });
    (0, globals_1.describe)('getCacheSizes', () => {
        (0, globals_1.it)('should return correct sizes', () => {
            cacheManager.setCache('k1', 'd1', 60000);
            cacheManager.setCache('k2', 'd2', 60000);
            cacheManager.setContextCache('c1', { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null }, 60000);
            const sizes = cacheManager.getCacheSizes();
            (0, globals_1.expect)(sizes.cacheSize).toBe(2);
            (0, globals_1.expect)(sizes.contextCacheSize).toBe(1);
        });
    });
    (0, globals_1.describe)('getStats', () => {
        (0, globals_1.it)('should return a copy of stats (not reference)', () => {
            const stats1 = cacheManager.getStats();
            stats1.mainCacheHits = 999;
            const stats2 = cacheManager.getStats();
            (0, globals_1.expect)(stats2.mainCacheHits).toBe(0);
        });
    });
    (0, globals_1.describe)('getMainCache / getContextCache (debug)', () => {
        (0, globals_1.it)('should return the actual cache maps', () => {
            cacheManager.setCache('key1', 'data', 60000);
            const mainCache = cacheManager.getMainCache();
            (0, globals_1.expect)(mainCache.get('key1')).toBeDefined();
            (0, globals_1.expect)(mainCache.get('key1').data).toBe('data');
        });
        (0, globals_1.it)('should return the actual context cache maps', () => {
            const mockCtx = { vmId: 'vm-1', historicalMetrics: [], recentProcessSnapshots: [], portUsage: [], machineConfig: null };
            cacheManager.setContextCache('ctx-1', mockCtx, 60000);
            const contextCache = cacheManager.getContextCache();
            (0, globals_1.expect)(contextCache.get('ctx-1')).toBeDefined();
            (0, globals_1.expect)(contextCache.get('ctx-1').data).toEqual(mockCtx);
        });
    });
});
