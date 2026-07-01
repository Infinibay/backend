import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { Disk, Machine, Node } from '@prisma/client'

import { NodeResolver } from '../../../app/graphql/resolvers/node/resolver'
import { InfinibayContext } from '../../../app/utils/context'
import { mockPrisma } from '../../setup/jest.setup'
import { createAdminContext } from '../../setup/test-helpers'
import { createMockDisk, createMockNode } from '../../setup/mock-factories'

type NodeWithInventory = Node & {
  disks: Disk[]
  machines: Array<Pick<Machine, 'status' | 'cpuCores' | 'ramGB' | 'diskSizeGB'>>
}

const nodeInclude = {
  disks: true,
  machines: {
    select: {
      status: true,
      cpuCores: true,
      ramGB: true,
      diskSizeGB: true
    }
  }
}

describe('NodeResolver', () => {
  let resolver: NodeResolver
  const ctx = createAdminContext() as InfinibayContext

  beforeEach(() => {
    resolver = new NodeResolver()
    jest.clearAllMocks()
  })

  it('returns nodes with derived health and disk counts', async () => {
    const freshNode = createMockNode({
      id: 'node-1',
      name: 'alpha',
      updatedAt: new Date()
    })
    const staleNode = createMockNode({
      id: 'node-2',
      name: 'beta',
      updatedAt: new Date(Date.now() - 10 * 60 * 1000)
    })

    const nodes: NodeWithInventory[] = [
      {
        ...freshNode,
        disks: [
          createMockDisk({ id: 'disk-1', nodeId: freshNode.id, status: 'healthy' }),
          createMockDisk({ id: 'disk-2', nodeId: freshNode.id, status: 'failed' })
        ],
        machines: [
          { status: 'running', cpuCores: 4, ramGB: 8, diskSizeGB: 100 },
          { status: 'off', cpuCores: 2, ramGB: 4, diskSizeGB: 50 }
        ]
      },
      {
        ...staleNode,
        disks: [
          createMockDisk({ id: 'disk-3', nodeId: staleNode.id, status: 'online' })
        ],
        machines: []
      }
    ]

    mockPrisma.node.findMany.mockResolvedValue(nodes)

    const result = await resolver.nodes(ctx)

    expect(mockPrisma.node.findMany).toHaveBeenCalledWith({
      include: nodeInclude,
      orderBy: { name: 'asc' }
    })
    expect(result).toEqual([
      expect.objectContaining({
        id: freshNode.id,
        maintenanceMode: false,
        health: 'online',
        diskCount: 2,
        healthyDiskCount: 1,
        availableCores: freshNode.cores - 6,
        availableRamGB: Math.floor(freshNode.ram / 1024) - 12,
        machineCount: 2,
        runningMachineCount: 1
      }),
      expect.objectContaining({
        id: staleNode.id,
        health: 'stale',
        diskCount: 1,
        healthyDiskCount: 1,
        machineCount: 0,
        runningMachineCount: 0
      })
    ])
  })

  it('returns a single node by id', async () => {
    const node = createMockNode({ id: 'node-1' })
    const nodeWithDisks: NodeWithInventory = {
      ...node,
      disks: [],
      machines: []
    }

    mockPrisma.node.findUnique.mockResolvedValue(nodeWithDisks)

    const result = await resolver.node(node.id, ctx)

    expect(mockPrisma.node.findUnique).toHaveBeenCalledWith({
      where: { id: node.id },
      include: nodeInclude
    })
    expect(result).toEqual(expect.objectContaining({
      id: node.id,
      diskCount: 0,
      healthyDiskCount: 0
    }))
  })

  it('returns null when a node does not exist', async () => {
    mockPrisma.node.findUnique.mockResolvedValue(null)

    await expect(resolver.node('missing-node', ctx)).resolves.toBeNull()
  })

  it('updates node maintenance mode', async () => {
    const node = createMockNode({
      id: 'node-1',
      maintenanceMode: true
    })
    const nodeWithDisks: NodeWithInventory = {
      ...node,
      disks: [],
      machines: []
    }

    // The resolver now pre-checks existence (clean NOT_FOUND instead of a raw
    // Prisma P2025) before updating; provide the existence lookup.
    mockPrisma.node.findUnique.mockResolvedValue({ id: node.id } as never)
    mockPrisma.node.update.mockResolvedValue(nodeWithDisks)

    const result = await resolver.setNodeMaintenanceMode(node.id, true, ctx)

    expect(mockPrisma.node.update).toHaveBeenCalledWith({
      where: { id: node.id },
      data: { maintenanceMode: true },
      include: nodeInclude
    })
    expect(result).toEqual(expect.objectContaining({
      id: node.id,
      maintenanceMode: true
    }))
  })

  it('summarizes node inventory capacity', async () => {
    const freshNode = createMockNode({
      id: 'node-1',
      cores: 16,
      ram: 32768,
      updatedAt: new Date()
    })
    const staleNode = createMockNode({
      id: 'node-2',
      cores: 8,
      ram: 16384,
      updatedAt: new Date(Date.now() - 10 * 60 * 1000)
    })

    const nodes: NodeWithInventory[] = [
      {
        ...freshNode,
        disks: [createMockDisk({ nodeId: freshNode.id })],
        machines: []
      },
      {
        ...staleNode,
        disks: [
          createMockDisk({ nodeId: staleNode.id }),
          createMockDisk({ nodeId: staleNode.id })
        ],
        machines: []
      }
    ]

    mockPrisma.node.findMany.mockResolvedValue(nodes)

    const result = await resolver.nodeInventorySummary(ctx)

    expect(result).toEqual({
      totalNodes: 2,
      onlineNodes: 1,
      staleNodes: 1,
      totalCores: 24,
      totalRam: 49152,
      totalDisks: 3
    })
  })
})
