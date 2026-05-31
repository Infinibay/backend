import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { UserRole } from '@prisma/client'
import { RolePermissionService } from '../../services/policy/RolePermissionService'

export function isOperatorRole (role?: string | null): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export async function assertCanAccessResource (ctx: InfinibayContext, resource: string): Promise<void> {
  const role = ctx.user?.role as UserRole | undefined
  if (!role) {
    throw new UserInputError('Not authorized')
  }

  const allowed = await new RolePermissionService(ctx.prisma).canAccess(role, resource)
  if (!allowed) {
    throw new UserInputError(`Not authorized to access ${resource}`)
  }
}

/**
 * Assert that the current user can manage the specified VM
 * Checks if user is admin or owns the VM
 */
export async function assertCanManageVM (ctx: InfinibayContext, machineId: string): Promise<void> {
  const vm = await ctx.prisma.machine.findUnique({
    where: { id: machineId }
  })

  if (!vm) {
    throw new UserInputError('VM not found')
  }

  const user = ctx.user
  if (!user || (!isOperatorRole(user.role) && vm.userId !== user.id)) {
    throw new UserInputError('Not authorized')
  }
}

/**
 * Assert that the current user can manage the VM associated with a maintenance task
 */
export async function assertCanManageMaintenanceTask (ctx: InfinibayContext, taskId: string): Promise<void> {
  const task = await ctx.prisma.maintenanceTask.findUnique({
    where: { id: taskId },
    select: { machineId: true }
  })

  if (!task) {
    throw new UserInputError('Maintenance task not found')
  }

  await assertCanManageVM(ctx, task.machineId)
}
