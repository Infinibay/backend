import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

// In-VM agent: report the guest process as dead so the reset proceeds. Mocking
// the module also keeps the real (infinization-backed) service out of the graph.
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(async () => ({
    getVMStatus: jest.fn(async () => ({ processAlive: false }))
  }))
}))

// Disk side effects are mocked so we assert on intent, not on a real qcow2.
jest.mock('fs/promises', () => ({ __esModule: true, default: { unlink: jest.fn(), rename: jest.fn() } }))
jest.mock('child_process', () => ({ __esModule: true, execFile: jest.fn() }))

import fs from 'fs/promises'
import { execFile } from 'child_process'
import { getInfinization } from '@services/InfinizationService'
import { NonPersistentResetService } from '@services/pool/NonPersistentResetService'

const mockedUnlink = fs.unlink as unknown as jest.Mock<(...args: any[]) => any>
const mockedRename = fs.rename as unknown as jest.Mock<(...args: any[]) => any>
const mockedExecFile = execFile as unknown as jest.Mock<(...args: any[]) => any>
const mockedGetInfinization = getInfinization as unknown as jest.Mock<(...args: any[]) => any>

// A pool-owned, non-persistent machine that is eligible for reset.
const eligibleMachine = (overrides: Record<string, unknown> = {}) => ({
  id: 'vm-1',
  poolId: 'pool-1',
  configuration: { diskPaths: ['/disks/vm-1.qcow2'] },
  pool: {
    type: 'non-persistent',
    resetOnLogoff: true,
    goldenImage: { baseDiskPath: '/disks/base/golden.qcow2' }
  },
  ...overrides
})

describe('NonPersistentResetService.handleShutdown', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: NonPersistentResetService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new NonPersistentResetService(prisma)

    mockedUnlink.mockResolvedValue(undefined)
    mockedRename.mockResolvedValue(undefined)
    // qemu-img create: invoke the trailing callback with no error (success).
    mockedExecFile.mockImplementation((...args: any[]) => args[args.length - 1](null))
    mockedGetInfinization.mockResolvedValue({
      getVMStatus: jest.fn(async () => ({ processAlive: false }))
    })
    prisma.machine.update.mockResolvedValue({} as any)
  })

  it('claims REBUILDING, wipes the delta, then releases to off on success', async () => {
    prisma.machine.findUnique.mockResolvedValue(eligibleMachine() as any)
    prisma.machine.updateMany.mockResolvedValue({ count: 1 })

    await service.handleShutdown('vm-1')

    // Atomic claim before any disk work — only from idle/terminal disk-safe states.
    expect(prisma.machine.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'vm-1', status: { in: ['off', 'error'] } },
        data: { status: 'rebuilding' }
      })
    )
    // Crash-safe rebuild: build into a temp path, then atomic-rename over the live
    // delta. unlink is the stale-temp pre-clean; qemu-img targets the temp path.
    const tmpMatch = expect.stringMatching(/\/disks\/vm-1\.qcow2\.rebuild-.*\.tmp$/)
    expect(mockedUnlink).toHaveBeenCalledWith(tmpMatch)
    expect(mockedExecFile).toHaveBeenCalledWith(
      'qemu-img',
      expect.arrayContaining(['-b', '/disks/base/golden.qcow2']),
      expect.anything(),
      expect.any(Function)
    )
    expect(mockedRename).toHaveBeenCalledWith(tmpMatch, '/disks/vm-1.qcow2')
    expect(prisma.machine.update).toHaveBeenCalledWith({ where: { id: 'vm-1' }, data: { status: 'off' } })
  })

  it('skips disk work and does not release when the claim is lost (count 0)', async () => {
    prisma.machine.findUnique.mockResolvedValue(eligibleMachine() as any)
    prisma.machine.updateMany.mockResolvedValue({ count: 0 }) // another handler won

    await service.handleShutdown('vm-1')

    expect(mockedUnlink).not.toHaveBeenCalled()
    expect(mockedExecFile).not.toHaveBeenCalled()
    expect(prisma.machine.update).not.toHaveBeenCalled()
  })

  it('parks the machine in error (never off) when the rebuild fails', async () => {
    prisma.machine.findUnique.mockResolvedValue(eligibleMachine() as any)
    prisma.machine.updateMany.mockResolvedValue({ count: 1 })
    mockedExecFile.mockImplementation((...args: any[]) => args[args.length - 1](new Error('qemu-img boom')))

    await service.handleShutdown('vm-1')

    expect(prisma.machine.update).toHaveBeenCalledWith({ where: { id: 'vm-1' }, data: { status: 'error' } })
    expect(prisma.machine.update).not.toHaveBeenCalledWith({ where: { id: 'vm-1' }, data: { status: 'off' } })
  })

  it('does not claim or touch disks for a persistent pool', async () => {
    prisma.machine.findUnique.mockResolvedValue(
      eligibleMachine({ pool: { type: 'persistent', resetOnLogoff: true, goldenImage: { baseDiskPath: '/x' } } }) as any
    )

    await service.handleShutdown('vm-1')

    expect(prisma.machine.updateMany).not.toHaveBeenCalled()
    expect(mockedUnlink).not.toHaveBeenCalled()
  })

  it('does not claim when the guest QEMU process is still alive', async () => {
    mockedGetInfinization.mockResolvedValueOnce({
      getVMStatus: jest.fn(async () => ({ processAlive: true }))
    })
    prisma.machine.findUnique.mockResolvedValue(eligibleMachine() as any)

    await service.handleShutdown('vm-1')

    expect(prisma.machine.updateMany).not.toHaveBeenCalled()
    expect(mockedUnlink).not.toHaveBeenCalled()
  })
})
