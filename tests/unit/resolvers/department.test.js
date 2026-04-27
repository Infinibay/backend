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
const globals_1 = require("@jest/globals");
const resolver_1 = require("../../../app/graphql/resolvers/department/resolver");
const jest_setup_1 = require("../../setup/jest.setup");
const mock_factories_1 = require("../../setup/mock-factories");
const test_helpers_1 = require("../../setup/test-helpers");
const errors_1 = require("@utils/errors");
const mockEventManager = {
    dispatchEvent: globals_1.jest.fn()
};
const mockCleanupService = {
    cleanupDepartment: globals_1.jest.fn()
};
const mockNetworkService = {
    configureNetwork: globals_1.jest.fn()
};
globals_1.jest.mock('../../../app/services/EventManager', () => ({
    getEventManager: () => mockEventManager
}));
globals_1.jest.mock('../../../app/services/cleanup/departmentCleanupService', () => ({
    DepartmentCleanupService: globals_1.jest.fn().mockImplementation(() => mockCleanupService)
}));
globals_1.jest.mock('../../../app/services/network/DepartmentNetworkService', () => ({
    DepartmentNetworkService: globals_1.jest.fn().mockImplementation(() => mockNetworkService)
}));
globals_1.jest.mock('../../../app/services/firewall/FirewallRuleService', () => ({
    FirewallRuleService: globals_1.jest.fn().mockImplementation(() => ({}))
}));
globals_1.jest.mock('../../../app/services/firewall/FirewallPolicyService', () => ({
    FirewallPolicyService: globals_1.jest.fn().mockImplementation(() => ({}))
}));
globals_1.jest.mock('../../../app/services/firewall/FirewallOrchestrationService', () => ({
    FirewallOrchestrationService: globals_1.jest.fn().mockImplementation(() => ({}))
}));
globals_1.jest.mock('../../../app/services/firewall/FirewallValidationService', () => ({
    FirewallValidationService: globals_1.jest.fn().mockImplementation(() => ({}))
}));
globals_1.jest.mock('../../../app/services/firewall/InfinizationFirewallService', () => ({
    InfinizationFirewallService: globals_1.jest.fn().mockImplementation(() => ({}))
}));
(0, globals_1.describe)('DepartmentResolver', () => {
    let resolver;
    const ctx = (0, test_helpers_1.createAdminContext)();
    // Helper to build expected department response from a mock department
    function expectedDepartmentResponse(dept, totalMachines = 0) {
        return {
            id: dept.id,
            name: dept.name,
            createdAt: dept.createdAt,
            internetSpeed: dept.internetSpeed || undefined,
            ipSubnet: dept.ipSubnet || undefined,
            bridgeName: dept.bridgeName || undefined,
            gatewayIP: dept.gatewayIP || undefined,
            dnsServers: dept.dnsServers,
            ntpServers: dept.ntpServers,
            totalMachines,
            firewallPolicy: dept.firewallPolicy,
            firewallDefaultConfig: dept.firewallDefaultConfig || undefined,
            firewallCustomRules: dept.firewallCustomRules || undefined
        };
    }
    (0, globals_1.beforeEach)(() => {
        resolver = new resolver_1.DepartmentResolver();
        globals_1.jest.clearAllMocks();
        // Reset event manager mock
        mockEventManager.dispatchEvent.mockReset();
        // Reset cleanup service mock
        mockCleanupService.cleanupDepartment.mockReset();
        // Reset network service mock
        mockNetworkService.configureNetwork.mockReset();
    });
    (0, globals_1.describe)('Query: department', () => {
        (0, globals_1.it)('should return department by id with relations', () => __awaiter(void 0, void 0, void 0, function* () {
            const department = (0, mock_factories_1.createMockDepartment)();
            const departmentWithRelations = Object.assign(Object.assign({}, department), { machines: [] // Only include machines as that's what the resolver expects
             });
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(departmentWithRelations);
            const result = yield resolver.department(department.id, ctx);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.department.findUnique).toHaveBeenCalledWith({
                where: { id: department.id },
                include: {
                    machines: true
                }
            });
            (0, globals_1.expect)(result).toEqual(expectedDepartmentResponse(department, 0));
        }));
        (0, globals_1.it)('should return null if department not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(null);
            const result = yield resolver.department('non-existent-id', ctx);
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('Query: departments', () => {
        (0, globals_1.it)('should return all departments', () => __awaiter(void 0, void 0, void 0, function* () {
            const departments = (0, mock_factories_1.createMockDepartments)(5).map(dept => (Object.assign(Object.assign({}, dept), { machines: [] // Add machines array to each department
             })));
            jest_setup_1.mockPrisma.department.findMany.mockResolvedValue(departments);
            const result = yield resolver.departments(ctx);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.department.findMany).toHaveBeenCalledWith({ include: { machines: true } });
            (0, globals_1.expect)(result).toHaveLength(5);
            (0, globals_1.expect)(result[0]).toEqual(globals_1.expect.objectContaining({
                id: departments[0].id,
                name: departments[0].name,
                totalMachines: 0
            }));
        }));
        (0, globals_1.it)('should return empty array when no departments exist', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.department.findMany.mockResolvedValue([]);
            const result = yield resolver.departments(ctx);
            (0, globals_1.expect)(result).toEqual([]);
        }));
    });
    (0, globals_1.describe)('Query: findDepartmentByName', () => {
        (0, globals_1.it)('should find department by name', () => __awaiter(void 0, void 0, void 0, function* () {
            const department = (0, mock_factories_1.createMockDepartment)({ name: 'Engineering' });
            const departmentWithRelations = Object.assign(Object.assign({}, department), { machines: [], nwFilters: [], configuration: null });
            jest_setup_1.mockPrisma.department.findFirst.mockResolvedValue(departmentWithRelations);
            const result = yield resolver.findDepartmentByName('Engineering', ctx);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.department.findFirst).toHaveBeenCalledWith({
                where: {
                    name: {
                        equals: 'Engineering',
                        mode: 'insensitive'
                    }
                },
                include: {
                    machines: true
                }
            });
            (0, globals_1.expect)(result).toEqual(expectedDepartmentResponse(department, 0));
        }));
        (0, globals_1.it)('should return null if department not found by name', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.department.findFirst.mockResolvedValue(null);
            const result = yield resolver.findDepartmentByName('NonExistent', ctx);
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('Mutation: createDepartment', () => {
        (0, globals_1.it)('should create a new department', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const createdDepartment = (0, mock_factories_1.createMockDepartment)({ name: 'Engineering', ipSubnet: '10.10.1.0/24' });
            // Mock: no existing department with same name
            jest_setup_1.mockPrisma.department.findFirst.mockResolvedValue(null);
            // Mock: getNextAvailableSubnet - findMany returns empty array (no existing departments)
            jest_setup_1.mockPrisma.department.findMany.mockResolvedValue([]);
            // Mock: department creation
            jest_setup_1.mockPrisma.department.create.mockResolvedValue(createdDepartment);
            // Mock: findUnique after network configuration
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(createdDepartment);
            // Mock: network configuration succeeds
            mockNetworkService.configureNetwork.mockResolvedValue(undefined);
            const result = yield resolver.createDepartment('Engineering', null, ctx);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.department.create).toHaveBeenCalled();
            (0, globals_1.expect)(result).toEqual(expectedDepartmentResponse(createdDepartment, 0));
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('departments', 'create', { id: createdDepartment.id }, (_a = ctx.user) === null || _a === void 0 ? void 0 : _a.id);
        }));
        (0, globals_1.it)('should create department with minimal data', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const createdDepartment = (0, mock_factories_1.createMockDepartment)({ name: 'HR', ipSubnet: '10.10.1.0/24' });
            jest_setup_1.mockPrisma.department.findFirst.mockResolvedValue(null);
            jest_setup_1.mockPrisma.department.findMany.mockResolvedValue([]);
            jest_setup_1.mockPrisma.department.create.mockResolvedValue(createdDepartment);
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(createdDepartment);
            mockNetworkService.configureNetwork.mockResolvedValue(undefined);
            const result = yield resolver.createDepartment('HR', null, ctx);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.department.create).toHaveBeenCalled();
            (0, globals_1.expect)(result).toEqual(expectedDepartmentResponse(createdDepartment, 0));
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('departments', 'create', { id: createdDepartment.id }, (_a = ctx.user) === null || _a === void 0 ? void 0 : _a.id);
        }));
    });
    (0, globals_1.describe)('Mutation: destroyDepartment', () => {
        (0, globals_1.it)('should delete department successfully when no machines exist', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const department = (0, mock_factories_1.createMockDepartment)();
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(department);
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([]); // No machines in department
            mockCleanupService.cleanupDepartment.mockResolvedValue(undefined);
            const result = yield resolver.destroyDepartment(department.id, ctx);
            // Verify proper sequence of operations
            (0, globals_1.expect)(jest_setup_1.mockPrisma.department.findUnique).toHaveBeenCalledWith({
                where: { id: department.id }
            });
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith({
                where: { departmentId: department.id }
            });
            // Verify cleanup service was called
            (0, globals_1.expect)(mockCleanupService.cleanupDepartment).toHaveBeenCalledWith(department.id);
            // Verify event dispatch for deletion
            (0, globals_1.expect)(mockEventManager.dispatchEvent).toHaveBeenCalledWith('departments', 'delete', { id: department.id }, (_a = ctx.user) === null || _a === void 0 ? void 0 : _a.id);
            // Verify returned department data
            (0, globals_1.expect)(result).toEqual(expectedDepartmentResponse(department, 0));
        }));
        (0, globals_1.it)('should throw error if department not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(null);
            yield (0, globals_1.expect)(resolver.destroyDepartment('non-existent-id', ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
        (0, globals_1.it)('should throw error if department has machines', () => __awaiter(void 0, void 0, void 0, function* () {
            const department = (0, mock_factories_1.createMockDepartment)();
            const machines = (0, mock_factories_1.createMockMachines)(2);
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(department);
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue(machines);
            yield (0, globals_1.expect)(resolver.destroyDepartment(department.id, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
    });
});
