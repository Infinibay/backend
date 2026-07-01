/**
 * H6 — backend wiring of the library's live-disk backup guard.
 *
 * The infinization BackupService refuses to copy a LIVE qcow2 (crash-inconsistent
 * / torn read) but only when the backend injects two probes:
 *   - isVmRunning(vmId): true | false | null   (null => library fails closed)
 *   - guestAgentFactory(vmId): GuestQuiesce | null
 * and a SNAPSHOT restore must default allowInPlaceSnapshotRevert=false so a normal
 * restore never clobbers the live source disk.
 *
 * These tests assert:
 *   (a) the isVmRunning probe returns null on a probe error / unavailable status
 *       (fail-closed — never a silent false),
 *   (b) the self-constructed infinization BackupService is built WITH both
 *       isVmRunning and guestAgentFactory,
 *   (c) a SNAPSHOT (and any) restore passes allowInPlaceSnapshotRevert=false by
 *       default through to the library.
 *
 * Needs Postgres (jest.setup connects a test client) — WRITTEN here, not run.
 */
import { EventEmitter } from 'events'

import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import type { PrismaClient } from '@prisma/client'

// ── Capture the options the backend passes when it constructs its OWN
//    infinization BackupService (the non-injected path). We replace the library
//    BackupService with a fake that records its constructor options so we can
//    assert isVmRunning + guestAgentFactory were injected and exercise them. ──
const capturedOptions: Array<Record<string, unknown>> = []

class FakeLibBackupService extends EventEmitter {
  constructor (options?: Record<string, unknown>) {
    super()
    capturedOptions.push(options ?? {})
  }

  createBackup = jest.fn()
  restoreBackup = jest.fn()
  listBackups = jest.fn()
  deleteBackup = jest.fn()
  getBackupMetadata = jest.fn()
}

jest.mock('@infinibay/infinization', () => {
  const actual = jest.requireActual('@infinibay/infinization')
  return {
    ...actual,
    BackupService: FakeLibBackupService
  }
})

// The guest-agent client is reached via a dist subpath because the library does
// not re-export it from its public index (frozen). Mock it so no real socket is
// opened during the guestAgentFactory unit checks.
const guestAgentConnect = jest.fn().mockResolvedValue(undefined)
const guestAgentCtor = jest.fn()
jest.mock('@infinibay/infinization/dist/core/GuestAgentClient', () => ({
  GuestAgentClient: class {
    socketPath: string
    constructor (socketPath: string) {
      this.socketPath = socketPath
      guestAgentCtor(socketPath)
    }

    connect = guestAgentConnect
    disconnect = jest.fn().mockResolvedValue(undefined)
    isConnected = jest.fn().mockReturnValue(true)
    fsFreeze = jest.fn().mockResolvedValue(1)
    fsThaw = jest.fn().mockResolvedValue(1)
  }
}))

// Control the authoritative power-state probe (VMOperationsService.getStatus).
const getStatusMock = jest.fn()
jest.mock('@services/VMOperationsService', () => ({
  VMOperationsService: class {
    getStatus = getStatusMock
  }
}))

jest.mock('@services/EventManager', () => ({
  getEventManager: () => null
}))

// The live "VM must be stopped" guard is exercised by the existing suite; here
// it is a no-op so restore/backup reach the library call we are asserting on.
jest.mock('@utils/assertVmStopped', () => ({
  assertVmStopped: jest.fn().mockResolvedValue(undefined),
  VmRunningError: class VmRunningError extends Error {}
}))

import { BackupService, resetBackupService } from '@services/BackupService'
import { BackupType, BackupStatus } from '@infinibay/infinization'

