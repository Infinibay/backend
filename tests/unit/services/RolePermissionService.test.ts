import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { PermissionEffect, PrismaClient, UserRole } from '@prisma/client'

import { RolePermissionService } from '../../../app/services/policy/RolePermissionService'

describe('RolePermissionService', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: RolePermissionService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new RolePermissionService(prisma)
  })

  it('allows admin desktop access by default', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(null)

    await expect(service.canAccess(UserRole.ADMIN, 'desktops')).resolves.toBe(true)
  })

  it('denies user desktop access by default', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(null)

    await expect(service.canAccess(UserRole.USER, 'desktops')).resolves.toBe(false)
  })

  it('exposes enterprise operation resources in the matrix', async () => {
    prisma.rolePermission.findMany.mockResolvedValue([])

    const matrix = await service.matrix()

    expect(matrix.resources.map((resource) => resource.id)).toEqual(
      expect.arrayContaining(['departments', 'firewall', 'scripts'])
    )
    expect(matrix.permissions['ADMIN:departments']).toBe('allow')
    expect(matrix.permissions['USER:firewall']).toBe('deny')
    expect(matrix.permissions['USER:scripts']).toBe('deny')
  })

  it('returns allowed resources for the current role', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue(null)

    await expect(service.allowedResources(UserRole.USER)).resolves.toEqual(['workspace'])
  })

  it('uses persisted overrides before defaults', async () => {
    prisma.rolePermission.findUnique.mockResolvedValue({
      id: 'rp-1',
      role: UserRole.ADMIN,
      resource: 'desktops',
      effect: PermissionEffect.DENY,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    await expect(service.canAccess(UserRole.ADMIN, 'desktops')).resolves.toBe(false)
  })

  it('deletes the override when setting inherit', async () => {
    prisma.rolePermission.deleteMany.mockResolvedValue({ count: 1 })
    prisma.rolePermission.findMany.mockResolvedValue([])

    const matrix = await service.setPermission(UserRole.ADMIN, 'desktops', PermissionEffect.INHERIT)

    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({
      where: { role: UserRole.ADMIN, resource: 'desktops' }
    })
    expect(matrix.permissions['ADMIN:desktops']).toBe('allow')
  })

  it('does not allow denying super admin permissions', async () => {
    await expect(
      service.setPermission(UserRole.SUPER_ADMIN, 'users', PermissionEffect.DENY)
    ).rejects.toThrow('SUPER_ADMIN permissions cannot be denied')
  })
})
