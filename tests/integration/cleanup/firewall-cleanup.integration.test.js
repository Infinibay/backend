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
const machineCleanupServiceV2_1 = require("@services/cleanup/machineCleanupServiceV2");
const departmentCleanupService_1 = require("@services/cleanup/departmentCleanupService");
const jest_setup_1 = require("../../setup/jest.setup");
const db_factories_1 = require("../../setup/db-factories");
// External systems stay mocked — this test is about the DB-side cleanup.
const mockDestroyVM = jest.fn().mockResolvedValue({ success: true });
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn(() => ({
        destroyVM: mockDestroyVM,
        getNftablesService: jest.fn(() => ({ chainExists: jest.fn().mockResolvedValue(false) }))
    }))
}));
jest.mock('@infinibay/infinization', () => ({
    TapDeviceManager: jest.fn().mockImplementation(() => ({
        exists: jest.fn().mockResolvedValue(false)
    })),
    generateVMChainName: jest.fn((id) => `vm_${id.substring(0, 8)}`)
}));
jest.mock('@services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: jest.fn(() => ({
        cleanupVmConnection: jest.fn()
    }))
}));
jest.mock('@services/network/DepartmentNetworkService', () => ({
    DepartmentNetworkService: jest.fn().mockImplementation(() => ({
        destroyNetwork: jest.fn().mockResolvedValue(undefined),
        forceDestroyNetwork: jest.fn().mockResolvedValue({ success: true })
    }))
}));
jest.mock('fs/promises', () => ({
    unlink: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    readdir: jest.fn().mockResolvedValue([])
}));
describe('Firewall cleanup — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    const machineCleanup = () => new machineCleanupServiceV2_1.MachineCleanupServiceV2(prisma);
    const departmentCleanup = () => new departmentCleanupService_1.DepartmentCleanupService(prisma);
    let admin;
    let department;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        admin = yield (0, db_factories_1.createAdmin)(prisma);
        department = yield (0, db_factories_1.createDepartment)(prisma);
        mockDestroyVM.mockReset();
        mockDestroyVM.mockResolvedValue({ success: true });
    }));
    function seedVMWithRuleset() {
        return __awaiter(this, arguments, void 0, function* (rulesCount = 0) {
            const vm = yield (0, db_factories_1.createMachine)(prisma, {
                userId: admin.id,
                departmentId: department.id,
                withConfiguration: true
            });
            const ruleSet = yield prisma.firewallRuleSet.create({
                data: {
                    name: `VM Firewall ${vm.id}`,
                    internalName: `vm-${vm.id.substring(0, 8)}`,
                    entityType: client_1.RuleSetType.VM,
                    entityId: vm.id,
                    priority: 500,
                    isActive: true,
                }
            });
            yield prisma.machine.update({
                where: { id: vm.id },
                data: { firewallRuleSetId: ruleSet.id }
            });
            for (let i = 0; i < rulesCount; i++) {
                yield prisma.firewallRule.create({
                    data: {
                        ruleSetId: ruleSet.id,
                        name: `Rule ${i}`,
                        action: 'ACCEPT',
                        direction: 'IN',
                        priority: 100 + i,
                        protocol: 'tcp',
                    }
                });
            }
            return { vm, ruleSet };
        });
    }
    describe('VM firewall cleanup', () => {
        it('calls infinization.destroyVM as part of cleanup', () => __awaiter(void 0, void 0, void 0, function* () {
            const { vm } = yield seedVMWithRuleset(1);
            yield machineCleanup().cleanupVM(vm.id);
            expect(mockDestroyVM).toHaveBeenCalledWith(vm.id);
        }));
        it('removes the VM FirewallRuleSet and its rules from the DB', () => __awaiter(void 0, void 0, void 0, function* () {
            const { vm, ruleSet } = yield seedVMWithRuleset(3);
            expect(yield prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(3);
            yield machineCleanup().cleanupVM(vm.id);
            expect(yield prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(0);
            expect(yield prisma.firewallRuleSet.findUnique({ where: { id: ruleSet.id } })).toBeNull();
            expect(yield prisma.machine.findUnique({ where: { id: vm.id } })).toBeNull();
        }));
        it('deletes the VM even when it has no firewall rule set', () => __awaiter(void 0, void 0, void 0, function* () {
            const vm = yield (0, db_factories_1.createMachine)(prisma, {
                userId: admin.id,
                departmentId: department.id,
                withConfiguration: true
            });
            yield expect(machineCleanup().cleanupVM(vm.id)).resolves.not.toThrow();
            expect(yield prisma.machine.findUnique({ where: { id: vm.id } })).toBeNull();
        }));
        it('deletes the VM even when infinization cleanup reports failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const { vm } = yield seedVMWithRuleset();
            mockDestroyVM.mockResolvedValueOnce({ success: false, error: 'Process not found' });
            yield expect(machineCleanup().cleanupVM(vm.id)).resolves.not.toThrow();
            expect(yield prisma.machine.findUnique({ where: { id: vm.id } })).toBeNull();
        }));
    });
    describe('Department firewall cleanup', () => {
        function seedDepartmentWithRuleset() {
            return __awaiter(this, arguments, void 0, function* (rulesCount = 0) {
                const ruleSet = yield prisma.firewallRuleSet.create({
                    data: {
                        name: `Dept Firewall ${department.id}`,
                        internalName: `dept-${department.id.substring(0, 8)}`,
                        entityType: client_1.RuleSetType.DEPARTMENT,
                        entityId: department.id,
                        priority: 1000,
                        isActive: true,
                    }
                });
                yield prisma.department.update({
                    where: { id: department.id },
                    data: { firewallRuleSetId: ruleSet.id }
                });
                for (let i = 0; i < rulesCount; i++) {
                    yield prisma.firewallRule.create({
                        data: {
                            ruleSetId: ruleSet.id,
                            name: `Rule ${i}`,
                            action: 'ACCEPT',
                            direction: 'IN',
                            priority: 100 + i,
                            protocol: 'tcp',
                        }
                    });
                }
                return ruleSet;
            });
        }
        it('removes the department, its FirewallRuleSet, and rules from the DB', () => __awaiter(void 0, void 0, void 0, function* () {
            const ruleSet = yield seedDepartmentWithRuleset(2);
            expect(yield prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(2);
            yield departmentCleanup().cleanupDepartment(department.id);
            expect(yield prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(0);
            expect(yield prisma.firewallRuleSet.findUnique({ where: { id: ruleSet.id } })).toBeNull();
            expect(yield prisma.department.findUnique({ where: { id: department.id } })).toBeNull();
        }));
        it('refuses to delete a department that still has VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, db_factories_1.createMachine)(prisma, { userId: admin.id, departmentId: department.id });
            yield (0, db_factories_1.createMachine)(prisma, { userId: admin.id, departmentId: department.id });
            yield expect(departmentCleanup().cleanupDepartment(department.id))
                .rejects.toThrow(/VMs still exist/);
            // Department remains.
            expect(yield prisma.department.findUnique({ where: { id: department.id } })).not.toBeNull();
        }));
        it('deletes the department when it has no firewall rule set', () => __awaiter(void 0, void 0, void 0, function* () {
            yield departmentCleanup().cleanupDepartment(department.id);
            expect(yield prisma.department.findUnique({ where: { id: department.id } })).toBeNull();
        }));
    });
});
