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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationPerformanceUtils = exports.RECOMMENDATION_TEST_QUERIES = exports.RecommendationTestUtils = void 0;
exports.createMockVMRecommendation = createMockVMRecommendation;
exports.createMockHealthSnapshot = createMockHealthSnapshot;
exports.createMockSystemMetrics = createMockSystemMetrics;
exports.createMockDiskSpaceInfo = createMockDiskSpaceInfo;
exports.createMockResourceOptInfo = createMockResourceOptInfo;
exports.createMockWindowsUpdateInfo = createMockWindowsUpdateInfo;
exports.createMockDefenderStatus = createMockDefenderStatus;
exports.createMockApplicationInventory = createMockApplicationInventory;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
/**
 * Create mock VM recommendation with realistic data
 */
function createMockVMRecommendation(overrides = {}) {
    const id = overrides.id || (0, crypto_1.randomBytes)(12).toString('hex');
    const machineId = overrides.machineId || (0, crypto_1.randomBytes)(12).toString('hex');
    return Object.assign({ id,
        machineId, snapshotId: overrides.snapshotId !== undefined ? overrides.snapshotId : (0, crypto_1.randomBytes)(12).toString('hex'), type: overrides.type || client_1.RecommendationType.DISK_SPACE_LOW, text: overrides.text || 'Disk space is running low on drive C:', actionText: overrides.actionText || 'Clean up disk space or add more storage', data: overrides.data || {
            drive: 'C:',
            usedPercent: 85,
            freeGB: 5.2,
            threshold: 80
        }, createdAt: overrides.createdAt || new Date() }, overrides);
}
/**
 * Create mock health snapshot with comprehensive test data
 */
function createMockHealthSnapshot(overrides = {}) {
    const id = overrides.id || (0, crypto_1.randomBytes)(12).toString('hex');
    const machineId = overrides.machineId || (0, crypto_1.randomBytes)(12).toString('hex');
    return Object.assign({ id,
        machineId, snapshotDate: overrides.snapshotDate || new Date(), overallStatus: overrides.overallStatus || 'HEALTHY', checksCompleted: 6, checksFailed: 0, executionTimeMs: 2500, errorSummary: null, osType: overrides.osType || 'Windows', diskSpaceInfo: overrides.diskSpaceInfo || {
            drives: [
                { drive: 'C:', totalGB: 100, usedGB: 45, freeGB: 55, usedPercent: 45, status: 'PASSED' },
                { drive: 'D:', totalGB: 500, usedGB: 150, freeGB: 350, usedPercent: 30, status: 'PASSED' }
            ],
            success: true,
            timestamp: new Date().toISOString()
        }, resourceOptInfo: overrides.resourceOptInfo || {
            recommendations: [
                {
                    resource: 'CPU',
                    currentValue: 8,
                    recommendedValue: 4,
                    reason: 'Low CPU utilization detected',
                    potentialSavingsPercent: 50,
                    unit: 'cores'
                }
            ],
            success: true,
            timestamp: new Date().toISOString()
        }, windowsUpdateInfo: overrides.windowsUpdateInfo || {
            pendingUpdatesCount: 3,
            criticalUpdatesCount: 1,
            securityUpdatesCount: 2,
            lastCheckTime: new Date().toISOString(),
            pendingUpdates: [
                { title: 'Security Update KB123456', severity: 'Critical', sizeInMB: 45.2 }
            ],
            success: true,
            timestamp: new Date().toISOString()
        }, defenderStatus: overrides.defenderStatus || {
            antivirusEnabled: true,
            realTimeProtectionEnabled: true,
            antivirusSignatureLastUpdated: new Date().toISOString(),
            threatsDetected: 0,
            overallStatus: 'PASSED',
            success: true,
            timestamp: new Date().toISOString()
        }, applicationInventory: overrides.applicationInventory || {
            applications: [
                {
                    name: 'Microsoft Office 365',
                    version: '16.0.14326',
                    publisher: 'Microsoft Corporation',
                    installDate: '2023-01-15T00:00:00Z',
                    sizeInMB: 2048.5
                },
                {
                    name: 'Google Chrome',
                    version: '118.0.5993.88',
                    publisher: 'Google LLC',
                    installDate: '2023-02-01T00:00:00Z',
                    sizeInMB: 245.8
                }
            ],
            totalCount: 2,
            success: true,
            timestamp: new Date().toISOString()
        }, customCheckResults: overrides.customCheckResults || {}, createdAt: new Date(), updatedAt: new Date() }, overrides);
}
/**
 * Create mock system metrics for recommendation context
 */
