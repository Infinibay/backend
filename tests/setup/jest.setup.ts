import 'reflect-metadata'
import logger from '@main/logger'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'
import {
  createTestPrismaClient,
  resetTestPrismaClient,
} from './prisma-test-client'

// ── Prisma clients ────────────────────────────────────────────────────────
//
// testPrisma — real PrismaClient pointing at the test database.
// The DB lifecycle hooks (connect / cleanup / disconnect) are at the bottom
// of this file. They run for every test suite (unit and integration alike)
// because this setup file is loaded by all projects. The overhead of
// TRUNCATE is small (~5 ms) and guarantees a clean slate.
//
// mockPrisma — jest-mock-extended deep mock (no DB at all).

export const testPrisma = createTestPrismaClient({ verbose: false })

export const mockPrisma: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>()

// ── Mock @utils/database ──────────────────────────────────────────────────
// Integration tests override this mock to use testPrisma.prisma.
// Unit tests get mockPrisma automatically.

jest.mock('@utils/database', () => ({
  __esModule: true,
  default: mockPrisma
}))

// ── Mock EventManager ──────────────────────────────────────────────────────────

const MockEventManagerClass = class MockEventManager {
  registerResourceManager = jest.fn()
  dispatchEvent = jest.fn()
  vmCreated = jest.fn()
  vmUpdated = jest.fn()
  vmDeleted = jest.fn()
  getStats = jest.fn(() => ({
    registeredManagers: [],
    socketStats: { connectedUsers: 0, userIds: [] }
  }))
}

jest.mock('@services/EventManager', () => ({
  EventManager: MockEventManagerClass,
  createEventManager: jest.fn(() => new MockEventManagerClass()),
  getEventManager: jest.fn(() => new MockEventManagerClass())
}))

// Mock InfinizationService - prevents process.exit(1) from root check & directory check
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => Promise.resolve({
    initialize: jest.fn().mockResolvedValue(undefined),
    destroyVM: jest.fn().mockResolvedValue(undefined),
    createVM: jest.fn().mockResolvedValue(undefined),
    getVMStatus: jest.fn().mockResolvedValue({ processAlive: false }),
    getAllVMs: jest.fn().mockResolvedValue([]),
    startVM: jest.fn().mockResolvedValue(undefined),
    stopVM: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    setPortForwarding: jest.fn().mockResolvedValue(undefined)
  }))
}))

// Mock Socket.io
jest.mock('socket.io', () => ({
  Server: jest.fn(() => ({
    on: jest.fn(),
    use: jest.fn(),
    emit: jest.fn(),
    sockets: {
      emit: jest.fn()
    }
  }))
}))

// Mock systeminformation
jest.mock('systeminformation', () => ({
  graphics: jest.fn(() => ({ controllers: [] })),
  cpu: jest.fn(() => ({ cores: 8 })),
  mem: jest.fn(() => ({ total: 16000000000 }))
}))

// ── Environment variables for testing ─────────────────────────────────────────

process.env.TOKENKEY = 'test-secret-key'
process.env.BCRYPT_ROUNDS = '10'
process.env.PORT = '4001'
process.env.FRONTEND_URL = 'http://localhost:3000'
process.env.APP_HOST = '192.168.1.100'
process.env.GRAPHIC_HOST = '192.168.1.100'
process.env.INFINIBAY_BASE_DIR = '/tmp/infinibay-test'
process.env.VIRTIO_WIN_ISO_PATH = '/tmp/virtio-win.iso'

// ── Lifecycle hooks ────────────────────────────────────────────────────────────

beforeAll(async () => {
  await testPrisma.connect()
  await testPrisma.cleanup()
})

beforeEach(async () => {
  await testPrisma.cleanup()
})

afterAll(async () => {
  await testPrisma.disconnect()
  resetTestPrismaClient()
  jest.restoreAllMocks()
})

// ── Global test utilities ──────────────────────────────────────────────────────

declare global {
  var testTimeout: number
}
global.testTimeout = 30000

// Suppress logger and console errors during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console.error = jest.fn()
  global.console.warn = jest.fn()
  logger.error = jest.fn()
  logger.warn = jest.fn()
  logger.info = jest.fn()
  logger.debug = jest.fn()
}
