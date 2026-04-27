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
const jest_setup_1 = require("../../setup/jest.setup");
const machine_status_1 = require("../../../app/constants/machine-status");
// Mock VMRecommendationService before importing BackgroundHealthService
globals_1.jest.mock('@services/VMRecommendationService', () => {
    return {
        VMRecommendationService: globals_1.jest.fn().mockImplementation(() => {
            return {
                analyzeVM: globals_1.jest.fn(),
                getRecommendations: globals_1.jest.fn(),
                cleanupExpiredRecommendations: globals_1.jest.fn().mockResolvedValue(0)
            };
        })
    };
});
globals_1.jest.mock('cron', () => ({
    CronJob: globals_1.jest.fn().mockImplementation((schedule, callback, complete, start, timezone) => {
        const instance = {
            start: globals_1.jest.fn(),
            stop: globals_1.jest.fn(),
            running: true,
            isActive: true,
            nextDate: globals_1.jest.fn().mockReturnValue({
                toJSDate: () => new Date('2025-01-01T02:00:00Z')
            })
        };
        return instance;
    })
}));
// Unmock EventManager so we can properly mock it ourselves
globals_1.jest.unmock('@services/EventManager');
const BackgroundHealthService_1 = require("@services/BackgroundHealthService");
(0, globals_1.describe)('BackgroundHealthService', () => {
    let service;
    let mockEventManager;
    let mockQueueManager;
    let mockBackgroundTaskService;
    let mockCronJob;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        // Mock EventManager
        mockEventManager = {
            dispatchEvent: globals_1.jest.fn(),
            registerResourceManager: globals_1.jest.fn(),
            vmCreated: globals_1.jest.fn(),
            vmUpdated: globals_1.jest.fn(),
            vmDeleted: globals_1.jest.fn(),
            getStats: globals_1.jest.fn()
        };
        // Mock VMHealthQueueManager
        mockQueueManager = {
            queueHealthChecks: globals_1.jest.fn(),
            queueHealthCheck: globals_1.jest.fn(),
            processQueue: globals_1.jest.fn(),
            getQueueSize: globals_1.jest.fn(),
            getQueueStatistics: globals_1.jest.fn(),
            clearQueue: globals_1.jest.fn()
        };
        // Mock BackgroundTaskService
        mockBackgroundTaskService = {
            queueTask: globals_1.jest.fn(),
            executeTask: globals_1.jest.fn(),
            getTaskStats: globals_1.jest.fn(),
            clearCompletedTasks: globals_1.jest.fn()
        };
        // Mock database responses - only running VMs should be returned
        jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([
            {
                id: 'vm-1',
                name: 'test-vm-1',
                status: machine_status_1.RUNNING_STATUS,
                userId: 'user-1',
                createdAt: new Date(),
                updatedAt: new Date(),
                internalName: 'test-vm-1',
                os: 'windows',
                cpuCores: 2,
                ramGB: 4,
                diskSizeGB: 50,
                departmentId: null,
                templateId: null,
                gpuPciAddress: null,
                firewallRuleSetId: null,
                version: 1,
                localIP: null,
                publicIP: null
            }
        ]);
        // Create a shared mock CronJob instance
        mockCronJob = {
            start: globals_1.jest.fn(),
            stop: globals_1.jest.fn(),
            running: true,
            isActive: true,
            nextDate: globals_1.jest.fn().mockReturnValue({
                toJSDate: () => new Date('2025-01-01T02:00:00Z')
            })
        };
        // Reset the CronJob mock to return our shared instance
        const { CronJob } = require('cron');
        CronJob.mockReturnValue(mockCronJob);
        service = new BackgroundHealthService_1.BackgroundHealthService(jest_setup_1.mockPrisma, mockBackgroundTaskService, mockEventManager, mockQueueManager);
    });
    (0, globals_1.afterEach)(() => {
        globals_1.jest.resetAllMocks();
    });
    (0, globals_1.describe)('start', () => {
        (0, globals_1.it)('should start the cron job with correct schedule', () => {
            service.start();
            const { CronJob } = require('cron');
            (0, globals_1.expect)(CronJob).toHaveBeenCalledWith('*/1 * * * *', globals_1.expect.any(Function));
        });
        (0, globals_1.it)('should not start multiple cron jobs if already started', () => {
            service.start();
            service.start();
            const { CronJob } = require('cron');
            // 2 CronJob instances created on first start (daily + weekly), none on second start
            (0, globals_1.expect)(CronJob).toHaveBeenCalledTimes(2);
        });
    });
    (0, globals_1.describe)('stop', () => {
        (0, globals_1.it)('should stop the cron job', () => {
            service.start();
            service.stop();
            (0, globals_1.expect)(mockCronJob.stop).toHaveBeenCalled();
        });
        (0, globals_1.it)('should handle stopping when not started', () => {
            (0, globals_1.expect)(() => service.stop()).not.toThrow();
        });
    });
    (0, globals_1.describe)('updateSchedule', () => {
        (0, globals_1.it)('should update the cron schedule', () => {
            service.start();
            service.updateSchedule('0 3 * * *');
            const { CronJob } = require('cron');
            // 2 from start() (daily + weekly) + 1 from updateSchedule() = 3
            (0, globals_1.expect)(CronJob).toHaveBeenCalledTimes(3);
            (0, globals_1.expect)(CronJob).toHaveBeenLastCalledWith('0 3 * * *', globals_1.expect.any(Function));
        });
    });
    (0, globals_1.describe)('executeHealthCheckRound', () => {
        (0, globals_1.beforeEach)(() => {
            mockBackgroundTaskService.queueTask.mockResolvedValue('task-123');
        });
        (0, globals_1.it)('should not execute if already running', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock isRunning state by calling executeHealthCheckRound twice concurrently
            const promise1 = service.executeHealthCheckRound();
            const promise2 = service.executeHealthCheckRound();
            yield Promise.all([promise1, promise2]);
            // Only one should actually execute
            (0, globals_1.expect)(mockBackgroundTaskService.queueTask).toHaveBeenCalledTimes(1);
        }));
        (0, globals_1.it)('should queue a background task for health check execution', () => __awaiter(void 0, void 0, void 0, function* () {
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(mockBackgroundTaskService.queueTask).toHaveBeenCalledWith('daily-health-check-round', globals_1.expect.any(Function), globals_1.expect.objectContaining({
                retryPolicy: globals_1.expect.objectContaining({
                    maxRetries: 2,
                    backoffMs: 5000,
                    backoffMultiplier: 2,
                    maxBackoffMs: 30000
                }),
                onError: globals_1.expect.any(Function)
            }));
        }));
        (0, globals_1.it)('should handle task queuing failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Task queue full');
            mockBackgroundTaskService.queueTask.mockRejectedValue(error);
            yield (0, globals_1.expect)(service.executeHealthCheckRound()).resolves.not.toThrow();
        }));
    });
    (0, globals_1.describe)('performHealthCheckRound (via task execution)', () => {
        (0, globals_1.it)('should get all active VMs and queue health checks', () => __awaiter(void 0, void 0, void 0, function* () {
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                // Execute the task function to test the actual implementation
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: machine_status_1.RUNNING_STATUS },
                select: {
                    id: true,
                    name: true,
                    status: true,
                    os: true,
                    internalName: true
                }
            });
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(1);
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-1');
        }));
        (0, globals_1.it)('should emit round_started event', () => __awaiter(void 0, void 0, void 0, function* () {
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_started', globals_1.expect.objectContaining({
                vmCount: 1,
                timestamp: globals_1.expect.any(String)
            }));
        }));
        (0, globals_1.it)('should emit round_completed event with success statistics', () => __awaiter(void 0, void 0, void 0, function* () {
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_completed', globals_1.expect.objectContaining({
                totalVMs: 1,
                successCount: 1,
                failureCount: 0,
                executionTimeMs: globals_1.expect.any(Number),
                timestamp: globals_1.expect.any(String)
            }));
        }));
        (0, globals_1.it)('should handle VM health check queuing failures', () => __awaiter(void 0, void 0, void 0, function* () {
            // Set up two running VMs to test both success and failure scenarios
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([
                {
                    id: 'vm-1',
                    name: 'test-vm-1',
                    status: machine_status_1.RUNNING_STATUS,
                    userId: 'user-1',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    internalName: 'test-vm-1',
                    os: 'ubuntu',
                    cpuCores: 2,
                    ramGB: 4,
                    diskSizeGB: 50,
                    departmentId: null,
                    templateId: null,
                    gpuPciAddress: null,
                    firewallRuleSetId: null,
                    version: 1,
                    localIP: null,
                    publicIP: null
                },
                {
                    id: 'vm-2',
                    name: 'test-vm-2',
                    status: machine_status_1.RUNNING_STATUS,
                    userId: 'user-2',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    internalName: 'test-vm-2',
                    os: 'windows',
                    cpuCores: 4,
                    ramGB: 8,
                    diskSizeGB: 100,
                    departmentId: null,
                    templateId: null,
                    gpuPciAddress: null,
                    firewallRuleSetId: null,
                    version: 1,
                    localIP: null,
                    publicIP: null
                }
            ]);
            const error = new Error('Queue full');
            mockQueueManager.queueHealthChecks.mockRejectedValueOnce(error);
            mockQueueManager.queueHealthChecks.mockResolvedValueOnce(undefined);
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_completed', globals_1.expect.objectContaining({
                totalVMs: 2,
                successCount: 1,
                failureCount: 1
            }));
        }));
        (0, globals_1.it)('should emit round_failed event when task execution fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const taskError = new Error('Database connection failed');
            jest_setup_1.mockPrisma.machine.findMany.mockRejectedValue(taskError);
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_failed', globals_1.expect.objectContaining({
                error: 'Database connection failed',
                executionTimeMs: globals_1.expect.any(Number),
                timestamp: globals_1.expect.any(String)
            }));
        }));
        (0, globals_1.it)('should handle empty VM list', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([]);
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_completed', globals_1.expect.objectContaining({
                totalVMs: 0,
                successCount: 0,
                failureCount: 0
            }));
        }));
    });
    (0, globals_1.describe)('triggerHealthCheckRound', () => {
        (0, globals_1.it)('should manually trigger a health check round', () => __awaiter(void 0, void 0, void 0, function* () {
            mockBackgroundTaskService.queueTask.mockResolvedValue('manual-task-456');
            const taskId = yield service.triggerHealthCheckRound();
            (0, globals_1.expect)(typeof taskId).toBe('string');
            (0, globals_1.expect)(taskId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        }));
    });
    (0, globals_1.describe)('getStatus', () => {
        (0, globals_1.it)('should return service status when not started', () => {
            const status = service.getStatus();
            (0, globals_1.expect)(status).toEqual({
                isRunning: false,
                cronActive: false,
                nextRun: null
            });
        });
        (0, globals_1.it)('should return service status when started', () => {
            service.start();
            const status = service.getStatus();
            (0, globals_1.expect)(status).toEqual({
                isRunning: false, // Not running a health check round currently
                cronActive: true,
                nextRun: globals_1.expect.any(Date)
            });
        });
    });
    (0, globals_1.describe)('error handling in background task', () => {
        (0, globals_1.it)('should call onError callback when task fails', () => __awaiter(void 0, void 0, void 0, function* () {
            let errorCallback;
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn, options) => __awaiter(void 0, void 0, void 0, function* () {
                errorCallback = options === null || options === void 0 ? void 0 : options.onError;
                throw new Error('Task execution failed');
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(errorCallback).toBeDefined();
            if (errorCallback) {
                const testError = new Error('Test error');
                yield errorCallback(testError);
                (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_failed', globals_1.expect.objectContaining({
                    error: 'Test error',
                    timestamp: globals_1.expect.any(String)
                }));
            }
        }));
    });
    (0, globals_1.describe)('integration scenarios', () => {
        (0, globals_1.it)('should only process running VMs when mixed VM statuses exist', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([
                {
                    id: 'vm-running',
                    name: 'running-vm',
                    status: machine_status_1.RUNNING_STATUS,
                    userId: 'user-1',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    internalName: 'running-vm',
                    os: 'windows',
                    cpuCores: 2,
                    ramGB: 4,
                    diskSizeGB: 50,
                    departmentId: null,
                    templateId: null,
                    gpuPciAddress: null,
                    firewallRuleSetId: null,
                    version: 1,
                    localIP: null,
                    publicIP: null
                }
            ]);
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            // Should only queue health checks for running VMs
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: machine_status_1.RUNNING_STATUS },
                select: {
                    id: true,
                    name: true,
                    status: true,
                    os: true,
                    internalName: true
                }
            });
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(1);
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running');
        }));
        (0, globals_1.it)('should handle no running VMs scenario', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([]);
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: machine_status_1.RUNNING_STATUS },
                select: {
                    id: true,
                    name: true,
                    status: true,
                    os: true,
                    internalName: true
                }
            });
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_completed', globals_1.expect.objectContaining({
                totalVMs: 0,
                successCount: 0,
                failureCount: 0
            }));
        }));
        (0, globals_1.it)('should verify running VM status filtering with comprehensive test', () => __awaiter(void 0, void 0, void 0, function* () {
            // This test verifies that the service correctly filters for only running VMs
            // and ignores stopped, suspended, or other non-running states
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([
                {
                    id: 'vm-running-1',
                    name: 'running-vm-1',
                    status: machine_status_1.RUNNING_STATUS,
                    userId: 'user-1',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    internalName: 'running-vm-1',
                    os: 'windows',
                    cpuCores: 2,
                    ramGB: 4,
                    diskSizeGB: 50,
                    departmentId: null,
                    templateId: null,
                    gpuPciAddress: null,
                    firewallRuleSetId: null,
                    version: 1,
                    localIP: null,
                    publicIP: null
                },
                {
                    id: 'vm-running-2',
                    name: 'running-vm-2',
                    status: machine_status_1.RUNNING_STATUS,
                    userId: 'user-2',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    internalName: 'running-vm-2',
                    os: 'linux',
                    cpuCores: 4,
                    ramGB: 8,
                    diskSizeGB: 100,
                    departmentId: null,
                    templateId: null,
                    gpuPciAddress: null,
                    firewallRuleSetId: null,
                    version: 1,
                    localIP: null,
                    publicIP: null
                }
            ]);
            mockBackgroundTaskService.queueTask.mockImplementation((name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
                yield taskFn();
                return 'task-123';
            }));
            yield service.executeHealthCheckRound();
            // Verify database query filters for running VMs only
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: machine_status_1.RUNNING_STATUS },
                select: {
                    id: true,
                    name: true,
                    status: true,
                    os: true,
                    internalName: true
                }
            });
            // Verify both running VMs are processed
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(2);
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-1');
            (0, globals_1.expect)(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-2');
            // Verify events reflect correct VM count
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_started', globals_1.expect.objectContaining({
                vmCount: 2,
                timestamp: globals_1.expect.any(String)
            }));
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_completed', globals_1.expect.objectContaining({
                totalVMs: 2,
                successCount: 2,
                failureCount: 0
            }));
        }));
    });
});
