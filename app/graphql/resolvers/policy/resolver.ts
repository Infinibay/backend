import { Arg, Ctx, Mutation, Query, Resolver } from 'type-graphql'
import { UserRole } from '@prisma/client'
import {
  Can,
  PermissionService,
  RESOURCES,
  GROUPS,
  isValidPermission,
  SYSTEM_ROLE_KEYS,
  resetRoleToPreset,
  presetGrants
} from '@main/permissions'
import { InfinibayContext, requireUser } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { PolicyAuditService } from '../../../services/policy/PolicyAuditService'
import { DepartmentMembershipService } from '../../../services/policy/DepartmentMembershipService'
import {
  AssignUserRoleInput,
  CreateRoleInput,
  DepartmentMemberType,
  EffectivePermissionsType,
  PermissionRegistryType,
  PolicyAuditEntryType,
  PolicyAuditQueryInput,
  RemoveRolePermissionInput,
  RoleType,
  SetDepartmentMemberInput,
  SetRolePermissionInput,
  SetUserPermissionOverrideInput,
  UpdateRoleInput,
  UserPermissionOverrideType
} from './type'

type RoleWithRels = {
  id: string
  key: string
  name: string
  description: string | null
  isSystem: boolean
  priority: number
  permissions: Array<{ permission: string, scope: any }>
  _count?: { users: number }
}

function toRoleDto (role: RoleWithRels): RoleType {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description ?? undefined,
    isSystem: role.isSystem,
    priority: role.priority,
    permissions: role.permissions.map((p) => ({ permission: p.permission, scope: p.scope })),
    userCount: role._count?.users ?? 0
  }
}

function slugify (name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'role'
}

function validatePermission (permission: string): void {
  if (!isValidPermission(permission)) {
    throw new UserInputError(`Unknown permission: ${permission}`)
  }
}

const ROLE_INCLUDE = { permissions: true, _count: { select: { users: true } } } as const

/**
 * Privilege-escalation guard (#2): the actor may only grant permissions it
 * already holds, at a scope no broader than its own. Used by every governance
 * mutation that hands out grants (role grants, role assignment, user overrides).
 * SUPER_ADMIN (`*` @ANY) covers everything; a delegated admin can only delegate
 * the subset it has. Throws ForbiddenError on the first grant it cannot cover.
 */
async function assertActorCanGrant (
  ctx: InfinibayContext,
  grants: Array<{ permission: string, scope: any }>
): Promise<void> {
  const actor = requireUser(ctx)
  const svc = ctx.permissions ?? new PermissionService(ctx.prisma)
  const mine = ctx.permissionGrants ? await ctx.permissionGrants() : await svc.effectiveGrants(actor.id)
  for (const g of grants) {
    await svc.assertCanGrant(actor.id, g.permission, g.scope, mine)
  }
}

function toMemberDto (m: {
  id: string
  departmentId: string
  userId: string
  role: any
  user: { email: string, firstName: string, lastName: string, role: any }
}): DepartmentMemberType {
  return {
    id: m.id,
    departmentId: m.departmentId,
    userId: m.userId,
    role: m.role,
    userEmail: m.user.email,
    userName: `${m.user.firstName} ${m.user.lastName}`.trim() || m.user.email,
    userGlobalRole: m.user.role
  }
}

@Resolver(() => RoleType)
export class PolicyResolver {
  // ── Catalog ──────────────────────────────────────────────────────────────
  @Query(() => PermissionRegistryType)
  @Can('role:view')
  async permissionRegistry (): Promise<PermissionRegistryType> {
    return {
      resources: RESOURCES.map((r) => ({
        key: r.key, label: r.label, group: r.group, scoped: r.scoped, verbs: r.verbs
      })),
      groups: Object.entries(GROUPS).map(([key, members]) => ({ key, members }))
    }
  }

  // ── Roles ────────────────────────────────────────────────────────────────
  @Query(() => [RoleType])
  @Can('role:view')
  async roles (@Ctx() ctx: InfinibayContext): Promise<RoleType[]> {
    const roles = await ctx.prisma.role.findMany({ include: ROLE_INCLUDE, orderBy: { priority: 'desc' } })
    return roles.map(toRoleDto)
  }

  @Query(() => RoleType, { nullable: true })
  @Can('role:view')
  async role (@Arg('id') id: string, @Ctx() ctx: InfinibayContext): Promise<RoleType | null> {
    const role = await ctx.prisma.role.findUnique({ where: { id }, include: ROLE_INCLUDE })
    return role ? toRoleDto(role) : null
  }

