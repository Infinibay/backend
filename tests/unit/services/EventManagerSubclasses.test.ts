/**
 * Tests for EventManager subclasses (User, Department, Application, Scripts, VMDetail, ISO).
 * Uses mockDeep<PrismaClient> directly to avoid strict typing issues with global mockPrisma.
 */

import 'reflect-metadata'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'
import { SocketService } from '../../../app/services/SocketService'
import { UserEventManager } from '../../../app/services/UserEventManager'
import { DepartmentEventManager } from '../../../app/services/DepartmentEventManager'
import { ApplicationEventManager } from '../../../app/services/ApplicationEventManager'
import { ScriptsEventManager } from '../../../app/services/ScriptsEventManager'
import { VMDetailEventManager, createVMDetailEventManager } from '../../../app/services/VMDetailEventManager'
import { ISOEventManager } from '../../../app/services/EventManagers/ISOEventManager'

const mockSocketService = {
  sendToUser: jest.fn(),
  broadcastToResource: jest.fn(),
  broadcastToAll: jest.fn(),
  getStats: jest.fn().mockReturnValue({ connectedUsers: 0, userIds: [] }),
  getIO: jest.fn(),
} as unknown as SocketService

const mockPrisma = mockDeep<PrismaClient>()

jest.mock('../../../app/services/SocketService', () => ({
  getSocketService: jest.fn(() => mockSocketService),
}))

jest.mock('../../../app/logger', () => ({
  child: jest.fn(() => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  })),
}))

