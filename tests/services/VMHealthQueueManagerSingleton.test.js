"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const VMHealthQueueManager_1 = require("../../app/services/VMHealthQueueManager");
const jest_setup_1 = require("../setup/jest.setup");
describe('VMHealthQueueManager Singleton', () => {
    it('should return the same instance when called multiple times', () => {
        const mockEventManager = {
            dispatchEvent: jest.fn()
        };
        const instance1 = (0, VMHealthQueueManager_1.getVMHealthQueueManager)(jest_setup_1.mockPrisma, mockEventManager);
        const instance2 = (0, VMHealthQueueManager_1.getVMHealthQueueManager)(jest_setup_1.mockPrisma, mockEventManager);
        expect(instance1).toBe(instance2);
    });
    it('should have the required methods', () => {
        const mockEventManager = {
            dispatchEvent: jest.fn()
        };
        const instance = (0, VMHealthQueueManager_1.getVMHealthQueueManager)(jest_setup_1.mockPrisma, mockEventManager);
        expect(typeof instance.queueHealthCheck).toBe('function');
        expect(typeof instance.processQueue).toBe('function');
        expect(typeof instance.getLastOverallScanTime).toBe('function');
        expect(typeof instance.loadPendingTasksForVm).toBe('function');
        expect(typeof instance.syncFromDatabase).toBe('function');
        expect(typeof instance.cleanupOrphanedTasks).toBe('function');
    });
});
