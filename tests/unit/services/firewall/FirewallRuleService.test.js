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
const FirewallRuleService_1 = require("@services/firewall/FirewallRuleService");
const client_1 = require("@prisma/client");
const jest_mock_extended_1 = require("jest-mock-extended");
const mockPrisma = (0, jest_mock_extended_1.mockDeep)();
describe('FirewallRuleService', () => {
    let service;
    beforeEach(() => {
        service = new FirewallRuleService_1.FirewallRuleService(mockPrisma);
        jest.clearAllMocks();
    });
    describe('createRuleSet', () => {
        it('should create a department rule set', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRuleSet = {
                id: 'ruleset-123',
                name: 'Engineering Department Firewall',
                internalName: 'ibay-dept-abc123',
                entityType: client_1.RuleSetType.DEPARTMENT,
                entityId: 'dept-abc123',
                priority: 500,
                isActive: true,
                rules: []
            };
            mockPrisma.firewallRuleSet.upsert.mockResolvedValue(mockRuleSet);
            const result = yield service.createRuleSet(client_1.RuleSetType.DEPARTMENT, 'dept-abc123', 'Engineering Department Firewall', 'ibay-dept-abc123');
            expect(result).toEqual(mockRuleSet);
            expect(mockPrisma.firewallRuleSet.upsert).toHaveBeenCalledWith({
                where: {
                    internalName: 'ibay-dept-abc123'
                },
                create: {
                    name: 'Engineering Department Firewall',
                    internalName: 'ibay-dept-abc123',
                    entityType: client_1.RuleSetType.DEPARTMENT,
                    entityId: 'dept-abc123',
                    priority: 500,
                    isActive: true
                },
                update: {
                    isActive: true
                },
                include: { rules: true }
            });
        }));
        it('should create a VM rule set with custom priority', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRuleSet = {
                id: 'ruleset-456',
                name: 'Web Server VM Firewall',
                internalName: 'ibay-vm-def456',
                entityType: client_1.RuleSetType.VM,
                entityId: 'vm-def456',
                priority: 100,
                isActive: true,
                rules: []
            };
            mockPrisma.firewallRuleSet.upsert.mockResolvedValue(mockRuleSet);
            const result = yield service.createRuleSet(client_1.RuleSetType.VM, 'vm-def456', 'Web Server VM Firewall', 'ibay-vm-def456', 100);
            expect(result.priority).toBe(100);
        }));
    });
    describe('createRule', () => {
        it('should create a firewall rule', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRule = {
                id: 'rule-123',
                ruleSetId: 'ruleset-123',
                name: 'Allow HTTPS',
                description: 'Allow incoming HTTPS traffic',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                priority: 100,
                protocol: 'tcp',
                dstPortStart: 443,
                dstPortEnd: 443,
                overridesDept: false
            };
            mockPrisma.firewallRule.create.mockResolvedValue(mockRule);
            const result = yield service.createRule('ruleset-123', {
                name: 'Allow HTTPS',
                description: 'Allow incoming HTTPS traffic',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                priority: 100,
                protocol: 'tcp',
                dstPortStart: 443,
                dstPortEnd: 443
            });
            expect(result).toEqual(mockRule);
        }));
    });
    describe('getRulesByEntity', () => {
        it('should get all rules for a department', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRuleSet = {
                id: 'ruleset-123',
                entityType: client_1.RuleSetType.DEPARTMENT,
                entityId: 'dept-123',
                rules: [
                    { id: 'rule-1', name: 'Allow HTTP' },
                    { id: 'rule-2', name: 'Allow HTTPS' }
                ]
            };
            mockPrisma.firewallRuleSet.findMany.mockResolvedValue([mockRuleSet]);
            const result = yield service.getRulesByEntity(client_1.RuleSetType.DEPARTMENT, 'dept-123');
            expect(result).toHaveLength(2);
            expect(mockPrisma.firewallRuleSet.findMany).toHaveBeenCalledWith({
                where: {
                    entityType: client_1.RuleSetType.DEPARTMENT,
                    entityId: 'dept-123'
                },
                include: { rules: true }
            });
        }));
        it('should return empty array when no rules exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.firewallRuleSet.findMany.mockResolvedValue([]);
            const result = yield service.getRulesByEntity(client_1.RuleSetType.VM, 'vm-nonexistent');
            expect(result).toEqual([]);
        }));
    });
    describe('updateRule', () => {
        it('should update a firewall rule', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockUpdatedRule = {
                id: 'rule-123',
                name: 'Allow HTTPS (Updated)',
                priority: 50,
                action: client_1.RuleAction.ACCEPT
            };
            mockPrisma.firewallRule.update.mockResolvedValue(mockUpdatedRule);
            const result = yield service.updateRule('rule-123', {
                name: 'Allow HTTPS (Updated)',
                priority: 50
            });
            expect(result).toEqual(mockUpdatedRule);
            expect(mockPrisma.firewallRule.update).toHaveBeenCalledWith({
                where: { id: 'rule-123' },
                data: {
                    name: 'Allow HTTPS (Updated)',
                    priority: 50
                }
            });
        }));
    });
    describe('deleteRule', () => {
        it('should delete a firewall rule', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.firewallRule.delete.mockResolvedValue({ id: 'rule-123' });
            yield service.deleteRule('rule-123');
            expect(mockPrisma.firewallRule.delete).toHaveBeenCalledWith({
                where: { id: 'rule-123' }
            });
        }));
    });
    describe('getRuleSetByEntity', () => {
        it('should get rule set for a specific entity', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRuleSet = {
                id: 'ruleset-123',
                entityType: client_1.RuleSetType.VM,
                entityId: 'vm-123',
                rules: []
            };
            mockPrisma.firewallRuleSet.findMany.mockResolvedValue([mockRuleSet]);
            const result = yield service.getRuleSetByEntity(client_1.RuleSetType.VM, 'vm-123');
            expect(result).toEqual(mockRuleSet);
        }));
        it('should return null when rule set does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.firewallRuleSet.findMany.mockResolvedValue([]);
            const result = yield service.getRuleSetByEntity(client_1.RuleSetType.VM, 'vm-nonexistent');
            expect(result).toBeNull();
        }));
    });
});
