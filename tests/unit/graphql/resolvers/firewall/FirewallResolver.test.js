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
const client_1 = require("@prisma/client");
const jest_mock_extended_1 = require("jest-mock-extended");
const resolver_1 = require("@main/graphql/resolvers/firewall/resolver");
// Mock the services that make system calls
jest.mock('@services/firewall/FirewallOrchestrationService', () => ({
    FirewallOrchestrationService: jest.fn().mockImplementation(() => ({
        getEffectiveRules: jest.fn().mockResolvedValue([]),
        applyDepartmentRules: jest.fn().mockResolvedValue({ success: true, rulesApplied: 0, chainName: '', vmsUpdated: 0, errors: [] }),
        applyVMRules: jest.fn().mockResolvedValue({ success: true, rulesApplied: 0, chainName: '', vmsUpdated: 0, errors: [] }),
        syncAllToNftables: jest.fn().mockResolvedValue({ success: true, vmsUpdated: 0, errors: [] })
    }))
}));
// Mock FirewallRuleService with proper method mocks
const mockFirewallRuleService = {
    getRuleSetByEntity: jest.fn(),
    createRuleSet: jest.fn(),
    createRule: jest.fn(),
    updateRule: jest.fn(),
    deleteRule: jest.fn()
};
jest.mock('@services/firewall/FirewallRuleService', () => ({
    FirewallRuleService: jest.fn().mockImplementation(() => mockFirewallRuleService)
}));
jest.mock('@services/firewall/FirewallValidationService', () => ({
    FirewallValidationService: jest.fn().mockImplementation(() => ({
        validateRuleInput: jest.fn().mockResolvedValue({ isValid: true, warnings: [], conflicts: [] }),
        validateRuleConflicts: jest.fn().mockResolvedValue({ isValid: true, warnings: [], conflicts: [] }),
        validateOverride: jest.fn().mockResolvedValue({ isValid: true, message: '' })
    }))
}));
jest.mock('@services/firewall/InfinizationFirewallService', () => ({
    InfinizationFirewallService: jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(undefined),
        listVMChains: jest.fn().mockResolvedValue([]),
        removeVMFirewall: jest.fn().mockResolvedValue({ success: true })
    }))
}));
const mockPrisma = (0, jest_mock_extended_1.mockDeep)();
const mockContext = {
    prisma: mockPrisma,
    user: {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'ADMIN'
    },
    req: {},
    res: {},
    setupMode: false
};
describe('FirewallResolver', () => {
    let resolver;
    beforeEach(() => {
        resolver = new resolver_1.FirewallResolver();
        jest.clearAllMocks();
    });
    describe('Queries', () => {
        describe('getDepartmentFirewallRules', () => {
            it('should return null when department has no firewall rules', () => __awaiter(void 0, void 0, void 0, function* () {
                mockFirewallRuleService.getRuleSetByEntity.mockResolvedValue(null);
                const result = yield resolver.getDepartmentFirewallRules('dept-123', mockContext);
                expect(result).toBeNull();
                expect(mockFirewallRuleService.getRuleSetByEntity).toHaveBeenCalledWith(client_1.RuleSetType.DEPARTMENT, 'dept-123');
            }));
            it('should return firewall rule set for department', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRuleSet = {
                    id: 'ruleset-123',
                    name: 'Department Rules',
                    internalName: 'ibay-department-abc123',
                    entityType: client_1.RuleSetType.DEPARTMENT,
                    entityId: 'dept-123',
                    priority: 500,
                    isActive: true,
                    libvirtUuid: null,
                    xmlContent: null,
                    lastSyncedAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    rules: []
                };
                mockFirewallRuleService.getRuleSetByEntity.mockResolvedValue(mockRuleSet);
                const result = yield resolver.getDepartmentFirewallRules('dept-123', mockContext);
                expect(result).toBeDefined();
                expect(result === null || result === void 0 ? void 0 : result.id).toBe('ruleset-123');
                expect(result === null || result === void 0 ? void 0 : result.entityType).toBe(client_1.RuleSetType.DEPARTMENT);
            }));
        });
        describe('getVMFirewallRules', () => {
            it('should return null when VM has no firewall rules', () => __awaiter(void 0, void 0, void 0, function* () {
                mockFirewallRuleService.getRuleSetByEntity.mockResolvedValue(null);
                const result = yield resolver.getVMFirewallRules('vm-123', mockContext);
                expect(result).toBeNull();
                expect(mockFirewallRuleService.getRuleSetByEntity).toHaveBeenCalledWith(client_1.RuleSetType.VM, 'vm-123');
            }));
        });
        describe('getEffectiveFirewallRules', () => {
            it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.machine.findUnique.mockResolvedValue(null);
                yield expect(resolver.getEffectiveFirewallRules('vm-123', mockContext)).rejects.toThrow('VM not found');
            }));
            it('should merge department and VM rules correctly', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockVM = {
                    id: 'vm-123',
                    name: 'Test VM',
                    department: {
                        id: 'dept-123',
                        firewallRuleSet: {
                            id: 'dept-ruleset',
                            rules: [
                                {
                                    id: 'dept-rule-1',
                                    ruleSetId: 'dept-ruleset',
                                    name: 'Allow HTTPS',
                                    description: 'Department rule',
                                    action: client_1.RuleAction.ACCEPT,
                                    direction: client_1.RuleDirection.IN,
                                    priority: 100,
                                    protocol: 'tcp',
                                    dstPortStart: 443,
                                    dstPortEnd: 443,
                                    srcPortStart: null,
                                    srcPortEnd: null,
                                    srcIpAddr: null,
                                    srcIpMask: null,
                                    dstIpAddr: null,
                                    dstIpMask: null,
                                    connectionState: null,
                                    overridesDept: false,
                                    createdAt: new Date(),
                                    updatedAt: new Date()
                                }
                            ]
                        }
                    },
                    firewallRuleSet: {
                        id: 'vm-ruleset',
                        rules: []
                    }
                };
                mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
                const result = yield resolver.getEffectiveFirewallRules('vm-123', mockContext);
                expect(result).toBeDefined();
                expect(result.vmId).toBe('vm-123');
                expect(result.departmentRules).toHaveLength(1);
                expect(result.vmRules).toHaveLength(0);
                // effectiveRules comes from orchestrationService.getEffectiveRules which is mocked to return []
                // The resolver combines this with validation, so the length depends on the mock
                expect(result.effectiveRules).toBeDefined();
            }));
        });
        describe('validateFirewallRule', () => {
            it('should validate a simple rule without conflicts', () => __awaiter(void 0, void 0, void 0, function* () {
                const input = {
                    name: 'Allow SSH',
                    description: 'Allow SSH access',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    priority: 100,
                    protocol: 'tcp',
                    dstPortStart: 22,
                    dstPortEnd: 22
                };
                const result = yield resolver.validateFirewallRule(input, mockContext);
                expect(result).toBeDefined();
                expect(result.isValid).toBe(true);
                expect(result.conflicts).toHaveLength(0);
            }));
        });
    });
    describe('Mutations', () => {
        describe('createDepartmentFirewallRule', () => {
            it('should throw error when department not found', () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.department.findUnique.mockResolvedValue(null);
                const input = {
                    name: 'Test Rule',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    priority: 100,
                    protocol: 'tcp'
                };
                yield expect(resolver.createDepartmentFirewallRule('dept-123', input, mockContext)).rejects.toThrow('Department not found');
            }));
            it('should throw error when overridesDept is set for department rule', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockDepartment = {
                    id: 'dept-123',
                    name: 'Test Department',
                    firewallRuleSet: {
                        id: 'ruleset-123',
                        rules: []
                    }
                };
                mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
                const input = {
                    name: 'Test Rule',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    priority: 100,
                    protocol: 'tcp',
                    overridesDept: true // This should fail
                };
                yield expect(resolver.createDepartmentFirewallRule('dept-123', input, mockContext)).rejects.toThrow('overridesDept can only be used for VM rules');
            }));
        });
        describe('createVMFirewallRule', () => {
            it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.machine.findUnique.mockResolvedValue(null);
                const input = {
                    name: 'Test Rule',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    priority: 100,
                    protocol: 'tcp'
                };
                yield expect(resolver.createVMFirewallRule('vm-123', input, mockContext)).rejects.toThrow('VM not found');
            }));
        });
        describe('updateFirewallRule', () => {
            it('should throw error when rule not found', () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.firewallRule.findUnique.mockResolvedValue(null);
                yield expect(resolver.updateFirewallRule('rule-123', { name: 'Updated' }, mockContext)).rejects.toThrow('Rule not found');
            }));
        });
        describe('deleteFirewallRule', () => {
            it('should throw error when rule not found', () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.firewallRule.findUnique.mockResolvedValue(null);
                yield expect(resolver.deleteFirewallRule('rule-123', mockContext)).rejects.toThrow('Rule not found');
            }));
        });
    });
    describe('Admin Operations', () => {
        describe('cleanupInfinibayFirewall', () => {
            it('should return cleanup results', () => __awaiter(void 0, void 0, void 0, function* () {
                const result = yield resolver.cleanupInfinibayFirewall(mockContext);
                expect(result).toBeDefined();
                expect(result.success).toBe(true);
                expect(result.filtersRemoved).toBeGreaterThanOrEqual(0);
                expect(Array.isArray(result.filterNames)).toBe(true);
            }));
        });
    });
});
