import 'reflect-metadata'
import { SnapshotServiceV2 } from '../../../app/services/SnapshotServiceV2'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import fs from 'fs'

// Mock snapshot manager instance
const mockSnapshotManager = {
  createSnapshot: jest.fn(),
  listSnapshots: jest.fn(),
  revertSnapshot: jest.fn(),
  deleteSnapshot: jest.fn(),
  snapshotExists: jest.fn()
}

// Mock infinization
jest.mock('@infinibay/infinization', () => ({
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
  let mockPrisma: DeepMockProxy<PrismaClient>

  const mockVM = {
    id: 'vm-123',
    internalName: 'vm-test-123',
    status: 'off'
  } as any

  beforeEach(async () => {
    jest.clearAllMocks()

    mockPrisma = mockDeep<PrismaClient>()

    // createSnapshot now atomically claims the row (status OFF/ERROR → snapshotting)
    // via updateMany before any qemu-img work, and releases it the same way
    // (snapshotting → off) in a finally. Default both to count:1 so the happy path
    // proceeds; the claim-failure test overrides count to 0.
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)

    // createSnapshot now enforces a per-VM snapshot cap: before creating it lists
    // existing snapshots and refuses once MAX_SNAPSHOTS_PER_VM is reached. Default
    // the listing to empty so the cap is not hit and the happy path proceeds;
    // listSnapshots-specific tests override this with their own values.
    mockSnapshotManager.listSnapshots.mockResolvedValue([])

    // Setup mock fs
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)

    // Create service
    service = new SnapshotServiceV2(mockPrisma)
  })

  describe('createSnapshot', () => {
    it('should create a snapshot for a stopped VM', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.createSnapshot.mockResolvedValue(undefined)

      const result = await service.createSnapshot('vm-123', 'test-snapshot', 'Test description')

      expect(result.success).toBe(true)
      expect(result.message).toContain('created successfully')
      expect(result.snapshot).toBeDefined()
      expect(result.snapshot?.name).toBe('test-snapshot')
      // qemu-img persists no description, so the service no longer echoes one back
      // (it would not survive a subsequent list).
      expect(result.snapshot?.description).toBeUndefined()
      expect(mockSnapshotManager.createSnapshot).toHaveBeenCalledWith({
        imagePath: expect.stringContaining('vm-test-123'),
        name: 'test-snapshot',
        description: 'Test description'
      })
    })

    it('should fail if VM is running', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue({
        ...mockVM,
        status: 'running'
      })

      const result = await service.createSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('must be stopped')
    })

    it('should fail if VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result = await service.createSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })

    it('should fail if disk image not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const result = await service.createSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('Disk image not found')
    })

    // ── Audit H1: durable disk-op claim ────────────────────────────────────────

    it('claims the row (OFF/ERROR → snapshotting) before any qemu-img work', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.createSnapshot.mockResolvedValue(undefined)

      await service.createSnapshot('vm-123', 'snap')

      const claim = mockPrisma.machine.updateMany.mock.calls[0][0] as any
      expect(claim.where).toEqual({ id: 'vm-123', status: { in: expect.arrayContaining(['off', 'error']) } })
      expect(claim.data).toEqual({ status: 'snapshotting' })
    })

    it('fails to claim (VM busy) when the conditional updateMany matches no row', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      // The pre-check passes (status 'off') but the atomic claim loses the race.
      mockPrisma.machine.updateMany.mockResolvedValueOnce({ count: 0 } as never)

      const result = await service.createSnapshot('vm-123', 'snap')

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/busy or not stopped/i)
      // The claim is the gate: qemu-img is never invoked.
      expect(mockSnapshotManager.createSnapshot).not.toHaveBeenCalled()
    })

    it('releases the snapshotting marker (→ off) on SUCCESS', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.createSnapshot.mockResolvedValue(undefined)

      await service.createSnapshot('vm-123', 'snap')

      expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: 'vm-123', status: 'snapshotting' },
        data: { status: 'off' }
      })
    })

    it('releases the snapshotting marker (→ off) when qemu-img THROWS', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.createSnapshot.mockRejectedValue(new Error('qemu-img failed'))

      const result = await service.createSnapshot('vm-123', 'snap')

      expect(result.success).toBe(false)
      // Even on failure, the finally must flip the marker back so the VM isn't stuck.
      expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: 'vm-123', status: 'snapshotting' },
        data: { status: 'off' }
      })
    })
  })

  describe('listSnapshots', () => {
    it('should list all snapshots for a VM', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([
        { name: 'snap-1', date: '2024-01-01', vmSize: 1024 },
        { name: 'snap-2', date: '2024-01-02', vmSize: 2048 }
      ])

      const result = await service.listSnapshots('vm-123')

      expect(result.success).toBe(true)
      expect(result.snapshots).toHaveLength(2)
      expect(result.snapshots[0].name).toBe('snap-1')
      expect(result.snapshots[1].name).toBe('snap-2')
      // We no longer infer a "current" snapshot from list order (qemu-img has no
      // such concept) — every entry is honestly isCurrent:false.
      expect(result.snapshots[1].isCurrent).toBe(false)
    })

    it('should return empty array if no snapshots', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([])

      const result = await service.listSnapshots('vm-123')

      expect(result.success).toBe(true)
      expect(result.snapshots).toHaveLength(0)
    })

    it('should fail if VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result = await service.listSnapshots('vm-123')

      expect(result.success).toBe(false)
      expect(result.snapshots).toHaveLength(0)
    })
  })

  describe('restoreSnapshot', () => {
    it('should restore a snapshot for a stopped VM', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)
      mockSnapshotManager.revertSnapshot.mockResolvedValue(undefined)

      const result = await service.restoreSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(true)
      expect(result.message).toContain('successfully')
      expect(mockSnapshotManager.revertSnapshot).toHaveBeenCalled()
    })

    it('should fail if VM is running', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue({
        ...mockVM,
        status: 'running'
      })

      const result = await service.restoreSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
      expect(result.message).toContain('must be stopped')
    })

    it('should fail if snapshot does not exist', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(false)

      const result = await service.restoreSnapshot('vm-123', 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })

    // ── MF-1: restore now takes the SAME durable disk-op claim as createSnapshot ──
    // The in-place `qemu-img snapshot -a` revert overwrites the qcow2; without a
    // claim a powerOn landing between the status read and the revert boots QEMU
    // over the disk being rewritten (re-opens the H1 TOCTOU). restoreSnapshot must
    // atomically flip OFF/ERROR → restoring, bail if the claim is lost, and release
    // restoring → off in a finally on every exit path.

    it('claims the row (OFF/ERROR → restoring) before reverting the qcow2', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)
      mockSnapshotManager.revertSnapshot.mockResolvedValue(undefined)

      await service.restoreSnapshot('vm-123', 'snap')

      // The very first updateMany is the conditional claim.
      const claim = mockPrisma.machine.updateMany.mock.calls[0][0] as any
      expect(claim.where).toEqual({ id: 'vm-123', status: { in: expect.arrayContaining(['off', 'error']) } })
      expect(claim.data).toEqual({ status: 'restoring' })
    })

    it('bails (does NOT revert) when the atomic claim matches no row (VM busy / lost race)', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)
      // Pre-check passes (status 'off') but the atomic claim loses the race.
      mockPrisma.machine.updateMany.mockResolvedValueOnce({ count: 0 } as never)

      const result = await service.restoreSnapshot('vm-123', 'snap')

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/busy or not stopped/i)
      // The claim is the gate: qemu-img revert is never invoked.
      expect(mockSnapshotManager.revertSnapshot).not.toHaveBeenCalled()
    })

    it('releases the restoring marker (→ off) on SUCCESS', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)
      mockSnapshotManager.revertSnapshot.mockResolvedValue(undefined)

      await service.restoreSnapshot('vm-123', 'snap')

      expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: 'vm-123', status: 'restoring' },
        data: { status: 'off' }
      })
    })

    it('releases the restoring marker (→ off) when the revert THROWS', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)
      mockSnapshotManager.revertSnapshot.mockRejectedValue(new Error('qemu-img -a failed'))

      const result = await service.restoreSnapshot('vm-123', 'snap')

      expect(result.success).toBe(false)
      // Even on failure, the finally must flip the marker back so the VM isn't stuck.
      expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: 'vm-123', status: 'restoring' },
        data: { status: 'off' }
      })
    })

    it('releases the restoring marker (→ off) when the snapshot is NOT found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(false)

      const result = await service.restoreSnapshot('vm-123', 'nope')

      expect(result.success).toBe(false)
      // The early `return` for a missing snapshot still passes through the finally.
      expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
        where: { id: 'vm-123', status: 'restoring' },
        data: { status: 'off' }
      })
    })
  })

  describe('deleteSnapshot', () => {
    it('should delete a snapshot', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.deleteSnapshot.mockResolvedValue(undefined)

      const result = await service.deleteSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(true)
      expect(result.message).toContain('deleted successfully')
      expect(mockSnapshotManager.deleteSnapshot).toHaveBeenCalled()
    })

    it('should fail if VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result = await service.deleteSnapshot('vm-123', 'test-snapshot')

      expect(result.success).toBe(false)
    })
  })

  describe('getMostRecentSnapshot', () => {
    it('should return the most recent snapshot (honestly NOT flagged as current)', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([
        { name: 'snap-1', date: '2024-01-01', vmSize: 1024 },
        { name: 'snap-2', date: '2024-01-02', vmSize: 2048 }
      ])

      const result = await service.getMostRecentSnapshot('vm-123')

      expect(result).not.toBeNull()
      expect(result?.name).toBe('snap-2')
      // qemu-img has no current-snapshot concept; we no longer fabricate it.
      expect(result?.isCurrent).toBe(false)
    })

    it('should return null if no snapshots', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.listSnapshots.mockResolvedValue([])

      const result = await service.getMostRecentSnapshot('vm-123')

      expect(result).toBeNull()
    })
  })

  describe('snapshotExists', () => {
    it('should return true if snapshot exists', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(true)

      const result = await service.snapshotExists('vm-123', 'test-snapshot')

      expect(result).toBe(true)
    })

    it('should return false if snapshot does not exist', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockSnapshotManager.snapshotExists.mockResolvedValue(false)

      const result = await service.snapshotExists('vm-123', 'nonexistent')

      expect(result).toBe(false)
    })

    it('should return false if VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result = await service.snapshotExists('vm-123', 'test-snapshot')

      expect(result).toBe(false)
    })
  })
})
