import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

// Factory mocks keep the infinization-backed provisioning/cleanup modules out
// of the import graph — checkOutDesktopForUser never reaches them in these
// tests, and loading the real ones would require the built infinization pkg.
jest.mock('@services/machineLifecycleService', () => ({
  MachineLifecycleService: class { createMachine = jest.fn() }
}))
jest.mock('@services/cleanup/machineCleanupServiceV2', () => ({
  MachineCleanupServiceV2: class { cleanupVM = jest.fn() }
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
  })

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
    prisma.machine.findFirst.mockResolvedValue({ id: 'assigned-1' } as any)

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
})
