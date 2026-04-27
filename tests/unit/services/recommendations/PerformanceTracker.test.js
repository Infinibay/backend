"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const PerformanceTracker_1 = require("../../../../app/services/recommendations/PerformanceTracker");
const logger_1 = __importDefault(require("@main/logger"));
const mockConfig = {
    cacheTTLMinutes: 5,
    maxCacheSize: 100,
    enablePerformanceMonitoring: true,
    enableContextCaching: true,
    contextCacheTTLMinutes: 10,
    performanceLoggingThreshold: 1000,
    maxRetries: 3,
    retryDelayMs: 1000
};
(0, globals_1.describe)('PerformanceTracker', () => {
    let tracker;
    let consoleSpy;
    (0, globals_1.beforeEach)(() => {
        tracker = new PerformanceTracker_1.PerformanceTracker(mockConfig);
        consoleSpy = globals_1.jest.spyOn(logger_1.default, 'debug').mockImplementation(() => undefined);
        globals_1.jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
    });
    (0, globals_1.afterEach)(() => {
        consoleSpy.mockRestore();
        globals_1.jest.restoreAllMocks();
    });
    (0, globals_1.describe)('constructor', () => {
        (0, globals_1.it)('should initialize with default metrics', () => {
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.totalGenerations).toBe(0);
            (0, globals_1.expect)(metrics.averageGenerationTime).toBe(0);
            (0, globals_1.expect)(metrics.cacheHitRate).toBe(0);
            (0, globals_1.expect)(metrics.cacheHits).toBe(0);
            (0, globals_1.expect)(metrics.cacheMisses).toBe(0);
            (0, globals_1.expect)(metrics.contextBuildTime).toBe(0);
            (0, globals_1.expect)(metrics.checkerTimes).toBeInstanceOf(Map);
            (0, globals_1.expect)(metrics.checkerTimes.size).toBe(0);
            (0, globals_1.expect)(metrics.errorCount).toBe(0);
            (0, globals_1.expect)(metrics.lastError).toBeNull();
        });
    });
    (0, globals_1.describe)('updateCacheHitRate', () => {
        (0, globals_1.it)('should increment cache hits and update rate', () => {
            tracker.updateCacheHitRate(true);
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.cacheHits).toBe(1);
            (0, globals_1.expect)(metrics.cacheMisses).toBe(0);
            (0, globals_1.expect)(metrics.cacheHitRate).toBe(1);
        });
        (0, globals_1.it)('should increment cache misses and update rate', () => {
            tracker.updateCacheHitRate(false);
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.cacheHits).toBe(0);
            (0, globals_1.expect)(metrics.cacheMisses).toBe(1);
            (0, globals_1.expect)(metrics.cacheHitRate).toBe(0);
        });
        (0, globals_1.it)('should calculate correct hit rate over multiple calls', () => {
            // 3 hits, 1 miss = 75%
            tracker.updateCacheHitRate(true);
            tracker.updateCacheHitRate(true);
            tracker.updateCacheHitRate(true);
            tracker.updateCacheHitRate(false);
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.cacheHits).toBe(3);
            (0, globals_1.expect)(metrics.cacheMisses).toBe(1);
            (0, globals_1.expect)(metrics.cacheHitRate).toBeCloseTo(0.75);
        });
        (0, globals_1.it)('should handle alternating hits and misses', () => {
            tracker.updateCacheHitRate(true);
            tracker.updateCacheHitRate(false);
            tracker.updateCacheHitRate(true);
            tracker.updateCacheHitRate(false);
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.cacheHitRate).toBeCloseTo(0.5);
        });
    });
    (0, globals_1.describe)('updateAverageTime', () => {
        (0, globals_1.it)('should return new time when average is 0', () => {
            const result = tracker.updateAverageTime(0, 100);
            (0, globals_1.expect)(result).toBe(100);
        });
        (0, globals_1.it)('should compute correct moving average', () => {
            tracker.updateMetrics(100, 5); // totalGenerations = 1, avg = 100
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.averageGenerationTime).toBe(100);
            tracker.updateMetrics(200, 3); // totalGenerations = 2, avg = (100*1 + 200) / 2 = 150
            const metrics2 = tracker.getMetrics();
            (0, globals_1.expect)(metrics2.averageGenerationTime).toBeCloseTo(150);
        });
    });
    (0, globals_1.describe)('updateMetrics', () => {
        (0, globals_1.it)('should increment total generations', () => {
            tracker.updateMetrics(100, 5);
            (0, globals_1.expect)(tracker.getMetrics().totalGenerations).toBe(1);
            tracker.updateMetrics(200, 3);
            (0, globals_1.expect)(tracker.getMetrics().totalGenerations).toBe(2);
        });
        (0, globals_1.it)('should update average generation time', () => {
            tracker.updateMetrics(100, 5);
            tracker.updateMetrics(200, 3);
            tracker.updateMetrics(300, 2);
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.averageGenerationTime).toBeCloseTo(200);
        });
        (0, globals_1.it)('should log debug message', () => {
            tracker.updateMetrics(150, 7);
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('Generated 7 recommendations in 150ms'));
        });
    });
    (0, globals_1.describe)('updateContextBuildTime', () => {
        (0, globals_1.it)('should update context build time with first value', () => {
            tracker.updateContextBuildTime(50);
            (0, globals_1.expect)(tracker.getMetrics().contextBuildTime).toBe(50);
        });
        (0, globals_1.it)('should update context build time using updateAverageTime with current totalGenerations', () => {
            // updateAverageTime uses totalGenerations as divisor count
            // With totalGenerations=1: ((currentAvg * 0) + newTime) / 1 = newTime
            tracker.updateMetrics(100, 5); // totalGenerations = 1
            tracker.updateContextBuildTime(50); // ((0*0)+50)/1 = 50
            tracker.updateContextBuildTime(150); // ((50*0)+150)/1 = 150 (still totalGenerations=1)
            (0, globals_1.expect)(tracker.getMetrics().contextBuildTime).toBe(150);
            // With totalGenerations=2: ((currentAvg * 1) + newTime) / 2
            tracker.updateMetrics(200, 3); // totalGenerations = 2
            tracker.updateContextBuildTime(250); // ((150*1)+250)/2 = 200
            (0, globals_1.expect)(tracker.getMetrics().contextBuildTime).toBe(200);
        });
    });
    (0, globals_1.describe)('updateCheckerTime', () => {
        (0, globals_1.it)('should store checker time for new checker', () => {
            tracker.updateCheckerTime('DiskSpaceChecker', 200);
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.checkerTimes.get('DiskSpaceChecker')).toBe(200);
        });
        (0, globals_1.it)('should update checker time using updateAverageTime with current totalGenerations', () => {
            tracker.updateMetrics(100, 5); // totalGenerations = 1
            tracker.updateCheckerTime('DiskSpaceChecker', 200); // ((0*0)+200)/1 = 200
            tracker.updateCheckerTime('DiskSpaceChecker', 400); // ((200*0)+400)/1 = 400
            (0, globals_1.expect)(tracker.getMetrics().checkerTimes.get('DiskSpaceChecker')).toBe(400);
            // With totalGenerations=2: ((400*1)+600)/2 = 500
            tracker.updateMetrics(200, 3); // totalGenerations = 2
            tracker.updateCheckerTime('DiskSpaceChecker', 600);
            (0, globals_1.expect)(tracker.getMetrics().checkerTimes.get('DiskSpaceChecker')).toBe(500);
        });
        (0, globals_1.it)('should track multiple checkers independently', () => {
            tracker.updateCheckerTime('DiskSpaceChecker', 200);
            tracker.updateCheckerTime('PortConflictChecker', 50);
            const m = tracker.getMetrics();
            (0, globals_1.expect)(m.checkerTimes.get('DiskSpaceChecker')).toBe(200);
            (0, globals_1.expect)(m.checkerTimes.get('PortConflictChecker')).toBe(50);
            (0, globals_1.expect)(m.checkerTimes.size).toBe(2);
        });
    });
    (0, globals_1.describe)('recordError', () => {
        (0, globals_1.it)('should increment error count', () => {
            tracker.recordError('test error');
            (0, globals_1.expect)(tracker.getMetrics().errorCount).toBe(1);
            tracker.recordError('another error');
            (0, globals_1.expect)(tracker.getMetrics().errorCount).toBe(2);
        });
        (0, globals_1.it)('should store last error message', () => {
            tracker.recordError('first error');
            (0, globals_1.expect)(tracker.getMetrics().lastError).toBe('first error');
            tracker.recordError('second error');
            (0, globals_1.expect)(tracker.getMetrics().lastError).toBe('second error');
        });
    });
    (0, globals_1.describe)('logPerformanceSummary', () => {
        (0, globals_1.beforeEach)(() => {
            globals_1.jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
        });
        (0, globals_1.it)('should not log when performance monitoring is disabled', () => {
            const disabledConfig = Object.assign(Object.assign({}, mockConfig), { enablePerformanceMonitoring: false });
            const disabledTracker = new PerformanceTracker_1.PerformanceTracker(disabledConfig);
            disabledTracker.logPerformanceSummary('vm-1', 5000, 1000, new Map(), 5);
            (0, globals_1.expect)(logger_1.default.info).not.toHaveBeenCalled();
        });
        (0, globals_1.it)('should log when total time exceeds threshold', () => {
            const slowCheckers = new Map();
            tracker.logPerformanceSummary('vm-1', 2000, 500, slowCheckers, 10);
            (0, globals_1.expect)(logger_1.default.info).toHaveBeenCalledWith(globals_1.expect.stringContaining('Performance summary for VM vm-1'));
            (0, globals_1.expect)(logger_1.default.info).toHaveBeenCalledWith(globals_1.expect.stringContaining('Total time: 2000ms'));
        });
        (0, globals_1.it)('should log slow checkers (> 1000ms)', () => {
            const slowCheckers = new Map([
                ['SlowChecker', 1500],
                ['FastChecker', 200]
            ]);
            tracker.logPerformanceSummary('vm-1', 500, 100, slowCheckers, 3);
            (0, globals_1.expect)(logger_1.default.info).toHaveBeenCalledWith(globals_1.expect.stringContaining('Slow checkers'));
            (0, globals_1.expect)(logger_1.default.info).toHaveBeenCalledWith(globals_1.expect.stringContaining('SlowChecker: 1500ms'));
        });
        (0, globals_1.it)('should not log fast checkers', () => {
            const fastCheckers = new Map([
                ['FastChecker', 200]
            ]);
            tracker.logPerformanceSummary('vm-1', 500, 100, fastCheckers, 3);
            (0, globals_1.expect)(logger_1.default.info).not.toHaveBeenCalledWith(globals_1.expect.stringContaining('Slow checkers'));
        });
    });
    (0, globals_1.describe)('getMetrics', () => {
        (0, globals_1.it)('should return a copy of metrics (not reference)', () => {
            const metrics1 = tracker.getMetrics();
            metrics1.totalGenerations = 999;
            const metrics2 = tracker.getMetrics();
            (0, globals_1.expect)(metrics2.totalGenerations).toBe(0);
        });
        (0, globals_1.it)('should return a copy of checkerTimes map', () => {
            tracker.updateCheckerTime('TestChecker', 100);
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.checkerTimes).toBeInstanceOf(Map);
            (0, globals_1.expect)(metrics.checkerTimes.get('TestChecker')).toBe(100);
        });
    });
    (0, globals_1.describe)('getServiceHealth', () => {
        (0, globals_1.it)('should report healthy when errors are low and response is fast', () => {
            tracker.updateMetrics(100, 5); // avg time 100ms, 0 errors
            const health = tracker.getServiceHealth(10, 5);
            (0, globals_1.expect)(health.isHealthy).toBe(true);
            (0, globals_1.expect)(health.cacheSize).toBe(10);
            (0, globals_1.expect)(health.contextCacheSize).toBe(5);
        });
        (0, globals_1.it)('should report unhealthy when error count is high', () => {
            for (let i = 0; i < 15; i++) {
                tracker.recordError(`error ${i}`);
            }
            const health = tracker.getServiceHealth(10, 5);
            (0, globals_1.expect)(health.isHealthy).toBe(false);
        });
        (0, globals_1.it)('should report unhealthy when average time is too high', () => {
            tracker.updateMetrics(35000, 5); // 35 seconds avg
            const health = tracker.getServiceHealth(10, 5);
            (0, globals_1.expect)(health.isHealthy).toBe(false);
        });
        (0, globals_1.it)('should include configuration copy', () => {
            const health = tracker.getServiceHealth(10, 5);
            (0, globals_1.expect)(health.configuration.cacheTTLMinutes).toBe(5);
            (0, globals_1.expect)(health.configuration.maxCacheSize).toBe(100);
        });
        (0, globals_1.it)('should include performance metrics copy', () => {
            tracker.updateMetrics(100, 5);
            tracker.recordError('test error');
            const health = tracker.getServiceHealth(10, 5);
            (0, globals_1.expect)(health.performanceMetrics.totalGenerations).toBe(1);
            (0, globals_1.expect)(health.performanceMetrics.errorCount).toBe(1);
            (0, globals_1.expect)(health.performanceMetrics.lastError).toBe('test error');
        });
    });
    (0, globals_1.describe)('reset', () => {
        (0, globals_1.it)('should reset all metrics to default values', () => {
            // Populate some data
            tracker.updateMetrics(100, 5);
            tracker.updateCacheHitRate(true);
            tracker.recordError('test error');
            tracker.updateCheckerTime('TestChecker', 200);
            // Reset
            tracker.reset();
            const metrics = tracker.getMetrics();
            (0, globals_1.expect)(metrics.totalGenerations).toBe(0);
            (0, globals_1.expect)(metrics.averageGenerationTime).toBe(0);
            (0, globals_1.expect)(metrics.cacheHits).toBe(0);
            (0, globals_1.expect)(metrics.cacheMisses).toBe(0);
            (0, globals_1.expect)(metrics.errorCount).toBe(0);
            (0, globals_1.expect)(metrics.lastError).toBeNull();
            (0, globals_1.expect)(metrics.checkerTimes.size).toBe(0);
        });
        (0, globals_1.it)('should log reset message', () => {
            tracker.reset();
            (0, globals_1.expect)(logger_1.default.info).toHaveBeenCalledWith('📊 PerformanceTracker metrics reset');
        });
    });
    (0, globals_1.describe)('logStats', () => {
        (0, globals_1.it)('should log stats when monitoring is enabled and generations > 0', () => {
            tracker.updateMetrics(150, 5);
            tracker.updateCacheHitRate(true);
            tracker.recordError('test error');
            tracker.logStats();
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('VMRecommendationService performance stats'));
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('Total generations: 1'));
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('Average time: 150ms'));
        });
        (0, globals_1.it)('should not log when monitoring is disabled', () => {
            const disabledConfig = Object.assign(Object.assign({}, mockConfig), { enablePerformanceMonitoring: false });
            const disabledTracker = new PerformanceTracker_1.PerformanceTracker(disabledConfig);
            disabledTracker.updateMetrics(100, 5);
            disabledTracker.logStats();
            (0, globals_1.expect)(consoleSpy).not.toHaveBeenCalledWith(globals_1.expect.stringContaining('performance stats'));
        });
        (0, globals_1.it)('should not log when no generations have occurred', () => {
            tracker.logStats();
            (0, globals_1.expect)(consoleSpy).not.toHaveBeenCalledWith(globals_1.expect.stringContaining('performance stats'));
        });
        (0, globals_1.it)('should log last error when present', () => {
            tracker.updateMetrics(100, 5);
            tracker.recordError('something went wrong');
            tracker.logStats();
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('Last error: something went wrong'));
        });
    });
});
