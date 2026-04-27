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
const machineLifecycleService_1 = require("@services/machineLifecycleService");
const machineCleanupServiceV2_1 = require("@services/cleanup/machineCleanupServiceV2");
const type_1 = require("@graphql/resolvers/machine/type");
const jest_setup_1 = require("../setup/jest.setup");
const db_factories_1 = require("../setup/db-factories");
// External systems — still mocked because this test isn't about libvirt/infinization.
jest.mock('@infinibay/libvirt-node');
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn().mockResolvedValue({
        getVMStatus: jest.fn().mockResolvedValue({ processAlive: false }),
        getVMInfo: jest.fn().mockResolvedValue({}),
        stopVM: jest.fn().mockResolvedValue(undefined),
        destroyVM: jest.fn().mockResolvedValue({ success: true }),
    }),
    initializeInfinization: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@utils/VirtManager', () => ({
    default: jest.fn().mockImplementation(() => ({
        createVM: jest.fn().mockResolvedValue(true),
        destroyVM: jest.fn().mockResolvedValue(true),
        startVM: jest.fn().mockResolvedValue(true),
        stopVM: jest.fn().mockResolvedValue(true),
        getVMState: jest.fn().mockResolvedValue('running'),
        updateVMHardware: jest.fn().mockResolvedValue(true)
    }))
}));
jest.mock('@services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: jest.fn(() => ({
        cleanupVmConnection: jest.fn(),
        disconnectVm: jest.fn(),
        isVmConnected: jest.fn().mockReturnValue(false)
    }))
}));
jest.mock('fs/promises', () => (Object.assign(Object.assign({}, jest.requireActual('fs/promises')), { unlink: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })), readdir: jest.fn().mockResolvedValue([]) })));
// MachineLifecycleService.createMachine fires `setImmediate(() => backgroundCode(...))`
// after committing the VM row. In production that spawns the VM via libvirt; in
// tests it would keep the event loop alive past the test's end. Stub it to a
// no-op so the process exits cleanly without --forceExit.
beforeAll(() => {
    jest
        .spyOn(machineLifecycleService_1.MachineLifecycleService.prototype, 'backgroundCode')
        .mockResolvedValue(undefined);
});
describe('VM Lifecycle — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    let admin;
    let regularUser;
    let department;
    let template;
    let application;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        admin = yield (0, db_factories_1.createAdmin)(prisma);
        regularUser = yield (0, db_factories_1.createUser)(prisma);
        department = yield (0, db_factories_1.createDepartment)(prisma);
        template = yield (0, db_factories_1.createTemplate)(prisma, { cores: 4, ram: 8, storage: 100 });
        application = yield (0, db_factories_1.createApplication)(prisma);
    }));
    describe('createMachine', () => {
        it('creates a VM with all resources inside a single transaction', () => __awaiter(void 0, void 0, void 0, function* () {
            const service = new machineLifecycleService_1.MachineLifecycleService(prisma, admin);
            const created = yield service.createMachine({
                name: 'Test VM',
                templateId: template.id,
                departmentId: department.id,
                os: type_1.OsEnum.UBUNTU,
                username: 'testuser',
                password: 'TestPass123!',
                productKey: undefined,
                firstBootScripts: [],
                pciBus: null,
                applications: [{
                        machineId: '',
                        applicationId: application.id,
                        parameters: {}
                    }]
            });
            expect(created.id).toBeDefined();
            expect(created.status).toBe('building');
            expect(created.cpuCores).toBe(template.cores);
            expect(created.ramGB).toBe(template.ram);
            // Verify everything is actually in the DB.
            const dbMachine = yield prisma.machine.findUnique({
                where: { id: created.id },
                include: { configuration: true, applications: true }
            });
            expect(dbMachine).not.toBeNull();
            expect(dbMachine.userId).toBe(admin.id);
            expect(dbMachine.departmentId).toBe(department.id);
            expect(dbMachine.configuration).not.toBeNull();
            expect(dbMachine.applications).toHaveLength(1);
            expect(dbMachine.applications[0].applicationId).toBe(application.id);
        }));
        it('rolls back the transaction if the template is missing', () => __awaiter(void 0, void 0, void 0, function* () {
            const service = new machineLifecycleService_1.MachineLifecycleService(prisma, admin);
            yield expect(service.createMachine({
                name: 'Test VM',
                templateId: 'non-existent-template',
                departmentId: department.id,
                os: type_1.OsEnum.UBUNTU,
                username: 'testuser',
                password: 'TestPass123!',
                productKey: undefined,
                firstBootScripts: [],
                pciBus: null,
                applications: []
            })).rejects.toThrow('Machine template not found');
            // Nothing written.
            expect(yield prisma.machine.count()).toBe(0);
            expect(yield prisma.machineConfiguration.count()).toBe(0);
        }));
        it('rolls back the transaction if the department is missing', () => __awaiter(void 0, void 0, void 0, function* () {
            const service = new machineLifecycleService_1.MachineLifecycleService(prisma, admin);
            yield expect(service.createMachine({
                name: 'Test VM',
                templateId: template.id,
                departmentId: 'non-existent-dept',
                os: type_1.OsEnum.UBUNTU,
                username: 'testuser',
                password: 'TestPass123!',
                productKey: undefined,
                firstBootScripts: [],
                pciBus: null,
                applications: []
            })).rejects.toThrow('Department not found');
            expect(yield prisma.machine.count()).toBe(0);
        }));
        it('assigns ownership to the calling user', () => __awaiter(void 0, void 0, void 0, function* () {
            const service = new machineLifecycleService_1.MachineLifecycleService(prisma, regularUser);
            const created = yield service.createMachine({
                name: 'User VM',
                templateId: template.id,
                departmentId: department.id,
                os: type_1.OsEnum.UBUNTU,
                username: 'testuser',
                password: 'TestPass123!',
                productKey: undefined,
                firstBootScripts: [],
                pciBus: null,
                applications: []
            });
            const dbMachine = yield prisma.machine.findUnique({ where: { id: created.id } });
            expect(dbMachine.userId).toBe(regularUser.id);
        }));
    });
    describe('destroyMachine authorization', () => {
        it('admins can destroy a VM they do not own', () => __awaiter(void 0, void 0, void 0, function* () {
            const otherUser = yield (0, db_factories_1.createUser)(prisma);
            const vm = yield (0, db_factories_1.createMachine)(prisma, {
                userId: otherUser.id,
                departmentId: department.id,
                overrides: { status: 'running' }
            });
            const result = yield new machineLifecycleService_1.MachineLifecycleService(prisma, admin).destroyMachine(vm.id);
            expect(result.success).toBe(true);
        }));
        it('regular users cannot destroy a VM they do not own', () => __awaiter(void 0, void 0, void 0, function* () {
            const otherUser = yield (0, db_factories_1.createUser)(prisma);
            const vm = yield (0, db_factories_1.createMachine)(prisma, {
                userId: otherUser.id,
                departmentId: department.id,
                overrides: { status: 'running' }
            });
            const result = yield new machineLifecycleService_1.MachineLifecycleService(prisma, regularUser).destroyMachine(vm.id);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Machine not found');
            expect(yield prisma.machine.findUnique({ where: { id: vm.id } })).not.toBeNull();
        }));
    });
    describe('cleanupVM', () => {
        function seedMachine() {
            return __awaiter(this, void 0, void 0, function* () {
                const vm = yield (0, db_factories_1.createMachine)(prisma, {
                    userId: admin.id,
                    departmentId: department.id,
                    withConfiguration: true
                });
                yield prisma.machineApplication.create({
                    data: { machineId: vm.id, applicationId: application.id, parameters: {} }
                });
                return vm;
            });
        }
        it('removes the machine, its configuration, and joined applications', () => __awaiter(void 0, void 0, void 0, function* () {
            const vm = yield seedMachine();
            expect(yield prisma.machine.count()).toBe(1);
            expect(yield prisma.machineConfiguration.count()).toBe(1);
            expect(yield prisma.machineApplication.count()).toBe(1);
            const cleanupService = new machineCleanupServiceV2_1.MachineCleanupServiceV2(prisma);
            yield cleanupService.cleanupVM(vm.id);
            expect(yield prisma.machine.count()).toBe(0);
            expect(yield prisma.machineConfiguration.count()).toBe(0);
            expect(yield prisma.machineApplication.count()).toBe(0);
        }));
        it('is a no-op when the machine does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const cleanupService = new machineCleanupServiceV2_1.MachineCleanupServiceV2(prisma);
            yield expect(cleanupService.cleanupVM('no-such-id')).resolves.toBeUndefined();
        }));
        it('completes cleanup even when disk file deletion fails', () => __awaiter(void 0, void 0, void 0, function* () {
            // fs/promises.unlink is already mocked to reject with ENOENT (see top-level mock).
            const vm = yield seedMachine();
            const cleanupService = new machineCleanupServiceV2_1.MachineCleanupServiceV2(prisma);
            yield expect(cleanupService.cleanupVM(vm.id)).resolves.toBeUndefined();
            expect(yield prisma.machine.count()).toBe(0);
        }));
    });
});
