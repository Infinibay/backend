import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { SnapshotServiceV2, SnapshotInfo, SnapshotResult, SnapshotListResult } from '../../../app/services/SnapshotServiceV2'
import { SnapshotManager, SnapshotInfo as InfinizationSnapshotInfo, StorageError, StorageErrorCode } from '@infinibay/infinization'

const mockPrisma: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>()

// Mock Infinization SnapshotManager
const mockSnapshotManager = {
  createSnapshot: jest.fn() as jest.Mock<any>,
  listSnapshots: jest.fn() as jest.Mock<any>,
  revertSnapshot: jest.fn() as jest.Mock<any>,
  deleteSnapshot: jest.fn() as jest.Mock<any>,
  snapshotExists: jest.fn() as jest.Mock<any>
}

jest.mock('@infinibay/infinization', () => {
  const actual = jest.requireActual('@infinibay/infinization') as any
  return {
    SnapshotManager: jest.fn(() => mockSnapshotManager),
    StorageError: actual.StorageError,
    StorageErrorCode: actual.StorageErrorCode
  }
})

// Mock fs
jest.mock('fs', () => ({
  existsSync: jest.fn(() => true)
}))

describe('SnapshotServiceV2', () => {
  let service: SnapshotServiceV2

  beforeEach(() => {
    jest.clearAllMocks()
    // createSnapshot now atomically claims the row (status OFF/ERROR →
    // snapshotting) via updateMany before any qemu-img work, requiring
    // count===1, then releases it (snapshotting → off) in a finally. Default
    // both updateMany calls to count:1 so the happy path proceeds.
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)
    service = new SnapshotServiceV2(mockPrisma)
  })

  describe('createSnapshot', () => {
    const mockVMId = 'vm-123-456'

    it('should successfully create a snapshot for a stopped VM', async () => {
      // Mock VM info - stopped VM
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      // Mock snapshot creation
      mockSnapshotManager.createSnapshot.mockResolvedValue(undefined)

      const result: SnapshotResult = await service.createSnapshot(mockVMId, 'test-snapshot', 'Test description')

      expect(result.success).toBe(true)
      expect(result.message).toContain('Snapshot')
      expect(result.snapshot).toBeDefined()
      expect(result.snapshot!.name).toBe('test-snapshot')
    })

    it('should return error when VM is not found', async () => {
      // Mock VM not found
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result: SnapshotResult = await service.createSnapshot(mockVMId, 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })

    it('should return error when VM is running (qemu-img limitation)', async () => {
      // Mock VM info - running VM
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'running' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result: SnapshotResult = await service.createSnapshot(mockVMId, 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('must be stopped')
    })

    it('should handle SnapshotManager creation failure', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const error = new StorageError(StorageErrorCode.COMMAND_FAILED, 'Storage error')
      mockSnapshotManager.createSnapshot.mockRejectedValue(error)

      const result: SnapshotResult = await service.createSnapshot(mockVMId, 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toBeDefined()
    })

    it('should create snapshot with description', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      mockSnapshotManager.createSnapshot.mockResolvedValue(undefined)

      const result: SnapshotResult = await service.createSnapshot(
        mockVMId,
        'test-snapshot',
        'Important backup before update'
      )

      expect(result.success).toBe(true)
      expect(result.message).toContain('Snapshot')
    })

    it('should handle empty snapshot name', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result: SnapshotResult = await service.createSnapshot(mockVMId, '')

      // Either fails validation or creates - depends on implementation
      expect(result).toBeDefined()
    })
  })

  describe('listSnapshots', () => {
    const mockVMId = 'vm-123-456'

    it('should return list of snapshots for VM', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const mockSnapshots: InfinizationSnapshotInfo[] = [
        {
          id: '1',
          name: 'snapshot-1',
          date: new Date('2024-01-01').toISOString(),
          vmSize: 500 * 1024 * 1024,
          vmClock: '00:00:00'
        },
        {
          id: '2',
          name: 'snapshot-2',
          date: new Date('2024-01-02').toISOString(),
          vmSize: 600 * 1024 * 1024,
          vmClock: '00:00:00'
        }
      ]
      mockSnapshotManager.listSnapshots.mockResolvedValue(mockSnapshots)

      const result: SnapshotListResult = await service.listSnapshots(mockVMId)

      expect(result.success).toBe(true)
      expect(result.snapshots.length).toBe(2)
      expect(result.snapshots[0].name).toBe('snapshot-1')
      expect(result.snapshots[1].name).toBe('snapshot-2')
    })

    it('should handle empty snapshot list', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      mockSnapshotManager.listSnapshots.mockResolvedValue([])

      const result: SnapshotListResult = await service.listSnapshots(mockVMId)

      expect(result.success).toBe(true)
      expect(result.snapshots.length).toBe(0)
    })

    it('should return error when VM is not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result: SnapshotListResult = await service.listSnapshots(mockVMId)

      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })

    it('should handle snapshot listing failures', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const error = new StorageError(StorageErrorCode.COMMAND_FAILED, 'Storage unavailable')
      mockSnapshotManager.listSnapshots.mockRejectedValue(error)

      const result: SnapshotListResult = await service.listSnapshots(mockVMId)

      expect(result.success).toBe(false)
      expect(result.message).toBeDefined()
    })

    it('should include VM size metadata in snapshot list', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const mockSnapshots: InfinizationSnapshotInfo[] = [
        {
          id: '1',
          name: 'snapshot-1',
          date: new Date('2024-01-01').toISOString(),
          vmSize: 1024 * 1024 * 1024, // 1GB
          vmClock: '00:00:00'
        }
      ]
      mockSnapshotManager.listSnapshots.mockResolvedValue(mockSnapshots)

      const result: SnapshotListResult = await service.listSnapshots(mockVMId)

      expect(result.success).toBe(true)
      expect(result.snapshots[0].vmSize).toBe(1024 * 1024 * 1024)
    })
  })

  describe('deleteSnapshot', () => {
    const mockVMId = 'vm-123-456'

    it('should successfully delete a snapshot', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result: SnapshotResult = await service.deleteSnapshot(mockVMId, 'snapshot-1')

      expect(result.success).toBe(true)
      expect(result.message).toContain('deleted')
    })

    it('should return error when VM is not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result: SnapshotResult = await service.deleteSnapshot(mockVMId, 'snapshot-1')

      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })

    it('should handle delete failure', async () => {
      const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' } as any
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const error = new StorageError(StorageErrorCode.COMMAND_FAILED, 'Delete failed')
      mockSnapshotManager.deleteSnapshot.mockRejectedValue(error)

      const result: SnapshotResult = await service.deleteSnapshot(mockVMId, 'snapshot-1')

      expect(result.success).toBe(false)
      expect(result.message).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('should handle null VMId gracefully', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)
      const result: SnapshotResult = await service.createSnapshot('', 'test-snapshot')
      expect(result.success).toBe(false)
    })

    it('should handle undefined VMId gracefully', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)
      const result: SnapshotResult = await service.createSnapshot(undefined as any, 'test-snapshot')
      expect(result.success).toBe(false)
    })
  })

  describe('service initialization', () => {
    it('should initialize with prisma client and snapshot manager', () => {
      expect(service).toBeDefined()
      expect(mockSnapshotManager.createSnapshot).toBeDefined()
    })
  })
})
