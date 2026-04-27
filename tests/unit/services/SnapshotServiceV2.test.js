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
require("reflect-metadata");
const SnapshotServiceV2_1 = require("../../../app/services/SnapshotServiceV2");
const jest_mock_extended_1 = require("jest-mock-extended");
const fs_1 = __importDefault(require("fs"));
// Mock snapshot manager instance
const mockSnapshotManager = {
    createSnapshot: jest.fn(),
    listSnapshots: jest.fn(),
    revertSnapshot: jest.fn(),
    deleteSnapshot: jest.fn(),
    snapshotExists: jest.fn()
};
// Mock infinization
jest.mock('@infinibay/infinization', () => ({
    SnapshotManager: jest.fn().mockImplementation(() => mockSnapshotManager),
    StorageError: class StorageError extends Error {
        constructor(message) {
            super(message);
            this.name = 'StorageError';
        }
    }
}));
// Mock fs
jest.mock('fs');
describe('SnapshotServiceV2', () => {
    let service;
    let mockPrisma;
    const mockVM = {
        id: 'vm-123',
        internalName: 'vm-test-123',
        status: 'off'
    };
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        fs_1.default.existsSync.mockReturnValue(true);
        // Create service
        service = new SnapshotServiceV2_1.SnapshotServiceV2(mockPrisma);
    }));
    describe('createSnapshot', () => {
        it('should create a snapshot for a stopped VM', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.createSnapshot.mockResolvedValue(undefined);
            const result = yield service.createSnapshot('vm-123', 'test-snapshot', 'Test description');
            expect(result.success).toBe(true);
            expect(result.message).toContain('created successfully');
            expect(result.snapshot).toBeDefined();
            expect((_a = result.snapshot) === null || _a === void 0 ? void 0 : _a.name).toBe('test-snapshot');
            expect((_b = result.snapshot) === null || _b === void 0 ? void 0 : _b.description).toBe('Test description');
            expect(mockSnapshotManager.createSnapshot).toHaveBeenCalledWith({
                imagePath: expect.stringContaining('vm-test-123'),
                name: 'test-snapshot',
                description: 'Test description'
            });
        }));
        it('should fail if VM is running', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(Object.assign(Object.assign({}, mockVM), { status: 'running' }));
            const result = yield service.createSnapshot('vm-123', 'test-snapshot');
            expect(result.success).toBe(false);
            expect(result.message).toContain('must be stopped');
        }));
        it('should fail if VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.createSnapshot('vm-123', 'test-snapshot');
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        }));
        it('should fail if disk image not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            fs_1.default.existsSync.mockReturnValue(false);
            const result = yield service.createSnapshot('vm-123', 'test-snapshot');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Disk image not found');
        }));
    });
    describe('listSnapshots', () => {
        it('should list all snapshots for a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.listSnapshots.mockResolvedValue([
                { name: 'snap-1', date: '2024-01-01', vmSize: 1024 },
                { name: 'snap-2', date: '2024-01-02', vmSize: 2048 }
            ]);
            const result = yield service.listSnapshots('vm-123');
            expect(result.success).toBe(true);
            expect(result.snapshots).toHaveLength(2);
            expect(result.snapshots[0].name).toBe('snap-1');
            expect(result.snapshots[1].name).toBe('snap-2');
            expect(result.snapshots[1].isCurrent).toBe(true); // Last one is current
        }));
        it('should return empty array if no snapshots', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.listSnapshots.mockResolvedValue([]);
            const result = yield service.listSnapshots('vm-123');
            expect(result.success).toBe(true);
            expect(result.snapshots).toHaveLength(0);
        }));
        it('should fail if VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.listSnapshots('vm-123');
            expect(result.success).toBe(false);
            expect(result.snapshots).toHaveLength(0);
        }));
    });
    describe('restoreSnapshot', () => {
        it('should restore a snapshot for a stopped VM', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.snapshotExists.mockResolvedValue(true);
            mockSnapshotManager.revertSnapshot.mockResolvedValue(undefined);
            const result = yield service.restoreSnapshot('vm-123', 'test-snapshot');
            expect(result.success).toBe(true);
            expect(result.message).toContain('successfully');
            expect(mockSnapshotManager.revertSnapshot).toHaveBeenCalled();
        }));
        it('should fail if VM is running', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(Object.assign(Object.assign({}, mockVM), { status: 'running' }));
            const result = yield service.restoreSnapshot('vm-123', 'test-snapshot');
            expect(result.success).toBe(false);
            expect(result.message).toContain('must be stopped');
        }));
        it('should fail if snapshot does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.snapshotExists.mockResolvedValue(false);
            const result = yield service.restoreSnapshot('vm-123', 'nonexistent');
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        }));
    });
    describe('deleteSnapshot', () => {
        it('should delete a snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.deleteSnapshot.mockResolvedValue(undefined);
            const result = yield service.deleteSnapshot('vm-123', 'test-snapshot');
            expect(result.success).toBe(true);
            expect(result.message).toContain('deleted successfully');
            expect(mockSnapshotManager.deleteSnapshot).toHaveBeenCalled();
        }));
        it('should fail if VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.deleteSnapshot('vm-123', 'test-snapshot');
            expect(result.success).toBe(false);
        }));
    });
    describe('getCurrentSnapshot', () => {
        it('should return the most recent snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.listSnapshots.mockResolvedValue([
                { name: 'snap-1', date: '2024-01-01', vmSize: 1024 },
                { name: 'snap-2', date: '2024-01-02', vmSize: 2048 }
            ]);
            const result = yield service.getCurrentSnapshot('vm-123');
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.name).toBe('snap-2');
            expect(result === null || result === void 0 ? void 0 : result.isCurrent).toBe(true);
        }));
        it('should return null if no snapshots', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.listSnapshots.mockResolvedValue([]);
            const result = yield service.getCurrentSnapshot('vm-123');
            expect(result).toBeNull();
        }));
    });
    describe('snapshotExists', () => {
        it('should return true if snapshot exists', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.snapshotExists.mockResolvedValue(true);
            const result = yield service.snapshotExists('vm-123', 'test-snapshot');
            expect(result).toBe(true);
        }));
        it('should return false if snapshot does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(mockVM);
            mockSnapshotManager.snapshotExists.mockResolvedValue(false);
            const result = yield service.snapshotExists('vm-123', 'nonexistent');
            expect(result).toBe(false);
        }));
        it('should return false if VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.snapshotExists('vm-123', 'test-snapshot');
            expect(result).toBe(false);
        }));
    });
});
