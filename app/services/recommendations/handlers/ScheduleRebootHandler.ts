import { RecommendationType, MaintenanceTaskType } from '@prisma/client'
import { ResolutionHandler } from './index'

export const scheduleRebootHandler: ResolutionHandler = {
  actionKey: 'schedule_reboot',
  types: [RecommendationType.OS_UPDATE_AVAILABLE, RecommendationType.APP_UPDATE_AVAILABLE, RecommendationType.OTHER],
  async run (ctx) {
    const scheduledAtRaw = ctx.params.scheduledAt
    if (!scheduledAtRaw) {
      throw new Error('scheduledAt parameter is required for schedule_reboot')
    }
    const runAt = new Date(scheduledAtRaw as string | number | Date)
    if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
      throw new Error('scheduledAt must be a valid future date')
    }

    await ctx.reportProgress(40, 'Creating maintenance task')
    const triggeredBy = (ctx.recommendation as any).triggeredByUserId || ctx.machineId

    const task = await ctx.prisma.maintenanceTask.create({
      data: {
        machineId: ctx.machineId,
        taskType: MaintenanceTaskType.CUSTOM_SCRIPT,
        name: 'Scheduled reboot (auto-resolve)',
        description: `Reboot scheduled to resolve recommendation ${ctx.recommendation.id}`,
        isEnabled: true,
        isRecurring: false,
        runAt,
        nextRunAt: runAt,
        parameters: { action: 'reboot', recommendationId: ctx.recommendation.id },
        createdByUserId: triggeredBy
      }
    })

    return {
      message: `Reboot scheduled for ${runAt.toISOString()}`,
      data: { maintenanceTaskId: task.id, runAt: runAt.toISOString() }
    }
  }
}
