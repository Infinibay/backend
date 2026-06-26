/**
 * BackupScheduleService — audit L145 (scheduled backup skipped when the VM is
 * running must be logged as info, not a failure) and audit H5 (retention must
 * never orphan an incremental chain: a base with surviving dependents is
 * deferred, not deleted).
 *
 * These tests white-box the private runScheduled/enforceRetention via `as any`
 * because that is exactly where the two guards live; the public surface only
 * reaches them through the cron tick.
 */
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { BackupType } from '@infinibay/infinization'

import { BackupScheduleService } from '@services/BackupScheduleService'
import { BackupService, VmBusyError, BackupDependencyError } from '@services/BackupService'
import { VmRunningError } from '@utils/assertVmStopped'
import logger from '@main/logger'

jest.mock('@services/EventManager', () => ({ getEventManager: () => null }))

// A no-op scheduler: we drive runScheduled directly, so handles never fire.
const fakeScheduler = {
  schedule: jest.fn(() => ({ stop: jest.fn(), getNextRunDate: () => new Date(Date.now() + 3600_000).toISOString() })),
  stop: jest.fn()
} as any

function makeSchedule (overrides: Partial<any> = {}): any {
  return {
    id: 'sched-1',
    scheduleId: 'sched-1',
    vmId: 'vm-1',
    type: BackupType.FULL,
    cronExpression: '0 * * * *',
    retentionCount: 2,
    destinationDir: '/backups/vm-1',
    compression: 'NONE',
    enabled: true,
    label: 'nightly',
    ...overrides
  }
}

describe('BackupScheduleService', () => {
  let prisma: DeepMockProxy<PrismaClient>
  let backupService: jest.Mocked<Pick<BackupService, 'createBackup' | 'deleteBackup' | 'findDependentBackupIds'>>
  let service: BackupScheduleService

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    backupService = {
      createBackup: jest.fn(),
      deleteBackup: jest.fn(),
      findDependentBackupIds: jest.fn().mockResolvedValue([])
    } as any
    service = new BackupScheduleService(prisma, backupService as unknown as BackupService, fakeScheduler)
    jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any)
  })

  afterEach(() => jest.restoreAllMocks())

  describe('runScheduled — VM-running skip (audit L145)', () => {
    it('logs a skip as INFO (not error) and still advances the schedule when the VM is busy', async () => {
      prisma.backupSchedule.findUnique.mockResolvedValue(makeSchedule())
      prisma.backupSchedule.update.mockResolvedValue(makeSchedule() as never)
      backupService.createBackup.mockRejectedValue(new VmBusyError('VM busy or not stopped'))

      await (service as any).runScheduled('sched-1')

      // Skipped, not failed: info logged, no error logged.
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/skipped: VM running\/busy/i))
      expect(logger.error).not.toHaveBeenCalledWith(expect.stringMatching(/Scheduled backup failed/i))
      // The schedule keeps progressing: lastRunAt + nextRunAt are advanced.
      expect(prisma.backupSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'sched-1' },
        data: expect.objectContaining({ lastRunAt: expect.any(Date) })
      }))
    })

    it('treats a VmRunningError (live-probe) the same as a benign skip', async () => {
      prisma.backupSchedule.findUnique.mockResolvedValue(makeSchedule())
      prisma.backupSchedule.update.mockResolvedValue(makeSchedule() as never)
      backupService.createBackup.mockRejectedValue(new VmRunningError('process alive'))

      await (service as any).runScheduled('sched-1')

      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/skipped: VM running\/busy/i))
      expect(logger.error).not.toHaveBeenCalledWith(expect.stringMatching(/Scheduled backup failed/i))
    })

    it('logs a genuine backup failure as ERROR (still advancing the schedule)', async () => {
      // Register the schedule so it has a live scheduler handle: computeNextRun
      // reads handles.get(id).getNextRunDate(), and only a registered schedule
      // yields a real nextRunAt Date (an unregistered one would advance to null).
      // start() loads enabled schedules from the DB and registers each.
      prisma.backupSchedule.findMany.mockResolvedValue([makeSchedule()] as never)
      await service.start()

      prisma.backupSchedule.findUnique.mockResolvedValue(makeSchedule())
      prisma.backupSchedule.update.mockResolvedValue(makeSchedule() as never)
      backupService.createBackup.mockRejectedValue(new Error('disk full'))

      await (service as any).runScheduled('sched-1')

      expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/Scheduled backup failed/i))
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringMatching(/skipped: VM running/i))
      expect(prisma.backupSchedule.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ nextRunAt: expect.anything() })
      }))
    })
  })

  describe('enforceRetention — never orphan a chain (audit H5)', () => {
    it('defers (does NOT delete) an aged-out base that still has dependents', async () => {
      // 3 backups, retentionCount 2 → the oldest (b3) is the delete candidate.
      prisma.backup.findMany.mockResolvedValue([
        { id: 'b1', backupId: 'B1', vmId: 'vm-1' },
        { id: 'b2', backupId: 'B2', vmId: 'vm-1' },
        { id: 'b3', backupId: 'B3', vmId: 'vm-1' }
      ] as never)
      // b3 is a base that a retained increment still depends on.
      backupService.findDependentBackupIds.mockResolvedValue(['b1'])

      await (service as any).enforceRetention('sched-1', 2)

      expect(backupService.deleteBackup).not.toHaveBeenCalled()
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/deferring delete/i))
    })

    it('deletes an aged-out leaf with no dependents', async () => {
      prisma.backup.findMany.mockResolvedValue([
        { id: 'b1', backupId: 'B1', vmId: 'vm-1' },
        { id: 'b2', backupId: 'B2', vmId: 'vm-1' },
        { id: 'b3', backupId: 'B3', vmId: 'vm-1' }
      ] as never)
      backupService.findDependentBackupIds.mockResolvedValue([])

      await (service as any).enforceRetention('sched-1', 2)

      expect(backupService.deleteBackup).toHaveBeenCalledWith('b3')
    })

    it('keeps progressing when deleteBackup races into a BackupDependencyError', async () => {
      prisma.backup.findMany.mockResolvedValue([
        { id: 'b1', backupId: 'B1', vmId: 'vm-1' },
        { id: 'b2', backupId: 'B2', vmId: 'vm-1' },
        { id: 'b3', backupId: 'B3', vmId: 'vm-1' }
      ] as never)
      // Pre-check says clear, but the delete then loses a race.
      backupService.findDependentBackupIds.mockResolvedValue([])
      backupService.deleteBackup.mockRejectedValue(new BackupDependencyError('has dependents', ['b1']))

      await expect((service as any).enforceRetention('sched-1', 2)).resolves.toBeUndefined()
      expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/deferring delete/i))
    })

    it('does nothing when backups are within the retention window', async () => {
      prisma.backup.findMany.mockResolvedValue([
        { id: 'b1', backupId: 'B1', vmId: 'vm-1' },
        { id: 'b2', backupId: 'B2', vmId: 'vm-1' }
      ] as never)

      await (service as any).enforceRetention('sched-1', 2)

      expect(backupService.deleteBackup).not.toHaveBeenCalled()
      expect(backupService.findDependentBackupIds).not.toHaveBeenCalled()
    })
  })
})
