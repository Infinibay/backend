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
const machineCleanupServiceV2_1 = require("@services/cleanup/machineCleanupServiceV2");
const jest_mock_extended_1 = require("jest-mock-extended");
// Mock InfinizationService
const mockInfinization = {
    destroyVM: jest.fn().mockResolvedValue(undefined),
    getVMStatus: jest.fn().mockResolvedValue({ processAlive: false })
};
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn(() => Promise.resolve(mockInfinization))
}));
// Mock VirtioSocketWatcherService
const mockVirtioService = {
    disconnectVm: jest.fn().mockResolvedValue(undefined),
    isVmConnected: jest.fn().mockReturnValue(false)
};
jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: jest.fn(() => mockVirtioService)
}));
// Mock fs/promises
jest.mock('fs/promises', () => ({
    unlink: jest.fn().mockResolvedValue(undefined),
    readdir: jest.fn().mockResolvedValue([]),
    access: jest.fn().mockRejectedValue(new Error('ENOENT')),
    stat: jest.fn().mockResolvedValue({ isFile: () => true })
}));
// Mock path
jest.mock('path', () => (Object.assign(Object.assign({}, jest.requireActual('path')), { join: jest.fn((...args) => args.join('/')) })));
describe('MachineCleanupService - Comprehensive Tests', () => {
    let service;
    let prisma;
    const mockVMId = 'test-vm-123';
    beforeEach(() => {
        jest.clearAllMocks();
        prisma = (0, jest_mock_extended_1.mockDeep)();
        prisma.machineConfiguration.delete.mockResolvedValue(null);
        prisma.machineApplication.deleteMany.mockResolvedValue({ count: 0 });
        prisma.pendingCommand.deleteMany.mockResolvedValue({ count: 0 });
        prisma.scriptExecution.deleteMany.mockResolvedValue({ count: 0 });
        prisma.firewallRule.deleteMany.mockResolvedValue({ count: 0 });
        prisma.firewallRuleSet.deleteMany.mockResolvedValue({ count: 0 });
        prisma.firewallRuleSet.findFirst.mockResolvedValue(null);
        prisma.machine.delete.mockResolvedValue({});
        prisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
            if (typeof fn === 'function') {
                return fn(prisma);
            }
            return fn;
        }));
        service = new machineCleanupServiceV2_1.MachineCleanupServiceV2(prisma);
    });
    describe('cleanupVM - Resource Cleanup', () => {
        it('should handle VM not found gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            prisma.machine.findUnique.mockResolvedValue(null);
            // Should not throw for non-existent VM, just return
            yield expect(service.cleanupVM('non-existent-vm')).resolves.toBeUndefined();
        }));
        it('should successfully clean up VM with configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: mockVMId,
                internalName: `vm-${mockVMId}`,
                status: 'stopped',
                configuration: {
                    id: 'config-1',
                    machineId: mockVMId,
                    qmpSocketPath: null,
                    qemuPid: null,
                    tapDeviceName: null,
                    guestAgentSocketPath: null,
                    infiniServiceSocketPath: null,
                    tpmSocketPath: null
                }
            };
            prisma.machine.findUnique.mockResolvedValue(mockMachine);
            yield expect(service.cleanupVM(mockVMId)).resolves.toBeUndefined();
            expect(prisma.machine.findUnique).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: mockVMId }
            }));
        }));
        it('should handle infinization errors and continue', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: mockVMId,
                internalName: `vm-${mockVMId}`,
                status: 'running',
                configuration: {
                    id: 'config-1',
                    machineId: mockVMId,
                    qmpSocketPath: null,
                    qemuPid: null,
                    tapDeviceName: null,
                    guestAgentSocketPath: null,
                    infiniServiceSocketPath: null,
                    tpmSocketPath: null
                }
            };
            prisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockInfinization.destroyVM.mockRejectedValueOnce(new Error('Failed to destroy'));
            // Cleanup should complete even with infinization failures
            yield expect(service.cleanupVM(mockVMId)).resolves.toBeUndefined();
        }));
        it('should handle missing configuration gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: mockVMId,
                internalName: `vm-${mockVMId}`,
                status: 'stopped',
                configuration: null
            };
            prisma.machine.findUnique.mockResolvedValue(mockMachine);
            yield expect(service.cleanupVM(mockVMId)).resolves.toBeUndefined();
        }));
    });
    describe('cleanupVM - Edge Cases', () => {
        it('should handle very long VM ID', () => __awaiter(void 0, void 0, void 0, function* () {
            const longVMId = 'a'.repeat(500);
            prisma.machine.findUnique.mockResolvedValue(null);
            yield expect(service.cleanupVM(longVMId)).resolves.toBeUndefined();
        }));
    });
    describe('cleanupVM - Performance', () => {
        it('should complete cleanup of multiple VMs in reasonable time', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmIds = Array.from({ length: 5 }, (_, i) => `test-vm-${i}`);
            const cleanupTimes = [];
            prisma.machine.findUnique.mockResolvedValue(null);
            const promises = vmIds.map((vmId) => __awaiter(void 0, void 0, void 0, function* () {
                const startTime = Date.now();
                yield service.cleanupVM(vmId);
                cleanupTimes.push(Date.now() - startTime);
            }));
            yield Promise.all(promises);
            const totalTime = cleanupTimes.reduce((sum, time) => sum + time, 0);
            expect(totalTime).toBeLessThan(5000);
        }));
    });
});
