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
const DataLoaderService_1 = require("../../../app/services/DataLoaderService");
(0, globals_1.describe)('DataLoaderService', () => {
    let service;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockTables;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        mockTables = {
            user: { findMany: globals_1.jest.fn() },
            machineTemplate: { findMany: globals_1.jest.fn() },
            department: { findMany: globals_1.jest.fn() },
            application: { findMany: globals_1.jest.fn() },
            processSnapshot: { findMany: globals_1.jest.fn() },
            systemMetrics: { findMany: globals_1.jest.fn() },
            machineConfiguration: { findMany: globals_1.jest.fn() },
            machine: { findMany: globals_1.jest.fn() }
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service = new DataLoaderService_1.DataLoaderService(mockTables);
    });
    afterEach(() => {
        globals_1.jest.restoreAllMocks();
    });
    (0, globals_1.describe)('loadUser', () => {
        (0, globals_1.it)('should load a user successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockUser = { id: 'user-1', name: 'Test User', email: 'test@example.com' };
            mockTables.user.findMany.mockResolvedValue([mockUser]);
            const result = yield service.loadUser('user-1');
            (0, globals_1.expect)(result).toEqual(mockUser);
            (0, globals_1.expect)(mockTables.user.findMany).toHaveBeenCalledWith({
                where: { id: { in: ['user-1'] } }
            });
        }));
        (0, globals_1.it)('should return null for non-existent user', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.user.findMany.mockResolvedValue([]);
            const result = yield service.loadUser('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
        (0, globals_1.it)('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield service.loadUser(null);
            (0, globals_1.expect)(result).toBeNull();
        }));
        (0, globals_1.it)('should return null when id is empty string', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield service.loadUser('');
            (0, globals_1.expect)(result).toBeNull();
        }));
        (0, globals_1.it)('should handle user not found gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockUser = { id: 'user-2', name: 'Other User', email: 'other@example.com' };
            mockTables.user.findMany.mockResolvedValue([mockUser]);
            const result = yield service.loadUser('user-1');
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('loadTemplate', () => {
        (0, globals_1.it)('should load a template successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockTemplate = { id: 'template-1', name: 'Test Template', cpu: 4, memory: 8192, createdAt: new Date(), updatedAt: new Date() };
            mockTables.machineTemplate.findMany.mockResolvedValue([mockTemplate]);
            const result = yield service.loadTemplate('template-1');
            (0, globals_1.expect)(result).toEqual(mockTemplate);
        }));
        (0, globals_1.it)('should return null for non-existent template', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.machineTemplate.findMany.mockResolvedValue([]);
            const result = yield service.loadTemplate('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
        (0, globals_1.it)('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield service.loadTemplate(null);
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('loadDepartment', () => {
        (0, globals_1.it)('should load a department successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockDepartment = { id: 'dept-1', name: 'IT Department', description: 'IT Department', bridgeName: 'br-test', firewallPolicyId: null, mtu: 1500, dnsServers: [], ntpServers: [], createdAt: new Date(), updatedAt: new Date(), firewallPolicy: null };
            mockTables.department.findMany.mockResolvedValue([mockDepartment]);
            const result = yield service.loadDepartment('dept-1');
            (0, globals_1.expect)(result).toEqual(mockDepartment);
        }));
        (0, globals_1.it)('should return null for non-existent department', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.department.findMany.mockResolvedValue([]);
            const result = yield service.loadDepartment('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('loadApplication', () => {
        (0, globals_1.it)('should load an application successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockApplication = { id: 'app-1', name: 'Test App', version: '1.0.0', createdAt: new Date(), updatedAt: new Date() };
            mockTables.application.findMany.mockResolvedValue([mockApplication]);
            const result = yield service.loadApplication('app-1');
            (0, globals_1.expect)(result).toEqual(mockApplication);
        }));
        (0, globals_1.it)('should return null for non-existent application', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.application.findMany.mockResolvedValue([]);
            const result = yield service.loadApplication('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('loadProcessSnapshot', () => {
        (0, globals_1.it)('should load a process snapshot successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockSnapshot = { id: 'snapshot-1', status: 'completed', createdAt: new Date(), updatedAt: new Date(), machineId: 'test' };
            mockTables.processSnapshot.findMany.mockResolvedValue([mockSnapshot]);
            const result = yield service.loadProcessSnapshot('snapshot-1');
            (0, globals_1.expect)(result).toEqual(mockSnapshot);
        }));
        (0, globals_1.it)('should return null for non-existent snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.processSnapshot.findMany.mockResolvedValue([]);
            const result = yield service.loadProcessSnapshot('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('loadSystemMetrics', () => {
        (0, globals_1.it)('should load system metrics successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMetrics = { id: 'metrics-1', cpuUsage: 45, memoryUsage: 62, createdAt: new Date(), updatedAt: new Date() };
            mockTables.systemMetrics.findMany.mockResolvedValue([mockMetrics]);
            const result = yield service.loadSystemMetrics('metrics-1');
            (0, globals_1.expect)(result).toEqual(mockMetrics);
        }));
        (0, globals_1.it)('should return null for non-existent metrics', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.systemMetrics.findMany.mockResolvedValue([]);
            const result = yield service.loadSystemMetrics('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('loadMachineConfiguration', () => {
        (0, globals_1.it)('should load a machine configuration successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockConfig = { id: 'config-1', machineId: 'machine-1', bridge: 'br-test', tapDeviceName: 'tap1', networkInterfaceType: 'virtio', vhostNet: true, maxVirtioSockLinks: 6, createdAt: new Date(), updatedAt: new Date(), configuration: { cpu: 4, memory: 8192 } };
            mockTables.machineConfiguration.findMany.mockResolvedValue([mockConfig]);
            const result = yield service.loadMachineConfiguration('config-1');
            (0, globals_1.expect)(result).toEqual(mockConfig);
        }));
        (0, globals_1.it)('should return null for non-existent configuration', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.machineConfiguration.findMany.mockResolvedValue([]);
            const result = yield service.loadMachineConfiguration('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('loadMachine', () => {
        (0, globals_1.it)('should load a machine successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: 'machine-1', name: 'Test Machine', status: 'running', userId: 'user-1', createdAt: new Date(), updatedAt: new Date(), description: '', machineTemplateId: null, osId: null, deviceType: 'kvm', deviceModel: 'q35', machineType: 'pc', bios: 'ovmf', efi: false, bootDevice: 'disk', efiDiskPath: null, efiVarsPath: null, secureBoot: false, vnc: false, vncPassword: null, virtioSocketWatcherEnabled: false, qemuGuestAgentEnabled: false, qmpSocketPath: null, devicePath: null, qemudSockPath: null, vhostUserSocks: null, internalName: 'test', cpuCores: 4, ramGB: 8, diskSizeGB: 100, gpuPciAddress: null, departmentId: null, templateId: null, firewallTemplates: {} };
            mockTables.machine.findMany.mockResolvedValue([mockMachine]);
            const result = yield service.loadMachine('machine-1');
            (0, globals_1.expect)(result).toEqual(mockMachine);
        }));
        (0, globals_1.it)('should return null for non-existent machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.machine.findMany.mockResolvedValue([]);
            const result = yield service.loadMachine('non-existent-id');
            (0, globals_1.expect)(result).toBeNull();
        }));
    });
    (0, globals_1.describe)('clearAll', () => {
        (0, globals_1.it)('should clear all loaders', () => {
            const mockClearAll = globals_1.jest.fn();
            service.userLoader.clearAll = mockClearAll;
            service.templateLoader.clearAll = mockClearAll;
            service.departmentLoader.clearAll = mockClearAll;
            service.applicationLoader.clearAll = mockClearAll;
            service.processSnapshotLoader.clearAll = mockClearAll;
            service.systemMetricsLoader.clearAll = mockClearAll;
            service.machineConfigurationLoader.clearAll = mockClearAll;
            service.machineLoader.clearAll = mockClearAll;
            service.clearAll();
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalledTimes(8);
        });
    });
    (0, globals_1.describe)('clear by loader name', () => {
        (0, globals_1.it)('should clear user loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.userLoader.clearAll = mockClearAll;
            service.clear('user');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
        (0, globals_1.it)('should clear template loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.templateLoader.clearAll = mockClearAll;
            service.clear('template');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
        (0, globals_1.it)('should clear department loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.departmentLoader.clearAll = mockClearAll;
            service.clear('department');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
        (0, globals_1.it)('should clear application loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.applicationLoader.clearAll = mockClearAll;
            service.clear('application');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
        (0, globals_1.it)('should clear process snapshot loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.processSnapshotLoader.clearAll = mockClearAll;
            service.clear('processSnapshot');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
        (0, globals_1.it)('should clear system metrics loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.systemMetricsLoader.clearAll = mockClearAll;
            service.clear('systemMetrics');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
        (0, globals_1.it)('should clear machine configuration loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.machineConfigurationLoader.clearAll = mockClearAll;
            service.clear('machineConfiguration');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
        (0, globals_1.it)('should clear machine loader by name', () => {
            const mockClearAll = globals_1.jest.fn();
            service.machineLoader.clearAll = mockClearAll;
            service.clear('machine');
            (0, globals_1.expect)(mockClearAll).toHaveBeenCalled();
        });
    });
    (0, globals_1.describe)('null and edge case handling', () => {
        (0, globals_1.it)('should handle all loader methods with null IDs', () => __awaiter(void 0, void 0, void 0, function* () {
            const nullId = null;
            const userResult = yield service.loadUser(nullId);
            const templateResult = yield service.loadTemplate(nullId);
            const deptResult = yield service.loadDepartment(nullId);
            const appResult = yield service.loadApplication(nullId);
            const snapshotResult = yield service.loadProcessSnapshot(nullId);
            const metricsResult = yield service.loadSystemMetrics(nullId);
            const configResult = yield service.loadMachineConfiguration(nullId);
            const machineResult = yield service.loadMachine(nullId);
            (0, globals_1.expect)(userResult).toBeNull();
            (0, globals_1.expect)(templateResult).toBeNull();
            (0, globals_1.expect)(deptResult).toBeNull();
            (0, globals_1.expect)(appResult).toBeNull();
            (0, globals_1.expect)(snapshotResult).toBeNull();
            (0, globals_1.expect)(metricsResult).toBeNull();
            (0, globals_1.expect)(configResult).toBeNull();
            (0, globals_1.expect)(machineResult).toBeNull();
        }));
        (0, globals_1.it)('should handle all loader methods with empty string IDs', () => __awaiter(void 0, void 0, void 0, function* () {
            const emptyId = '';
            const userResult = yield service.loadUser(emptyId);
            const templateResult = yield service.loadTemplate(emptyId);
            (0, globals_1.expect)(userResult).toBeNull();
            (0, globals_1.expect)(templateResult).toBeNull();
        }));
        (0, globals_1.it)('should handle empty results from database gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockTables.user.findMany.mockResolvedValue([]);
            const result = yield service.loadUser('user-1');
            (0, globals_1.expect)(result).toBeNull();
        }));
        (0, globals_1.it)('should handle database errors gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockError = new Error('Database connection failed');
            mockTables.user.findMany.mockRejectedValue(mockError);
            yield (0, globals_1.expect)(service.loadUser('user-1')).rejects.toThrow('Database connection failed');
        }));
    });
    (0, globals_1.describe)('DataLoader batching behavior', () => {
        (0, globals_1.it)('should batch multiple load requests efficiently', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockUsers = [
                { id: 'user-1', name: 'User 1', email: 'user1@example.com' },
                { id: 'user-2', name: 'User 2', email: 'user2@example.com' },
                { id: 'user-3', name: 'User 3', email: 'user3@example.com' }
            ];
            mockTables.user.findMany.mockResolvedValue(mockUsers);
            // Load multiple users concurrently
            const [user1, user2, user3] = yield Promise.all([
                service.loadUser('user-1'),
                service.loadUser('user-2'),
                service.loadUser('user-3')
            ]);
            (0, globals_1.expect)(user1).toEqual(mockUsers[0]);
            (0, globals_1.expect)(user2).toEqual(mockUsers[1]);
            (0, globals_1.expect)(user3).toEqual(mockUsers[2]);
            // DataLoader should have batched these into a single query
            (0, globals_1.expect)(mockTables.user.findMany).toHaveBeenCalledTimes(1);
        }));
    });
});
