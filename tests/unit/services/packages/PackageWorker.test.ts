import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { PackageWorker } from '../../../../app/services/packages/PackageWorker'
import { PackageManifest, PackageCheckerContext } from '../../../../app/services/packages/types'
import fs from 'fs/promises'
import path from 'path'
import { tmpdir } from 'os'

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({
    stdin: { write: jest.fn() },
    stdout: {
      on: jest.fn(),
      once: jest.fn((event: string, cb: (data: Buffer) => void) => {
        // Simulate ready response
        setTimeout(() => cb(Buffer.from('{"ready":true}\n')), 10)
      })
    },
    stderr: { on: jest.fn() },
    on: jest.fn(),
    kill: jest.fn(),
    pid: 12345
  }))
}))

describe('PackageWorker', () => {
  let worker: PackageWorker
  let testDir: string

  const createValidManifest = (overrides: Partial<PackageManifest> = {}): PackageManifest => ({
    name: 'test-package',
    displayName: 'Test Package',
    version: '1.0.0',
    description: 'Test package description',
    author: 'Test Author',
    license: 'open-source',
    checkers: [
      {
        name: 'test-checker',
        type: 'info',
        file: 'checkers/test.js',
        dataNeeds: []
      }
    ],
    ...overrides
  })

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `package-worker-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    await fs.mkdir(path.join(testDir, 'checkers'), { recursive: true })

    const mockManifest = createValidManifest()
    await fs.writeFile(
      path.join(testDir, 'manifest.json'),
      JSON.stringify(mockManifest, null, 2)
    )

    await fs.writeFile(
      path.join(testDir, 'checkers/test.js'),
      `module.exports = {
        async analyze(context) {
          return []
        }
      }`
    )

    jest.clearAllMocks()
  })

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
    jest.clearAllMocks()
  })

  describe('Constructor', () => {
    it('should create worker with valid manifest', () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)

      expect(worker).toBeInstanceOf(PackageWorker)
    })
  })

  describe('getName', () => {
    it('should return the package name', () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)

      expect(worker.getName()).toBe('test-package')
    })
  })

  describe('isRunning', () => {
    it('should return false when worker is not spawned', () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)

      expect(worker.isRunning()).toBe(false)
    })

    it('should return true when worker has a process', () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)
      // Mock the internal process state
      ;(worker as any).process = { pid: 12345 }
      ;(worker as any).isShuttingDown = false

      expect(worker.isRunning()).toBe(true)
    })

    it('should return false when worker is shutting down', () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)
      ;(worker as any).process = { pid: 12345 }
      ;(worker as any).isShuttingDown = true

      expect(worker.isRunning()).toBe(false)
    })
  })

  describe('getStats', () => {
    it('should return zero stats when not started', () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)

      const stats = worker.getStats()
      expect(stats.uptime).toBe(0)
      expect(stats.requestCount).toBe(0)
      expect(stats.errorCount).toBe(0)
    })
  })

  describe('shutdown', () => {
    it('should handle already stopped worker', async () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)

      // No process running
      await expect(worker.shutdown()).resolves.not.toThrow()
    })
  })

  describe('analyze', () => {
    it('should throw when worker is not running', async () => {
      const manifest = createValidManifest()
      worker = new PackageWorker(testDir, manifest)

      const context: PackageCheckerContext = {
        vmId: 'test-123',
        settings: {}
      }

      // Worker not spawned, should throw
      await expect(worker.analyze(context)).rejects.toThrow('Worker not running')
    })
  })

  describe('error handling', () => {
    it('should handle invalid manifest format', () => {
      const invalidManifest = 'not a json' as any

      // This may or may not throw depending on implementation
      // The worker stores what you give it
      expect(() => {
        new PackageWorker(testDir, invalidManifest)
      }).not.toThrow()
    })
  })
})
