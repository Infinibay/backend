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
const FirewallEventManager_1 = require("@services/FirewallEventManager");
describe('FirewallEventManager', () => {
    let firewallEventManager;
    let mockSocketService;
    let mockPrisma;
    beforeEach(() => {
        mockSocketService = {
            sendToUser: jest.fn()
        };
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        firewallEventManager = new FirewallEventManager_1.FirewallEventManager(mockSocketService, mockPrisma);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    describe('handleEvent', () => {
        describe('Department Firewall Rules', () => {
            it('should send rule:created:department event to all admins and users with VMs in department', () => __awaiter(void 0, void 0, void 0, function* () {
                const departmentId = 'dept-123';
                const ruleId = 'rule-456';
                // Mock rule data
                const mockRule = {
                    id: ruleId,
                    name: 'Allow HTTPS',
                    ruleSet: {
                        entityType: client_1.RuleSetType.DEPARTMENT,
                        entityId: departmentId
                    }
                };
                // Mock admin users
                const mockAdmins = [
                    { id: 'admin-1' },
                    { id: 'admin-2' }
                ];
                // Mock users with VMs in department
                const mockDeptUsers = [
                    { id: 'user-1' },
                    { id: 'user-2' }
                ];
                mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule);
                mockPrisma.user.findMany
                    .mockResolvedValueOnce(mockAdmins) // Admin query
                    .mockResolvedValueOnce(mockDeptUsers); // Department users query
                yield firewallEventManager.handleEvent('create', { id: ruleId }, 'admin-1');
                // Should fetch rule data
                expect(mockPrisma.firewallRule.findUnique).toHaveBeenCalledWith({
                    where: { id: ruleId },
                    include: { ruleSet: true }
                });
                // Should query admins
                expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
                    where: {
                        role: 'ADMIN',
                        deleted: false
                    },
                    select: { id: true }
                });
                // Should query users with VMs in department
                expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
                    where: {
                        deleted: false,
                        VM: {
                            some: {
                                departmentId
                            }
                        }
                    },
                    select: { id: true }
                });
                // Should send events to all 4 users (2 admins + 2 department users)
                expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(4);
                // Verify event format for one of the calls
                expect(mockSocketService.sendToUser).toHaveBeenCalledWith(expect.any(String), 'firewall', 'rule:created:department', {
                    status: 'success',
                    data: {
                        ruleId,
                        ruleName: 'Allow HTTPS',
                        departmentId
                    }
                });
            }));
            it('should send rule:updated:department event', () => __awaiter(void 0, void 0, void 0, function* () {
                const departmentId = 'dept-123';
                const ruleId = 'rule-456';
                const mockRule = {
                    id: ruleId,
                    name: 'Updated Rule',
                    ruleSet: {
                        entityType: client_1.RuleSetType.DEPARTMENT,
                        entityId: departmentId
                    }
                };
                mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule);
                mockPrisma.user.findMany
                    .mockResolvedValueOnce([{ id: 'admin-1' }])
                    .mockResolvedValueOnce([{ id: 'user-1' }]);
                yield firewallEventManager.handleEvent('update', { id: ruleId });
                expect(mockSocketService.sendToUser).toHaveBeenCalledWith(expect.any(String), 'firewall', 'rule:updated:department', expect.objectContaining({
                    status: 'success',
                    data: expect.objectContaining({
                        ruleId,
                        departmentId
                    })
                }));
            }));
            it('should send rule:deleted:department event', () => __awaiter(void 0, void 0, void 0, function* () {
                const departmentId = 'dept-123';
                const ruleId = 'rule-456';
                const mockRule = {
                    id: ruleId,
                    name: 'Deleted Rule',
                    ruleSet: {
                        entityType: client_1.RuleSetType.DEPARTMENT,
                        entityId: departmentId
                    }
                };
                mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule);
                mockPrisma.user.findMany
                    .mockResolvedValueOnce([{ id: 'admin-1' }])
                    .mockResolvedValueOnce([{ id: 'user-1' }]);
                yield firewallEventManager.handleEvent('delete', { id: ruleId });
                expect(mockSocketService.sendToUser).toHaveBeenCalledWith(expect.any(String), 'firewall', 'rule:deleted:department', expect.objectContaining({
                    status: 'success',
                    data: expect.objectContaining({
                        ruleId,
                        departmentId
                    })
                }));
            }));
        });
        describe('VM Firewall Rules', () => {
            it('should send rule:created event to admins and VM owner', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmId = 'vm-123';
                const ruleId = 'rule-789';
                const ownerId = 'user-1';
                const mockRule = {
                    id: ruleId,
                    name: 'Allow SSH',
                    ruleSet: {
                        entityType: client_1.RuleSetType.VM,
                        entityId: vmId
                    }
                };
                const mockAdmins = [{ id: 'admin-1' }];
                const mockVM = { userId: ownerId };
                mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule);
                mockPrisma.user.findMany.mockResolvedValueOnce(mockAdmins);
                mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
                yield firewallEventManager.handleEvent('create', { id: ruleId });
                // Should query VM to get owner
                expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                    where: { id: vmId },
                    select: { userId: true }
                });
                // Should send to admin and VM owner (2 users)
                expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(2);
                // Verify event format
                expect(mockSocketService.sendToUser).toHaveBeenCalledWith(expect.any(String), 'firewall', 'rule:created', {
                    status: 'success',
                    data: {
                        ruleId,
                        ruleName: 'Allow SSH',
                        vmId
                    }
                });
            }));
            it('should send rule:updated event', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmId = 'vm-123';
                const ruleId = 'rule-789';
                const mockRule = {
                    id: ruleId,
                    name: 'Updated VM Rule',
                    ruleSet: {
                        entityType: client_1.RuleSetType.VM,
                        entityId: vmId
                    }
                };
                mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule);
                mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
                mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' });
                yield firewallEventManager.handleEvent('update', { id: ruleId });
                expect(mockSocketService.sendToUser).toHaveBeenCalledWith(expect.any(String), 'firewall', 'rule:updated', expect.objectContaining({
                    status: 'success',
                    data: expect.objectContaining({
                        ruleId,
                        vmId
                    })
                }));
            }));
            it('should send rule:deleted event', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmId = 'vm-123';
                const ruleId = 'rule-789';
                const mockRule = {
                    id: ruleId,
                    name: 'Deleted VM Rule',
                    ruleSet: {
                        entityType: client_1.RuleSetType.VM,
                        entityId: vmId
                    }
                };
                mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule);
                mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
                mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' });
                yield firewallEventManager.handleEvent('delete', { id: ruleId });
                expect(mockSocketService.sendToUser).toHaveBeenCalledWith(expect.any(String), 'firewall', 'rule:deleted', expect.objectContaining({
                    status: 'success',
                    data: expect.objectContaining({
                        ruleId,
                        vmId
                    })
                }));
            }));
            it('should handle VM with no owner gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmId = 'vm-123';
                const ruleId = 'rule-789';
                const mockRule = {
                    id: ruleId,
                    name: 'VM Rule No Owner',
                    ruleSet: {
                        entityType: client_1.RuleSetType.VM,
                        entityId: vmId
                    }
                };
                mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule);
                mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
                mockPrisma.machine.findUnique.mockResolvedValue({ userId: null });
                yield firewallEventManager.handleEvent('create', { id: ruleId });
                // Should only send to admin (1 user)
                expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(1);
                expect(mockSocketService.sendToUser).toHaveBeenCalledWith('admin-1', 'firewall', 'rule:created', expect.any(Object));
            }));
        });
        describe('Error Handling', () => {
            it('should handle rule not found gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.firewallRule.findUnique.mockResolvedValue(null);
                yield expect(firewallEventManager.handleEvent('create', { id: 'non-existent' })).resolves.not.toThrow();
                // Should not send any events
                expect(mockSocketService.sendToUser).not.toHaveBeenCalled();
            }));
            it('should handle database errors gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
                mockPrisma.firewallRule.findUnique.mockRejectedValue(new Error('Database error'));
                // Should not throw - errors are caught and logged
                yield expect(firewallEventManager.handleEvent('create', { id: 'rule-123' })).resolves.not.toThrow();
                // Should not send any events due to error
                expect(mockSocketService.sendToUser).not.toHaveBeenCalled();
            }));
            it('should handle rule data with ruleSet already included', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmId = 'vm-123';
                const ruleData = {
                    id: 'rule-456',
                    name: 'Pre-loaded Rule',
                    ruleSet: {
                        entityType: client_1.RuleSetType.VM,
                        entityId: vmId
                    }
                };
                mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
                mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' });
                yield firewallEventManager.handleEvent('create', ruleData);
                // Should NOT query database for rule (already provided)
                expect(mockPrisma.firewallRule.findUnique).not.toHaveBeenCalled();
                // Should still send events
                expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(2);
            }));
        });
    });
});
