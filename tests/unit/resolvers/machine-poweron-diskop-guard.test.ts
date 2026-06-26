/**
 * Audit H1 — powerOn must be refused while a backup/restore/snapshot holds the
 * VM row (status = backing_up | restoring | snapshotting). Starting qemu while
 * qemu-img has the qcow2 open corrupts the image. The DB-status claim is the
 * authoritative cross-service gate; this exercises the outer guard at the
 * GraphQL mutation boundary (MachineMutations.powerOn -> changeMachineState).
 */
import 'reflect-metadata'

import { MachineMutations } from '../../../app/graphql/resolvers/machine/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import { createAdminContext } from '../../setup/test-helpers'

// Spy on the power op so we can prove startMachine is never reached when refused.
import { VMOperationsService } from '@services/VMOperationsService'

describe('MachineMutations.powerOn — disk-op refusal (audit H1)', () => {
  let resolver: MachineMutations
  const ctx = createAdminContext()

  beforeEach(() => {
    resolver = new MachineMutations()
  })

  it.each(['backing_up', 'restoring', 'snapshotting'])(
    'refuses powerOn while the row is in a disk-op status (%s) and never starts the VM',
    async (status) => {
      mockPrisma.machine.findFirst.mockResolvedValue({ id: 'vm-1', name: 'web-1', status } as never)
      const startSpy = jest.spyOn(VMOperationsService.prototype, 'startMachine')

      const result = await resolver.powerOn('vm-1', ctx)

      expect(result.success).toBe(false)
      expect(result.message).toMatch(/disk operation in progress/i)
      expect(startSpy).not.toHaveBeenCalled()

      startSpy.mockRestore()
    }
  )

  it('allows powerOn when the row is in a normal stopped status', async () => {
    mockPrisma.machine.findFirst.mockResolvedValue({ id: 'vm-1', name: 'web-1', status: 'off' } as never)
    const startSpy = jest
      .spyOn(VMOperationsService.prototype, 'startMachine')
      .mockResolvedValue({ success: true, message: 'started' })

    const result = await resolver.powerOn('vm-1', ctx)

    expect(result.success).toBe(true)
    expect(startSpy).toHaveBeenCalledWith('vm-1')

    startSpy.mockRestore()
  })
})
