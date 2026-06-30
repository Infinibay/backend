import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockPrisma } from '../../../setup/jest.setup'
import { VMMigrationService } from '../../../../app/services/node/VMMigrationService'

/**
 * Migration safety (audit fixes): the cold-migration path must (a) refuse to move a
 * disk out from under a live qemu, (b) serialize via an atomic 'moving' claim so a
 * second migration / concurrent power-on cannot race it, and (c) roll the status
 * back on any failure so a VM is never stranded in 'moving'.
 */
function targetNode (over: Record<string, unknown> = {}): unknown {
  // ram is in MB (NodeCapacity floors ram/1024 to GB).
  return { id: 'node-B', maintenanceMode: false, lastHeartbeat: new Date(), cores: 8, ram: 16384, machines: [], ...over }
}

function adapter (): any {
  return { prepareMachineStorage: jest.fn(async () => undefined) }
}

function probe (processAlive: boolean): any {
  return { executorFor: async () => ({ getVMStatus: async () => ({ processAlive }) }) }
}

describe('VMMigrationService — migration safety', () => {
  beforeEach(() => { jest.clearAllMocks() })

  const machine = { id: 'vm-1', nodeId: 'node-A', status: 'off', cpuCores: 2, ramGB: 4, configuration: { diskPaths: ['/d/vm-1.qcow2'] } }

  it('atomically claims the VM, copies the disk, flips nodeId, and restores the prior status', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue(machine as never)
    mockPrisma.node.findUnique.mockResolvedValue(targetNode() as never)
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)
    mockPrisma.machine.update.mockResolvedValue({ id: 'vm-1' } as never)
    const a = adapter()

    const r = await new VMMigrationService(mockPrisma as never, { storageAdapter: a, livenessProbe: probe(false) })
      .migrateStoppedMachineToNode('vm-1', 'node-B')

    expect(r.success).toBe(true)
    // Claimed: updateMany to 'moving' only from a migratable status on the source node.
    expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'vm-1', nodeId: 'node-A', status: { in: ['off', 'stopped', 'error'] } }),
      data: { status: 'moving' }
    }))
    expect(a.prepareMachineStorage).toHaveBeenCalledTimes(1)
    // Committed: nodeId flipped to target AND status restored to the prior 'off'.
    expect(mockPrisma.machine.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'vm-1' }, data: { nodeId: 'node-B', status: 'off' }
    }))
  })

  it('refuses (and rolls back) when the VM process is still alive on the source', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue(machine as never)
    mockPrisma.node.findUnique.mockResolvedValue(targetNode() as never)
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 1 } as never)
    const a = adapter()

    await expect(new VMMigrationService(mockPrisma as never, { storageAdapter: a, livenessProbe: probe(true) })
      .migrateStoppedMachineToNode('vm-1', 'node-B')).rejects.toThrow(/still alive/i)

    expect(a.prepareMachineStorage).not.toHaveBeenCalled() // never touched the disk
    // Rolled the 'moving' claim back to the prior status (the LAST updateMany call).
    const calls = (mockPrisma.machine.updateMany as unknown as jest.Mock).mock.calls
    expect(calls[calls.length - 1][0]).toMatchObject({ where: { id: 'vm-1', status: 'moving' }, data: { status: 'off' } })
  })

  it('bails when the atomic claim loses the race (count 0 — concurrent migration/power op)', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue(machine as never)
    mockPrisma.node.findUnique.mockResolvedValue(targetNode() as never)
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 0 } as never)
    const a = adapter()

    await expect(new VMMigrationService(mockPrisma as never, { storageAdapter: a, livenessProbe: probe(false) })
      .migrateStoppedMachineToNode('vm-1', 'node-B')).rejects.toThrow(/busy|no longer in a migratable/i)
    expect(a.prepareMachineStorage).not.toHaveBeenCalled()
  })

  it('rejects a non-migratable (running) VM before any claim', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({ ...machine, status: 'running' } as never)
    await expect(new VMMigrationService(mockPrisma as never, { storageAdapter: adapter() })
      .migrateStoppedMachineToNode('vm-1', 'node-B')).rejects.toThrow(/Only stopped VMs/i)
    expect(mockPrisma.machine.updateMany).not.toHaveBeenCalled()
  })

  it('is a no-op when the VM already lives on the target node', async () => {
    mockPrisma.machine.findUnique.mockResolvedValue({ ...machine, nodeId: 'node-B' } as never)
    const a = adapter()
    const r = await new VMMigrationService(mockPrisma as never, { storageAdapter: a }).migrateStoppedMachineToNode('vm-1', 'node-B')
    expect(r.success).toBe(true)
    expect(mockPrisma.machine.updateMany).not.toHaveBeenCalled()
    expect(a.prepareMachineStorage).not.toHaveBeenCalled()
  })
})
