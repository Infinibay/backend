import 'reflect-metadata'
import logger from '@main/logger'
import {
  createTestPrismaClient,
  resetTestPrismaClient,
  cleanDatabase,
  rollbackTransaction,
  TEST_DATABASE_URL
} from './prisma-test-client'

// ── Prisma test client singleton ──────────────────────────────────────────────

export const testPrisma = createTestPrismaClient({ verbose: false })

// ── Mock: Replace the real @utils/database singleton with the test client ─────
//
// By mocking '@utils/database', every module that does:
//     import prisma from '@utils/database'
// will receive the testPrisma instance instead of the real singleton.
// This means services, resolvers, cron jobs, etc. all hit the test DB transparently.

jest.mock('@utils/database', () => ({
  __esModule: true,
  default: testPrisma.prisma
}))

// ── Export the enums from @prisma/client (these are plain values, no DB needed) ─

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Prisma, ...enums } = require('@prisma/client')

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

// ── Backward-compatible mockPrisma export ──────────────────────────────────────
//
// Existing tests that import { mockPrisma } from '../setup/jest.setup'
// will receive an auto-mocked PrismaClient that mirrors the real DB.
// This prevents breaking tests that still use mockPrisma.mockReturnValue etc.
// NOTE: mockPrisma is UNCONNECTED from testPrisma — prefer using testPrisma directly.
const mockPrisma = testPrisma.prisma

// ── Environment variables for testing ─────────────────────────────────────────

process.env.DATABASE_URL = TEST_DATABASE_URL
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

afterEach(async () => {
  await rollbackTransaction(testPrisma)
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