function createMockSystemMetrics(overrides = {}) {
    const id = overrides.id || (0, crypto_1.randomBytes)(12).toString('hex');
    const machineId = overrides.machineId || (0, crypto_1.randomBytes)(12).toString('hex');
    return Object.assign({ id,
        machineId, timestamp: overrides.timestamp || new Date(), cpuUsagePercent: overrides.cpuUsagePercent || 25.5, totalMemoryKB: overrides.totalMemoryKB || 8388608, usedMemoryKB: overrides.usedMemoryKB || 4194304, availableMemoryKB: overrides.availableMemoryKB || 4194304, cpuCoresUsage: overrides.cpuCoresUsage || [20.1, 15.3, 30.7, 22.8], diskUsageStats: overrides.diskUsageStats || {
            'C:': { totalGB: 100, usedGB: 45, freeGB: 55, usedPercent: 45 },
            'D:': { totalGB: 500, usedGB: 150, freeGB: 350, usedPercent: 30 }
        }, diskIOStats: overrides.diskIOStats || {
            readBytesPerSec: 1048576,
            writeBytesPerSec: 524288,
            diskQueueLength: 2.1
        }, networkStats: overrides.networkStats || {
            bytesReceivedPerSec: 2097152,
            bytesSentPerSec: 1048576,
            packetsReceivedPerSec: 1500,
            packetsSentPerSec: 1200
        }, uptime: overrides.uptime || 86400, swapTotalKB: 2097152, swapUsedKB: 0, cpuTemperature: 45.5, loadAverage: { '1min': 1.2, '5min': 1.1, '15min': 1.0 }, createdAt: new Date(), updatedAt: new Date() }, overrides);
}
/**
 * Create mock disk space data for testing disk space checker
 */
function createMockDiskSpaceInfo(scenario = 'healthy') {
    // Use Format 4 (direct keyed data) which the DiskSpaceChecker parseDiskFormats recognizes:
    // { "C:": { used: X, total: Y }, "D:": { used: X, total: Y } }
    const scenarios = {
        healthy: {
            'C:': { used: 45, total: 100, usedGB: 45, totalGB: 100, freeGB: 55, usedPercent: 45 },
            'D:': { used: 150, total: 500, usedGB: 150, totalGB: 500, freeGB: 350, usedPercent: 30 }
        },
        warning: {
            'C:': { used: 82, total: 100, usedGB: 82, totalGB: 100, freeGB: 18, usedPercent: 82 },
            'D:': { used: 150, total: 500, usedGB: 150, totalGB: 500, freeGB: 350, usedPercent: 30 }
        },
        critical: {
            'C:': { used: 92, total: 100, usedGB: 92, totalGB: 100, freeGB: 8, usedPercent: 92 },
            'D:': { used: 185, total: 200, usedGB: 185, totalGB: 200, freeGB: 15, usedPercent: 92.5 }
        }
    };
    return scenarios[scenario];
}
/**
 * Create mock resource optimization data
 */
