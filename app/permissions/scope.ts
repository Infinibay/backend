/**
 * Scope resolution for instance-bearing permissions.
 *
 * A grant carries a scope (OWN | DEPARTMENT | ANY). To decide whether a granted
 * scope covers a concrete instance we need the instance's owner + department.
 * `LOADERS` turn an id into `{ ownerId, departmentId }`; `scopeCovers` applies
 * the ANY ⊇ DEPARTMENT ⊇ OWN rule, reusing the (revived) department-membership
 * helper so a department MANAGER actually reaches its department's resources.
 */
import { PrismaClient } from '@prisma/client'
import { Scope } from './registry'
import { getUserAccessibleDepartments } from '@main/utils/authChecker'

export interface ScopeInstance {
  ownerId: string | null
  departmentId: string | null
}

export type InstanceLoader = (prisma: PrismaClient, id: string) => Promise<ScopeInstance | null>

/**
 * Loaders that resolve a resource instance id → its owner/department. Keyed by a
 * loader name (usually the resource key). Most VM-attached resources scope via
 * the owning VM, so pass `scopeVia: 'vm'` with the machineId for those.
 */
export const LOADERS: Record<string, InstanceLoader> = {
  vm: async (prisma, id) => {
    const m = await prisma.machine.findUnique({ where: { id }, select: { userId: true, departmentId: true } })
    return m ? { ownerId: m.userId, departmentId: m.departmentId } : null
  },

  department: async (_prisma, id) => ({ ownerId: null, departmentId: id }),

  pool: async (prisma, id) => {
    const p = await prisma.pool.findUnique({ where: { id }, select: { departmentId: true } })
    return p ? { ownerId: null, departmentId: p.departmentId } : null
  },

  script: async (prisma, id) => {
    const s = await prisma.script.findUnique({ where: { id }, select: { createdById: true } })
    return s ? { ownerId: s.createdById, departmentId: null } : null
  },

  user: async (_prisma, id) => ({ ownerId: id, departmentId: null }),

  maintenanceTask: async (prisma, id) => {
    const t = await prisma.maintenanceTask.findUnique({
      where: { id },
      select: { machine: { select: { userId: true, departmentId: true } } }
    })
    return t?.machine ? { ownerId: t.machine.userId, departmentId: t.machine.departmentId } : null
  },

  scriptExecution: async (prisma, id) => {
    const e = await prisma.scriptExecution.findUnique({
      where: { id },
      select: { machine: { select: { userId: true, departmentId: true } } }
    })
    return e?.machine ? { ownerId: e.machine.userId, departmentId: e.machine.departmentId } : null
  },

  backup: async (prisma, id) => {
    const b = await prisma.backup.findUnique({ where: { id }, select: { vmId: true } })
    if (!b) return null
    const m = await prisma.machine.findUnique({ where: { id: b.vmId }, select: { userId: true, departmentId: true } })
    return m ? { ownerId: m.userId, departmentId: m.departmentId } : { ownerId: null, departmentId: null }
  },

  backupSchedule: async (prisma, id) => {
    const s = await prisma.backupSchedule.findUnique({
      where: { id },
      select: { vm: { select: { userId: true, departmentId: true } } }
    })
    return s?.vm ? { ownerId: s.vm.userId, departmentId: s.vm.departmentId } : null
  },

  // A firewall rule scopes via its rule set's entity: a DEPARTMENT rule set is
  // department-scoped; a VM rule set scopes via the owning machine.
  firewallRule: async (prisma, id) => {
    const rule = await prisma.firewallRule.findUnique({
      where: { id },
      select: { ruleSet: { select: { entityType: true, entityId: true } } }
    })
    if (!rule?.ruleSet) return null
    if (rule.ruleSet.entityType === 'DEPARTMENT') {
      return { ownerId: null, departmentId: rule.ruleSet.entityId }
    }
    const m = await prisma.machine.findUnique({
      where: { id: rule.ruleSet.entityId },
      select: { userId: true, departmentId: true }
    })
    return m ? { ownerId: m.userId, departmentId: m.departmentId } : null
  }
}

/** Normalise an arbitrary entity (Machine, etc.) or partial into a ScopeInstance. */
export function toScopeInstance (obj: unknown): ScopeInstance {
  if (!obj || typeof obj !== 'object') return { ownerId: null, departmentId: null }
  const o = obj as Record<string, unknown>
  return {
    ownerId: (o.ownerId as string) ?? (o.userId as string) ?? null,
    departmentId: (o.departmentId as string) ?? null
  }
}

/**
 * Does a granted scope cover this instance for this user?
 *  - ANY        → always
 *  - DEPARTMENT → instance's department is in the user's accessible departments
 *  - OWN        → user owns the instance
 */
export async function scopeCovers (
  prisma: PrismaClient,
  userId: string,
  grantedScope: Scope,
  instance: ScopeInstance
): Promise<boolean> {
  if (grantedScope === 'ANY') return true
  if (grantedScope === 'OWN') {
    return instance.ownerId != null && instance.ownerId === userId
  }
  // DEPARTMENT
  if (!instance.departmentId) {
    // No department on the instance → fall back to ownership (e.g. a personal VM)
    return instance.ownerId != null && instance.ownerId === userId
  }
  const depts = await getUserAccessibleDepartments(prisma, userId)
  return depts.includes(instance.departmentId)
}
