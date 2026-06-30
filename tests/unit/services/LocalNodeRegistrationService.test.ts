import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'

jest.mock('systeminformation', () => ({
  __esModule: true,
  default: {
    cpu: jest.fn(),
    mem: jest.fn(),
    blockDevices: jest.fn()
  }
}))

import si from 'systeminformation'

import { LocalNodeRegistrationService } from '../../../app/services/node/LocalNodeRegistrationService'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockNode } from '../../setup/mock-factories'

const mockedSi = si as jest.Mocked<typeof si>
type CpuResult = Awaited<ReturnType<typeof si.cpu>>
type MemResult = Awaited<ReturnType<typeof si.mem>>
type BlockDevicesResult = Awaited<ReturnType<typeof si.blockDevices>>

describe('LocalNodeRegistrationService', () => {
  let service: LocalNodeRegistrationService

  beforeEach(() => {
    service = new LocalNodeRegistrationService(mockPrisma)
    jest.clearAllMocks()

    // Phase 0: registerLocalNode now stamps role/status/address/lastHeartbeat and
    // adopts orphan VMs (machine.updateMany). Default to a deterministic 'master'
    // with no address, and a no-op adoption.
    delete process.env.INFINIBAY_NODE_ROLE
    delete process.env.HOST_IP
    delete process.env.APP_HOST
    mockPrisma.machine.updateMany.mockResolvedValue({ count: 0 } as never)

    mockedSi.cpu.mockResolvedValue({
      cores: 12,
      flags: 'vmx aes avx2'
    } as CpuResult)
    mockedSi.mem.mockResolvedValue({
      total: 32 * 1024 * 1024 * 1024
    } as MemResult)
    mockedSi.blockDevices.mockResolvedValue([
      { name: 'sda', type: 'disk', interfaceType: 'sata' },
      { name: 'nvme0n1', type: 'disk', interfaceType: 'nvme' },
      { name: 'loop0', type: 'loop' },
      { name: 'sdb', type: 'disk', interfaceType: 'usb', removable: true }
    ] as unknown as BlockDevicesResult)
  })

  it('detects local hardware and filters non-storage devices', async () => {
    process.env.INFINIBAY_NODE_NAME = 'node-alpha'

    const result = await service.detectLocalHardware()

    expect(result).toEqual({
      name: 'node-alpha',
      currentRaid: 'raid1',
      cpuFlags: {
        raw: 'vmx aes avx2',
        values: ['vmx', 'aes', 'avx2']
      },
      ram: 32768,
      cores: 12,
      disks: [
        { path: '/dev/sda', status: 'healthy' },
        { path: '/dev/nvme0n1', status: 'healthy' }
      ]
    })
  })

  it('creates the local node and replaces disk inventory', async () => {
    const createdNode = createMockNode({ id: 'node-1', name: 'node-alpha' })
    process.env.INFINIBAY_NODE_NAME = 'node-alpha'

    mockPrisma.node.findFirst.mockResolvedValue(null)
    mockPrisma.node.create.mockResolvedValue(createdNode)

    const result = await service.registerLocalNode()

    expect(result).toEqual(createdNode)
    expect(mockPrisma.node.create).toHaveBeenCalledWith({
      data: {
        name: 'node-alpha',
        currentRaid: 'raid1',
        cpuFlags: {
          raw: 'vmx aes avx2',
          values: ['vmx', 'aes', 'avx2']
        },
        ram: 32768,
        cores: 12,
        maintenanceMode: false,
        role: 'master',
        status: 'online',
        address: null,
        lastHeartbeat: expect.any(Date)
      }
    })
    // Phase 0 backfill (G0): the master adopts VMs with no node assignment so the
    // node-scoped reconcile/reaper manages them.
    expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
      where: { nodeId: null },
      data: { nodeId: createdNode.id }
    })
    expect(mockPrisma.disk.deleteMany).toHaveBeenCalledWith({
      where: { nodeId: createdNode.id }
    })
    expect(mockPrisma.disk.createMany).toHaveBeenCalledWith({
      data: [
        { nodeId: createdNode.id, path: '/dev/sda', status: 'healthy' },
        { nodeId: createdNode.id, path: '/dev/nvme0n1', status: 'healthy' }
      ]
    })
  })

  it('updates an existing local node instead of creating a duplicate', async () => {
    const existingNode = createMockNode({ id: 'node-1', name: 'node-alpha' })
    const updatedNode = createMockNode({ id: 'node-1', name: 'node-alpha', cores: 12 })
    process.env.INFINIBAY_NODE_NAME = 'node-alpha'

    mockPrisma.node.findFirst.mockResolvedValue(existingNode)
    mockPrisma.node.update.mockResolvedValue(updatedNode)

    const result = await service.registerLocalNode()

    expect(result).toEqual(updatedNode)
    expect(mockPrisma.node.update).toHaveBeenCalledWith({
      where: { id: existingNode.id },
      data: {
        currentRaid: 'raid1',
        cpuFlags: {
          raw: 'vmx aes avx2',
          values: ['vmx', 'aes', 'avx2']
        },
        ram: 32768,
        cores: 12,
        role: 'master',
        status: 'online',
        address: null,
        lastHeartbeat: expect.any(Date)
      }
    })
    expect(mockPrisma.machine.updateMany).toHaveBeenCalledWith({
      where: { nodeId: null },
      data: { nodeId: updatedNode.id }
    })
    expect(mockPrisma.node.create).not.toHaveBeenCalled()
  })
})
