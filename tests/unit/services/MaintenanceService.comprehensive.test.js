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
require("reflect-metadata");
const globals_1 = require("@jest/globals");
const client_1 = require("@prisma/client");
const MaintenanceService_1 = require("../../../app/services/MaintenanceService");
const VirtioSocketWatcherService_1 = require("../../../app/services/VirtioSocketWatcherService");
globals_1.jest.mock('../../../app/services/VirtioSocketWatcherService');
globals_1.jest.mock('@utils/cronParser', () => ({
    CronParser: {
        getNextRunTime: globals_1.jest.fn(() => new Date('2025-12-31T23:59:59Z'))
    }
}));
(0, globals_1.describe)('MaintenanceService', () => {
    let service;
    let mockPrisma;
    let mockVirtioService;
    const testVMId = 'vm-test-123';
    const testUserId = 'user-456';
    const validConfig = {
        vmId: testVMId,
        taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
        name: 'Test Cleanup',
        description: 'Test maintenance task',
        isRecurring: false,
        runAt: new Date(),
        parameters: { drive: 'C:' },
        userId: testUserId
    };
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        const maintenanceTaskMock = {
            create: globals_1.jest.fn(),
            update: globals_1.jest.fn().mockImplementation((args) => __awaiter(void 0, void 0, void 0, function* () {
                var _a, _b;
                // Return the last findUnique result merged with update data
                const lastResult = (_b = (_a = maintenanceTaskMock.findUnique.mock.results) === null || _a === void 0 ? void 0 : _a[maintenanceTaskMock.findUnique.mock.results.length - 1]) === null || _b === void 0 ? void 0 : _b.value;
                const resolved = lastResult instanceof Promise ? yield lastResult : lastResult;
                return resolved ? Object.assign(Object.assign({}, resolved), args === null || args === void 0 ? void 0 : args.data) : null;
            })),
            findUnique: globals_1.jest.fn(),
            findMany: globals_1.jest.fn(),
            delete: globals_1.jest.fn(),
            deleteMany: globals_1.jest.fn()
        };
        mockPrisma = {
            machine: {
                findUnique: globals_1.jest.fn(),
                create: globals_1.jest.fn(),
                update: globals_1.jest.fn(),
                findMany: globals_1.jest.fn(),
                delete: globals_1.jest.fn()
            },
            maintenanceTask: maintenanceTaskMock,
            maintenanceHistory: {
                create: globals_1.jest.fn(),
                update: globals_1.jest.fn(),
                findMany: globals_1.jest.fn()
            },
            $transaction: globals_1.jest.fn().mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
                if (typeof fn === 'function') {
                    // Pass a transaction proxy that has the same methods
                    return fn({
                        maintenanceTask: maintenanceTaskMock,
                        machine: mockPrisma.machine
                    });
                }
                return fn;
            }))
        };
        mockVirtioService = {
            isVmConnected: globals_1.jest.fn(),
            sendUnsafeCommand: globals_1.jest.fn()
        };
        globals_1.jest.mocked(VirtioSocketWatcherService_1.getVirtioSocketWatcherService).mockReturnValue(mockVirtioService);
        service = new MaintenanceService_1.MaintenanceService(mockPrisma);
    });
    (0, globals_1.describe)('scheduleTask', () => {
        (0, globals_1.it)('should successfully schedule a maintenance task', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testVMId, name: 'Test VM', os: 'windows', status: 'running' };
            const mockTask = {
                id: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                name: 'Test Cleanup',
                description: 'Test maintenance task',
                createdAt: new Date(),
                updatedAt: new Date(),
                isEnabled: true,
                isRecurring: false,
                cronSchedule: null,
                runAt: new Date(),
                nextRunAt: null,
                lastRunAt: null,
                parameters: { drive: 'C:' },
                createdByUserId: testUserId,
                executionStatus: 'IDLE',
                machine: mockMachine,
                createdBy: { id: testUserId, email: 'test@example.com' }
            };
            globals_1.jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'create').mockResolvedValue(mockTask);
            const result = yield service.scheduleTask(validConfig);
            (0, globals_1.expect)(result).toEqual(globals_1.expect.objectContaining({
                id: 'task-123',
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                machineId: testVMId
            }));
            (0, globals_1.expect)(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: testVMId },
                include: { user: true }
            });
            (0, globals_1.expect)(mockPrisma.maintenanceTask.create).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should throw error when VM does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            globals_1.jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(null);
            yield (0, globals_1.expect)(service.scheduleTask(validConfig)).rejects.toThrow('Virtual machine not found');
            (0, globals_1.expect)(mockPrisma.maintenanceTask.create).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should handle recurring tasks with cron schedule', () => __awaiter(void 0, void 0, void 0, function* () {
            const recurringConfig = Object.assign(Object.assign({}, validConfig), { isRecurring: true, cronSchedule: '0 * * * *' });
            const mockMachine = { id: testVMId, name: 'Test VM', os: 'windows', status: 'running' };
            const mockTask = Object.assign(Object.assign({ id: 'task-123' }, recurringConfig), { createdAt: new Date(), updatedAt: new Date(), isEnabled: true, isRecurring: true, cronSchedule: '0 * * * *', nextRunAt: new Date('2025-12-31T23:59:59Z'), lastRunAt: null, parameters: null, createdByUserId: testUserId, executionStatus: 'IDLE', machine: mockMachine, createdBy: { id: testUserId, email: 'test@example.com' } });
            globals_1.jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'create').mockResolvedValue(mockTask);
            const result = yield service.scheduleTask(recurringConfig);
            (0, globals_1.expect)(result.nextRunAt).toEqual(new Date('2025-12-31T23:59:59Z'));
        }));
        (0, globals_1.it)('should handle one-time tasks without cron schedule', () => __awaiter(void 0, void 0, void 0, function* () {
            const oneTimeConfig = Object.assign(Object.assign({}, validConfig), { isRecurring: false, runAt: new Date('2025-06-01T10:00:00Z') });
            const mockMachine = { id: testVMId, name: 'Test', os: 'windows', status: 'running' };
            const mockTask = {
                id: 'task-456',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                name: oneTimeConfig.name,
                isRecurring: false,
                nextRunAt: oneTimeConfig.runAt,
                createdAt: new Date(),
                updatedAt: new Date()
            };
            globals_1.jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'create').mockResolvedValue(mockTask);
            const result = yield service.scheduleTask(oneTimeConfig);
            (0, globals_1.expect)(result.nextRunAt).toBeInstanceOf(Date);
        }));
    });
    (0, globals_1.describe)('executeTask', () => {
        (0, globals_1.it)('should execute a maintenance task successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTask = {
                id: 'task-123',
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                machineId: testVMId,
                executionStatus: 'IDLE',
                isEnabled: true,
                createdByUserId: testUserId,
                parameters: { drive: 'C:' },
                machine: { id: testVMId, name: 'Test VM' }
            };
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask);
            // The $transaction update needs to return the task with RUNNING status
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue(Object.assign(Object.assign({}, mockTask), { executionStatus: 'RUNNING' }));
            globals_1.jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true);
            globals_1.jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({
                success: true,
                stdout: 'Cleanup completed',
                exit_code: 0
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.RUNNING,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.SUCCESS,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                duration: 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
                result: null,
                error: null
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue(mockTask);
            const result = yield service.executeTask('task-123', client_1.MaintenanceTrigger.MANUAL);
            (0, globals_1.expect)(result.success).toBe(true);
            (0, globals_1.expect)(mockVirtioService.isVmConnected).toHaveBeenCalledWith(testVMId);
            (0, globals_1.expect)(mockVirtioService.sendUnsafeCommand).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should handle task execution failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTask = {
                id: 'task-123',
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                machineId: testVMId,
                executionStatus: 'IDLE',
                isEnabled: true,
                createdByUserId: testUserId,
                parameters: { drive: 'C:' },
                machine: { id: testVMId, name: 'Test VM' }
            };
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask);
            globals_1.jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true);
            globals_1.jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({
                success: false,
                stderr: 'Disk cleanup failed',
                exit_code: 1
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.RUNNING,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.FAILED,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                duration: 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
                error: 'Disk cleanup failed'
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue(Object.assign(Object.assign({}, mockTask), { executionStatus: 'IDLE' }));
            const result = yield service.executeTask('task-123', client_1.MaintenanceTrigger.MANUAL);
            (0, globals_1.expect)(result.success).toBe(false);
            (0, globals_1.expect)(result.error).toBeDefined();
        }));
        (0, globals_1.it)('should throw error when task does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(null);
            yield (0, globals_1.expect)(service.executeTask('non-existent-task', client_1.MaintenanceTrigger.MANUAL)).rejects.toThrow('Maintenance task not found');
        }));
        (0, globals_1.it)('should handle command execution exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTask = {
                id: 'task-123',
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                machineId: testVMId,
                executionStatus: 'IDLE',
                isEnabled: true,
                createdByUserId: testUserId,
                parameters: { drive: 'C:' },
                machine: { id: testVMId, name: 'Test VM' }
            };
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask);
            globals_1.jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true);
            globals_1.jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockRejectedValue(new Error('Connection timeout'));
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.RUNNING,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.FAILED,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                duration: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
                error: 'Connection timeout'
            });
            const result = yield service.executeTask('task-123', client_1.MaintenanceTrigger.MANUAL);
            (0, globals_1.expect)(result.success).toBe(false);
            (0, globals_1.expect)(result.error).toBeDefined();
        }));
        (0, globals_1.it)('should throw error when task is already running', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTask = {
                id: 'task-123',
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                machineId: testVMId,
                executionStatus: 'RUNNING',
                isEnabled: true,
                createdByUserId: testUserId,
                parameters: { drive: 'C:' },
                machine: { id: testVMId, name: 'Test VM' }
            };
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask);
            yield (0, globals_1.expect)(service.executeTask('task-123', client_1.MaintenanceTrigger.MANUAL)).rejects.toThrow('Task is already running in another instance');
        }));
        (0, globals_1.it)('should apply task-specific timeouts', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTask = {
                id: 'task-123',
                taskType: client_1.MaintenanceTaskType.DEFRAG,
                machineId: testVMId,
                executionStatus: 'IDLE',
                isEnabled: true,
                createdByUserId: testUserId,
                parameters: { drive: 'C:' },
                machine: { id: testVMId, name: 'Test VM' }
            };
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask);
            globals_1.jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true);
            globals_1.jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({ success: true });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DEFRAG,
                status: client_1.MaintenanceStatus.RUNNING,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date()
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
                id: 'history-1',
                taskId: 'task-123',
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DEFRAG,
                status: client_1.MaintenanceStatus.SUCCESS,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                duration: 1000,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            yield service.executeTask('task-123', client_1.MaintenanceTrigger.MANUAL);
            (0, globals_1.expect)(mockVirtioService.sendUnsafeCommand).toHaveBeenCalledWith(globals_1.expect.any(String), globals_1.expect.any(String), globals_1.expect.objectContaining({ timeout: 3600000 }));
        }));
        (0, globals_1.it)('should throw error when VM is not connected', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTask = {
                id: 'task-123',
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                machineId: testVMId,
                executionStatus: 'IDLE',
                isEnabled: true,
                createdByUserId: testUserId,
                parameters: { drive: 'C:' },
                machine: { id: testVMId, name: 'Test VM' }
            };
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask);
            globals_1.jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(false);
            yield (0, globals_1.expect)(service.executeTask('task-123', client_1.MaintenanceTrigger.MANUAL)).rejects.toThrow('VM is not connected or powered off');
        }));
    });
    (0, globals_1.describe)('executeImmediate', () => {
        (0, globals_1.it)('should execute immediate maintenance successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testVMId, name: 'Test VM', os: 'windows' };
            globals_1.jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            globals_1.jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true);
            globals_1.jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({ success: true });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
                id: 'history-1',
                taskId: null,
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.RUNNING,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                error: null,
                result: null,
                duration: 0
            });
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
                id: 'history-1',
                taskId: null,
                machineId: testVMId,
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                status: client_1.MaintenanceStatus.SUCCESS,
                triggeredBy: client_1.MaintenanceTrigger.MANUAL,
                executedByUserId: testUserId,
                executedAt: new Date(),
                duration: 1000,
                createdAt: new Date(),
                updatedAt: new Date(),
                error: null,
                result: null
            });
            const result = yield service.executeImmediate(testVMId, client_1.MaintenanceTaskType.DISK_CLEANUP, {}, testUserId);
            (0, globals_1.expect)(result.success).toBe(true);
            (0, globals_1.expect)(mockVirtioService.isVmConnected).toHaveBeenCalledWith(testVMId);
            (0, globals_1.expect)(mockVirtioService.sendUnsafeCommand).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should throw error when VM does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            globals_1.jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(null);
            yield (0, globals_1.expect)(service.executeImmediate(testVMId, client_1.MaintenanceTaskType.DISK_CLEANUP, {}, testUserId)).rejects.toThrow('Virtual machine not found');
        }));
        (0, globals_1.it)('should throw error when VM is not connected', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testVMId, name: 'Test VM' };
            globals_1.jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            globals_1.jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(false);
            yield (0, globals_1.expect)(service.executeImmediate(testVMId, client_1.MaintenanceTaskType.DISK_CLEANUP, {}, testUserId)).rejects.toThrow('VM is not connected or powered off');
        }));
    });
    (0, globals_1.describe)('getTasksForVM', () => {
        (0, globals_1.it)('should retrieve all maintenance tasks for a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTasks = [
                { id: 'task-1', taskType: client_1.MaintenanceTaskType.DISK_CLEANUP, executionStatus: 'IDLE' },
                { id: 'task-2', taskType: client_1.MaintenanceTaskType.DEFRAG, executionStatus: 'RUNNING' }
            ];
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findMany').mockResolvedValue(mockTasks);
            const result = yield service.getTasksForVM(testVMId);
            (0, globals_1.expect)(result).toEqual(mockTasks);
            (0, globals_1.expect)(mockPrisma.maintenanceTask.findMany).toHaveBeenCalledWith({
                where: { machineId: testVMId },
                include: { machine: true, createdBy: true, _count: { select: { history: true } } },
                orderBy: { createdAt: 'desc' }
            });
        }));
        (0, globals_1.it)('should filter tasks by enabled status', () => __awaiter(void 0, void 0, void 0, function* () {
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findMany').mockResolvedValue([]);
            yield service.getTasksForVM(testVMId, 'enabled');
            (0, globals_1.expect)(mockPrisma.maintenanceTask.findMany).toHaveBeenCalledWith({
                where: { machineId: testVMId, isEnabled: true },
                include: { machine: true, createdBy: true, _count: { select: { history: true } } },
                orderBy: { createdAt: 'desc' }
            });
        }));
    });
    (0, globals_1.describe)('getDueTasks', () => {
        (0, globals_1.it)('should retrieve tasks due for execution', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTasks = [
                { id: 'task-1', taskType: client_1.MaintenanceTaskType.DISK_CLEANUP, executionStatus: 'IDLE' }
            ];
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findMany').mockResolvedValue(mockTasks);
            const result = yield service.getDueTasks();
            (0, globals_1.expect)(result).toEqual(mockTasks);
            (0, globals_1.expect)(mockPrisma.maintenanceTask.findMany).toHaveBeenCalled();
        }));
    });
    (0, globals_1.describe)('validateTaskParameters', () => {
        (0, globals_1.it)('should validate DISK_CLEANUP parameters', () => {
            const validParams = { drive: 'C:' };
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.DISK_CLEANUP, validParams)).not.toThrow();
        });
        (0, globals_1.it)('should validate DEFRAG parameters', () => {
            const validParams = { drive: 'C:' };
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.DEFRAG, validParams)).not.toThrow();
        });
        (0, globals_1.it)('should validate DEFENDER_SCAN parameters', () => {
            const validParams = { scanType: 'quick' };
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.DEFENDER_SCAN, validParams)).not.toThrow();
        });
        (0, globals_1.it)('should validate CUSTOM_SCRIPT parameters', () => {
            const validParams = { script: 'Get-Service' };
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.CUSTOM_SCRIPT, validParams)).not.toThrow();
        });
        (0, globals_1.it)('should throw for invalid drive parameter', () => {
            const invalidParams = { drive: 123 };
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.DISK_CLEANUP, invalidParams)).toThrow('Drive parameter must be a string');
        });
        (0, globals_1.it)('should throw for missing script in CUSTOM_SCRIPT', () => {
            const invalidParams = {};
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.CUSTOM_SCRIPT, invalidParams)).toThrow('Script parameter is required');
        });
        (0, globals_1.it)('should throw for invalid timeout', () => {
            const invalidParams = { timeoutMs: 500 };
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.DISK_CLEANUP, invalidParams)).toThrow('Timeout must be a number greater than 1000ms');
        });
        (0, globals_1.it)('should accept valid timeout', () => {
            const validParams = { timeoutMs: 300000 };
            (0, globals_1.expect)(() => service['validateTaskParameters'](client_1.MaintenanceTaskType.DISK_CLEANUP, validParams)).not.toThrow();
        });
    });
    (0, globals_1.describe)('updateTask', () => {
        (0, globals_1.it)('should update task configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTask = {
                id: 'task-123',
                name: 'Old Name',
                taskType: client_1.MaintenanceTaskType.DISK_CLEANUP,
                isRecurring: false,
                cronSchedule: null,
                nextRunAt: null,
                parameters: null,
                machine: { id: testVMId, name: 'Test VM' },
                createdBy: { id: testUserId, email: 'test@example.com' }
            };
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask);
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue(Object.assign(Object.assign({}, mockTask), { name: 'New Name', nextRunAt: null }));
            const result = yield service.updateTask('task-123', { name: 'New Name' });
            (0, globals_1.expect)(result.name).toBe('New Name');
            (0, globals_1.expect)(mockPrisma.maintenanceTask.update).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should throw error when task does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(null);
            yield (0, globals_1.expect)(service.updateTask('non-existent', { name: 'Test' })).rejects.toThrow('Maintenance task not found');
        }));
    });
    (0, globals_1.describe)('deleteTask', () => {
        (0, globals_1.it)('should delete a maintenance task', () => __awaiter(void 0, void 0, void 0, function* () {
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue({ id: 'task-123' });
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'delete').mockResolvedValue({ id: 'task-123' });
            const result = yield service.deleteTask('task-123');
            (0, globals_1.expect)(result.id).toBe('task-123');
            (0, globals_1.expect)(mockPrisma.maintenanceTask.delete).toHaveBeenCalledWith({ where: { id: 'task-123' } });
        }));
        (0, globals_1.it)('should throw error when task does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            globals_1.jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(null);
            yield (0, globals_1.expect)(service.deleteTask('non-existent')).rejects.toThrow('Maintenance task not found');
        }));
    });
    (0, globals_1.describe)('getTaskHistory', () => {
        (0, globals_1.it)('should retrieve execution history for a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHistory = [
                { id: 'history-1', taskType: client_1.MaintenanceTaskType.DISK_CLEANUP, status: client_1.MaintenanceStatus.SUCCESS }
            ];
            globals_1.jest.spyOn(mockPrisma.maintenanceHistory, 'findMany').mockResolvedValue(mockHistory);
            const result = yield service.getTaskHistory(testVMId, 10, 0);
            (0, globals_1.expect)(result).toEqual(mockHistory);
            (0, globals_1.expect)(mockPrisma.maintenanceHistory.findMany).toHaveBeenCalledWith({
                where: { machineId: testVMId },
                include: { task: true, machine: true, executedBy: true },
                orderBy: { executedAt: 'desc' },
                take: 10,
                skip: 0
            });
        }));
    });
});
