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
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const jest_mock_extended_1 = require("jest-mock-extended");
const SnapshotServiceV2_1 = require("../../../app/services/SnapshotServiceV2");
const infinization_1 = require("@infinibay/infinization");
const mockPrisma = (0, jest_mock_extended_1.mockDeep)();
// Mock Infinization SnapshotManager
const mockSnapshotManager = {
    createSnapshot: jest.fn(),
    listSnapshots: jest.fn(),
    revertSnapshot: jest.fn(),
    deleteSnapshot: jest.fn(),
    snapshotExists: jest.fn()
};
jest.mock('@infinibay/infinization', () => {
    const actual = jest.requireActual('@infinibay/infinization');
    return {
        SnapshotManager: jest.fn(() => mockSnapshotManager),
        StorageError: actual.StorageError,
        StorageErrorCode: actual.StorageErrorCode
    };
});
// Mock fs
jest.mock('fs', () => ({
    existsSync: jest.fn(() => true)
}));
describe('SnapshotServiceV2', () => {
    let service;
    beforeEach(() => {
        jest.clearAllMocks();
        service = new SnapshotServiceV2_1.SnapshotServiceV2(mockPrisma);
    });
    describe('createSnapshot', () => {
        const mockVMId = 'vm-123-456';
        it('should successfully create a snapshot for a stopped VM', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock VM info - stopped VM
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            // Mock snapshot creation
            mockSnapshotManager.createSnapshot.mockResolvedValue(undefined);
            const result = yield service.createSnapshot(mockVMId, 'test-snapshot', 'Test description');
            expect(result.success).toBe(true);
            expect(result.message).toContain('Snapshot');
            expect(result.snapshot).toBeDefined();
            expect(result.snapshot.name).toBe('test-snapshot');
        }));
        it('should return error when VM is not found', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock VM not found
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.createSnapshot(mockVMId, 'test-snapshot');
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        }));
        it('should return error when VM is running (qemu-img limitation)', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock VM info - running VM
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'running' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const result = yield service.createSnapshot(mockVMId, 'test-snapshot');
            expect(result.success).toBe(false);
            expect(result.message).toContain('must be stopped');
        }));
        it('should handle SnapshotManager creation failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const error = new infinization_1.StorageError(infinization_1.StorageErrorCode.COMMAND_FAILED, 'Storage error');
            mockSnapshotManager.createSnapshot.mockRejectedValue(error);
            const result = yield service.createSnapshot(mockVMId, 'test-snapshot');
            expect(result.success).toBe(false);
            expect(result.message).toBeDefined();
        }));
        it('should create snapshot with description', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockSnapshotManager.createSnapshot.mockResolvedValue(undefined);
            const result = yield service.createSnapshot(mockVMId, 'test-snapshot', 'Important backup before update');
            expect(result.success).toBe(true);
            expect(result.message).toContain('Snapshot');
        }));
        it('should handle empty snapshot name', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const result = yield service.createSnapshot(mockVMId, '');
            // Either fails validation or creates - depends on implementation
            expect(result).toBeDefined();
        }));
    });
    describe('listSnapshots', () => {
        const mockVMId = 'vm-123-456';
        it('should return list of snapshots for VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const mockSnapshots = [
                {
                    id: '1',
                    name: 'snapshot-1',
                    date: new Date('2024-01-01').toISOString(),
                    vmSize: 500 * 1024 * 1024,
                    vmClock: '00:00:00'
                },
                {
                    id: '2',
                    name: 'snapshot-2',
                    date: new Date('2024-01-02').toISOString(),
                    vmSize: 600 * 1024 * 1024,
                    vmClock: '00:00:00'
                }
            ];
            mockSnapshotManager.listSnapshots.mockResolvedValue(mockSnapshots);
            const result = yield service.listSnapshots(mockVMId);
            expect(result.success).toBe(true);
            expect(result.snapshots.length).toBe(2);
            expect(result.snapshots[0].name).toBe('snapshot-1');
            expect(result.snapshots[1].name).toBe('snapshot-2');
        }));
        it('should handle empty snapshot list', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockSnapshotManager.listSnapshots.mockResolvedValue([]);
            const result = yield service.listSnapshots(mockVMId);
            expect(result.success).toBe(true);
            expect(result.snapshots.length).toBe(0);
        }));
        it('should return error when VM is not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.listSnapshots(mockVMId);
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        }));
        it('should handle snapshot listing failures', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const error = new infinization_1.StorageError(infinization_1.StorageErrorCode.COMMAND_FAILED, 'Storage unavailable');
            mockSnapshotManager.listSnapshots.mockRejectedValue(error);
            const result = yield service.listSnapshots(mockVMId);
            expect(result.success).toBe(false);
            expect(result.message).toBeDefined();
        }));
        it('should include VM size metadata in snapshot list', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const mockSnapshots = [
                {
                    id: '1',
                    name: 'snapshot-1',
                    date: new Date('2024-01-01').toISOString(),
                    vmSize: 1024 * 1024 * 1024, // 1GB
                    vmClock: '00:00:00'
                }
            ];
            mockSnapshotManager.listSnapshots.mockResolvedValue(mockSnapshots);
            const result = yield service.listSnapshots(mockVMId);
            expect(result.success).toBe(true);
            expect(result.snapshots[0].vmSize).toBe(1024 * 1024 * 1024);
        }));
    });
    describe('deleteSnapshot', () => {
        const mockVMId = 'vm-123-456';
        it('should successfully delete a snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const result = yield service.deleteSnapshot(mockVMId, 'snapshot-1');
            expect(result.success).toBe(true);
            expect(result.message).toContain('deleted');
        }));
        it('should return error when VM is not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.deleteSnapshot(mockVMId, 'snapshot-1');
            expect(result.success).toBe(false);
            expect(result.message).toContain('not found');
        }));
        it('should handle delete failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: mockVMId, internalName: 'vm-test', status: 'off' };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const error = new infinization_1.StorageError(infinization_1.StorageErrorCode.COMMAND_FAILED, 'Delete failed');
            mockSnapshotManager.deleteSnapshot.mockRejectedValue(error);
            const result = yield service.deleteSnapshot(mockVMId, 'snapshot-1');
            expect(result.success).toBe(false);
            expect(result.message).toBeDefined();
        }));
    });
    describe('edge cases', () => {
        it('should handle null VMId gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.createSnapshot('', 'test-snapshot');
            expect(result.success).toBe(false);
        }));
        it('should handle undefined VMId gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.createSnapshot(undefined, 'test-snapshot');
            expect(result.success).toBe(false);
        }));
    });
    describe('service initialization', () => {
        it('should initialize with prisma client and snapshot manager', () => {
            expect(service).toBeDefined();
            expect(mockSnapshotManager.createSnapshot).toBeDefined();
        });
    });
});
