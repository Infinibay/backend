import { EventEmitter } from 'events'

import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import type { PrismaClient } from '@prisma/client'
import { BackupService as InfinizationBackupService, BackupStatus, BackupType } from '@infinibay/infinization'

import { BackupService } from '@services/BackupService'

jest.mock('@services/EventManager', () => ({
  getEventManager: () => null
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
    prisma = mockDeep<PrismaClient>()
    infinization = new FakeInfinization()
    service = new BackupService(prisma, infinization as unknown as InfinizationBackupService)
  })

  describe('createBackup', () => {
    it('persists an in-progress row, runs the backup, and marks it completed', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'web-1',
        userId: 'user-1',
        diskPaths: ['/disks/web-1.qcow2']
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
      expect(infinization.createBackup).toHaveBeenCalledWith(expect.objectContaining({
        vmId,
        diskPaths: ['/disks/web-1.qcow2'],
        type: BackupType.FULL
      }))
      expect(prisma.backup.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'db-1' },
        data: expect.objectContaining({
          backupId: 'bkp-123',
          status: BackupStatus.COMPLETED
        })
      }))
      expect(result.status).toBe(BackupStatus.COMPLETED)
    })

    it('marks the row as FAILED when the underlying backup throws', async () => {
      prisma.machine.findUnique.mockResolvedValue({
        id: 'vm-1', name: 'x', userId: 'u', diskPaths: ['/d.qcow2']
      } as never)
      prisma.backup.create.mockResolvedValue({ id: 'db-1', backupId: 'p', vmId: 'vm-1' } as never)
      prisma.backup.update.mockResolvedValue({ id: 'db-1', status: BackupStatus.FAILED } as never)
      infinization.createBackup.mockRejectedValue(new Error('qemu-img blew up'))

      await expect(service.createBackup({ vmId: 'vm-1', type: BackupType.FULL }))
        .rejects.toThrow('qemu-img blew up')

      expect(prisma.backup.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: BackupStatus.FAILED,
          errorMessage: 'qemu-img blew up'
        })
      }))
    })

    it('rejects when the VM has no disk paths', async () => {
      prisma.machine.findUnique.mockResolvedValue({
        id: 'vm-1', name: 'x', userId: 'u', diskPaths: []
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
  })
})
