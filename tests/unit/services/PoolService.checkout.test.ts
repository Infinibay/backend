import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

// Controllable boot result for the checkout power-on step.
const mockStartMachine = jest.fn<(...args: any[]) => Promise<{ success: boolean, error?: string }>>()

// Factory mocks keep the infinization-backed modules out of the import graph
// and let us drive the boot deterministically. A spawned machine comes back
// from the (mocked) lifecycle service so the on-demand path can be exercised.
jest.mock('@services/machineLifecycleService', () => ({
  MachineLifecycleService: class { createMachine = jest.fn(async () => ({ id: 'spawned-1', userId: null })) }
}))
jest.mock('@services/cleanup/machineCleanupServiceV2', () => ({
  MachineCleanupServiceV2: class { cleanupVM = jest.fn() }
}))
jest.mock('@services/VMOperationsService', () => ({
  VMOperationsService: class { startMachine = (...args: any[]) => mockStartMachine(...args) }
}))
jest.mock('@services/EventManager', () => ({
  getEventManager: jest.fn(() => ({ dispatchEvent: jest.fn() }))
}))

import { PoolService } from '@services/PoolService'

const pool = (overrides: Record<string, unknown> = {}) => ({
  id: 'pool-1',
  name: 'p',
  templateId: 't',
  goldenImageId: 'g',
  departmentId: 'd',
  type: 'non-persistent',
  sizeMin: 1,
  sizeMax: 10,
  idleTimeoutMinutes: null,
  resetOnLogoff: true,
  draining: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
})

describe('PoolService.checkOutDesktopForUser', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: PoolService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new PoolService(prisma)

    mockStartMachine.mockResolvedValue({ success: true })
    prisma.machine.update.mockResolvedValue({} as any)
    prisma.machine.count.mockResolvedValue(0)
    // Used by provisionOne on the on-demand spawn path.
    prisma.machineTemplate.findUnique.mockResolvedValue({ id: 't', name: 'ubuntu', description: '' } as any)
  })

  // ── claim / TOCTOU ────────────────────────────────────────────────────────

  it('returns an idle desktop after winning the atomic claim (non-persistent)', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool() as any)
    prisma.machine.findFirst.mockResolvedValue({ id: 'm-1' } as any)
    prisma.machine.updateMany.mockResolvedValue({ count: 1 }) // won the race
    prisma.machine.findUnique.mockResolvedValue({ id: 'm-1', status: 'starting' } as any)

    const result = await service.checkOutDesktopForUser('pool-1', 'user-1')

    expect(result.id).toBe('m-1')
    expect(prisma.machine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'm-1', status: { in: ['off', 'stopped', 'paused'] } }),
        data: expect.objectContaining({ status: 'starting' })
      })
    )
  })

  it('retries on a lost claim and succeeds with another candidate', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool() as any)
    prisma.machine.findFirst
      .mockResolvedValueOnce({ id: 'm-1' } as any) // round 1 candidate
      .mockResolvedValueOnce({ id: 'm-2' } as any) // round 2 candidate
    prisma.machine.updateMany
      .mockResolvedValueOnce({ count: 0 }) // lost m-1 to a concurrent checkout
      .mockResolvedValueOnce({ count: 1 }) // won m-2
    prisma.machine.findUnique.mockResolvedValue({ id: 'm-2', status: 'starting' } as any)

    const result = await service.checkOutDesktopForUser('pool-1', 'user-1')

    expect(result.id).toBe('m-2')
    expect(prisma.machine.findFirst).toHaveBeenCalledTimes(2)
    expect(prisma.machine.updateMany).toHaveBeenCalledTimes(2)
  })

  it('assigns userId atomically when claiming for a persistent pool', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool({ type: 'persistent' }) as any)
    prisma.machine.findFirst
      .mockResolvedValueOnce(null) // no machine assigned to this user yet
      .mockResolvedValueOnce({ id: 'm-1' } as any) // idle candidate
    prisma.machine.updateMany.mockResolvedValue({ count: 1 })
    prisma.machine.findUnique.mockResolvedValue({ id: 'm-1', userId: 'user-1', status: 'starting' } as any)

    const result = await service.checkOutDesktopForUser('pool-1', 'user-1')

    expect(result.id).toBe('m-1')
    expect(prisma.machine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'starting', userId: 'user-1' })
      })
    )
  })

  it('returns the already-assigned machine for a persistent pool without claiming', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool({ type: 'persistent' }) as any)
    prisma.machine.findFirst.mockResolvedValue({ id: 'assigned-1', status: 'running' } as any)

    const result = await service.checkOutDesktopForUser('pool-1', 'user-1')

    expect(result.id).toBe('assigned-1')
    expect(prisma.machine.updateMany).not.toHaveBeenCalled()
  })

  it('throws when the pool is draining', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool({ draining: true }) as any)

    await expect(service.checkOutDesktopForUser('pool-1', 'user-1')).rejects.toThrow('draining')
    expect(prisma.machine.updateMany).not.toHaveBeenCalled()
  })

  it('throws at capacity when nothing is idle and the pool is at sizeMax', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool({ sizeMax: 2 }) as any)
    prisma.machine.findFirst.mockResolvedValue(null) // nothing idle → break out of retry loop
    prisma.machine.count.mockResolvedValue(2) // already at sizeMax

    await expect(service.checkOutDesktopForUser('pool-1', 'user-1')).rejects.toThrow('capacity')
  })

  // ── boot (6.F completion) ─────────────────────────────────────────────────

  it('powers on a freshly claimed desktop', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool() as any)
    prisma.machine.findFirst.mockResolvedValue({ id: 'm-1' } as any)
    prisma.machine.updateMany.mockResolvedValue({ count: 1 })
    prisma.machine.findUnique.mockResolvedValue({ id: 'm-1', status: 'starting' } as any)

    const result = await service.checkOutDesktopForUser('pool-1', 'user-1')

    expect(result.id).toBe('m-1')
    expect(mockStartMachine).toHaveBeenCalledWith('m-1')
  })

  it('releases the reservation back to off and throws when the boot fails', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool() as any)
    prisma.machine.findFirst.mockResolvedValue({ id: 'm-1' } as any)
    prisma.machine.updateMany.mockResolvedValue({ count: 1 })
    prisma.machine.findUnique.mockResolvedValue({ id: 'm-1', status: 'starting' } as any)
    mockStartMachine.mockResolvedValueOnce({ success: false, error: 'boom' })

    await expect(service.checkOutDesktopForUser('pool-1', 'user-1')).rejects.toThrow('Failed to start')
    expect(prisma.machine.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { status: 'off' } })
  })

  it('does not power on an already-running assigned desktop', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool({ type: 'persistent' }) as any)
    prisma.machine.findFirst.mockResolvedValue({ id: 'assigned-1', status: 'running' } as any)

    await service.checkOutDesktopForUser('pool-1', 'user-1')

    expect(mockStartMachine).not.toHaveBeenCalled()
  })

  it('does not power on an on-demand spawned desktop (the create pipeline boots it)', async () => {
    prisma.pool.findUnique.mockResolvedValue(pool() as any)
    prisma.machine.findFirst.mockResolvedValue(null) // nothing idle → spawn
    prisma.machine.count.mockResolvedValue(0) // under capacity

    const result = await service.checkOutDesktopForUser('pool-1', 'user-1')

    expect(result.id).toBe('spawned-1')
    expect(mockStartMachine).not.toHaveBeenCalled()
  })
})