function createMockResourceOptInfo(scenario = 'optimal') {
    const scenarios = {
        over_provisioned: {
            recommendations: [
                {
                    resource: 'CPU',
                    currentValue: 8,
                    recommendedValue: 4,
                    reason: 'Average CPU utilization is only 15% over 30 days',
                    potentialSavingsPercent: 50,
                    unit: 'cores'
                },
                {
                    resource: 'RAM',
                    currentValue: 16,
                    recommendedValue: 8,
                    reason: 'Average RAM utilization is only 35% over 30 days',
                    potentialSavingsPercent: 50,
                    unit: 'GB'
                }
            ]
        },
        under_provisioned: {
            recommendations: [
                {
                    resource: 'CPU',
                    currentValue: 2,
                    recommendedValue: 4,
                    reason: 'High CPU utilization detected (avg 85% over 7 days)',
                    potentialSavingsPercent: 0,
                    unit: 'cores'
                },
                {
                    resource: 'RAM',
                    currentValue: 4,
                    recommendedValue: 8,
                    reason: 'High RAM utilization detected (avg 92% over 7 days)',
                    potentialSavingsPercent: 0,
                    unit: 'GB'
                }
            ]
        },
        optimal: {
            recommendations: []
        }
    };
    return Object.assign(Object.assign({}, scenarios[scenario]), { evaluationWindowDays: 30, overallStatus: 'PASSED', success: true, timestamp: new Date().toISOString() });
}
/**
 * Create mock Windows update data
 */
function createMockWindowsUpdateInfo(scenario = 'up_to_date') {
    const scenarios = {
        up_to_date: {
            pendingUpdatesCount: 0,
            criticalUpdatesCount: 0,
            securityUpdatesCount: 0,
            pendingUpdates: []
        },
        updates_available: {
            pendingUpdatesCount: 5,
            criticalUpdatesCount: 0,
            securityUpdatesCount: 2,
            pendingUpdates: [
                { title: 'Monthly Quality Rollup KB123456', severity: 'Important', sizeInMB: 125.4 },
                { title: 'Security Update KB234567', severity: 'Important', sizeInMB: 45.2 },
                { title: 'Feature Update KB345678', severity: 'Optional', sizeInMB: 2048.8 }
            ]
        },
        critical_updates: {
            pendingUpdatesCount: 8,
            criticalUpdatesCount: 3,
            securityUpdatesCount: 5,
            pendingUpdates: [
                { title: 'Critical Security Update KB111111', severity: 'Critical', sizeInMB: 89.6 },
                { title: 'Critical Security Update KB222222', severity: 'Critical', sizeInMB: 156.3 },
                { title: 'Critical Security Update KB333333', severity: 'Critical', sizeInMB: 203.7 }
            ]
        }
    };
    return Object.assign(Object.assign({}, scenarios[scenario]), { lastCheckTime: new Date(Date.now() - 3600000).toISOString(), lastInstallTime: new Date(Date.now() - 86400000 * 7).toISOString(), success: true, timestamp: new Date().toISOString() });
}
/**
 * Create mock Windows Defender status
 */
function createMockDefenderStatus(scenario = 'healthy') {
    const scenarios = {
        healthy: {
            antivirusEnabled: true,
            antispywareEnabled: true,
            realTimeProtectionEnabled: true,
            antivirusSignatureLastUpdated: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
            antivirusSignatureVersion: '1.375.123.0',
            threatsDetected: 0,
            threatsQuarantined: 0,
            lastQuickScanTime: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
            lastFullScanTime: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
            overallStatus: 'PASSED'
        },
        disabled: {
            antivirusEnabled: false,
            antispywareEnabled: false,
            realTimeProtectionEnabled: false,
            antivirusSignatureLastUpdated: new Date(Date.now() - 86400000 * 30).toISOString(), // 30 days ago
            antivirusSignatureVersion: '1.365.100.0',
            threatsDetected: 0,
            threatsQuarantined: 0,
            lastQuickScanTime: null,
            lastFullScanTime: null,
            overallStatus: 'FAILED'
        },
        threats: {
            antivirusEnabled: true,
            antispywareEnabled: true,
            realTimeProtectionEnabled: true,
            antivirusSignatureLastUpdated: new Date(Date.now() - 3600000).toISOString(),
            antivirusSignatureVersion: '1.375.123.0',
            threatsDetected: 3,
            threatsQuarantined: 2,
            lastQuickScanTime: new Date(Date.now() - 86400000).toISOString(),
            lastFullScanTime: new Date(Date.now() - 86400000 * 7).toISOString(),
            overallStatus: 'WARNING'
        },
        outdated: {
            antivirusEnabled: true,
            antispywareEnabled: true,
            realTimeProtectionEnabled: true,
            antivirusSignatureLastUpdated: new Date(Date.now() - 86400000 * 10).toISOString(), // 10 days ago
            antivirusSignatureVersion: '1.365.100.0',
            threatsDetected: 0,
            threatsQuarantined: 0,
            lastQuickScanTime: new Date(Date.now() - 86400000 * 5).toISOString(),
            lastFullScanTime: new Date(Date.now() - 86400000 * 15).toISOString(),
            overallStatus: 'WARNING'
        }
    };
    return Object.assign(Object.assign({}, scenarios[scenario]), { success: true, timestamp: new Date().toISOString() });
}
/**
 * Create mock application inventory for testing
 */
