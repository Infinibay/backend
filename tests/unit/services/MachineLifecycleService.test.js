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
const globals_1 = require("@jest/globals");
const machineLifecycleService_1 = require("../../../app/services/machineLifecycleService");
const jest_setup_1 = require("../../setup/jest.setup");
const errors_1 = require("@utils/errors");
const machineCleanupServiceV2_1 = require("../../../app/services/cleanup/machineCleanupServiceV2");
const hardwareUpdateService_1 = require("../../../app/services/vm/hardwareUpdateService");
const EventManager_1 = require("../../../app/services/EventManager");
const systeminformation_1 = __importDefault(require("systeminformation"));
const mock_factories_1 = require("../../setup/mock-factories");
const type_1 = require("../../../app/graphql/resolvers/machine/type");
// Mock dependencies
globals_1.jest.mock('../../../app/services/cleanup/machineCleanupServiceV2');
globals_1.jest.mock('../../../app/services/vm/hardwareUpdateService');
globals_1.jest.mock('../../../app/services/CreateMachineServiceV2');
globals_1.jest.mock('../../../app/services/EventManager', () => ({
    getEventManager: globals_1.jest.fn()
}));
globals_1.jest.mock('systeminformation');
globals_1.jest.mock('uuid', () => ({
    v4: globals_1.jest.fn(() => 'mock-uuid-123')
}));
(0, globals_1.describe)('MachineLifecycleService', () => {
    let service;
    let mockUser;
    let mockEventManager;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        mockUser = (0, mock_factories_1.createMockUser)();
        // Mock EventManager
        mockEventManager = {
            dispatchEvent: globals_1.jest.fn().mockResolvedValue(undefined),
            setIo: globals_1.jest.fn(),
            broadcastToAll: globals_1.jest.fn(),
            dispatchToRoom: globals_1.jest.fn(),
            joinRoom: globals_1.jest.fn(),
            leaveRoom: globals_1.jest.fn()
        };
        EventManager_1.getEventManager.mockReturnValue(mockEventManager);
        // Mock systeminformation
        const siMock = globals_1.jest.mocked(systeminformation_1.default);
        siMock.graphics.mockResolvedValue({
            controllers: [
                {
                    pciBus: '0000:01:00.0',
                    model: 'NVIDIA GeForce GTX 1080',
                    vendor: 'NVIDIA',
                    bus: 'PCIe',
                    vram: 8192,
                    vramDynamic: false
                },
                {
                    pciBus: '0000:02:00.0',
                    model: 'AMD Radeon RX 580',
                    vendor: 'AMD',
                    bus: 'PCIe',
                    vram: 8192,
                    vramDynamic: false
                }
            ],
            displays: []
        });
        service = new machineLifecycleService_1.MachineLifecycleService(jest_setup_1.mockPrisma, mockUser);
    });
    (0, globals_1.describe)('createMachine', () => {
        (0, globals_1.it)('should create machine with custom hardware', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Test Machine',
                customCores: 4,
                customRam: 8,
                customStorage: 100,
                os: type_1.OsEnum.UBUNTU,
                applications: [],
                username: 'admin',
                password: 'password123',
                departmentId: 'dept-123',
                pciBus: null,
                firstBootScripts: []
            };
            const mockDepartment = (0, mock_factories_1.createMockDepartment)({
                id: 'dept-123',
                name: 'Default Department'
            });
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123',
                name: 'Test Machine',
                userId: 'user-123',
                status: 'building',
                os: type_1.OsEnum.UBUNTU,
                templateId: null,
                internalName: 'mock-uuid-123',
                departmentId: 'dept-123',
                cpuCores: 4,
                ramGB: 8,
                diskSizeGB: 100,
                gpuPciAddress: null
            });
            jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
                if (typeof fn === 'function') {
                    const tx = {
                        department: {
                            findUnique: globals_1.jest.fn().mockResolvedValue(mockDepartment),
                            findFirst: globals_1.jest.fn().mockResolvedValue(mockDepartment)
                        },
                        machine: {
                            create: globals_1.jest.fn().mockResolvedValue(mockMachine)
                        },
                        machineApplication: {
                            create: globals_1.jest.fn()
                        }
                    };
                    return fn(tx);
                }
                return Promise.resolve([]);
            }));
            const result = yield service.createMachine(input);
            (0, globals_1.expect)(result).toEqual(mockMachine);
            (0, globals_1.expect)(result.cpuCores).toBe(4);
            (0, globals_1.expect)(result.ramGB).toBe(8);
            (0, globals_1.expect)(result.diskSizeGB).toBe(100);
        }));
        (0, globals_1.it)('should create machine with template', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Windows Machine',
                templateId: 'template-123',
                os: type_1.OsEnum.WINDOWS11,
                applications: [{ applicationId: 'app-1', parameters: {}, machineId: '' }],
                username: 'admin',
                password: 'password123',
                productKey: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
                departmentId: 'dept-123',
                pciBus: null,
                firstBootScripts: []
            };
            const mockTemplate = (0, mock_factories_1.createMockMachineTemplate)({
                id: 'template-123',
                name: 'Windows Template',
                cores: 8,
                ram: 16,
                storage: 500
            });
            const mockDepartment = {
                id: 'dept-123',
                name: 'Default Department'
            };
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123',
                name: 'Windows Machine',
                userId: 'user-123',
                status: 'building',
                os: type_1.OsEnum.WINDOWS11,
                templateId: 'template-123',
                internalName: 'mock-uuid-123',
                departmentId: 'dept-123',
                cpuCores: 8,
                ramGB: 16,
                diskSizeGB: 500,
                gpuPciAddress: null
            });
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(mockTemplate);
            jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
                if (typeof fn === 'function') {
                    const tx = {
                        department: {
                            findUnique: globals_1.jest.fn().mockResolvedValue(mockDepartment)
                        },
                        machine: {
                            create: globals_1.jest.fn().mockResolvedValue(mockMachine)
                        },
                        machineApplication: {
                            create: globals_1.jest.fn()
                        }
                    };
                    return fn(tx);
                }
                return Promise.resolve([]);
            }));
            const result = yield service.createMachine(input);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
                where: { id: 'template-123' }
            });
            (0, globals_1.expect)(result).toEqual(mockMachine);
            (0, globals_1.expect)(result.cpuCores).toBe(8);
            (0, globals_1.expect)(result.ramGB).toBe(16);
            (0, globals_1.expect)(result.diskSizeGB).toBe(500);
        }));
        (0, globals_1.it)('should throw error if template not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Test Machine',
                templateId: 'non-existent',
                os: type_1.OsEnum.UBUNTU,
                applications: [],
                username: 'admin',
                password: 'password123',
                departmentId: 'dept-123',
                pciBus: null,
                firstBootScripts: []
            };
            jest_setup_1.mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);
            yield (0, globals_1.expect)(service.createMachine(input))
                .rejects.toThrow(errors_1.UserInputError);
        }));
        (0, globals_1.it)('should throw error if custom hardware specs missing', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Test Machine',
                templateId: 'custom',
                os: type_1.OsEnum.UBUNTU,
                applications: [],
                username: 'admin',
                password: 'password123',
                departmentId: 'dept-123',
                pciBus: null,
                firstBootScripts: []
            };
            yield (0, globals_1.expect)(service.createMachine(input))
                .rejects.toThrow('Custom hardware specifications are required when not using a template');
        }));
        (0, globals_1.it)('should throw error if department not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Test Machine',
                customCores: 4,
                customRam: 8,
                customStorage: 100,
                os: type_1.OsEnum.UBUNTU,
                departmentId: 'non-existent',
                applications: [],
                username: 'admin',
                password: 'password123',
                pciBus: null,
                firstBootScripts: []
            };
            jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
                if (typeof fn === 'function') {
                    const tx = {
                        department: {
                            findUnique: globals_1.jest.fn().mockResolvedValue(null),
                            findFirst: globals_1.jest.fn().mockResolvedValue(null)
                        },
                        machine: {
                            create: globals_1.jest.fn()
                        },
                        machineApplication: {
                            create: globals_1.jest.fn()
                        }
                    };
                    return fn(tx);
                }
                return Promise.resolve([]);
            }));
            yield (0, globals_1.expect)(service.createMachine(input))
                .rejects.toThrow('Department not found');
        }));
        (0, globals_1.it)('should create machine applications', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                name: 'Test Machine',
                customCores: 4,
                customRam: 8,
                customStorage: 100,
                os: type_1.OsEnum.UBUNTU,
                applications: [
                    { applicationId: 'app-1', parameters: { key: 'value1' }, machineId: '' },
                    { applicationId: 'app-2', parameters: { key: 'value2' }, machineId: '' }
                ],
                username: 'admin',
                password: 'password123',
                departmentId: 'dept-123',
                pciBus: null,
                firstBootScripts: []
            };
            const mockDepartment = {
                id: 'dept-123',
                name: 'Default Department'
            };
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123',
                name: 'Test Machine',
                userId: 'user-123',
                status: 'building',
                os: type_1.OsEnum.UBUNTU,
                templateId: null,
                internalName: 'mock-uuid-123',
                departmentId: 'dept-123',
                cpuCores: 4,
                ramGB: 8,
                diskSizeGB: 100,
                gpuPciAddress: null
            });
            const createApplicationMock = globals_1.jest.fn();
            jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () {
                if (typeof fn === 'function') {
                    const tx = {
                        department: {
                            findUnique: globals_1.jest.fn().mockResolvedValue(mockDepartment),
                            findFirst: globals_1.jest.fn().mockResolvedValue(mockDepartment)
                        },
                        machine: {
                            create: globals_1.jest.fn().mockResolvedValue(mockMachine)
                        },
                        machineApplication: {
                            create: createApplicationMock
                        }
                    };
                    return fn(tx);
                }
                return Promise.resolve([]);
            }));
            const result = yield service.createMachine(input);
            (0, globals_1.expect)(result).toEqual(mockMachine);
            (0, globals_1.expect)(createApplicationMock).toHaveBeenCalledTimes(2);
            (0, globals_1.expect)(createApplicationMock).toHaveBeenCalledWith({
                data: {
                    machineId: 'machine-123',
                    applicationId: 'app-1',
                    parameters: { key: 'value1' }
                }
            });
            (0, globals_1.expect)(createApplicationMock).toHaveBeenCalledWith({
                data: {
                    machineId: 'machine-123',
                    applicationId: 'app-2',
                    parameters: { key: 'value2' }
                }
            });
        }));
    });
    (0, globals_1.describe)('destroyMachine', () => {
        (0, globals_1.it)('should destroy machine successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123',
                userId: (mockUser === null || mockUser === void 0 ? void 0 : mockUser.id) || 'user-123'
            });
            jest_setup_1.mockPrisma.machine.findFirst.mockResolvedValue(mockMachine);
            // Mock the MachineCleanupService
            const mockCleanupVM = globals_1.jest.fn();
            machineCleanupServiceV2_1.MachineCleanupServiceV2.mockImplementation(() => ({
                cleanupVM: mockCleanupVM
            }));
            const result = yield service.destroyMachine('machine-123');
            (0, globals_1.expect)(result).toEqual({
                success: true,
                message: 'Machine destroyed'
            });
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.findFirst).toHaveBeenCalledWith({
                where: { id: 'machine-123', userId: mockUser === null || mockUser === void 0 ? void 0 : mockUser.id },
                include: {
                    configuration: true
                }
            });
            (0, globals_1.expect)(mockCleanupVM).toHaveBeenCalledWith('machine-123');
        }));
        (0, globals_1.it)('should return error if machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findFirst.mockResolvedValue(null);
            const result = yield service.destroyMachine('non-existent');
            (0, globals_1.expect)(result).toEqual({
                success: false,
                message: 'Machine not found'
            });
        }));
        (0, globals_1.it)('should handle cleanup errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123',
                userId: (mockUser === null || mockUser === void 0 ? void 0 : mockUser.id) || 'user-123'
            });
            jest_setup_1.mockPrisma.machine.findFirst.mockResolvedValue(mockMachine);
            // Mock the MachineCleanupService to throw an error
            const mockCleanupVM = globals_1.jest.fn(() => Promise.reject(new Error('Cleanup failed')));
            machineCleanupServiceV2_1.MachineCleanupServiceV2.mockImplementation(() => ({
                cleanupVM: mockCleanupVM
            }));
            const result = yield service.destroyMachine('machine-123');
            (0, globals_1.expect)(result).toEqual({
                success: false,
                message: 'Error destroying machine: Cleanup failed'
            });
        }));
    });
    (0, globals_1.describe)('updateMachineHardware', () => {
        (0, globals_1.it)('should update machine hardware successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123',
                cpuCores: 4,
                ramGB: 8,
                gpuPciAddress: null
            });
            const updatedMachine = Object.assign(Object.assign({}, mockMachine), { cpuCores: 8, ramGB: 16 });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            jest_setup_1.mockPrisma.machine.update.mockResolvedValue(updatedMachine);
            // Mock the HardwareUpdateService
            const mockUpdateHardware = globals_1.jest.fn();
            hardwareUpdateService_1.HardwareUpdateService.mockImplementation(() => ({
                updateHardware: mockUpdateHardware
            }));
            const input = {
                id: 'machine-123',
                cpuCores: 8,
                ramGB: 16
            };
            const result = yield service.updateMachineHardware(input);
            (0, globals_1.expect)(result).toEqual(updatedMachine);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.update).toHaveBeenCalledWith({
                where: { id: 'machine-123' },
                data: {
                    cpuCores: 8,
                    ramGB: 16
                },
                include: globals_1.expect.any(Object)
            });
        }));
        (0, globals_1.it)('should validate GPU PCI address', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123',
                gpuPciAddress: null
            });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const input = {
                id: 'machine-123',
                gpuPciAddress: 'invalid-pci'
            };
            yield (0, globals_1.expect)(service.updateMachineHardware(input))
                .rejects.toThrow('Failed to validate GPU PCI address');
        }));
        (0, globals_1.it)('should throw error if machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
            const input = {
                id: 'non-existent',
                cpuCores: 8
            };
            yield (0, globals_1.expect)(service.updateMachineHardware(input))
                .rejects.toThrow(errors_1.ApolloError);
        }));
        (0, globals_1.it)('should return same machine if no changes provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = (0, mock_factories_1.createMockMachine)({
                id: 'machine-123'
            });
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
            const input = {
                id: 'machine-123'
            };
            const result = yield service.updateMachineHardware(input);
            (0, globals_1.expect)(result).toEqual(mockMachine);
            (0, globals_1.expect)(jest_setup_1.mockPrisma.machine.update).not.toHaveBeenCalled();
        }));
    });
});
