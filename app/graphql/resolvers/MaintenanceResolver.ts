import { Resolver, Query, Mutation, Arg, Ctx, ID } from 'type-graphql'
import { MaintenanceTaskType, MaintenanceStatus, MaintenanceTrigger, Prisma } from '@prisma/client'
import { InfinibayContext } from '@utils/context'
import { MaintenanceService } from '@services/MaintenanceService'
import { assertCanManageVM, assertCanManageMaintenanceTask } from '@graphql/utils/auth'
import {
  MaintenanceTask,
  MaintenanceHistory,
  CreateMaintenanceTaskInput,
  UpdateMaintenanceTaskInput,
  ExecuteMaintenanceInput,
  MaintenanceTaskResponse,
  MaintenanceExecutionResponse,
  MaintenanceStats
} from '@graphql/types/MaintenanceTypes'

@Resolver()
export class MaintenanceResolver {
  /**
   * Get all maintenance tasks for a specific VM
   */
  @Query(() => [MaintenanceTask])
  async maintenanceTasks (
    @Arg('machineId', () => ID) machineId: string,
    @Arg('status', () => String, { nullable: true }) status: 'enabled' | 'disabled' | undefined,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceTask[]> {
    // Check authorization
    await assertCanManageVM(ctx, machineId)
    // Create MaintenanceService instance for this request
    const maintenanceService = new MaintenanceService(ctx.prisma)
    const tasks = await maintenanceService.getTasksForVM(machineId, status)

    // Transform database results to match GraphQL types
    return tasks.map(task => ({
      id: task.id,
      machineId: task.machineId,
      taskType: task.taskType,
      name: task.name,
      description: task.description,
      isEnabled: task.isEnabled,
      isRecurring: task.isRecurring,
      cronSchedule: task.cronSchedule,
      runAt: task.runAt,
      nextRunAt: task.nextRunAt,
      lastRunAt: task.lastRunAt,
      executionStatus: task.executionStatus,
      parameters: task.parameters as Record<string, any> | null,
      createdByUserId: task.createdByUserId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }))
  }

  /**
   * Get maintenance task by ID
   */
  @Query(() => MaintenanceTask, { nullable: true })
  async maintenanceTask (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceTask | null> {
    // Check authorization first
    await assertCanManageMaintenanceTask(ctx, id)

    const task = await ctx.prisma.maintenanceTask.findUnique({
      where: { id }
    })

    if (!task) return null

    // Transform database result to match GraphQL types
    return {
      id: task.id,
      machineId: task.machineId,
      taskType: task.taskType,
      name: task.name,
      description: task.description,
      isEnabled: task.isEnabled,
      isRecurring: task.isRecurring,
      cronSchedule: task.cronSchedule,
      runAt: task.runAt,
      nextRunAt: task.nextRunAt,
      lastRunAt: task.lastRunAt,
      executionStatus: task.executionStatus,
      parameters: task.parameters as Record<string, any> | null,
      createdByUserId: task.createdByUserId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
  }

  /**
   * Get maintenance execution history for a VM
   */
  @Query(() => [MaintenanceHistory])
  async maintenanceHistory (
    @Arg('machineId', () => ID) machineId: string,
    @Arg('limit', { nullable: true, defaultValue: 50 }) limit: number,
    @Arg('taskType', () => MaintenanceTaskType, { nullable: true }) taskType: MaintenanceTaskType | undefined,
    @Arg('status', () => MaintenanceStatus, { nullable: true }) status: MaintenanceStatus | undefined,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceHistory[]> {
    // Check authorization
    await assertCanManageVM(ctx, machineId)

    const where: { machineId: string; taskType?: MaintenanceTaskType; status?: MaintenanceStatus } = { machineId }

    if (taskType) where.taskType = taskType
    if (status) where.status = status

    const history = await ctx.prisma.maintenanceHistory.findMany({
      where,
      orderBy: { executedAt: 'desc' },
      take: limit
    })

    // Transform database results to match GraphQL types
    return history.map(h => ({
      id: h.id,
      taskId: h.taskId,
      machineId: h.machineId,
      taskType: h.taskType,
      status: h.status,
      triggeredBy: h.triggeredBy,
      executedByUserId: h.executedByUserId,
      executedAt: h.executedAt,
      duration: h.duration,
      result: h.result as Record<string, any> | null,
      error: h.error,
      parameters: null // Not stored in history table
    }))
  }

  /**
   * Get maintenance statistics for a VM
   */
  @Query(() => MaintenanceStats)
  async maintenanceStats (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceStats> {
    // Check authorization
    await assertCanManageVM(ctx, machineId)

    const [
      totalTasks,
      enabledTasks,
      recurringTasks,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      lastExecution,
      dueTasks
    ] = await Promise.all([
      // Total tasks count
      ctx.prisma.maintenanceTask.count({
        where: { machineId }
      }),
      // Enabled tasks count
      ctx.prisma.maintenanceTask.count({
        where: { machineId, isEnabled: true }
      }),
      // Recurring tasks count
      ctx.prisma.maintenanceTask.count({
        where: { machineId, isRecurring: true }
      }),
      // Total executions count
      ctx.prisma.maintenanceHistory.count({
        where: { machineId }
      }),
      // Successful executions count
      ctx.prisma.maintenanceHistory.count({
        where: { machineId, status: MaintenanceStatus.SUCCESS }
      }),
      // Failed executions count
      ctx.prisma.maintenanceHistory.count({
        where: { machineId, status: MaintenanceStatus.FAILED }
      }),
      // Last execution
      ctx.prisma.maintenanceHistory.findFirst({
        where: { machineId },
        orderBy: { executedAt: 'desc' }
      }),
      // Due tasks count
      ctx.prisma.maintenanceTask.count({
        where: {
          machineId,
          isEnabled: true,
          nextRunAt: {
            lte: new Date()
          }
        }
      })
    ])

    return {
      machineId,
      totalTasks,
      enabledTasks,
      recurringTasks,
      lastExecutionDate: lastExecution?.executedAt,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      pendingTasks: dueTasks
    }
  }

  /**
   * Create a new maintenance task
   */
  @Mutation(() => MaintenanceTaskResponse)
  async createMaintenanceTask (
    @Arg('input') input: CreateMaintenanceTaskInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceTaskResponse> {
    try {
      // Check authorization
      await assertCanManageVM(ctx, input.machineId)

      // Create MaintenanceService instance for this request
      const maintenanceService = new MaintenanceService(ctx.prisma)

      const task = await maintenanceService.scheduleTask({
        vmId: input.machineId,
        taskType: input.taskType,
        name: input.name,
        description: input.description,
        isRecurring: input.isRecurring,
        cronSchedule: input.cronSchedule,
        runAt: input.runAt,
        parameters: input.parameters || undefined,
        userId: ctx.user!.id
      })

      return {
        success: true,
        message: 'Maintenance task created successfully',
        task: {
          id: task.id,
          machineId: task.machineId,
          taskType: task.taskType,
          name: task.name,
          description: task.description,
          isEnabled: task.isEnabled,
          isRecurring: task.isRecurring,
          cronSchedule: task.cronSchedule,
          runAt: task.runAt,
          nextRunAt: task.nextRunAt,
          lastRunAt: task.lastRunAt,
          executionStatus: task.executionStatus,
          parameters: task.parameters as Record<string, any> | null,
          createdByUserId: task.createdByUserId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create maintenance task'
      }
    }
  }

  /**
   * Update an existing maintenance task
   */
  @Mutation(() => MaintenanceTaskResponse)
  async updateMaintenanceTask (
    @Arg('input') input: UpdateMaintenanceTaskInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceTaskResponse> {
    try {
      // Check authorization
      await assertCanManageMaintenanceTask(ctx, input.id)
      const updateData: Prisma.MaintenanceTaskUpdateInput = {}
      if (input.name !== undefined) updateData.name = input.name
      if (input.description !== undefined) updateData.description = input.description
      if (input.isEnabled !== undefined) updateData.isEnabled = input.isEnabled
      if (input.isRecurring !== undefined) updateData.isRecurring = input.isRecurring
      if (input.cronSchedule !== undefined) updateData.cronSchedule = input.cronSchedule
      if (input.runAt !== undefined) updateData.runAt = input.runAt
      if (input.parameters !== undefined) {
        updateData.parameters = input.parameters || Prisma.JsonNull
      }

      const task = await ctx.prisma.maintenanceTask.update({
        where: { id: input.id },
        data: updateData
      })

      return {
        success: true,
        message: 'Maintenance task updated successfully',
        task: {
          id: task.id,
          machineId: task.machineId,
          taskType: task.taskType,
          name: task.name,
          description: task.description,
          isEnabled: task.isEnabled,
          isRecurring: task.isRecurring,
          cronSchedule: task.cronSchedule,
          runAt: task.runAt,
          nextRunAt: task.nextRunAt,
          lastRunAt: task.lastRunAt,
          executionStatus: task.executionStatus,
          parameters: task.parameters as Record<string, any> | null,
          createdByUserId: task.createdByUserId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update maintenance task'
      }
    }
  }

  /**
   * Delete a maintenance task
   */
  @Mutation(() => MaintenanceTaskResponse)
  async deleteMaintenanceTask (
    @Arg('id', () => ID) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceTaskResponse> {
    try {
      // Check authorization
      await assertCanManageMaintenanceTask(ctx, id)
      await ctx.prisma.maintenanceTask.delete({
        where: { id }
      })

      return {
        success: true,
        message: 'Maintenance task deleted successfully'
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete maintenance task'
      }
    }
  }

  /**
   * Execute a maintenance task immediately
   */
  @Mutation(() => MaintenanceExecutionResponse)
  async executeMaintenanceTask (
    @Arg('taskId', () => ID) taskId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceExecutionResponse> {
    try {
      // Check authorization
      await assertCanManageMaintenanceTask(ctx, taskId)
      // Create MaintenanceService instance for this request
      const maintenanceService = new MaintenanceService(ctx.prisma)

      const result = await maintenanceService.executeTask(
        taskId,
        MaintenanceTrigger.MANUAL,
        ctx.user!.id
      )

      // Create a mock MaintenanceHistory response for now
      // In a real implementation, executeTask would return the history record
      return {
        success: result.success,
        message: 'Maintenance task executed successfully',
        execution: undefined // Will be implemented when executeTask returns proper history
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute maintenance task'
      }
    }
  }

  /**
   * Execute immediate maintenance without creating a task
   */
  @Mutation(() => MaintenanceExecutionResponse)
  async executeImmediateMaintenance (
    @Arg('input') input: ExecuteMaintenanceInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceExecutionResponse> {
    try {
      // Check authorization
      await assertCanManageVM(ctx, input.machineId)
      // Create MaintenanceService instance for this request
      const maintenanceService = new MaintenanceService(ctx.prisma)

      const parameters = input.parameters || {}

      const result = await maintenanceService.executeImmediate(
        input.machineId,
        input.taskType,
        parameters,
        ctx.user!.id
      )

      // Create a mock MaintenanceHistory response for now
      return {
        success: result.success,
        message: 'Immediate maintenance executed successfully',
        execution: undefined // Will be implemented when executeImmediate returns proper history
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute immediate maintenance'
      }
    }
  }

  /**
   * Enable or disable a maintenance task
   */
  @Mutation(() => MaintenanceTaskResponse)
  async toggleMaintenanceTask (
    @Arg('id', () => ID) id: string,
    @Arg('enabled', () => Boolean) enabled: boolean,
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceTaskResponse> {
    try {
      // Check authorization
      await assertCanManageMaintenanceTask(ctx, id)
      const task = await ctx.prisma.maintenanceTask.update({
        where: { id },
        data: { isEnabled: enabled }
      })

      return {
        success: true,
        message: `Maintenance task ${enabled ? 'enabled' : 'disabled'} successfully`,
        task: {
          id: task.id,
          machineId: task.machineId,
          taskType: task.taskType,
          name: task.name,
          description: task.description,
          isEnabled: task.isEnabled,
          isRecurring: task.isRecurring,
          cronSchedule: task.cronSchedule,
          runAt: task.runAt,
          nextRunAt: task.nextRunAt,
          lastRunAt: task.lastRunAt,
          executionStatus: task.executionStatus,
          parameters: task.parameters as Record<string, any> | null,
          createdByUserId: task.createdByUserId,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle maintenance task'
      }
    }
  }

  /**
   * Get all due maintenance tasks across all VMs (for cron processing)
   */
  @Query(() => [MaintenanceTask])
  async dueMaintenanceTasks (
    @Ctx() ctx: InfinibayContext
  ): Promise<MaintenanceTask[]> {
    // Check admin authorization - only admins can access system-wide tasks
    const user = ctx.user
    if (!user || user.role !== 'ADMIN') {
      throw new Error('Not authorized - admin access required')
    }

    // Create MaintenanceService instance for this request
    const maintenanceService = new MaintenanceService(ctx.prisma)
    const tasks = await maintenanceService.getDueTasks()

    // Transform database results to match GraphQL types
    return tasks.map(task => ({
      id: task.id,
      machineId: task.machineId,
      taskType: task.taskType,
      name: task.name,
      description: task.description,
      isEnabled: task.isEnabled,
      isRecurring: task.isRecurring,
      cronSchedule: task.cronSchedule,
      runAt: task.runAt,
      nextRunAt: task.nextRunAt,
      lastRunAt: task.lastRunAt,
      executionStatus: task.executionStatus,
      parameters: task.parameters as Record<string, any> | null,
      createdByUserId: task.createdByUserId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }))
  }
}
