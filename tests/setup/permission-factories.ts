/**
 * Factories for permission/authorization tests. Build on db-factories to create
 * users with controlled effective grants:
 *   - a "no-perms" user (custom role with zero grants → every @Can denies)
 *   - a SUPER_ADMIN (seeded system role → passes every @Can)
 *   - arbitrary custom roles + per-user overrides
 */
import { PrismaClient, User, PermissionScope, GrantEffect } from '@prisma/client'
import { randomUUID } from 'crypto'
import { applyRolePresets } from '@main/permissions'
import { createUser } from './db-factories'

/** Seed the SUPER_ADMIN/ADMIN/USER system roles + grants into the test DB. */
export async function seedSystemRoles (prisma: PrismaClient): Promise<void> {
  await applyRolePresets(prisma)
}

export async function createRoleWithGrants (
  prisma: PrismaClient,
  grants: Array<{ permission: string, scope?: PermissionScope }> = [],
  name = 'custom'
) {
  const key = `${name}-${randomUUID().slice(0, 8)}`
  return prisma.role.create({
    data: {
      key,
      name,
      isSystem: false,
      permissions: { create: grants.map((g) => ({ permission: g.permission, scope: g.scope ?? PermissionScope.ANY })) }
    }
  })
}

export async function createUserWithRoleId (prisma: PrismaClient, roleId: string, overrides: Partial<User> = {}): Promise<User> {
  const u = await createUser(prisma, overrides)
  return prisma.user.update({ where: { id: u.id }, data: { roleId } })
}

/** A user whose role grants nothing — used as the universal "denied" principal. */
export async function createNoPermsUser (prisma: PrismaClient): Promise<User> {
  const role = await createRoleWithGrants(prisma, [], 'noperms')
  return createUserWithRoleId(prisma, role.id, { email: `noperms-${randomUUID().slice(0, 8)}@test.infinibay` })
}

/** A SUPER_ADMIN backed by the seeded system role — passes every gate. */
export async function createSuperAdminUser (prisma: PrismaClient): Promise<User> {
  await applyRolePresets(prisma)
  const role = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } })
  return createUserWithRoleId(prisma, role!.id, { role: 'SUPER_ADMIN', email: `super-${randomUUID().slice(0, 8)}@test.infinibay` })
}

export async function setUserOverride (
  prisma: PrismaClient,
  userId: string,
  permission: string,
  scope: PermissionScope = PermissionScope.ANY,
  effect: GrantEffect = GrantEffect.ALLOW
) {
  return prisma.userPermissionOverride.upsert({
    where: { userId_permission: { userId, permission } },
    create: { userId, permission, scope, effect },
    update: { scope, effect }
  })
}
