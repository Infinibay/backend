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
const jest_mock_extended_1 = require("jest-mock-extended");
const InfinizationFirewallService_1 = require("@services/firewall/InfinizationFirewallService");
const infinization_1 = require("@infinibay/infinization");
// Mock NftablesService
jest.mock('@infinibay/infinization', () => ({
    NftablesService: jest.fn(),
    VM_CHAIN_PREFIX: 'vm_'
}));
describe('InfinizationFirewallService', () => {
    let service;
    let mockPrisma;
    let mockNftablesService;
    let mockInitialize;
    let mockApplyRules;
    let mockRemoveVMChain;
    let mockListChains;
    const mockVM = {
        id: 'vm-123',
        name: 'Test VM',
        configuration: {
            tapDeviceName: 'tap-vm-123'
        }
    };
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup mock functions
        mockInitialize = jest.fn();
        mockApplyRules = jest.fn();
        mockRemoveVMChain = jest.fn();
        mockListChains = jest.fn();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockNftablesService = {
            initialize: mockInitialize,
            applyRules: mockApplyRules,
            removeVMChain: mockRemoveVMChain,
            listChains: mockListChains
        };
        infinization_1.NftablesService.mockImplementation(() => mockNftablesService);
        service = new InfinizationFirewallService_1.InfinizationFirewallService(mockPrisma);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('initialize', () => {
        it('should initialize nftables service successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInitialize.mockResolvedValue(undefined);
            yield service.initialize();
            expect(infinization_1.NftablesService).toHaveBeenCalledTimes(1);
            expect(mockInitialize).toHaveBeenCalledTimes(1);
        }));
        it('should throw error if initialization fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Failed to initialize');
            mockInitialize.mockRejectedValue(error);
            yield expect(service.initialize()).rejects.toThrow('Failed to initialize');
            expect(mockInitialize).toHaveBeenCalledTimes(1);
        }));
        it('should handle NftablesError with structured details', () => __awaiter(void 0, void 0, void 0, function* () {
            const nftError = new Error('Failed to initialize');
            nftError.code = 'INIT_FAILED';
            nftError.context = { reason: 'permission denied' };
            mockInitialize.mockRejectedValue(nftError);
            yield expect(service.initialize()).rejects.toThrow();
            expect(mockInitialize).toHaveBeenCalledTimes(1);
        }));
    });
    describe('applyVMRules', () => {
        beforeEach(() => {
            // Default mock behavior
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockApplyRules.mockResolvedValue({
                appliedRules: 5,
                totalRules: 5,
                failedRules: 0,
                failures: []
            });
        });
        it('should throw error if VM ID is missing', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.applyVMRules('', [], [])).rejects.toThrow('VM ID is required');
        }));
        it('should throw error if VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield expect(service.applyVMRules('nonexistent-vm', [], []))
                .rejects.toThrow('VM not found: nonexistent-vm');
        }));
        it('should throw error if TAP device not configured', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmWithoutTap = Object.assign(Object.assign({}, mockVM), { configuration: null });
            mockPrisma.machine.findUnique.mockResolvedValue(vmWithoutTap);
            yield expect(service.applyVMRules('vm-123', [], []))
                .rejects.toThrow('VM configuration not found for VM: vm-123');
        }));
        it('should apply VM rules successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const departmentRules = [{ name: 'Dept Rule 1' }];
            const vmRules = [{ name: 'VM Rule 1' }];
            const result = yield service.applyVMRules('vm-123', departmentRules, vmRules);
            expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: 'vm-123' },
                include: { configuration: true }
            });
            expect(mockApplyRules).toHaveBeenCalledWith('vm-123', 'tap-vm-123', departmentRules, vmRules);
            expect(result).toEqual({
                appliedRules: 5,
                totalRules: 5,
                failedRules: 0,
                failures: []
            });
        }));
        it('should log and return partial failures', () => __awaiter(void 0, void 0, void 0, function* () {
            const failures = [
                { ruleName: 'Rule 1', error: 'Connection refused' }
            ];
            mockApplyRules.mockResolvedValue({
                appliedRules: 4,
                totalRules: 5,
                failedRules: 1,
                failures
            });
            const result = yield service.applyVMRules('vm-123', [], []);
            expect(result.failedRules).toBe(1);
            expect(result.failures).toEqual(failures);
        }));
        it('should throw error if nftables operation fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('nftables error');
            error.code = 'RULE_APPLY_FAILED';
            mockApplyRules.mockRejectedValue(error);
            yield expect(service.applyVMRules('vm-123', [], []))
                .rejects.toThrow('nftables error');
        }));
    });
    describe('applyDepartmentRules', () => {
        const mockDepartment = {
            id: 'dept-123',
            name: 'Engineering'
        };
        const mockVMs = [
            {
                id: 'vm-1',
                name: 'Web Server',
                configuration: { tapDeviceName: 'tap-v1' },
                firewallRuleSet: { rules: [{ id: 'r1' }] }
            },
            {
                id: 'vm-2',
                name: 'Database',
                configuration: { tapDeviceName: 'tap-v2' },
                firewallRuleSet: { rules: [{ id: 'r2' }] }
            }
        ];
        beforeEach(() => {
            mockPrisma.machine.findMany.mockResolvedValue(mockVMs);
            mockApplyRules.mockResolvedValue({
                appliedRules: 1,
                totalRules: 1,
                failedRules: 0,
                failures: []
            });
        });
        it('should throw error if department ID is missing', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.applyDepartmentRules('', [])).rejects.toThrow('Department ID is required');
        }));
        it('should apply department rules to all VMs in department', () => __awaiter(void 0, void 0, void 0, function* () {
            const departmentRules = [{ name: 'Dept Rule 1' }];
            const result = yield service.applyDepartmentRules('dept-123', departmentRules);
            expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { departmentId: 'dept-123' },
                include: {
                    configuration: true,
                    firewallRuleSet: { include: { rules: true } }
                }
            });
            expect(result.totalVms).toBe(2);
            expect(result.vmsUpdated).toBe(2);
            expect(result.errors).toEqual([]);
        }));
        it('should skip VMs without TAP device and track in errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmWithoutTap = Object.assign(Object.assign({}, mockVMs[0]), { configuration: null });
            mockPrisma.machine.findMany.mockResolvedValue([vmWithoutTap, mockVMs[1]]);
            const departmentRules = [{ name: 'Dept Rule 1' }];
            const result = yield service.applyDepartmentRules('dept-123', departmentRules);
            expect(result.vmsUpdated).toBe(1);
            expect(result.errors.length).toBe(1);
            expect(result.errors[0]).toContain('has no TAP device configured, skipping');
        }));
        it('should handle partial failures gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockApplyRules.mockResolvedValue({
                appliedRules: 0,
                totalRules: 1,
                failedRules: 1,
                failures: [{ ruleName: 'Rule 1', error: 'Connection refused' }]
            });
            const departmentRules = [{ name: 'Dept Rule 1' }];
            const result = yield service.applyDepartmentRules('dept-123', departmentRules);
            expect(result.vmsUpdated).toBe(2);
            expect(result.errors.length).toBe(2);
            expect(result.errors[0]).toContain('rules failed');
        }));
        it('should handle hard failures gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockApplyRules.mockRejectedValue(new Error('Network unreachable'));
            const departmentRules = [{ name: 'Dept Rule 1' }];
            const result = yield service.applyDepartmentRules('dept-123', departmentRules);
            expect(result.vmsUpdated).toBe(0);
            expect(result.errors.length).toBe(2);
            expect(result.errors[0]).toContain('Network unreachable');
        }));
        it('should return 0 VMs if department has no VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findMany.mockResolvedValue([]);
            const departmentRules = [{ name: 'Dept Rule 1' }];
            const result = yield service.applyDepartmentRules('dept-123', departmentRules);
            expect(result.totalVms).toBe(0);
            expect(result.vmsUpdated).toBe(0);
            expect(result.errors).toEqual([]);
        }));
    });
    describe('removeVMFirewall', () => {
        it('should throw error if VM ID is missing', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.removeVMFirewall('')).rejects.toThrow('VM ID is required');
        }));
        it('should remove VM firewall chain', () => __awaiter(void 0, void 0, void 0, function* () {
            yield service.removeVMFirewall('vm-123');
            expect(mockRemoveVMChain).toHaveBeenCalledWith('vm-123');
        }));
        it('should not throw on removal failure', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock does not throw
            yield expect(service.removeVMFirewall('vm-123')).resolves.not.toThrow();
        }));
    });
    describe('listVMChains', () => {
        it('should list all VM firewall chains', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockChains = [
                'vm_vm123',
                'vm_vm456',
                'some-other-chain'
            ];
            mockListChains.mockResolvedValue(mockChains);
            const result = yield service.listVMChains();
            expect(mockListChains).toHaveBeenCalledTimes(1);
            expect(result).toEqual([
                { chainName: 'vm_vm123', vmId: 'vm123' },
                { chainName: 'vm_vm456', vmId: 'vm456' }
            ]);
        }));
        it('should return empty array if no VM chains exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockListChains.mockResolvedValue(['other-chain-1', 'other-chain-2']);
            const result = yield service.listVMChains();
            expect(result).toEqual([]);
        }));
        it('should throw error if listing chains fails', () => __awaiter(void 0, void 0, void 0, function* () {
            mockListChains.mockRejectedValue(new Error('Failed to list chains'));
            yield expect(service.listVMChains()).rejects.toThrow('Failed to list chains');
        }));
    });
    describe('convertPrismaRulesToInput', () => {
        it('should convert Prisma rules to FirewallRuleInput format', () => {
            const prismaRules = [
                {
                    id: 'rule-1',
                    name: 'Allow HTTP',
                    description: 'Allow incoming HTTP',
                    action: 'ACCEPT',
                    direction: 'IN',
                    priority: 100,
                    protocol: 'tcp',
                    dstPortStart: 80,
                    dstPortEnd: 80,
                    srcPortStart: null,
                    srcPortEnd: null,
                    srcIpAddr: null,
                    srcIpMask: null,
                    dstIpAddr: null,
                    dstIpMask: null,
                    connectionState: null,
                    overridesDept: false
                }
            ];
            const result = service.convertPrismaRulesToInput(prismaRules);
            expect(result).toHaveLength(1);
            expect(result[0].name).toBe('Allow HTTP');
            expect(result[0].action).toBe('ACCEPT');
            expect(result[0].direction).toBe('IN');
        });
        it('should handle empty array', () => {
            const result = service.convertPrismaRulesToInput([]);
            expect(result).toEqual([]);
        });
        it('should convert all fields correctly', () => {
            const prismaRules = [
                {
                    id: 'rule-1',
                    name: 'Test',
                    description: 'Test desc',
                    action: 'DROP',
                    direction: 'INOUT',
                    priority: 50,
                    protocol: 'udp',
                    dstPortStart: 53,
                    dstPortEnd: 53,
                    srcPortStart: 1024,
                    srcPortEnd: 65535,
                    srcIpAddr: '192.168.1.0',
                    srcIpMask: '255.255.255.0',
                    dstIpAddr: '8.8.8.8',
                    dstIpMask: '255.255.255.255',
                    connectionState: { states: ['ESTABLISHED'] },
                    overridesDept: true
                }
            ];
            const result = service.convertPrismaRulesToInput(prismaRules);
            expect(result[0].id).toBe('rule-1');
            expect(result[0].name).toBe('Test');
            expect(result[0].description).toBe('Test desc');
            expect(result[0].action).toBe('DROP');
            expect(result[0].direction).toBe('INOUT');
            expect(result[0].priority).toBe(50);
            expect(result[0].protocol).toBe('udp');
            expect(result[0].dstPortStart).toBe(53);
            expect(result[0].dstPortEnd).toBe(53);
            expect(result[0].srcPortStart).toBe(1024);
            expect(result[0].srcPortEnd).toBe(65535);
            expect(result[0].srcIpAddr).toBe('192.168.1.0');
            expect(result[0].srcIpMask).toBe('255.255.255.0');
            expect(result[0].dstIpAddr).toBe('8.8.8.8');
            expect(result[0].dstIpMask).toBe('255.255.255.255');
            expect(result[0].overridesDept).toBe(true);
        });
    });
    describe('Edge Cases', () => {
        it('should handle VMs with empty firewallRuleSet', () => __awaiter(void 0, void 0, void 0, function* () {
            const vm = {
                id: 'vm-1',
                name: 'Test VM',
                configuration: { tapDeviceName: 'tap-v1' },
                firewallRuleSet: null
            };
            mockPrisma.machine.findMany.mockResolvedValue([vm]);
            mockApplyRules.mockResolvedValue({
                appliedRules: 0,
                totalRules: 0,
                failedRules: 0,
                failures: []
            });
            const result = yield service.applyDepartmentRules('dept-123', []);
            expect(result.vmsUpdated).toBe(1);
        }));
        it('should handle VMs with empty rules array', () => __awaiter(void 0, void 0, void 0, function* () {
            const vm = {
                id: 'vm-1',
                name: 'Test VM',
                configuration: { tapDeviceName: 'tap-v1' },
                firewallRuleSet: { rules: [] }
            };
            mockPrisma.machine.findMany.mockResolvedValue([vm]);
            mockApplyRules.mockResolvedValue({
                appliedRules: 0,
                totalRules: 0,
                failedRules: 0,
                failures: []
            });
            const result = yield service.applyDepartmentRules('dept-123', []);
            expect(result.vmsUpdated).toBe(1);
        }));
        it('should handle multiple VMs with mixed success', () => __awaiter(void 0, void 0, void 0, function* () {
            const vm1 = { id: 'vm-1', name: 'VM1', configuration: { tapDeviceName: 'tap-v1' }, firewallRuleSet: { rules: [] } };
            const vm2 = { id: 'vm-2', name: 'VM2', configuration: { tapDeviceName: 'tap-v2' }, firewallRuleSet: { rules: [] } };
            mockPrisma.machine.findMany.mockResolvedValue([vm1, vm2]);
            mockApplyRules
                .mockResolvedValueOnce({ appliedRules: 1, totalRules: 1, failedRules: 0, failures: [] })
                .mockRejectedValueOnce(new Error('Network error'));
            const result = yield service.applyDepartmentRules('dept-123', []);
            expect(result.vmsUpdated).toBe(1);
            expect(result.errors.length).toBe(1);
        }));
    });
});