describe('BackupService — H6 live-disk guard wiring', () => {
  let prisma: DeepMockProxy<PrismaClient>

  beforeEach(() => {
    capturedOptions.length = 0
    getStatusMock.mockReset()
    guestAgentConnect.mockClear()
    guestAgentCtor.mockClear()
    resetBackupService()

    process.env.INFINIZATION_DISK_DIR = '/disks'
    prisma = mockDeep<PrismaClient>()
    // Default: the atomic disk-op claim/release succeeds.
    prisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.backup.findMany.mockResolvedValue([] as never)
  })

  // ── (b) constructed WITH both probes ──────────────────────────────────────
  it('injects isVmRunning AND guestAgentFactory when it constructs its own infinization service', () => {
    // No injected instance => the backend builds the library service itself and
    // must wire the live-disk probes.
    // eslint-disable-next-line no-new
    new BackupService(prisma)

    expect(capturedOptions).toHaveLength(1)
    const opts = capturedOptions[0]
    expect(typeof opts.isVmRunning).toBe('function')
    expect(typeof opts.guestAgentFactory).toBe('function')
  })

  // ── (a) isVmRunning fails closed (null) on probe error / unavailable ───────
  describe('isVmRunning probe (fail-closed)', () => {
    function buildProbe (): (vmId: string) => Promise<boolean | null> {
      // eslint-disable-next-line no-new
      new BackupService(prisma)
      const probe = capturedOptions[0].isVmRunning as (vmId: string) => Promise<boolean | null>
      expect(typeof probe).toBe('function')
      return probe
    }

    it('returns null (NOT false) when getStatus throws — library fails closed', async () => {
      getStatusMock.mockRejectedValue(new Error('libvirt unreachable'))
      const probe = buildProbe()
      await expect(probe('vm-1')).resolves.toBeNull()
    })

    it('returns null when getStatus reports the probe is unavailable (null)', async () => {
      getStatusMock.mockResolvedValue(null)
      const probe = buildProbe()
      await expect(probe('vm-1')).resolves.toBeNull()
    })

    it('returns true when the live process is alive (running)', async () => {
      getStatusMock.mockResolvedValue({ status: 'running', processAlive: true, qmpStatus: 'running', consistent: true })
      const probe = buildProbe()
      await expect(probe('vm-1')).resolves.toBe(true)
    })

    it('returns false ONLY when the VM is provably stopped (processAlive === false)', async () => {
      getStatusMock.mockResolvedValue({ status: 'off', processAlive: false, qmpStatus: null, consistent: true })
      const probe = buildProbe()
      await expect(probe('vm-1')).resolves.toBe(false)
    })

    it('treats an ambiguous (undefined processAlive) status as running, never stopped', async () => {
      getStatusMock.mockResolvedValue({ status: 'unknown', qmpStatus: null, consistent: false } as never)
      const probe = buildProbe()
      // `!== false` => an undefined processAlive must NOT be coerced to stopped.
      await expect(probe('vm-1')).resolves.toBe(true)
    })
  })

  // ── guestAgentFactory: null fallback vs connected client ───────────────────
  describe('guestAgentFactory', () => {
    function buildFactory (): (vmId: string) => Promise<unknown> {
      // eslint-disable-next-line no-new
      new BackupService(prisma)
      const factory = capturedOptions[0].guestAgentFactory as (vmId: string) => Promise<unknown>
      expect(typeof factory).toBe('function')
      return factory
    }

    it('returns null when the VM has no guest-agent socket configured (snapshot fallback)', async () => {
      prisma.machine.findUnique.mockResolvedValue({
        configuration: { guestAgentSocketPath: null }
      } as never)
      const factory = buildFactory()
      await expect(factory('vm-1')).resolves.toBeNull()
      expect(guestAgentCtor).not.toHaveBeenCalled()
    })

    it('returns a connected GuestAgentClient when a socket is configured', async () => {
      prisma.machine.findUnique.mockResolvedValue({
        configuration: { guestAgentSocketPath: '/run/vm-1-ga.sock' }
      } as never)
      const factory = buildFactory()
      const agent = await factory('vm-1') as { fsFreeze: () => Promise<number>, fsThaw: () => Promise<number> }
      expect(agent).not.toBeNull()
      expect(guestAgentCtor).toHaveBeenCalledWith('/run/vm-1-ga.sock')
      expect(guestAgentConnect).toHaveBeenCalled()
      // Structurally satisfies GuestQuiesce.
      expect(typeof agent.fsFreeze).toBe('function')
      expect(typeof agent.fsThaw).toBe('function')
    })

    it('returns null (snapshot fallback) when the agent cannot connect', async () => {
      prisma.machine.findUnique.mockResolvedValue({
        configuration: { guestAgentSocketPath: '/run/vm-1-ga.sock' }
      } as never)
      guestAgentConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const factory = buildFactory()
      await expect(factory('vm-1')).resolves.toBeNull()
    })
  })

  // ── (c) SNAPSHOT restore defaults allowInPlaceSnapshotRevert=false ─────────
  describe('restoreBackup — allowInPlaceSnapshotRevert default', () => {
    it('passes allowInPlaceSnapshotRevert=false to the library by default', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        userId: 'user-1',
        configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      // restoreBackup now binds the supplied backupId to THIS VM (cross-tenant
      // restore guard) before touching any disk; provide the matching row.
      prisma.backup.findFirst.mockResolvedValue({ backupId: 'bkp-1' } as never)

      const service = new BackupService(prisma)
      const lib = service.getInfinizationService() as unknown as FakeLibBackupService
      lib.restoreBackup.mockResolvedValue({
        success: true,
        backupId: 'bkp-1',
        vmId,
        restoredDiskPaths: ['/disks/web-1.qcow2'],
        durationMs: 10
      })

      await service.restoreBackup({ vmId, backupId: 'bkp-1' })

      expect(lib.restoreBackup).toHaveBeenCalledWith(expect.objectContaining({
        vmId,
        backupId: 'bkp-1',
        allowInPlaceSnapshotRevert: false
      }))
    })

    it('forwards an explicit in-place opt-in (true) unchanged', async () => {
      const vmId = 'vm-1'
      prisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        userId: 'user-1',
        configuration: { diskPaths: ['/disks/web-1.qcow2'] }
      } as never)
      // restoreBackup now binds the supplied backupId to THIS VM (cross-tenant
      // restore guard) before touching any disk; provide the matching row.
      prisma.backup.findFirst.mockResolvedValue({ backupId: 'bkp-1' } as never)

      const service = new BackupService(prisma)
      const lib = service.getInfinizationService() as unknown as FakeLibBackupService
      lib.restoreBackup.mockResolvedValue({
        success: true,
        backupId: 'bkp-1',
        vmId,
        restoredDiskPaths: ['/disks/web-1.qcow2'],
        durationMs: 10
      })

      await service.restoreBackup({ vmId, backupId: 'bkp-1', allowInPlaceSnapshotRevert: true })

      expect(lib.restoreBackup).toHaveBeenCalledWith(expect.objectContaining({
        allowInPlaceSnapshotRevert: true
      }))
    })
  })

  // Touch the imported enums so the unused-import lint does not trip and to keep
  // the values pinned to the library's contract.
  it('uses the library backup enums', () => {
    expect(BackupType.SNAPSHOT).toBe('SNAPSHOT')
    expect(BackupStatus.COMPLETED).toBe('COMPLETED')
  })
})
