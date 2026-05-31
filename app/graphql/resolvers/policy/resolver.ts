import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from 'type-graphql'
import { UserInputError } from '@utils/errors'
import { InfinibayContext } from '@utils/context'
import { RolePermissionService } from '../../../services/policy/RolePermissionService'
import { DepartmentMembershipService } from '../../../services/policy/DepartmentMembershipService'
import { PolicyAuditService } from '../../../services/policy/PolicyAuditService'
import {
  DepartmentMemberType,
  EffectivePermissionType,
  PolicyAuditEntryType,
  PolicyAuditQueryInput,
  RolePermissionMatrixType,
  SetDepartmentMemberInput,
  SetRolePermissionInput
} from './type'
import { assertCanAccessResource } from '../../utils/auth'

function toMemberDto (m: {
  id: string
  departmentId: string
  userId: string
  role: any
  user: { email: string; firstName: string; lastName: string; role: any }
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

@Resolver(() => RolePermissionMatrixType)
export class PolicyResolver {
  @Query(() => EffectivePermissionType)
  @Authorized('USER')
  async myPermissions (
    @Ctx() context: InfinibayContext
  ): Promise<EffectivePermissionType> {
    const { prisma, user } = context
    if (!user) {
      return { allowedResources: [] }
    }

    const allowedResources = await new RolePermissionService(prisma).allowedResources(user.role)
    return { allowedResources }
  }

  @Query(() => RolePermissionMatrixType)
  @Authorized('ADMIN')
  async rolePermissionMatrix (
    @Ctx() context: InfinibayContext
  ): Promise<RolePermissionMatrixType> {
    const { prisma } = context
    await assertCanAccessResource(context, 'policies')
    return new RolePermissionService(prisma).matrix()
  }

  @Mutation(() => RolePermissionMatrixType)
  @Authorized('ADMIN')
  async setRolePermission (
    @Arg('input') input: SetRolePermissionInput,
    @Ctx() context: InfinibayContext
  ): Promise<RolePermissionMatrixType> {
    const { prisma, user } = context
    await assertCanAccessResource(context, 'policies')
    if (user?.role !== 'SUPER_ADMIN') {
      throw new UserInputError('Only SUPER_ADMIN can change role permissions')
    }

    try {
      const matrix = await new RolePermissionService(prisma).setPermission(
        input.role,
        input.resource,
        input.effect
      )
      await new PolicyAuditService(prisma).record({
        actorId: user?.id,
        action: 'role_permission.set',
        targetType: 'role',
        targetId: input.role,
        summary: `Set ${input.role} → ${input.resource} = ${input.effect}`,
        metadata: { role: input.role, resource: input.resource, effect: input.effect }
      })
      return matrix
    } catch (error) {
      throw new UserInputError((error as Error).message)
    }
  }

  // -------------------------------------------------------------------------
  // Department-scoped roles
  // -------------------------------------------------------------------------

  @Query(() => [DepartmentMemberType])
  @Authorized('ADMIN')
  async departmentMembers (
    @Arg('departmentId') departmentId: string,
    @Ctx() context: InfinibayContext
  ): Promise<DepartmentMemberType[]> {
    await assertCanAccessResource(context, 'policies')
    const rows = await new DepartmentMembershipService(context.prisma).list(departmentId)
    return rows.map(toMemberDto)
  }

  @Mutation(() => DepartmentMemberType)
  @Authorized('ADMIN')
  async setDepartmentMember (
    @Arg('input') input: SetDepartmentMemberInput,
    @Ctx() context: InfinibayContext
  ): Promise<DepartmentMemberType> {
    await assertCanAccessResource(context, 'policies')
    // Granting MANAGER widens the target user's resource scope to that
    // department (see getUserAccessibleDepartments), so it's a privilege grant
    // and is restricted to SUPER_ADMIN — matching setRolePermission. Managing a
    // plain MEMBER (which grants no access) stays available to ADMIN.
    if (input.role === 'MANAGER' && context.user?.role !== 'SUPER_ADMIN') {
      throw new UserInputError('Only SUPER_ADMIN can grant the MANAGER role')
    }
    try {
      const member = await new DepartmentMembershipService(context.prisma).setMember(
        input.departmentId,
        input.userId,
        input.role
      )
      await new PolicyAuditService(context.prisma).record({
        actorId: context.user?.id,
        action: 'department_member.set',
        targetType: 'department',
        targetId: input.departmentId,
        summary: `Set ${member.user.email} as ${input.role} in department ${input.departmentId}`,
        metadata: { departmentId: input.departmentId, userId: input.userId, role: input.role }
      })
      return toMemberDto(member)
    } catch (error) {
      throw new UserInputError((error as Error).message)
    }
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async removeDepartmentMember (
    @Arg('departmentId') departmentId: string,
    @Arg('userId') userId: string,
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    await assertCanAccessResource(context, 'policies')
    const removed = await new DepartmentMembershipService(context.prisma).removeMember(departmentId, userId)
    if (removed) {
      await new PolicyAuditService(context.prisma).record({
        actorId: context.user?.id,
        action: 'department_member.remove',
        targetType: 'department',
        targetId: departmentId,
        summary: `Removed user ${userId} from department ${departmentId}`,
        metadata: { departmentId, userId }
      })
    }
    return removed
  }

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  @Query(() => [PolicyAuditEntryType])
  @Authorized('ADMIN')
  async policyAuditLog (
    @Arg('input', { nullable: true }) input: PolicyAuditQueryInput | undefined,
    @Ctx() context: InfinibayContext
  ): Promise<PolicyAuditEntryType[]> {
    await assertCanAccessResource(context, 'policies')
    const rows = await new PolicyAuditService(context.prisma).list(input?.limit ?? 100)
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId ?? undefined,
      actorName: r.actor
        ? (`${r.actor.firstName} ${r.actor.lastName}`.trim() || r.actor.email)
        : undefined,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId ?? undefined,
      summary: r.summary,
      metadata: (r.metadata as Record<string, unknown> | null) ?? undefined,
      createdAt: r.createdAt
    }))
  }
}
