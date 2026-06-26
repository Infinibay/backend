/**
 * SF-2 — GoldenImageService capture must take the CAPTURING disk-op claim around
 * the exclusive `qemu-img convert`/`copyFile` window, release it BEFORE any
 * internal restart of the source, and route the seal-boot through the GUARDED
 * power-on path (VMOperationsService.startMachine), never infinization.startVM
 * directly.
 *
 * Why each matters:
 *   - claim CAPTURING (OFF/ERROR → capturing): refuses the capture if a backup/
 *     snapshot already owns the row, and — once held — blocks any power-on or
 *     concurrent qemu-img op over the disk we are reading (CAPTURING is in
 *     DISK_OP_STATUSES, so isDiskOperationInProgress is true).
 *   - release BEFORE restart: the hardened library VMLifecycle.start() refuses to
 *     start a VM whose DB status is a disk-op marker, so a CAPTURING row cannot be
 *     booted to be sealed — we must flip it back to 'off' first.
 *   - guarded restart: VMOperationsService.startMachine re-checks the marker; a
 *     direct infinization.startVM would bypass that gate.
 *   - release on every error path: a failed capture must never strand the VM
 *     un-startable.
 *
 * The long-running waits + the actual qemu-img shell-outs are stubbed so the
 * orchestration runs deterministically; we assert only the lock/ordering wiring.
 *
 * Needs Postgres (jest.setup connects a test client) — WRITTEN here, not run.
 */
import 'reflect-metadata'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import type { PrismaClient, Machine, Prisma } from '@prisma/client'

// Observe the GUARDED power-on path. We replace VMOperationsService entirely so
// startMachine is a spy and we never reach the real infinization layer.
const startMachineMock = jest.fn().mockResolvedValue({ success: true })
jest.mock('@services/VMOperationsService', () => ({
  VMOperationsService: class {
    startMachine = startMachineMock
  }
}))

// fs/promises — the capture writes/reads disk files we don't want to touch.
jest.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    stat: jest.fn().mockResolvedValue({ size: 4096 }),
    copyFile: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined)
  }
}))

import { GoldenImageService } from '@services/GoldenImageService'
import { CAPTURING_STATUS, OFF_STATUS } from '@main/constants/machine-status'

type MachineWithConfig = Machine & {
  configuration: { diskPaths: Prisma.JsonValue | null } | null
}

