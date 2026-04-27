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
const BackgroundHealthService_1 = require("../../app/services/BackgroundHealthService");
const machine_status_1 = require("../../app/constants/machine-status");
// Mock dependencies
jest.mock('../../app/services/VMHealthQueueManager');
jest.mock('../../app/services/BackgroundTaskService');
jest.mock('../../app/services/EventManager');
/**
 * BackgroundHealthService Tests
 *
 * These tests verify the basic functionality of the BackgroundHealthService.
 * The service now filters for only running VMs when processing health checks,
 * and integrates with the updated VMHealthQueueManager that validates VM status.
 */
describe('BackgroundHealthService', () => {
    let service;
    let mockPrisma;
    let mockBackgroundTaskService;
    let mockEventManager;
    let mockQueueManager;
    beforeEach(() => {
        // Create mock instances
        mockPrisma = {
            machine: {
                findMany: jest.fn()
            }
        };
        mockBackgroundTaskService = {
            queueTask: jest.fn()
        };
        mockEventManager = {
            dispatchEvent: jest.fn()
        };
        mockQueueManager = {
            queueHealthChecks: jest.fn()
        };
        // Mock BackgroundTaskService.queueTask to execute the task function immediately
        mockBackgroundTaskService.queueTask.mockImplementation((_name, taskFn) => __awaiter(void 0, void 0, void 0, function* () {
            yield taskFn();
            return 'task-123';
        }));
        // Create service instance
        service = new BackgroundHealthService_1.BackgroundHealthService(mockPrisma, mockBackgroundTaskService, mockEventManager, mockQueueManager);
        mockPrisma.machine.findMany.mockResolvedValue([]);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('getStatus', () => {
        it('should return correct status when service is not running', () => {
            const status = service.getStatus();
            expect(status).toEqual({
                isRunning: false,
                cronActive: false,
                nextRun: null
            });
        });
        it('should return correct status when service is started', () => {
            service.start();
            const status = service.getStatus();
            expect(status.cronActive).toBe(true);
            expect(status.nextRun).toBeInstanceOf(Date);
        });
    });
    describe('triggerHealthCheckRound', () => {
        it('should return a task ID when triggered manually', () => __awaiter(void 0, void 0, void 0, function* () {
            const taskId = yield service.triggerHealthCheckRound();
            expect(typeof taskId).toBe('string');
            expect(taskId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
        }));
    });
    describe('start', () => {
        it('should start the cron job', () => {
            service.start();
            const status = service.getStatus();
            expect(status.cronActive).toBe(true);
        });
        it('should not start multiple cron jobs', () => {
            service.start();
            service.start(); // Second call should be ignored
            const status = service.getStatus();
            expect(status.cronActive).toBe(true);
        });
    });
    describe('VM status filtering integration', () => {
        it('should work with updated VMHealthQueueManager that validates VM status', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock running VMs data
            mockPrisma.machine.findMany.mockResolvedValue([
                {
                    id: 'vm-running-1',
                    name: 'running-vm-1',
                    status: machine_status_1.RUNNING_STATUS,
                    os: 'windows',
                    internalName: 'running-vm-1'
                }
            ]);
            // Mock the queue manager to simulate the new behavior where it validates VM status
            mockQueueManager.queueHealthChecks.mockImplementation((vmId) => __awaiter(void 0, void 0, void 0, function* () {
                // Simulate the VMHealthQueueManager checking VM status and only proceeding for running VMs
                return Promise.resolve();
            }));
            const taskId = yield service.triggerHealthCheckRound();
            expect(typeof taskId).toBe('string');
            expect(taskId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
            // Wait a bit for the task to complete since it's executed asynchronously
            yield new Promise(resolve => setTimeout(resolve, 50));
            // Verify the task was executed and proper database query was made
            expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: machine_status_1.RUNNING_STATUS },
                select: {
                    id: true,
                    name: true,
                    status: true,
                    os: true,
                    internalName: true
                }
            });
            // Verify queueHealthChecks was called only for running VMs
            expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(1);
            expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-1');
        }));
        it('should handle VMHealthQueueManager rejections for non-running VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock mixed VM data (running and stopped)
            mockPrisma.machine.findMany.mockResolvedValue([
                {
                    id: 'vm-running-1',
                    name: 'running-vm-1',
                    status: machine_status_1.RUNNING_STATUS,
                    os: 'windows',
                    internalName: 'running-vm-1'
                },
                {
                    id: 'vm-running-2',
                    name: 'running-vm-2',
                    status: machine_status_1.RUNNING_STATUS,
                    os: 'linux',
                    internalName: 'running-vm-2'
                }
            ]);
            // Mock the queue manager to reject health check queuing for one VM (simulating failure)
            mockQueueManager.queueHealthChecks
                .mockResolvedValueOnce(undefined) // First VM succeeds
                .mockRejectedValueOnce(new Error(`Cannot queue health check for VM running-vm-2 (vm-running-2) - VM status is '${machine_status_1.STOPPED_STATUS}', expected '${machine_status_1.RUNNING_STATUS}'`)); // Second VM fails
            // The service should handle this gracefully and continue processing
            const taskId = yield service.triggerHealthCheckRound();
            expect(typeof taskId).toBe('string');
            expect(taskId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
            // Wait a bit for the task to complete since it's executed asynchronously
            yield new Promise(resolve => setTimeout(resolve, 50));
            // Verify both VMs were attempted
            expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(2);
            expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-1');
            expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledWith('vm-running-2');
            // Verify events were dispatched with correct success/failure counts
            expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_completed', expect.objectContaining({
                totalVMs: 2,
                successCount: 1,
                failureCount: 1
            }));
        }));
    });
});
