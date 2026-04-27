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
const globals_1 = require("@jest/globals");
// Mock PrismaClient at module level since ISOService instantiates its own
const mockPrismaInstance = {
    iSO: {
        findUnique: globals_1.jest.fn(),
        findFirst: globals_1.jest.fn(),
        create: globals_1.jest.fn(),
        update: globals_1.jest.fn(),
        findMany: globals_1.jest.fn(),
        delete: globals_1.jest.fn(),
        upsert: globals_1.jest.fn()
    }
};
globals_1.jest.mock('@prisma/client', () => {
    const actual = globals_1.jest.requireActual('@prisma/client');
    return Object.assign(Object.assign({}, actual), { PrismaClient: globals_1.jest.fn(() => mockPrismaInstance) });
});
// Mock fs/promises
globals_1.jest.mock('fs/promises', () => {
    const mkdirMock = globals_1.jest.fn();
    mkdirMock.mockResolvedValue(undefined);
    const readdirMock = globals_1.jest.fn();
    readdirMock.mockResolvedValue([]);
    const accessMock = globals_1.jest.fn();
    accessMock.mockResolvedValue(undefined);
    const statMock = globals_1.jest.fn();
    statMock.mockResolvedValue({ size: 5368709120 });
    const readFileMock = globals_1.jest.fn();
    readFileMock.mockResolvedValue(Buffer.from('fake-iso-data'));
    const unlinkMock = globals_1.jest.fn();
    unlinkMock.mockResolvedValue(undefined);
    return {
        mkdir: mkdirMock,
        readdir: readdirMock,
        access: accessMock,
        stat: statMock,
        readFile: readFileMock,
        unlink: unlinkMock
    };
});
// Mock ISOEventManager
globals_1.jest.mock('../../../app/services/EventManagers/ISOEventManager', () => ({
    ISOEventManager: {
        getInstance: globals_1.jest.fn(() => ({
            emitISORegistered: globals_1.jest.fn(),
            emitISORemoved: globals_1.jest.fn(),
            emitISOValidated: globals_1.jest.fn(),
            emitUploadProgress: globals_1.jest.fn(),
            emitDownloadProgress: globals_1.jest.fn(),
            emitStatusChanged: globals_1.jest.fn(),
            emitBatchStatusUpdate: globals_1.jest.fn(),
            emitSystemReadinessUpdate: globals_1.jest.fn()
        }))
    }
}));
const ISOService_1 = require("../../../app/services/ISOService");
(0, globals_1.describe)('ISOService', () => {
    const originalEnv = process.env;
    const mockISO = {
        id: 'iso-123',
        filename: 'windows10.iso',
        os: 'WINDOWS10',
        version: null,
        path: '/opt/infinibay/iso/windows10.iso',
        size: BigInt(5368709120),
        uploadedAt: new Date(),
        lastVerified: new Date(),
        isAvailable: true,
        checksum: null,
        downloadUrl: null,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        process.env = Object.assign(Object.assign({}, originalEnv), { INFINIBAY_BASE_DIR: '/opt/infinibay' });
        ISOService_1.ISOService.instance = undefined;
    });
    (0, globals_1.afterEach)(() => {
        process.env = originalEnv;
        globals_1.jest.restoreAllMocks();
    });
    (0, globals_1.describe)('getInstance', () => {
        (0, globals_1.it)('should return singleton instance', () => {
            const instance1 = ISOService_1.ISOService.getInstance();
            const instance2 = ISOService_1.ISOService.getInstance();
            (0, globals_1.expect)(instance1).toBe(instance2);
        });
    });
    (0, globals_1.describe)('getAvailableISOs', () => {
        (0, globals_1.it)('should return all available ISOs', () => __awaiter(void 0, void 0, void 0, function* () {
            const availableISOs = [mockISO];
            mockPrismaInstance.iSO.findMany.mockResolvedValue(availableISOs);
            const result = yield ISOService_1.ISOService.getInstance().getAvailableISOs();
            (0, globals_1.expect)(mockPrismaInstance.iSO.findMany).toHaveBeenCalledWith({
                where: { isAvailable: true },
                orderBy: { os: 'asc' }
            });
            (0, globals_1.expect)(result).toEqual(availableISOs);
        }));
        (0, globals_1.it)('should handle empty results', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findMany.mockResolvedValue([]);
            const result = yield ISOService_1.ISOService.getInstance().getAvailableISOs();
            (0, globals_1.expect)(result).toEqual([]);
        }));
        (0, globals_1.it)('should propagate database errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Database connection failed');
            mockPrismaInstance.iSO.findMany.mockRejectedValue(error);
            yield (0, globals_1.expect)(ISOService_1.ISOService.getInstance().getAvailableISOs()).rejects.toThrow('Database connection failed');
        }));
    });
    (0, globals_1.describe)('checkISOForOS', () => {
        (0, globals_1.it)('should return available status when ISO exists', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findFirst.mockResolvedValue(mockISO);
            const result = yield ISOService_1.ISOService.getInstance().checkISOForOS('WINDOWS10');
            (0, globals_1.expect)(result.os).toBe('WINDOWS10');
            (0, globals_1.expect)(result.available).toBe(true);
            (0, globals_1.expect)(result.iso).toEqual(mockISO);
        }));
        (0, globals_1.it)('should return unavailable status when ISO not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findFirst.mockResolvedValue(null);
            const result = yield ISOService_1.ISOService.getInstance().checkISOForOS('LINUX_DISTRO');
            (0, globals_1.expect)(result.os).toBe('LINUX_DISTRO');
            (0, globals_1.expect)(result.available).toBe(false);
            (0, globals_1.expect)(result.iso).toBeUndefined();
        }));
    });
    (0, globals_1.describe)('validateISO', () => {
        (0, globals_1.it)('should return true for valid ISO', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findUnique.mockResolvedValue(Object.assign(Object.assign({}, mockISO), { size: BigInt(5368709120) }));
            mockPrismaInstance.iSO.update.mockResolvedValue(mockISO);
            const fs = require('fs/promises');
            fs.stat.mockResolvedValue({ size: 5368709120 });
            const result = yield ISOService_1.ISOService.getInstance().validateISO('iso-123');
            (0, globals_1.expect)(result).toBe(true);
        }));
        (0, globals_1.it)('should return false when ISO not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findUnique.mockResolvedValue(null);
            const result = yield ISOService_1.ISOService.getInstance().validateISO('non-existent-id');
            (0, globals_1.expect)(result).toBe(false);
        }));
        (0, globals_1.it)('should return false when file size mismatch', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findUnique.mockResolvedValue(Object.assign(Object.assign({}, mockISO), { size: BigInt(9999999) }));
            mockPrismaInstance.iSO.update.mockResolvedValue(mockISO);
            const fs = require('fs/promises');
            fs.stat.mockResolvedValue({ size: 5368709120 });
            const result = yield ISOService_1.ISOService.getInstance().validateISO('iso-123');
            (0, globals_1.expect)(result).toBe(false);
        }));
    });
    (0, globals_1.describe)('getSystemReadiness', () => {
        (0, globals_1.it)('should return system readiness status', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockISOs = [
                Object.assign(Object.assign({}, mockISO), { os: 'WINDOWS10', isAvailable: true }),
                Object.assign(Object.assign({}, mockISO), { id: 'iso-456', os: 'UBUNTU', isAvailable: true })
            ];
            mockPrismaInstance.iSO.findMany.mockResolvedValue(mockISOs);
            const result = yield ISOService_1.ISOService.getInstance().getSystemReadiness();
            (0, globals_1.expect)(result).toHaveProperty('ready');
            (0, globals_1.expect)(result).toHaveProperty('availableOS');
            (0, globals_1.expect)(result).toHaveProperty('missingOS');
            (0, globals_1.expect)(result.ready).toBe(true);
            (0, globals_1.expect)(result.availableOS).toContain('WINDOWS10');
            (0, globals_1.expect)(result.availableOS).toContain('UBUNTU');
        }));
        (0, globals_1.it)('should report missing OS types', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findMany.mockResolvedValue([]);
            const result = yield ISOService_1.ISOService.getInstance().getSystemReadiness();
            (0, globals_1.expect)(result.ready).toBe(false);
            (0, globals_1.expect)(result.missingOS.length).toBeGreaterThan(0);
        }));
    });
    (0, globals_1.describe)('getSupportedOSTypes', () => {
        (0, globals_1.it)('should return supported OS types', () => {
            const result = ISOService_1.ISOService.getInstance().getSupportedOSTypes();
            (0, globals_1.expect)(result).toContain('WINDOWS10');
            (0, globals_1.expect)(result).toContain('WINDOWS11');
            (0, globals_1.expect)(result).toContain('UBUNTU');
            (0, globals_1.expect)(result).toContain('FEDORA');
        });
    });
    (0, globals_1.describe)('extractOSType', () => {
        (0, globals_1.it)('should extract OS type from filename', () => {
            const osType = ISOService_1.ISOService.getInstance()['extractOSType']('windows10.iso');
            (0, globals_1.expect)(osType).toBe('WINDOWS10');
        });
        (0, globals_1.it)('should handle windows11 filename', () => {
            const osType = ISOService_1.ISOService.getInstance()['extractOSType']('windows11.iso');
            (0, globals_1.expect)(osType).toBe('WINDOWS11');
        });
        (0, globals_1.it)('should return null for unknown filenames', () => {
            const osType = ISOService_1.ISOService.getInstance()['extractOSType']('unknown_file.iso');
            (0, globals_1.expect)(osType).toBeNull();
        });
    });
    (0, globals_1.describe)('checkMultipleOSAvailability', () => {
        (0, globals_1.it)('should check multiple OS availability', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaInstance.iSO.findMany.mockResolvedValue([
                Object.assign(Object.assign({}, mockISO), { os: 'WINDOWS10' })
            ]);
            const result = yield ISOService_1.ISOService.getInstance().checkMultipleOSAvailability(['WINDOWS10', 'UBUNTU']);
            (0, globals_1.expect)(result.get('WINDOWS10')).toBe(true);
            (0, globals_1.expect)(result.get('UBUNTU')).toBe(false);
        }));
    });
    (0, globals_1.describe)('error handling', () => {
        (0, globals_1.it)('should handle database errors gracefully in getAvailableISOs', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Database connection error');
            mockPrismaInstance.iSO.findMany.mockRejectedValue(error);
            yield (0, globals_1.expect)(ISOService_1.ISOService.getInstance().getAvailableISOs()).rejects.toThrow('Database connection error');
        }));
        (0, globals_1.it)('should handle validation errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('File not found');
            mockPrismaInstance.iSO.findUnique.mockRejectedValue(error);
            const result = yield ISOService_1.ISOService.getInstance().validateISO('iso-123');
            // validateISO returns false on error (catches internally)
            (0, globals_1.expect)(result).toBe(false);
        }));
    });
});
