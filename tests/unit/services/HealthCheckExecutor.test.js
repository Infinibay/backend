"use strict";
/**
 * Unit tests for HealthCheckExecutor.
 *
 * HealthCheckExecutor receives all I/O through constructor injection
 * (repository, eventManager, snapshotStore), so we mock those directly.
 * The only module-level dependency is getVirtioSocketWatcherService(),
 * which we mock with jest.mock().
 */
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
const HealthCheckExecutor_1 = require("../../../app/services/HealthCheckExecutor");
// ─── Mocks ──────────────────────────────────────────────────────────────────
const mockSendSafeCommand = jest.fn();
jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: () => ({
        sendSafeCommand: mockSendSafeCommand,
    }),
}));
// ─── Helpers ────────────────────────────────────────────────────────────────
function makeTask(overrides) {
    return Object.assign({ id: 'task-1', machineId: 'vm-1', checkType: 'DISK_SPACE', priority: 'MEDIUM', attempts: 0, maxAttempts: 3, scheduledFor: new Date(), payload: null, createdAt: new Date() }, overrides);
}
function makeSuccessResponse(overrides) {
    return Object.assign({ id: 'resp-1', success: true, exit_code: 0, stdout: '{"diskSpace": 50}', execution_time_ms: 1200, command_type: 'safe' }, overrides);
}
// ─── Test Suite ─────────────────────────────────────────────────────────────
describe('HealthCheckExecutor', () => {
    let executor;
    let mockRepository;
    let mockEventManager;
    let mockSnapshotStore;
    beforeEach(() => {
        jest.clearAllMocks();
        mockRepository = {
            findMachine: jest.fn(),
            markTaskRunning: jest.fn(),
            markTaskCompleted: jest.fn(),
            markTaskRetryScheduled: jest.fn(),
            markTaskFailed: jest.fn(),
        };
        mockEventManager = {
            dispatchEvent: jest.fn(),
        };
        mockSnapshotStore = {
            storeSuccess: jest.fn().mockResolvedValue(undefined),
        };
        executor = new HealthCheckExecutor_1.HealthCheckExecutor(mockRepository, mockEventManager, mockSnapshotStore);
    });
    // ─── executeHealthCheck ─────────────────────────────────────────────────
    describe('executeHealthCheck', () => {
        it('executes a health check end-to-end successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask();
            const response = makeSuccessResponse();
            mockRepository.findMachine.mockResolvedValue({ id: 'vm-1', name: 'TestVM', status: 'running', os: 'ubuntu' });
            mockSendSafeCommand.mockResolvedValue(response);
            yield executor.executeHealthCheck(task);
            // Verify VM was checked
            expect(mockRepository.findMachine).toHaveBeenCalledWith('vm-1');
            // Verify task was marked running
            expect(mockRepository.markTaskRunning).toHaveBeenCalledWith('task-1', 0);
            // Verify event was dispatched for start
            expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith('vms', 'update', expect.objectContaining({
                id: 'vm-1',
                healthCheckStarted: expect.objectContaining({
                    taskId: 'task-1',
                    checkType: 'DISK_SPACE',
                    attempt: 1,
                }),
            }));
            // Verify command was sent
            expect(mockSendSafeCommand).toHaveBeenCalledWith('vm-1', expect.objectContaining({ action: 'CheckDiskSpace', params: undefined }), expect.any(Number));
            // Verify task was marked completed
            expect(mockRepository.markTaskCompleted).toHaveBeenCalledWith('task-1', response, expect.any(Number));
            // Verify completion event
            expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith('vms', 'update', expect.objectContaining({
                id: 'vm-1',
                healthCheckCompleted: expect.objectContaining({
                    taskId: 'task-1',
                    checkType: 'DISK_SPACE',
                    success: true,
                }),
            }));
            // Verify snapshot was stored
            expect(mockSnapshotStore.storeSuccess).toHaveBeenCalledWith('vm-1', 'DISK_SPACE', response, expect.any(Number));
        }));
        it('throws if VM not found in database', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask();
            mockRepository.findMachine.mockResolvedValue(null);
            yield expect(executor.executeHealthCheck(task)).rejects.toThrow('VM vm-1 not found in database');
        }));
        it('throws if VM is not running', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask();
            mockRepository.findMachine.mockResolvedValue({ id: 'vm-1', name: 'TestVM', status: 'stopped', os: 'ubuntu' });
            yield expect(executor.executeHealthCheck(task)).rejects.toThrow('is not running');
        }));
        it('does not throw when snapshot store fails (best-effort)', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask();
            const response = makeSuccessResponse();
            mockRepository.findMachine.mockResolvedValue({ id: 'vm-1', name: 'TestVM', status: 'running', os: 'ubuntu' });
            mockSendSafeCommand.mockResolvedValue(response);
            mockSnapshotStore.storeSuccess.mockRejectedValue(new Error('Snapshot DB error'));
            // Should NOT throw
            yield executor.executeHealthCheck(task);
            // Task should still be marked completed
            expect(mockRepository.markTaskCompleted).toHaveBeenCalled();
        }));
        it('works without a snapshot store', () => __awaiter(void 0, void 0, void 0, function* () {
            const executorNoSnap = new HealthCheckExecutor_1.HealthCheckExecutor(mockRepository, mockEventManager);
            const task = makeTask();
            const response = makeSuccessResponse();
            mockRepository.findMachine.mockResolvedValue({ id: 'vm-1', name: 'TestVM', status: 'running', os: 'ubuntu' });
            mockSendSafeCommand.mockResolvedValue(response);
            yield executorNoSnap.executeHealthCheck(task);
            expect(mockRepository.markTaskCompleted).toHaveBeenCalled();
        }));
        it('sends payload params when task has payload', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask({ payload: { drive: 'C:', threshold: 90 } });
            mockRepository.findMachine.mockResolvedValue({ id: 'vm-1', name: 'TestVM', status: 'running', os: 'ubuntu' });
            mockSendSafeCommand.mockResolvedValue(makeSuccessResponse());
            yield executor.executeHealthCheck(task);
            expect(mockSendSafeCommand).toHaveBeenCalledWith('vm-1', expect.objectContaining({ params: { drive: 'C:', threshold: 90 } }), expect.any(Number));
        }));
    });
    // ─── handleTaskFailure ──────────────────────────────────────────────────
    describe('handleTaskFailure', () => {
        it('schedules retry when attempts < maxAttempts', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask({ attempts: 0, maxAttempts: 3 });
            const error = new Error('Connection refused');
            const result = yield executor.handleTaskFailure(task, error);
            expect(result).toBe(true);
            expect(task.attempts).toBe(1);
            expect(task.scheduledFor).toBeInstanceOf(Date);
            expect(task.scheduledFor.getTime()).toBeGreaterThan(Date.now() - 1000);
            expect(mockRepository.markTaskRetryScheduled).toHaveBeenCalledWith('task-1', task.scheduledFor, 1);
            expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith('vms', 'update', expect.objectContaining({
                id: 'vm-1',
                healthCheckStatusChanged: expect.objectContaining({
                    checkType: 'DISK_SPACE',
                    status: 'retry_scheduled',
                    attempts: 1,
                }),
            }));
        }));
        it('returns false and emits failed event when max attempts reached', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask({ attempts: 2, maxAttempts: 3 });
            const error = new Error('Timeout exceeded');
            const result = yield executor.handleTaskFailure(task, error);
            expect(result).toBe(false);
            expect(task.attempts).toBe(3);
            expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith('vms', 'update', expect.objectContaining({
                id: 'vm-1',
                healthCheckStatusChanged: expect.objectContaining({
                    checkType: 'DISK_SPACE',
                    status: 'failed',
                    error: 'Timeout exceeded',
                    attempts: 3,
                }),
            }));
            // Should NOT call markTaskRetryScheduled
            expect(mockRepository.markTaskRetryScheduled).not.toHaveBeenCalled();
        }));
        it('computes longer backoff for connection errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const task1 = makeTask({ attempts: 0, maxAttempts: 5 });
            const connectionError = Object.assign(new Error('No connection'), { code: 'ECONNREFUSED' });
            yield executor.handleTaskFailure(task1, connectionError);
            const connectionBackoff = task1.scheduledFor.getTime() - Date.now();
            const task2 = makeTask({ attempts: 0, maxAttempts: 5 });
            const otherError = new Error('Some random error');
            yield executor.handleTaskFailure(task2, otherError);
            const otherBackoff = task2.scheduledFor.getTime() - Date.now();
            // Connection errors should have longer backoff (30s base vs 10s base)
            expect(connectionBackoff).toBeGreaterThan(otherBackoff);
        }));
        it('backoff increases with each attempt', () => __awaiter(void 0, void 0, void 0, function* () {
            const task = makeTask({ attempts: 0, maxAttempts: 10 });
            const error = Object.assign(new Error('Connection lost'), { code: 'ECONNRESET' });
            const backoffs = [];
            for (let i = 0; i < 4; i++) {
                yield executor.handleTaskFailure(task, error);
                backoffs.push(task.scheduledFor.getTime() - Date.now());
            }
            // Each subsequent backoff should be >= previous * multiplier (approximately)
            for (let i = 1; i < backoffs.length; i++) {
                expect(backoffs[i]).toBeGreaterThanOrEqual(backoffs[i - 1] * 1.4);
            }
        }));
    });
    // ─── categorizeError ────────────────────────────────────────────────────
    describe('categorizeError', () => {
        it.each([
            [{ message: 'Request timeout', code: undefined }, 'timeout'],
            [{ message: 'Operation timed out', code: 'ETIMEDOUT' }, 'timeout'],
            [{ message: 'No connection available', code: undefined }, 'connection'],
            [{ message: 'something', code: 'ECONNREFUSED' }, 'connection'],
            [{ message: 'something', code: 'ECONNRESET' }, 'connection'],
            [{ message: 'something', code: 'EPIPE' }, 'connection'],
            [{ message: 'Socket not connected', code: undefined }, 'disconnected'],
            [{ message: 'random failure', code: undefined }, 'unknown'],
        ])('categorizes %j as %s', (errorLike, expected) => {
            var _a;
            const error = Object.assign(new Error((_a = errorLike.message) !== null && _a !== void 0 ? _a : ''), { code: errorLike.code });
            expect(executor.categorizeError(error)).toBe(expected);
        });
        it('handles non-Error objects', () => {
            expect(executor.categorizeError('string error')).toBe('unknown');
            expect(executor.categorizeError(null)).toBe('unknown');
            expect(executor.categorizeError(undefined)).toBe('unknown');
            expect(executor.categorizeError({ message: 'timeout' })).toBe('timeout');
        });
    });
    // ─── resolveTimeout ─────────────────────────────────────────────────────
    describe('resolveTimeout', () => {
        it('returns default timeout for each check type', () => {
            expect(executor.resolveTimeout('DISK_SPACE')).toBe(HealthCheckExecutor_1.HEALTH_CHECK_TIMEOUTS.DISK_SPACE);
            expect(executor.resolveTimeout('OVERALL_STATUS')).toBe(HealthCheckExecutor_1.HEALTH_CHECK_TIMEOUTS.OVERALL_STATUS);
        });
        it('uses environment variable override when valid', () => {
            process.env.HEALTH_CHECK_TIMEOUT_DISK_SPACE = '120000';
            try {
                expect(executor.resolveTimeout('DISK_SPACE')).toBe(120000);
            }
            finally {
                delete process.env.HEALTH_CHECK_TIMEOUT_DISK_SPACE;
            }
        });
        it('falls back to default when env var is invalid', () => {
            process.env.HEALTH_CHECK_TIMEOUT_DISK_SPACE = 'not-a-number';
            try {
                expect(executor.resolveTimeout('DISK_SPACE')).toBe(HealthCheckExecutor_1.HEALTH_CHECK_TIMEOUTS.DISK_SPACE);
            }
            finally {
                delete process.env.HEALTH_CHECK_TIMEOUT_DISK_SPACE;
            }
        });
        it('falls back to default when env var is zero or negative', () => {
            process.env.HEALTH_CHECK_TIMEOUT_DISK_SPACE = '0';
            try {
                expect(executor.resolveTimeout('DISK_SPACE')).toBe(HealthCheckExecutor_1.HEALTH_CHECK_TIMEOUTS.DISK_SPACE);
            }
            finally {
                delete process.env.HEALTH_CHECK_TIMEOUT_DISK_SPACE;
            }
        });
    });
    // ─── CHECK_TYPE_TO_ACTION mapping ───────────────────────────────────────
    describe('CHECK_TYPE_TO_ACTION', () => {
        it('maps every HealthCheckType to a valid action', () => {
            const checkTypes = [
                'OVERALL_STATUS', 'DISK_SPACE', 'RESOURCE_OPTIMIZATION',
                'WINDOWS_UPDATES', 'WINDOWS_DEFENDER', 'LINUX_UPDATES',
                'APPLICATION_INVENTORY', 'APPLICATION_UPDATES',
                'SECURITY_CHECK', 'PERFORMANCE_CHECK', 'SYSTEM_HEALTH', 'CUSTOM_CHECK',
            ];
            for (const ct of checkTypes) {
                expect(HealthCheckExecutor_1.CHECK_TYPE_TO_ACTION[ct]).toBeDefined();
                expect(typeof HealthCheckExecutor_1.CHECK_TYPE_TO_ACTION[ct]).toBe('string');
            }
        });
    });
});
