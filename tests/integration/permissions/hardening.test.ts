/**
 * Hardening tests for the RBAC fixes:
 *  - minScope floor on the possession-only path (fleet-wide ops, #3)
 *  - anti-escalation guard: you cannot grant more than you hold (#2)
 *  - grants follow roleId, so a role change actually changes permissions (#1)
 *  - editable presets survive a re-seed; SUPER_ADMIN `*` is always re-asserted
 *  - the firewallRule instance loader resolves scope (#4)
 */
import { graphql } from 'graphql'
import { testPrisma } from '../../setup/jest.setup'
import { PermissionService, applyRolePresets, LOADERS } from '@main/permissions'
import {
  seedSystemRoles,
  createRoleWithGrants,
  createUserWithRoleId,
  createSuperAdminUser
} from '../../setup/permission-factories'
import { createDepartment } from '../../setup/db-factories'
import { getTestSchema, permissionContext } from '../../setup/permission-harness'

describe('RBAC hardening', () => {
  const prisma = testPrisma.prisma
  const svc = new PermissionService(prisma)

  beforeEach(async () => {
    await seedSystemRoles(prisma)
  }, 60000)

  describe('minScope (fleet-wide ops, #3)', () => {
    it('a scoped verb at OWN satisfies possession but NOT minScope:ANY', async () => {
      const role = await createRoleWithGrants(prisma, [{ permission: 'vmHealth:execute', scope: 'OWN' }], 'own-health')
      const u = await createUserWithRoleId(prisma, role.id)
      // possession-only (a per-VM op, instance checked elsewhere) → allowed
      expect(await svc.can(u.id, 'vmHealth:execute')).toBe(true)
      // fleet-wide op with a scope floor → an OWN grant is not enough
      expect(await svc.can(u.id, 'vmHealth:execute', null, undefined, 'ANY')).toBe(false)
    })

    it('the same verb at ANY satisfies minScope:ANY', async () => {
      const role = await createRoleWithGrants(prisma, [{ permission: 'vmHealth:execute', scope: 'ANY' }], 'any-health')
      const u = await createUserWithRoleId(prisma, role.id)
      expect(await svc.can(u.id, 'vmHealth:execute', null, undefined, 'ANY')).toBe(true)
    })
  })

  describe('anti-escalation guard (#2)', () => {
    it('a delegate cannot widen scope or grant verbs/roots it lacks', async () => {
      const role = await createRoleWithGrants(prisma, [{ permission: 'vm:edit', scope: 'DEPARTMENT' }], 'dept-editor')
      const u = await createUserWithRoleId(prisma, role.id)
      const grants = await svc.effectiveGrants(u.id)

      expect(svc.coversGrant(grants, 'vm:edit', 'OWN')).toBe(true) // narrower → ok
      expect(svc.coversGrant(grants, 'vm:edit', 'DEPARTMENT')).toBe(true) // equal → ok
      expect(svc.coversGrant(grants, 'vm:edit', 'ANY')).toBe(false) // broader → blocked
      expect(svc.coversGrant(grants, 'vm:delete', 'OWN')).toBe(false) // not held
      expect(svc.coversGrant(grants, '*', 'ANY')).toBe(false) // cannot mint root

      await expect(svc.assertCanGrant(u.id, 'vm:edit', 'ANY')).rejects.toThrow(/exceeds your own permissions/)
    })

    it('SUPER_ADMIN covers every grant', async () => {
      const su = await createSuperAdminUser(prisma)
      const grants = await svc.effectiveGrants(su.id)
      expect(svc.coversGrant(grants, '*', 'ANY')).toBe(true)
      expect(svc.coversGrant(grants, 'appSettings:edit', 'ANY')).toBe(true)
      await expect(svc.assertCanGrant(su.id, '*', 'ANY')).resolves.toBeUndefined()
    })

    it('end-to-end: a role:create delegate cannot mint a `*` role (through the schema)', async () => {
      const schema = await getTestSchema()
      const delegRole = await createRoleWithGrants(prisma, [
        { permission: 'role:create', scope: 'ANY' },
        { permission: 'role:view', scope: 'ANY' }
      ], 'role-admin')
      const deleg = await createUserWithRoleId(prisma, delegRole.id)

      const document = 'mutation ($input: CreateRoleInput!) { createRole(input: $input) { id key } }'
      const variables = { input: { name: 'pwn', permissions: [{ permission: '*', scope: 'ANY' }] } }
      const res = await graphql({ schema, source: document, variableValues: variables, contextValue: permissionContext(prisma, deleg) })

      expect(res.data?.createRole == null).toBe(true)
      expect((res.errors?.length ?? 0) > 0).toBe(true)
      expect(res.errors!.some((e) => /exceeds your own permissions/i.test(e.message))).toBe(true)
      // and nothing was persisted
      expect(await prisma.role.findUnique({ where: { key: 'pwn' } })).toBeNull()
    })
  })

  describe('grants follow roleId (#1)', () => {
    it('changing a user\'s role changes their effective permissions', async () => {
      const userRole = await prisma.role.findUnique({ where: { key: 'USER' } })
      const u = await createUserWithRoleId(prisma, userRole!.id, { role: 'USER' })
      expect(await svc.can(u.id, 'firewallRule:create')).toBe(false)

      const ops = await createRoleWithGrants(prisma, [{ permission: 'firewallRule:create', scope: 'ANY' }], 'ops')
      await prisma.user.update({ where: { id: u.id }, data: { roleId: ops.id } })
      expect(await svc.can(u.id, 'firewallRule:create')).toBe(true)
    })
  })

  describe('editable presets survive re-seed', () => {
    it('admin edits to ADMIN persist; SUPER_ADMIN `*` is always re-asserted', async () => {
      const admin = await prisma.role.findUnique({ where: { key: 'ADMIN' } })
      // Simulate an admin trimming the ADMIN preset down to a single grant.
      await prisma.rolePermission.deleteMany({ where: { roleId: admin!.id } })
      await prisma.rolePermission.create({ data: { roleId: admin!.id, permission: 'vm:view', scope: 'ANY' } })

      await applyRolePresets(prisma) // a re-seed must NOT clobber the edit

      const after = await prisma.rolePermission.findMany({ where: { roleId: admin!.id } })
      expect(after).toHaveLength(1)
      expect(after[0].permission).toBe('vm:view')

      const sa = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' }, include: { permissions: true } })
      expect(sa!.permissions.some((p) => p.permission === '*')).toBe(true)
    })
  })

  describe('firewallRule instance loader (#4)', () => {
    it('resolves a DEPARTMENT rule set to its department', async () => {
      const dept = await createDepartment(prisma)
      const rs = await prisma.firewallRuleSet.create({
        data: { name: 'dept-rs', internalName: `irs-${Date.now()}`, entityType: 'DEPARTMENT', entityId: dept.id }
      })
      const rule = await prisma.firewallRule.create({ data: { ruleSetId: rs.id, name: 'allow-ssh' } })

      const inst = await LOADERS.firewallRule(prisma, rule.id)
      expect(inst).toEqual({ ownerId: null, departmentId: dept.id })
    })
  })
})
