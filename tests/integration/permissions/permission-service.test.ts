/**
 * Core semantics of the action/verb RBAC: role bundles, the verb hierarchy
 * (manage / *), the scope axis (OWN/DEPARTMENT/ANY), and per-user overrides
 * (DENY wins). Exercises PermissionService directly against the test DB.
 */
import { User } from '@prisma/client'
import { testPrisma } from '../../setup/jest.setup'
import { PermissionService } from '@main/permissions'
import { createUser } from '../../setup/db-factories'
import {
  seedSystemRoles,
  createRoleWithGrants,
  createUserWithRoleId,
  createSuperAdminUser,
  setUserOverride
} from '../../setup/permission-factories'

describe('PermissionService — verb hierarchy, scope, overrides', () => {
  const prisma = testPrisma.prisma
  const svc = new PermissionService(prisma)
  let userRole: { id: string }
  let alice: User // system USER role
  let bob: User // another USER

  // The test DB is truncated between tests, so (re)build fixtures per test.
  beforeEach(async () => {
    await seedSystemRoles(prisma)
    const ur = await prisma.role.findUnique({ where: { key: 'USER' } })
    userRole = ur!
    alice = await createUserWithRoleId(prisma, userRole.id, { role: 'USER', email: `alice-${Date.now()}@t.io` })
    bob = await createUserWithRoleId(prisma, userRole.id, { role: 'USER', email: `bob-${Date.now()}@t.io` })
  }, 60000)

  it('USER role: own-scoped vm:view, no vm:edit', async () => {
    // alice can view her own VM, not bob's; cannot edit at all (no grant)
    expect(await svc.can(alice.id, 'vm:view', { ownerId: alice.id, departmentId: null })).toBe(true)
    expect(await svc.can(alice.id, 'vm:view', { ownerId: bob.id, departmentId: null })).toBe(false)
    expect(await svc.can(alice.id, 'vm:edit', { ownerId: alice.id, departmentId: null })).toBe(false)
  })

  it('SUPER_ADMIN: everything via the `*` grant', async () => {
    const su = await createSuperAdminUser(prisma)
    expect(await svc.can(su.id, 'vm:edit', { ownerId: bob.id, departmentId: null })).toBe(true)
    expect(await svc.can(su.id, 'role:create')).toBe(true)
    expect(await svc.can(su.id, 'appSettings:edit')).toBe(true)
  })

  it('verb hierarchy: a vm:manage@ANY grant expands to every vm verb at ANY scope', async () => {
    const role = await createRoleWithGrants(prisma, [{ permission: 'vm:manage', scope: 'ANY' }], 'ops')
    const carol = await createUserWithRoleId(prisma, role.id, { role: 'USER', email: `carol-${Date.now()}@t.io` })
    // any instance (not owned) is editable because scope is ANY
    expect(await svc.can(carol.id, 'vm:edit', { ownerId: bob.id, departmentId: null })).toBe(true)
    expect(await svc.can(carol.id, 'vm:delete', { ownerId: bob.id, departmentId: null })).toBe(true)
    // but a verb outside the vm resource is not granted
    expect(await svc.can(carol.id, 'script:create')).toBe(false)
  })

  it('per-user override DENY removes a verb even if the role grants it', async () => {
    const dave = await createUserWithRoleId(prisma, userRole.id, { role: 'USER', email: `dave-${Date.now()}@t.io` })
    expect(await svc.can(dave.id, 'vm:view', { ownerId: dave.id, departmentId: null })).toBe(true)
    await setUserOverride(prisma, dave.id, 'vm:view', 'OWN', 'DENY')
    expect(await svc.can(dave.id, 'vm:view', { ownerId: dave.id, departmentId: null })).toBe(false)
  })

  it('per-user override ALLOW grants a verb the role lacks', async () => {
    const erin = await createUserWithRoleId(prisma, userRole.id, { role: 'USER', email: `erin-${Date.now()}@t.io` })
    expect(await svc.can(erin.id, 'firewallRule:create')).toBe(false)
    await setUserOverride(prisma, erin.id, 'firewallRule:create', 'ANY', 'ALLOW')
    expect(await svc.can(erin.id, 'firewallRule:create')).toBe(true)
  })

  it('deriveAllowedResources: USER → workspace (own VM), not desktops', async () => {
    const resources = await svc.deriveAllowedResources(alice.id)
    expect(resources).toContain('workspace')
    expect(resources).not.toContain('desktops')
    expect(resources).not.toContain('policies')
  })

  it('no-grants user is denied everything', async () => {
    const empty = await createRoleWithGrants(prisma, [], 'empty')
    const frank = await createUserWithRoleId(prisma, empty.id, { role: 'USER', email: `frank-${Date.now()}@t.io` })
    expect(await svc.can(frank.id, 'vm:view', { ownerId: frank.id, departmentId: null })).toBe(false)
    expect(await svc.can(frank.id, 'application:view')).toBe(false)
  })
})
