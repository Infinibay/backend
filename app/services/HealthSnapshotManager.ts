import logger from '@main/logger'
import { PrismaClient, HealthCheckType } from '@prisma/client'
import { EventManager } from './EventManager'
import { VMHealthQueueRepository } from './VMHealthQueueRepository'
import { VMRecommendationService } from './VMRecommendationService'
import type { CommandResponse } from './VirtioSocketWatcherService'

// ─── Constants (imported from HealthCheckExecutor so this is the single source) ─────

import {
  DEFAULT_MAX_ATTEMPTS,
  BACKOFF_MULTIPLIER,
  MAX_BACKOFF_MS,
} from './HealthCheckExecutor'

// ─── HealthSnapshotManager ────────────────────────────────────────────────────────

/**
 * Manages the health snapshot lifecycle: storing results, merging application
 * updates, computing overall status, backfilling metadata, and triggering
 * recommendation generation.
 *
 * All DB access goes through the injected repository; the EventManager is
 * injected for testability.
 */
export class HealthSnapshotManager {
  constructor(
    private readonly repository: VMHealthQueueRepository,
    private readonly eventManager: EventManager,
    private readonly prisma: PrismaClient,
    private readonly recommendationService: VMRecommendationService,
  ) {}

  // ─── Public snapshot-store interface ─────────────────────────────────────────

  /**
   * Called by HealthCheckExecutor after a successful health-check result.
   * Best-effort: errors are swallowed so they don't break the health-check flow.
   */
  async storeSuccess(
    machineId: string,
    checkType: HealthCheckType,
    result: CommandResponse,
    executionTimeMs: number,
  ): Promise<void> {
    await this.storeHealthSnapshot(machineId, checkType, result, executionTimeMs)
  }

  // ─── Snapshot CRUD ────────────────────────────────────────────────────────────

  /**
   * Store a health-check result in today's snapshot.
   * Creates a fallback snapshot if none exists for today.
   */
  async storeHealthSnapshot(
    machineId: string,
    checkType: HealthCheckType,
    result: CommandResponse,
    executionTimeMs: number,
  ): Promise<void> {
    let snapshot = await this.repository.findTodaySnapshot(machineId)

    if (!snapshot) {
      snapshot = await this.repository.createSnapshot(machineId, {
        createdBy: 'storeHealthSnapshot-fallback',
        timestamp: new Date().toISOString(),
        note: 'Created without snapshot-scoped expectedChecks - may need backfill',
      })
      logger.info(
        `\u26a0\ufe0f Created fallback snapshot ${snapshot.id} for VM ${machineId} ` +
        'via storeHealthSnapshot - consider using getOrCreateTodaySnapshot()',
      )
    }

    const updateData: Record<string, unknown> = {
      checksCompleted: { increment: 1 },
      executionTimeMs: (snapshot.executionTimeMs || 0) + executionTimeMs,
    }

    switch (checkType) {
    case 'DISK_SPACE':
      updateData.diskSpaceInfo = result.data
      break
    case 'RESOURCE_OPTIMIZATION':
      updateData.resourceOptInfo = result.data
      break
    case 'WINDOWS_UPDATES':
      updateData.windowsUpdateInfo = result.data
      break
    case 'LINUX_UPDATES':
      updateData.linuxUpdateInfo = result.data
      break
    case 'WINDOWS_DEFENDER':
      updateData.defenderStatus = result.data
      break
    case 'APPLICATION_INVENTORY':
      updateData.applicationInventory = result.data
      break
    case 'APPLICATION_UPDATES':
      // Merge APPLICATION_UPDATES data into existing inventory to avoid overwriting
      await this.mergeApplicationUpdates(snapshot.id, result.data)
      break
    }

    await this.repository.appendSnapshotResult(snapshot.id, executionTimeMs, updateData)
    await this.updateSnapshotOverallStatus(snapshot.id, machineId)
  }

