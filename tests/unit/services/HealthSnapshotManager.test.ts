/**
 * Unit tests for HealthSnapshotManager.
 *
 * All dependencies (repository, eventManager, prisma, recommendationService)
 * are injected through the constructor, so we mock them directly.
 *
 * TypeScript notes:
 *  - `as any` is used when mocking Prisma return values because the generated
 *    Prisma types require all columns (including defaults like id, createdAt, etc.)
 *  - `(mockPrisma.vMHealthCheckQueue.groupBy as any).mockResolvedValue(...)` is
 *    needed because jest-mock-extended's DeepMockProxy doesn't expose mock helpers
 *    on Prisma's overloaded `groupBy` delegate.
 */

import { HealthSnapshotManager } from '../../../app/services/HealthSnapshotManager'
import { VMHealthQueueRepository } from '../../../app/services/VMHealthQueueRepository'
import { EventManager } from '../../../app/services/EventManager'
import { VMRecommendationService } from '../../../app/services/VMRecommendationService'
import { HealthCheckType, PrismaClient } from '@prisma/client'
import type { CommandResponse } from '../../../app/services/VirtioSocketWatcherService'
import { mock, mockDeep, DeepMockProxy } from 'jest-mock-extended'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSuccessResponse(data?: unknown): CommandResponse {
  return {
    id: 'resp-1',
    success: true,
    exit_code: 0,
    stdout: '{}',
    execution_time_ms: 500,
    command_type: 'safe',
    data: data ?? { someKey: 'someValue' },
  }
}

function makeSnapshot(overrides?: Record<string, unknown>) {
  return {
    id: 'snapshot-1',
    machineId: 'vm-1',
    snapshotDate: new Date(),
    overallStatus: 'PENDING',
    checksCompleted: 0,
    checksFailed: 0,
    executionTimeMs: 0,
    customCheckResults: null as unknown,
    applicationInventory: null as unknown,
    ...overrides,
  }
}

/**
 * Set up the mock chain needed for updateSnapshotOverallStatus to complete
 * without errors. Called after each test's specific mock setup.
 */
