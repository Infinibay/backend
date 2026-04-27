"use strict";
/**
 * Tests for firewall cleanup in MachineCleanupServiceV2
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
const jest_mock_extended_1 = require("jest-mock-extended");
const machineCleanupServiceV2_1 = require("@services/cleanup/machineCleanupServiceV2");
// Mock infinization
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn(() => ({
        destroyVM: jest.fn().mockResolvedValue({ success: true })
    }))
}));
// Mock VirtioSocketWatcherService
jest.mock('@services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: jest.fn(() => ({
        cleanupVmConnection: jest.fn()
    }))
}));
// Mock fs/promises
jest.mock('fs/promises', () => ({
    unlink: jest.fn().mockRejectedValue({ code: 'ENOENT' })
}));
describe('MachineCleanupServiceV2 - Firewall Cleanup', () => {
    let service;
    let mockPrisma;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockPrisma.machineApplication.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.pendingCommand.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.scriptExecution.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.firewallRule.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.$transaction.mockImplementation((callback) => __awaiter(void 0, void 0, void 0, function* () { return callback(mockPrisma); }));
        service = new machineCleanupServiceV2_1.MachineCleanupServiceV2(mockPrisma);
    });
    describe('cleanupVM', () => {
        it('should cleanup firewall resources via infinization when deleting VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm-123';
            const mockVM = {
                id: vmId,
                internalName: 'test-vm-internal',
                configuration: null,
                firewallRuleSet: {
                    id: 'ruleset-123',
                    internalName: 'vm_abc12345',
                    rules: [
                        { id: 'rule-1', name: 'Test Rule' }
                    ]
                }
            };
            // First call for initial lookup, second call inside transaction for firewall cleanup
            mockPrisma.machine.findUnique
                .mockResolvedValueOnce(mockVM)
                .mockResolvedValueOnce(mockVM)
                .mockResolvedValue(mockVM);
            const { getInfinization } = require('@services/InfinizationService');
            const mockInfinization = {
                destroyVM: jest.fn().mockResolvedValue({ success: true })
            };
            getInfinization.mockResolvedValue(mockInfinization);
            yield service.cleanupVM(vmId);
            // Verify infinization.destroyVM was called (handles TAP + firewall chain cleanup)
            expect(mockInfinization.destroyVM).toHaveBeenCalledWith(vmId);
        }));
        it('should cleanup FirewallRuleSet and rules from database', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm-456';
            const ruleSetId = 'ruleset-456';
            const mockVM = {
                id: vmId,
                internalName: 'test-vm-internal',
                configuration: null,
                firewallRuleSet: {
                    id: ruleSetId,
                    internalName: 'vm_def12345',
                    rules: [
                        { id: 'rule-1', name: 'Rule 1' },
                        { id: 'rule-2', name: 'Rule 2' }
                    ]
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const { getInfinization } = require('@services/InfinizationService');
            getInfinization.mockResolvedValue({
                destroyVM: jest.fn().mockResolvedValue({ success: true })
            });
            yield service.cleanupVM(vmId);
            // Verify FirewallRule deletion
            expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
                where: { ruleSetId }
            });
            // Verify FirewallRuleSet deletion
            expect(mockPrisma.firewallRuleSet.delete).toHaveBeenCalledWith({
                where: { id: ruleSetId }
            });
        }));
        it('should not fail if FirewallRuleSet does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm-no-firewall';
            const mockVM = {
                id: vmId,
                internalName: 'test-vm-internal',
                configuration: null,
                firewallRuleSet: null // No firewall rules
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const { getInfinization } = require('@services/InfinizationService');
            getInfinization.mockResolvedValue({
                destroyVM: jest.fn().mockResolvedValue({ success: true })
            });
            // Should not throw
            yield expect(service.cleanupVM(vmId)).resolves.not.toThrow();
            // Firewall deletion methods should not be called
            expect(mockPrisma.firewallRule.deleteMany).not.toHaveBeenCalled();
            expect(mockPrisma.firewallRuleSet.delete).not.toHaveBeenCalled();
        }));
        it('should complete VM deletion even if infinization cleanup fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm-fail-infini';
            const mockVM = {
                id: vmId,
                internalName: 'test-vm-internal',
                configuration: null,
                firewallRuleSet: {
                    id: 'ruleset-fail',
                    internalName: 'vm_fail1234',
                    rules: []
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const { getInfinization } = require('@services/InfinizationService');
            getInfinization.mockResolvedValue({
                destroyVM: jest.fn().mockResolvedValue({ success: false, error: 'Process not found' })
            });
            // Should not throw - cleanup should continue
            yield expect(service.cleanupVM(vmId)).resolves.not.toThrow();
            // VM should still be deleted from database
            expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
                where: { id: vmId }
            });
        }));
        it('should delete machine applications before VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'test-vm-apps';
            const mockVM = {
                id: vmId,
                internalName: 'test-vm-internal',
                configuration: null,
                firewallRuleSet: null
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const { getInfinization } = require('@services/InfinizationService');
            getInfinization.mockResolvedValue({
                destroyVM: jest.fn().mockResolvedValue({ success: true })
            });
            yield service.cleanupVM(vmId);
            // Verify deletion order (applications before machine)
            expect(mockPrisma.machineApplication.deleteMany).toHaveBeenCalledWith({
                where: { machineId: vmId }
            });
            expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
                where: { id: vmId }
            });
        }));
    });
});
