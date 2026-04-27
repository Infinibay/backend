"use strict";
/**
 * Unit tests for DepartmentCleanupService
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
const departmentCleanupService_1 = require("@services/cleanup/departmentCleanupService");
const InfinizationService_1 = require("@services/InfinizationService");
// Mock infinization service before importing the service
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn()
}));
jest.mock('@main/logger', () => {
    const mockChild = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        log: jest.fn()
    };
    return {
        __esModule: true,
        default: Object.assign(Object.assign({}, mockChild), { child: () => mockChild })
    };
});
jest.mock('@services/network/DepartmentNetworkService', () => ({
    DepartmentNetworkService: jest.fn().mockImplementation(() => ({
        forceDestroyNetworkForDepartment: jest.fn().mockResolvedValue({
            success: true,
            tapDevicesRemoved: [],
            errors: []
        })
    })),
    ForceDestroyResult: undefined
}));
jest.mock('@infinibay/infinization', () => ({
    TapDeviceManager: jest.fn().mockImplementation(() => ({
        exists: jest.fn()
    })),
    generateVMChainName: jest.fn().mockReturnValue('chain-test')
}));
const mockNftablesService = {
    chainExists: jest.fn()
};
const mockInfinization = {
    getNftablesService: jest.fn(() => mockNftablesService)
};
describe('DepartmentCleanupService', () => {
    let service;
    let mockPrisma;
    beforeEach(() => {
        jest.clearAllMocks();
        InfinizationService_1.getInfinization.mockResolvedValue(mockInfinization);
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockPrisma.department.findUnique.mockResolvedValue(null);
        mockPrisma.department.delete.mockResolvedValue({ id: 'test' });
        mockPrisma.firewallRule.deleteMany.mockResolvedValue({ count: 0 });
        mockPrisma.firewallRuleSet.delete.mockResolvedValue({ id: 'test' });
        mockPrisma.machine.findMany.mockResolvedValue([]);
        mockPrisma.$transaction.mockImplementation((callback) => __awaiter(void 0, void 0, void 0, function* () {
            return callback(mockPrisma);
        }));
        service = new departmentCleanupService_1.DepartmentCleanupService(mockPrisma);
    });
    afterEach(() => {
        jest.resetAllMocks();
    });
    describe('cleanupDepartment', () => {
        it('should return early with errors if department not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptId = 'non-existent-dept';
            mockPrisma.department.findUnique.mockResolvedValue(null);
            const result = yield service.cleanupDepartment(deptId);
            expect(result).toEqual({
                success: false,
                databaseCleanup: {
                    attempted: false,
                    success: false
                },
                errors: [expect.stringContaining('not found')]
            });
            expect(result.errors[0]).toContain(deptId);
            // No deletion should occur
            expect(mockPrisma.department.delete).not.toHaveBeenCalled();
            expect(mockPrisma.firewallRule.deleteMany).not.toHaveBeenCalled();
            expect(mockPrisma.firewallRuleSet.delete).not.toHaveBeenCalled();
        }));
        it('should throw error if department has machines', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptId = 'test-dept-with-vms';
            const mockDepartment = {
                id: deptId,
                name: 'Test Department',
                machines: [
                    { id: 'vm-1', name: 'VM 1' },
                    { id: 'vm-2', name: 'VM 2' }
                ],
                firewallRuleSet: null
            };
            mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
            // Should throw error
            yield expect(service.cleanupDepartment(deptId))
                .rejects
                .toThrow(/Cannot cleanup department.*2 VMs still exist/);
            // Department should NOT be deleted
            expect(mockPrisma.department.delete).not.toHaveBeenCalled();
        }));
        it('should cleanup department with no firewall rules', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptId = 'test-dept-no-firewall';
            const mockDepartment = {
                id: deptId,
                name: 'Test Department',
                machines: [],
                firewallRuleSet: null, // No firewall rules
                bridgeName: null,
                firewallRuleSetId: null
            };
            mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
            const result = yield service.cleanupDepartment(deptId);
            // Should succeed
            expect(result.success).toBe(true);
            expect(result.errors).toEqual([]);
            // Department should be deleted
            expect(mockPrisma.department.delete).toHaveBeenCalledWith({
                where: { id: deptId }
            });
        }));
        it('should delete firewall rules and ruleset before department', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptId = 'test-dept-order';
            const mockDepartment = {
                id: deptId,
                name: 'Test Department',
                machines: [],
                firewallRuleSet: {
                    id: 'dept-ruleset-order',
                    rules: [{ id: 'dept-rule-1', name: 'Rule 1' }],
                    rulesCount: 1
                },
                bridgeName: null,
                firewallRuleSetId: 'dept-ruleset-order'
            };
            mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
            const result = yield service.cleanupDepartment(deptId);
            // Verify firewallRule.deleteMany was called first
            expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
                where: { ruleSetId: 'dept-ruleset-order' }
            });
            // Verify firewallRuleSet.delete was called
            expect(mockPrisma.firewallRuleSet.delete).toHaveBeenCalledWith({
                where: { id: 'dept-ruleset-order' }
            });
            // Verify department.delete was called last
            expect(mockPrisma.department.delete).toHaveBeenCalledWith({
                where: { id: deptId }
            });
            expect(result.success).toBe(true);
        }));
        it('should throw error if orphaned resources are found', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptId = 'test-dept-orphaned';
            const mockMachine = {
                id: 'vm-1',
                name: 'Orphaned VM',
                internalName: 'orphaned-vm',
                configuration: {
                    tapDeviceName: 'tap-orphaned'
                }
            };
            const mockDepartment = {
                id: deptId,
                name: 'Test Department',
                machines: [mockMachine],
                firewallRuleSet: null,
                bridgeName: null,
                firewallRuleSetId: null
            };
            mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
            // Setup mock to find the machine (not empty)
            mockPrisma.machine.findMany.mockResolvedValue([mockMachine]);
            mockNftablesService.chainExists.mockResolvedValue(true);
            require('@infinibay/infinization').TapDeviceManager.mockImplementation(() => ({
                exists: jest.fn().mockResolvedValue(true)
            }));
            // Should throw error
            yield expect(service.cleanupDepartment(deptId))
                .rejects
                .toThrow(/orphaned/i);
            // Department should NOT be deleted
            expect(mockPrisma.department.delete).not.toHaveBeenCalled();
        }));
        it('should succeed when no orphaned resources exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const deptId = 'test-dept-clean';
            const mockDepartment = {
                id: deptId,
                name: 'Test Department',
                machines: [],
                firewallRuleSet: null,
                bridgeName: null,
                firewallRuleSetId: null
            };
            mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
            // Ensure findMany returns empty array
            mockPrisma.machine.findMany.mockResolvedValue([]);
            const result = yield service.cleanupDepartment(deptId);
            // Should succeed
            expect(result.success).toBe(true);
            // Department should be deleted
            expect(mockPrisma.department.delete).toHaveBeenCalledWith({
                where: { id: deptId }
            });
        }));
    });
});
