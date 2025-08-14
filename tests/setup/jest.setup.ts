import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { mockDeep, mockReset, DeepMockProxy } from 'jest-mock-extended';

// Mock Prisma Client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(() => mockPrisma),
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message: string, code: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

// Mock EventManager
jest.mock('@services/EventManager', () => ({
  EventManager: {
    getInstance: jest.fn(() => ({
      dispatch: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
    })),
  },
}));

// Mock Socket.io
jest.mock('socket.io', () => ({
  Server: jest.fn(() => ({
    on: jest.fn(),
    emit: jest.fn(),
    sockets: {
      emit: jest.fn(),
    },
  })),
}));

// Mock systeminformation
jest.mock('systeminformation', () => ({
  graphics: jest.fn(() => ({
    controllers: [],
  })),
  cpu: jest.fn(() => ({
    cores: 8,
  })),
  mem: jest.fn(() => ({
    total: 16000000000,
  })),
}));

// Create mock Prisma instance
export const mockPrisma = mockDeep<PrismaClient>() as unknown as DeepMockProxy<PrismaClient>;

// Environment variables for testing
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.TOKENKEY = 'test-secret-key';
process.env.BCRYPT_ROUNDS = '10';
process.env.PORT = '4001';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.APP_HOST = '192.168.1.100';
process.env.GRAPHIC_HOST = '192.168.1.100';
process.env.INFINIBAY_BASE_DIR = '/tmp/infinibay-test';
process.env.INFINIBAY_STORAGE_POOL_NAME = 'infinibay-test';
process.env.BRIDGE_NAME = 'virbr0';
process.env.VIRTIO_WIN_ISO_PATH = '/tmp/virtio-win.iso';

// Reset mocks before each test
beforeEach(() => {
  mockReset(mockPrisma);
  jest.clearAllMocks();
});

// Clean up after all tests
afterAll(async () => {
  jest.restoreAllMocks();
});

// Global test utilities
(global as any).testTimeout = 30000;

// Suppress console errors during tests unless DEBUG is set
if (!process.env.DEBUG) {
  global.console.error = jest.fn();
  global.console.warn = jest.fn();
}