/**
 * System role presets. These reproduce the previous role↔resource behaviour as
 * verb bundles so the migration changes nothing for existing users:
 *   - SUPER_ADMIN: everything (`*`)
 *   - ADMIN:       manage every resource @ANY, minus governance (roles/perms),
 *                  which stays SUPER_ADMIN-only (read-only role/audit view kept)
 *   - USER:        own-scoped end-user bundle (the 33 former @Authorized('USER') ops)
 *
 * Custom roles are created at runtime; these three are seeded + kept in sync.
 */
import { PrismaClient } from '@prisma/client'
import { Scope, RESOURCE_KEYS } from './registry'

export interface RolePreset {
  key: string
  name: string
  description: string
  priority: number
  grants: Array<{ permission: string, scope: Scope }>
}

const ADMIN_GOVERNANCE_EXCLUDE = new Set(['role', 'permission', 'audit'])

const ADMIN_GRANTS: Array<{ permission: string, scope: Scope }> = [
  ...RESOURCE_KEYS.filter((k) => !ADMIN_GOVERNANCE_EXCLUDE.has(k)).map((k) => ({ permission: `${k}:manage`, scope: 'ANY' as Scope })),
  // governance is read-only for ADMIN; mutating roles/overrides is SUPER_ADMIN-only
  { permission: 'role:view', scope: 'ANY' },
  { permission: 'audit:view', scope: 'ANY' }
]

const USER_GRANTS: Array<{ permission: string, scope: Scope }> = [
  // own VM operation
  { permission: 'vm:view', scope: 'OWN' },
  { permission: 'vm:power', scope: 'OWN' },
  { permission: 'vm:console', scope: 'OWN' },
  { permission: 'vm:delete', scope: 'OWN' },
  { permission: 'vmHealth:view', scope: 'OWN' },
  { permission: 'vmHealth:execute', scope: 'OWN' },
  { permission: 'vmPackage:manage', scope: 'OWN' },
  { permission: 'vmProcess:view', scope: 'OWN' },
  { permission: 'vmProcess:kill', scope: 'OWN' },
  { permission: 'recommendation:view', scope: 'OWN' },
  // scripts: see the catalog, run/schedule on own VMs, manage own executions
  { permission: 'script:view', scope: 'ANY' },
  { permission: 'script:execute', scope: 'OWN' },
  { permission: 'script:schedule', scope: 'OWN' },
  { permission: 'script:manageExecutions', scope: 'OWN' },
  // self-service profile
  { permission: 'user:view', scope: 'OWN' },
  { permission: 'user:edit', scope: 'OWN' },
  // read-only context the workspace needs
  { permission: 'department:view', scope: 'ANY' },
  { permission: 'network:view', scope: 'ANY' },
  { permission: 'application:view', scope: 'ANY' },
  { permission: 'appSettings:view', scope: 'ANY' },
  { permission: 'firewallRule:view', scope: 'DEPARTMENT' },
  { permission: 'system:view', scope: 'ANY' }
]

export const ROLE_PRESETS: RolePreset[] = [
  { key: 'SUPER_ADMIN', name: 'Super admin', description: 'Full, unrestricted control of the instance.', priority: 100, grants: [{ permission: '*', scope: 'ANY' }] },
  { key: 'ADMIN', name: 'Admin', description: 'Operator console: manage all resources except role/permission governance.', priority: 50, grants: ADMIN_GRANTS },
  { key: 'USER', name: 'User', description: 'End user: operate own desktops and run scripts.', priority: 10, grants: USER_GRANTS }
]

export const SYSTEM_ROLE_KEYS = ROLE_PRESETS.map((p) => p.key)

const LOCKED_OWNER_KEY = 'SUPER_ADMIN'

/**
 * Seed/refresh the system roles and backfill users' roleId.
 *
 * Presets are **create-only** for grants: a preset's default grants are seeded
 * the first time its role is created, but subsequent runs do NOT touch them, so
 * admin edits to ADMIN/USER survive re-seeds and re-deploys. The only exception
 * is the locked owner role (SUPER_ADMIN), whose `*` grant is always re-asserted
 * (it can't be edited via the API anyway) so the break-glass role is never left
 * broken. Use `resetRoleToPreset` for an explicit "reset to default".
 */
export async function applyRolePresets (prisma: PrismaClient): Promise<void> {
  for (const preset of ROLE_PRESETS) {
    const existing = await prisma.role.findUnique({ where: { key: preset.key }, select: { id: true } })

    if (existing && preset.key !== LOCKED_OWNER_KEY) {
      // Preserve admin edits; only ensure it stays flagged as a system role.
      await prisma.role.update({ where: { id: existing.id }, data: { isSystem: true } })
      continue
    }

    const role = existing
      ? await prisma.role.update({
        where: { id: existing.id },
        data: { name: preset.name, description: preset.description, isSystem: true, priority: preset.priority }
      })
      : await prisma.role.create({
        data: { key: preset.key, name: preset.name, description: preset.description, isSystem: true, priority: preset.priority }
      })

    // Seed grants on first creation, or re-assert the locked owner's grants.
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
    if (preset.grants.length) {
      await prisma.rolePermission.createMany({
        data: preset.grants.map((g) => ({ roleId: role.id, permission: g.permission, scope: g.scope }))
      })
    }
  }

  // Backfill: any user without an explicit roleId inherits the system role that
  // matches their legacy `role` enum.
  const roles = await prisma.role.findMany({ where: { key: { in: SYSTEM_ROLE_KEYS } }, select: { id: true, key: true } })
  for (const r of roles) {
    await prisma.user.updateMany({ where: { role: r.key as any, roleId: null }, data: { roleId: r.id } })
  }
}

/**
 * Re-apply a system preset's default grants to its role ("reset to default").
 * Returns false if the key is not a system preset or the role doesn't exist.
 */
export async function resetRoleToPreset (prisma: PrismaClient, key: string): Promise<boolean> {
  const preset = ROLE_PRESETS.find((p) => p.key === key)
  if (!preset) return false
  const role = await prisma.role.findUnique({ where: { key }, select: { id: true } })
  if (!role) return false
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } })
  if (preset.grants.length) {
    await prisma.rolePermission.createMany({
      data: preset.grants.map((g) => ({ roleId: role.id, permission: g.permission, scope: g.scope }))
    })
  }
  return true
}

/** The default grants for a system preset key (for previews / reset confirmation). */
export function presetGrants (key: string): Array<{ permission: string, scope: Scope }> {
  return ROLE_PRESETS.find((p) => p.key === key)?.grants ?? []
}
