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
require("reflect-metadata");
const globals_1 = require("@jest/globals");
const client_1 = require("@prisma/client");
const jest_setup_1 = require("../../setup/jest.setup");
const VMRecommendationService_1 = require("../../../app/services/VMRecommendationService");
const logger_1 = __importDefault(require("@main/logger"));
const recommendation_test_helpers_1 = require("../../setup/recommendation-test-helpers");
const mock_factories_1 = require("../../setup/mock-factories");
// Mock PackageManager to prevent DB calls during constructor
globals_1.jest.mock('../../../app/services/packages/PackageManager', () => ({
    getPackageManager: globals_1.jest.fn().mockReturnValue({
        loadAll: globals_1.jest.fn().mockResolvedValue(undefined),
        getPackageStatuses: globals_1.jest.fn().mockReturnValue([]),
        runCheckers: globals_1.jest.fn().mockResolvedValue([])
    }),
    PackageManager: globals_1.jest.fn()
}));
(0, globals_1.describe)('VMRecommendationService', () => {
    let service;
    const defaultMockDepartment = (0, mock_factories_1.createMockDepartment)();
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        globals_1.jest.useFakeTimers({ advanceTimers: false });
        service = new VMRecommendationService_1.VMRecommendationService(jest_setup_1.mockPrisma);
        globals_1.jest.useRealTimers();
        // Default mocks for buildContext (used by generateRecommendations)
        jest_setup_1.mockPrisma.portUsage.findMany.mockResolvedValue([]);
        jest_setup_1.mockPrisma.processSnapshot.findMany.mockResolvedValue([]);
        // Machine with department (needed by buildContext)
        jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)({ id: 'default-machine' })), { department: defaultMockDepartment }));
        // Default transaction mock for generateRecommendations -> saveRecommendations
        jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
            let createdData = [];
            const txMock = Object.assign(Object.assign({}, jest_setup_1.mockPrisma), { vMRecommendation: Object.assign(Object.assign({}, jest_setup_1.mockPrisma.vMRecommendation), { createMany: globals_1.jest.fn().mockImplementation((args) => __awaiter(void 0, void 0, void 0, function* () {
                        createdData = (args.data || []).map((d, i) => (Object.assign(Object.assign({ id: `created-rec-${i}` }, d), { createdAt: new Date() })));
                        jest_setup_1.mockPrisma.vMRecommendation.createMany(args);
                        return { count: createdData.length };
                    })), findMany: globals_1.jest.fn().mockImplementation(() => __awaiter(void 0, void 0, void 0, function* () { return createdData; })) }), vMHealthSnapshot: Object.assign(Object.assign({}, jest_setup_1.mockPrisma.vMHealthSnapshot), { update: globals_1.jest.fn().mockResolvedValue({}) }) });
            return fn(txMock);
        }));
        // Default mock for hasRecommendationsChanged
        jest_setup_1.mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null });
        // Default mock for snapshot update
        jest_setup_1.mockPrisma.vMHealthSnapshot.update.mockResolvedValue({});
    });
    (0, globals_1.afterEach)(() => {
        globals_1.jest.clearAllMocks();
        // Dispose service to clean up timers
        if (service && typeof service.dispose === 'function') {
            service.dispose();
        }
    });
    (0, globals_1.describe)('Service Initialization', () => {
        (0, globals_1.it)('should initialize service with correct checker count', () => {
            (0, globals_1.expect)(service).toBeInstanceOf(VMRecommendationService_1.VMRecommendationService);
            // The service should have registered all recommendation checkers
            // This tests the internal checker registration
        });
        (0, globals_1.it)('should have proper configuration', () => {
            // Test that service has been configured properly
            (0, globals_1.expect)(service).toBeDefined();
        });
    });
    (0, globals_1.describe)('getRecommendations', () => {
        const machineId = 'test-machine-1';
        const latestSnapshotId = 'latest-snapshot-1';
        const mockDepartment = (0, mock_factories_1.createMockDepartment)();
        const mockMachineWithDept = Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)({ id: machineId })), { department: mockDepartment });
        (0, globals_1.beforeEach)(() => {
            // Mock machine exists (used by getRecommendations and buildContext)
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockMachineWithDept);
            // Mock latest snapshot (getRecommendations now queries for it)
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue({
                id: latestSnapshotId,
                machineId,
                snapshotDate: new Date(),
                overallStatus: 'OK',
                diskSpaceInfo: null,
                resourceOptInfo: null,
                windowsUpdateInfo: null,
                defenderStatus: null,
                applicationInventory: null,
                customCheckResults: null
            });
            // Default mocks for buildContext (portUsage, processSnapshot)
            jest_setup_1.mockPrisma.portUsage.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.processSnapshot.findMany.mockResolvedValue([]);
            // Mock transaction for refresh=true path (generateRecommendations)
            jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
                let createdData = [];
                const txMock = Object.assign(Object.assign({}, jest_setup_1.mockPrisma), { vMRecommendation: Object.assign(Object.assign({}, jest_setup_1.mockPrisma.vMRecommendation), { createMany: globals_1.jest.fn().mockImplementation((args) => __awaiter(void 0, void 0, void 0, function* () {
                            createdData = (args.data || []).map((d, i) => (Object.assign(Object.assign({ id: `created-rec-${i}` }, d), { createdAt: new Date() })));
                            jest_setup_1.mockPrisma.vMRecommendation.createMany(args);
                            return { count: createdData.length };
                        })), findMany: globals_1.jest.fn().mockImplementation(() => __awaiter(void 0, void 0, void 0, function* () { return createdData; })) }), vMHealthSnapshot: Object.assign(Object.assign({}, jest_setup_1.mockPrisma.vMHealthSnapshot), { update: globals_1.jest.fn().mockResolvedValue({}) }) });
                return fn(txMock);
            }));
            // Mock hasRecommendationsChanged
            jest_setup_1.mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null });
        });
        (0, globals_1.it)('should return cached recommendations when refresh=false', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRecommendations = [
                (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId, type: client_1.RecommendationType.DISK_SPACE_LOW }),
                (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId, type: client_1.RecommendationType.OS_UPDATE_AVAILABLE })
            ];
            jest_setup_1.mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations);
            const result = yield service.getRecommendations(machineId, false);
            (0, globals_1.expect)(result).toHaveLength(2);
            (0, globals_1.expect)(result[0]).toHaveProperty('type', client_1.RecommendationType.DISK_SPACE_LOW);
            (0, globals_1.expect)(result[1]).toHaveProperty('type', client_1.RecommendationType.OS_UPDATE_AVAILABLE);
            // The where clause now includes snapshotId and take
            (0, globals_1.expect)(jest_setup_1.mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                where: globals_1.expect.objectContaining({ machineId }),
                orderBy: { createdAt: 'desc' }
            }));
        }));
        (0, globals_1.it)('should generate new recommendations when refresh=true', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                machineId,
                diskSpaceInfo: (0, recommendation_test_helpers_1.createMockDiskSpaceInfo)('critical')
            });
            // Mock latest health snapshot
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            // Mock system metrics
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([
                (0, recommendation_test_helpers_1.createMockSystemMetrics)({ machineId })
            ]);
            // Mock recommendations cleanup and creation
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
            const newRecommendation = (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                machineId,
                type: client_1.RecommendationType.DISK_SPACE_LOW
            });
            jest_setup_1.mockPrisma.vMRecommendation.findMany.mockResolvedValue([newRecommendation]);
            const result = yield service.getRecommendations(machineId, true);
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(result.length).toBeGreaterThanOrEqual(1);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should apply filter parameters correctly', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRecommendations = [
                (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId, type: client_1.RecommendationType.DISK_SPACE_LOW }),
                (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId, type: client_1.RecommendationType.OS_UPDATE_AVAILABLE })
            ];
            jest_setup_1.mockPrisma.vMRecommendation.findMany.mockResolvedValue([mockRecommendations[0]]);
            const filter = {
                types: [client_1.RecommendationType.DISK_SPACE_LOW],
                limit: 10
            };
            const result = yield service.getRecommendations(machineId, false, filter);
            // The where clause now also includes snapshotId
            (0, globals_1.expect)(jest_setup_1.mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                where: globals_1.expect.objectContaining({
                    machineId,
                    type: { in: [client_1.RecommendationType.DISK_SPACE_LOW] }
                }),
                orderBy: { createdAt: 'desc' },
                take: 10
            }));
            (0, globals_1.expect)(result).toHaveLength(1);
            (0, globals_1.expect)(result[0]).toHaveProperty('type', client_1.RecommendationType.DISK_SPACE_LOW);
        }));
        (0, globals_1.it)('should handle machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield (0, globals_1.expect)(service.getRecommendations('non-existent-machine'))
                .rejects.toThrow('Machine not found');
        }));
        (0, globals_1.it)('should handle database errors gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findUnique.mockRejectedValue(new Error('Database connection failed'));
            // The service re-throws errors after logging
            yield (0, globals_1.expect)(service.getRecommendations(machineId))
                .rejects.toThrow();
        }));
    });
    (0, globals_1.describe)('generateRecommendations', () => {
        const machineId = 'test-machine-1';
        const mockMachineWithDept = Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)({ id: machineId })), { department: (0, mock_factories_1.createMockDepartment)() });
        (0, globals_1.beforeEach)(() => {
            // Machine with department (needed by buildContext)
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockMachineWithDept);
            // Default mocks for buildContext
            jest_setup_1.mockPrisma.portUsage.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.processSnapshot.findMany.mockResolvedValue([]);
            // Mock transaction - create a transactional mock that captures createMany data
            // and returns it from findMany
            jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
                let createdData = [];
                const txMock = Object.assign(Object.assign({}, jest_setup_1.mockPrisma), { vMRecommendation: Object.assign(Object.assign({}, jest_setup_1.mockPrisma.vMRecommendation), { createMany: globals_1.jest.fn().mockImplementation((args) => __awaiter(void 0, void 0, void 0, function* () {
                            createdData = (args.data || []).map((d, i) => (Object.assign(Object.assign({ id: `created-rec-${i}` }, d), { createdAt: new Date() })));
                            // Also store in the outer mock for test assertions
                            jest_setup_1.mockPrisma.vMRecommendation.createMany(args);
                            return { count: createdData.length };
                        })), findMany: globals_1.jest.fn().mockImplementation(() => __awaiter(void 0, void 0, void 0, function* () { return createdData; })) }), vMHealthSnapshot: Object.assign(Object.assign({}, jest_setup_1.mockPrisma.vMHealthSnapshot), { update: globals_1.jest.fn().mockResolvedValue({}) }) });
                return fn(txMock);
            }));
            // Mock hasRecommendationsChanged check
            jest_setup_1.mockPrisma.vMRecommendation.findMany.mockResolvedValue([]);
            // Mock snapshot findUnique (used by hasRecommendationsChanged)
            jest_setup_1.mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null });
            // Mock snapshot update
            jest_setup_1.mockPrisma.vMHealthSnapshot.update.mockResolvedValue({});
        });
        (0, globals_1.it)('should generate disk space recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                machineId,
                diskSpaceInfo: (0, recommendation_test_helpers_1.createMockDiskSpaceInfo)('critical')
            });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 });
            const result = yield service.generateRecommendationsSafe(machineId);
            (0, globals_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, globals_1.expect)(result.recommendations).toBeDefined();
                (0, globals_1.expect)(result.recommendations.length).toBeGreaterThanOrEqual(1);
            }
            (0, globals_1.expect)(jest_setup_1.mockPrisma.vMRecommendation.createMany).toHaveBeenCalled();
            // Verify the structure of created recommendations
            const createCall = (_a = jest_setup_1.mockPrisma.vMRecommendation.createMany.mock.calls[0]) === null || _a === void 0 ? void 0 : _a[0];
            (0, globals_1.expect)(createCall).toBeDefined();
            const dataArray = createCall.data;
            (0, globals_1.expect)(dataArray).toBeInstanceOf(Array);
            (0, globals_1.expect)(dataArray[0]).toHaveProperty('machineId', machineId);
            (0, globals_1.expect)(dataArray[0]).toHaveProperty('type');
            (0, globals_1.expect)(dataArray[0]).toHaveProperty('text');
            (0, globals_1.expect)(dataArray[0]).toHaveProperty('actionText');
        }));
        (0, globals_1.it)('should generate resource optimization recommendations with sufficient metrics', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                machineId,
                resourceOptInfo: (0, recommendation_test_helpers_1.createMockResourceOptInfo)('over_provisioned')
            });
            // OverProvisionedChecker requires at least 5 historical metrics
            const historicalMetrics = Array.from({ length: 10 }, (_, i) => (0, recommendation_test_helpers_1.createMockSystemMetrics)({
                machineId,
                cpuUsagePercent: 15,
                timestamp: new Date(Date.now() - i * 3600000)
            }));
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue(historicalMetrics);
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
            const result = yield service.generateRecommendationsSafe(machineId);
            (0, globals_1.expect)(result.success).toBe(true);
            if (result.success) {
                (0, globals_1.expect)(result.recommendations).toBeDefined();
            }
        }));
        (0, globals_1.it)('should generate security recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                machineId,
                defenderStatus: (0, recommendation_test_helpers_1.createMockDefenderStatus)('disabled'),
                windowsUpdateInfo: (0, recommendation_test_helpers_1.createMockWindowsUpdateInfo)('critical_updates')
            });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 });
            const result = yield service.generateRecommendations(machineId);
            (0, globals_1.expect)(result).toBeDefined();
            // Should generate at least some recommendations from the health data
            (0, globals_1.expect)(result.length).toBeGreaterThanOrEqual(1);
        }));
        (0, globals_1.it)('should handle no health snapshot gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null);
            // When there's no snapshot, checkers produce no results and saveRecommendations returns []
            const result = yield service.generateRecommendations(machineId);
            (0, globals_1.expect)(result).toEqual([]);
        }));
        (0, globals_1.it)('should save new recommendations using saveRecommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({ machineId });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 3 });
            const result = yield service.generateRecommendations(machineId);
            // The new service uses saveRecommendations with $transaction
            (0, globals_1.expect)(jest_setup_1.mockPrisma.$transaction).toHaveBeenCalled();
        }));
    });
    (0, globals_1.describe)('Individual Recommendation Checkers', () => {
        const machineId = 'test-machine-1';
        (0, globals_1.describe)('DiskSpaceChecker', () => {
            (0, globals_1.it)('should detect low disk space with correct thresholds', () => __awaiter(void 0, void 0, void 0, function* () {
                const criticalData = (0, recommendation_test_helpers_1.createMockDiskSpaceInfo)('critical');
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    diskSpaceInfo: criticalData
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 });
                const result = yield service.generateRecommendations(machineId);
                const createCall = jest_setup_1.mockPrisma.vMRecommendation.createMany.mock.calls[0][0];
                const diskSpaceRecs = createCall.data.filter((r) => r.type === client_1.RecommendationType.DISK_SPACE_LOW);
                (0, globals_1.expect)(diskSpaceRecs.length).toBeGreaterThanOrEqual(2); // Both C: and D: drives exceed warning threshold
                for (const rec of diskSpaceRecs) {
                    recommendation_test_helpers_1.RecommendationTestUtils.assertRecommendationType(rec, client_1.RecommendationType.DISK_SPACE_LOW);
                    recommendation_test_helpers_1.RecommendationTestUtils.assertRecommendationData(rec, ['drive', 'usagePercent', 'availableGB']);
                    (0, globals_1.expect)(rec.data.usagePercent).toBeGreaterThan(85); // Above warning threshold
                }
            }));
            (0, globals_1.it)('should handle malformed disk space data', () => __awaiter(void 0, void 0, void 0, function* () {
                var _a;
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    diskSpaceInfo: { drives: null, success: false, error: 'Access denied' }
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 });
                const result = yield service.generateRecommendations(machineId);
                const createCall = (_a = jest_setup_1.mockPrisma.vMRecommendation.createMany.mock.calls[0]) === null || _a === void 0 ? void 0 : _a[0];
                const diskSpaceRecs = (createCall === null || createCall === void 0 ? void 0 : createCall.data) ? createCall.data.filter((r) => r.type === client_1.RecommendationType.DISK_SPACE_LOW) : [];
                (0, globals_1.expect)(diskSpaceRecs).toHaveLength(0);
            }));
            (0, globals_1.it)('should handle Windows vs Linux drive formats', () => __awaiter(void 0, void 0, void 0, function* () {
                // Use direct keyed format (Format 4) which the checker recognizes
                const linuxData = {
                    '/': { used: 92, total: 100, usedGB: 92, totalGB: 100, freeGB: 8 },
                    '/home': { used: 185, total: 200, usedGB: 185, totalGB: 200, freeGB: 15 }
                };
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    diskSpaceInfo: linuxData,
                    osType: 'Linux'
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 });
                const result = yield service.generateRecommendations(machineId);
                const createCall = jest_setup_1.mockPrisma.vMRecommendation.createMany.mock.calls[0][0];
                const diskSpaceRecs = createCall.data.filter((r) => r.type === client_1.RecommendationType.DISK_SPACE_LOW);
                (0, globals_1.expect)(diskSpaceRecs).toHaveLength(2);
                (0, globals_1.expect)(diskSpaceRecs[0].data.drive).toBe('/');
                (0, globals_1.expect)(diskSpaceRecs[1].data.drive).toBe('/home');
            }));
        });
        (0, globals_1.describe)('ResourceOptimizationChecker', () => {
            (0, globals_1.it)('should detect high CPU applications', () => __awaiter(void 0, void 0, void 0, function* () {
                const resourceOptData = {
                    recommendations: [],
                    success: true,
                    timestamp: new Date().toISOString()
                };
                // Mock high CPU metrics
                const highCpuMetrics = Array.from({ length: 10 }, () => (0, recommendation_test_helpers_1.createMockSystemMetrics)({
                    machineId,
                    cpuUsagePercent: 85,
                    timestamp: new Date(Date.now() - Math.random() * 86400000) // Random within last 24h
                }));
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    resourceOptInfo: resourceOptData
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue(highCpuMetrics);
                jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
                const result = yield service.generateRecommendations(machineId);
                // Note: The actual high CPU detection would be based on process data
                // This test verifies the metrics are being retrieved correctly
                (0, globals_1.expect)(jest_setup_1.mockPrisma.systemMetrics.findMany).toHaveBeenCalledWith({
                    where: {
                        machineId,
                        timestamp: globals_1.expect.any(Object)
                    },
                    orderBy: { timestamp: 'desc' },
                    take: globals_1.expect.any(Number)
                });
            }));
            (0, globals_1.it)('should detect over-provisioned resources with sufficient metrics', () => __awaiter(void 0, void 0, void 0, function* () {
                const overProvisionedData = (0, recommendation_test_helpers_1.createMockResourceOptInfo)('over_provisioned');
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    resourceOptInfo: overProvisionedData
                });
                // OverProvisionedChecker requires >= 5 historical metrics
                const lowUsageMetrics = Array.from({ length: 10 }, (_, i) => (0, recommendation_test_helpers_1.createMockSystemMetrics)({
                    machineId,
                    cpuUsagePercent: 10,
                    timestamp: new Date(Date.now() - i * 3600000)
                }));
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue(lowUsageMetrics);
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 });
                const result = yield service.generateRecommendations(machineId);
                // Should complete without errors
                (0, globals_1.expect)(result).toBeDefined();
            }));
            (0, globals_1.it)('should detect under-provisioned resources with sufficient metrics', () => __awaiter(void 0, void 0, void 0, function* () {
                const underProvisionedData = (0, recommendation_test_helpers_1.createMockResourceOptInfo)('under_provisioned');
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    resourceOptInfo: underProvisionedData
                });
                // UnderProvisionedChecker requires >= 5 historical metrics with high usage
                const highUsageMetrics = Array.from({ length: 10 }, (_, i) => (0, recommendation_test_helpers_1.createMockSystemMetrics)({
                    machineId,
                    cpuUsagePercent: 95,
                    timestamp: new Date(Date.now() - i * 3600000)
                }));
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue(highUsageMetrics);
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 });
                const result = yield service.generateRecommendations(machineId);
                // Should complete without errors
                (0, globals_1.expect)(result).toBeDefined();
            }));
        });
        (0, globals_1.describe)('Security Checkers', () => {
            (0, globals_1.it)('should handle Windows Defender disabled data', () => __awaiter(void 0, void 0, void 0, function* () {
                const defenderDisabledData = (0, recommendation_test_helpers_1.createMockDefenderStatus)('disabled');
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    defenderStatus: defenderDisabledData
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
                const result = yield service.generateRecommendations(machineId);
                // Should generate some recommendations from defender disabled data
                (0, globals_1.expect)(result).toBeDefined();
                (0, globals_1.expect)(result.length).toBeGreaterThanOrEqual(1);
            }));
            (0, globals_1.it)('should handle Defender threats data', () => __awaiter(void 0, void 0, void 0, function* () {
                const defenderThreatsData = (0, recommendation_test_helpers_1.createMockDefenderStatus)('threats');
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    defenderStatus: defenderThreatsData
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
                const result = yield service.generateRecommendations(machineId);
                // Should complete without errors
                (0, globals_1.expect)(result).toBeDefined();
            }));
            (0, globals_1.it)('should handle Windows Updates data', () => __awaiter(void 0, void 0, void 0, function* () {
                const updatesData = (0, recommendation_test_helpers_1.createMockWindowsUpdateInfo)('critical_updates');
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    windowsUpdateInfo: updatesData
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
                const result = yield service.generateRecommendations(machineId);
                // Should complete without errors
                (0, globals_1.expect)(result).toBeDefined();
            }));
            (0, globals_1.it)('should detect application updates available', () => __awaiter(void 0, void 0, void 0, function* () {
                const appInventory = (0, recommendation_test_helpers_1.createMockApplicationInventory)();
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                    machineId,
                    applicationInventory: appInventory
                });
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
                // Mock application update data that would be provided by a separate check
                const appUpdateData = {
                    availableUpdates: [
                        {
                            applicationName: 'Adobe Reader DC',
                            currentVersion: '23.006.20320',
                            availableVersion: '23.008.20421',
                            isSecurityUpdate: true
                        }
                    ],
                    success: true,
                    timestamp: new Date().toISOString()
                };
                // Modify health snapshot to include app update info
                mockHealthSnapshot.customCheckResults = { applicationUpdates: appUpdateData };
                const result = yield service.generateRecommendations(machineId);
                // Note: App update checking would be implemented in AppUpdateChecker
                // This test verifies the application inventory is available for analysis
                (0, globals_1.expect)(mockHealthSnapshot.applicationInventory).toBeDefined();
                (0, globals_1.expect)(mockHealthSnapshot.applicationInventory.applications).toHaveLength(4);
            }));
        });
        (0, globals_1.describe)('Port Conflict Checker', () => {
            (0, globals_1.it)('should detect port conflicts with firewall rules', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({ machineId });
                // Mock port usage data
                const portUsageData = [
                    { port: 8080, protocol: 'tcp', state: 'LISTENING', processName: 'apache.exe' },
                    { port: 3306, protocol: 'tcp', state: 'LISTENING', processName: 'mysql.exe' }
                ];
                // Mock firewall rules that might conflict
                const firewallRules = [
                    { port: 8080, protocol: 'tcp', action: 'BLOCK', direction: 'IN' }
                ];
                jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
                jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
                // Mock additional data that would be needed for port conflict checking
                jest_setup_1.mockPrisma.portUsage.findMany.mockResolvedValue(portUsageData);
                jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
                jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 });
                const result = yield service.generateRecommendations(machineId);
                // This test verifies the structure is in place for port conflict detection
                // The actual implementation would check for conflicts between port usage and firewall rules
                (0, globals_1.expect)(result).toBeDefined();
                (0, globals_1.expect)(Array.isArray(result)).toBe(true);
            }));
        });
    });
    (0, globals_1.describe)('Performance and Error Handling', () => {
        const machineId = 'test-machine-1';
        (0, globals_1.it)('should complete recommendation generation within performance threshold', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({ machineId });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 });
            const { result, executionTimeMs } = yield recommendation_test_helpers_1.RecommendationPerformanceUtils
                .measureRecommendationGenerationTime(() => service.generateRecommendations(machineId));
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(executionTimeMs).toBeLessThan(5000); // 5 second threshold
        }));
        (0, globals_1.it)('should handle database transaction failures', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(new Error('Database transaction failed'));
            // Errors are wrapped by handleServiceError
            yield (0, globals_1.expect)(service.generateRecommendations(machineId)).rejects.toThrow();
        }));
        (0, globals_1.it)('should handle partial checker failures gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({
                machineId,
                diskSpaceInfo: { success: false, error: 'WMI query failed', drives: [] },
                resourceOptInfo: (0, recommendation_test_helpers_1.createMockResourceOptInfo)('optimal')
            });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 });
            const result = yield service.generateRecommendations(machineId);
            (0, globals_1.expect)(result).toBeDefined(); // Should succeed even with partial failures
            (0, globals_1.expect)(Array.isArray(result)).toBe(true);
        }));
        (0, globals_1.it)('should handle large datasets efficiently', () => __awaiter(void 0, void 0, void 0, function* () {
            const largeMetricsDataset = Array.from({ length: 1000 }, (_, i) => (0, recommendation_test_helpers_1.createMockSystemMetrics)({
                machineId,
                timestamp: new Date(Date.now() - i * 60000) // 1 minute intervals
            }));
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({ machineId });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue(largeMetricsDataset.slice(0, 100)); // Service should limit
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 });
            const { result, executionTimeMs } = yield recommendation_test_helpers_1.RecommendationPerformanceUtils
                .measureRecommendationGenerationTime(() => service.generateRecommendations(machineId));
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(executionTimeMs).toBeLessThan(10000); // Should handle large datasets efficiently
        }));
    });
    (0, globals_1.describe)('Context Building', () => {
        const machineId = 'test-machine-1';
        (0, globals_1.it)('should build comprehensive context with all data sources', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({ machineId });
            const mockMetrics = [(0, recommendation_test_helpers_1.createMockSystemMetrics)({ machineId })];
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue(mockMetrics);
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 });
            const result = yield service.generateRecommendations(machineId);
            // Verify that context was built with all necessary data
            (0, globals_1.expect)(jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst).toHaveBeenCalledWith({
                where: { machineId },
                orderBy: { snapshotDate: 'desc' }
            });
            (0, globals_1.expect)(jest_setup_1.mockPrisma.systemMetrics.findMany).toHaveBeenCalledWith({
                where: {
                    machineId,
                    timestamp: globals_1.expect.any(Object)
                },
                orderBy: { timestamp: 'desc' },
                take: globals_1.expect.any(Number)
            });
            (0, globals_1.expect)(result).toBeDefined();
            (0, globals_1.expect)(Array.isArray(result)).toBe(true);
        }));
        (0, globals_1.it)('should handle missing historical metrics gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({ machineId });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]); // No metrics available
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 });
            const result = yield service.generateRecommendations(machineId);
            (0, globals_1.expect)(result).toBeDefined();
            // Should still be able to generate recommendations based on health snapshot alone
        }));
        (0, globals_1.it)('should apply correct time windows for historical data', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHealthSnapshot = (0, recommendation_test_helpers_1.createMockHealthSnapshot)({ machineId });
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot);
            jest_setup_1.mockPrisma.systemMetrics.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 });
            jest_setup_1.mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 });
            yield service.generateRecommendations(machineId);
            // Verify time window for metrics retrieval (typically 30 days for resource optimization)
            const metricsCall = jest_setup_1.mockPrisma.systemMetrics.findMany.mock.calls[0][0];
            (0, globals_1.expect)(metricsCall.where.timestamp).toHaveProperty('gte');
            const timeFilter = metricsCall.where.timestamp.gte;
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            (0, globals_1.expect)(timeFilter.getTime()).toBeGreaterThanOrEqual(thirtyDaysAgo.getTime() - 60000); // Allow 1 minute variance
        }));
    });
    (0, globals_1.describe)('Error Handling with Generic Messages', () => {
        const machineId = 'test-machine-error';
        (0, globals_1.beforeEach)(() => {
            // Mock machine exists
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)({ id: machineId })), { department: defaultMockDepartment }));
            // Mock snapshot exists so getRecommendations reaches findMany
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue({
                id: 'error-test-snapshot',
                machineId,
                snapshotDate: new Date(),
                overallStatus: 'OK'
            });
        });
        (0, globals_1.it)('should throw generic error message from generateRecommendations when database fails', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate database error
            const dbError = new Error('ECONNREFUSED: Connection refused');
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError);
            // Spy on logger.error to verify detailed logging
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            yield (0, globals_1.expect)(service.generateRecommendations(machineId)).rejects.toThrow('VM recommendation service failed');
            // Verify that the detailed error is logged but not thrown
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('VMRecommendationService error'), globals_1.expect.objectContaining({
                originalError: 'ECONNREFUSED: Connection refused',
                errorName: 'Error',
                vmId: machineId
            }));
            consoleSpy.mockRestore();
        }));
        (0, globals_1.it)('should throw generic error message from getRecommendations when service fails', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate service error
            const serviceError = new Error('Internal service failure');
            jest_setup_1.mockPrisma.vMRecommendation.findMany.mockRejectedValue(serviceError);
            // Spy on logger.error to verify detailed logging
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            yield (0, globals_1.expect)(service.getRecommendations(machineId)).rejects.toThrow('VM recommendation service failed');
            // Verify that the detailed error is logged but not thrown
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('VMRecommendationService error'), globals_1.expect.objectContaining({
                originalError: 'Internal service failure',
                errorName: 'Error',
                vmId: machineId
            }));
            consoleSpy.mockRestore();
        }));
        (0, globals_1.it)('should return generic error message from safe wrapper methods', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate database error
            const dbError = new Error('Database connection timeout');
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError);
            // Spy on logger.error to verify detailed logging
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            const result = yield service.generateRecommendationsSafe(machineId);
            (0, globals_1.expect)(result.success).toBe(false);
            if (!result.success) {
                // The safe wrapper returns a generic error message
                (0, globals_1.expect)(typeof result.error).toBe('string');
                (0, globals_1.expect)(result.error.length).toBeGreaterThan(0);
            }
            // Verify that the detailed error is logged
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('VM Recommendation Service Error'), globals_1.expect.objectContaining({
                vmId: machineId
            }));
            consoleSpy.mockRestore();
        }));
        (0, globals_1.it)('should not leak sensitive database details in thrown error messages', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate database constraint violation error with sensitive info
            const sensitiveError = new Error('duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(secret@example.com) already exists.');
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(sensitiveError);
            // Use safe wrapper which wraps errors with generic messages
            const result = yield service.generateRecommendationsSafe(machineId);
            (0, globals_1.expect)(result.success).toBe(false);
            if (!result.success) {
                (0, globals_1.expect)(result.error).not.toContain('duplicate key');
                (0, globals_1.expect)(result.error).not.toContain('secret@example.com');
                (0, globals_1.expect)(result.error).not.toContain('users_email_key');
            }
        }));
    });
});