  /**
   * Update the snapshot with failure information.
   */
  async storeFailure(
    machineId: string,
    checkType: HealthCheckType,
    executionTimeMs: number,
  ): Promise<void> {
    let snapshot = await this.repository.findTodaySnapshot(machineId)

    if (!snapshot) {
      snapshot = await this.prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
        },
      })
    }

    await this.prisma.vMHealthSnapshot.update({
      where: { id: snapshot.id },
      data: {
        checksFailed: { increment: 1 },
        executionTimeMs: (snapshot.executionTimeMs || 0) + executionTimeMs,
      },
    })

    await this.updateSnapshotOverallStatus(snapshot.id, machineId)
  }

  /**
   * Get or create today's snapshot with snapshot-scoped expected checks.
   */
  async getOrCreateTodaySnapshot(
    machineId: string,
    expectedChecks: number,
    scheduledCheckTypes: HealthCheckType[],
  ): Promise<{ id: string }> {
    let snapshot = await this.repository.findTodaySnapshot(machineId)

    if (!snapshot) {
      const snapshotMetadata = {
        expectedChecks,
        scheduledCheckTypes,
        createdFor: 'snapshot-scoped-tracking',
        timestamp: new Date().toISOString(),
      }

      snapshot = await this.prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
          customCheckResults: snapshotMetadata,
        },
      })

      logger.info(
        `\ud83d\udcca Created snapshot ${snapshot.id} for VM ${machineId} ` +
        `with ${expectedChecks} expected checks: ${scheduledCheckTypes.join(', ')}`,
      )
    } else {
      const existingMetadata = (snapshot.customCheckResults as Record<string, unknown>) || {}
      if (!existingMetadata?.expectedChecks) {
        const updatedMetadata = {
          ...existingMetadata,
          expectedChecks,
          scheduledCheckTypes,
          updatedFor: 'snapshot-scoped-tracking',
          timestamp: new Date().toISOString(),
        }

        await this.prisma.vMHealthSnapshot.update({
          where: { id: snapshot.id },
          data: { customCheckResults: updatedMetadata },
        })

        logger.info(
          `\ud83d\udcca Updated snapshot ${snapshot.id} for VM ${machineId} ` +
          `with ${expectedChecks} expected checks: ${scheduledCheckTypes.join(', ')}`,
        )
      }
    }

    return { id: snapshot.id }
  }

  // ─── Application update merging ───────────────────────────────────────────────

  /**
   * Merge APPLICATION_UPDATES data into existing applicationInventory.
   * Preserves full inventory while enriching apps with update metadata.
   */
  private async mergeApplicationUpdates(
    snapshotId: string,
    updateData: unknown,
  ): Promise<void> {
    try {
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId },
        select: { applicationInventory: true },
      })

      if (!snapshot) {
        logger.warn(
          `\u26a0\ufe0f Snapshot ${snapshotId} not found for APPLICATION_UPDATES merge`,
        )
        return
      }

      interface ApplicationInventory {
        applications?: Array<Record<string, unknown>>
        summary?: unknown
        lastInventoryCheck?: string
        lastUpdateCheck?: string
      }

      let existingInventory: ApplicationInventory = { applications: [] }
      if (snapshot.applicationInventory) {
        existingInventory =
          typeof snapshot.applicationInventory === 'string'
            ? JSON.parse(snapshot.applicationInventory)
            : (snapshot.applicationInventory as ApplicationInventory)
      }

      const updateInventory =
        typeof updateData === 'string'
          ? JSON.parse(updateData)
          : (updateData as ApplicationInventory)

      if (!updateInventory?.applications || !Array.isArray(updateInventory.applications)) {
        logger.warn(
          `\u26a0\ufe0f Invalid APPLICATION_UPDATES data format for snapshot ${snapshotId}`,
        )
        return
      }

      // Bound the number of applications a single (possibly-hostile) guest agent
      // can push in one update: an unbounded list would bloat the persisted
      // snapshot JSON blob and the in-memory merge maps. A real inventory is far
      // below this cap; truncate rather than reject so a legitimate-but-large host
      // still records its first MAX_APPS entries.
      const MAX_APPS = Number(process.env.HEALTH_MAX_APPS) || 5000
      if (updateInventory.applications.length > MAX_APPS) {
        logger.warn(
          `\u26a0\ufe0f APPLICATION_UPDATES for snapshot ${snapshotId} exceeds MAX_APPS ` +
          `(${updateInventory.applications.length} > ${MAX_APPS}) \u2014 truncating`,
        )
        updateInventory.applications = updateInventory.applications.slice(0, MAX_APPS)
      }

      const updateMap = new Map<string, Record<string, unknown>>()
      for (const app of updateInventory.applications) {
        const appKey = (app.name || app.app_name) as string
        if (appKey) {
          updateMap.set(appKey.toLowerCase(), app)
        }
      }

      const existingApps = existingInventory.applications || []
      let mergedApps: Array<Record<string, unknown>>

      if (existingApps.length === 0) {
        mergedApps = updateInventory.applications
        logger.info(
          `\ud83d\udce6 No existing inventory for snapshot ${snapshotId}, ` +
          `using APPLICATION_UPDATES data (${mergedApps.length} apps)`,
        )
      } else {
        mergedApps = existingApps.map(app => {
          const appKey = ((app.name || app.app_name) as string)?.toLowerCase()
          const updateInfo = appKey ? updateMap.get(appKey) : null

          if (updateInfo) {
            return {
              ...app,
              update_available: updateInfo.update_available,
              new_version: updateInfo.new_version,
              is_security_update: updateInfo.is_security_update,
              update_source: updateInfo.update_source,
              update_size_bytes: updateInfo.update_size_bytes,
              update_metadata: updateInfo.update_metadata,
            }
          }
          return app
        })

        const updatedCount = mergedApps.filter(app => app.update_available).length
        logger.info(
          `\ud83d\udce6 Merged APPLICATION_UPDATES into inventory for snapshot ${snapshotId}: ` +
          `${updatedCount}/${mergedApps.length} apps have updates`,
        )
      }

      const mergedInventory: ApplicationInventory = {
        applications: mergedApps,
        summary: updateInventory.summary || existingInventory.summary,
        lastInventoryCheck: existingInventory.lastInventoryCheck,
        lastUpdateCheck: new Date().toISOString(),
      }

      await this.prisma.vMHealthSnapshot.update({
        where: { id: snapshotId },
        data: { applicationInventory: mergedInventory as any },
      })
    } catch (error) {
      logger.error(
        `\u274c Failed to merge APPLICATION_UPDATES for snapshot ${snapshotId}:`,
        error,
      )
    }
  }

  // ─── Overall status computation ───────────────────────────────────────────────

  /**
   * Update snapshot overall status based on completed/failed checks.
   * Triggers recommendation generation when all expected checks are done.
   */
  async updateSnapshotOverallStatus(
    snapshotId: string,
    machineId: string,
  ): Promise<void> {
    try {
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId },
      })

      if (!snapshot) {
        logger.warn(
          `\u26a0\ufe0f Snapshot ${snapshotId} not found for status update`,
        )
        return
      }

      const totalChecks = snapshot.checksCompleted + snapshot.checksFailed
      const { expectedChecks, expectedChecksSource } =
        await this.computeExpectedChecks(snapshot, machineId, snapshotId)

      let overallStatus = 'PENDING'
      if (totalChecks >= expectedChecks) {
        if (snapshot.checksFailed === 0) {
          overallStatus = 'HEALTHY'
        } else if (snapshot.checksFailed < snapshot.checksCompleted) {
          overallStatus = 'WARNING'
        } else {
          overallStatus = 'CRITICAL'
        }
      }

      await this.prisma.vMHealthSnapshot.update({
        where: { id: snapshotId },
        data: { overallStatus },
      })

      logger.info(
        `\ud83d\udcca Updated snapshot ${snapshotId} status to ${overallStatus} ` +
        `(${totalChecks}/${expectedChecks} checks complete, ${snapshot.checksFailed} failed) ` +
        `[source: ${expectedChecksSource}]`,
      )

      if (totalChecks >= expectedChecks) {
        logger.info(
          `\ud83c\udfc1 All health checks complete for VM ${machineId} snapshot ${snapshotId}, ` +
          `triggering recommendation generation [expectedChecks source: ${expectedChecksSource}]`,
        )
        await this.generateRecommendationsForSnapshot(snapshotId, machineId)
      }
    } catch (error) {
      logger.error(
        `\u274c Failed to update snapshot overall status for ${snapshotId}:`,
        error,
      )
    }
  }

  /**
   * Compute expectedChecks using snapshot metadata first, then queue fallback.
   */
  private async computeExpectedChecks(
    snapshot: { customCheckResults: unknown },
    machineId: string,
    snapshotId: string,
  ): Promise<{ expectedChecks: number; expectedChecksSource: string }> {
    const metadata = snapshot.customCheckResults as Record<string, unknown> | undefined

    if (metadata?.expectedChecks && typeof metadata.expectedChecks === 'number') {
      return {
        expectedChecks: metadata.expectedChecks as number,
        expectedChecksSource: 'snapshot-metadata',
      }
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

    const scheduledChecksCount = await this.prisma.vMHealthCheckQueue.groupBy({
      by: ['checkType'],
      where: {
        machineId,
        createdAt: { gte: today, lt: tomorrow },
        status: { in: ['PENDING', 'RETRY_SCHEDULED', 'RUNNING', 'COMPLETED', 'FAILED'] },
      },
    })

    if (scheduledChecksCount.length > 0) {
      const expectedChecks = scheduledChecksCount.length
      await this.backfillSnapshotExpectedChecks(snapshotId, expectedChecks, 'queue-grouped-by-day')
      return { expectedChecks, expectedChecksSource: 'queue-grouped-by-day' }
    }

    const expectedChecks = this.getEnabledCheckTypes().length || 6
    await this.backfillSnapshotExpectedChecks(snapshotId, expectedChecks, 'fallback-config')
    return { expectedChecks, expectedChecksSource: 'fallback-config' }
  }

  // ─── Recommendation generation ────────────────────────────────────────────────

  /**
   * Generate recommendations for a completed health snapshot.
   * Best-effort: errors are swallowed to avoid breaking the health-check flow.
   */
  async generateRecommendationsForSnapshot(
    snapshotId: string,
    machineId: string,
  ): Promise<void> {
    const startTime = Date.now()
    const correlationId = `${machineId}-${snapshotId}-${Date.now()}`

    try {
      logger.info(
        `\ud83d\udca1 [${correlationId}] Starting recommendation generation for ` +
        `VM ${machineId} snapshot ${snapshotId}`,
      )

      if (!this.recommendationService) {
        throw new Error('VMRecommendationService not initialized')
      }

      const existingCount = await this.prisma.vMRecommendation.count({
        where: { snapshotId },
      })

      if (existingCount > 0) {
        logger.info(
          `\ud83d\udccb [${correlationId}] Recommendations already exist for snapshot ${snapshotId} ` +
          `(${existingCount} found), skipping generation`,
        )
        return
      }

      await this.eventManager.dispatchEvent('recommendations', 'started', {
        correlationId,
        machineId,
        snapshotId,
        startTime: new Date(),
      })

      const recommendations =
        await this.recommendationService.generateRecommendations(machineId, snapshotId)

      const generationTime = Date.now() - startTime
      const recommendationCount = recommendations?.length ?? 0
      const recommendationTypes = recommendations
        ? [...new Set(recommendations.map(r => r.type))]
        : []

      logger.info(
        `\ud83d\udca1 [${correlationId}] Generated ${recommendationCount} recommendations ` +
        `for VM ${machineId} snapshot ${snapshotId} (${generationTime}ms)`,
      )
      logger.info(
        `\ud83d\udca1 [${correlationId}] Recommendation types: ${recommendationTypes.join(', ')}`,
      )

      await this.eventManager.dispatchEvent('recommendations', 'completed', {
        correlationId,
        machineId,
        snapshotId,
        recommendationCount,
        recommendationTypes,
        generationTimeMs: generationTime,
        completedAt: new Date(),
      })

      await this.updateSnapshotRecommendationMetadata(snapshotId, recommendationCount)

      if (generationTime > 10_000) {
        logger.warn(
          `\u26a0\ufe0f [${correlationId}] Recommendation generation took longer than expected: ${generationTime}ms`,
        )
      }
    } catch (error) {
      const generationTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      let errorCategory = 'unknown'
      if (errorMessage.includes('database') || errorMessage.includes('connection')) {
        errorCategory = 'database'
      } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        errorCategory = 'network'
      } else if (errorMessage.includes('analysis') || errorMessage.includes('checker')) {
        errorCategory = 'analysis'
      }

      logger.error(
        `\u274c [${correlationId}] Failed to generate recommendations for VM ${machineId} ` +
        `[${errorCategory}]:`,
        error,
      )
      logger.error(
        `\u274c [${correlationId}] Generation time before failure: ${generationTime}ms`,
      )

      await this.eventManager.dispatchEvent('recommendations', 'failed', {
        correlationId,
        machineId,
        snapshotId,
        error: errorMessage,
        errorCategory,
        generationTimeMs: generationTime,
        failedAt: new Date(),
      })

      logger.info(
        `\ud83d\udd04 [${correlationId}] Continuing health check workflow despite ` +
        'recommendation generation failure',
      )
    }
  }

  // ─── Metadata helpers ────────────────────────────────────────────────────────

  /**
   * Update snapshot recommendation metadata for quick reads.
   */
  async updateSnapshotRecommendationMetadata(
    snapshotId: string,
    recommendationCount: number,
  ): Promise<void> {
    try {
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId },
        select: { customCheckResults: true },
      })

      const existingMetadata =
        ((snapshot?.customCheckResults as Record<string, unknown>) || {})

      const updatedMetadata = {
        ...existingMetadata,
        recommendationCount,
        recommendationsGeneratedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      }

      await this.prisma.vMHealthSnapshot.update({
        where: { id: snapshotId },
        data: { customCheckResults: updatedMetadata },
      })

      logger.info(
        `\ud83d\udcca Updated snapshot ${snapshotId} with recommendation metadata: ` +
        `${recommendationCount} recommendations generated`,
      )
    } catch (error) {
      logger.error(
        `\u274c Failed to update snapshot recommendation metadata for ${snapshotId}:`,
        error,
      )
    }
  }

  /**
   * Backfill expectedChecks in snapshot metadata for consistency.
   */
  async backfillSnapshotExpectedChecks(
    snapshotId: string,
    expectedChecks: number,
    source: string,
  ): Promise<void> {
    try {
      const snapshot = await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId },
        select: { customCheckResults: true },
      })

      if (!snapshot) return

      const existingMetadata =
        (snapshot.customCheckResults as Record<string, unknown>) || {}

      const updatedMetadata = {
        ...existingMetadata,
        expectedChecks,
        backfilledFrom: source,
        backfilledAt: new Date().toISOString(),
      }

      await this.prisma.vMHealthSnapshot.update({
        where: { id: snapshotId },
        data: { customCheckResults: updatedMetadata },
      })

      logger.info(
        `\ud83d\udccb Backfilled snapshot ${snapshotId} with expectedChecks: ` +
        `${expectedChecks} (source: ${source})`,
      )
    } catch (error) {
      logger.error(`\u274c Failed to backfill snapshot ${snapshotId}:`, error)
    }
  }

  /**
   * Get list of enabled check types from environment or defaults.
   */
  private getEnabledCheckTypes(): string[] {
    const defaultCheckTypes = [
      'OVERALL_STATUS',
      'DISK_SPACE',
      'RESOURCE_OPTIMIZATION',
      'WINDOWS_UPDATES',
      'WINDOWS_DEFENDER',
      'LINUX_UPDATES',
      'APPLICATION_INVENTORY',
      'APPLICATION_UPDATES',
    ]
    return (
      process.env.HEALTH_CHECK_ENABLED_TYPES?.split(',').map(c => c.trim()).filter(Boolean)
      ?? defaultCheckTypes
    )
  }
}
