"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const events_1 = require("events");
const jest_mock_extended_1 = require("jest-mock-extended");
const infinization_1 = require("@infinibay/infinization");
const BackupService_1 = require("@services/BackupService");
jest.mock('@services/EventManager', () => ({
    getEventManager: () => null
}));
class FakeInfinization extends events_1.EventEmitter {
    constructor() {
        super(...arguments);
        this.createBackup = jest.fn();
        this.restoreBackup = jest.fn();
        this.listBackups = jest.fn();
        this.deleteBackup = jest.fn();
        this.getBackupMetadata = jest.fn();
    }
}
describe('BackupService (backend wrapper)', () => {
    let prisma;
    let infinization;
    let service;
    beforeEach(() => {
        prisma = (0, jest_mock_extended_1.mockDeep)();
        infinization = new FakeInfinization();
        service = new BackupService_1.BackupService(prisma, infinization);
    });
    describe('createBackup', () => {
        it('persists an in-progress row, runs the backup, and marks it completed', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmId = 'vm-1';
            prisma.machine.findUnique.mockResolvedValue({
                id: vmId,
                name: 'web-1',
                userId: 'user-1',
                configuration: { diskPaths: ['/disks/web-1.qcow2'] }
            });
            const pendingRow = { id: 'db-1', backupId: 'pending-x', vmId, status: infinization_1.BackupStatus.IN_PROGRESS };
            const completedRow = {
                id: 'db-1',
                backupId: 'bkp-123',
                vmId,
                status: infinization_1.BackupStatus.COMPLETED,
                type: infinization_1.BackupType.FULL,
                totalSize: BigInt(100),
                durationMs: 5000,
                errorMessage: null,
                createdAt: new Date(),
                completedAt: new Date()
            };
            prisma.backup.create.mockResolvedValue(pendingRow);
            prisma.backup.update.mockResolvedValue(completedRow);
            infinization.createBackup.mockResolvedValue({
                success: true,
                backupId: 'bkp-123',
                vmId,
                type: infinization_1.BackupType.FULL,
                disks: [],
                totalSize: 100,
                durationMs: 5000
            });
            infinization.getBackupMetadata.mockResolvedValue({ totalOriginalSize: 200 });
            const result = yield service.createBackup({ vmId, type: infinization_1.BackupType.FULL });
            expect(prisma.backup.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    vmId,
                    status: infinization_1.BackupStatus.IN_PROGRESS,
                    type: infinization_1.BackupType.FULL
                })
            }));
            // Method now returns immediately with the pending row; the actual
            // infinization work runs in the background.
            expect(result.status).toBe(infinization_1.BackupStatus.IN_PROGRESS);
            expect(result.backupId).toBe('pending-x');
            // Wait a tick for the detached background work to enqueue.
            yield new Promise((r) => setImmediate(r));
            yield new Promise((r) => setImmediate(r));
            expect(infinization.createBackup).toHaveBeenCalledWith(expect.objectContaining({
                vmId,
                diskPaths: ['/disks/web-1.qcow2'],
                type: infinization_1.BackupType.FULL
            }));
        }));
        it('marks the row as FAILED when the underlying backup throws', () => __awaiter(void 0, void 0, void 0, function* () {
            prisma.machine.findUnique.mockResolvedValue({
                id: 'vm-1', name: 'x', userId: 'u', configuration: { diskPaths: ['/d.qcow2'] }
            });
            prisma.backup.create.mockResolvedValue({ id: 'db-1', backupId: 'p', vmId: 'vm-1' });
            prisma.backup.update.mockResolvedValue({ id: 'db-1', status: infinization_1.BackupStatus.FAILED });
            infinization.createBackup.mockRejectedValue(new Error('qemu-img blew up'));
            // Returns immediately — failure is handled in the background and
            // persisted to the row, not re-thrown from createBackup.
            yield service.createBackup({ vmId: 'vm-1', type: infinization_1.BackupType.FULL });
            // Let the background task run.
            yield new Promise((r) => setImmediate(r));
            yield new Promise((r) => setImmediate(r));
            yield new Promise((r) => setImmediate(r));
            expect(prisma.backup.update).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    status: infinization_1.BackupStatus.FAILED,
                    errorMessage: 'qemu-img blew up'
                })
            }));
        }));
        it('rejects when the VM has no disk paths', () => __awaiter(void 0, void 0, void 0, function* () {
            prisma.machine.findUnique.mockResolvedValue({
                id: 'vm-1', name: 'x', userId: 'u', configuration: { diskPaths: [] }
            });
            yield expect(service.createBackup({ vmId: 'vm-1', type: infinization_1.BackupType.FULL }))
                .rejects.toThrow(/no disk paths/);
            expect(prisma.backup.create).not.toHaveBeenCalled();
        }));
        it('rejects when the VM does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            prisma.machine.findUnique.mockResolvedValue(null);
            yield expect(service.createBackup({ vmId: 'missing', type: infinization_1.BackupType.FULL }))
                .rejects.toThrow(/not found/);
        }));
    });
    describe('deleteBackup', () => {
        it('removes the row even if the on-disk manifest is already gone', () => __awaiter(void 0, void 0, void 0, function* () {
            prisma.backup.findUnique.mockResolvedValue({
                id: 'db-1', backupId: 'bkp-1', vmId: 'vm-1'
            });
            const { BackupError, BackupErrorCode } = yield Promise.resolve().then(() => __importStar(require('@infinibay/infinization')));
            infinization.deleteBackup.mockRejectedValue(new BackupError(BackupErrorCode.BACKUP_NOT_FOUND, 'gone'));
            yield service.deleteBackup('db-1');
            expect(prisma.backup.delete).toHaveBeenCalledWith({ where: { id: 'db-1' } });
        }));
        it('propagates non-not-found errors', () => __awaiter(void 0, void 0, void 0, function* () {
            prisma.backup.findUnique.mockResolvedValue({
                id: 'db-1', backupId: 'bkp-1', vmId: 'vm-1'
            });
            infinization.deleteBackup.mockRejectedValue(new Error('permission denied'));
            yield expect(service.deleteBackup('db-1')).rejects.toThrow('permission denied');
            expect(prisma.backup.delete).not.toHaveBeenCalled();
        }));
    });
});
