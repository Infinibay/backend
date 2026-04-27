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
const VMHealthQueueManager_1 = require("../../../app/services/VMHealthQueueManager");
// Mock VMRecommendationService
const logger_1 = __importDefault(require("@main/logger"));
jest.mock('../../../app/services/VMRecommendationService', () => ({
    VMRecommendationService: jest.fn().mockImplementation(() => ({}))
}));
// Mock VirtioSocketWatcherService
jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: jest.fn()
}));
// Mock Prisma
const mockPrisma = {
    machine: {
        findUnique: jest.fn(),
        findMany: jest.fn()
    },
    vMHealthCheckQueue: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn()
    },
    vMHealthSnapshot: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn()
    },
    vMHealthConfig: {
        findUnique: jest.fn()
    },
    $transaction: jest.fn((fn) => fn(mockPrisma))
};
// Mock EventManager
const mockEventManager = {
    dispatchEvent: jest.fn()
};
describe('VMHealthQueueManager Comprehensive Tests', () => {
    let queueManager;
    beforeEach(() => {
        jest.clearAllMocks();
        // Suppress constructor console logs
        jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
        jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
        jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
        queueManager = new VMHealthQueueManager_1.VMHealthQueueManager(mockPrisma, mockEventManager);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    describe('constructor', () => {
        it('should initialize with prisma and event manager', () => {
            expect(queueManager).toBeDefined();
            expect(queueManager.prisma).toBe(mockPrisma);
            expect(queueManager.eventManager).toBe(mockEventManager);
        });
    });
    describe('getQueueSize', () => {
        it('should return 0 for unknown machine', () => {
            const size = queueManager.getQueueSize('unknown-vm');
            expect(size).toBe(0);
        });
    });
    describe('getQueueStatistics', () => {
        it('should return statistics', () => {
            const stats = queueManager.getQueueStatistics();
            expect(stats).toBeDefined();
            expect(stats.totalQueued).toBeDefined();
            expect(stats.activeChecks).toBeDefined();
            expect(stats.vmQueues).toBeDefined();
        });
        it('should return zero counts when no tasks queued', () => {
            const stats = queueManager.getQueueStatistics();
            expect(stats.totalQueued).toBe(0);
            expect(stats.activeChecks).toBe(0);
        });
    });
    describe('clearQueue', () => {
        it('should clear queue for a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            yield queueManager.clearQueue('vm-123');
            expect(mockPrisma.vMHealthCheckQueue.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({
                    machineId: 'vm-123'
                })
            }));
        }));
    });
    describe('queueHealthCheck', () => {
        it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield expect(queueManager.queueHealthCheck('non-existent', 'OVERALL_STATUS')).rejects.toThrow('VM with ID non-existent not found');
        }));
        it('should throw error when VM is not running', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findUnique.mockResolvedValue({
                id: 'vm-123',
                name: 'test-vm',
                status: 'stopped'
            });
            mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue(null);
            yield expect(queueManager.queueHealthCheck('vm-123', 'OVERALL_STATUS')).rejects.toThrow();
        }));
        it('should skip duplicate health checks', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findUnique.mockResolvedValue({
                id: 'vm-123',
                name: 'test-vm',
                status: 'running'
            });
            mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue({
                id: 'existing-task-id',
                machineId: 'vm-123',
                checkType: 'OVERALL_STATUS',
                status: 'PENDING'
            });
            const result = yield queueManager.queueHealthCheck('vm-123', 'OVERALL_STATUS');
            expect(result).toBe('existing-task-id');
        }));
    });
    describe('queueHealthChecks', () => {
        it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield expect(queueManager.queueHealthChecks('non-existent')).rejects.toThrow('VM with ID non-existent not found');
        }));
        it('should skip when VM is not running', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findUnique.mockResolvedValue({
                id: 'vm-123',
                name: 'test-vm',
                status: 'stopped',
                os: 'ubuntu-22.04'
            });
            yield queueManager.queueHealthChecks('vm-123');
            // Should not create any tasks
            expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled();
        }));
    });
    describe('processQueue', () => {
        it('should process queue for a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(queueManager.processQueue('vm-123')).resolves.not.toThrow();
        }));
    });
    describe('cleanupOrphanedTasks', () => {
        it('should clean up tasks for deleted VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findMany.mockResolvedValue([
                { id: 'deleted-vm-1' },
                { id: 'deleted-vm-2' }
            ]);
            yield queueManager.cleanupOrphanedTasks();
            expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { status: 'DELETED' }
            }));
        }));
        it('should handle no deleted VMs gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findMany.mockResolvedValue([]);
            yield expect(queueManager.cleanupOrphanedTasks()).resolves.not.toThrow();
        }));
    });
    describe('getOverallScanIntervalMinutes', () => {
        it('should return default interval when no config exists', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.vMHealthConfig.findUnique.mockResolvedValue(null);
            const interval = yield queueManager.getOverallScanIntervalMinutes('vm-123');
            expect(interval).toBe(60); // OVERALL_SCAN_INTERVAL_MINUTES default
        }));
        it('should return per-VM config when available', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.vMHealthConfig.findUnique.mockResolvedValue({
                checkIntervalMinutes: 30
            });
            const interval = yield queueManager.getOverallScanIntervalMinutes('vm-123');
            expect(interval).toBe(30);
        }));
        it('should handle database errors gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.vMHealthConfig.findUnique.mockRejectedValue(new Error('Database connection failed'));
            const interval = yield queueManager.getOverallScanIntervalMinutes('vm-123');
            // Should return default on error
            expect(interval).toBe(60);
        }));
    });
});
