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
    // The triggering user id lives on RecommendationResolution, NOT on VMRecommendation
    // (the old `(ctx.recommendation as any).triggeredByUserId` was always undefined and
    // fell back to ctx.machineId — a Machine UUID — which is never a valid User.id and made
    // MaintenanceTask.createdByUserId's FK throw a Prisma P2003 on every invocation).
    // Derive the real user server-side from the in-flight resolution so a Machine id can
    // never reach the User FK.
    const resolution = await ctx.prisma.recommendationResolution.findFirst({
      where: { recommendationId: ctx.recommendation.id },
      orderBy: { createdAt: 'desc' },
      select: { triggeredByUserId: true }
    })
    const triggeredBy = resolution?.triggeredByUserId
    if (!triggeredBy) {
      throw new Error('Unable to determine the triggering user for schedule_reboot')
    }

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
