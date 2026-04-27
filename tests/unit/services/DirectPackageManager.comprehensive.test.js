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
const DirectPackageManager_1 = require("../../../app/services/DirectPackageManager");
// Mock dependencies
class MockVirtioSocketWatcherService {
    constructor() {
        this.sendPackageCommand = globals_1.jest.fn();
        this.isVmConnected = globals_1.jest.fn().mockReturnValue(true);
    }
}
// Mock PrismaClient
class MockPrismaClient {
    constructor() {
        this.machine = {
            findUnique: globals_1.jest.fn()
        };
    }
}
// Mock the logger to prevent import issues
globals_1.jest.mock('@main/logger', () => {
    const mockChild = {
        debug: globals_1.jest.fn(),
        info: globals_1.jest.fn(),
        warn: globals_1.jest.fn(),
        error: globals_1.jest.fn(),
        log: globals_1.jest.fn()
    };
    return {
        __esModule: true,
        default: Object.assign(Object.assign({}, mockChild), { child: globals_1.jest.fn(() => mockChild) })
    };
});
(0, globals_1.describe)('DirectPackageManager', () => {
    let service;
    let mockPrisma;
    let mockVirtioService;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        mockPrisma = new MockPrismaClient();
        mockVirtioService = new MockVirtioSocketWatcherService();
        service = new DirectPackageManager_1.DirectPackageManager(mockPrisma, mockVirtioService);
    });
    (0, globals_1.describe)('listPackages', () => {
        (0, globals_1.it)('should list all packages on a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            const mockPackages = [
                { name: 'Chrome', version: '100.0', installed: true },
                { name: 'Firefox', version: '99.0', installed: true }
            ];
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                data: { packages: mockPackages }
            });
            const result = yield service.listPackages('vm-123');
            (0, globals_1.expect)(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: 'vm-123' },
                select: { id: true, name: true, os: true, status: true }
            });
            (0, globals_1.expect)(result.length).toBe(2);
            (0, globals_1.expect)(result[0].name).toBe('Chrome');
        }));
        (0, globals_1.it)('should throw error when machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            yield (0, globals_1.expect)(service.listPackages('non-existent')).rejects.toThrow('not found');
        }));
        (0, globals_1.it)('should throw error when command execution fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: false,
                error: 'Command failed'
            });
            yield (0, globals_1.expect)(service.listPackages('vm-123')).rejects.toThrow();
        }));
        (0, globals_1.it)('should return empty array when no packages installed', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                data: { packages: [] }
            });
            const result = yield service.listPackages('vm-123');
            (0, globals_1.expect)(result).toEqual([]);
        }));
        (0, globals_1.it)('should throw error when machine is not running', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'stopped'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            yield (0, globals_1.expect)(service.listPackages('vm-123')).rejects.toThrow('not running');
        }));
    });
    (0, globals_1.describe)('installPackage', () => {
        (0, globals_1.it)('should install a package successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                stdout: 'Package installed successfully',
                exit_code: 0
            });
            const result = yield service.installPackage('vm-123', 'Chrome');
            (0, globals_1.expect)(result.success).toBe(true);
            (0, globals_1.expect)(result.message).toContain('successfully');
        }));
        (0, globals_1.it)('should return failure when installation fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: false,
                error: 'Package not found',
                exit_code: 1
            });
            const result = yield service.installPackage('vm-123', 'nonexistent-package');
            (0, globals_1.expect)(result.success).toBe(false);
            (0, globals_1.expect)(result.message).toContain('Failed');
        }));
        (0, globals_1.it)('should return failure when machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield service.installPackage('non-existent', 'Chrome');
            (0, globals_1.expect)(result.success).toBe(false);
            (0, globals_1.expect)(result.error).toBe('Machine not found');
        }));
    });
    (0, globals_1.describe)('removePackage', () => {
        (0, globals_1.it)('should remove a package successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                stdout: 'Package removed successfully',
                exit_code: 0
            });
            const result = yield service.removePackage('vm-123', 'Chrome');
            (0, globals_1.expect)(result.success).toBe(true);
        }));
        (0, globals_1.it)('should return failure when removal fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: false,
                error: 'Package not found',
                exit_code: 1
            });
            const result = yield service.removePackage('vm-123', 'nonexistent');
            (0, globals_1.expect)(result.success).toBe(false);
            (0, globals_1.expect)(result.message).toContain('Failed');
        }));
    });
    (0, globals_1.describe)('updatePackage', () => {
        (0, globals_1.it)('should update a package successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                stdout: 'Package updated successfully',
                exit_code: 0
            });
            const result = yield service.updatePackage('vm-123', 'Chrome');
            (0, globals_1.expect)(result.success).toBe(true);
        }));
    });
    (0, globals_1.describe)('error handling', () => {
        (0, globals_1.it)('should handle VirtioSocketWatcherService execution errors in installPackage', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockRejectedValue(new Error('Connection lost'));
            // installPackage catches errors and returns a failure result
            const result = yield service.installPackage('vm-123', 'Chrome');
            (0, globals_1.expect)(result.success).toBe(false);
            (0, globals_1.expect)(result.error).toBeDefined();
        }));
        (0, globals_1.it)('should handle database errors in listPackages', () => __awaiter(void 0, void 0, void 0, function* () {
            const dbError = new Error('Database connection failed');
            mockPrisma.machine.findUnique.mockRejectedValue(dbError);
            yield (0, globals_1.expect)(service.listPackages('vm-123')).rejects.toThrow('Database connection failed');
        }));
    });
    (0, globals_1.describe)('package format handling', () => {
        (0, globals_1.it)('should handle PascalCase response fields', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            const mockPackage = {
                Name: 'Chrome',
                Version: '100.0',
                Installed: true,
                Publisher: 'Google'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                data: { packages: [mockPackage] }
            });
            const result = yield service.listPackages('vm-123');
            (0, globals_1.expect)(result).toEqual([
                globals_1.expect.objectContaining({
                    name: 'Chrome',
                    version: '100.0',
                    installed: true,
                    publisher: 'Google'
                })
            ]);
        }));
        (0, globals_1.it)('should handle lowercase response fields', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            const mockPackage = {
                name: 'Firefox',
                version: '99.0',
                installed: true,
                publisher: 'Mozilla'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                data: { packages: [mockPackage] }
            });
            const result = yield service.listPackages('vm-123');
            (0, globals_1.expect)(result).toEqual([
                globals_1.expect.objectContaining({
                    name: 'Firefox',
                    version: '99.0',
                    installed: true,
                    publisher: 'Mozilla'
                })
            ]);
        }));
    });
    (0, globals_1.describe)('edge cases', () => {
        (0, globals_1.it)('should handle empty package list', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                data: { packages: [] }
            });
            const result = yield service.listPackages('vm-123');
            (0, globals_1.expect)(result).toEqual([]);
        }));
        (0, globals_1.it)('should handle packages without version', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            const mockPackages = [
                { name: 'App1', installed: true },
                { name: 'App2', version: '1.0', installed: true }
            ];
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                data: { packages: mockPackages }
            });
            const result = yield service.listPackages('vm-123');
            (0, globals_1.expect)(result.length).toBe(2);
            (0, globals_1.expect)(result[0].name).toBe('App1');
            (0, globals_1.expect)(result[0].version).toBe('');
        }));
        (0, globals_1.it)('should handle packages with missing optional fields', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            const mockPackages = [
                { name: 'App1', installed: true },
                { name: 'App2', version: '1.0', installed: true, description: 'Test app' }
            ];
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                data: { packages: mockPackages }
            });
            const result = yield service.listPackages('vm-123');
            (0, globals_1.expect)(result.length).toBe(2);
            (0, globals_1.expect)(result[1].description).toBe('Test app');
        }));
    });
    (0, globals_1.describe)('managePackage', () => {
        (0, globals_1.it)('should route to installPackage for INSTALL action', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                stdout: 'Installed'
            });
            const result = yield service.managePackage('vm-123', 'Chrome', DirectPackageManager_1.PackageAction.INSTALL);
            (0, globals_1.expect)(result.success).toBe(true);
        }));
        (0, globals_1.it)('should route to removePackage for REMOVE action', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                stdout: 'Removed'
            });
            const result = yield service.managePackage('vm-123', 'Chrome', DirectPackageManager_1.PackageAction.REMOVE);
            (0, globals_1.expect)(result.success).toBe(true);
        }));
        (0, globals_1.it)('should route to updatePackage for UPDATE action', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = {
                id: 'vm-123',
                name: 'test-vm',
                os: 'WINDOWS10',
                status: 'running'
            };
            mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            mockVirtioService.sendPackageCommand.mockResolvedValue({
                success: true,
                stdout: 'Updated'
            });
            const result = yield service.managePackage('vm-123', 'Chrome', DirectPackageManager_1.PackageAction.UPDATE);
            (0, globals_1.expect)(result.success).toBe(true);
        }));
    });
});
