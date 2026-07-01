import 'reflect-metadata'
import { MachineCleanupServiceV2 } from '@services/cleanup/machineCleanupServiceV2'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

// Mock InfinizationService
const mockInfinization = {
  // Physical teardown succeeds by default. cleanupVM now treats a falsy success
  // as a teardown failure and aborts the DB delete, so the happy path must return
  // an explicit { success: true }.
  destroyVM: jest.fn().mockResolvedValue({ success: true }),
  getVMStatus: jest.fn().mockResolvedValue({ processAlive: false })
}

jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => Promise.resolve(mockInfinization))
}))

// Mock VirtioSocketWatcherService
const mockVirtioService = {
  disconnectVm: jest.fn().mockResolvedValue(undefined),
  isVmConnected: jest.fn().mockReturnValue(false)
}

jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => mockVirtioService)
}))

// Mock fs/promises
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([]),
  access: jest.fn().mockRejectedValue(new Error('ENOENT')),
  stat: jest.fn().mockResolvedValue({ isFile: () => true })
}))

// Mock path
jest.mock('path', () => ({
  ...jest.requireActual('path'),
  join: jest.fn((...args: string[]) => args.join('/'))
}))

describe('MachineCleanupService - Comprehensive Tests', () => {
  let service: MachineCleanupServiceV2
  let prisma: DeepMockProxy<PrismaClient>
  const mockVMId = 'test-vm-123'

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    prisma.machineConfiguration.delete.mockResolvedValue(null as any)
    prisma.machineApplication.deleteMany.mockResolvedValue({ count: 0 })
    prisma.pendingCommand.deleteMany.mockResolvedValue({ count: 0 })
    prisma.scriptExecution.deleteMany.mockResolvedValue({ count: 0 })
    prisma.firewallRule.deleteMany.mockResolvedValue({ count: 0 })
    prisma.firewallRuleSet.deleteMany.mockResolvedValue({ count: 0 })
    prisma.firewallRuleSet.findFirst.mockResolvedValue(null)
    prisma.machine.delete.mockResolvedValue({} as any)
    prisma.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === 'function') {
        return fn(prisma)
      }
      return fn
    })
    service = new MachineCleanupServiceV2(prisma)
  })

  describe('cleanupVM - Resource Cleanup', () => {
    it('should handle VM not found gracefully', async () => {
      prisma.machine.findUnique.mockResolvedValue(null)

      // Should not throw for non-existent VM, just return
      await expect(service.cleanupVM('non-existent-vm')).resolves.toBeUndefined()
    })

    it('deletes the AUTHORITATIVE stored diskPaths, not just reconstructed guesses (no disk leak)', async () => {
      // Regression: cleanup used to rebuild disk paths from internalName under
      // INFINIZATION_DISK_DIR (default /var/lib/infinization/disks). When that env
      // was unset it looked in the wrong dir, missed the real qcow2 (ENOENT,
      // silently ignored) and LEAKED the disk while reporting success. The real
      // path lives on configuration.diskPaths.
      const { unlink } = require('fs/promises') as { unlink: jest.Mock }
      const realDisk = '/opt/infinibay/disks/1be60d0f-c4d1-4e48-853c-16eaffb56bdf.qcow2'
      const mockMachine = {
        id: mockVMId,
        internalName: `vm-${mockVMId}`,
        status: 'off',
        configuration: {
          id: 'config-1',
          machineId: mockVMId,
          qmpSocketPath: null,
          qemuPid: null,
          tapDeviceName: null,
          guestAgentSocketPath: null,
          infiniServiceSocketPath: null,
          tpmSocketPath: null,
          diskPaths: [realDisk]
        }
      }
      prisma.machine.findUnique.mockResolvedValue(mockMachine as any)

      await service.cleanupVM(mockVMId)

      // The exact stored absolute path must be unlinked.
      expect(unlink).toHaveBeenCalledWith(realDisk)
    })

    it('should successfully clean up VM with configuration', async () => {
      const mockMachine = {
        id: mockVMId,
        internalName: `vm-${mockVMId}`,
        status: 'stopped',
        configuration: {
          id: 'config-1',
          machineId: mockVMId,
          qmpSocketPath: null,
          qemuPid: null,
          tapDeviceName: null,
          guestAgentSocketPath: null,
          infiniServiceSocketPath: null,
          tpmSocketPath: null
        }
      }

      prisma.machine.findUnique.mockResolvedValue(mockMachine as any)

      await expect(service.cleanupVM(mockVMId)).resolves.toBeUndefined()
      expect(prisma.machine.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockVMId }
        })
      )
      // Physical teardown succeeded, so the DB row is deleted.
      expect(prisma.machine.delete).toHaveBeenCalledWith({ where: { id: mockVMId } })
    })

    it('aborts the DB delete and marks delete_failed when physical teardown throws', async () => {
      const mockMachine = {
        id: mockVMId,
        internalName: `vm-${mockVMId}`,
        status: 'running',
        configuration: {
          id: 'config-1',
          machineId: mockVMId,
          qmpSocketPath: null,
          qemuPid: null,
          tapDeviceName: null,
          guestAgentSocketPath: null,
          infiniServiceSocketPath: null,
          tpmSocketPath: null
        }
      }

      prisma.machine.findUnique.mockResolvedValue(mockMachine as any)
      mockInfinization.destroyVM.mockRejectedValueOnce(new Error('Failed to destroy'))

      // The host still owns QEMU/TAP/firewall, so cleanup throws and KEEPS the row.
      await expect(service.cleanupVM(mockVMId)).rejects.toThrow(/physical teardown failed/i)
      expect(prisma.machine.delete).not.toHaveBeenCalled()
      expect(prisma.machine.update).toHaveBeenCalledWith({
        where: { id: mockVMId },
        data: { status: 'delete_failed' }
      })
    })

    it('aborts the DB delete when physical teardown returns success:false', async () => {
      const mockMachine = {
        id: mockVMId,
        internalName: `vm-${mockVMId}`,
        status: 'running',
        configuration: { id: 'config-1', machineId: mockVMId, qmpSocketPath: null, qemuPid: null, tapDeviceName: null, guestAgentSocketPath: null, infiniServiceSocketPath: null, tpmSocketPath: null }
      }

      prisma.machine.findUnique.mockResolvedValue(mockMachine as any)
      mockInfinization.destroyVM.mockResolvedValueOnce({ success: false, error: 'boom' })

      await expect(service.cleanupVM(mockVMId)).rejects.toThrow(/physical teardown failed/i)
      expect(prisma.machine.delete).not.toHaveBeenCalled()
      expect(prisma.machine.update).toHaveBeenCalledWith({
        where: { id: mockVMId },
        data: { status: 'delete_failed' }
      })
    })

    it('should handle missing configuration gracefully', async () => {
      const mockMachine = {
        id: mockVMId,
        internalName: `vm-${mockVMId}`,
        status: 'stopped',
        configuration: null
      }

      prisma.machine.findUnique.mockResolvedValue(mockMachine as any)

      await expect(service.cleanupVM(mockVMId)).resolves.toBeUndefined()
    })
  })

  describe('cleanupVM - Edge Cases', () => {
    it('should handle very long VM ID', async () => {
      const longVMId = 'a'.repeat(500)
      prisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.cleanupVM(longVMId)).resolves.toBeUndefined()
    })
  })

  describe('cleanupVM - Performance', () => {
    it('should complete cleanup of multiple VMs in reasonable time', async () => {
      const vmIds = Array.from({ length: 5 }, (_, i) => `test-vm-${i}`)
      const cleanupTimes: number[] = []

      prisma.machine.findUnique.mockResolvedValue(null)

      const promises = vmIds.map(async (vmId) => {
        const startTime = Date.now()
        await service.cleanupVM(vmId)
        cleanupTimes.push(Date.now() - startTime)
      })

      await Promise.all(promises)

      const totalTime = cleanupTimes.reduce((sum, time) => sum + time, 0)
      expect(totalTime).toBeLessThan(5000)
    })
  })
})
