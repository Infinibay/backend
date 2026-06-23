import { Prisma, PrismaClient, RecommendationResolution, ResolutionStatus, VMRecommendation } from '@prisma/client'
import logger from '@main/logger'
import { Logger } from 'winston'
import { getResolutionHandler, ResolutionHandler, ResolutionHandlerContext } from './handlers'
import { PermissionService } from '@main/permissions'

export interface ResolveOptions {
  recommendationId: string
  actionKey: string
  userId: string
  userRole: string
  params?: Record<string, unknown>
}

export class RecommendationResolverService {
  private prisma: PrismaClient
  private debug: Logger

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = logger.child({ module: 'recommendation-resolver' })
  }

  /**
   * Start an auto-resolve execution for a recommendation.
   *
   * Idempotent: if a non-terminal resolution already exists for this recommendation,
   * returns it instead of starting a second one.
   */
  async resolve (opts: ResolveOptions): Promise<RecommendationResolution> {
    const { recommendationId, actionKey, userId, userRole, params } = opts

    const rec = await this.prisma.vMRecommendation.findUnique({
      where: { id: recommendationId },
      include: {
        machine: { select: { id: true, userId: true, departmentId: true, name: true, os: true } },
        activeResolution: true
      }
    })

    if (!rec) {
      throw new Error('Recommendation not found')
    }

    // Scope check via grants (the decorator already verified verb possession).
    const resolveAllowed = await new PermissionService(this.prisma).can(userId, 'recommendation:resolve', {
      ownerId: rec.machine.userId,
      departmentId: rec.machine.departmentId
    })
    if (!resolveAllowed) throw new Error('Access denied')

    // Idempotency: if a non-terminal resolution is already tracked, return it
    if (rec.activeResolution && !isTerminalStatus(rec.activeResolution.status)) {
      this.debug.info(`Returning in-flight resolution ${rec.activeResolution.id} for recommendation ${recommendationId}`)
      return rec.activeResolution
    }

    const handler = getResolutionHandler(rec.type, actionKey)
    if (!handler) {
      throw new Error(`No handler registered for recommendation type ${rec.type} and action ${actionKey}`)
    }

    // Enforce confirmation for destructive actions
    if (handler.requiresConfirmation && !(params?.confirmed === true)) {
      throw new Error(`Action ${actionKey} requires confirmed=true in params`)
    }

    const resolution = await this.prisma.$transaction(async (tx) => {
      const created = await tx.recommendationResolution.create({
        data: {
          recommendationId,
          machineId: rec.machineId,
          actionKey,
          status: ResolutionStatus.PENDING,
          progress: 0,
          params: (params ?? undefined) as Prisma.InputJsonValue | undefined,
          triggeredByUserId: userId
        }
      })
      await tx.vMRecommendation.update({
        where: { id: recommendationId },
        data: { activeResolutionId: created.id }
      })
      return created
    })

    // Fire-and-forget: run the handler asynchronously
    void this.runHandler(handler, resolution.id, rec, params ?? {})
      .catch(err => {
        this.debug.error(`Unhandled error in resolution ${resolution.id}: ${err?.message || err}`)
      })

    return resolution
  }

  async cancel (resolutionId: string, userId: string, userRole: string): Promise<RecommendationResolution> {
    const resolution = await this.prisma.recommendationResolution.findUnique({
      where: { id: resolutionId },
      include: { recommendation: { include: { machine: { select: { userId: true, departmentId: true } } } } }
    })
    if (!resolution) throw new Error('Resolution not found')
    const cancelAllowed = await new PermissionService(this.prisma).can(userId, 'recommendation:cancel', {
      ownerId: resolution.recommendation.machine.userId,
      departmentId: resolution.recommendation.machine.departmentId
    })
    if (!cancelAllowed) throw new Error('Access denied')
    if (isTerminalStatus(resolution.status)) return resolution

    return this.prisma.recommendationResolution.update({
      where: { id: resolutionId },
      data: { status: ResolutionStatus.CANCELLED, completedAt: new Date() }
    })
  }

  private async runHandler (
    handler: ResolutionHandler,
    resolutionId: string,
    rec: VMRecommendation & { machine: { id: string; userId: string | null; name: string; os: string } },
    params: Record<string, unknown>
  ): Promise<void> {
    const prisma = this.prisma
    const update = async (patch: Prisma.RecommendationResolutionUpdateInput): Promise<void> => {
      await prisma.recommendationResolution.update({ where: { id: resolutionId }, data: patch })
    }

    await update({ status: ResolutionStatus.RUNNING, startedAt: new Date(), progress: 5 })

    const ctx: ResolutionHandlerContext = {
      prisma,
      recommendation: rec,
      machineId: rec.machineId,
      params,
      reportProgress: async (progress: number, message?: string) => {
        await update({ progress: Math.max(0, Math.min(100, Math.round(progress))), progressMessage: message ?? null })
      }
    }

    try {
      const result = await handler.run(ctx)
      const finalStatus = result.requiresReboot ? ResolutionStatus.REQUIRES_REBOOT : ResolutionStatus.SUCCEEDED
      await update({
        status: finalStatus,
        progress: 100,
        progressMessage: result.message ?? null,
        result: (result.data ?? undefined) as any,
        completedAt: new Date()
      })
      // Auto-dismiss on success; keep visible when reboot still required
      if (finalStatus === ResolutionStatus.SUCCEEDED) {
        await prisma.vMRecommendation.update({
          where: { id: rec.id },
          data: { dismissedAt: new Date(), activeResolutionId: null }
        })
      }
    } catch (err: any) {
      this.debug.error(`Handler for ${handler.actionKey} failed on rec ${rec.id}: ${err?.message || err}`)
      await update({
        status: ResolutionStatus.FAILED,
        error: err?.message || String(err),
        completedAt: new Date()
      })
      // Free the slot so the user can retry
      await prisma.vMRecommendation.update({
        where: { id: rec.id },
        data: { activeResolutionId: null }
      })
    }
  }
}

function isTerminalStatus (status: ResolutionStatus): boolean {
  return (
    status === ResolutionStatus.SUCCEEDED ||
    status === ResolutionStatus.FAILED ||
    status === ResolutionStatus.CANCELLED ||
    status === ResolutionStatus.REQUIRES_REBOOT
  )
}
