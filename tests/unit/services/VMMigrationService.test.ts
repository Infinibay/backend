import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

import { VMMigrationService } from '../../../app/services/node/VMMigrationService'
import { createMockMachine, createMockMachineConfiguration, createMockNode } from '../../setup/mock-factories'

type TargetNodeWithMachines = ReturnType<typeof createMockNode> & {
  machines: Array<ReturnType<typeof createMockMachine>>
}

describe('VMMigrationService', () => {
  let prisma: DeepMockProxy<PrismaClient>
  let service: VMMigrationService

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>()
    service = new VMMigrationService(prisma, { storageMode: 'shared' })
  })

  it('moves a stopped VM to a healthy node with enough capacity', async () => {
    const machine = createMockMachine({
      id: 'vm-1',
      status: 'off',
      nodeId: 'node-a',
      cpuCores: 4,
      ramGB: 8
    })
    const targetNode: TargetNodeWithMachines = {
      ...createMockNode({
        id: 'node-b',
        maintenanceMode: false,
        cores: 16,
        ram: 32768
      }),
      machines: [
        createMockMachine({ cpuCores: 2, ramGB: 4, diskSizeGB: 50 })
      ]
    }

    prisma.machine.findUnique.mockResolvedValue(machine)
    prisma.node.findUnique.mockResolvedValue(targetNode)
    prisma.machine.update.mockResolvedValue({ ...machine, nodeId: 'node-b' })

    const result = await service.migrateStoppedMachineToNode('vm-1', 'node-b')

    expect(result).toEqual({
      success: true,
      machineId: 'vm-1',
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b'
    })
    expect(prisma.machine.update).toHaveBeenCalledWith({
      where: { id: 'vm-1' },
      data: { nodeId: 'node-b' }
    })
  })

  it('rejects cross-node migration when storage migration is not configured', async () => {
    service = new VMMigrationService(prisma, { storageMode: 'external' })
    const machine = {
      ...createMockMachine({
        id: 'vm-1',
        status: 'off',
        nodeId: 'node-a',
        cpuCores: 4,
        ramGB: 8
      }),
      configuration: createMockMachineConfiguration({
        machineId: 'vm-1',
        diskPaths: ['/var/lib/infinization/disks/vm-1.qcow2']
      })
    }
    const targetNode: TargetNodeWithMachines = {
      ...createMockNode({
        id: 'node-b',
        maintenanceMode: false,
        cores: 16,
        ram: 32768
      }),
      machines: []
    }

    prisma.machine.findUnique.mockResolvedValue(machine)
    prisma.node.findUnique.mockResolvedValue(targetNode)

    await expect(service.migrateStoppedMachineToNode('vm-1', 'node-b'))
      .rejects.toThrow('VM storage migration is not configured')
    expect(prisma.machine.update).not.toHaveBeenCalled()
  })

  it('uses a storage migration adapter before updating node assignment', async () => {
    const prepareMachineStorage = jest.fn(async (_params: {
      machineId: string
      sourceNodeId: string | null
      targetNodeId: string
      diskPaths: string[]
    }) => {
      void _params
    })
    service = new VMMigrationService(prisma, {
      storageAdapter: {
        prepareMachineStorage
      }
    })
    const machine = {
      ...createMockMachine({
        id: 'vm-1',
        status: 'off',
        nodeId: 'node-a',
        cpuCores: 4,
        ramGB: 8
      }),
      configuration: createMockMachineConfiguration({
        machineId: 'vm-1',
        diskPaths: ['/var/lib/infinization/disks/vm-1.qcow2']
      })
    }
    const targetNode: TargetNodeWithMachines = {
      ...createMockNode({
        id: 'node-b',
        maintenanceMode: false,
        cores: 16,
        ram: 32768
      }),
      machines: []
    }

    prisma.machine.findUnique.mockResolvedValue(machine)
    prisma.node.findUnique.mockResolvedValue(targetNode)
    prisma.machine.update.mockResolvedValue({ ...machine, nodeId: 'node-b' })

    await service.migrateStoppedMachineToNode('vm-1', 'node-b')

    expect(prepareMachineStorage).toHaveBeenCalledWith({
      machineId: 'vm-1',
      sourceNodeId: 'node-a',
      targetNodeId: 'node-b',
      diskPaths: ['/var/lib/infinization/disks/vm-1.qcow2']
    })
    expect(prisma.machine.update).toHaveBeenCalledWith({
      where: { id: 'vm-1' },
      data: { nodeId: 'node-b' }
    })
  })

  it('rejects running VMs', async () => {
    prisma.machine.findUnique.mockResolvedValue(createMockMachine({
      id: 'vm-1',
      status: 'running',
      nodeId: 'node-a'
    }))

    await expect(service.migrateStoppedMachineToNode('vm-1', 'node-b'))
      .rejects.toThrow('Only stopped VMs can be migrated between nodes right now')
  })

  it('rejects target nodes in maintenance mode', async () => {
    prisma.machine.findUnique.mockResolvedValue(createMockMachine({
      id: 'vm-1',
      status: 'off',
      nodeId: 'node-a'
    }))
    const targetNode: TargetNodeWithMachines = {
      ...createMockNode({ id: 'node-b', maintenanceMode: true }),
      machines: []
    }
    prisma.node.findUnique.mockResolvedValue(targetNode)

    await expect(service.migrateStoppedMachineToNode('vm-1', 'node-b'))
      .rejects.toThrow('Target node is in maintenance mode')
  })

  it('rejects stale target nodes', async () => {
    prisma.machine.findUnique.mockResolvedValue(createMockMachine({
      id: 'vm-1',
      status: 'off',
      nodeId: 'node-a'
    }))
    const targetNode: TargetNodeWithMachines = {
      ...createMockNode({
        id: 'node-b',
        maintenanceMode: false,
        updatedAt: new Date(Date.now() - 10 * 60 * 1000)
      }),
      machines: []
    }
    prisma.node.findUnique.mockResolvedValue(targetNode)

    await expect(service.migrateStoppedMachineToNode('vm-1', 'node-b'))
      .rejects.toThrow('Target node is stale')
  })

  it('rejects target nodes without enough available CPU or memory', async () => {
    prisma.machine.findUnique.mockResolvedValue(createMockMachine({
      id: 'vm-1',
      status: 'off',
      nodeId: 'node-a',
      cpuCores: 8,
      ramGB: 16
    }))
    const targetNode: TargetNodeWithMachines = {
      ...createMockNode({
        id: 'node-b',
        maintenanceMode: false,
        cores: 8,
        ram: 16384
      }),
      machines: [
        createMockMachine({ cpuCores: 4, ramGB: 8 })
      ]
    }
    prisma.node.findUnique.mockResolvedValue(targetNode)

    await expect(service.migrateStoppedMachineToNode('vm-1', 'node-b'))
      .rejects.toThrow('Target node does not have enough available CPU or memory')
  })
})
