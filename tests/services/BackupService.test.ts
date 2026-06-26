import { EventEmitter } from 'events'

import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { BackupService as InfinizationBackupService, BackupStatus, BackupType } from '@infinibay/infinization'

import { BackupService, VmBusyError, BackupDependencyError } from '@services/BackupService'
import { assertVmStopped, VmRunningError } from '@utils/assertVmStopped'
import { BACKING_UP_STATUS, OFF_STATUS } from '@main/constants/machine-status'

jest.mock('@services/EventManager', () => ({
  getEventManager: () => null
}))

// The live "VM must be stopped" guard hits getInfinization, which we don't wire
// here. Mock it: default no-op (VM stopped); individual tests can make it throw.
jest.mock('@utils/assertVmStopped', () => ({
  assertVmStopped: jest.fn().mockResolvedValue(undefined),
  VmRunningError: class VmRunningError extends Error {}
}))

class FakeInfinization extends EventEmitter {
  createBackup = jest.fn()
  restoreBackup = jest.fn()
  listBackups = jest.fn()
  deleteBackup = jest.fn()
  getBackupMetadata = jest.fn()
}

describe('BackupService (backend wrapper)', () => {
  let prisma: DeepMockProxy<PrismaClient>
  let infinization: FakeInfinization
  let service: BackupService

  beforeEach(() => {
    // The service validates that disk paths stay within INFINIZATION_DISK_DIR;
    // point it at the fixtures' base so the test paths pass that guard.
    process.env.INFINIZATION_DISK_DIR = '/disks'
    prisma = mockDeep<PrismaClient>()
    infinization = new FakeInfinization()
    service = new BackupService(prisma, infinization as unknown as InfinizationBackupService)

    // Default: the atomic disk-op claim succeeds (VM was OFF/ERROR) and the
    // release flips it back. Individual tests override count to simulate a busy VM.
    prisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)
    // Default: no incremental backup depends on a delete target.
    prisma.backup.findMany.mockResolvedValue([] as never)
    // assertVmStopped is mocked module-wide; reset it to "stopped" each test so a
    // prior test's mockRejectedValueOnce doesn't leak.
    ;(assertVmStopped as jest.Mock).mockResolvedValue(undefined)
  })

  describe('createBackup', () => {
    it('persists an in-progress row, runs the backup, and marks it completed', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'web-1',
        userId: 'user-1',
        configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)

      const pendingRow = { id: 'db-1', backupId: 'pending-x', vmId, status: BackupStatus.IN_PROGRESS }
      const completedRow = {
        id: 'db-1',
        backupId: 'bkp-123',
        vmId,
        status: BackupStatus.COMPLETED,
        type: BackupType.FULL,
        totalSize: BigInt(100),
        durationMs: 5000,
        errorMessage: null,
        createdAt: new Date(),
        completedAt: new Date()
      }

      prisma.backup.create.mockResolvedValue(pendingRow as never)
      prisma.backup.update.mockResolvedValue(completedRow as never)

      infinization.createBackup.mockResolvedValue({
        success: true,
        backupId: 'bkp-123',
        vmId,
        type: BackupType.FULL,
        disks: [],
        totalSize: 100,
        durationMs: 5000
      })
      infinization.getBackupMetadata.mockResolvedValue({ totalOriginalSize: 200 })

      const result = await service.createBackup({ vmId, type: BackupType.FULL })

      expect(prisma.backup.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          vmId,
          status: BackupStatus.IN_PROGRESS,
          type: BackupType.FULL
        })
      }))
      // Method now returns immediately with the pending row; the actual
      // infinization work runs in the background.
      expect(result.status).toBe(BackupStatus.IN_PROGRESS)
      expect(result.backupId).toBe('pending-x')

      // The detached background work does real fs I/O (fs.stat per disk +
      // listSubdirs) before calling infinization.createBackup, so give it real
      // time to reach that call rather than a fixed number of microtask ticks.
      await new Promise((r) => setTimeout(r, 50))

      expect(infinization.createBackup).toHaveBeenCalledWith(expect.objectContaining({
        vmId,
        diskPaths: ['/disks/web-1.qcow2'],
        type: BackupType.FULL
      }))
    })

    it('fails closed: rejects and creates no backup row when the VM is not provably stopped', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId, name: 'web-1', userId: 'user-1', configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      ;(assertVmStopped as jest.Mock).mockRejectedValueOnce(new VmRunningError('VM running / unknown'))

      await expect(service.createBackup({ vmId, type: BackupType.FULL })).rejects.toThrow(VmRunningError)
      expect(prisma.backup.create).not.toHaveBeenCalled()
      expect(infinization.createBackup).not.toHaveBeenCalled()
    })

    it('marks the row as FAILED when the underlying backup throws', async () => {
      prisma.machine.findUnique.mockResolvedValue({
        id: 'vm-1', name: 'x', userId: 'u', configuration: { diskPaths: ['/disks/d.qcow2'] }
      } as never)
      prisma.backup.create.mockResolvedValue({ id: 'db-1', backupId: 'p', vmId: 'vm-1' } as never)
      prisma.backup.update.mockResolvedValue({ id: 'db-1', status: BackupStatus.FAILED } as never)
      infinization.createBackup.mockRejectedValue(new Error('qemu-img blew up'))

      // Returns immediately — failure is handled in the background and
      // persisted to the row, not re-thrown from createBackup.
      await service.createBackup({ vmId: 'vm-1', type: BackupType.FULL })

      // Let the background task run.
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      expect(prisma.backup.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: BackupStatus.FAILED,
          errorMessage: 'qemu-img blew up'
        })
      }))
    })

    it('rejects when the VM has no disk paths', async () => {
      prisma.machine.findUnique.mockResolvedValue({
        id: 'vm-1', name: 'x', userId: 'u', configuration: { diskPaths: [] }
      } as never)

      await expect(service.createBackup({ vmId: 'vm-1', type: BackupType.FULL }))
        .rejects.toThrow(/no disk paths/)
      expect(prisma.backup.create).not.toHaveBeenCalled()
    })

    it('rejects when the VM does not exist', async () => {
      prisma.machine.findUnique.mockResolvedValue(null)
      await expect(service.createBackup({ vmId: 'missing', type: BackupType.FULL }))
        .rejects.toThrow(/not found/)
    })

    // ── Audit H1: durable disk-op claim ────────────────────────────────────────

    it('claim fails (VmBusyError) when the VM row is not OFF/ERROR — no row, no qemu-img', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId, name: 'web-1', userId: 'user-1', configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      // The conditional updateMany matches nothing because status is RUNNING.
      prisma.machine.updateMany.mockResolvedValueOnce({ count: 0 } as never)

      await expect(service.createBackup({ vmId, type: BackupType.FULL })).rejects.toThrow(VmBusyError)
      // The claim is the gate: we never insert a row, never re-probe, never convert.
      expect(prisma.backup.create).not.toHaveBeenCalled()
      expect(assertVmStopped as jest.Mock).not.toHaveBeenCalled()
      expect(infinization.createBackup).not.toHaveBeenCalled()
    })

    it('claims the row with BACKING_UP before re-probing, in OFF/ERROR-only fashion', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId, name: 'web-1', userId: 'user-1', configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      prisma.backup.create.mockResolvedValue({ id: 'db-1', backupId: 'p', vmId } as never)
      prisma.backup.update.mockResolvedValue({ id: 'db-1', status: BackupStatus.COMPLETED } as never)
      infinization.createBackup.mockResolvedValue({ success: true, backupId: 'b', vmId, type: BackupType.FULL, disks: [], totalSize: 1, durationMs: 1 })
      infinization.getBackupMetadata.mockResolvedValue({ totalOriginalSize: 1 })

      await service.createBackup({ vmId, type: BackupType.FULL })

      // First updateMany is the claim: only matches an OFF/ERROR row, sets BACKING_UP.
      const claimCall = prisma.machine.updateMany.mock.calls[0][0] as any
      expect(claimCall.where).toEqual({ id: vmId, status: { in: expect.arrayContaining(['off', 'error']) } })
      expect(claimCall.data).toEqual({ status: BACKING_UP_STATUS })
    })

    it('releases the BACKING_UP marker on background SUCCESS (flips back to OFF)', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId, name: 'web-1', userId: 'user-1', configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      prisma.backup.create.mockResolvedValue({ id: 'db-1', backupId: 'p', vmId } as never)
      prisma.backup.update.mockResolvedValue({ id: 'db-1', status: BackupStatus.COMPLETED } as never)
      infinization.createBackup.mockResolvedValue({ success: true, backupId: 'b', vmId, type: BackupType.FULL, disks: [], totalSize: 1, durationMs: 1 })
      infinization.getBackupMetadata.mockResolvedValue({ totalOriginalSize: 1 })

      await service.createBackup({ vmId, type: BackupType.FULL })
      // Let the detached background worker reach its finally.
      await new Promise((r) => setTimeout(r, 50))

      // A release updateMany flips BACKING_UP → OFF, conditioned on still holding it.
      expect(prisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: vmId, status: BACKING_UP_STATUS },
        data: { status: OFF_STATUS }
      })
    })

    it('releases the BACKING_UP marker on background FAILURE (flips back to OFF)', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId, name: 'web-1', userId: 'user-1', configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      prisma.backup.create.mockResolvedValue({ id: 'db-1', backupId: 'p', vmId } as never)
      prisma.backup.update.mockResolvedValue({ id: 'db-1', status: BackupStatus.FAILED } as never)
      infinization.createBackup.mockRejectedValue(new Error('qemu-img blew up'))

      await service.createBackup({ vmId, type: BackupType.FULL })
      await new Promise((r) => setTimeout(r, 50))

      expect(prisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: vmId, status: BACKING_UP_STATUS },
        data: { status: OFF_STATUS }
      })
    })

    it('releases the BACKING_UP marker when the post-claim probe fails (synchronous path)', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId, name: 'web-1', userId: 'user-1', configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      ;(assertVmStopped as jest.Mock).mockRejectedValueOnce(new VmRunningError('slipped in'))

      await expect(service.createBackup({ vmId, type: BackupType.FULL })).rejects.toThrow(VmRunningError)

      // We claimed, the probe threw, so we must release synchronously before rethrowing.
      expect(prisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: vmId, status: BACKING_UP_STATUS },
        data: { status: OFF_STATUS }
      })
      expect(prisma.backup.create).not.toHaveBeenCalled()
    })
  })

  describe('deleteBackup', () => {
    it('removes the row even if the on-disk manifest is already gone', async () => {
      prisma.backup.findUnique.mockResolvedValue({
        id: 'db-1', backupId: 'bkp-1', vmId: 'vm-1'
      } as never)
      const { BackupError, BackupErrorCode } = await import('@infinibay/infinization')
      infinization.deleteBackup.mockRejectedValue(
        new BackupError(BackupErrorCode.BACKUP_NOT_FOUND, 'gone')
      )

      await service.deleteBackup('db-1')

      expect(prisma.backup.delete).toHaveBeenCalledWith({ where: { id: 'db-1' } })
    })

    it('propagates non-not-found errors', async () => {
      prisma.backup.findUnique.mockResolvedValue({
        id: 'db-1', backupId: 'bkp-1', vmId: 'vm-1'
      } as never)
      infinization.deleteBackup.mockRejectedValue(new Error('permission denied'))

      await expect(service.deleteBackup('db-1')).rejects.toThrow('permission denied')
      expect(prisma.backup.delete).not.toHaveBeenCalled()
    })

    // ── Audit H5: never orphan an incremental chain ────────────────────────────

    it('refuses (BackupDependencyError) when an incremental still names it as parent', async () => {
      prisma.backup.findUnique.mockResolvedValue({
        id: 'db-base', backupId: 'bkp-base', vmId: 'vm-1'
      } as never)
      // One increment depends on the base (parentBackupId === bkp-base).
      prisma.backup.findMany.mockResolvedValue([{ id: 'db-incr' }] as never)

      await expect(service.deleteBackup('db-base')).rejects.toThrow(BackupDependencyError)
      // Neither the on-disk delete nor the DB row delete happens — the chain is intact.
      expect(infinization.deleteBackup).not.toHaveBeenCalled()
      expect(prisma.backup.delete).not.toHaveBeenCalled()

      // The dependency scan matched the base by BOTH its public backupId and DB id.
      const scanWhere = (prisma.backup.findMany.mock.calls[0][0] as any).where
      expect(scanWhere.vmId).toBe('vm-1')
      expect(scanWhere.id).toEqual({ not: 'db-base' })
      expect(scanWhere.parentBackupId.in).toEqual(expect.arrayContaining(['bkp-base', 'db-base']))
    })

    it('deletes normally when no increment depends on it', async () => {
      prisma.backup.findUnique.mockResolvedValue({
        id: 'db-leaf', backupId: 'bkp-leaf', vmId: 'vm-1'
      } as never)
      prisma.backup.findMany.mockResolvedValue([] as never)
      infinization.deleteBackup.mockResolvedValue(undefined as never)

      await service.deleteBackup('db-leaf')

      expect(prisma.backup.delete).toHaveBeenCalledWith({ where: { id: 'db-leaf' } })
    })
  })
})
