"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const logger_1 = __importDefault(require("@main/logger"));
const BaseRecommendationChecker_1 = require("../../../../app/services/recommendations/BaseRecommendationChecker");
/**
 * Concrete implementation for testing the abstract base class.
 * Exposes protected methods via public wrappers for testing.
 */
class TestableChecker extends BaseRecommendationChecker_1.RecommendationChecker {
    constructor() {
        super(...arguments);
        // Expose protected methods for testing
        this.testParseAndCalculateDaysSince = this.parseAndCalculateDaysSince.bind(this);
        this.testExtractDiskSpaceData = this.extractDiskSpaceData.bind(this);
        this.testLooksLikeDiskUsageData = this.looksLikeDiskUsageData.bind(this);
    }
    getName() { return 'TestChecker'; }
    getCategory() { return 'test'; }
    analyze(_context) {
        return __awaiter(this, void 0, void 0, function* () {
            return [];
        });
    }
}
const createBaseContext = () => ({
    vmId: 'test-vm-1',
    latestSnapshot: null,
    historicalMetrics: [],
    recentProcessSnapshots: [],
    portUsage: [],
    machineConfig: null
});
(0, globals_1.describe)('BaseRecommendationChecker', () => {
    let checker;
    let consoleWarnSpy;
    let consoleDebugSpy;
    (0, globals_1.beforeEach)(() => {
        checker = new TestableChecker();
        consoleWarnSpy = globals_1.jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
        consoleDebugSpy = globals_1.jest.spyOn(logger_1.default, 'debug').mockImplementation(() => undefined);
    });
    (0, globals_1.afterEach)(() => {
        consoleWarnSpy.mockRestore();
        consoleDebugSpy.mockRestore();
    });
    (0, globals_1.describe)('isApplicable', () => {
        (0, globals_1.it)('should return true by default', () => {
            (0, globals_1.expect)(checker.isApplicable(createBaseContext())).toBe(true);
        });
    });
    (0, globals_1.describe)('parseAndCalculateDaysSince', () => {
        (0, globals_1.it)('should return invalid for null/undefined date', () => {
            (0, globals_1.expect)(checker.testParseAndCalculateDaysSince(null)).toEqual({
                isValid: false, date: null, daysSince: null
            });
            (0, globals_1.expect)(checker.testParseAndCalculateDaysSince(undefined)).toEqual({
                isValid: false, date: null, daysSince: null
            });
        });
        (0, globals_1.it)('should return invalid for empty string', () => {
            (0, globals_1.expect)(checker.testParseAndCalculateDaysSince('')).toEqual({
                isValid: false, date: null, daysSince: null
            });
        });
        (0, globals_1.it)('should return invalid for invalid date string', () => {
            (0, globals_1.expect)(checker.testParseAndCalculateDaysSince('not-a-date')).toEqual({
                isValid: false, date: null, daysSince: null
            });
        });
        (0, globals_1.it)('should return 0 days for today', () => {
            const today = new Date().toISOString().split('T')[0];
            const result = checker.testParseAndCalculateDaysSince(today);
            (0, globals_1.expect)(result.isValid).toBe(true);
            (0, globals_1.expect)(result.date).toBeInstanceOf(Date);
            (0, globals_1.expect)(result.daysSince).toBe(0);
        });
        (0, globals_1.it)('should calculate correct days for past date', () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 5);
            const result = checker.testParseAndCalculateDaysSince(pastDate.toISOString());
            (0, globals_1.expect)(result.isValid).toBe(true);
            (0, globals_1.expect)(result.daysSince).toBe(5);
        });
        (0, globals_1.it)('should calculate correct days for dates far in the past', () => {
            const pastDate = new Date();
            pastDate.setDate(pastDate.getDate() - 90);
            const result = checker.testParseAndCalculateDaysSince(pastDate.toISOString());
            (0, globals_1.expect)(result.isValid).toBe(true);
            (0, globals_1.expect)(result.daysSince).toBe(90);
        });
        (0, globals_1.it)('should handle various ISO date formats', () => {
            const result1 = checker.testParseAndCalculateDaysSince('2024-01-15T10:30:00.000Z');
            (0, globals_1.expect)(result1.isValid).toBe(true);
            const result2 = checker.testParseAndCalculateDaysSince('2024-01-15');
            (0, globals_1.expect)(result2.isValid).toBe(true);
        });
    });
    (0, globals_1.describe)('extractDiskSpaceData', () => {
        (0, globals_1.it)('should return null when no latestSnapshot exists', () => {
            const context = createBaseContext();
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).toBeNull();
        });
        (0, globals_1.it)('should return null when diskSpaceInfo is null', () => {
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: { diskSpaceInfo: null } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).toBeNull();
        });
        (0, globals_1.it)('should parse string diskSpaceInfo', () => {
            const diskInfo = JSON.stringify({
                'C:': { used: 80, total: 100, usedGB: 80, totalGB: 100 }
            });
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: { diskSpaceInfo: diskInfo } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).not.toBeNull();
            (0, globals_1.expect)(result['C:'].usedGB).toBe(80);
            (0, globals_1.expect)(result['C:'].totalGB).toBe(100);
        });
        (0, globals_1.it)('should parse object diskSpaceInfo (Format 4: direct keyed data)', () => {
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: {
                    diskSpaceInfo: {
                        'C:': { usedGB: 85, totalGB: 100, available_gb: 15, usage_percent: 85 },
                        'D:': { usedGB: 200, totalGB: 500, available_gb: 300, usage_percent: 40 }
                    }
                } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).not.toBeNull();
            (0, globals_1.expect)(result['C:'].usedGB).toBe(85);
            (0, globals_1.expect)(result['D:'].usedGB).toBe(200);
        });
        (0, globals_1.it)('should parse Format 1: AutoCheckEngine CheckResult', () => {
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: {
                    diskSpaceInfo: {
                        check_name: 'disk_space',
                        details: { drive: '/', free_gb: 10, total_gb: 100, usage_percent: 90 }
                    }
                } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).not.toBeNull();
            (0, globals_1.expect)(result['/'].used_gb).toBe(90); // total - free
            (0, globals_1.expect)(result['/'].total_gb).toBe(100);
            (0, globals_1.expect)(result['/'].available_gb).toBe(10);
            (0, globals_1.expect)(result['/'].mount_point).toBe('/');
        });
        (0, globals_1.it)('should parse Format 2: system_operations disk check with disks array', () => {
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: {
                    diskSpaceInfo: {
                        status: 'ok',
                        disks: [
                            { mount_point: '/', total_gb: 100, used_gb: 45, available_gb: 55, usage_percent: 45 },
                            { mount_point: '/data', total_gb: 500, used_gb: 400, available_gb: 100, usage_percent: 80 }
                        ]
                    }
                } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).not.toBeNull();
            (0, globals_1.expect)(result['/'].used_gb).toBe(45);
            (0, globals_1.expect)(result['/data'].used_gb).toBe(400);
        });
        (0, globals_1.it)('should parse Format 3: Legacy diskUsage format', () => {
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: {
                    diskSpaceInfo: {
                        diskUsage: {
                            'C:': { used: 80, total: 100 },
                            'D:': { used: 200, total: 500 }
                        }
                    }
                } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).not.toBeNull();
            (0, globals_1.expect)(result['C:'].used).toBe(80);
            (0, globals_1.expect)(result['D:'].total).toBe(500);
        });
        (0, globals_1.it)('should return null for invalid diskSpaceInfo', () => {
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: { diskSpaceInfo: 'not-json' } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).toBeNull();
        });
        (0, globals_1.it)('should return null for unrecognised format', () => {
            const context = Object.assign(Object.assign({}, createBaseContext()), { latestSnapshot: { diskSpaceInfo: { foo: 'bar' } } });
            const result = checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(result).toBeNull();
        });
        (0, globals_1.it)('should log debug when no disk space data available', () => {
            const context = createBaseContext();
            checker.testExtractDiskSpaceData(context);
            (0, globals_1.expect)(consoleDebugSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('No disk space data available'));
        });
    });
    (0, globals_1.describe)('looksLikeDiskUsageData', () => {
        (0, globals_1.it)('should return true for objects with used/total', () => {
            (0, globals_1.expect)(checker.testLooksLikeDiskUsageData({
                'C:': { used: 80, total: 100 }
            })).toBe(true);
        });
        (0, globals_1.it)('should return true for objects with usedGB/totalGB', () => {
            (0, globals_1.expect)(checker.testLooksLikeDiskUsageData({
                'C:': { usedGB: 80, totalGB: 100 }
            })).toBe(true);
        });
        (0, globals_1.it)('should return true for objects with used_gb/total_gb', () => {
            (0, globals_1.expect)(checker.testLooksLikeDiskUsageData({
                '/': { used_gb: 80, total_gb: 100 }
            })).toBe(true);
        });
        (0, globals_1.it)('should return false for objects without usage fields', () => {
            (0, globals_1.expect)(checker.testLooksLikeDiskUsageData({
                'C:': { name: 'disk' }
            })).toBe(false);
        });
        (0, globals_1.it)('should return false for null', () => {
            (0, globals_1.expect)(checker.testLooksLikeDiskUsageData(null)).toBe(false);
        });
        (0, globals_1.it)('should return false for empty object', () => {
            (0, globals_1.expect)(checker.testLooksLikeDiskUsageData({})).toBe(false);
        });
        (0, globals_1.it)('should return true when mixed used/total variants are present', () => {
            (0, globals_1.expect)(checker.testLooksLikeDiskUsageData({
                'C:': { usedGB: 80, total: 100 }
            })).toBe(true);
        });
    });
});
