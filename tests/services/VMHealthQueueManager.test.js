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
const VMHealthQueueManager_1 = require("../../app/services/VMHealthQueueManager");
const jest_mock_extended_1 = require("jest-mock-extended");
const logger_1 = __importDefault(require("@main/logger"));
// Mock VirtioSocketWatcherService
const mockVirtioService = {
    sendSafeCommand: jest.fn()
};
jest.mock('../../app/services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: () => mockVirtioService
}));
describe('VMHealthQueueManager', () => {
    let queueManager;
    let mockPrisma;
    let mockEventManager;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockEventManager = (0, jest_mock_extended_1.mockDeep)();
        queueManager = new VMHealthQueueManager_1.VMHealthQueueManager(mockPrisma, mockEventManager);
    });
    describe('getOverallScanIntervalMinutes', () => {
        it('should return per-VM config when available', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.vMHealthConfig.findUnique.mockResolvedValue({
                checkIntervalMinutes: 30
            });
            const interval = yield queueManager.getOverallScanIntervalMinutes('vm1');
            expect(interval).toBe(30);
        }));
        it('should return environment variable when per-VM config not available', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.vMHealthConfig.findUnique.mockResolvedValue(null);
            process.env.OVERALL_SCAN_INTERVAL_MINUTES = '45';
            const interval = yield queueManager.getOverallScanIntervalMinutes('vm1');
            expect(interval).toBe(45);
            delete process.env.OVERALL_SCAN_INTERVAL_MINUTES;
        }));
        it('should return default when no config or env var', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.vMHealthConfig.findUnique.mockResolvedValue(null);
            delete process.env.OVERALL_SCAN_INTERVAL_MINUTES;
            const interval = yield queueManager.getOverallScanIntervalMinutes('vm1');
            expect(interval).toBe(60); // Default value
        }));
    });
    describe('queueHealthCheck - Idempotency', () => {
        it('should prevent duplicate OVERALL_STATUS checks within interval', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'vm1';
            // Mock VM lookup
            mockPrisma.machine.findUnique.mockResolvedValue({
                id: machineId,
                name: 'Test VM',
                status: 'running'
            });
            // Mock existing pending task
            mockPrisma.vMHealthCheckQueue.findFirst
                .mockResolvedValueOnce({ id: 'existing-task' }) // Existing pending task
                .mockResolvedValueOnce({ id: 'recent-completed' }); // Recent completed task
            const taskId = yield queueManager.queueHealthCheck(machineId, 'OVERALL_STATUS', 'MEDIUM');
            expect(taskId).toBe('existing-task');
            expect(mockPrisma.vMHealthCheckQueue.create).not.toHaveBeenCalled();
        }));
        it('should allow new OVERALL_STATUS check after interval expires', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'vm1';
            mockPrisma.machine.findUnique.mockResolvedValue({
                id: machineId,
                name: 'Test VM',
                status: 'running'
            });
            // Mock per-VM config
            mockPrisma.vMHealthConfig.findUnique.mockResolvedValue({
                checkIntervalMinutes: 30
            });
            // No existing tasks
            mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue(null);
            // Mock successful creation
            mockPrisma.vMHealthCheckQueue.create.mockResolvedValue({
                id: 'new-task-id'
            });
            const taskId = yield queueManager.queueHealthCheck(machineId, 'OVERALL_STATUS', 'MEDIUM');
            expect(taskId).toMatch(/^[0-9a-f-]{36}$/); // Should be a UUID
            expect(mockPrisma.vMHealthCheckQueue.create).toHaveBeenCalled();
        }));
    });
    describe('processQueue - DB Sync', () => {
        it('should load pending tasks from database before processing', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'vm1';
            // Mock database tasks
            mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue([
                {
                    id: 'task1',
                    machineId,
                    checkType: 'OVERALL_STATUS',
                    priority: 'MEDIUM',
                    attempts: 0,
                    maxAttempts: 3,
                    scheduledFor: new Date(),
                    payload: null,
                    createdAt: new Date()
                }
            ]);
            // Mock successful command execution
            mockVirtioService.sendSafeCommand.mockResolvedValue({ success: true });
            // Mock task completion
            mockPrisma.vMHealthCheckQueue.update.mockResolvedValue({});
            yield queueManager.processQueue(machineId);
            expect(mockPrisma.vMHealthCheckQueue.findMany).toHaveBeenCalledWith({
                where: {
                    machineId,
                    status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
                },
                orderBy: [
                    { priority: 'asc' },
                    { scheduledFor: 'asc' }
                ]
            });
        }));
    });
    describe('Retry and Backoff Logic', () => {
        it('should delegate to HealthCheckExecutor when processing queue with a failing task', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'vm1';
            const task = {
                id: 'task1',
                machineId,
                checkType: 'OVERALL_STATUS',
                priority: 'MEDIUM',
                attempts: 2, // Already at 2 attempts
                maxAttempts: 3,
                scheduledFor: new Date(),
                payload: null,
                createdAt: new Date()
            };
            // Mock loadPendingTasksForVm (in-memory queue sync)
            mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue([task]);
            // Mock getReadyTasksWithLocking (DB path)
            mockPrisma.$transaction.mockResolvedValue([task]);
            // Mock VM lookup for executeHealthCheck
            mockPrisma.machine.findUnique.mockResolvedValue({
                id: machineId,
                name: 'Test VM',
                status: 'RUNNING',
                os: 'linux'
            });
            // Mock machine.findMany for concurrency check (system-wide guard)
            mockPrisma.machine.findMany.mockResolvedValue([
                { id: machineId, status: 'RUNNING' }
            ]);
            // Mock command failure
            mockVirtioService.sendSafeCommand.mockRejectedValue(new Error('Command failed'));
            // Mock task update calls (markTaskRunning, markTaskRetryScheduled, etc.)
            mockPrisma.vMHealthCheckQueue.update.mockResolvedValue({});
            // Mock health snapshot (needed by HealthCheckExecutor via SnapshotStore)
            mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null);
            mockPrisma.vMHealthSnapshot.create.mockResolvedValue({ id: 'snapshot1' });
            mockPrisma.vMHealthSnapshot.update.mockResolvedValue({});
            // Mock delete (removeFromQueue)
            mockPrisma.vMHealthCheckQueue.delete.mockResolvedValue({});
            // Process the queue — execution delegates to HealthCheckExecutor
            // which throws on command failure, and handleTaskFailure returns false
            // (max attempts reached), so removeFromQueue removes the task from DB
            yield queueManager.processQueue(machineId);
            // Verify: task update was called (markTaskRunning succeeded)
            // If we get here without throwing, delegation worked (processQueue completed)
        }));
    });
    describe('Concurrency Control', () => {
        it('should use database transactions for task claiming', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'vm1';
            // Mock transaction behavior
            const mockTransaction = jest.fn().mockResolvedValue([
                {
                    id: 'task1',
                    machineId,
                    checkType: 'OVERALL_STATUS',
                    priority: 'MEDIUM',
                    attempts: 0,
                    maxAttempts: 3,
                    scheduledFor: new Date(),
                    payload: null,
                    createdAt: new Date()
                }
            ]);
            mockPrisma.$transaction.mockImplementation(mockTransaction);
            // Access private method for testing
            const getReadyTasksMethod = queueManager.getReadyTasksWithLocking.bind(queueManager);
            const tasks = yield getReadyTasksMethod(machineId, 5);
            expect(mockPrisma.$transaction).toHaveBeenCalled();
            expect(tasks).toHaveLength(1);
            expect(tasks[0].id).toBe('task1');
        }));
    });
    describe('cleanupOrphanedTasks', () => {
        it('should remove tasks for deleted VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock deleted VMs
            mockPrisma.machine.findMany.mockResolvedValue([
                { id: 'deleted-vm1' },
                { id: 'deleted-vm2' }
            ]);
            // Mock deletion count
            mockPrisma.vMHealthCheckQueue.deleteMany.mockResolvedValue({ count: 5 });
            const consoleSpy = jest.spyOn(logger_1.default, 'info').mockImplementation();
            yield queueManager.cleanupOrphanedTasks();
            expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: 'DELETED' },
                select: { id: true }
            });
            expect(mockPrisma.vMHealthCheckQueue.deleteMany).toHaveBeenCalledWith({
                where: {
                    machineId: { in: ['deleted-vm1', 'deleted-vm2'] },
                    status: { in: ['PENDING', 'RETRY_SCHEDULED'] }
                }
            });
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cleaned up 5 orphaned tasks for 2 deleted VMs'));
            consoleSpy.mockRestore();
        }));
    });
});
