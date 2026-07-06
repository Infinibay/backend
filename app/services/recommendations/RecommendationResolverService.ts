import { Prisma, PrismaClient, RecommendationResolution, ResolutionStatus, VMRecommendation } from '@prisma/client'
import logger from '@main/logger'
import { Logger } from 'winston'
import { getResolutionHandler, ResolutionHandler, ResolutionHandlerContext } from './handlers'
import { PermissionService } from '@main/permissions'
import { getEventManager } from '../EventManager'

type RemediationEventAction =
  | 'remediation_started'
  | 'remediation_succeeded'
  | 'remediation_failed'
  | 'remediation_requires_reboot'
  | 'remediation_cancelled'

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

    // Atomic claim-and-run: create the resolution and take the recommendation's
    // active-resolution slot in the same transaction, using the affected-row count
    // as a compare-and-set. This closes the TOCTOU window between the idempotency
    // read above and this write — two concurrent resolve() calls could otherwise
    // both observe a free/terminal slot and both spawn a destructive handler (double
    // reboot / double install). We rely on the row lock updateMany takes under the
    // default READ COMMITTED isolation: the losing writer blocks on the row, then
    // re-evaluates the WHERE against the winner's committed row and gets count 0.
    let resolution: RecommendationResolution
    try {
      resolution = await this.prisma.$transaction(async (tx) => {
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
        const claim = await tx.vMRecommendation.updateMany({
          where: {
            id: recommendationId,
            // Only claim when the slot is free or still holds a terminal resolution
            // (REQUIRES_REBOOT / CANCELLED leave activeResolutionId set but must stay
            // re-claimable — matching the line-61 idempotency semantics).
            OR: [
              { activeResolutionId: null },
              {
                activeResolution: {
                  status: {
                    in: [
                      ResolutionStatus.SUCCEEDED,
                      ResolutionStatus.FAILED,
                      ResolutionStatus.CANCELLED,
                      ResolutionStatus.REQUIRES_REBOOT
                    ]
                  }
                }
              }
            ]
          },
          data: { activeResolutionId: created.id }
        })
        if (claim.count === 0) {
          // A concurrent resolve() already won the slot; roll back this transaction
          // (which discards `created`) and return the winner's resolution below.
          throw new ResolutionRaceLostError()
        }
        return created
      })
    } catch (err) {
      if (err instanceof ResolutionRaceLostError) {
        // Lost the claim race: return the winner's in-flight resolution instead of
        // spawning a second handler, preserving the documented idempotency contract.
        const fresh = await this.prisma.vMRecommendation.findUnique({
          where: { id: recommendationId },
          include: { activeResolution: true }
        })
        if (fresh?.activeResolution && !isTerminalStatus(fresh.activeResolution.status)) {
          this.debug.info(`Lost claim race for recommendation ${recommendationId}; returning in-flight resolution ${fresh.activeResolution.id}`)
          return fresh.activeResolution
        }
        throw new Error('Another resolution is already in progress for this recommendation')
      }
      throw err
    }

    // Fire-and-forget: run the handler asynchronously
    void this.runHandler(handler, resolution.id, rec, params ?? {}, userId)
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

    const cancelled = await this.prisma.recommendationResolution.update({
      where: { id: resolutionId },
      data: { status: ResolutionStatus.CANCELLED, completedAt: new Date() }
    })

    await this.emitRemediation('remediation_cancelled', cancelled.machineId, {
      recommendationId: cancelled.recommendationId,
      resolutionId: cancelled.id,
      status: 'cancelled'
    }, userId)

    return cancelled
  }

  /**
   * Error-isolated emit of a user-initiated remediation lifecycle event.
   * A socket/emit failure must never break the resolution flow.
   */
  private async emitRemediation (
    action: RemediationEventAction,
    vmId: string,
    result: Record<string, unknown>,
    triggeredBy?: string
  ): Promise<void> {
    try {
      await getEventManager().dispatchEvent('vms', action, { id: vmId, result }, triggeredBy)
    } catch (e: any) {
      this.debug.error(`Failed to emit ${action} for vm ${vmId}: ${e?.message || e}`)
    }
  }

  private async runHandler (
    handler: ResolutionHandler,
    resolutionId: string,
    rec: VMRecommendation & { machine: { id: string; userId: string | null; name: string; os: string } },
    params: Record<string, unknown>,
    triggeredBy?: string
  ): Promise<void> {
    const prisma = this.prisma
    const update = async (patch: Prisma.RecommendationResolutionUpdateInput): Promise<void> => {
      await prisma.recommendationResolution.update({ where: { id: resolutionId }, data: patch })
    }

    const description = rec.text ?? rec.actionText ?? handler.actionKey

    await update({ status: ResolutionStatus.RUNNING, startedAt: new Date(), progress: 5 })

    await this.emitRemediation('remediation_started', rec.machineId, {
      description,
      actionKey: handler.actionKey,
      recommendationId: rec.id,
      resolutionId,
      status: 'running'
    }, triggeredBy)

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

      // If the resolution was cancelled (or otherwise reached a terminal state)
      // while the handler was running, do not overwrite it or emit a
      // contradictory toast.
      const current = await prisma.recommendationResolution.findUnique({
        where: { id: resolutionId },
        select: { status: true }
      })
      if (current && isTerminalStatus(current.status)) {
        this.debug.info(`Resolution ${resolutionId} already ${current.status}; skipping final success update/emit`)
        return
      }

      await update({
        status: finalStatus,
        progress: 100,
        progressMessage: result.message ?? null,
        result: (result.data ?? undefined) as any,
        completedAt: new Date()
      })
      // Auto-dismiss on success; keep visible when reboot still required.
      // Also set a suppression window (snoozedUntil) so the recommendation does
      // not immediately re-materialize on the next ~1-min health scan before the
      // guest's own state (e.g. installed OS updates) has caught up. Window
      // defaults to 30 minutes, overridable via RECOMMENDATION_SUPPRESSION_MINUTES.
      if (finalStatus === ResolutionStatus.SUCCEEDED) {
        const suppressionMinutes = Number(process.env.RECOMMENDATION_SUPPRESSION_MINUTES) || 30
        await prisma.vMRecommendation.update({
          where: { id: rec.id },
          data: {
            dismissedAt: new Date(),
            snoozedUntil: new Date(Date.now() + suppressionMinutes * 60 * 1000),
            activeResolutionId: null
          }
        })
      }

      await this.emitRemediation(
        finalStatus === ResolutionStatus.REQUIRES_REBOOT ? 'remediation_requires_reboot' : 'remediation_succeeded',
        rec.machineId,
        {
          description,
          reason: result.message ?? undefined,
          actionKey: handler.actionKey,
          recommendationId: rec.id,
          resolutionId,
          status: finalStatus === ResolutionStatus.REQUIRES_REBOOT ? 'requires-reboot' : 'succeeded',
          requiresReboot: !!result.requiresReboot
        },
        triggeredBy
      )
    } catch (err: any) {
      this.debug.error(`Handler for ${handler.actionKey} failed on rec ${rec.id}: ${err?.message || err}`)

      // Don't clobber a cancellation (or other terminal state) reached while the
      // handler was running, nor emit a contradictory failure toast. The re-read
      // is defensive: any error here falls through to the normal failure path.
      try {
        const current = await prisma.recommendationResolution.findUnique({
          where: { id: resolutionId },
          select: { status: true }
        })
        if (current && isTerminalStatus(current.status)) {
          this.debug.info(`Resolution ${resolutionId} already ${current.status}; skipping final failure update/emit`)
          return
        }
      } catch (reReadErr: any) {
        this.debug.error(`Failed to re-read status for resolution ${resolutionId}: ${reReadErr?.message || reReadErr}`)
      }

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

      await this.emitRemediation('remediation_failed', rec.machineId, {
        description,
        reason: err?.message ?? String(err),
        actionKey: handler.actionKey,
        recommendationId: rec.id,
        resolutionId,
        status: 'failed'
      }, triggeredBy)
    }
  }
}

/**
 * Internal sentinel thrown to roll back the claim transaction when a concurrent
 * resolve() has already taken the recommendation's active-resolution slot. Never
 * surfaced to callers — it is caught and translated to the winner's resolution.
 */
class ResolutionRaceLostError extends Error {
  constructor () {
    super('recommendation resolution slot already claimed')
    this.name = 'ResolutionRaceLostError'
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