function stubOverallStatusDeps(
  mockPrisma: DeepMockProxy<PrismaClient>,
  mockRecommendationService: jest.Mocked<VMRecommendationService>,
  groupByResult: unknown[] = [],
) {
  ;(mockPrisma.vMHealthCheckQueue.groupBy as any).mockResolvedValue(groupByResult)
  mockRecommendationService.generateRecommendations.mockResolvedValue([])
  mockPrisma.vMRecommendation.count.mockResolvedValue(0)
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('HealthSnapshotManager', () => {
  let manager: HealthSnapshotManager
  let mockRepository: jest.Mocked<VMHealthQueueRepository>
  let mockEventManager: jest.Mocked<EventManager>
  let mockPrisma: DeepMockProxy<PrismaClient>
  let mockRecService: jest.Mocked<VMRecommendationService>

  beforeEach(() => {
    mockRepository = mock<VMHealthQueueRepository>()
    mockEventManager = mock<EventManager>()
    mockPrisma = mockDeep<PrismaClient>()
    mockRecService = mock<VMRecommendationService>()

    manager = new HealthSnapshotManager(
      mockRepository,
      mockEventManager,
      mockPrisma as unknown as PrismaClient,
      mockRecService,
    )
  })

  // ─── storeSuccess ────────────────────────────────────────────────────────

  describe('storeSuccess', () => {
    it('delegates to storeHealthSnapshot', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeSuccess('vm-1', 'DISK_SPACE' as HealthCheckType, makeSuccessResponse(), 100)

      expect(mockRepository.findTodaySnapshot).toHaveBeenCalledWith('vm-1')
      expect(mockRepository.appendSnapshotResult).toHaveBeenCalled()
    })
  })

  // ─── storeHealthSnapshot ─────────────────────────────────────────────────

  describe('storeHealthSnapshot', () => {
    it('creates a fallback snapshot when none exists', async () => {
      const newSnapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(null as any)
      mockRepository.createSnapshot.mockResolvedValue(newSnapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(newSnapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(newSnapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'DISK_SPACE' as HealthCheckType,
        makeSuccessResponse({ disks: [{ free: 50 }] }), 200,
      )

      expect(mockRepository.createSnapshot).toHaveBeenCalledWith('vm-1', expect.objectContaining({
        createdBy: 'storeHealthSnapshot-fallback',
      }))
      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 200,
        expect.objectContaining({ diskSpaceInfo: { disks: [{ free: 50 }] } }),
      )
    })

    it('reuses existing snapshot when found', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'DISK_SPACE' as HealthCheckType,
        makeSuccessResponse({ free: 80 }), 150,
      )

      expect(mockRepository.createSnapshot).not.toHaveBeenCalled()
      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 150, expect.objectContaining({ diskSpaceInfo: { free: 80 } }),
      )
    })

    it('stores RESOURCE_OPTIMIZATION data in resourceOptInfo', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'RESOURCE_OPTIMIZATION' as HealthCheckType,
        makeSuccessResponse({ cpu: 45 }), 300,
      )

      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 300, expect.objectContaining({ resourceOptInfo: { cpu: 45 } }),
      )
    })

    it('stores WINDOWS_UPDATES data in windowsUpdateInfo', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'WINDOWS_UPDATES' as HealthCheckType,
        makeSuccessResponse({ pending: 3 }), 400,
      )

      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 400, expect.objectContaining({ windowsUpdateInfo: { pending: 3 } }),
      )
    })

    it('stores LINUX_UPDATES data in linuxUpdateInfo', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'LINUX_UPDATES' as HealthCheckType,
        makeSuccessResponse({ updates: 5 }), 350,
      )

      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 350, expect.objectContaining({ linuxUpdateInfo: { updates: 5 } }),
      )
    })

    it('stores WINDOWS_DEFENDER data in defenderStatus', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'WINDOWS_DEFENDER' as HealthCheckType,
        makeSuccessResponse({ enabled: true }), 250,
      )

      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 250, expect.objectContaining({ defenderStatus: { enabled: true } }),
      )
    })

    it('stores APPLICATION_INVENTORY data in applicationInventory', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'APPLICATION_INVENTORY' as HealthCheckType,
        makeSuccessResponse({ apps: ['app1'] }), 600,
      )

      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 600, expect.objectContaining({ applicationInventory: { apps: ['app1'] } }),
      )
    })

    it('calls mergeApplicationUpdates for APPLICATION_UPDATES check type', async () => {
      const snapshot = makeSnapshot({
        applicationInventory: { applications: [{ name: 'Chrome', version: '100' }] },
      })
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      const updateData = {
        applications: [{
          name: 'Chrome',
          update_available: true,
          new_version: '101',
          is_security_update: false,
          update_source: 'google',
          update_size_bytes: 50000000,
          update_metadata: { url: 'https://...' },
        }],
      }

      await manager.storeHealthSnapshot(
        'vm-1', 'APPLICATION_UPDATES' as HealthCheckType,
        makeSuccessResponse(updateData), 700,
      )

      // mergeApplicationUpdates reads the snapshot's inventory via prisma
      expect(mockPrisma.vMHealthSnapshot.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'snapshot-1' } }),
      )
      // The appendSnapshotResult call should NOT contain applicationInventory
      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 700,
        expect.not.objectContaining({ applicationInventory: expect.anything() }),
      )
    })

    it('increments checksCompleted and accumulates executionTimeMs', async () => {
      const snapshot = makeSnapshot({ executionTimeMs: 300 })
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockRepository.appendSnapshotResult.mockResolvedValue(undefined)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeHealthSnapshot(
        'vm-1', 'DISK_SPACE' as HealthCheckType,
        makeSuccessResponse(), 200,
      )

      expect(mockRepository.appendSnapshotResult).toHaveBeenCalledWith(
        'snapshot-1', 200,
        expect.objectContaining({
          checksCompleted: { increment: 1 },
          executionTimeMs: 500, // 300 existing + 200 new
        }),
      )
    })
  })

  // ─── storeFailure ────────────────────────────────────────────────────────

  describe('storeFailure', () => {
    it('creates a new snapshot via prisma when none exists', async () => {
      const newSnapshot = makeSnapshot({ id: 'snap-new' })
      mockRepository.findTodaySnapshot.mockResolvedValue(null as any)
      mockPrisma.vMHealthSnapshot.create.mockResolvedValue(newSnapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(newSnapshot as any)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(newSnapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeFailure('vm-1', 'DISK_SPACE' as HealthCheckType, 100)

      expect(mockPrisma.vMHealthSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          machineId: 'vm-1',
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
        }),
      })
    })

    it('increments checksFailed and executionTimeMs on existing snapshot', async () => {
      const snapshot = makeSnapshot({ executionTimeMs: 200 })
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeFailure('vm-1', 'DISK_SPACE' as HealthCheckType, 150)

      // First update call is the failure increment
      expect(mockPrisma.vMHealthSnapshot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'snapshot-1' },
          data: expect.objectContaining({
            checksFailed: { increment: 1 },
            executionTimeMs: 350,
          }),
        }),
      )
    })

    it('calls updateSnapshotOverallStatus after storing failure', async () => {
      const snapshot = makeSnapshot()
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      stubOverallStatusDeps(mockPrisma, mockRecService)

      await manager.storeFailure('vm-1', 'DISK_SPACE' as HealthCheckType, 100)

      // updateSnapshotOverallStatus calls findUnique on prisma snapshot
      expect(mockPrisma.vMHealthSnapshot.findUnique).toHaveBeenCalled()
    })
  })

  // ─── getOrCreateTodaySnapshot ────────────────────────────────────────────

  describe('getOrCreateTodaySnapshot', () => {
    it('creates a new snapshot with metadata when none exists', async () => {
      const newSnapshot = makeSnapshot({ id: 'snap-new' })
      mockRepository.findTodaySnapshot.mockResolvedValue(null as any)
      mockPrisma.vMHealthSnapshot.create.mockResolvedValue(newSnapshot as any)

      const result = await manager.getOrCreateTodaySnapshot('vm-1', 4, [
        'DISK_SPACE' as HealthCheckType,
        'RESOURCE_OPTIMIZATION' as HealthCheckType,
      ])

      expect(result).toEqual({ id: 'snap-new' })
      expect(mockPrisma.vMHealthSnapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          machineId: 'vm-1',
          overallStatus: 'PENDING',
          customCheckResults: expect.objectContaining({
            expectedChecks: 4,
            scheduledCheckTypes: ['DISK_SPACE', 'RESOURCE_OPTIMIZATION'],
            createdFor: 'snapshot-scoped-tracking',
          }),
        }),
      })
    })

    it('returns existing snapshot without update when metadata already present', async () => {
      const snapshot = makeSnapshot({
        customCheckResults: { expectedChecks: 4, scheduledCheckTypes: ['DISK_SPACE'] },
      })
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)

      const result = await manager.getOrCreateTodaySnapshot('vm-1', 3, [
        'DISK_SPACE' as HealthCheckType,
      ])

      expect(result).toEqual({ id: 'snapshot-1' })
      expect(mockPrisma.vMHealthSnapshot.create).not.toHaveBeenCalled()
      expect(mockPrisma.vMHealthSnapshot.update).not.toHaveBeenCalled()
    })

    it('updates existing snapshot with metadata when missing expectedChecks', async () => {
      const snapshot = makeSnapshot({ customCheckResults: { someOtherField: true } })
      mockRepository.findTodaySnapshot.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)

      const result = await manager.getOrCreateTodaySnapshot('vm-1', 5, [
        'WINDOWS_UPDATES' as HealthCheckType,
      ])

      expect(result).toEqual({ id: 'snapshot-1' })
      expect(mockPrisma.vMHealthSnapshot.update).toHaveBeenCalledWith({
        where: { id: 'snapshot-1' },
        data: {
          customCheckResults: expect.objectContaining({
            expectedChecks: 5,
            scheduledCheckTypes: ['WINDOWS_UPDATES'],
            updatedFor: 'snapshot-scoped-tracking',
          }),
        },
      })
    })
  })

  // ─── updateSnapshotOverallStatus ─────────────────────────────────────────

  describe('updateSnapshotOverallStatus', () => {
    it('sets HEALTHY when all expected checks pass with no failures', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 4, checksFailed: 0,
        customCheckResults: { expectedChecks: 4 },
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue([])

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      const statusCall = mockPrisma.vMHealthSnapshot.update.mock.calls.find(
        c => (c[0] as any).data?.overallStatus !== undefined,
      )
      expect(statusCall).toBeDefined()
      expect((statusCall![0] as any).data.overallStatus).toBe('HEALTHY')
    })

    it('sets WARNING when some checks fail but more pass', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 3, checksFailed: 1,
        customCheckResults: { expectedChecks: 4 },
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue([])

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      const statusCall = mockPrisma.vMHealthSnapshot.update.mock.calls.find(
        c => (c[0] as any).data?.overallStatus !== undefined,
      )
      expect(statusCall).toBeDefined()
      expect((statusCall![0] as any).data.overallStatus).toBe('WARNING')
    })

    it('sets CRITICAL when failures >= completed checks', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 1, checksFailed: 3,
        customCheckResults: { expectedChecks: 4 },
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue([])

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      const statusCall = mockPrisma.vMHealthSnapshot.update.mock.calls.find(
        c => (c[0] as any).data?.overallStatus !== undefined,
      )
      expect(statusCall).toBeDefined()
      expect((statusCall![0] as any).data.overallStatus).toBe('CRITICAL')
    })

    it('sets CRITICAL when all checks fail', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 0, checksFailed: 4,
        customCheckResults: { expectedChecks: 4 },
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue([])

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      const statusCall = mockPrisma.vMHealthSnapshot.update.mock.calls.find(
        c => (c[0] as any).data?.overallStatus !== undefined,
      )
      expect(statusCall).toBeDefined()
      expect((statusCall![0] as any).data.overallStatus).toBe('CRITICAL')
    })

    it('keeps PENDING when not all expected checks complete', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 2, checksFailed: 0,
        customCheckResults: { expectedChecks: 6 },
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      const statusCall = mockPrisma.vMHealthSnapshot.update.mock.calls.find(
        c => (c[0] as any).data?.overallStatus !== undefined,
      )
      expect(statusCall).toBeDefined()
      expect((statusCall![0] as any).data.overallStatus).toBe('PENDING')
    })

    it('does nothing when snapshot not found', async () => {
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(null)

      await manager.updateSnapshotOverallStatus('nonexistent', 'vm-1')

      expect(mockPrisma.vMHealthSnapshot.update).not.toHaveBeenCalled()
      expect(mockRecService.generateRecommendations).not.toHaveBeenCalled()
    })

    it('uses queue groupBy as fallback when no snapshot metadata', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 3, checksFailed: 0, customCheckResults: null,
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      ;(mockPrisma.vMHealthCheckQueue.groupBy as any).mockResolvedValue([
        { checkType: 'DISK_SPACE' }, { checkType: 'RESOURCE_OPTIMIZATION' },
        { checkType: 'WINDOWS_UPDATES' },
      ])
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue([])

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      expect(mockPrisma.vMHealthCheckQueue.groupBy).toHaveBeenCalled()
      const statusCall = mockPrisma.vMHealthSnapshot.update.mock.calls.find(
        c => (c[0] as any).data?.overallStatus !== undefined,
      )
      expect((statusCall![0] as any).data.overallStatus).toBe('HEALTHY')
    })

    it('triggers recommendation generation when all checks complete', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 4, checksFailed: 0,
        customCheckResults: { expectedChecks: 4 },
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue([
        { type: 'DISK_SPACE', severity: 'LOW' } as any,
      ])

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      expect(mockRecService.generateRecommendations).toHaveBeenCalledWith('vm-1', 'snapshot-1')
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'completed', expect.anything(),
      )
    })

    it('does not trigger recommendations when checks are incomplete', async () => {
      const snapshot = makeSnapshot({
        checksCompleted: 2, checksFailed: 0,
        customCheckResults: { expectedChecks: 6 },
      })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)

      await manager.updateSnapshotOverallStatus('snapshot-1', 'vm-1')

      expect(mockRecService.generateRecommendations).not.toHaveBeenCalled()
    })
  })

  // ─── generateRecommendationsForSnapshot ──────────────────────────────────

  describe('generateRecommendationsForSnapshot', () => {
    it('throws and dispatches failed event when recommendationService is null', async () => {
      const nullManager = new HealthSnapshotManager(
        mockRepository, mockEventManager,
        mockPrisma as unknown as PrismaClient,
        null as unknown as VMRecommendationService,
      )
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)

      await nullManager.generateRecommendationsForSnapshot('snapshot-1', 'vm-1')

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'failed',
        expect.objectContaining({ errorCategory: 'unknown' }),
      )
    })

    it('skips generation when recommendations already exist', async () => {
      mockPrisma.vMRecommendation.count.mockResolvedValue(5)

      await manager.generateRecommendationsForSnapshot('snapshot-1', 'vm-1')

      expect(mockRecService.generateRecommendations).not.toHaveBeenCalled()
    })

    it('generates recommendations and dispatches completed event', async () => {
      const recs = [
        { type: 'DISK_SPACE', severity: 'LOW' },
        { type: 'WINDOWS_UPDATES', severity: 'HIGH' },
      ]
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue(recs as any)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(makeSnapshot() as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(makeSnapshot() as any)

      await manager.generateRecommendationsForSnapshot('snapshot-1', 'vm-1')

      expect(mockRecService.generateRecommendations).toHaveBeenCalledWith('vm-1', 'snapshot-1')
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'started', expect.objectContaining({ machineId: 'vm-1' }),
      )
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'completed', expect.objectContaining({
          recommendationCount: 2,
          recommendationTypes: ['DISK_SPACE', 'WINDOWS_UPDATES'],
        }),
      )
    })

    it('dispatches failed event on generation error with database category', async () => {
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockRejectedValue(
        new Error('database connection lost'),
      )

      await manager.generateRecommendationsForSnapshot('snapshot-1', 'vm-1')

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'failed',
        expect.objectContaining({ errorCategory: 'database' }),
      )
    })

    it('dispatches failed event on generation error with network category', async () => {
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockRejectedValue(
        new Error('network timeout exceeded'),
      )

      await manager.generateRecommendationsForSnapshot('snapshot-1', 'vm-1')

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'failed',
        expect.objectContaining({ errorCategory: 'network' }),
      )
    })

    it('dispatches failed event on generation error with analysis category', async () => {
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockRejectedValue(
        new Error('analysis checker failed'),
      )

      await manager.generateRecommendationsForSnapshot('snapshot-1', 'vm-1')

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'failed',
        expect.objectContaining({ errorCategory: 'analysis' }),
      )
    })

    it('handles empty recommendations array', async () => {
      mockPrisma.vMRecommendation.count.mockResolvedValue(0)
      mockRecService.generateRecommendations.mockResolvedValue([])
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(makeSnapshot() as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(makeSnapshot() as any)

      await manager.generateRecommendationsForSnapshot('snapshot-1', 'vm-1')

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'recommendations', 'completed',
        expect.objectContaining({ recommendationCount: 0, recommendationTypes: [] }),
      )
    })
  })

  // ─── updateSnapshotRecommendationMetadata ────────────────────────────────

  describe('updateSnapshotRecommendationMetadata', () => {
    it('updates customCheckResults with recommendation count', async () => {
      const snapshot = makeSnapshot({ customCheckResults: { existingField: true } })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)

      await manager.updateSnapshotRecommendationMetadata('snapshot-1', 7)

      expect(mockPrisma.vMHealthSnapshot.update).toHaveBeenCalledWith({
        where: { id: 'snapshot-1' },
        data: {
          customCheckResults: expect.objectContaining({
            existingField: true,
            recommendationCount: 7,
            recommendationsGeneratedAt: expect.any(String),
            lastUpdated: expect.any(String),
          }),
        },
      })
    })

    it('handles missing snapshot gracefully', async () => {
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(null)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(makeSnapshot() as any)

      await manager.updateSnapshotRecommendationMetadata('nonexistent', 3)

      // Still updates with empty metadata (existing code doesn't null-check snapshot here)
      expect(mockPrisma.vMHealthSnapshot.update).toHaveBeenCalledWith({
        where: { id: 'nonexistent' },
        data: {
          customCheckResults: expect.objectContaining({ recommendationCount: 3 }),
        },
      })
    })
  })

  // ─── backfillSnapshotExpectedChecks ──────────────────────────────────────

  describe('backfillSnapshotExpectedChecks', () => {
    it('updates customCheckResults with expectedChecks and source', async () => {
      const snapshot = makeSnapshot({ customCheckResults: { foo: 'bar' } })
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(snapshot as any)
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue(snapshot as any)

      await manager.backfillSnapshotExpectedChecks('snapshot-1', 6, 'queue-grouped-by-day')

      expect(mockPrisma.vMHealthSnapshot.update).toHaveBeenCalledWith({
        where: { id: 'snapshot-1' },
        data: {
          customCheckResults: expect.objectContaining({
            foo: 'bar',
            expectedChecks: 6,
            backfilledFrom: 'queue-grouped-by-day',
            backfilledAt: expect.any(String),
          }),
        },
      })
    })

    it('does nothing when snapshot not found', async () => {
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue(null)

      await manager.backfillSnapshotExpectedChecks('nonexistent', 4, 'fallback')

      expect(mockPrisma.vMHealthSnapshot.update).not.toHaveBeenCalled()
    })
  })
})
