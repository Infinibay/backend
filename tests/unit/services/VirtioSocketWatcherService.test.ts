import 'reflect-metadata'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { EventEmitter } from 'events'
import { VirtioSocketWatcherService, createVirtioSocketWatcherService } from '../../../app/services/VirtioSocketWatcherService'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockContext } from '../../setup/test-helpers'

// Mock chokidar
const mockWatcher = new EventEmitter() as any
mockWatcher.close = jest.fn().mockResolvedValue(undefined)

jest.mock('chokidar', () => ({
  watch: jest.fn(() => mockWatcher)
}))

// Mock fs
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    unlink: jest.fn().mockResolvedValue(undefined)
  },
  access: jest.fn((path, mode, cb) => cb(null)),
  existsSync: jest.fn().mockReturnValue(true)
}))

// Mock net.Socket
class MockSocket extends EventEmitter {
  connect = jest.fn()
  write = jest.fn()
  destroy = jest.fn()
  removeAllListeners = jest.fn(() => {
    super.removeAllListeners()
    return this
  })
}

jest.mock('net', () => ({
  Socket: jest.fn(() => new MockSocket())
}))

describe('VirtioSocketWatcherService', () => {
  let service: VirtioSocketWatcherService
  let mockSocket: MockSocket
  const baseDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
  const socketsDir = path.join(baseDir, 'sockets')

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset the singleton
    (global as any).virtioSocketWatcherService = null

    // Create service with mock prisma
    service = createVirtioSocketWatcherService(mockPrisma as any)

    // Get the mock socket instance
    mockSocket = new MockSocket();
    (net.Socket as any).mockImplementation(() => mockSocket)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Service Lifecycle', () => {
    it('should start the service successfully', async () => {
      await service.start()

      expect(fs.promises.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('sockets'),
        { recursive: true }
      )

      const chokidar = require('chokidar')
      expect(chokidar.watch).toHaveBeenCalledWith(
        expect.stringContaining('sockets'),
        expect.objectContaining({
          persistent: true,
          ignoreInitial: false
        })
      )
    })

    it('should stop the service and clean up connections', async () => {
      await service.start()

      // Simulate a socket connection
      const socketPath = path.join(socketsDir, 'test-vm.socket')
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: 'test-vm',
        name: 'Test VM',
        status: 'running'
      } as any)

      mockWatcher.emit('add', socketPath)
      await new Promise(resolve => setTimeout(resolve, 100))

      await service.stop()

      expect((mockWatcher as any).close).toHaveBeenCalled()
      expect(mockSocket.destroy).toHaveBeenCalled()
    })

    it('should not start if already running', async () => {
      await service.start()
      await service.start()

      const chokidar = require('chokidar')
      expect(chokidar.watch).toHaveBeenCalledTimes(1)
    })
  })

  describe('Socket Connection Management', () => {
    beforeEach(async () => {
      await service.start()
    })

    it('should connect to VM when socket file is added', async () => {
      const vmId = 'test-vm-123'
      const socketPath = path.join(socketsDir, `${vmId}.socket`)

      mockPrisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        status: 'running'
      } as any)

      mockWatcher.emit('add', socketPath)
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: vmId },
        select: { id: true, name: true, status: true }
      })
      expect(mockSocket.connect).toHaveBeenCalledWith(socketPath)
    })

    it('should ignore non-socket files', async () => {
      const filePath = path.join(socketsDir, 'random.txt')

      mockWatcher.emit('add', filePath)
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockPrisma.machine.findUnique).not.toHaveBeenCalled()
      expect(mockSocket.connect).not.toHaveBeenCalled()
    })

    it('should not connect if VM does not exist in database', async () => {
      const socketPath = path.join(socketsDir, 'unknown-vm.socket')

      mockPrisma.machine.findUnique.mockResolvedValue(null)

      mockWatcher.emit('add', socketPath)
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockSocket.connect).not.toHaveBeenCalled()
    })

    it('should close connection when socket file is removed', async () => {
      const vmId = 'test-vm'
      const socketPath = path.join(socketsDir, `${vmId}.socket`)

      // First connect
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        status: 'running'
      } as any)

      mockWatcher.emit('add', socketPath)
      await new Promise(resolve => setTimeout(resolve, 100))

      // Then remove
      mockWatcher.emit('unlink', socketPath)
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockSocket.destroy).toHaveBeenCalled()
    })
  })

  describe('Message Processing', () => {
    beforeEach(async () => {
      await service.start()

      // Setup a connected VM
      const vmId = 'test-vm'
      const socketPath = path.join(socketsDir, `${vmId}.socket`)

      mockPrisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        status: 'running'
      } as any)

      mockWatcher.emit('add', socketPath)
      await new Promise(resolve => setTimeout(resolve, 100))
      mockSocket.emit('connect')
    })

    it('should respond to ping with pong', async () => {
      const pingMessage = JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }) + '\n'

      mockSocket.emit('data', Buffer.from(pingMessage))
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockSocket.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"pong"')
      )
    })

    it('should store metrics in database', async () => {
      const metricsMessage = {
        type: 'metrics',
        timestamp: new Date().toISOString(),
        data: {
          system: {
            cpu: {
              usage_percent: 45.5,
              cores_usage: [50, 40, 45, 42],
              temperature: 65
            },
            memory: {
              total_kb: 8388608,
              used_kb: 4194304,
              available_kb: 4194304,
              swap_total_kb: 2097152,
              swap_used_kb: 0
            },
            disk: {
              usage_stats: [
                {
                  mount_point: '/',
                  total_gb: 100,
                  used_gb: 50,
                  available_gb: 50
                }
              ],
              io_stats: {
                read_bytes_per_sec: 1024,
                write_bytes_per_sec: 2048,
                read_ops_per_sec: 10,
                write_ops_per_sec: 20
              }
            },
            network: {
              interfaces: [
                {
                  name: 'eth0',
                  bytes_received: 1000000,
                  bytes_sent: 500000,
                  packets_received: 1000,
                  packets_sent: 500
                }
              ]
            },
            uptime_seconds: 3600,
            load_average: {
              load_1min: 1.5,
              load_5min: 1.2,
              load_15min: 1.0
            }
          }
        }
      }

      mockPrisma.systemMetrics.create.mockResolvedValue({
        id: 'metrics-1',
        machineId: 'test-vm',
        cpuUsagePercent: 45.5,
        cpuCoresUsage: [50, 40, 45, 42],
        cpuTemperature: 65,
        totalMemoryKB: BigInt(8388608),
        usedMemoryKB: BigInt(4194304),
        availableMemoryKB: BigInt(4194304),
        swapTotalKB: BigInt(2097152),
        swapUsedKB: BigInt(0),
        diskUsageStats: metricsMessage.data.system.disk.usage_stats,
        diskIOStats: metricsMessage.data.system.disk.io_stats,
        networkStats: metricsMessage.data.system.network.interfaces,
        uptime: BigInt(3600),
        loadAverage: metricsMessage.data.system.load_average,
        timestamp: new Date()
      } as any)

      mockSocket.emit('data', Buffer.from(JSON.stringify(metricsMessage) + '\n'))
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockPrisma.systemMetrics.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            machineId: 'test-vm',
            cpuUsagePercent: 45.5
          })
        })
      )
    })

    it('should handle malformed JSON gracefully', async () => {
      const badMessage = 'not valid json\n'

      // Should not throw
      expect(() => {
        mockSocket.emit('data', Buffer.from(badMessage))
      }).not.toThrow()
    })

    it('should handle partial messages and buffer them', async () => {
      const message = JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() })
      const part1 = message.slice(0, 10)
      const part2 = message.slice(10) + '\n'

      mockSocket.emit('data', Buffer.from(part1))
      mockSocket.emit('data', Buffer.from(part2))
      await new Promise(resolve => setTimeout(resolve, 100))

      expect(mockSocket.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"pong"')
      )
    })
  })

  describe('Reconnection Logic', () => {
    beforeEach(async () => {
      await service.start()
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should attempt reconnection on socket error', async () => {
      const vmId = 'test-vm'
      const socketPath = path.join(socketsDir, `${vmId}.socket`)

      mockPrisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        status: 'running'
      } as any)

      mockWatcher.emit('add', socketPath)
      await Promise.resolve()

      // Simulate connection error
      mockSocket.emit('error', new Error('Connection failed'))

      // Fast-forward time to trigger reconnection
      jest.advanceTimersByTime(1000)

      // Socket file still exists
      ;(fs.access as any).mockImplementation((path: string, mode: any, cb: any) => cb(null))

      jest.advanceTimersByTime(1000)
      await Promise.resolve()

      // Should attempt reconnection (connect called twice)
      expect(mockSocket.connect).toHaveBeenCalledTimes(2)
    })
  })

  describe('Health Monitoring', () => {
    beforeEach(async () => {
      await service.start()
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should send periodic ping messages', async () => {
      const vmId = 'test-vm'
      const socketPath = path.join(socketsDir, `${vmId}.socket`)

      mockPrisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        status: 'running'
      } as any)

      mockWatcher.emit('add', socketPath)
      await Promise.resolve()
      mockSocket.emit('connect')

      // Clear previous calls
      mockSocket.write.mockClear()

      // Fast-forward 30 seconds (ping interval)
      jest.advanceTimersByTime(30000)

      expect(mockSocket.write).toHaveBeenCalledWith(
        expect.stringContaining('"type":"ping"')
      )
    })
  })

  describe('Statistics and Monitoring', () => {
    it('should return correct connection statistics', async () => {
      await service.start()

      // Add two VMs
      const vm1 = { id: 'vm-1', name: 'VM 1', status: 'running' } as any
      const vm2 = { id: 'vm-2', name: 'VM 2', status: 'running' } as any

      mockPrisma.machine.findUnique
        .mockResolvedValueOnce(vm1)
        .mockResolvedValueOnce(vm2)

      // Create two different sockets
      const socket1 = new MockSocket()
      const socket2 = new MockSocket()
      ;(net.Socket as any)
        .mockImplementationOnce(() => socket1)
        .mockImplementationOnce(() => socket2)

      mockWatcher.emit('add', path.join(socketsDir, 'vm-1.socket'))
      mockWatcher.emit('add', path.join(socketsDir, 'vm-2.socket'))
      await new Promise(resolve => setTimeout(resolve, 100))

      // Connect first VM
      socket1.emit('connect')

      const stats = service.getConnectionStats()
      expect(stats.totalConnections).toBe(2)
      expect(stats.activeConnections).toBe(1)
      expect(stats.connections).toHaveLength(2)
    })
  })

  describe('VM Cleanup', () => {
    it('should cleanup VM connection and socket file', async () => {
      await service.start()

      const vmId = 'test-vm'
      const socketPath = path.join(socketsDir, `${vmId}.socket`)

      // Setup connection
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        status: 'running'
      } as any)

      mockWatcher.emit('add', socketPath)
      await new Promise(resolve => setTimeout(resolve, 100))

      // Cleanup
      await service.cleanupVmConnection(vmId)

      expect(mockSocket.destroy).toHaveBeenCalled()
      expect(fs.promises.unlink).toHaveBeenCalledWith(socketPath)
    })

    it('should handle cleanup when socket file does not exist', async () => {
      await service.start()

      ;(fs.promises.unlink as jest.Mock).mockRejectedValue({ code: 'ENOENT' })

      // Should not throw
      await expect(service.cleanupVmConnection('non-existent-vm')).resolves.not.toThrow()
    })
  })
})
