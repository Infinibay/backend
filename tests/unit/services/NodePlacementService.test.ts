import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { Prisma, PrismaClient } from '@prisma/client'

import { NodePlacementService } from '../../../app/services/node/NodePlacementService'

describe('NodePlacementService', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: NodePlacementService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new NodePlacementService(prisma as unknown as Prisma.TransactionClient)
    process.env.INFINIBAY_NODE_NAME = 'node-local'
  })

  const now = new Date()

  it('returns null when no nodes are registered', async () => {
    prisma.node.findMany.mockResolvedValue([])

    await expect(service.chooseNodeForMachine({
      cpuCores: 4,
      ramGB: 8,
      diskSizeGB: 100
    })).resolves.toBeNull()
  })

  it('prefers the local node when it has enough remaining capacity', async () => {
    prisma.node.findMany.mockResolvedValue([
      {
        id: 'node-local-id',
        name: 'node-local',
        cores: 16,
        ram: 32768,
        updatedAt: now,
        maintenanceMode: false,
        machines: []
      },
      {
        id: 'node-remote-id',
        name: 'node-remote',
        cores: 32,
        ram: 65536,
        updatedAt: now,
        maintenanceMode: false,
        machines: []
      }
    ] as never)

    await expect(service.chooseNodeForMachine({
      cpuCores: 4,
      ramGB: 8,
      diskSizeGB: 100
    })).resolves.toBe('node-local-id')
  })

  it('chooses another node when the local node is full', async () => {
    prisma.node.findMany.mockResolvedValue([
      {
        id: 'node-local-id',
        name: 'node-local',
        cores: 8,
        ram: 16384,
        updatedAt: now,
        maintenanceMode: false,
        machines: [
          { cpuCores: 8, ramGB: 16, diskSizeGB: 100 }
        ]
      },
      {
        id: 'node-remote-id',
        name: 'node-remote',
        cores: 32,
        ram: 65536,
        updatedAt: now,
        maintenanceMode: false,
        machines: [
          { cpuCores: 4, ramGB: 8, diskSizeGB: 100 }
        ]
      }
    ] as never)

    await expect(service.chooseNodeForMachine({
      cpuCores: 4,
      ramGB: 8,
      diskSizeGB: 100
    })).resolves.toBe('node-remote-id')
  })

  it('returns null when no node has enough CPU or memory', async () => {
    prisma.node.findMany.mockResolvedValue([
      {
        id: 'node-small',
        name: 'node-small',
        cores: 4,
        ram: 8192,
        updatedAt: now,
        maintenanceMode: false,
        machines: []
      }
    ] as never)

    await expect(service.chooseNodeForMachine({
      cpuCores: 8,
      ramGB: 16,
      diskSizeGB: 100
    })).resolves.toBeNull()
  })

  it('skips nodes in maintenance mode', async () => {
    prisma.node.findMany.mockResolvedValue([
      {
        id: 'node-local-id',
        name: 'node-local',
        cores: 32,
        ram: 65536,
        updatedAt: now,
        maintenanceMode: true,
        machines: []
      },
      {
        id: 'node-remote-id',
        name: 'node-remote',
        cores: 16,
        ram: 32768,
        updatedAt: now,
        maintenanceMode: false,
        machines: []
      }
    ] as never)

    await expect(service.chooseNodeForMachine({
      cpuCores: 4,
      ramGB: 8,
      diskSizeGB: 100
    })).resolves.toBe('node-remote-id')
  })

  it('skips stale nodes', async () => {
    const staleDate = new Date(Date.now() - 10 * 60 * 1000)
    prisma.node.findMany.mockResolvedValue([
      {
        id: 'node-local-id',
        name: 'node-local',
        cores: 32,
        ram: 65536,
        updatedAt: staleDate,
        maintenanceMode: false,
        machines: []
      },
      {
        id: 'node-remote-id',
        name: 'node-remote',
        cores: 16,
        ram: 32768,
        updatedAt: now,
        maintenanceMode: false,
        machines: []
      }
    ] as never)

    await expect(service.chooseNodeForMachine({
      cpuCores: 4,
      ramGB: 8,
      diskSizeGB: 100
    })).resolves.toBe('node-remote-id')
  })
})
