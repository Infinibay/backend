import { InfinibayContext } from '@utils/context'

/**
 * Assert that the current user can manage the specified VM
 * Checks if user is admin or owns the VM
 */
export async function assertCanManageVM (ctx: InfinibayContext, machineId: string): Promise<void> {
  const vm = await ctx.prisma.machine.findUnique({
    where: { id: machineId }
  })

  if (!vm) {
    throw new Error('VM not found')
  }

  const user = ctx.user
  if (!user || (user.role !== 'ADMIN' && vm.userId !== user.id)) {
    throw new Error('Not authorized')
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
    throw new Error('Maintenance task not found')
  }

  await assertCanManageVM(ctx, task.machineId)
}
