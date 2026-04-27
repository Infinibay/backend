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
const FirewallValidationService_1 = require("@services/firewall/FirewallValidationService");
const client_1 = require("@prisma/client");
describe('FirewallValidationService', () => {
    let service;
    beforeEach(() => {
        service = new FirewallValidationService_1.FirewallValidationService();
    });
    describe('validateRuleConflicts', () => {
        it('should detect no conflicts when rules are compatible', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow HTTP',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 80,
                    dstPortEnd: 80,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Allow HTTPS',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 443,
                    dstPortEnd: 443,
                    priority: 100
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(true);
            expect(result.conflicts).toHaveLength(0);
        }));
        it('should detect contradictory rules (same traffic, different actions)', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow SSH',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 22,
                    dstPortEnd: 22,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Block SSH',
                    action: client_1.RuleAction.DROP,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 22,
                    dstPortEnd: 22,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(false);
            expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
            expect(result.conflicts.some(c => c.type === 'CONTRADICTORY')).toBe(true);
            const contradictoryConflict = result.conflicts.find(c => c.type === 'CONTRADICTORY');
            expect(contradictoryConflict === null || contradictoryConflict === void 0 ? void 0 : contradictoryConflict.affectedRules).toHaveLength(2);
        }));
        it('should detect port overlaps with detailed message', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow ports 100-200',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 100,
                    dstPortEnd: 200,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Allow ports 150-250',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 150,
                    dstPortEnd: 250,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(false);
            expect(result.conflicts.some(c => c.type === 'PORT_OVERLAP')).toBe(true);
            const overlapConflict = result.conflicts.find(c => c.type === 'PORT_OVERLAP');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('Port overlap');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('ports 150-200');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('consolidating');
        }));
        it('should not detect overlaps for different directions', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow inbound port 80',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 80,
                    dstPortEnd: 80,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Allow outbound port 80',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.OUT,
                    protocol: 'tcp',
                    dstPortStart: 80,
                    dstPortEnd: 80,
                    priority: 100
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(true);
            expect(result.conflicts).toHaveLength(0);
        }));
        it('should not detect overlaps for different protocols', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow TCP port 53',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 53,
                    dstPortEnd: 53,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Allow UDP port 53',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'udp',
                    dstPortStart: 53,
                    dstPortEnd: 53,
                    priority: 100
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(true);
            expect(result.conflicts).toHaveLength(0);
        }));
        it('should handle rules without port specifications', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow all ICMP',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'icmp',
                    dstPortStart: null,
                    dstPortEnd: null,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Allow all traffic',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.INOUT,
                    protocol: 'all',
                    dstPortStart: null,
                    dstPortEnd: null,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(true);
        }));
    });
    describe('validateOverride', () => {
        it('should validate valid VM rule override', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptRule = {
                id: '1',
                name: 'Dept: Allow SSH',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                priority: 100
            };
            const vmRule = {
                id: '2',
                name: 'VM: Block SSH',
                action: client_1.RuleAction.DROP,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                priority: 50,
                overridesDept: true
            };
            const result = yield service.validateOverride(vmRule, [deptRule]);
            expect(result.isValid).toBe(true);
        }));
        it('should reject override when not targeting same traffic', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptRule = {
                id: '1',
                name: 'Dept: Allow SSH',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 22,
                dstPortEnd: 22,
                priority: 100
            };
            const vmRule = {
                id: '2',
                name: 'VM: Block HTTP (claiming override)',
                action: client_1.RuleAction.DROP,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 50,
                overridesDept: true
            };
            const result = yield service.validateOverride(vmRule, [deptRule]);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Override flag set but no matching department rule found');
        }));
    });
    describe('validateRuleInput', () => {
        it('should reject invalid port range (start > end)', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Invalid range',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 8080,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Destination port range is invalid: start port (8080) is greater than end port (80)');
        }));
        it('should reject port numbers out of bounds', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Out of bounds',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 70000,
                dstPortEnd: 70000,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Destination port 70000 is out of valid range (1-65535)');
        }));
        it('should reject negative port numbers', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Negative port',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: -1,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Destination port -1 is out of valid range (1-65535)');
        }));
        it('should warn when using ports with protocols that do not support them', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'ICMP with ports',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'icmp',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Protocol "icmp" does not support port specifications. Remove port fields.');
        }));
        it('should reject invalid IP addresses', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Invalid IP',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                srcIpAddr: '999.999.999.999',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Source IP address "999.999.999.999" is not a valid IPv4 or IPv6 address');
        }));
        it('should reject invalid CIDR masks', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Invalid mask',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                srcIpAddr: '192.168.1.1',
                srcIpMask: '999',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Source IP mask "999" is not valid. Use CIDR notation (0-32 for IPv4, 0-128 for IPv6)');
        }));
        it('should accept valid IPv6 addresses', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'IPv6',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                srcIpAddr: '2001:0db8::1',
                srcIpMask: '64',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(true);
            expect(result.warnings).toHaveLength(0);
        }));
        it('should accept TCP/UDP without ports for "all ports" rules', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'All TCP',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: null,
                dstPortEnd: null,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(true);
            expect(result.warnings).toHaveLength(0);
        }));
        it('should reject priority out of valid range', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Invalid priority',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: -100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Priority -100 is out of valid range (0-1000)');
        }));
        it('should reject when srcPortEnd is provided without srcPortStart', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Missing start port',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                srcPortStart: null,
                srcPortEnd: 8080,
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Source port end specified without source port start');
        }));
        it('should reject when dstPortEnd is provided without dstPortStart', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Missing start port',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                dstPortStart: null,
                dstPortEnd: 8080,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Destination port end specified without destination port start');
        }));
        it('should reject when IP mask is provided without IP address', () => __awaiter(void 0, void 0, void 0, function* () {
            const rule = {
                id: '1',
                name: 'Mask without IP',
                action: client_1.RuleAction.ACCEPT,
                direction: client_1.RuleDirection.IN,
                protocol: 'tcp',
                srcIpAddr: null,
                srcIpMask: '24',
                dstPortStart: 80,
                dstPortEnd: 80,
                priority: 100
            };
            const result = yield service.validateRuleInput(rule);
            expect(result.isValid).toBe(false);
            expect(result.warnings).toContain('Source IP mask specified without source IP address');
        }));
    });
    describe('direction overlap detection', () => {
        it('should detect overlap when INOUT rule conflicts with IN rule', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Department DNS Both Directions',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.INOUT,
                    protocol: 'tcp',
                    dstPortStart: 53,
                    dstPortEnd: 53,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'VM Block Incoming',
                    action: client_1.RuleAction.DROP,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 1,
                    dstPortEnd: 1000,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(false);
            expect(result.conflicts.some(c => c.type === 'PORT_OVERLAP')).toBe(true);
            const overlapConflict = result.conflicts.find(c => c.type === 'PORT_OVERLAP');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('Port overlap');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('port 53');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('INOUT includes IN');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('Actions differ');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('overridesDept=true');
        }));
        it('should detect overlap when INOUT rule conflicts with OUT rule', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Department DNS Both Directions',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.INOUT,
                    protocol: 'udp',
                    dstPortStart: 53,
                    dstPortEnd: 53,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'VM Block Outgoing Range',
                    action: client_1.RuleAction.DROP,
                    direction: client_1.RuleDirection.OUT,
                    protocol: 'udp',
                    dstPortStart: 50,
                    dstPortEnd: 60,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(false);
            expect(result.conflicts.some(c => c.type === 'PORT_OVERLAP')).toBe(true);
            const overlapConflict = result.conflicts.find(c => c.type === 'PORT_OVERLAP');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('Port overlap');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('ports 50-60');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('INOUT includes OUT');
        }));
        it('should NOT detect overlap for different directions (IN vs OUT)', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow Incoming DNS',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 53,
                    dstPortEnd: 53,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Block Outgoing DNS',
                    action: client_1.RuleAction.DROP,
                    direction: client_1.RuleDirection.OUT,
                    protocol: 'tcp',
                    dstPortStart: 53,
                    dstPortEnd: 53,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(true);
            expect(result.conflicts).toHaveLength(0);
        }));
        it('should suggest consolidation when same action overlaps', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow HTTP',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 80,
                    dstPortEnd: 80,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Allow Web Services',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 80,
                    dstPortEnd: 443,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(false);
            expect(result.conflicts.some(c => c.type === 'PORT_OVERLAP')).toBe(true);
            const overlapConflict = result.conflicts.find(c => c.type === 'PORT_OVERLAP');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('Both rules have the same action');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('consolidating');
        }));
        it('should detect overlap when one rule targets all ports', () => __awaiter(void 0, void 0, void 0, function* () {
            const rules = [
                {
                    id: '1',
                    name: 'Allow All TCP',
                    action: client_1.RuleAction.ACCEPT,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: null,
                    dstPortEnd: null,
                    priority: 100
                },
                {
                    id: '2',
                    name: 'Block SSH',
                    action: client_1.RuleAction.DROP,
                    direction: client_1.RuleDirection.IN,
                    protocol: 'tcp',
                    dstPortStart: 22,
                    dstPortEnd: 22,
                    priority: 200
                }
            ];
            const result = yield service.validateRuleConflicts(rules);
            expect(result.isValid).toBe(false);
            expect(result.conflicts.some(c => c.type === 'PORT_OVERLAP')).toBe(true);
            const overlapConflict = result.conflicts.find(c => c.type === 'PORT_OVERLAP');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('all ports');
            expect(overlapConflict === null || overlapConflict === void 0 ? void 0 : overlapConflict.message).toContain('port 22');
        }));
    });
});
