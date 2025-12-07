import 'reflect-metadata'
import { SnapshotServiceV2 } from '../../../app/services/SnapshotServiceV2'
import { PrismaClient } from '@prisma/client'
import fs from 'fs'

// Mock snapshot manager instance
const mockSnapshotManager = {
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  revertSnapshot: jest.fn(),
  deleteSnapshot: jest.fn(),
  snapshotExists: jest.fn()
}

// Mock infinivirt
jest.mock('@infinibay/infinivirt', () => ({
  SnapshotManager: jest.fn().mockImplementation(() => mockSnapshotManager),
  StorageError: class StorageError extends Error {
    constructor (message: string) {
      super(message)
      this.name = 'StorageError'
    }
  }
}))

// Mock fs
jest.mock('fs')

describe('SnapshotServiceV2', () => {
  let service: SnapshotServiceV2
  let mockPrisma: any

  const mockVM = {
    id: 'vm-123',
    internalName: 'vm-test-123',
    status: 'off'
  }

  beforeEach(async () => {
    jest.clearAllMocks()

    // Setup mock Prisma
    mockPrisma = {
      machine: {
        findUnique: jest.fn()
      }
    }

    // Setup mock fs
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)

    // Create service
    service = new SnapshotServiceV2(mockPrisma as PrismaClient)
  })

  describe('createSnapshot', () => {
    it('should create a snapshot for a stopped VM', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.createSnapshot.mockResolvedValue(undefined)

      const result = await service.createSnapshot('vm-123', 'test-snapshot', 'Test description')

      expect(result.success).toBe(true)
      expect(result.message).toContain('created successfully')
      expect(result.snapshot).toBeDefined()
      expect(result.snapshot?.name).toBe('test-snapshot')
      expect(result.snapshot?.description).toBe('Test description')
      expect(mockSnapshotManager.createSnapshot).toHaveBeenCalledWith({
        imagePath: expect.stringContaining('vm-test-123'),
        name: 'test-snapshot',
        description: 'Test description'
      })
    })

    it('should fail if VM is running', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        ...mockVM,
        status: 'running'
      })

      const result = await service.createSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('must be stopped')
    })

    it('should fail if VM not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      const result = await service.createSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })

    it('should fail if disk image not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const result = await service.createSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('Disk image not found')
    })
  })

  describe('listSnapshots', () => {
    it('should list all snapshots for a VM', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([
        { name: 'snap-1', date: '2024-01-01', vmSize: 1024 },
        { name: 'snap-2', date: '2024-01-02', vmSize: 2048 }
      ])

      const result = await service.listSnapshots('vm-123')

      expect(result.success).toBe(true)
      expect(result.snapshots).toHaveLength(2)
      expect(result.snapshots[0].name).toBe('snap-1')
      expect(result.snapshots[1].name).toBe('snap-2')
      expect(result.snapshots[1].isCurrent).toBe(true) // Last one is current
    })

    it('should return empty array if no snapshots', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([])

      const result = await service.listSnapshots('vm-123')

      expect(result.success).toBe(true)
      expect(result.snapshots).toHaveLength(0)
    })

    it('should fail if VM not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      const result = await service.listSnapshots('vm-123')

      expect(result.success).toBe(false)
      expect(result.snapshots).toHaveLength(0)
    })
  })

  describe('restoreSnapshot', () => {
    it('should restore a snapshot for a stopped VM', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)
      mockSnapshotManager.revertSnapshot.mockResolvedValue(undefined)

      const result = await service.restoreSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(true)
      expect(result.message).toContain('successfully')
      expect(mockSnapshotManager.revertSnapshot).toHaveBeenCalled()
    })

    it('should fail if VM is running', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        ...mockVM,
        status: 'running'
      })

      const result = await service.restoreSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('must be stopped')
    })

    it('should fail if snapshot does not exist', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(false)

      const result = await service.restoreSnapshot('vm-123', 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })
  })

  describe('deleteSnapshot', () => {
    it('should delete a snapshot', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.deleteSnapshot.mockResolvedValue(undefined)

      const result = await service.deleteSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(true)
      expect(result.message).toContain('deleted successfully')
      expect(mockSnapshotManager.deleteSnapshot).toHaveBeenCalled()
    })

    it('should fail if VM not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      const result = await service.deleteSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
    })
  })

  describe('getCurrentSnapshot', () => {
    it('should return the most recent snapshot', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([
        { name: 'snap-1', date: '2024-01-01', vmSize: 1024 },
        { name: 'snap-2', date: '2024-01-02', vmSize: 2048 }
      ])

      const result = await service.getCurrentSnapshot('vm-123')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('snap-2')
      expect(result?.isCurrent).toBe(true)
    })

    it('should return null if no snapshots', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([])

      const result = await service.getCurrentSnapshot('vm-123')

      expect(result).toBeNull()
    })
  })

  describe('snapshotExists', () => {
    it('should return true if snapshot exists', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)

      const result = await service.snapshotExists('vm-123', 'test-snapshot')

      expect(result).toBe(true)
    })

    it('should return false if snapshot does not exist', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(false)

      const result = await service.snapshotExists('vm-123', 'nonexistent')

      expect(result).toBe(false)
    })

    it('should return false if VM not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      const result = await service.snapshotExists('vm-123', 'test-snapshot')

      expect(result).toBe(false)
    })
  })
})
