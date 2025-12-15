import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended'

// Mock Prisma Client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string
      constructor (message: string, code: string) {
        super(message)
        this.code = code
      }
    }
  },
  // Export the enums for tests to use
  TaskStatus: {
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
    RETRY_SCHEDULED: 'RETRY_SCHEDULED'
  },
  TaskPriority: {
    URGENT: 'URGENT',
    HIGH: 'HIGH',
    MEDIUM: 'MEDIUM',
    LOW: 'LOW'
  },
  HealthCheckType: {
    OVERALL_STATUS: 'OVERALL_STATUS',
    DISK_SPACE: 'DISK_SPACE',
    RESOURCE_OPTIMIZATION: 'RESOURCE_OPTIMIZATION',
    WINDOWS_UPDATES: 'WINDOWS_UPDATES',
    WINDOWS_DEFENDER: 'WINDOWS_DEFENDER',
    APPLICATION_INVENTORY: 'APPLICATION_INVENTORY',
    APPLICATION_UPDATES: 'APPLICATION_UPDATES',
    SECURITY_CHECK: 'SECURITY_CHECK',
    PERFORMANCE_CHECK: 'PERFORMANCE_CHECK',
    SYSTEM_HEALTH: 'SYSTEM_HEALTH',
    CUSTOM_CHECK: 'CUSTOM_CHECK'
  },
  // Firewall enums
  RuleSetType: {
    DEPARTMENT: 'DEPARTMENT',
    VM: 'VM'
  },
  RuleAction: {
    ACCEPT: 'ACCEPT',
    DROP: 'DROP',
    REJECT: 'REJECT'
  },
  RuleDirection: {
    IN: 'IN',
    OUT: 'OUT',
    INOUT: 'INOUT'
  }
}))

// Mock EventManager
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

// Mock Socket.io
jest.mock('socket.io', () => ({
  Server: jest.fn(() => ({
    on: jest.fn(),
    use: jest.fn(), // Add missing use method for middleware
    emit: jest.fn(),
    sockets: {
      emit: jest.fn()
    }
  }))
}))

// Mock systeminformation
jest.mock('systeminformation', () => ({
  graphics: jest.fn(() => ({
    controllers: []
  })),
  cpu: jest.fn(() => ({
    cores: 8
  })),
  mem: jest.fn(() => ({
    total: 16000000000
  }))
}))

// Create mock Prisma instance
export const mockPrisma = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>

// Environment variables for testing
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.TOKENKEY = 'test-secret-key'
process.env.BCRYPT_ROUNDS = '10'
process.env.PORT = '4001'
process.env.FRONTEND_URL = 'http://localhost:3000'
process.env.APP_HOST = '192.168.1.100'
process.env.GRAPHIC_HOST = '192.168.1.100'
process.env.INFINIBAY_BASE_DIR = '/tmp/infinibay-test'
process.env.VIRTIO_WIN_ISO_PATH = '/tmp/virtio-win.iso'

// Reset mocks before each test
beforeEach(() => {
  mockReset(mockPrisma)
  jest.clearAllMocks()
})

// Clean up after all tests
afterAll(async () => {
  jest.restoreAllMocks()
})

// Global test utilities
declare global {
  var testTimeout: number
}
global.testTimeout = 30000

// Suppress console errors during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console.error = jest.fn()
  global.console.warn = jest.fn()
}