describe('GoldenImageService — SF-2 capture disk-op (CAPTURING) guard', () => {
  let prisma: DeepMockProxy<PrismaClient>
  let service: GoldenImageService
  // A no-op virtio watcher; sealing is stubbed below.
  const virtioWatcher = { sendSafeCommand: jest.fn() } as any

  const machine: MachineWithConfig = {
    id: 'vm-1',
    internalName: 'vm-1',
    configuration: { diskPaths: ['/disks/base/source.qcow2'] }
  } as never

  /**
   * Stub the long-running / shell-out internals so runCaptureFromMachine
   * completes fast. Returns the spies so individual tests can make them throw.
   */
  function stubInternals (svc: GoldenImageService) {
    const anySvc = svc as any
    const convertDisk = jest.spyOn(anySvc, 'convertDisk').mockResolvedValue(undefined)
    const waitForSetupComplete = jest.spyOn(anySvc, 'waitForSetupComplete').mockResolvedValue(undefined)
    const waitForShutdown = jest.spyOn(anySvc, 'waitForShutdown').mockResolvedValue(undefined)
    const sendPrepareGoldenImage = jest.spyOn(anySvc, 'sendPrepareGoldenImage').mockResolvedValue(undefined)
    return { convertDisk, waitForSetupComplete, waitForShutdown, sendPrepareGoldenImage }
  }

  /** Invoke the private detached orchestration directly and await it. */
  async function runCapture (input: Partial<{ destroySource: boolean, sanitizeUserData: boolean }>) {
    return await (service as any).runCaptureFromMachine('img-1', machine, {
      machineId: machine.id,
      name: 'gi',
      destroySource: input.destroySource ?? false,
      sanitizeUserData: input.sanitizeUserData ?? true
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    startMachineMock.mockResolvedValue({ success: true })

    prisma = mockDeep<PrismaClient>()
    // Default: every claim/release updateMany succeeds.
    prisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)
    prisma.machine.update.mockResolvedValue({} as never)
    prisma.goldenImage.update.mockResolvedValue({} as never)

    service = new GoldenImageService(prisma, virtioWatcher)
  })

  // ── claim ──────────────────────────────────────────────────────────────────

  it('claims CAPTURING (OFF/ERROR → capturing) before the convert window (preserve)', async () => {
    stubInternals(service)

    await runCapture({ destroySource: false })

    const claimCall = prisma.machine.updateMany.mock.calls.find(
      ([arg]: any) => arg?.data?.status === CAPTURING_STATUS
    ) as any
    expect(claimCall).toBeDefined()
    expect(claimCall[0].where).toEqual({
      id: 'vm-1',
      status: { in: expect.arrayContaining([OFF_STATUS, 'error']) }
    })
  })

  it('refuses the capture (throws, never starts) when the CAPTURING claim matches no row', async () => {
    const stubs = stubInternals(service)
    // The VM already carries a disk-op marker (concurrent backup/snapshot owns it).
    prisma.machine.updateMany.mockResolvedValueOnce({ count: 0 } as never)

    await expect(runCapture({ destroySource: false })).rejects.toThrow(/in progress|not stopped/i)

    // Lock lost ⇒ no clone, no boot, no seal.
    expect(stubs.convertDisk).not.toHaveBeenCalled()
    expect(startMachineMock).not.toHaveBeenCalled()
  })

  // ── release BEFORE restart + guarded restart ────────────────────────────────

  it('releases CAPTURING (→ off) BEFORE the source restart and restarts via the GUARDED path (preserve)', async () => {
    stubInternals(service)
    const calls: string[] = []
    // Record the relative order of the release vs the guarded start.
    prisma.machine.updateMany.mockImplementation((arg: any) => {
      if (arg?.where?.status === CAPTURING_STATUS && arg?.data?.status === OFF_STATUS) {
        calls.push('release')
      } else if (arg?.data?.status === CAPTURING_STATUS) {
        calls.push('claim')
      }
      return Promise.resolve({ count: 1 }) as never
    })
    startMachineMock.mockImplementation(async () => {
      calls.push('start')
      return { success: true }
    })

    await runCapture({ destroySource: false })

    // The boot goes through the guarded service, NOT infinization.startVM.
    expect(startMachineMock).toHaveBeenCalledWith('vm-1')
    // A release must precede the first start.
    const firstStart = calls.indexOf('start')
    const firstRelease = calls.indexOf('release')
    expect(firstRelease).toBeGreaterThanOrEqual(0)
    expect(firstStart).toBeGreaterThan(firstRelease)
  })

  it('destroySource variant also releases CAPTURING before the guarded seal-boot', async () => {
    stubInternals(service)
    const order: string[] = []
    prisma.machine.updateMany.mockImplementation((arg: any) => {
      if (arg?.where?.status === CAPTURING_STATUS && arg?.data?.status === OFF_STATUS) order.push('release')
      else if (arg?.data?.status === CAPTURING_STATUS) order.push('claim')
      return Promise.resolve({ count: 1 }) as never
    })
    startMachineMock.mockImplementation(async () => { order.push('start'); return { success: true } })

    await runCapture({ destroySource: true })

    expect(startMachineMock).toHaveBeenCalledWith('vm-1')
    expect(order.indexOf('release')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('start')).toBeGreaterThan(order.indexOf('release'))
  })

  // ── release on error ─────────────────────────────────────────────────────────

  it('releases CAPTURING (→ off) even when a step THROWS (failed capture never strands the VM)', async () => {
    const stubs = stubInternals(service)
    // Sealing fails after the boot — capture aborts.
    stubs.sendPrepareGoldenImage.mockRejectedValue(new Error('seal failed'))

    await expect(runCapture({ destroySource: false })).rejects.toThrow(/seal failed/i)

    // The parent finally must flip any surviving CAPTURING row back to 'off'.
    expect(prisma.machine.updateMany).toHaveBeenCalledWith({
      where: { id: 'vm-1', status: CAPTURING_STATUS },
      data: { status: OFF_STATUS }
    })
  })

  it('never calls the guarded start if the source could not be claimed', async () => {
    stubInternals(service)
    prisma.machine.updateMany.mockResolvedValueOnce({ count: 0 } as never)

    await expect(runCapture({ destroySource: true })).rejects.toThrow()
    expect(startMachineMock).not.toHaveBeenCalled()
  })
})