  @Mutation(() => RoleType)
  @Can('role:create')
  async createRole (@Arg('input') input: CreateRoleInput, @Ctx() ctx: InfinibayContext): Promise<RoleType> {
    const name = input.name?.trim()
    if (!name) throw new UserInputError('Role name is required')
    for (const g of input.permissions ?? []) validatePermission(g.permission)
    await assertActorCanGrant(ctx, input.permissions ?? [])

    let key = slugify(name)
    if (await ctx.prisma.role.findUnique({ where: { key } })) key = `${key}-${Date.now().toString(36)}`

    const role = await ctx.prisma.role.create({
      data: {
        key,
        name,
        description: input.description ?? null,
        isSystem: false,
        permissions: { create: (input.permissions ?? []).map((g) => ({ permission: g.permission, scope: g.scope })) }
      },
      include: ROLE_INCLUDE
    })
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'role.create', targetType: 'role', targetId: role.id,
      summary: `Created role "${role.name}"`, metadata: { key: role.key, permissions: input.permissions }
    })
    return toRoleDto(role)
  }

  @Mutation(() => RoleType)
  @Can('role:edit')
  async updateRole (@Arg('input') input: UpdateRoleInput, @Ctx() ctx: InfinibayContext): Promise<RoleType> {
    const existing = await ctx.prisma.role.findUnique({ where: { id: input.id } })
    if (!existing) throw new UserInputError('Role not found')
    if (existing.key === 'SUPER_ADMIN') throw new UserInputError('The SUPER_ADMIN role cannot be modified')

    const role = await ctx.prisma.role.update({
      where: { id: input.id },
      data: {
        name: input.name?.trim() || existing.name,
        description: input.description ?? existing.description
      },
      include: ROLE_INCLUDE
    })
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'role.update', targetType: 'role', targetId: role.id,
      summary: `Updated role "${role.name}"`, metadata: { name: input.name, description: input.description }
    })
    return toRoleDto(role)
  }

  @Mutation(() => Boolean)
  @Can('role:delete')
  async deleteRole (@Arg('id') id: string, @Ctx() ctx: InfinibayContext): Promise<boolean> {
    const role = await ctx.prisma.role.findUnique({ where: { id } })
    if (!role) throw new UserInputError('Role not found')
    if (role.isSystem) throw new UserInputError('System roles cannot be deleted')
    // Users keep working: roleId is set NULL by the FK, falling back to their enum role.
    await ctx.prisma.role.delete({ where: { id } })
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'role.delete', targetType: 'role', targetId: id,
      summary: `Deleted role "${role.name}"`, metadata: { key: role.key }
    })
    return true
  }

  // ── Role grants ────────────────────────────────────────────────────────────
  @Mutation(() => RoleType)
  @Can('role:edit')
  async setRolePermission (@Arg('input') input: SetRolePermissionInput, @Ctx() ctx: InfinibayContext): Promise<RoleType> {
    validatePermission(input.permission)
    const role = await ctx.prisma.role.findUnique({ where: { id: input.roleId } })
    if (!role) throw new UserInputError('Role not found')
    if (role.key === 'SUPER_ADMIN') throw new UserInputError('The SUPER_ADMIN role cannot be modified')
    await assertActorCanGrant(ctx, [{ permission: input.permission, scope: input.scope }])

    await ctx.prisma.rolePermission.upsert({
      where: { roleId_permission: { roleId: input.roleId, permission: input.permission } },
      create: { roleId: input.roleId, permission: input.permission, scope: input.scope },
      update: { scope: input.scope }
    })
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'role_permission.set', targetType: 'role', targetId: input.roleId,
      summary: `Granted ${input.permission} (${input.scope}) to "${role.name}"`,
      metadata: { permission: input.permission, scope: input.scope }
    })
    const updated = await ctx.prisma.role.findUnique({ where: { id: input.roleId }, include: ROLE_INCLUDE })
    return toRoleDto(updated as RoleWithRels)
  }

  @Mutation(() => RoleType)
  @Can('role:edit')
  async removeRolePermission (@Arg('input') input: RemoveRolePermissionInput, @Ctx() ctx: InfinibayContext): Promise<RoleType> {
    const role = await ctx.prisma.role.findUnique({ where: { id: input.roleId } })
    if (!role) throw new UserInputError('Role not found')
    if (role.key === 'SUPER_ADMIN') throw new UserInputError('The SUPER_ADMIN role cannot be modified')

    await ctx.prisma.rolePermission.deleteMany({ where: { roleId: input.roleId, permission: input.permission } })
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'role_permission.remove', targetType: 'role', targetId: input.roleId,
      summary: `Revoked ${input.permission} from "${role.name}"`, metadata: { permission: input.permission }
    })
    const updated = await ctx.prisma.role.findUnique({ where: { id: input.roleId }, include: ROLE_INCLUDE })
    return toRoleDto(updated as RoleWithRels)
  }

  @Mutation(() => RoleType)
  @Can('role:edit')
  async resetRoleToDefault (@Arg('roleId') roleId: string, @Ctx() ctx: InfinibayContext): Promise<RoleType> {
    const role = await ctx.prisma.role.findUnique({ where: { id: roleId } })
    if (!role) throw new UserInputError('Role not found')
    if (!role.isSystem) throw new UserInputError('Only system presets can be reset to default')
    if (role.key === 'SUPER_ADMIN') throw new UserInputError('The SUPER_ADMIN role cannot be modified')
    // The actor must be able to grant everything the preset restores.
    await assertActorCanGrant(ctx, presetGrants(role.key))

    await resetRoleToPreset(ctx.prisma, role.key)
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'role.reset', targetType: 'role', targetId: roleId,
      summary: `Reset role "${role.name}" to default permissions`, metadata: { key: role.key }
    })
    const updated = await ctx.prisma.role.findUnique({ where: { id: roleId }, include: ROLE_INCLUDE })
    return toRoleDto(updated as RoleWithRels)
  }

  // ── User ↔ role / overrides ──────────────────────────────────────────────
  @Mutation(() => Boolean)
  @Can('role:assign')
  async assignUserRole (@Arg('input') input: AssignUserRoleInput, @Ctx() ctx: InfinibayContext): Promise<boolean> {
    const role = await ctx.prisma.role.findUnique({ where: { id: input.roleId }, include: { permissions: true } })
    if (!role) throw new UserInputError('Role not found')
    const user = await ctx.prisma.user.findUnique({ where: { id: input.userId } })
    if (!user || user.deleted) throw new UserInputError('User not found')
    // Anti-escalation: assigning a role hands the user all its grants, so the
    // actor must be able to grant every one of them.
    await assertActorCanGrant(ctx, role.permissions)

    // Last-owner protection: never strip the final SUPER_ADMIN.
    if (role.key !== 'SUPER_ADMIN') {
      const superRole = await ctx.prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' }, select: { id: true } })
      const wasSuper = (!!superRole && user.roleId === superRole.id) || user.role === 'SUPER_ADMIN'
      if (wasSuper) {
        const others = await ctx.prisma.user.count({
          where: {
            deleted: false,
            id: { not: user.id },
            OR: [...(superRole ? [{ roleId: superRole.id }] : []), { role: 'SUPER_ADMIN' as UserRole }]
          }
        })
        if (others === 0) throw new UserInputError('Cannot reassign the last SUPER_ADMIN. Promote another user first.')
      }
    }

    // Keep the legacy `role` enum (JWT identity) consistent: mirror system roles,
    // base-tier a custom role to USER (permissions come from roleId regardless).
    const enumRole = (SYSTEM_ROLE_KEYS.includes(role.key) ? role.key : 'USER') as UserRole
    await ctx.prisma.user.update({ where: { id: input.userId }, data: { roleId: role.id, role: enumRole } })
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'user_role.assign', targetType: 'user', targetId: input.userId,
      summary: `Assigned role "${role.name}" to ${user.email}`, metadata: { roleId: role.id, roleKey: role.key }
    })
    return true
  }

  @Mutation(() => UserPermissionOverrideType)
  @Can('permission:grantUser')
  async setUserPermissionOverride (@Arg('input') input: SetUserPermissionOverrideInput, @Ctx() ctx: InfinibayContext): Promise<UserPermissionOverrideType> {
    validatePermission(input.permission)
    const user = await ctx.prisma.user.findUnique({ where: { id: input.userId } })
    if (!user || user.deleted) throw new UserInputError('User not found')
    // Anti-escalation applies to ALLOW overrides only; a DENY narrows access and
    // cannot escalate, so it is always permitted for a `permission:grantUser` holder.
    if (input.effect === 'ALLOW') {
      await assertActorCanGrant(ctx, [{ permission: input.permission, scope: input.scope }])
    }

    const override = await ctx.prisma.userPermissionOverride.upsert({
      where: { userId_permission: { userId: input.userId, permission: input.permission } },
      create: { userId: input.userId, permission: input.permission, scope: input.scope, effect: input.effect },
      update: { scope: input.scope, effect: input.effect }
    })
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'user_override.set', targetType: 'user', targetId: input.userId,
      summary: `${input.effect} ${input.permission} (${input.scope}) for ${user.email}`,
      metadata: { permission: input.permission, scope: input.scope, effect: input.effect }
    })
    return { id: override.id, userId: override.userId, permission: override.permission, scope: override.scope, effect: override.effect }
  }

  @Mutation(() => Boolean)
  @Can('permission:grantUser')
  async clearUserPermissionOverride (
    @Arg('userId') userId: string,
    @Arg('permission') permission: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const res = await ctx.prisma.userPermissionOverride.deleteMany({ where: { userId, permission } })
    if (res.count > 0) {
      await new PolicyAuditService(ctx.prisma).record({
        actorId: ctx.user?.id, action: 'user_override.clear', targetType: 'user', targetId: userId,
        summary: `Cleared override ${permission} for user ${userId}`, metadata: { permission }
      })
    }
    return res.count > 0
  }

  @Query(() => [UserPermissionOverrideType])
  @Can('permission:grantUser')
  async userPermissionOverrides (@Arg('userId') userId: string, @Ctx() ctx: InfinibayContext): Promise<UserPermissionOverrideType[]> {
    const rows = await ctx.prisma.userPermissionOverride.findMany({ where: { userId } })
    return rows.map((r) => ({ id: r.id, userId: r.userId, permission: r.permission, scope: r.scope, effect: r.effect }))
  }

  // ── Self ─────────────────────────────────────────────────────────────────
  @Query(() => EffectivePermissionsType)
  async myPermissions (@Ctx() ctx: InfinibayContext): Promise<EffectivePermissionsType> {
    const user = requireUser(ctx)
    const svc = new PermissionService(ctx.prisma)
    const grants = await svc.effectiveGrants(user.id)
    const allowedResources = await svc.deriveAllowedResources(user.id, grants)
    return {
      grants: [...grants.entries()].map(([permission, scope]) => ({ permission, scope })),
      allowedResources
    }
  }

  // ── Department membership (department-scoped roles) ────────────────────────
  @Query(() => [DepartmentMemberType])
  @Can('department:view')
  async departmentMembers (@Arg('departmentId') departmentId: string, @Ctx() ctx: InfinibayContext): Promise<DepartmentMemberType[]> {
    const rows = await new DepartmentMembershipService(ctx.prisma).list(departmentId)
    return rows.map(toMemberDto)
  }

  @Mutation(() => DepartmentMemberType)
  @Can('department:manageMembers', { id: (a) => a.input?.departmentId })
  async setDepartmentMember (@Arg('input') input: SetDepartmentMemberInput, @Ctx() ctx: InfinibayContext): Promise<DepartmentMemberType> {
    const member = await new DepartmentMembershipService(ctx.prisma).setMember(input.departmentId, input.userId, input.role)
    await new PolicyAuditService(ctx.prisma).record({
      actorId: ctx.user?.id, action: 'department_member.set', targetType: 'department', targetId: input.departmentId,
      summary: `Set ${member.user.email} as ${input.role} in department ${input.departmentId}`,
      metadata: { departmentId: input.departmentId, userId: input.userId, role: input.role }
    })
    return toMemberDto(member)
  }

  @Mutation(() => Boolean)
  @Can('department:manageMembers', { id: (a) => a.departmentId })
  async removeDepartmentMember (
    @Arg('departmentId') departmentId: string,
    @Arg('userId') userId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const removed = await new DepartmentMembershipService(ctx.prisma).removeMember(departmentId, userId)
    if (removed) {
      await new PolicyAuditService(ctx.prisma).record({
        actorId: ctx.user?.id, action: 'department_member.remove', targetType: 'department', targetId: departmentId,
        summary: `Removed user ${userId} from department ${departmentId}`, metadata: { departmentId, userId }
      })
    }
    return removed
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  @Query(() => [PolicyAuditEntryType])
  @Can('audit:view')
  async policyAuditLog (
    @Arg('input', () => PolicyAuditQueryInput, { nullable: true }) input: PolicyAuditQueryInput | undefined,
    @Ctx() ctx: InfinibayContext
  ): Promise<PolicyAuditEntryType[]> {
    const rows = await new PolicyAuditService(ctx.prisma).list(input?.limit ?? 100)
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId ?? undefined,
      actorName: r.actor ? (`${r.actor.firstName} ${r.actor.lastName}`.trim() || r.actor.email) : undefined,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId ?? undefined,
      summary: r.summary,
      metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: r.createdAt
    }))
  }
}
