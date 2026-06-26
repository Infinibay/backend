/**
 * Unit tests for the startup disk-op-marker reconcile (audit NEW finding).
 *
 * The H1 fix sets transient Machine.status = backing_up/restoring/snapshotting
 * around an exclusive qemu-img operation. A hard crash mid-op leaves the row
 * STUCK in that marker, and every power-on path then refuses it
 * (isDiskOperationInProgress) — the VM is permanently un-startable. The backend
 * boot reconcile must release such orphaned markers back to 'off'.
 *
 * These tests mock the prisma singleton so they run as a unit test WITHOUT
 * Postgres (the function under test only issues findMany/updateMany).
 */

// The global setup (tests/setup/jest.setup.ts) mocks @services/InfinizationService
// down to a stub that ONLY exports getInfinization — so the real
// reconcileOrphanedDiskOpMarkers export is missing under that mock. Opt out here
// so the REAL module is loaded; we substitute its heavy deps (the infinization
// library + the prisma singleton) with the mocks below instead.
jest.unmock('@services/InfinizationService')
jest.unmock('@main/services/InfinizationService')

// Mock the heavy library so importing the service file is cheap and side-effect
// free (the service only references Infinization inside functions, not at module
// load, so an empty mock is sufficient for these tests).
jest.mock('@infinibay/infinization', () => ({ Infinization: class {} }))

// EventManager is globally mocked in tests/setup/jest.setup.ts (getEventManager
// returns a stub) — not exercised by the reconcile path anyway.

// Mock the prisma singleton used by InfinizationService.
const findMany = jest.fn()
const updateMany = jest.fn()
jest.mock('@main/utils/database', () => ({
  __esModule: true,
  default: { machine: { findMany: (...a: unknown[]) => findMany(...a), updateMany: (...a: unknown[]) => updateMany(...a) } }
}))

import { reconcileOrphanedDiskOpMarkers } from '@main/services/InfinizationService'
import { DISK_OP_STATUSES, OFF_STATUS } from '@main/constants/machine-status'

describe('reconcileOrphanedDiskOpMarkers (startup disk-op-marker reconcile)', () => {
  beforeEach(() => {
    findMany.mockReset()
    updateMany.mockReset()
  })

  it('resets every VM stuck in a disk-op marker back to off', async () => {
    findMany.mockResolvedValue([
      { id: 'vm1', name: 'a', status: 'backing_up' },
      { id: 'vm2', name: 'b', status: 'restoring' },
      { id: 'vm3', name: 'c', status: 'snapshotting' }
    ])
    updateMany.mockResolvedValue({ count: 3 })

    const count = await reconcileOrphanedDiskOpMarkers()

    expect(count).toBe(3)
    // updateMany must target exactly the disk-op markers and set status -> off.
    expect(updateMany).toHaveBeenCalledTimes(1)
    const arg = updateMany.mock.calls[0][0]
    expect(arg.data).toEqual({ status: OFF_STATUS })
    expect(arg.where.status.in).toEqual(expect.arrayContaining(DISK_OP_STATUSES))
  })

  it('only ever targets the disk-op markers, never a live QEMU state', () => {
    // Guard the marker set itself: backing_up/capturing/restoring/snapshotting and
    // nothing else (so the reconcile can never stomp a 'running'/'starting' VM).
    expect([...DISK_OP_STATUSES].sort()).toEqual(['backing_up', 'capturing', 'restoring', 'snapshotting'])
  })

  it('is a no-op (no updateMany) when nothing is stuck', async () => {
    findMany.mockResolvedValue([])

    const count = await reconcileOrphanedDiskOpMarkers()

    expect(count).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('swallows DB errors so startup is never blocked', async () => {
    findMany.mockRejectedValue(new Error('db down'))

    await expect(reconcileOrphanedDiskOpMarkers()).resolves.toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })
})
