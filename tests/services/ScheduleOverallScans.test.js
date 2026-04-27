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
const ScheduleOverallScans_1 = require("../../app/crons/ScheduleOverallScans");
const jest_mock_extended_1 = require("jest-mock-extended");
const logger_1 = __importDefault(require("@main/logger"));
describe('ScheduleOverallScansJob', () => {
    let job;
    let mockPrisma;
    let mockEventManager;
    let mockQueueManager;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockEventManager = (0, jest_mock_extended_1.mockDeep)();
        mockQueueManager = (0, jest_mock_extended_1.mockDeep)();
        job = new ScheduleOverallScans_1.ScheduleOverallScansJob(mockPrisma, mockEventManager);
        job.queueManager = mockQueueManager;
    });
    afterEach(() => {
        job.stop();
    });
    describe('scheduleOverdueScans', () => {
        it('should only schedule scans for running VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [
                { id: 'vm1', name: 'Running VM 1', status: 'running' },
                { id: 'vm2', name: 'Running VM 2', status: 'running' }
            ];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.getOverallScanIntervalMinutes.mockResolvedValue(60);
            mockQueueManager.getLastOverallScanTime.mockResolvedValue(null); // No previous scans
            mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue(null); // No pending checks
            mockQueueManager.queueHealthCheck.mockResolvedValue('queue-id');
            const scheduleMethod = job.scheduleOverdueScans.bind(job);
            yield scheduleMethod();
            expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: 'running' },
                select: { id: true, name: true, status: true }
            });
            expect(mockQueueManager.queueHealthCheck).toHaveBeenCalledTimes(2);
            expect(mockQueueManager.queueHealthCheck).toHaveBeenCalledWith('vm1', 'OVERALL_STATUS', 'MEDIUM');
            expect(mockQueueManager.queueHealthCheck).toHaveBeenCalledWith('vm2', 'OVERALL_STATUS', 'MEDIUM');
        }));
        it('should use per-VM intervals for overdue detection', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [
                { id: 'vm1', name: 'Fast VM', status: 'running' },
                { id: 'vm2', name: 'Slow VM', status: 'running' }
            ];
            const now = new Date();
            const vm1LastScan = new Date(now.getTime() - 31 * 60 * 1000); // 31 minutes ago
            const vm2LastScan = new Date(now.getTime() - 61 * 60 * 1000); // 61 minutes ago
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            // VM1 has 30-minute interval, VM2 has 60-minute interval
            mockQueueManager.getOverallScanIntervalMinutes
                .mockResolvedValueOnce(30) // vm1
                .mockResolvedValueOnce(60); // vm2
            mockQueueManager.getLastOverallScanTime
                .mockResolvedValueOnce(vm1LastScan) // vm1 - overdue (31min > 30min)
                .mockResolvedValueOnce(vm2LastScan); // vm2 - overdue (61min > 60min)
            mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue(null);
            mockQueueManager.queueHealthCheck.mockResolvedValue('queue-id');
            const scheduleMethod = job.scheduleOverdueScans.bind(job);
            yield scheduleMethod();
            // Both VMs should be scheduled since both are overdue according to their intervals
            expect(mockQueueManager.queueHealthCheck).toHaveBeenCalledTimes(2);
        }));
        it('should honor exponential backoff for failed scans', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [
                { id: 'vm1', name: 'Failing VM', status: 'running' }
            ];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.getOverallScanIntervalMinutes.mockResolvedValue(60);
            mockQueueManager.getLastOverallScanTime.mockResolvedValue(null); // No previous scans
            // Mock recent failures for backoff calculation
            const recentFailures = [
                { id: 'fail1', executedAt: new Date(Date.now() - 10 * 60 * 1000) }, // 10 min ago
                { id: 'fail2', executedAt: new Date(Date.now() - 20 * 60 * 1000) }, // 20 min ago
                { id: 'fail3', executedAt: new Date(Date.now() - 30 * 60 * 1000) } // 30 min ago
            ];
            mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue(recentFailures);
            // Mock alert creation for repeated failures
            mockPrisma.vMHealthAlert.create.mockResolvedValue({});
            const scheduleMethod = job.scheduleOverdueScans.bind(job);
            yield scheduleMethod();
            // Should not schedule due to backoff
            expect(mockQueueManager.queueHealthCheck).not.toHaveBeenCalled();
            // Should create health alert for repeated failures
            expect(mockPrisma.vMHealthAlert.create).toHaveBeenCalledWith({
                data: {
                    machineId: 'vm1',
                    type: 'REPEATED_SCAN_FAILURES',
                    severity: 'WARNING',
                    title: 'Repeated Health Scan Failures',
                    description: expect.stringContaining('3 consecutive overall scan failures'),
                    metadata: {
                        failureCount: 3,
                        backoffMinutes: expect.any(Number),
                        checkType: 'OVERALL_STATUS'
                    }
                }
            });
        }));
        it('should not schedule when pending checks exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [
                { id: 'vm1', name: 'VM with pending', status: 'running' }
            ];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.getOverallScanIntervalMinutes.mockResolvedValue(60);
            mockQueueManager.getLastOverallScanTime.mockResolvedValue(null); // No previous scans
            // Mock existing pending check
            mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue({
                id: 'pending-check'
            });
            // Mock no recent failures (no backoff)
            mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue([]);
            const scheduleMethod = job.scheduleOverdueScans.bind(job);
            yield scheduleMethod();
            expect(mockQueueManager.queueHealthCheck).not.toHaveBeenCalled();
        }));
        it('should handle individual VM errors gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [
                { id: 'vm1', name: 'Good VM', status: 'running' },
                { id: 'vm2', name: 'Error VM', status: 'running' }
            ];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.getOverallScanIntervalMinutes.mockResolvedValue(60);
            // First VM succeeds
            mockQueueManager.getLastOverallScanTime
                .mockResolvedValueOnce(null)
                .mockRejectedValueOnce(new Error('Database error'));
            mockPrisma.vMHealthCheckQueue.findFirst.mockResolvedValue(null);
            mockPrisma.vMHealthCheckQueue.findMany.mockResolvedValue([]);
            mockQueueManager.queueHealthCheck.mockResolvedValue('queue-id');
            const consoleErrorSpy = jest.spyOn(logger_1.default, 'error').mockImplementation();
            const scheduleMethod = job.scheduleOverdueScans.bind(job);
            yield scheduleMethod();
            // Should still schedule for the good VM
            expect(mockQueueManager.queueHealthCheck).toHaveBeenCalledWith('vm1', 'OVERALL_STATUS', 'MEDIUM');
            // Should log error for the failing VM
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to check/schedule overall scan for VM Error VM'), expect.any(Error));
            consoleErrorSpy.mockRestore();
        }));
    });
    describe('job lifecycle', () => {
        it('should start and stop correctly', () => {
            expect(() => job.start()).not.toThrow();
            expect(() => job.stop()).not.toThrow();
        });
        it('should not start multiple times', () => {
            job.start();
            // Get reference to the first job instance
            const firstJob = job.job;
            // Try to start again
            expect(() => job.start()).not.toThrow();
            // Verify the job instance hasn't changed (same job is reused)
            const secondJob = job.job;
            expect(secondJob).toBe(firstJob);
        });
    });
});