function createMockApplicationInventory() {
    return {
        applications: [
            {
                name: 'Microsoft Office 365',
                version: '16.0.14326.20454',
                publisher: 'Microsoft Corporation',
                installDate: '2023-01-15T00:00:00Z',
                installLocation: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\',
                sizeInMB: 2048.5
            },
            {
                name: 'Google Chrome',
                version: '118.0.5993.88',
                publisher: 'Google LLC',
                installDate: '2023-02-01T00:00:00Z',
                installLocation: 'C:\\Program Files\\Google\\Chrome\\Application\\',
                sizeInMB: 245.8
            },
            {
                name: 'Adobe Reader DC',
                version: '23.006.20320',
                publisher: 'Adobe Inc.',
                installDate: '2023-03-10T00:00:00Z',
                installLocation: 'C:\\Program Files\\Adobe\\Acrobat DC\\',
                sizeInMB: 756.2
            },
            {
                name: 'Visual Studio Code',
                version: '1.83.1',
                publisher: 'Microsoft Corporation',
                installDate: '2023-10-01T00:00:00Z',
                installLocation: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Microsoft VS Code\\',
                sizeInMB: 312.4
            }
        ],
        totalCount: 4,
        success: true,
        timestamp: new Date().toISOString()
    };
}
/**
 * Test utility functions for recommendation validation
 */
class RecommendationTestUtils {
    /**
     * Assert that a recommendation has the expected type and structure
     */
    static assertRecommendationType(recommendation, expectedType) {
        expect(recommendation).toHaveProperty('type', expectedType);
        expect(recommendation).toHaveProperty('text');
        expect(recommendation).toHaveProperty('actionText');
        expect(recommendation).toHaveProperty('machineId');
        // createdAt is set by the database, may not be present in raw data passed to createMany
        expect(typeof recommendation.text).toBe('string');
        expect(typeof recommendation.actionText).toBe('string');
        expect(recommendation.text.length).toBeGreaterThan(0);
        expect(recommendation.actionText.length).toBeGreaterThan(0);
    }
    /**
     * Assert that recommendation data contains expected fields
     */
    static assertRecommendationData(recommendation, expectedDataKeys) {
        expect(recommendation).toHaveProperty('data');
        expect(recommendation.data).toBeTruthy();
        for (const key of expectedDataKeys) {
            expect(recommendation.data).toHaveProperty(key);
        }
    }
    /**
     * Create a complete test scenario with related data
     */
    static createRecommendationTestScenario(scenarioName) {
        const machineId = (0, crypto_1.randomBytes)(12).toString('hex');
        const snapshotId = (0, crypto_1.randomBytes)(12).toString('hex');
        const scenarios = {
            diskSpaceCritical: {
                machine: { id: machineId, name: 'test-vm-1' },
                healthSnapshot: createMockHealthSnapshot({
                    id: snapshotId,
                    machineId,
                    diskSpaceInfo: createMockDiskSpaceInfo('critical')
                }),
                expectedRecommendations: [
                    { type: client_1.RecommendationType.DISK_SPACE_LOW, dataKeys: ['drive', 'usedPercent', 'freeGB'] }
                ]
            },
            resourceOverProvisioned: {
                machine: { id: machineId, name: 'test-vm-2' },
                healthSnapshot: createMockHealthSnapshot({
                    id: snapshotId,
                    machineId,
                    resourceOptInfo: createMockResourceOptInfo('over_provisioned')
                }),
                expectedRecommendations: [
                    { type: client_1.RecommendationType.OVER_PROVISIONED, dataKeys: ['resource', 'currentValue', 'recommendedValue'] }
                ]
            },
            securityUpdates: {
                machine: { id: machineId, name: 'test-vm-3' },
                healthSnapshot: createMockHealthSnapshot({
                    id: snapshotId,
                    machineId,
                    windowsUpdateInfo: createMockWindowsUpdateInfo('critical_updates')
                }),
                expectedRecommendations: [
                    { type: client_1.RecommendationType.OS_UPDATE_AVAILABLE, dataKeys: ['criticalCount', 'securityCount'] }
                ]
            },
            defenderDisabled: {
                machine: { id: machineId, name: 'test-vm-4' },
                healthSnapshot: createMockHealthSnapshot({
                    id: snapshotId,
                    machineId,
                    defenderStatus: createMockDefenderStatus('disabled')
                }),
                expectedRecommendations: [
                    { type: client_1.RecommendationType.DEFENDER_DISABLED, dataKeys: ['antivirusEnabled', 'realTimeProtectionEnabled'] }
                ]
            }
        };
        return scenarios[scenarioName] || scenarios.diskSpaceCritical;
    }
}
exports.RecommendationTestUtils = RecommendationTestUtils;
/**
 * GraphQL test queries for recommendation testing
 */
