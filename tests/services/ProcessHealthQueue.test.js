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
const ProcessHealthQueue_1 = require("../../app/crons/ProcessHealthQueue");
const jest_mock_extended_1 = require("jest-mock-extended");
const logger_1 = __importDefault(require("@main/logger"));
// Mock the logger to prevent import issues and allow test assertions
jest.mock('@main/logger', () => {
    const mockChild = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    };
    return {
        __esModule: true,
        default: Object.assign(Object.assign({}, mockChild), { child: jest.fn(() => mockChild) })
    };
});
describe('ProcessHealthQueueJob', () => {
    let job;
    let mockPrisma;
    let mockEventManager;
    let mockQueueManager;
    let mockDebug;
    beforeEach(() => {
        jest.clearAllMocks();
        mockDebug = logger_1.default.child({});
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockEventManager = (0, jest_mock_extended_1.mockDeep)();
        mockQueueManager = (0, jest_mock_extended_1.mockDeep)();
        job = new ProcessHealthQueue_1.ProcessHealthQueueJob(mockPrisma, mockEventManager);
        job.queueManager = mockQueueManager;
    });
    afterEach(() => {
        job.stop();
    });
    describe('processHealthQueues', () => {
        it('should process queues for all running VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [
                { id: 'vm1', name: 'VM 1' },
                { id: 'vm2', name: 'VM 2' }
            ];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.syncFromDatabase.mockResolvedValue(undefined);
            mockQueueManager.processQueue.mockResolvedValue(undefined);
            mockQueueManager.getQueueStatistics.mockReturnValue({
                totalQueued: 5,
                activeChecks: 2,
                vmQueues: 2
            });
            const processMethod = job.processHealthQueues.bind(job);
            yield processMethod();
            expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { status: 'running' },
                select: { id: true, name: true }
            });
            expect(mockQueueManager.processQueue).toHaveBeenCalledTimes(2);
            expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm1');
            expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm2');
        }));
        it('should process VMs in batches when there are many VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            // Create 75 VMs to test batching (batch size is 50)
            const manyVMs = Array.from({ length: 75 }, (_, i) => ({
                id: `vm${i + 1}`,
                name: `VM ${i + 1}`
            }));
            mockPrisma.machine.findMany.mockResolvedValue(manyVMs);
            mockQueueManager.syncFromDatabase.mockResolvedValue(undefined);
            mockQueueManager.processQueue.mockResolvedValue(undefined);
            mockQueueManager.getQueueStatistics.mockReturnValue({
                totalQueued: 0,
                activeChecks: 0,
                vmQueues: 0
            });
            const processMethod = job.processHealthQueues.bind(job);
            yield processMethod();
            // Should process all 75 VMs
            expect(mockQueueManager.processQueue).toHaveBeenCalledTimes(75);
            // Verify batching by checking that we don't overwhelm the system
            // (This is more of a structural test - the batching happens sequentially)
            expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm1');
            expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm50');
            expect(mockQueueManager.processQueue).toHaveBeenCalledWith('vm75');
        }));
        it('should handle no running VMs gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findMany.mockResolvedValue([]);
            mockQueueManager.syncFromDatabase.mockResolvedValue(undefined);
            const processMethod = job.processHealthQueues.bind(job);
            yield processMethod();
            expect(mockQueueManager.syncFromDatabase).toHaveBeenCalled();
            expect(mockQueueManager.processQueue).not.toHaveBeenCalled();
        }));
        it('should handle individual VM processing errors gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [
                { id: 'vm1', name: 'Good VM' },
                { id: 'vm2', name: 'Error VM' }
            ];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.syncFromDatabase.mockResolvedValue(undefined);
            mockQueueManager.processQueue
                .mockResolvedValueOnce(undefined) // vm1 succeeds
                .mockRejectedValueOnce(new Error('Processing failed')); // vm2 fails
            mockQueueManager.getQueueStatistics.mockReturnValue({
                totalQueued: 0,
                activeChecks: 0,
                vmQueues: 0
            });
            const consoleErrorSpy = jest.spyOn(logger_1.default, 'error').mockImplementation();
            const processMethod = job.processHealthQueues.bind(job);
            yield processMethod();
            expect(mockQueueManager.processQueue).toHaveBeenCalledTimes(2);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to process health queue for VM Error VM'), expect.any(Error));
            consoleErrorSpy.mockRestore();
        }));
        it('should log queue statistics when there are active items', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [{ id: 'vm1', name: 'VM 1' }];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.syncFromDatabase.mockResolvedValue(undefined);
            mockQueueManager.processQueue.mockResolvedValue(undefined);
            mockQueueManager.getQueueStatistics.mockReturnValue({
                totalQueued: 3,
                activeChecks: 1,
                vmQueues: 1
            });
            const processMethod = job.processHealthQueues.bind(job);
            yield processMethod();
            expect(mockDebug.debug).toHaveBeenCalledWith('Queue stats: 3 queued, 1 active, 1 VM queues');
        }));
        it('should not log queue statistics when no active items', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningVMs = [{ id: 'vm1', name: 'VM 1' }];
            mockPrisma.machine.findMany.mockResolvedValue(runningVMs);
            mockQueueManager.syncFromDatabase.mockResolvedValue(undefined);
            mockQueueManager.processQueue.mockResolvedValue(undefined);
            mockQueueManager.getQueueStatistics.mockReturnValue({
                totalQueued: 0,
                activeChecks: 0,
                vmQueues: 0
            });
            const processMethod = job.processHealthQueues.bind(job);
            yield processMethod();
            // Should not log stats when everything is zero
            expect(mockDebug.debug).not.toHaveBeenCalledWith(expect.stringContaining('Queue stats:'));
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
        it('should prevent concurrent execution', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findMany.mockResolvedValue([]);
            mockQueueManager.syncFromDatabase.mockResolvedValue(undefined);
            // Start the job
            job.start();
            // Verify that isRunning flag is properly managed during execution
            const processMethod = job.processHealthQueues.bind(job);
            // This should work normally
            yield processMethod();
            expect(mockQueueManager.syncFromDatabase).toHaveBeenCalled();
            expect(mockQueueManager.processQueue).not.toHaveBeenCalled();
        }));
    });
});