describe('UserEventManager', () => {
  let service: UserEventManager
  beforeEach(() => { jest.clearAllMocks(); service = new UserEventManager(mockSocketService, mockPrisma as any) })

  describe('fetchResourceData', () => {
    it('returns userData as-is if already complete', async () => {
      const d = { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U' }
      expect(await (service as any).fetchResourceData(d)).toEqual(d)
    })
    it('fetches user from DB by ID', async () => {
      const u = { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER', createdAt: new Date(), deleted: false, VM: [] }
      ;(mockPrisma.user.findUnique as any).mockResolvedValue(u)
      const r = await (service as any).fetchResourceData('u1')
      expect(r.id).toBe('u1')
    })
    it('returns null if not found', async () => {
      ;(mockPrisma.user.findUnique as any).mockResolvedValue(null)
      expect(await (service as any).fetchResourceData('x')).toBeNull()
    })
    it('returns null if no userId', async () => { expect(await (service as any).fetchResourceData({})).toBeNull() })
    it('returns null on DB error', async () => {
      ;(mockPrisma.user.findUnique as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).fetchResourceData('u1')).toBeNull()
    })
    it('includes VMs in fetched data', async () => {
      const u = { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER', createdAt: new Date(), deleted: false, VM: [{ id: 'vm1', name: 'VM1', status: 'running' }] }
      ;(mockPrisma.user.findUnique as any).mockResolvedValue(u)
      expect((await (service as any).fetchResourceData('u1')).VM).toEqual([{ id: 'vm1', name: 'VM1', status: 'running' }])
    })
  })

  describe('getTargetUsers', () => {
    it('includes the user themselves', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      const r = await (service as any).getTargetUsers({ id: 'user-1' }, 'update')
      expect(r).toContain('user-1')
      expect(r).toContain('admin-1')
    })
    it('includes all admin users', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }])
      expect((await (service as any).getTargetUsers({ id: 'u1' }, 'update'))).toContain('admin-2')
    })
    it('includes related users on update', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }])
      ;(mockPrisma.machine.findMany as any).mockResolvedValueOnce([{ departmentId: 'd1' }])
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'rel-1' }])
      const r = await (service as any).getTargetUsers({ id: 'u1' }, 'update')
      expect(r).toContain('rel-1')
    })
    it('returns user id even on error', async () => {
      ;(mockPrisma.user.findMany as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).getTargetUsers({ id: 'u1' }, 'create')).toEqual(['u1'])
    })
    it('handles user without id', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      const r = await (service as any).getTargetUsers({ name: 'no-id' }, 'update')
      expect(r).toContain('admin-1')
    })
  })

  describe('handleEvent', () => {
    it('handles user create event', async () => {
      ;(mockPrisma.user.findUnique as any).mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('create', { id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handles user delete event', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('delete', { id: 'u1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('skips if user not found', async () => {
      ;(mockPrisma.user.findUnique as any).mockResolvedValue(null)
      await service.handleEvent('update', { id: 'x' })
      expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
    })
  })

  describe('sanitizeUserData', () => {
    it('removes password and token', () => {
      const r = (service as any).sanitizeUserData({ id: 'u1', email: 't@t.com', password: 's', token: 't', firstName: 'T' })
      expect(r.password).toBeUndefined()
      expect(r.token).toBeUndefined()
      expect(r.email).toBe('t@t.com')
    })
    it('returns clean object when no secrets', () => {
      const r = (service as any).sanitizeUserData({ id: 'u1', email: 't@t.com' })
      expect(r.password).toBeUndefined()
      expect(r.token).toBeUndefined()
    })
  })

  describe('getRelatedUsers', () => {
    it('finds users in same departments', async () => {
      ;(mockPrisma.machine.findMany as any).mockResolvedValue([{ departmentId: 'd1' }])
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'rel-1' }])
      expect(await (service as any).getRelatedUsers('u1')).toContain('rel-1')
    })
    it('returns empty when no VMs', async () => {
      ;(mockPrisma.machine.findMany as any).mockResolvedValue([])
      expect(await (service as any).getRelatedUsers('u1')).toEqual([])
    })
    it('returns empty on error', async () => {
      ;(mockPrisma.machine.findMany as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).getRelatedUsers('u1')).toEqual([])
    })
  })

  describe('getTargetUsersForDeleted', () => {
    it('includes all admin users', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      expect(await (service as any).getTargetUsersForDeleted({ id: 'u1' })).toContain('admin-1')
    })
    it('includes related users', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }])
      ;(mockPrisma.machine.findMany as any).mockResolvedValueOnce([{ departmentId: 'd1' }])
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'rel-1' }])
      const r = await (service as any).getTargetUsersForDeleted({ id: 'u1' })
      expect(r).toContain('rel-1')
    })
    it('returns empty on error', async () => {
      ;(mockPrisma.user.findMany as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).getTargetUsersForDeleted({ id: 'u1' })).toEqual([])
    })
  })

  describe('convenience methods', () => {
    it('handleUserCreated', async () => {
      ;(mockPrisma.user.findUnique as any).mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleUserCreated({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleUserUpdated', async () => {
      ;(mockPrisma.user.findUnique as any).mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleUserUpdated({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleUserDeleted', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleUserDeleted({ id: 'u1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('passes triggeredBy', async () => {
      ;(mockPrisma.user.findUnique as any).mockResolvedValue({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleUserCreated({ id: 'u1', email: 't@t.com', firstName: 'T', lastName: 'U', role: 'USER' }, 'admin')
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
  })
})

describe('DepartmentEventManager', () => {
  let service: DepartmentEventManager
  beforeEach(() => { jest.clearAllMocks(); service = new DepartmentEventManager(mockSocketService, mockPrisma as any) })

  describe('fetchResourceData', () => {
    it('returns deptData as-is if complete', async () => {
      expect(await (service as any).fetchResourceData({ id: 'd1', name: 'T', totalMachines: 5 })).toEqual({ id: 'd1', name: 'T', totalMachines: 5 })
    })
    it('fetches from DB', async () => {
      const d = { id: 'd1', name: 'Test', createdAt: new Date(), internetSpeed: 100, ipSubnet: '10.0.0.0/24', firewallPolicy: 'strict', firewallDefaultConfig: {}, firewallCustomRules: [] }
      ;(mockPrisma.department.findUnique as any).mockResolvedValue({ ...d, _count: { machines: 5 } })
      const r = await (service as any).fetchResourceData('d1')
      expect(r.id).toBe('d1')
      expect(r.totalMachines).toBe(5)
      expect(r.internetSpeed).toBe(100)
    })
    it('returns null if not found', async () => {
      ;(mockPrisma.department.findUnique as any).mockResolvedValue(null)
      expect(await (service as any).fetchResourceData('x')).toBeNull()
    })
    it('returns null if no deptId', async () => { expect(await (service as any).fetchResourceData({})).toBeNull() })
    it('returns null on DB error', async () => {
      ;(mockPrisma.department.findUnique as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).fetchResourceData('d1')).toBeNull()
    })
    it('handles undefined optional fields', async () => {
      const d = { id: 'd1', name: 'Test', createdAt: new Date(), internetSpeed: null, ipSubnet: null, firewallPolicy: 'strict', firewallDefaultConfig: null, firewallCustomRules: null }
      ;(mockPrisma.department.findUnique as any).mockResolvedValue({ ...d, _count: { machines: 0 } })
      const r = await (service as any).fetchResourceData('d1')
      expect(r.internetSpeed).toBeUndefined()
      expect(r.ipSubnet).toBeUndefined()
    })
  })

  describe('getTargetUsers', () => {
    it('includes admin users', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      expect((await (service as any).getTargetUsers({ id: 'd1' }, 'update'))).toContain('admin-1')
    })
    it('includes department users', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'dept-1' }])
      expect((await (service as any).getTargetUsers({ id: 'd1' }, 'update'))).toContain('dept-1')
    })
    it('includes active users on create', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'dept-1' }]).mockResolvedValueOnce([{ id: 'a1' }, { id: 'a2' }])
      const r = await (service as any).getTargetUsers({ id: 'd1' }, 'create')
      expect(r).toContain('a1')
      expect(r).toContain('a2')
    })
    it('returns empty on error', async () => {
      ;(mockPrisma.user.findMany as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).getTargetUsers({ id: 'd1' }, 'create')).toEqual([])
    })
  })

  describe('handleEvent', () => {
    it('handles create', async () => {
      ;(mockPrisma.department.findUnique as any).mockResolvedValue({ id: 'd1', name: 'T', _count: { machines: 0 } })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('create', { id: 'd1', name: 'T', _count: { machines: 0 } })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handles delete', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('delete', { id: 'd1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('skips if not found', async () => {
      ;(mockPrisma.department.findUnique as any).mockResolvedValue(null)
      await service.handleEvent('update', { id: 'x' })
      expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
    })
  })

  describe('convenience methods', () => {
    it('handleDepartmentCreated', async () => {
      ;(mockPrisma.department.findUnique as any).mockResolvedValue({ id: 'd1', name: 'T', _count: { machines: 0 } })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleDepartmentCreated({ id: 'd1', name: 'T', _count: { machines: 0 } })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleDepartmentUpdated', async () => {
      ;(mockPrisma.department.findUnique as any).mockResolvedValue({ id: 'd1', name: 'T', _count: { machines: 0 } })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleDepartmentUpdated({ id: 'd1', name: 'T', _count: { machines: 0 } })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleDepartmentDeleted', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleDepartmentDeleted({ id: 'd1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
  })
})

describe('ApplicationEventManager', () => {
  let service: ApplicationEventManager
  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma.user.findMany.mockReset()
    mockPrisma.application.findUnique.mockReset()
    service = new ApplicationEventManager(mockSocketService, mockPrisma as any)
  })

  describe('getResourceName', () => {
    it('returns application', () => {
      expect((service as any).getResourceName()).toBe('applications')
    })
  })
  describe('fetchResourceData', () => {
    it('returns appData as-is if complete', async () => {
      expect(await (service as any).fetchResourceData({ id: 'a1', name: 'T', machines: [] })).toEqual({ id: 'a1', name: 'T', machines: [] })
    })
    it('fetches from DB by string ID', async () => {
      const app = { id: 'a1', name: 'Test', machines: [{ machine: { id: 'vm1', name: 'VM1', status: 'running', userId: 'u1', departmentId: 'd1' } }] }
      ;(mockPrisma.application.findUnique as any).mockResolvedValue(app)
      expect(await (service as any).fetchResourceData('a1')).toEqual(app)
    })
    it('fetches from DB by object ID', async () => {
      const app = { id: 'a2', name: 'Test2', machines: [] }
      ;(mockPrisma.application.findUnique as any).mockResolvedValue(app)
      expect(await (service as any).fetchResourceData({ id: 'a2' })).toEqual(app)
    })
    it('returns null if not found', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue(null)
      expect(await (service as any).fetchResourceData('x')).toBeNull()
    })
    it('returns null if no appId', async () => { expect(await (service as any).fetchResourceData({})).toBeNull() })
    it('returns null if appData is null', async () => { expect(await (service as any).fetchResourceData(null as any)).toBeNull() })
    it('returns null if appData is undefined', async () => { expect(await (service as any).fetchResourceData(undefined as any)).toBeNull() })
    it('returns null on DB error', async () => {
      ;(mockPrisma.application.findUnique as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).fetchResourceData('a1')).toBeNull()
    })
    it('includes machines with nested machine data', async () => {
      const app = { id: 'a1', name: 'Test', machines: [{ machine: { id: 'vm1', name: 'VM1', status: 'running', userId: 'u1', departmentId: 'd1' } }] }
      ;(mockPrisma.application.findUnique as any).mockResolvedValue(app)
      const r = await (service as any).fetchResourceData('a1')
      expect(r.machines[0].machine.userId).toBe('u1')
      expect(r.machines[0].machine.departmentId).toBe('d1')
    })
  })

  describe('getTargetUsers', () => {
    it('includes admin users', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      expect((await (service as any).getTargetUsers({ id: 'a1', machines: [] }, 'update'))).toContain('admin-1')
    })
    it('includes VM owners', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'dept-1' }])
      const r = await (service as any).getTargetUsers({ id: 'a1', machines: [{ machine: { userId: 'u1', departmentId: 'd1' } }, { machine: { userId: 'u2', departmentId: 'd2' } }] }, 'update')
      expect(r).toContain('u1')
      expect(r).toContain('u2')
    })
    it('includes department users via getUsersByDepartmentIds', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }])
        .mockResolvedValueOnce([{ id: 'dept-user-1' }, { id: 'dept-user-2' }])
      const r = await (service as any).getTargetUsers({ id: 'a1', machines: [{ machine: { userId: 'u1', departmentId: 'd1' } }] }, 'update')
      expect(r).toContain('dept-user-1')
      expect(r).toContain('dept-user-2')
      expect(r).toContain('admin-1')
      expect(r).toContain('u1')
    })
    it('includes active users on create', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([{ id: 'a1' }])
      expect((await (service as any).getTargetUsers({ id: 'a1', machines: [] }, 'create'))).toContain('a1')
    })
    it('handles machines with no userId/departmentId', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValueOnce([{ id: 'admin-1' }]).mockResolvedValueOnce([])
      const r = await (service as any).getTargetUsers({ id: 'a1', machines: [{ machine: { userId: null, departmentId: null } }] }, 'update')
      expect(r).toContain('admin-1')
    })
    it('handles empty machines array', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      const r = await (service as any).getTargetUsers({ id: 'a1', machines: [] }, 'update')
      expect(r).toContain('admin-1')
    })
    it('returns empty on error', async () => {
      ;(mockPrisma.user.findMany as any).mockRejectedValue(new Error('DB'))
      expect(await (service as any).getTargetUsers({ id: 'a1', machines: [] }, 'update')).toEqual([])
    })
  })

  describe('handleEvent', () => {
    it('handles create', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue({ id: 'a1', name: 'T', machines: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('create', { id: 'a1', name: 'T', machines: [] })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handles update', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue({ id: 'a1', name: 'T', machines: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('update', { id: 'a1', name: 'T', machines: [] })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handles delete', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('delete', { id: 'a1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('skips if not found', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue(null)
      await service.handleEvent('update', { id: 'x' })
      expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
    })
    it('passes triggeredBy to logger', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue({ id: 'a1', name: 'T', machines: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('create', { id: 'a1', name: 'T', machines: [] }, 'admin-user')
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handles delete with string ID', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('delete', 'a1' as any)
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handles delete with object ID', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('delete', { id: 'a1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
  })

  describe('convenience methods', () => {
    it('handleApplicationCreated', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue({ id: 'a1', name: 'T', machines: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleApplicationCreated({ id: 'a1', name: 'T', machines: [] })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleApplicationUpdated', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue({ id: 'a1', name: 'T', machines: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleApplicationUpdated({ id: 'a1', name: 'T', machines: [] })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleApplicationDeleted', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleApplicationDeleted({ id: 'a1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleApplicationCreated passes triggeredBy', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue({ id: 'a1', name: 'T', machines: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleApplicationCreated({ id: 'a1', name: 'T', machines: [] }, 'admin')
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleApplicationUpdated passes triggeredBy', async () => {
      ;(mockPrisma.application.findUnique as any).mockResolvedValue({ id: 'a1', name: 'T', machines: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleApplicationUpdated({ id: 'a1', name: 'T', machines: [] }, 'admin')
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handleApplicationDeleted passes triggeredBy', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleApplicationDeleted({ id: 'a1' }, 'admin')
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
  })
})

describe('ScriptsEventManager', () => {
  let service: ScriptsEventManager
  beforeEach(() => { jest.clearAllMocks(); service = new ScriptsEventManager(mockSocketService, mockPrisma as any) })

  describe('handleEvent', () => {
    it('handles create', async () => {
      ;(mockPrisma.script.findUnique as any).mockResolvedValue({ id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([])
      ;(mockPrisma.machine.findMany as any).mockResolvedValue([])
      await service.handleEvent('create', { id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('skips if not found', async () => {
      ;(mockPrisma.script.findUnique as any).mockResolvedValue(null)
      await service.handleEvent('create', { id: 'x' })
      expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
    })
    it('handles update', async () => {
      ;(mockPrisma.script.findUnique as any).mockResolvedValue({ id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] })
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('update', { id: 's1', name: 'T', createdById: 'u1', departmentAssignments: [] })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
    it('handles delete', async () => {
      ;(mockPrisma.user.findMany as any).mockResolvedValue([{ id: 'admin-1' }])
      await service.handleEvent('delete', { id: 's1' })
      expect(mockSocketService.sendToUser).toHaveBeenCalled()
    })
  })
})

describe('VMDetailEventManager', () => {
  beforeEach(() => { jest.clearAllMocks() })

  describe('emitToVMOwner (private)', () => {
    it('fetches userId from machine when not provided', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitStatusChanged('vm1', 'running')
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({ where: { id: 'vm1' }, select: { userId: true } })
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'status:changed', expect.objectContaining({ data: { machineId: 'vm1', status: 'running' } }))
    })

    it('skips when machine not found', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue(null)
      await s.emitStatusChanged('vm1', 'running')
      expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
    })

    it('uses provided userId instead of fetching', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      await s.emitStatusChanged('vm1', 'running', undefined, 'direct-user')
      expect(mockPrisma.machine.findUnique).not.toHaveBeenCalled()
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('direct-user', 'vm', 'status:changed', expect.any(Object))
    })

    it('handles emitToVMOwner error gracefully', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockRejectedValue(new Error('DB error'))
      await expect(s.emitStatusChanged('vm1', 'running')).resolves.toBeUndefined()
    })
  })

  describe('Process Events', () => {
    it('emitProcessKilled', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitProcessKilled('vm1', 1234, 'node')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'process:killed', expect.objectContaining({ data: { machineId: 'vm1', pid: 1234, processName: 'node' } }))
    })

    it('emitProcessKilled without processName', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitProcessKilled('vm1', 1234)
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'process:killed', expect.objectContaining({ data: { machineId: 'vm1', pid: 1234, processName: undefined } }))
    })

    it('emitProcessesKilled', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitProcessesKilled('vm1', [{ pid: 1, processName: 'a' }, { pid: 2 }], 'u1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'processes:killed', expect.objectContaining({ data: { machineId: 'vm1', processes: [{ pid: 1, processName: 'a' }, { pid: 2 }] } }))
    })
  })

  describe('Service Events', () => {
    it('emitServiceStatusChanged', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitServiceStatusChanged('vm1', 'nginx', 'start', 'running', 'u1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'service:start', expect.objectContaining({ data: { machineId: 'vm1', serviceName: 'nginx', action: 'start', newStatus: 'running' } }))
    })

    it('emitServiceStatusChanged with lowercase action', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitServiceStatusChanged('vm1', 'mysql', 'STOP', 'stopped', 'u1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'service:stop', expect.objectContaining({ data: { machineId: 'vm1', serviceName: 'mysql', action: 'STOP', newStatus: 'stopped' } }))
    })
  })

  describe('Package Events', () => {
    it('emitPackageInstalling', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitPackageInstalling('vm1', 'vim')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:installing', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim' } }))
    })

    it('emitPackageInstalled', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitPackageInstalled('vm1', 'vim')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:installed', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim', success: true } }))
    })

    it('emitPackageRemoving', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitPackageRemoving('vm1', 'vim')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:removing', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim' } }))
    })

    it('emitPackageRemoved', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitPackageRemoved('vm1', 'vim')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:removed', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim', success: true } }))
    })

    it('emitPackageUpdating', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitPackageUpdating('vm1', 'vim')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:updating', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim' } }))
    })

    it('emitPackageUpdated', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitPackageUpdated('vm1', 'vim')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'package:updated', expect.objectContaining({ data: { machineId: 'vm1', packageName: 'vim', success: true } }))
    })
  })

  describe('Firewall Events', () => {
    it('emitFirewallTemplateApplied', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitFirewallTemplateApplied('vm1', 'default', { port: 80 })
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:template:applied', expect.objectContaining({ data: { machineId: 'vm1', template: 'default', state: { port: 80 } } }))
    })

    it('emitFirewallTemplateRemoved', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitFirewallTemplateRemoved('vm1', 'default', { port: 80 })
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:template:removed', expect.objectContaining({ data: { machineId: 'vm1', template: 'default', state: { port: 80 } } }))
    })

    it('emitFirewallRuleCreated', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitFirewallRuleCreated('vm1', { port: 443 }, { active: true })
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:rule:created', expect.objectContaining({ data: { machineId: 'vm1', rule: { port: 443 }, state: { active: true } } }))
    })

    it('emitFirewallRuleRemoved', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitFirewallRuleRemoved('vm1', 'rule-123', { active: false })
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'firewall:rule:removed', expect.objectContaining({ data: { machineId: 'vm1', ruleId: 'rule-123', state: { active: false } } }))
    })
  })

  describe('Snapshot Events', () => {
    it('emitSnapshotCreated', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitSnapshotCreated('vm1', { name: 'snap1', size: 1024 })
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'snapshot:created', expect.objectContaining({ data: { machineId: 'vm1', snapshot: { name: 'snap1', size: 1024 } } }))
    })

    it('emitSnapshotRestored', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitSnapshotRestored('vm1', 'snap1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'snapshot:restored', expect.objectContaining({ data: { machineId: 'vm1', snapshotName: 'snap1' } }))
    })

    it('emitSnapshotDeleted', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitSnapshotDeleted('vm1', 'snap1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'snapshot:deleted', expect.objectContaining({ data: { machineId: 'vm1', snapshotName: 'snap1' } }))
    })
  })

  describe('VM Operation Events', () => {
    it('emitVMRestarting', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitVMRestarting('vm1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'restarting', expect.objectContaining({ data: { machineId: 'vm1' } }))
    })

    it('emitVMRestarted with default status', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitVMRestarted('vm1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'restarted', expect.objectContaining({ data: { machineId: 'vm1', status: 'running' } }))
    })

    it('emitVMRestarted with custom status', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitVMRestarted('vm1', 'stopped')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'restarted', expect.objectContaining({ data: { machineId: 'vm1', status: 'stopped' } }))
    })

    it('emitVMForcedPowerOff', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitVMForcedPowerOff('vm1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'forced:poweroff', expect.objectContaining({ data: { machineId: 'vm1', status: 'shutoff' } }))
    })

    it('emitVMReset', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitVMReset('vm1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'reset', expect.objectContaining({ data: { machineId: 'vm1', status: 'running' } }))
    })
  })

  describe('Metrics Events', () => {
    it('emitMetricsUpdated', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitMetricsUpdated('vm1', { cpu: 50, memory: 70, disk: 30 })
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'metrics:updated', expect.objectContaining({ data: { machineId: 'vm1', metrics: { cpu: 50, memory: 70, disk: 30 } } }))
    })
  })

  describe('Status Events', () => {
    it('emitStatusChanged', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitStatusChanged('vm1', 'running')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'status:changed', expect.objectContaining({ data: { machineId: 'vm1', status: 'running', previousStatus: undefined } }))
    })

    it('emitStatusChanged with previousStatus', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitStatusChanged('vm1', 'running', 'stopped')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'status:changed', expect.objectContaining({ data: { machineId: 'vm1', status: 'running', previousStatus: 'stopped' } }))
    })
  })

  describe('Alert Events', () => {
    it('emitCriticalAlert', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitCriticalAlert('vm1', 'Disk full')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:critical', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'Disk full' }) }))
    })

    it('emitCriticalAlert with timestamp', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      const ts = new Date('2024-01-01')
      await s.emitCriticalAlert('vm1', 'Disk full', ts)
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:critical', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'Disk full', timestamp: ts }) }))
    })

    it('emitWarningAlert', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitWarningAlert('vm1', 'High memory usage')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:warning', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'High memory usage' }) }))
    })

    it('emitInfoAlert', async () => {
      const s = createVMDetailEventManager(mockPrisma as any)
      ;(mockPrisma.machine.findUnique as any).mockResolvedValue({ userId: 'u1' })
      await s.emitInfoAlert('vm1', 'Backup completed')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'vm', 'alert:info', expect.objectContaining({ data: expect.objectContaining({ machineId: 'vm1', message: 'Backup completed' }) }))
    })
  })

  describe('singleton', () => {
    it('returns same instance', () => {
      expect(createVMDetailEventManager(mockPrisma as any)).toBe(createVMDetailEventManager(mockPrisma as any))
    })

    it('getVMDetailEventManager throws when not initialized', () => {
      jest.resetModules()
      const mod = require('../../../app/services/VMDetailEventManager')
      expect(() => (mod as any).getVMDetailEventManager()).toThrow('VMDetailEventManager not initialized')
    })
  })
})