exports.RECOMMENDATION_TEST_QUERIES = {
    GET_VM_RECOMMENDATIONS: `
    query GetVMRecommendations($vmId: ID!, $refresh: Boolean, $filter: RecommendationFilterInput) {
      getVMRecommendations(vmId: $vmId, refresh: $refresh, filter: $filter) {
        id
        machineId
        snapshotId
        type
        text
        actionText
        data
        createdAt
      }
    }
  `,
    GET_VM_RECOMMENDATIONS_WITH_FILTER: `
    query GetVMRecommendationsFiltered($vmId: ID!, $types: [RecommendationType!]) {
      getVMRecommendations(vmId: $vmId, filter: { types: $types }) {
        id
        type
        text
        actionText
        createdAt
      }
    }
  `,
    GET_VM_RECOMMENDATIONS_WITH_LIMIT: `
    query GetVMRecommendationsLimited($vmId: ID!, $limit: Float) {
      getVMRecommendations(vmId: $vmId, filter: { limit: $limit }) {
        id
        type
        text
        createdAt
      }
    }
  `
};
/**
 * Performance measurement utilities for recommendation testing
 */
class RecommendationPerformanceUtils {
    /**
     * Measure execution time of recommendation generation
     */
    static measureRecommendationGenerationTime(operation) {
        return __awaiter(this, void 0, void 0, function* () {
            const startTime = process.hrtime.bigint();
            const result = yield operation();
            const endTime = process.hrtime.bigint();
            const executionTimeMs = Number(endTime - startTime) / 1000000;
            return { result, executionTimeMs };
        });
    }
    /**
     * Generate large dataset for performance testing
     */
    static createLargeDatasetScenario(vmCount = 100, recommendationsPerVm = 10) {
        const vms = [];
        const recommendations = [];
        for (let i = 0; i < vmCount; i++) {
            const machineId = (0, crypto_1.randomBytes)(12).toString('hex');
            vms.push({ id: machineId, name: `test-vm-${i}` });
            for (let j = 0; j < recommendationsPerVm; j++) {
                recommendations.push(createMockVMRecommendation({
                    machineId,
                    type: Object.values(client_1.RecommendationType)[j % Object.values(client_1.RecommendationType).length]
                }));
            }
        }
        return { vms, recommendations };
    }
}
exports.RecommendationPerformanceUtils = RecommendationPerformanceUtils;
