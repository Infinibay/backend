"use strict";
/**
 * Tests for EventManager subclasses (User, Department, Application, Scripts, VMDetail, ISO).
 * Uses mockDeep<PrismaClient> directly to avoid strict typing issues with global mockPrisma.
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
require("reflect-metadata");
const jest_mock_extended_1 = require("jest-mock-extended");
const UserEventManager_1 = require("../../../app/services/UserEventManager");
const DepartmentEventManager_1 = require("../../../app/services/DepartmentEventManager");
const ApplicationEventManager_1 = require("../../../app/services/ApplicationEventManager");
const ScriptsEventManager_1 = require("../../../app/services/ScriptsEventManager");
const VMDetailEventManager_1 = require("../../../app/services/VMDetailEventManager");
const ISOEventManager_1 = require("../../../app/services/EventManagers/ISOEventManager");
const mockSocketService = {
    sendToUser: jest.fn(),
    broadcastToResource: jest.fn(),
    broadcastToAll: jest.fn(),
    getStats: jest.fn().mockReturnValue({ connectedUsers: 0, userIds: [] }),
    getIO: jest.fn(),
};
const mockPrisma = (0, jest_mock_extended_1.mockDeep)();
jest.mock('../../../app/services/SocketService', () => ({
    getSocketService: jest.fn(() => mockSocketService),
}));
jest.mock('../../../app/logger', () => ({
    child: jest.fn(() => ({
        debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    })),
}));
describe('UserEventManager', () => {
    let service;
    beforeEach(() => { jest.clearAllMocks(); service = new UserEventManager_1.UserEventManager(mockSocketService, mockPrisma); });
    describe('fetchResourceData', () => {
        it('returns userData as-is if already complete', () => __awaiter(void 0, void 0, void 0, function* () {
            const d = { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U' };
            expect(yield service.fetchResourceData(d)).toEqual(d);
        }));
        it('fetches user from DB by ID', () => __awaiter(void 0, void 0, void 0, function* () {
            const u = { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER', createdAt: new Date(), deleted: false, VM: [] };
            mockPrisma.user.findUnique.mockResolvedValue(u);
            const r = yield service.fetchResourceData('u1');
            expect(r.id).toBe('u1');
        }));
        it('returns null if not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findUnique.mockResolvedValue(null);
            expect(yield service.fetchResourceData('x')).toBeNull();
        }));
        it('returns null if no userId', () => __awaiter(void 0, void 0, void 0, function* () { expect(yield service.fetchResourceData({})).toBeNull(); }));
        it('returns null on DB error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findUnique.mockRejectedValue(new Error('DB'));
            expect(yield service.fetchResourceData('u1')).toBeNull();
        }));
        it('includes VMs in fetched data', () => __awaiter(void 0, void 0, void 0, function* () {
            const u = { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER', createdAt: new Date(), deleted: false, VM: [{ id: 'vm1', name: 'VM1', status: 'running' }] };
            mockPrisma.user.findUnique.mockResolvedValue(u);
            expect((yield service.fetchResourceData('u1')).VM).toEqual([{ id: 'vm1', name: 'VM1', status: 'running' }]);
        }));
    });
    describe('getTargetUsers', () => {
        it('includes the user themselves', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            const r = yield service.getTargetUsers({ id: 'user-1' }, 'update');
            expect(r).toContain('user-1');
            expect(r).toContain('admin-1');
        }));
        it('includes all admin users', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);
            expect((yield service.getTargetUsers({ id: 'u1' }, 'update'))).toContain('admin-2');
        }));
        it('includes related users on update', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
            mockPrisma.machine.findMany.mockResolvedValueOnce([{ departmentId: 'd1' }]);
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'rel-1' }]);
            const r = yield service.getTargetUsers({ id: 'u1' }, 'update');
            expect(r).toContain('rel-1');
        }));
        it('returns user id even on error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockRejectedValue(new Error('DB'));
            expect(yield service.getTargetUsers({ id: 'u1' }, 'create')).toEqual(['u1']);
        }));
        it('handles user without id', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            const r = yield service.getTargetUsers({ name: 'no-id' }, 'update');
            expect(r).toContain('admin-1');
        }));
    });
    describe('handleEvent', () => {
        it('handles user create event', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('create', { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handles user delete event', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('delete', { id: 'u1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('skips if user not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findUnique.mockResolvedValue(null);
            yield service.handleEvent('update', { id: 'x' });
            expect(mockSocketService.sendToUser).not.toHaveBeenCalled();
        }));
    });
    describe('sanitizeUserData', () => {
        it('removes password and token', () => {
            const r = service.sanitizeUserData({ id: 'u1', email: 't@t.com', password: 's', token: 't', firstName: 'T' });
            expect(r.password).toBeUndefined();
            expect(r.token).toBeUndefined();
            expect(r.email).toBe('t@t.com');
        });
        it('returns clean object when no secrets', () => {
            const r = service.sanitizeUserData({ id: 'u1', email: 't@t.com' });
            expect(r.password).toBeUndefined();
            expect(r.token).toBeUndefined();
        });
    });
    describe('getRelatedUsers', () => {
        it('finds users in same departments', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findMany.mockResolvedValue([{ departmentId: 'd1' }]);
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'rel-1' }]);
            expect(yield service.getRelatedUsers('u1')).toContain('rel-1');
        }));
        it('returns empty when no VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findMany.mockResolvedValue([]);
            expect(yield service.getRelatedUsers('u1')).toEqual([]);
        }));
        it('returns empty on error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findMany.mockRejectedValue(new Error('DB'));
            expect(yield service.getRelatedUsers('u1')).toEqual([]);
        }));
    });
    describe('getTargetUsersForDeleted', () => {
        it('includes all admin users', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            expect(yield service.getTargetUsersForDeleted({ id: 'u1' })).toContain('admin-1');
        }));
        it('includes related users', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]);
            mockPrisma.machine.findMany.mockResolvedValueOnce([{ departmentId: 'd1' }]);
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'rel-1' }]);
            const r = yield service.getTargetUsersForDeleted({ id: 'u1' });
            expect(r).toContain('rel-1');
        }));
        it('returns empty on error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockRejectedValue(new Error('DB'));
            expect(yield service.getTargetUsersForDeleted({ id: 'u1' })).toEqual([]);
        }));
    });
    describe('convenience methods', () => {
        it('handleUserCreated', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleUserCreated({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleUserUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleUserUpdated({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleUserDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleUserDeleted({ id: 'u1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('passes triggeredBy', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleUserCreated({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' }, 'admin');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
    });
});
describe('DepartmentEventManager', () => {
    let service;
    beforeEach(() => { jest.clearAllMocks(); service = new DepartmentEventManager_1.DepartmentEventManager(mockSocketService, mockPrisma); });
    describe('fetchResourceData', () => {
        it('returns deptData as-is if complete', () => __awaiter(void 0, void 0, void 0, function* () {
            expect(yield service.fetchResourceData({ id: 'd1', name: 'T', totalMachines: 5 })).toEqual({ id: 'd1', name: 'T', totalMachines: 5 });
        }));
        it('fetches from DB', () => __awaiter(void 0, void 0, void 0, function* () {
            const d = { id: 'd1', name: 'Test', createdAt: new Date(), internetSpeed: 100, ipSubnet: '10.0.0.0/24', firewallPolicy: 'strict', firewallDefaultConfig: {}, firewallCustomRules: [] };
            mockPrisma.department.findUnique.mockResolvedValue(Object.assign(Object.assign({}, d), { _count: { machines: 5 } }));
            const r = yield service.fetchResourceData('d1');
            expect(r.id).toBe('d1');
            expect(r.totalMachines).toBe(5);
            expect(r.internetSpeed).toBe(100);
        }));
        it('returns null if not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.department.findUnique.mockResolvedValue(null);
            expect(yield service.fetchResourceData('x')).toBeNull();
        }));
        it('returns null if no deptId', () => __awaiter(void 0, void 0, void 0, function* () { expect(yield service.fetchResourceData({})).toBeNull(); }));
        it('returns null on DB error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.department.findUnique.mockRejectedValue(new Error('DB'));
            expect(yield service.fetchResourceData('d1')).toBeNull();
        }));
        it('handles undefined optional fields', () => __awaiter(void 0, void 0, void 0, function* () {
            const d = { id: 'd1', name: 'Test', createdAt: new Date(), internetSpeed: null, ipSubnet: null, firewallPolicy: 'strict', firewallDefaultConfig: null, firewallCustomRules: null };
            mockPrisma.department.findUnique.mockResolvedValue(Object.assign(Object.assign({}, d), { _count: { machines: 0 } }));
            const r = yield service.fetchResourceData('d1');
            expect(r.internetSpeed).toBeUndefined();
            expect(r.ipSubnet).toBeUndefined();
        }));
    });
    describe('getTargetUsers', () => {
        it('includes admin users', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            expect((yield service.getTargetUsers({ id: 'd1' }, 'update'))).toContain('admin-1');
        }));
        it('includes department users', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'dept-1' }]);
            expect((yield service.getTargetUsers({ id: 'd1' }, 'update'))).toContain('dept-1');
        }));
        it('includes active users on create', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'dept-1' }]).mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }]);
            const r = yield service.getTargetUsers({ id: 'd1' }, 'create');
            expect(r).toContain('a1');
            expect(r).toContain('a2');
        }));
        it('returns empty on error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockRejectedValue(new Error('DB'));
            expect(yield service.getTargetUsers({ id: 'd1' }, 'create')).toEqual([]);
        }));
    });
    describe('handleEvent', () => {
        it('handles create', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.department.findUnique.mockResolvedValue({ id: 'd1', name: 'T', _count: { machines: 0 } });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('create', { id: 'd1', name: 'T', _count: { machines: 0 } });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handles delete', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('delete', { id: 'd1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('skips if not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.department.findUnique.mockResolvedValue(null);
            yield service.handleEvent('update', { id: 'x' });
            expect(mockSocketService.sendToUser).not.toHaveBeenCalled();
        }));
    });
    describe('convenience methods', () => {
        it('handleDepartmentCreated', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.department.findUnique.mockResolvedValue({ id: 'd1', name: 'T', _count: { machines: 0 } });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleDepartmentCreated({ id: 'd1', name: 'T', _count: { machines: 0 } });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleDepartmentUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.department.findUnique.mockResolvedValue({ id: 'd1', name: 'T', _count: { machines: 0 } });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleDepartmentUpdated({ id: 'd1', name: 'T', _count: { machines: 0 } });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleDepartmentDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleDepartmentDeleted({ id: 'd1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
    });
});
describe('ApplicationEventManager', () => {
    let service;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.findMany.mockReset();
        mockPrisma.application.findUnique.mockReset();
        service = new ApplicationEventManager_1.ApplicationEventManager(mockSocketService, mockPrisma);
    });
    describe('getResourceName', () => {
        it('returns application', () => {
            expect(service.getResourceName()).toBe('applications');
        });
    });
    describe('fetchResourceData', () => {
        it('returns appData as-is if complete', () => __awaiter(void 0, void 0, void 0, function* () {
            expect(yield service.fetchResourceData({ id: 'a1', name: 'T', machines: [] })).toEqual({ id: 'a1', name: 'T', machines: [] });
        }));
        it('fetches from DB by string ID', () => __awaiter(void 0, void 0, void 0, function* () {
            const app = { id: 'a1', name: 'Test', machines: [{ machine: { id: 'vm1', name: 'VM1', status: 'running', userId: 'u1', departmentId: 'd1' } }] };
            mockPrisma.application.findUnique.mockResolvedValue(app);
            expect(yield service.fetchResourceData('a1')).toEqual(app);
        }));
        it('fetches from DB by object ID', () => __awaiter(void 0, void 0, void 0, function* () {
            const app = { id: 'a2', name: 'Test2', machines: [] };
            mockPrisma.application.findUnique.mockResolvedValue(app);
            expect(yield service.fetchResourceData({ id: 'a2' })).toEqual(app);
        }));
        it('returns null if not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue(null);
            expect(yield service.fetchResourceData('x')).toBeNull();
        }));
        it('returns null if no appId', () => __awaiter(void 0, void 0, void 0, function* () { expect(yield service.fetchResourceData({})).toBeNull(); }));
        it('returns null if appData is null', () => __awaiter(void 0, void 0, void 0, function* () { expect(yield service.fetchResourceData(null)).toBeNull(); }));
        it('returns null if appData is undefined', () => __awaiter(void 0, void 0, void 0, function* () { expect(yield service.fetchResourceData(undefined)).toBeNull(); }));
        it('returns null on DB error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockRejectedValue(new Error('DB'));
            expect(yield service.fetchResourceData('a1')).toBeNull();
        }));
        it('includes machines with nested machine data', () => __awaiter(void 0, void 0, void 0, function* () {
            const app = { id: 'a1', name: 'Test', machines: [{ machine: { id: 'vm1', name: 'VM1', status: 'running', userId: 'u1', departmentId: 'd1' } }] };
            mockPrisma.application.findUnique.mockResolvedValue(app);
            const r = yield service.fetchResourceData('a1');
            expect(r.machines[0].machine.userId).toBe('u1');
            expect(r.machines[0].machine.departmentId).toBe('d1');
        }));
    });
    describe('getTargetUsers', () => {
        it('includes admin users', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            expect((yield service.getTargetUsers({ id: 'a1', machines: [] }, 'update'))).toContain('admin-1');
        }));
        it('includes VM owners', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'dept-1' }]);
            const r = yield service.getTargetUsers({ id: 'a1', machines: [{ machine: { userId: 'u1', departmentId: 'd1' } }, { machine: { userId: 'u2', departmentId: 'd2' } }] }, 'update');
            expect(r).toContain('u1');
            expect(r).toContain('u2');
        }));
        it('includes department users via getUsersByDepartmentIds', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }])
                .mockResolvedValueOnce([{ id: 'dept-user-1' }, { id: 'dept-user-2' }]);
            const r = yield service.getTargetUsers({ id: 'a1', machines: [{ machine: { userId: 'u1', departmentId: 'd1' } }] }, 'update');
            expect(r).toContain('dept-user-1');
            expect(r).toContain('dept-user-2');
            expect(r).toContain('admin-1');
            expect(r).toContain('u1');
        }));
        it('includes active users on create', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'a1' }]);
            expect((yield service.getTargetUsers({ id: 'a1', machines: [] }, 'create'))).toContain('a1');
        }));
        it('handles machines with no userId/departmentId', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([]);
            const r = yield service.getTargetUsers({ id: 'a1', machines: [{ machine: { userId: null, departmentId: null } }] }, 'update');
            expect(r).toContain('admin-1');
        }));
        it('handles empty machines array', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            const r = yield service.getTargetUsers({ id: 'a1', machines: [] }, 'update');
            expect(r).toContain('admin-1');
        }));
        it('returns empty on error', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockRejectedValue(new Error('DB'));
            expect(yield service.getTargetUsers({ id: 'a1', machines: [] }, 'update')).toEqual([]);
        }));
    });
    describe('handleEvent', () => {
        it('handles create', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue({ id: 'a1', name: 'T', machines: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('create', { id: 'a1', name: 'T', machines: [] });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handles update', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue({ id: 'a1', name: 'T', machines: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('update', { id: 'a1', name: 'T', machines: [] });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handles delete', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('delete', { id: 'a1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('skips if not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue(null);
            yield service.handleEvent('update', { id: 'x' });
            expect(mockSocketService.sendToUser).not.toHaveBeenCalled();
        }));
        it('passes triggeredBy to logger', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue({ id: 'a1', name: 'T', machines: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('create', { id: 'a1', name: 'T', machines: [] }, 'admin-user');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handles delete with string ID', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('delete', 'a1');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handles delete with object ID', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('delete', { id: 'a1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
    });
    describe('convenience methods', () => {
        it('handleApplicationCreated', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue({ id: 'a1', name: 'T', machines: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleApplicationCreated({ id: 'a1', name: 'T', machines: [] });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleApplicationUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue({ id: 'a1', name: 'T', machines: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleApplicationUpdated({ id: 'a1', name: 'T', machines: [] });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleApplicationDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleApplicationDeleted({ id: 'a1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleApplicationCreated passes triggeredBy', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue({ id: 'a1', name: 'T', machines: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleApplicationCreated({ id: 'a1', name: 'T', machines: [] }, 'admin');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleApplicationUpdated passes triggeredBy', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.application.findUnique.mockResolvedValue({ id: 'a1', name: 'T', machines: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleApplicationUpdated({ id: 'a1', name: 'T', machines: [] }, 'admin');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handleApplicationDeleted passes triggeredBy', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleApplicationDeleted({ id: 'a1' }, 'admin');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
    });
});
describe('ScriptsEventManager', () => {
    let service;
    beforeEach(() => { jest.clearAllMocks(); service = new ScriptsEventManager_1.ScriptsEventManager(mockSocketService, mockPrisma); });
    describe('handleEvent', () => {
        it('handles create', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.script.findUnique.mockResolvedValue({ id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] });
            mockPrisma.user.findMany.mockResolvedValue([]);
            mockPrisma.machine.findMany.mockResolvedValue([]);
            yield service.handleEvent('create', { id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('skips if not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.script.findUnique.mockResolvedValue(null);
            yield service.handleEvent('create', { id: 'x' });
            expect(mockSocketService.sendToUser).not.toHaveBeenCalled();
        }));
        it('handles update', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.script.findUnique.mockResolvedValue({ id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] });
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('update', { id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('handles delete', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
            yield service.handleEvent('delete', { id: 's1' });
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
    });
});
describe('VMDetailEventManager', () => {
    beforeEach(() => { jest.clearAllMocks(); });
    describe('emitToVMOwner (private)', () => {
        it('fetches userId from machine when not provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitStatusChanged('vm1', 'running');
            expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({ where: { id: 'vm1' }, select: { userId: true } });
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'status:changed', expect.objectContaining({ data: { machineId: 'vm1', status: 'running' } }));
        }));
        it('skips when machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield s.emitStatusChanged('vm1', 'running');
            expect(mockSocketService.sendToUser).not.toHaveBeenCalled();
        }));
        it('uses provided userId instead of fetching', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            yield s.emitStatusChanged('vm1', 'running', undefined, 'direct-user');
            expect(mockPrisma.machine.findUnique).not.toHaveBeenCalled();
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('direct-user', 'vm', 'status:changed', expect.any(Object));
        }));
        it('handles emitToVMOwner error gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockRejectedValue(new Error('DB error'));
            yield expect(s.emitStatusChanged('vm1', 'running')).resolves.toBeUndefined();
        }));
    });
    describe('Process Events', () => {
        it('emitProcessKilled', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitProcessKilled('vm1', 1234, 'node');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'process:killed', expect.objectContaining({ data: { machineId: 'vm1', pid: 1234, processName: 'node' } }));
        }));
        it('emitProcessKilled without processName', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitProcessKilled('vm1', 1234);
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'process:killed', expect.objectContaining({ data: { machineId: 'vm1', pid: 1234, processName: undefined } }));
        }));
        it('emitProcessesKilled', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitProcessesKilled('vm1', [{ pid: 1, processName: 'a' }, { pid: 2 }], 'u1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'processes:killed', expect.objectContaining({ data: { machineId: 'vm1', processes: [{ pid: 1, processName: 'a' }, { pid: 2 }] } }));
        }));
    });
    describe('Service Events', () => {
        it('emitServiceStatusChanged', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitServiceStatusChanged('vm1', 'nginx', 'start', 'running', 'u1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'service:start', expect.objectContaining({ data: { machineId: 'vm1', serviceName: 'nginx', action: 'start', newStatus: 'running' } }));
        }));
        it('emitServiceStatusChanged with lowercase action', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitServiceStatusChanged('vm1', 'mysql', 'STOP', 'stopped', 'u1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'service:stop', expect.objectContaining({ data: { machineId: 'vm1', serviceName: 'mysql', action: 'STOP', newStatus: 'stopped' } }));
        }));
    });
    describe('Package Events', () => {
        it('emitPackageInstalling', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitPackageInstalling('vm1', 'vim');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:installing', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim' } }));
        }));
        it('emitPackageInstalled', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitPackageInstalled('vm1', 'vim');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:installed', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim', success: true } }));
        }));
        it('emitPackageRemoving', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitPackageRemoving('vm1', 'vim');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:removing', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim' } }));
        }));
        it('emitPackageRemoved', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitPackageRemoved('vm1', 'vim');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:removed', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim', success: true } }));
        }));
        it('emitPackageUpdating', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitPackageUpdating('vm1', 'vim');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:updating', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim' } }));
        }));
        it('emitPackageUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitPackageUpdated('vm1', 'vim');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:updated', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim', success: true } }));
        }));
    });
    describe('Firewall Events', () => {
        it('emitFirewallTemplateApplied', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitFirewallTemplateApplied('vm1', 'default', { port: 80 });
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:template:applied', expect.objectContaining({ data: { machineId: 'vm1', template: 'default', state: { port: 80 } } }));
        }));
        it('emitFirewallTemplateRemoved', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitFirewallTemplateRemoved('vm1', 'default', { port: 80 });
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:template:removed', expect.objectContaining({ data: { machineId: 'vm1', template: 'default', state: { port: 80 } } }));
        }));
        it('emitFirewallRuleCreated', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitFirewallRuleCreated('vm1', { port: 443 }, { active: true });
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:rule:created', expect.objectContaining({ data: { machineId: 'vm1', rule: { port: 443 }, state: { active: true } } }));
        }));
        it('emitFirewallRuleRemoved', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitFirewallRuleRemoved('vm1', 'rule-123', { active: false });
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:rule:removed', expect.objectContaining({ data: { machineId: 'vm1', ruleId: 'rule-123', state: { active: false } } }));
        }));
    });
    describe('Snapshot Events', () => {
        it('emitSnapshotCreated', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitSnapshotCreated('vm1', { name: 'snap1', size: 1024 });
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'snapshot:created', expect.objectContaining({ data: { machineId: 'vm1', snapshot: { name: 'snap1', size: 1024 } } }));
        }));
        it('emitSnapshotRestored', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitSnapshotRestored('vm1', 'snap1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'snapshot:restored', expect.objectContaining({ data: { machineId: 'vm1', snapshotName: 'snap1' } }));
        }));
        it('emitSnapshotDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitSnapshotDeleted('vm1', 'snap1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'snapshot:deleted', expect.objectContaining({ data: { machineId: 'vm1', snapshotName: 'snap1' } }));
        }));
    });
    describe('VM Operation Events', () => {
        it('emitVMRestarting', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitVMRestarting('vm1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'restarting', expect.objectContaining({ data: { machineId: 'vm1' } }));
        }));
        it('emitVMRestarted with default status', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitVMRestarted('vm1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'restarted', expect.objectContaining({ data: { machineId: 'vm1', status: 'running' } }));
        }));
        it('emitVMRestarted with custom status', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitVMRestarted('vm1', 'stopped');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'restarted', expect.objectContaining({ data: { machineId: 'vm1', status: 'stopped' } }));
        }));
        it('emitVMForcedPowerOff', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitVMForcedPowerOff('vm1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'forced:poweroff', expect.objectContaining({ data: { machineId: 'vm1', status: 'shutoff' } }));
        }));
        it('emitVMReset', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitVMReset('vm1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'reset', expect.objectContaining({ data: { machineId: 'vm1', status: 'running' } }));
        }));
    });
    describe('Metrics Events', () => {
        it('emitMetricsUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitMetricsUpdated('vm1', { cpu: 50, memory: 70, disk: 30 });
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'metrics:updated', expect.objectContaining({ data: { machineId: 'vm1', metrics: { cpu: 50, memory: 70, disk: 30 } } }));
        }));
    });
    describe('Status Events', () => {
        it('emitStatusChanged', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitStatusChanged('vm1', 'running');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'status:changed', expect.objectContaining({ data: { machineId: 'vm1', status: 'running', previousStatus: undefined } }));
        }));
        it('emitStatusChanged with previousStatus', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitStatusChanged('vm1', 'running', 'stopped');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'status:changed', expect.objectContaining({ data: { machineId: 'vm1', status: 'running', previousStatus: 'stopped' } }));
        }));
    });
    describe('Alert Events', () => {
        it('emitCriticalAlert', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitCriticalAlert('vm1', 'Disk full');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:critical', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'Disk full' }) }));
        }));
        it('emitCriticalAlert with timestamp', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            const ts = new Date('2024-01-01');
            yield s.emitCriticalAlert('vm1', 'Disk full', ts);
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:critical', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'Disk full', timestamp: ts }) }));
        }));
        it('emitWarningAlert', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitWarningAlert('vm1', 'High memory usage');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:warning', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'High memory usage' }) }));
        }));
        it('emitInfoAlert', () => __awaiter(void 0, void 0, void 0, function* () {
            const s = (0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma);
            mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'u1' });
            yield s.emitInfoAlert('vm1', 'Backup completed');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:info', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'Backup completed' }) }));
        }));
    });
    describe('singleton', () => {
        it('returns same instance', () => {
            expect((0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma)).toBe((0, VMDetailEventManager_1.createVMDetailEventManager)(mockPrisma));
        });
        it('getVMDetailEventManager throws when not initialized', () => {
            jest.resetModules();
            const mod = require('../../../app/services/VMDetailEventManager');
            expect(() => mod.getVMDetailEventManager()).toThrow('VMDetailEventManager not initialized');
        });
    });
});
describe('ISOEventManager', () => {
    let service;
    beforeEach(() => { jest.clearAllMocks(); mockSocketService.getIO.mockReturnValue({ emit: jest.fn() }); service = ISOEventManager_1.ISOEventManager.getInstance(); });
    describe('emit events', () => {
        it('emitISORegistered', () => {
            service.emitISORegistered({ id: '1', filename: 't.iso', os: 'linux', isAvailable: true });
            expect(mockSocketService.getIO).toHaveBeenCalled();
        });
        it('emitISORemoved', () => {
            service.emitISORemoved('1', 't.iso');
            expect(mockSocketService.getIO).toHaveBeenCalled();
        });
        it('emitUploadProgress', () => {
            service.emitUploadProgress('t.iso', 50, 100, 'u1');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'iso', 'upload:progress', expect.any(Object));
        });
        it('emitBatchStatusUpdate', () => {
            service.emitBatchStatusUpdate([{ id: '1', os: 'linux', filename: 't.iso', isAvailable: true }]);
            expect(mockSocketService.getIO).toHaveBeenCalled();
        });
        it('emitISOValidated', () => {
            service.emitISOValidated({ id: '1', filename: 't.iso', os: 'linux', isAvailable: true }, true);
            expect(mockSocketService.getIO).toHaveBeenCalled();
        });
        it('emitStatusChanged', () => {
            service.emitStatusChanged({ id: '1', filename: 't.iso', os: 'linux', isAvailable: true });
            expect(mockSocketService.getIO).toHaveBeenCalled();
        });
    });
    describe('singleton', () => {
        it('returns same instance', () => {
            expect(ISOEventManager_1.ISOEventManager.getInstance()).toBe(ISOEventManager_1.ISOEventManager.getInstance());
        });
    });
});
