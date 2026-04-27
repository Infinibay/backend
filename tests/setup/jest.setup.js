"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockPrisma = exports.testPrisma = void 0;
require("reflect-metadata");
const logger_1 = __importDefault(require("@main/logger"));
const jest_mock_extended_1 = require("jest-mock-extended");
const prisma_test_client_1 = require("./prisma-test-client");
// ── Prisma clients ────────────────────────────────────────────────────────
//
// testPrisma — real PrismaClient pointing at the test database.
// The DB lifecycle hooks (connect / cleanup / disconnect) are at the bottom
// of this file. They run for every test suite (unit and integration alike)
// because this setup file is loaded by all projects. The overhead of
// TRUNCATE is small (~5 ms) and guarantees a clean slate.
//
// mockPrisma — jest-mock-extended deep mock (no DB at all).
exports.testPrisma = (0, prisma_test_client_1.createTestPrismaClient)({ verbose: false });
exports.mockPrisma = (0, jest_mock_extended_1.mockDeep)();
// ── Mock @utils/database ──────────────────────────────────────────────────
// Integration tests override this mock to use testPrisma.prisma.
// Unit tests get mockPrisma automatically.
jest.mock('@utils/database', () => ({
    __esModule: true,
    default: exports.mockPrisma
}));
// ── Mock EventManager ──────────────────────────────────────────────────────────
const MockEventManagerClass = class MockEventManager {
    constructor() {
        this.registerResourceManager = jest.fn();
        this.dispatchEvent = jest.fn();
        this.vmCreated = jest.fn();
        this.vmUpdated = jest.fn();
        this.vmDeleted = jest.fn();
        this.getStats = jest.fn(() => ({
            registeredManagers: [],
            socketStats: { connectedUsers: 0, userIds: [] }
        }));
    }
};
jest.mock('@services/EventManager', () => ({
    EventManager: MockEventManagerClass,
    createEventManager: jest.fn(() => new MockEventManagerClass()),
    getEventManager: jest.fn(() => new MockEventManagerClass())
}));
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
}));
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
}));
// Mock systeminformation
jest.mock('systeminformation', () => ({
    graphics: jest.fn(() => ({ controllers: [] })),
    cpu: jest.fn(() => ({ cores: 8 })),
    mem: jest.fn(() => ({ total: 16000000000 }))
}));
// ── Environment variables for testing ─────────────────────────────────────────
process.env.TOKENKEY = 'test-secret-key';
process.env.BCRYPT_ROUNDS = '10';
process.env.PORT = '4001';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.APP_HOST = '192.168.1.100';
process.env.GRAPHIC_HOST = '192.168.1.100';
process.env.INFINIBAY_BASE_DIR = '/tmp/infinibay-test';
process.env.VIRTIO_WIN_ISO_PATH = '/tmp/virtio-win.iso';
// ── Lifecycle hooks ────────────────────────────────────────────────────────────
beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
    yield exports.testPrisma.connect();
    yield exports.testPrisma.cleanup();
}));
beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
    yield exports.testPrisma.cleanup();
}));
afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
    yield exports.testPrisma.disconnect();
    (0, prisma_test_client_1.resetTestPrismaClient)();
    jest.restoreAllMocks();
}));
global.testTimeout = 30000;
// Suppress logger and console errors during tests unless DEBUG is set
if (!process.env.DEBUG) {
    global.console.error = jest.fn();
    global.console.warn = jest.fn();
    logger_1.default.error = jest.fn();
    logger_1.default.warn = jest.fn();
    logger_1.default.info = jest.fn();
    logger_1.default.debug = jest.fn();
}
