import { RecommendationType } from '@prisma/client'
import { VMOperationsService } from '@services/VMOperationsService'
import { ResolutionHandler } from './index'

export const rebootVMHandler: ResolutionHandler = {
  actionKey: 'reboot',
  types: [RecommendationType.OS_UPDATE_AVAILABLE, RecommendationType.APP_UPDATE_AVAILABLE, RecommendationType.OTHER],
  requiresConfirmation: true,
  async run (ctx) {
    await ctx.reportProgress(20, 'Issuing graceful restart')
    const ops = new VMOperationsService(ctx.prisma)
    const result = await ops.restartMachine(ctx.machineId)
    if (!result.success) {
      throw new Error(result.error || 'Restart failed')
    }
    await ctx.reportProgress(95, 'Restart initiated')
    return { message: result.message || 'Machine restart initiated.', data: { success: true } }
  }
}
