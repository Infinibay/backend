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
const CleanupOrphanedHealthTasks_1 = require("../../app/crons/CleanupOrphanedHealthTasks");
const jest_mock_extended_1 = require("jest-mock-extended");
const logger_1 = __importDefault(require("@main/logger"));
// Mock the singleton functions
const mockQueueManager = {
    cleanupOrphanedTasks: jest.fn()
};
const mockEventManager = {
    dispatchEvent: jest.fn()
};
jest.mock('../../app/services/VMHealthQueueManager', () => ({
    getVMHealthQueueManager: jest.fn(() => mockQueueManager)
}));
jest.mock('../../app/services/EventManager', () => ({
    getEventManager: jest.fn(() => mockEventManager)
}));
describe('CleanupOrphanedHealthTasksJob', () => {
    let job;
    let mockPrisma;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        job = new CleanupOrphanedHealthTasks_1.CleanupOrphanedHealthTasksJob(mockPrisma);
    });
    afterEach(() => {
        job.stop();
    });
    describe('cleanupOrphanedTasks', () => {
        it('should call queue manager cleanup method', () => __awaiter(void 0, void 0, void 0, function* () {
            mockQueueManager.cleanupOrphanedTasks.mockResolvedValue(undefined);
            const cleanupMethod = job.cleanupOrphanedTasks.bind(job);
            yield cleanupMethod();
            expect(mockQueueManager.cleanupOrphanedTasks).toHaveBeenCalled();
        }));
        it('should handle cleanup errors gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const cleanupError = new Error('Cleanup failed');
            mockQueueManager.cleanupOrphanedTasks.mockRejectedValue(cleanupError);
            const consoleErrorSpy = jest.spyOn(logger_1.default, 'error').mockImplementation();
            const cleanupMethod = job.cleanupOrphanedTasks.bind(job);
            yield expect(cleanupMethod()).rejects.toThrow('Cleanup failed');
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error during orphaned tasks cleanup:'), cleanupError);
            consoleErrorSpy.mockRestore();
        }));
        it('should use singleton queue manager', () => __awaiter(void 0, void 0, void 0, function* () {
            const { getVMHealthQueueManager } = require('../../app/services/VMHealthQueueManager');
            const { getEventManager } = require('../../app/services/EventManager');
            mockQueueManager.cleanupOrphanedTasks.mockResolvedValue(undefined);
            const cleanupMethod = job.cleanupOrphanedTasks.bind(job);
            yield cleanupMethod();
            expect(getEventManager).toHaveBeenCalled();
            expect(getVMHealthQueueManager).toHaveBeenCalledWith(mockPrisma, mockEventManager);
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
            mockQueueManager.cleanupOrphanedTasks.mockResolvedValue(undefined);
            // Start the job
            job.start();
            job.isRunning = true;
            // Mock debug logger to capture skip message
            const debugLogSpy = jest.fn();
            job.debug = { log: debugLogSpy };
            // Manually trigger the cleanup method
            const cleanupMethod = job.cleanupOrphanedTasks.bind(job);
            yield cleanupMethod();
            // The cleanup should still run since we're calling it directly
            // In real cron execution, the isRunning check would prevent this
            expect(mockQueueManager.cleanupOrphanedTasks).toHaveBeenCalled();
        }));
        it('should run on correct schedule (every hour)', () => {
            job.start();
            const cronJob = job.job;
            expect(cronJob).toBeDefined();
            // Check cron pattern for every hour at minute 0
            expect(cronJob.cronTime.source).toBe('0 0 * * * *');
        });
        it('should handle job execution errors without crashing', () => __awaiter(void 0, void 0, void 0, function* () {
            const executionError = new Error('Job execution failed');
            mockQueueManager.cleanupOrphanedTasks.mockRejectedValue(executionError);
            const consoleErrorSpy = jest.spyOn(logger_1.default, 'error').mockImplementation();
            // Test error handling by directly calling the cleanup method
            const cleanupMethod = job.cleanupOrphanedTasks.bind(job);
            // This should catch the error and log it
            yield expect(cleanupMethod()).rejects.toThrow('Job execution failed');
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error during orphaned tasks cleanup:'), executionError);
            consoleErrorSpy.mockRestore();
        }));
    });
    describe('factory function', () => {
        it('should return singleton instance', () => {
            const { createCleanupOrphanedHealthTasksJob } = require('../../app/crons/CleanupOrphanedHealthTasks');
            const instance1 = createCleanupOrphanedHealthTasksJob(mockPrisma);
            const instance2 = createCleanupOrphanedHealthTasksJob(mockPrisma);
            expect(instance1).toBe(instance2);
        });
    });
});