describe('ISOEventManager', () => {
  let service: ISOEventManager
  beforeEach(() => { jest.clearAllMocks(); (mockSocketService.getIO as jest.Mock).mockReturnValue({ emit: jest.fn() }); service = ISOEventManager.getInstance() })

  describe('emit events', () => {
    it('emitISORegistered', () => {
      service.emitISORegistered({ id: '1', filename: 't.iso', os: 'linux', isAvailable: true } as any)
      expect(mockSocketService.getIO).toHaveBeenCalled()
    })
    it('emitISORemoved', () => {
      service.emitISORemoved('1', 't.iso')
      expect(mockSocketService.getIO).toHaveBeenCalled()
    })
    it('emitUploadProgress', () => {
      service.emitUploadProgress('t.iso', 50, 100, 'u1')
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith('u1', 'iso', 'upload:progress', expect.any(Object))
    })
    it('emitBatchStatusUpdate', () => {
      service.emitBatchStatusUpdate([{ id: '1', os: 'linux', filename: 't.iso', isAvailable: true }] as any)
      expect(mockSocketService.getIO).toHaveBeenCalled()
    })
    it('emitISOValidated', () => {
      service.emitISOValidated({ id: '1', filename: 't.iso', os: 'linux', isAvailable: true } as any, true)
      expect(mockSocketService.getIO).toHaveBeenCalled()
    })
    it('emitStatusChanged', () => {
      service.emitStatusChanged({ id: '1', filename: 't.iso', os: 'linux', isAvailable: true } as any)
      expect(mockSocketService.getIO).toHaveBeenCalled()
    })
  })

  describe('singleton', () => {
    it('returns same instance', () => {
      expect(ISOEventManager.getInstance()).toBe(ISOEventManager.getInstance())
    })
  })
})
