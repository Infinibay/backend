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
const resolver_1 = require("../../../app/graphql/resolvers/machine/resolver");
const jest_setup_1 = require("../../setup/jest.setup");
const mock_factories_1 = require("../../setup/mock-factories");
const test_helpers_1 = require("../../setup/test-helpers");
const errors_1 = require("@utils/errors");
// Mock VirtManager
jest.mock('@utils/VirtManager', () => ({
    VirtManager: {
        getInstance: jest.fn(() => ({
            createMachine: jest.fn(),
            destroyMachine: jest.fn(),
            powerOn: jest.fn(),
            powerOff: jest.fn(),
            suspend: jest.fn(),
            getMachineInfo: jest.fn(),
            getMachineStats: jest.fn(),
            attachDevice: jest.fn(),
            detachDevice: jest.fn(),
            takeSnapshot: jest.fn(),
            revertSnapshot: jest.fn(),
            deleteSnapshot: jest.fn(),
            listSnapshots: jest.fn(),
            getMachineXML: jest.fn(),
            setAutostart: jest.fn()
        }))
    }
}));
// Mock EventManager
jest.mock('@services/EventManager', () => ({
    getEventManager: jest.fn(() => ({
        dispatch: jest.fn()
    }))
}));
describe.skip('MachineResolver', () => {
    let queriesResolver;
    let mutationsResolver;
    let mockVirtManager;
    const ctx = (0, test_helpers_1.createAdminContext)();
    beforeEach(() => {
        queriesResolver = new resolver_1.MachineQueries();
        mutationsResolver = new resolver_1.MachineMutations();
        const VirtManager = require('@utils/VirtManager').VirtManager;
        mockVirtManager = VirtManager.getInstance();
        jest.clearAllMocks();
    });
    describe('machine', () => {
        it('should return machine by id', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = (0, mock_factories_1.createMockMachine)();
            const mockTemplate = (0, mock_factories_1.createMockMachineTemplate)();
            const mockDepartment = (0, mock_factories_1.createMockDepartment)();
            const mockUser = (0, mock_factories_1.createMockUser)();
            const mockConfig = (0, mock_factories_1.createMockMachineConfiguration)({ machineId: mockMachine.id });
            const machineWithRelations = Object.assign(Object.assign({}, mockMachine), { template: mockTemplate, department: mockDepartment, user: mockUser, configuration: mockConfig });
            jest_setup_1.mockPrisma.machine.findFirst.mockResolvedValue(machineWithRelations);
            const result = yield queriesResolver.machine(mockMachine.id, ctx);
            expect(jest_setup_1.mockPrisma.machine.findFirst).toHaveBeenCalledWith({
                where: { id: mockMachine.id },
                include: {
                    template: true,
                    department: true,
                    user: true,
                    configuration: true,
                    applications: {
                        include: { application: true }
                    },
                    nwFilters: {
                        include: { nwFilter: true }
                    },
                    ports: true,
                    serviceConfigs: true
                }
            });
            expect(result).toEqual(machineWithRelations);
        }));
        it('should return null if machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findFirst.mockResolvedValue(null);
            const result = yield queriesResolver.machine('non-existent-id', ctx);
            expect(result).toBeNull();
        }));
    });
    describe('machines', () => {
        it('should return paginated machines list', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachines = (0, mock_factories_1.createMockMachines)(5);
            const total = 10;
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue(mockMachines);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(total);
            const result = yield queriesResolver.machines({ take: 5, skip: 0 }, {}, ctx);
            expect(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith({
                take: 5,
                skip: 0,
                include: {
                    template: true,
                    department: true,
                    user: true,
                    configuration: true
                },
                orderBy: { createdAt: 'desc' }
            });
            expect(result).toEqual({
                machines: mockMachines,
                total
            });
        }));
        it('should filter machines by status', () => __awaiter(void 0, void 0, void 0, function* () {
            const runningMachines = (0, mock_factories_1.createMockMachines)(3).map(m => (Object.assign(Object.assign({}, m), { status: 'running' })));
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue(runningMachines);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(3);
            yield queriesResolver.machines({ take: 10, skip: 0 }, {}, ctx);
            expect(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { status: 'running' }
            }));
        }));
        it('should filter machines by department', () => __awaiter(void 0, void 0, void 0, function* () {
            const departmentId = 'dept-123';
            const deptMachines = (0, mock_factories_1.createMockMachines)(3).map(m => (Object.assign(Object.assign({}, m), { departmentId })));
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue(deptMachines);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(3);
            yield queriesResolver.machines({ take: 10, skip: 0 }, {}, ctx);
            expect(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { departmentId }
            }));
        }));
        it('should filter machines by user', () => __awaiter(void 0, void 0, void 0, function* () {
            const userId = 'user-123';
            const userMachines = (0, mock_factories_1.createMockMachines)(2).map(m => (Object.assign(Object.assign({}, m), { userId })));
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue(userMachines);
            jest_setup_1.mockPrisma.machine.count.mockResolvedValue(2);
            yield queriesResolver.machines({ take: 10, skip: 0 }, {}, ctx);
            expect(jest_setup_1.mockPrisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { userId }
            }));
        }));
    });
    describe('createMachine', () => {
        it('should create machine with valid input', () => __awaiter(void 0, void 0, void 0, function* () {
            const template = (0, mock_factories_1.createMockMachineTemplate)();
            const department = (0, mock_factories_1.createMockDepartment)();
            const input = (0, mock_factories_1.createMockMachineInput)({
                templateId: template.id,
                departmentId: department.id
            });
            const createdMachine = (0, mock_factories_1.createMockMachine)(Object.assign(Object.assign({}, input), { internalName: `vm-${Date.now()}`, status: 'stopped', cpuCores: template.cores, ramGB: template.ram, diskSizeGB: template.storage }));
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(department);
            jest_setup_1.mockPrisma.machine.create.mockResolvedValue(createdMachine);
            mockVirtManager.createMachine.mockResolvedValue({
                success: true,
                xml: (0, mock_factories_1.createMockDomainXML)(createdMachine.internalName)
            });
            const context = (0, test_helpers_1.createAdminContext)();
            const result = yield mutationsResolver.createMachine(input, context);
            expect(jest_setup_1.mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
                where: { id: input.templateId }
            });
            expect(jest_setup_1.mockPrisma.machine.create).toHaveBeenCalled();
            expect(mockVirtManager.createMachine).toHaveBeenCalled();
            expect(result).toEqual(createdMachine);
        }));
        it('should throw error if template not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = (0, mock_factories_1.createMockMachineInput)();
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);
            const context = (0, test_helpers_1.createAdminContext)();
            yield expect(mutationsResolver.createMachine(input, context)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('should throw error if department not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const template = (0, mock_factories_1.createMockMachineTemplate)();
            const input = (0, mock_factories_1.createMockMachineInput)({
                templateId: template.id,
                departmentId: 'non-existent'
            });
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(null);
            const context = (0, test_helpers_1.createAdminContext)();
            yield expect(mutationsResolver.createMachine(input, context)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('should handle libvirt creation failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const template = (0, mock_factories_1.createMockMachineTemplate)();
            const input = (0, mock_factories_1.createMockMachineInput)({ templateId: template.id });
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
            jest_setup_1.mockPrisma.machine.create.mockResolvedValue((0, mock_factories_1.createMockMachine)());
            mockVirtManager.createMachine.mockRejectedValue(new Error('Libvirt error'));
            const context = (0, test_helpers_1.createAdminContext)();
            yield expect(mutationsResolver.createMachine(input, context)).rejects.toThrow('Libvirt error');
        }));
    });
    describe('destroyMachine', () => {
        it('should destroy machine successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'stopped' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            mockVirtManager.destroyMachine.mockResolvedValue({ success: true });
            jest_setup_1.mockPrisma.machine.delete.mockResolvedValue(machine);
            const result = yield mutationsResolver.destroyMachine(machine.id, ctx);
            expect(jest_setup_1.mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: machine.id }
            });
            expect(mockVirtManager.destroyMachine).toHaveBeenCalledWith(machine.internalName);
            expect(jest_setup_1.mockPrisma.machine.delete).toHaveBeenCalledWith({
                where: { id: machine.id }
            });
            expect(result).toEqual({
                success: true,
                message: expect.stringContaining('destroyed')
            });
        }));
        it('should destroy running machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'running' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            mockVirtManager.destroyMachine.mockResolvedValue({ success: true });
            jest_setup_1.mockPrisma.machine.delete.mockResolvedValue(machine);
            const result = yield mutationsResolver.destroyMachine(machine.id, ctx);
            expect(mockVirtManager.destroyMachine).toHaveBeenCalled();
            expect(result.success).toBe(true);
        }));
        it('should throw error if machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield expect(mutationsResolver.destroyMachine('non-existent', ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
    });
    describe('powerOn', () => {
        it('should power on stopped machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'stopped' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            mockVirtManager.powerOn.mockResolvedValue({ success: true });
            jest_setup_1.mockPrisma.machine.update.mockResolvedValue(Object.assign(Object.assign({}, machine), { status: 'running' }));
            const result = yield mutationsResolver.powerOn(machine.id, ctx);
            expect(mockVirtManager.powerOn).toHaveBeenCalledWith(machine.internalName);
            expect(jest_setup_1.mockPrisma.machine.update).toHaveBeenCalledWith({
                where: { id: machine.id },
                data: { status: 'running' }
            });
            expect(result).toEqual({
                success: true,
                message: expect.stringContaining('powered on')
            });
        }));
        it('should not power on already running machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'running' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            yield expect(mutationsResolver.powerOn(machine.id, ctx)).rejects.toThrow(errors_1.UserInputError);
            expect(mockVirtManager.powerOn).not.toHaveBeenCalled();
        }));
        it('should handle libvirt power on failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'stopped' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            mockVirtManager.powerOn.mockRejectedValue(new Error('Failed to start domain'));
            yield expect(mutationsResolver.powerOn(machine.id, ctx)).rejects.toThrow('Failed to start domain');
        }));
    });
    describe('powerOff', () => {
        it('should power off running machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'running' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            mockVirtManager.powerOff.mockResolvedValue({ success: true });
            jest_setup_1.mockPrisma.machine.update.mockResolvedValue(Object.assign(Object.assign({}, machine), { status: 'stopped' }));
            const result = yield mutationsResolver.powerOff(machine.id, ctx);
            expect(mockVirtManager.powerOff).toHaveBeenCalledWith(machine.internalName, false);
            expect(jest_setup_1.mockPrisma.machine.update).toHaveBeenCalledWith({
                where: { id: machine.id },
                data: { status: 'stopped' }
            });
            expect(result).toEqual({
                success: true,
                message: expect.stringContaining('powered off')
            });
        }));
        it('should power off running machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'running' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            mockVirtManager.powerOff.mockResolvedValue({ success: true });
            jest_setup_1.mockPrisma.machine.update.mockResolvedValue(Object.assign(Object.assign({}, machine), { status: 'stopped' }));
            yield mutationsResolver.powerOff(machine.id, ctx);
            expect(mockVirtManager.powerOff).toHaveBeenCalled();
        }));
        it('should not power off already stopped machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'stopped' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            yield expect(mutationsResolver.powerOff(machine.id, ctx)).rejects.toThrow(errors_1.UserInputError);
            expect(mockVirtManager.powerOff).not.toHaveBeenCalled();
        }));
    });
    describe('suspend', () => {
        it('should suspend running machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'running' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            mockVirtManager.suspend.mockResolvedValue({ success: true });
            jest_setup_1.mockPrisma.machine.update.mockResolvedValue(Object.assign(Object.assign({}, machine), { status: 'suspended' }));
            const result = yield mutationsResolver.suspend(machine.id, ctx);
            expect(mockVirtManager.suspend).toHaveBeenCalled();
            expect(result).toEqual({
                success: true,
                message: expect.stringContaining('suspend')
            });
        }));
        it('should not suspend stopped machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const machine = (0, mock_factories_1.createMockMachine)({ status: 'stopped' });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machine);
            yield expect(mutationsResolver.suspend(machine.id, ctx)).rejects.toThrow(errors_1.UserInputError);
        }));
    });
    describe('Authorization Tests', () => {
        it('should allow USER to view their own machines', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = (0, mock_factories_1.createMockUser)();
            const userMachine = (0, mock_factories_1.createMockMachine)({ userId: user.id });
            const context = (0, test_helpers_1.createMockContext)(user);
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(userMachine);
            const result = yield queriesResolver.machine(userMachine.id, context);
            expect(result).toEqual(userMachine);
        }));
        it('should require ADMIN for createMachine', () => {
            const metadata = Reflect.getMetadata('custom:authorized', resolver_1.MachineMutations.prototype, 'createMachine');
            expect(metadata).toBe('ADMIN');
        });
        it('should require ADMIN for destroyMachine', () => {
            const metadata = Reflect.getMetadata('custom:authorized', resolver_1.MachineMutations.prototype, 'destroyMachine');
            expect(metadata).toBe('USER');
        });
        it('should require USER for power operations', () => {
            const powerOnMeta = Reflect.getMetadata('custom:authorized', resolver_1.MachineMutations.prototype, 'powerOn');
            const powerOffMeta = Reflect.getMetadata('custom:authorized', resolver_1.MachineMutations.prototype, 'powerOff');
            const suspendMeta = Reflect.getMetadata('custom:authorized', resolver_1.MachineMutations.prototype, 'suspend');
            expect(powerOnMeta).toBe('USER');
            expect(powerOffMeta).toBe('USER');
            expect(suspendMeta).toBe('USER');
        });
    });
});
