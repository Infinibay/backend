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
const FirewallOrchestrationService_1 = require("@services/firewall/FirewallOrchestrationService");
const client_1 = require("@prisma/client");
const jest_mock_extended_1 = require("jest-mock-extended");
const mockPrisma = (0, jest_mock_extended_1.mockDeep)();
describe('FirewallOrchestrationService', () => {
    let service;
    let mockRuleService;
    let mockValidationService;
    let mockInfinizationService;
    beforeEach(() => {
        mockRuleService = (0, jest_mock_extended_1.mockDeep)();
        mockValidationService = (0, jest_mock_extended_1.mockDeep)();
        mockInfinizationService = (0, jest_mock_extended_1.mockDeep)();
        service = new FirewallOrchestrationService_1.FirewallOrchestrationService(mockPrisma, mockRuleService, mockValidationService, mockInfinizationService);
        jest.clearAllMocks();
    });
    describe('getEffectiveRules', () => {
        it('should merge department and VM rules', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    id: 'dept-123',
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                name: 'Dept: Allow HTTP',
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.IN,
                                protocol: 'tcp',
                                dstPortStart: 80,
                                dstPortEnd: 80,
                                priority: 100,
                                overridesDept: false
                            }
                        ]
                    }
                },
                firewallRuleSet: {
                    rules: [
                        {
                            id: 'vm-rule-1',
                            name: 'VM: Allow HTTPS',
                            action: client_1.RuleAction.ACCEPT,
                            direction: client_1.RuleDirection.IN,
                            protocol: 'tcp',
                            dstPortStart: 443,
                            dstPortEnd: 443,
                            priority: 200,
                            overridesDept: false
                        }
                    ]
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const result = yield service.getEffectiveRules('vm-123');
            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('dept-rule-1');
            expect(result[1].id).toBe('vm-rule-1');
        }));
        it('should filter out department rules overridden by VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    id: 'dept-123',
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                name: 'Dept: Allow SSH',
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.IN,
                                protocol: 'tcp',
                                dstPortStart: 22,
                                dstPortEnd: 22,
                                priority: 100,
                                overridesDept: false
                            }
                        ]
                    }
                },
                firewallRuleSet: {
                    rules: [
                        {
                            id: 'vm-rule-1',
                            name: 'VM: Block SSH',
                            action: client_1.RuleAction.DROP,
                            direction: client_1.RuleDirection.IN,
                            protocol: 'tcp',
                            dstPortStart: 22,
                            dstPortEnd: 22,
                            priority: 50,
                            overridesDept: true // This overrides the department rule
                        }
                    ]
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const result = yield service.getEffectiveRules('vm-123');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('vm-rule-1');
        }));
        it('should sort rules by priority', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                priority: 500,
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.IN,
                                protocol: 'tcp',
                                dstPortStart: 80,
                                dstPortEnd: 80,
                                overridesDept: false
                            }
                        ]
                    }
                },
                firewallRuleSet: {
                    rules: [
                        {
                            id: 'vm-rule-1',
                            priority: 100,
                            action: client_1.RuleAction.ACCEPT,
                            direction: client_1.RuleDirection.IN,
                            protocol: 'tcp',
                            dstPortStart: 443,
                            dstPortEnd: 443,
                            overridesDept: false
                        }
                    ]
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const result = yield service.getEffectiveRules('vm-123');
            expect(result[0].priority).toBe(100);
            expect(result[1].priority).toBe(500);
        }));
    });
    describe('applyVMRules', () => {
        it('should validate and apply rules via nftables', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-websrv-01',
                department: {
                    firewallRuleSet: { rules: [] }
                },
                firewallRuleSet: {
                    id: 'ruleset-123',
                    rules: [
                        {
                            id: 'rule-1',
                            name: 'Allow HTTP',
                            action: client_1.RuleAction.ACCEPT,
                            direction: client_1.RuleDirection.IN,
                            protocol: 'tcp',
                            dstPortStart: 80,
                            dstPortEnd: 80,
                            priority: 100,
                            overridesDept: false
                        }
                    ]
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockValidationService.validateRuleConflicts.mockResolvedValue({
                isValid: true,
                conflicts: [],
                warnings: []
            });
            mockInfinizationService.convertPrismaRulesToInput.mockReturnValue([]);
            mockInfinizationService.applyVMRules.mockResolvedValue({
                appliedRules: 1,
                totalRules: 1,
                failedRules: 0,
                failures: [],
                chainName: 'vm_abc12345'
            });
            mockRuleService.updateRuleSetSyncTimestamp.mockResolvedValue(undefined);
            const result = yield service.applyVMRules('vm-123');
            expect(result.success).toBe(true);
            expect(result.rulesApplied).toBe(1);
            expect(result.chainName).toBe('vm_abc12345');
            expect(mockValidationService.validateRuleConflicts).toHaveBeenCalled();
            expect(mockInfinizationService.applyVMRules).toHaveBeenCalled();
        }));
        it('should throw error when validation fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-websrv-01',
                department: { firewallRuleSet: { rules: [] } },
                firewallRuleSet: { rules: [] }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockValidationService.validateRuleConflicts.mockResolvedValue({
                isValid: false,
                conflicts: [{ type: 'CONTRADICTORY', message: 'Rules conflict' }],
                warnings: []
            });
            yield expect(service.applyVMRules('vm-123')).rejects.toThrow('rule conflicts');
        }));
    });
    describe('applyDepartmentRules', () => {
        it('should apply department rules to all VMs in department', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockDepartment = {
                id: 'dept-123',
                firewallRuleSet: {
                    id: 'ruleset-dept',
                    rules: [
                        {
                            id: 'dept-rule-1',
                            name: 'Dept: Allow HTTP',
                            action: client_1.RuleAction.ACCEPT,
                            direction: client_1.RuleDirection.IN,
                            protocol: 'tcp',
                            dstPortStart: 80,
                            dstPortEnd: 80,
                            priority: 100
                        }
                    ]
                },
                machines: [{ id: 'vm-1', internalName: 'vm-1' }, { id: 'vm-2', internalName: 'vm-2' }]
            };
            // Mock the department lookup
            mockPrisma.department = {
                findUnique: jest.fn().mockResolvedValue(mockDepartment)
            };
            mockValidationService.validateRuleConflicts.mockResolvedValue({
                isValid: true,
                conflicts: [],
                warnings: []
            });
            mockInfinizationService.convertPrismaRulesToInput.mockReturnValue([]);
            mockInfinizationService.applyDepartmentRules.mockResolvedValue({
                totalVms: 2,
                vmsUpdated: 2,
                errors: []
            });
            mockRuleService.updateRuleSetSyncTimestamp.mockResolvedValue(undefined);
            const result = yield service.applyDepartmentRules('dept-123');
            expect(result.success).toBe(true);
            expect(result.vmsUpdated).toBe(2);
        }));
    });
    describe('validateVMRuleAgainstDepartment', () => {
        it('should detect conflict when VM rule blocks traffic allowed by department', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    id: 'dept-123',
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                name: 'DNS - DNS queries (TCP)',
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.INOUT,
                                protocol: 'tcp',
                                dstPortStart: 53,
                                dstPortEnd: 53,
                                srcIpAddr: null,
                                dstIpAddr: null,
                                priority: 100,
                                overridesDept: false
                            }
                        ]
                    }
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const newRule = {
                name: 'Block 53',
                action: client_1.RuleAction.DROP,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 53,
                dstPortEnd: 53,
                overridesDept: false
            };
            const result = yield service.validateVMRuleAgainstDepartment('vm-123', newRule);
            expect(result.isValid).toBe(false);
            expect(result.conflicts).toHaveLength(1);
            expect(result.conflicts[0]).toContain('conflicts with department rule');
            expect(result.conflicts[0]).toContain('overridesDept=true');
        }));
        it('should allow rule when overridesDept is true', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    id: 'dept-123',
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                name: 'Allow SSH',
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.IN,
                                protocol: 'tcp',
                                dstPortStart: 22,
                                dstPortEnd: 22,
                                srcIpAddr: null,
                                dstIpAddr: null,
                                priority: 100,
                                overridesDept: false
                            }
                        ]
                    }
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const newRule = {
                name: 'Block SSH',
                action: client_1.RuleAction.DROP,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                overridesDept: true
            };
            const result = yield service.validateVMRuleAgainstDepartment('vm-123', newRule);
            expect(result.isValid).toBe(true);
            expect(result.conflicts).toHaveLength(0);
        }));
        it('should handle INOUT direction matching both IN and OUT', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    id: 'dept-123',
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                name: 'Allow DNS Both Directions',
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.INOUT,
                                protocol: 'udp',
                                dstPortStart: 53,
                                dstPortEnd: 53,
                                srcIpAddr: null,
                                dstIpAddr: null,
                                priority: 100,
                                overridesDept: false
                            }
                        ]
                    }
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const newRule = {
                name: 'Block DNS Incoming',
                action: client_1.RuleAction.DROP,
                direction: client_1.RuleDirection.IN,
                protocol: 'udp',
                dstPortStart: 53,
                dstPortEnd: 53,
                overridesDept: false
            };
            const result = yield service.validateVMRuleAgainstDepartment('vm-123', newRule);
            expect(result.isValid).toBe(false);
            expect(result.conflicts).toHaveLength(1);
            expect(result.conflicts[0]).toContain('conflicts with department rule');
        }));
        it('should allow non-conflicting rules', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    id: 'dept-123',
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                name: 'Allow HTTP',
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.IN,
                                protocol: 'tcp',
                                dstPortStart: 80,
                                dstPortEnd: 80,
                                srcIpAddr: null,
                                dstIpAddr: null,
                                priority: 100,
                                overridesDept: false
                            }
                        ]
                    }
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const newRule = {
                name: 'Allow HTTPS',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 443,
                dstPortEnd: 443,
                overridesDept: false
            };
            const result = yield service.validateVMRuleAgainstDepartment('vm-123', newRule);
            expect(result.isValid).toBe(true);
            expect(result.conflicts).toHaveLength(0);
        }));
        it('should allow same action rules (no conflict)', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockVM = {
                id: 'vm-123',
                internalName: 'vm-123',
                department: {
                    id: 'dept-123',
                    firewallRuleSet: {
                        rules: [
                            {
                                id: 'dept-rule-1',
                                name: 'Allow SSH',
                                action: client_1.RuleAction.ACCEPT,
                                direction: client_1.RuleDirection.IN,
                                protocol: 'tcp',
                                dstPortStart: 22,
                                dstPortEnd: 22,
                                srcIpAddr: null,
                                dstIpAddr: null,
                                priority: 100,
                                overridesDept: false
                            }
                        ]
                    }
                }
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            const newRule = {
                name: 'Also Allow SSH',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                overridesDept: false
            };
            const result = yield service.validateVMRuleAgainstDepartment('vm-123', newRule);
            expect(result.isValid).toBe(true);
            expect(result.conflicts).toHaveLength(0);
        }));
    });
});
