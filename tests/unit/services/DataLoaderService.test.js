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
const DataLoaderService_1 = require("../../../app/services/DataLoaderService");
const mock_factories_1 = require("../../setup/mock-factories");
// Create a mock PrismaClient for unit testing
function createMockPrisma() {
    return {
        user: {
            findMany: jest.fn().mockResolvedValue([])
        },
        machineTemplate: {
            findMany: jest.fn().mockResolvedValue([])
        },
        department: {
            findMany: jest.fn().mockResolvedValue([])
        },
        application: {
            findMany: jest.fn().mockResolvedValue([])
        },
        processSnapshot: {
            findMany: jest.fn().mockResolvedValue([])
        },
        systemMetrics: {
            findMany: jest.fn().mockResolvedValue([])
        },
        machineConfiguration: {
            findMany: jest.fn().mockResolvedValue([])
        },
        machine: {
            findMany: jest.fn().mockResolvedValue([])
        }
    };
}
describe('DataLoaderService', () => {
    let prisma;
    let dataLoaderService;
    beforeEach(() => {
        prisma = createMockPrisma();
        dataLoaderService = new DataLoaderService_1.DataLoaderService(prisma);
    });
    describe('Basic Service Setup', () => {
        it('should instantiate with Prisma client', () => {
            expect(dataLoaderService).toBeDefined();
            expect(dataLoaderService).toHaveProperty('loadUser');
            expect(dataLoaderService).toHaveProperty('loadTemplate');
            expect(dataLoaderService).toHaveProperty('loadDepartment');
            expect(dataLoaderService).toHaveProperty('loadApplication');
            expect(dataLoaderService).toHaveProperty('loadProcessSnapshot');
            expect(dataLoaderService).toHaveProperty('loadSystemMetrics');
            expect(dataLoaderService).toHaveProperty('loadMachineConfiguration');
            expect(dataLoaderService).toHaveProperty('loadMachine');
            expect(dataLoaderService).toHaveProperty('clearAll');
            expect(dataLoaderService).toHaveProperty('clear');
        });
    });
    describe('DataLoaders initialization', () => {
        it('should initialize all data loaders', () => {
            const service = dataLoaderService;
            expect(service.userLoader).toBeDefined();
            expect(service.templateLoader).toBeDefined();
            expect(service.departmentLoader).toBeDefined();
            expect(service.applicationLoader).toBeDefined();
            expect(service.processSnapshotLoader).toBeDefined();
            expect(service.systemMetricsLoader).toBeDefined();
            expect(service.machineConfigurationLoader).toBeDefined();
            expect(service.machineLoader).toBeDefined();
        });
    });
    describe('loadUser', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadUser(null);
            expect(result).toBeNull();
        }));
        it('should return null when id is undefined', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadUser(undefined);
            expect(result).toBeNull();
        }));
        it('should return user when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testUser = (0, mock_factories_1.createMockUser)({ id: 'user-1' });
            prisma.user.findMany.mockResolvedValue([testUser]);
            const result = yield dataLoaderService.loadUser('user-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('user-1');
            expect(result.email).toBe(testUser.email);
        }));
        it('should return null when user does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.user.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadUser('non-existent-id');
            expect(result).toBeNull();
        }));
        it('should cache subsequent loads of the same id', () => __awaiter(void 0, void 0, void 0, function* () {
            const testUser = (0, mock_factories_1.createMockUser)({ id: 'user-cache' });
            prisma.user.findMany.mockResolvedValue([testUser]);
            const result1 = yield dataLoaderService.loadUser('user-cache');
            const result2 = yield dataLoaderService.loadUser('user-cache');
            expect(result1.id).toBe(result2.id);
            // DataLoader should batch and cache, so findMany called only once
            expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        }));
    });
    describe('loadTemplate', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadTemplate(null);
            expect(result).toBeNull();
        }));
        it('should return machine template when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testTemplate = (0, mock_factories_1.createMockMachineTemplate)({ id: 'template-1', name: 'Test Template' });
            prisma.machineTemplate.findMany.mockResolvedValue([testTemplate]);
            const result = yield dataLoaderService.loadTemplate('template-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('template-1');
            expect(result.name).toBe('Test Template');
        }));
        it('should return null when template does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.machineTemplate.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadTemplate('non-existent-id');
            expect(result).toBeNull();
        }));
    });
    describe('loadDepartment', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadDepartment(null);
            expect(result).toBeNull();
        }));
        it('should return department when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testDepartment = (0, mock_factories_1.createMockDepartment)({ id: 'dept-1', name: 'Test Department' });
            prisma.department.findMany.mockResolvedValue([testDepartment]);
            const result = yield dataLoaderService.loadDepartment('dept-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('dept-1');
            expect(result.name).toBe('Test Department');
        }));
        it('should return null when department does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.department.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadDepartment('non-existent-id');
            expect(result).toBeNull();
        }));
    });
    describe('loadApplication', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadApplication(null);
            expect(result).toBeNull();
        }));
        it('should return application when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testApp = (0, mock_factories_1.createMockApplication)({ id: 'app-1', name: 'Test App' });
            prisma.application.findMany.mockResolvedValue([testApp]);
            const result = yield dataLoaderService.loadApplication('app-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('app-1');
            expect(result.name).toBe('Test App');
        }));
        it('should return null when application does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.application.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadApplication('non-existent-id');
            expect(result).toBeNull();
        }));
    });
    describe('loadProcessSnapshot', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadProcessSnapshot(null);
            expect(result).toBeNull();
        }));
        it('should return process snapshot when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testSnapshot = (0, mock_factories_1.createMockProcessSnapshot)({ id: 'snap-1', machineId: 'vm-1' });
            prisma.processSnapshot.findMany.mockResolvedValue([testSnapshot]);
            const result = yield dataLoaderService.loadProcessSnapshot('snap-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('snap-1');
            expect(result.machineId).toBe('vm-1');
        }));
        it('should return null when process snapshot does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.processSnapshot.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadProcessSnapshot('non-existent-id');
            expect(result).toBeNull();
        }));
    });
    describe('loadSystemMetrics', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadSystemMetrics(null);
            expect(result).toBeNull();
        }));
        it('should return system metrics when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testMetrics = (0, mock_factories_1.createMockSystemMetrics)({ id: 'metrics-1', cpuUsagePercent: 50.5 });
            prisma.systemMetrics.findMany.mockResolvedValue([testMetrics]);
            const result = yield dataLoaderService.loadSystemMetrics('metrics-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('metrics-1');
            expect(result.cpuUsagePercent).toBe(50.5);
        }));
        it('should return null when system metrics does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.systemMetrics.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadSystemMetrics('non-existent-id');
            expect(result).toBeNull();
        }));
    });
    describe('loadMachineConfiguration', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadMachineConfiguration(null);
            expect(result).toBeNull();
        }));
        it('should return machine configuration when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testConfig = (0, mock_factories_1.createMockMachineConfiguration)({ id: 'config-1', bridge: 'br-test' });
            prisma.machineConfiguration.findMany.mockResolvedValue([testConfig]);
            const result = yield dataLoaderService.loadMachineConfiguration('config-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('config-1');
            expect(result.bridge).toBe('br-test');
        }));
        it('should return null when machine configuration does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.machineConfiguration.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadMachineConfiguration('non-existent-id');
            expect(result).toBeNull();
        }));
    });
    describe('loadMachine', () => {
        it('should return null when id is null', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadMachine(null);
            expect(result).toBeNull();
        }));
        it('should return machine when valid id is provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const testMachine = (0, mock_factories_1.createMockMachine)({ id: 'vm-1', name: 'Test VM', departmentId: 'dept-1' });
            prisma.machine.findMany.mockResolvedValue([testMachine]);
            const result = yield dataLoaderService.loadMachine('vm-1');
            expect(result).not.toBeNull();
            expect(result.id).toBe('vm-1');
            expect(result.name).toBe('Test VM');
            expect(result.departmentId).toBe('dept-1');
        }));
        it('should return null when machine does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.machine.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadMachine('non-existent-id');
            expect(result).toBeNull();
        }));
    });
    describe('clearAll', () => {
        it('should clear all loaders without error', () => {
            expect(() => dataLoaderService.clearAll()).not.toThrow();
        });
        it('should allow reloading after clear', () => __awaiter(void 0, void 0, void 0, function* () {
            const testUser = (0, mock_factories_1.createMockUser)({ id: 'user-1' });
            prisma.user.findMany.mockResolvedValue([testUser]);
            yield dataLoaderService.loadUser('user-1');
            dataLoaderService.clearAll();
            const result = yield dataLoaderService.loadUser('user-1');
            expect(result).not.toBeNull();
            // After clear, findMany is called again
            expect(prisma.user.findMany).toHaveBeenCalledTimes(2);
        }));
    });
    describe('clear', () => {
        it('should clear specific loader by name - user', () => {
            expect(() => dataLoaderService.clear('user')).not.toThrow();
        });
        it('should clear specific loader by name - template', () => {
            expect(() => dataLoaderService.clear('template')).not.toThrow();
        });
        it('should clear specific loader by name - department', () => {
            expect(() => dataLoaderService.clear('department')).not.toThrow();
        });
        it('should clear specific loader by name - application', () => {
            expect(() => dataLoaderService.clear('application')).not.toThrow();
        });
        it('should clear specific loader by name - processSnapshot', () => {
            expect(() => dataLoaderService.clear('processSnapshot')).not.toThrow();
        });
        it('should clear specific loader by name - systemMetrics', () => {
            expect(() => dataLoaderService.clear('systemMetrics')).not.toThrow();
        });
        it('should clear specific loader by name - machineConfiguration', () => {
            expect(() => dataLoaderService.clear('machineConfiguration')).not.toThrow();
        });
        it('should clear specific loader by name - machine', () => {
            expect(() => dataLoaderService.clear('machine')).not.toThrow();
        });
    });
    describe('DataLoader batching behavior', () => {
        it('should batch multiple user loads efficiently', () => __awaiter(void 0, void 0, void 0, function* () {
            const users = [
                (0, mock_factories_1.createMockUser)({ id: 'user-1' }),
                (0, mock_factories_1.createMockUser)({ id: 'user-2' }),
                (0, mock_factories_1.createMockUser)({ id: 'user-3' })
            ];
            prisma.user.findMany.mockResolvedValue(users);
            const [user1, user2, user3] = yield Promise.all([
                dataLoaderService.loadUser('user-1'),
                dataLoaderService.loadUser('user-2'),
                dataLoaderService.loadUser('user-3')
            ]);
            expect(user1).not.toBeNull();
            expect(user2).not.toBeNull();
            expect(user3).not.toBeNull();
            expect(user1.id).toBe('user-1');
            expect(user2.id).toBe('user-2');
            expect(user3.id).toBe('user-3');
            // DataLoader should batch into a single query
            expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
        }));
        it('should handle null values in batch loads', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.user.findMany.mockResolvedValue([]);
            const [result1, result2] = yield Promise.all([
                dataLoaderService.loadUser('non-existent-id-1'),
                dataLoaderService.loadUser('non-existent-id-2')
            ]);
            expect(result1).toBeNull();
            expect(result2).toBeNull();
        }));
    });
    describe('Integration - Loading related entities', () => {
        it('should allow loading machine and department in same tick', () => __awaiter(void 0, void 0, void 0, function* () {
            const testDepartment = (0, mock_factories_1.createMockDepartment)({ id: 'dept-1', name: 'Test Department' });
            const testMachine = (0, mock_factories_1.createMockMachine)({ id: 'vm-1', departmentId: 'dept-1' });
            prisma.machine.findMany.mockResolvedValue([testMachine]);
            prisma.department.findMany.mockResolvedValue([testDepartment]);
            const [machine, department] = yield Promise.all([
                dataLoaderService.loadMachine('vm-1'),
                dataLoaderService.loadDepartment('dept-1')
            ]);
            expect(machine).not.toBeNull();
            expect(department).not.toBeNull();
            expect(machine.id).toBe('vm-1');
            expect(machine.departmentId).toBe('dept-1');
            expect(department.id).toBe('dept-1');
        }));
    });
    describe('Edge cases', () => {
        it('should handle empty string id', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield dataLoaderService.loadUser('');
            // Empty string is falsy, so loadUser returns null without calling DataLoader
            expect(result).toBeNull();
        }));
        it('should handle whitespace-only id', () => __awaiter(void 0, void 0, void 0, function* () {
            ;
            prisma.user.findMany.mockResolvedValue([]);
            const result = yield dataLoaderService.loadUser('   ');
            expect(result).toBeNull();
        }));
        it('should handle UUID format strings', () => __awaiter(void 0, void 0, void 0, function* () {
            const testUser = (0, mock_factories_1.createMockUser)({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });
            prisma.user.findMany.mockResolvedValue([testUser]);
            const result = yield dataLoaderService.loadUser('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
            expect(result === null || result === void 0 ? void 0 : result.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        }));
    });
});
