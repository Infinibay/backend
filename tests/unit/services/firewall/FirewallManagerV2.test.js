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
const FirewallManagerV2_1 = require("../../../../app/services/firewall/FirewallManagerV2");
const client_1 = require("@prisma/client");
const jest_mock_extended_1 = require("jest-mock-extended");
// Mock nftables
const mockNftables = {
    createVMChain: jest.fn(),
    applyRules: jest.fn(),
    removeVMChain: jest.fn(),
    flushVMRules: jest.fn()
};
// Mock InfinizationService
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn(() => Promise.resolve({
        getNftablesService: () => mockNftables
    }))
}));
describe('FirewallManagerV2', () => {
    let manager;
    let mockPrisma;
    const mockDepartment = {
        id: 'dept-123',
        name: 'Engineering',
        firewallRuleSet: {
            id: 'ruleset-dept-1',
            rules: [
                { id: 'rule-1', name: 'Allow HTTPS', action: 'ACCEPT', direction: 'INOUT', priority: 500 }
            ]
        }
    };
    const mockVM = {
        id: 'vm-123',
        name: 'Test VM',
        department: mockDepartment,
        firewallRuleSet: {
            id: 'ruleset-vm-1',
            rules: [
                { id: 'rule-2', name: 'Allow SSH', action: 'ACCEPT', direction: 'INOUT', priority: 500 }
            ]
        }
    };
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        manager = new FirewallManagerV2_1.FirewallManagerV2(mockPrisma);
    });
    describe('ensureFirewallInfrastructure', () => {
        it('should create ruleset for department if not exists', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.firewallRuleSet.findFirst.mockResolvedValue(null);
            mockPrisma.firewallRuleSet.create.mockResolvedValue({
                id: 'ruleset-1',
                name: 'Department Firewall: Engineering',
                internalName: 'ibay-dept-abc12345'
            });
            mockPrisma.department.update.mockResolvedValue({});
            const result = yield manager.ensureFirewallInfrastructure(client_1.RuleSetType.DEPARTMENT, 'dept-123', 'Department Firewall: Engineering');
            expect(result.ruleSetCreated).toBe(true);
            expect(mockPrisma.firewallRuleSet.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    entityType: client_1.RuleSetType.DEPARTMENT,
                    entityId: 'dept-123',
                    priority: 1000
                })
            });
        }));
        it('should create ruleset for VM if not exists', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.firewallRuleSet.findFirst.mockResolvedValue(null);
            mockPrisma.firewallRuleSet.create.mockResolvedValue({
                id: 'ruleset-1',
                name: 'VM Firewall: Test VM',
                internalName: 'ibay-vm-abc12345'
            });
            mockPrisma.machine.update.mockResolvedValue({});
            const result = yield manager.ensureFirewallInfrastructure(client_1.RuleSetType.VM, 'vm-123', 'VM Firewall: Test VM');
            expect(result.ruleSetCreated).toBe(true);
            expect(mockPrisma.firewallRuleSet.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    entityType: client_1.RuleSetType.VM,
                    entityId: 'vm-123',
                    priority: 500
                })
            });
        }));
        it('should not create ruleset if already exists', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.firewallRuleSet.findFirst.mockResolvedValue({
                id: 'existing-ruleset'
            });
            mockPrisma.machine.findUnique.mockResolvedValue({
                firewallRuleSetId: 'existing-ruleset'
            });
            const result = yield manager.ensureFirewallInfrastructure(client_1.RuleSetType.VM, 'vm-123', 'VM Firewall: Test VM');
            expect(result.ruleSetCreated).toBe(false);
            expect(mockPrisma.firewallRuleSet.create).not.toHaveBeenCalled();
        }));
    });
    describe('ensureFirewallForVM', () => {
        it('should setup complete firewall for VM', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockPrisma.firewallRuleSet.findFirst.mockResolvedValue({
                rules: []
            });
            mockNftables.createVMChain.mockResolvedValue('ibay-vm-123');
            mockNftables.applyRules.mockResolvedValue({
                appliedRules: 2,
                failedRules: 0
            });
            const result = yield manager.ensureFirewallForVM('vm-123', 'dept-123', 'tap-vm-123');
            expect(result.success).toBe(true);
            expect(result.chainName).toBe('ibay-vm-123');
            expect(mockNftables.createVMChain).toHaveBeenCalledWith('vm-123', 'tap-vm-123');
            expect(mockNftables.applyRules).toHaveBeenCalledWith('vm-123', 'tap-vm-123', expect.any(Array), expect.any(Array));
        }));
        it('should throw error if VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield expect(manager.ensureFirewallForVM('vm-123', 'dept-123', 'tap-vm-123')).rejects.toThrow('VM not found');
        }));
        it('should throw error if department mismatch', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(Object.assign(Object.assign({}, mockVM), { department: Object.assign(Object.assign({}, mockDepartment), { id: 'different-dept' }) }));
            yield expect(manager.ensureFirewallForVM('vm-123', 'dept-123', 'tap-vm-123')).rejects.toThrow('Department mismatch');
        }));
    });
    describe('resyncVMFirewall', () => {
        it('should resync firewall rules', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockPrisma.firewallRuleSet.findFirst.mockResolvedValue({
                rules: []
            });
            mockNftables.applyRules.mockResolvedValue({
                appliedRules: 2,
                failedRules: 0
            });
            const result = yield manager.resyncVMFirewall('vm-123', 'tap-vm-123');
            expect(result.success).toBe(true);
            expect(result.chainApplied).toBe(true);
            expect(mockNftables.applyRules).toHaveBeenCalled();
        }));
        it('should throw error if VM has no department', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(Object.assign(Object.assign({}, mockVM), { department: null }));
            yield expect(manager.resyncVMFirewall('vm-123', 'tap-vm-123')).rejects.toThrow('has no department');
        }));
    });
    describe('removeVMFirewall', () => {
        it('should remove VM firewall chain', () => __awaiter(void 0, void 0, void 0, function* () {
            mockNftables.removeVMChain.mockResolvedValue(undefined);
            yield manager.removeVMFirewall('vm-123');
            expect(mockNftables.removeVMChain).toHaveBeenCalledWith('vm-123');
        }));
        it('should not throw on removal failure', () => __awaiter(void 0, void 0, void 0, function* () {
            mockNftables.removeVMChain.mockRejectedValue(new Error('Chain not found'));
            // Should not throw
            yield expect(manager.removeVMFirewall('vm-123')).resolves.not.toThrow();
        }));
    });
    describe('flushVMRules', () => {
        it('should flush VM firewall rules', () => __awaiter(void 0, void 0, void 0, function* () {
            mockNftables.flushVMRules.mockResolvedValue(undefined);
            yield manager.flushVMRules('vm-123');
            expect(mockNftables.flushVMRules).toHaveBeenCalledWith('vm-123');
        }));
        it('should not throw on flush failure', () => __awaiter(void 0, void 0, void 0, function* () {
            mockNftables.flushVMRules.mockRejectedValue(new Error('Chain not found'));
            // Should not throw
            yield expect(manager.flushVMRules('vm-123')).resolves.not.toThrow();
        }));
    });
});
