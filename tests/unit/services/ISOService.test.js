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
// @ts-nocheck - Extensive mock typing prevents proper TS type checking
const globals_1 = require("@jest/globals");
// Create mock before importing anything that uses it
const mockISO = {
    findFirst: globals_1.jest.fn(),
    findUnique: globals_1.jest.fn(),
    findMany: globals_1.jest.fn(),
    create: globals_1.jest.fn(),
    update: globals_1.jest.fn(),
    delete: globals_1.jest.fn()
};
// Mock @prisma/client BEFORE ISOService imports it
globals_1.jest.mock('@prisma/client', () => ({
    __esModule: true,
    PrismaClient: globals_1.jest.fn().mockReturnValue({ iSO: mockISO }),
    Prisma: {}
}));
const mockPrismaISO = mockISO;
// Create mockFs first for hoisting
const mockFs = {
    mkdir: globals_1.jest.fn(),
    stat: globals_1.jest.fn(),
    access: globals_1.jest.fn(),
    unlink: globals_1.jest.fn(),
    readFile: globals_1.jest.fn(),
    readdir: globals_1.jest.fn()
};
// Mock fs/promises
globals_1.jest.mock('fs/promises', () => ({
    mkdir: (...args) => mockFs.mkdir(...args),
    stat: (...args) => mockFs.stat(...args),
    access: (...args) => mockFs.access(...args),
    unlink: (...args) => mockFs.unlink(...args),
    readFile: (...args) => mockFs.readFile(...args),
    readdir: (...args) => mockFs.readdir(...args),
    default: {}
}));
// Mock EventManager
const mockISOEventManagerInstance = {
    emitISORegistered: globals_1.jest.fn(),
    emitISORemoved: globals_1.jest.fn(),
    emitISOValidated: globals_1.jest.fn(),
    emitUploadProgress: globals_1.jest.fn(),
    emitDownloadProgress: globals_1.jest.fn(),
    emitStatusChanged: globals_1.jest.fn(),
    emitBatchStatusUpdate: globals_1.jest.fn(),
    emitSystemReadinessUpdate: globals_1.jest.fn()
};
globals_1.jest.mock('../../../app/services/EventManagers/ISOEventManager', () => ({
    __esModule: true,
    ISOEventManager: {
        getInstance: globals_1.jest.fn(() => mockISOEventManagerInstance)
    }
}));
const ISOService_1 = require("../../../app/services/ISOService");
(0, globals_1.describe)('ISOService', () => {
    let service;
    let originalBaseDir;
    const createMockISO = (overrides) => (Object.assign({ id: 'iso-1', filename: 'windows10.iso', os: 'WINDOWS10', version: null, size: BigInt(5368709120), path: '/opt/infinibay/iso/windows10.iso', checksum: null, isAvailable: true, lastVerified: new Date(), uploadedAt: new Date(), downloadUrl: null, createdAt: new Date(), updatedAt: new Date() }, overrides));
    (0, globals_1.beforeEach)(() => __awaiter(void 0, void 0, void 0, function* () {
        globals_1.jest.clearAllMocks();
        originalBaseDir = process.env.INFINIBAY_BASE_DIR;
        process.env.INFINIBAY_BASE_DIR = '/opt/infinibay';
        ISOService_1.ISOService.instance = undefined;
        service = ISOService_1.ISOService.getInstance();
        mockFs.mkdir.mockResolvedValue(undefined);
        mockFs.stat.mockResolvedValue({ size: 5368709120, isFile: () => true });
        mockFs.access.mockResolvedValue(undefined);
        mockFs.unlink.mockResolvedValue(undefined);
        mockFs.readFile.mockResolvedValue(Buffer.from('mock'));
        mockFs.readdir.mockResolvedValue(['windows10.iso']);
    }));
    (0, globals_1.afterEach)(() => {
        globals_1.jest.restoreAllMocks();
        process.env.INFINIBAY_BASE_DIR = originalBaseDir;
    });
    (0, globals_1.describe)('singleton pattern', () => {
        (0, globals_1.it)('should return the same instance on multiple calls', () => {
            const i1 = ISOService_1.ISOService.getInstance();
            const i2 = ISOService_1.ISOService.getInstance();
            (0, globals_1.expect)(i1).toBe(i2);
        });
        (0, globals_1.it)('should create new instance when instance is undefined', () => {
            ;
            ISOService_1.ISOService.instance = undefined;
            const n = ISOService_1.ISOService.getInstance();
            (0, globals_1.expect)(n).toBeDefined();
            (0, globals_1.expect)(n).toBeInstanceOf(ISOService_1.ISOService);
        });
    });
    (0, globals_1.describe)('getAvailableISOs', () => {
        (0, globals_1.it)('should return available ISOs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([
                createMockISO({ os: 'WINDOWS10', isAvailable: true })
            ]);
            const result = yield service.getAvailableISOs();
            (0, globals_1.expect)(result).toHaveLength(1);
            (0, globals_1.expect)(result[0].os).toBe('WINDOWS10');
        }));
        (0, globals_1.it)('should return empty array when no ISOs available', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([]);
            const result = yield service.getAvailableISOs();
            (0, globals_1.expect)(result).toEqual([]);
        }));
    });
    (0, globals_1.describe)('syncISOsWithFileSystem', () => {
        (0, globals_1.it)('should sync ISOs from filesystem to database', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce(['windows10.iso', 'ubuntu.iso']);
            mockPrismaISO.findUnique.mockResolvedValue(null);
            mockPrismaISO.create.mockResolvedValue(createMockISO());
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockFs.mkdir).toHaveBeenCalledWith(globals_1.expect.any(String), { recursive: true });
            (0, globals_1.expect)(mockPrismaISO.create).toHaveBeenCalled();
            (0, globals_1.expect)(mockISOEventManagerInstance.emitISORegistered).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should update existing ISO with new verification timestamp', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce(['windows10.iso']);
            const existing = createMockISO({ id: 'existing-iso' });
            mockPrismaISO.findUnique.mockResolvedValueOnce(existing);
            mockPrismaISO.findUnique.mockResolvedValueOnce(null);
            mockPrismaISO.update.mockResolvedValue(existing);
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockPrismaISO.update).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                where: { id: 'existing-iso' },
                data: globals_1.expect.objectContaining({ lastVerified: globals_1.expect.any(Date), isAvailable: true })
            }));
        }));
        (0, globals_1.it)('should mark ISOs as unavailable if file is deleted', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce(['windows10.iso']);
            const existing = createMockISO({ id: 'iso-1' });
            mockPrismaISO.findMany.mockResolvedValue([existing]);
            mockPrismaISO.update.mockResolvedValue(Object.assign(Object.assign({}, existing), { isAvailable: false }));
            mockFs.access.mockRejectedValueOnce(new Error('File not found'));
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockPrismaISO.update).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                where: { id: 'iso-1' },
                data: { isAvailable: false }
            }));
        }));
        (0, globals_1.it)('should handle error gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));
            yield (0, globals_1.expect)(service.syncISOsWithFileSystem()).rejects.toThrow('Permission denied');
        }));
        (0, globals_1.it)('should handle ISO directory not existing', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce([]);
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockFs.mkdir).toHaveBeenCalledWith(globals_1.expect.any(String), { recursive: true });
        }));
    });
    (0, globals_1.describe)('checkISOForOS', () => {
        (0, globals_1.it)('should return true when ISO exists', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findFirst.mockResolvedValue(createMockISO());
            const result = yield service.checkISOForOS('windows10');
            (0, globals_1.expect)(result).toEqual({ os: 'WINDOWS10', available: true, iso: globals_1.expect.any(Object) });
        }));
        (0, globals_1.it)('should return false when ISO does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findFirst.mockResolvedValue(null);
            const result = yield service.checkISOForOS('ubuntu');
            (0, globals_1.expect)(result).toEqual({ os: 'UBUNTU', available: false, iso: undefined });
        }));
        (0, globals_1.it)('should handle case insensitivity', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findFirst.mockResolvedValue(createMockISO());
            yield service.checkISOForOS('Windows10');
            (0, globals_1.expect)(mockPrismaISO.findFirst).toHaveBeenCalledWith(globals_1.expect.objectContaining({ where: globals_1.expect.objectContaining({ os: 'WINDOWS10' }) }));
        }));
    });
    (0, globals_1.describe)('getSystemReadiness', () => {
        (0, globals_1.it)('should return ready when ISOs are available', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([
                createMockISO({ os: 'WINDOWS10' }),
                createMockISO({ id: 'iso-2', os: 'UBUNTU' })
            ]);
            const result = yield service.getSystemReadiness();
            (0, globals_1.expect)(result.ready).toBe(true);
            (0, globals_1.expect)(result.availableOS).toEqual(globals_1.expect.arrayContaining(['WINDOWS10', 'UBUNTU']));
            (0, globals_1.expect)(result.missingOS).toEqual(globals_1.expect.arrayContaining(['WINDOWS11', 'FEDORA']));
        }));
        (0, globals_1.it)('should return not ready when no ISOs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([]);
            const result = yield service.getSystemReadiness();
            (0, globals_1.expect)(result).toEqual({
                ready: false, availableOS: [],
                missingOS: ['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA']
            });
        }));
        (0, globals_1.it)('should include all supported OS types', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([createMockISO({ os: 'WINDOWS10' })]);
            const result = yield service.getSystemReadiness();
            (0, globals_1.expect)(result.missingOS).toEqual(['WINDOWS11', 'UBUNTU', 'FEDORA']);
        }));
    });
    (0, globals_1.describe)('validateISO', () => {
        (0, globals_1.it)('should validate ISO successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValue(createMockISO());
            mockPrismaISO.update.mockResolvedValue(createMockISO());
            const result = yield service.validateISO('iso-1');
            (0, globals_1.expect)(result).toBe(true);
            (0, globals_1.expect)(mockPrismaISO.update).toHaveBeenCalledWith(globals_1.expect.objectContaining({
                where: { id: 'iso-1' },
                data: globals_1.expect.objectContaining({ isAvailable: true, lastVerified: globals_1.expect.any(Date) })
            }));
        }));
        (0, globals_1.it)('should return false when file size does not match', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.stat.mockResolvedValue({ size: 1000000, isFile: () => true });
            mockPrismaISO.findUnique.mockResolvedValue(createMockISO());
            mockPrismaISO.update.mockResolvedValue(Object.assign(Object.assign({}, createMockISO()), { isAvailable: false }));
            const result = yield service.validateISO('iso-1');
            (0, globals_1.expect)(result).toBe(false);
        }));
        (0, globals_1.it)('should throw error when ISO not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValue(null);
            (0, globals_1.expect)(yield service.validateISO('non-existent')).toBe(false);
        }));
        (0, globals_1.it)('should handle validation failure gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.stat.mockRejectedValue(new Error('File error'));
            const result = yield service.validateISO('iso-1');
            (0, globals_1.expect)(result).toBe(false);
        }));
    });
    (0, globals_1.describe)('calculateChecksum', () => {
        (0, globals_1.it)('should calculate and return checksum', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockHash = { update: globals_1.jest.fn(), digest: globals_1.jest.fn().mockReturnValue('abc123') };
            globals_1.jest.spyOn(require('crypto'), 'createHash').mockReturnValue(mockHash);
            mockPrismaISO.findUnique.mockResolvedValue(createMockISO());
            mockPrismaISO.update.mockResolvedValue(createMockISO());
            const result = yield service.calculateChecksum('iso-1');
            (0, globals_1.expect)(result).toBe('abc123');
            (0, globals_1.expect)(mockPrismaISO.update).toHaveBeenCalledWith(globals_1.expect.objectContaining({ where: { id: 'iso-1' }, data: { checksum: 'abc123' } }));
        }));
        (0, globals_1.it)('should throw error when ISO not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValue(null);
            yield (0, globals_1.expect)(service.calculateChecksum('non-existent')).rejects.toThrow('ISO not found');
        }));
    });
    (0, globals_1.describe)('registerISO', () => {
        (0, globals_1.it)('should create new ISO record', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValueOnce(null);
            const result = yield service.registerISO('windows10.iso', 'windows10', 5368709120, '/opt/infinibay/iso/windows10.iso');
            (0, globals_1.expect)(result).toMatchObject({
                filename: 'windows10.iso',
                os: 'WINDOWS10',
                size: BigInt(5368709120),
                path: '/opt/infinibay/iso/windows10.iso',
                isAvailable: true
            });
            (0, globals_1.expect)(result.filename).toBe('windows10.iso');
            (0, globals_1.expect)(mockISOEventManagerInstance.emitISORegistered).toHaveBeenCalledWith(globals_1.expect.any(Object));
        }));
        (0, globals_1.it)('should update existing ISO record', () => __awaiter(void 0, void 0, void 0, function* () {
            const existing = createMockISO({ id: 'existing-iso' });
            mockPrismaISO.findUnique.mockResolvedValueOnce(existing);
            mockPrismaISO.update.mockResolvedValue(existing);
            yield service.registerISO('windows10.iso', 'windows10', 6000000000, '/opt/infinibay/iso/windows10-new.iso');
            (0, globals_1.expect)(mockPrismaISO.create).not.toHaveBeenCalled();
            (0, globals_1.expect)(mockISOEventManagerInstance.emitISORegistered).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should normalize OS to uppercase', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValueOnce(null);
            mockPrismaISO.create.mockResolvedValue(createMockISO());
            yield service.registerISO('windows10.iso', 'windows10', 5368709120, '/path');
            (0, globals_1.expect)(mockPrismaISO.create).toHaveBeenCalledWith(globals_1.expect.objectContaining({ data: globals_1.expect.objectContaining({ os: 'WINDOWS10' }) }));
        }));
    });
    (0, globals_1.describe)('removeISO', () => {
        (0, globals_1.it)('should remove ISO successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValueOnce(createMockISO());
            mockPrismaISO.delete.mockResolvedValue(createMockISO());
            yield service.removeISO('iso-1');
            (0, globals_1.expect)(mockFs.unlink).toHaveBeenCalledWith(globals_1.expect.any(String));
            (0, globals_1.expect)(mockPrismaISO.delete).toHaveBeenCalledWith(globals_1.expect.objectContaining({ where: { id: 'iso-1' } }));
            (0, globals_1.expect)(mockISOEventManagerInstance.emitISORemoved).toHaveBeenCalledWith('iso-1', 'windows10.iso');
        }));
        (0, globals_1.it)('should handle file deletion failure gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.unlink.mockRejectedValue(new Error('Permission denied'));
            mockPrismaISO.findUnique.mockResolvedValueOnce(createMockISO());
            mockPrismaISO.delete.mockResolvedValue(createMockISO());
            yield service.removeISO('iso-1');
            (0, globals_1.expect)(mockPrismaISO.delete).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should throw error when ISO not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValueOnce(null);
            yield (0, globals_1.expect)(service.removeISO('non-existent')).rejects.toThrow('ISO not found');
        }));
    });
    (0, globals_1.describe)('getISOsByAvailability', () => {
        (0, globals_1.it)('should group ISOs by availability', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([
                createMockISO({ isAvailable: true }),
                createMockISO({ id: 'iso-2', isAvailable: false }),
                createMockISO({ id: 'iso-3', isAvailable: true })
            ]);
            const result = yield service.getISOsByAvailability();
            (0, globals_1.expect)(result.available).toHaveLength(2);
            (0, globals_1.expect)(result.unavailable).toHaveLength(1);
        }));
        (0, globals_1.it)('should return all available when all are available', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([
                createMockISO({ isAvailable: true }),
                createMockISO({ id: 'iso-2', isAvailable: true })
            ]);
            const result = yield service.getISOsByAvailability();
            (0, globals_1.expect)(result.available).toHaveLength(2);
            (0, globals_1.expect)(result.unavailable).toHaveLength(0);
        }));
        (0, globals_1.it)('should return all unavailable when none are available', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([
                createMockISO({ isAvailable: false }),
                createMockISO({ id: 'iso-2', isAvailable: false })
            ]);
            const result = yield service.getISOsByAvailability();
            (0, globals_1.expect)(result.available).toHaveLength(0);
            (0, globals_1.expect)(result.unavailable).toHaveLength(2);
        }));
    });
    (0, globals_1.describe)('extractOSType', () => {
        (0, globals_1.it)('should extract WINDOWS10 from filename', () => {
            (0, globals_1.expect)(service.extractOSType('windows10.iso')).toBe('WINDOWS10');
        });
        (0, globals_1.it)('should extract WINDOWS11 from filename', () => {
            (0, globals_1.expect)(service.extractOSType('windows11.iso')).toBe('WINDOWS11');
        });
        (0, globals_1.it)('should extract UBUNTU from filename', () => {
            (0, globals_1.expect)(service.extractOSType('ubuntu.iso')).toBe('UBUNTU');
        });
        (0, globals_1.it)('should extract FEDORA from filename', () => {
            (0, globals_1.expect)(service.extractOSType('fedora.iso')).toBe('FEDORA');
        });
        (0, globals_1.it)('should handle short names (win10, win11)', () => {
            (0, globals_1.expect)(service.extractOSType('win10.iso')).toBe('WINDOWS10');
            (0, globals_1.expect)(service.extractOSType('win11.iso')).toBe('WINDOWS11');
        });
        (0, globals_1.it)('should return null for unknown OS', () => {
            (0, globals_1.expect)(service.extractOSType('centos.iso')).toBeNull();
        });
        (0, globals_1.it)('should handle filename without .iso extension', () => {
            (0, globals_1.expect)(service.extractOSType('windows10')).toBe('WINDOWS10');
        });
        (0, globals_1.it)('should be case insensitive', () => {
            (0, globals_1.expect)(service.extractOSType('WINDOWS10.ISO')).toBe('WINDOWS10');
            (0, globals_1.expect)(service.extractOSType('Windows10.iso')).toBe('WINDOWS10');
        });
    });
    (0, globals_1.describe)('getSupportedOSTypes', () => {
        (0, globals_1.it)('should return all supported OS types', () => {
            (0, globals_1.expect)(service.getSupportedOSTypes()).toEqual(['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA']);
        });
    });
    (0, globals_1.describe)('checkMultipleOSAvailability', () => {
        (0, globals_1.it)('should check availability for multiple OSes', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([
                createMockISO({ os: 'WINDOWS10' }),
                createMockISO({ id: 'iso-2', os: 'UBUNTU' })
            ]);
            const result = yield service.checkMultipleOSAvailability(['windows10', 'ubuntu', 'fedora']);
            (0, globals_1.expect)(result.get('WINDOWS10')).toBe(true);
            (0, globals_1.expect)(result.get('UBUNTU')).toBe(true);
            (0, globals_1.expect)(result.get('FEDORA')).toBe(false);
        }));
        (0, globals_1.it)('should return all false when no ISOs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([]);
            const result = yield service.checkMultipleOSAvailability(['windows10', 'ubuntu']);
            (0, globals_1.expect)(result.get('WINDOWS10')).toBe(false);
            (0, globals_1.expect)(result.get('UBUNTU')).toBe(false);
        }));
        (0, globals_1.it)('should handle empty OS list', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([]);
            const result = yield service.checkMultipleOSAvailability([]);
            (0, globals_1.expect)(result).toBeInstanceOf(Map);
            (0, globals_1.expect)(result.size).toBe(0);
        }));
        (0, globals_1.it)('should normalize OS names to uppercase', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findMany.mockResolvedValue([createMockISO({ os: 'WINDOWS10' })]);
            const result = yield service.checkMultipleOSAvailability(['windows10']);
            (0, globals_1.expect)(result.get('WINDOWS10')).toBe(true);
            (0, globals_1.expect)(result.get('windows10')).toBe(undefined);
        }));
    });
    (0, globals_1.describe)('safe paths and edge cases', () => {
        (0, globals_1.it)('should handle empty filesystem with no ISOs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce([]);
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockPrismaISO.create).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should handle non-ISO files in directory', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce(['windows10.iso', 'readme.txt', 'ubuntu.iso']);
            mockPrismaISO.findUnique.mockResolvedValue(null);
            mockPrismaISO.create.mockResolvedValue(createMockISO());
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockPrismaISO.create).toHaveBeenCalled();
        }));
        (0, globals_1.it)('should handle invalid filename format gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce(['invalid-file-name', 'another-file.txt']);
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockPrismaISO.create).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should handle database error in sync', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce(['windows10.iso']);
            mockPrismaISO.findUnique.mockResolvedValueOnce(null);
            mockPrismaISO.create.mockRejectedValueOnce(new Error('Database error'));
            yield (0, globals_1.expect)(service.syncISOsWithFileSystem()).rejects.toThrow('Database error');
        }));
        (0, globals_1.it)('should handle permission denied when accessing file', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce([]);
            mockFs.stat.mockResolvedValue({ size: 5368709120, isFile: () => true });
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockPrismaISO.update).not.toHaveBeenCalled();
        }));
        (0, globals_1.it)('should handle very large file size (BigInt)', () => __awaiter(void 0, void 0, void 0, function* () {
            mockFs.readdir.mockResolvedValueOnce(['windows10.iso']);
            mockFs.stat.mockResolvedValue({ size: Number.MAX_SAFE_INTEGER, isFile: () => true });
            mockPrismaISO.findUnique.mockResolvedValueOnce(null);
            mockPrismaISO.create.mockResolvedValue(createMockISO());
            yield service.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockPrismaISO.create).toHaveBeenCalledWith(globals_1.expect.objectContaining({ data: globals_1.expect.objectContaining({ size: globals_1.expect.any(BigInt) }) }));
        }));
        (0, globals_1.it)('should handle null checksum in database', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrismaISO.findUnique.mockResolvedValue(Object.assign(Object.assign({}, createMockISO()), { checksum: null }));
            mockPrismaISO.update.mockResolvedValue(createMockISO());
            mockFs.stat.mockResolvedValue({ size: 5368709120n, isFile: () => true });
            const result = yield service.validateISO('iso-1');
            (0, globals_1.expect)(result).toBe(true);
        }));
        (0, globals_1.it)('should handle custom base directory', () => __awaiter(void 0, void 0, void 0, function* () {
            process.env.INFINIBAY_BASE_DIR = '/custom/path';
            ISOService_1.ISOService.instance = undefined;
            const custom = ISOService_1.ISOService.getInstance();
            mockPrismaISO.findMany.mockResolvedValue([]);
            yield custom.syncISOsWithFileSystem();
            (0, globals_1.expect)(mockFs.mkdir).toHaveBeenCalledWith('/custom/path/iso', { recursive: true });
        }));
    });
});
