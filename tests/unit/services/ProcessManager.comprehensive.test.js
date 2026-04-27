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
const ProcessManager_1 = require("../../../app/services/ProcessManager");
const mockInfinization = {
    getVMStatus: jest.fn()
};
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn(() => Promise.resolve(mockInfinization))
}));
describe('ProcessManager', () => {
    let service;
    let mockPrisma;
    let mockVirtioService;
    const testMachineId = 'vm-process-test';
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockVirtioService = (0, jest_mock_extended_1.mockDeep)();
        service = new ProcessManager_1.ProcessManager(mockPrisma, mockVirtioService);
    });
    describe('listProcesses', () => {
        it('should list all processes from a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' };
            const mockProcesses = [
                { pid: 1, name: 'System', cpuUsage: 0.1, memoryKb: 1024, status: 'running' },
                { pid: 1234, name: 'Chrome', cpuUsage: 2.5, memoryKb: 51200, status: 'running' }
            ];
            const mockResponse = {
                success: true,
                data: { processes: mockProcesses }
            };
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true });
            jest.spyOn(mockVirtioService, 'sendSafeCommand').mockResolvedValue(mockResponse);
            const result = yield service.listProcesses(testMachineId);
            expect(result).toHaveLength(2);
            expect(result[0].name).toBe('System');
            expect(mockVirtioService.sendSafeCommand).toHaveBeenCalled();
        }));
        it('should return empty array when VM has no processes', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' };
            const mockResponse = { success: true, data: { processes: [] } };
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true });
            jest.spyOn(mockVirtioService, 'sendSafeCommand').mockResolvedValue(mockResponse);
            const result = yield service.listProcesses(testMachineId);
            expect(result).toHaveLength(0);
        }));
        it('should throw error on command execution failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' };
            const mockResponse = { success: false, error: 'Process enumeration failed' };
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true });
            jest.spyOn(mockVirtioService, 'sendSafeCommand').mockResolvedValue(mockResponse);
            // listProcesses throws on failure
            yield expect(service.listProcesses(testMachineId)).rejects.toThrow();
        }));
        it('should throw error when connection fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' };
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true });
            jest.spyOn(mockVirtioService, 'sendSafeCommand').mockRejectedValue(new Error('Connection lost'));
            yield expect(service.listProcesses(testMachineId)).rejects.toThrow('Connection lost');
        }));
    });
    describe('getRunningMachine', () => {
        it('should return null when VM does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(null);
            const result = yield service.getRunningMachine(testMachineId);
            expect(result).toBe(null);
        }));
        it('should return null when VM is not running', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'stopped', internalName: 'vm-test' };
            const mockStatus = { processAlive: false };
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            mockInfinization.getVMStatus.mockResolvedValue(mockStatus);
            const result = yield service.getRunningMachine(testMachineId);
            expect(result).toBe(null);
        }));
        it('should return machine when VM is running', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'running', internalName: 'vm-test' };
            const mockStatus = { processAlive: true };
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            mockInfinization.getVMStatus.mockResolvedValue(mockStatus);
            const result = yield service.getRunningMachine(testMachineId);
            expect(result).toEqual({ machine: mockMachine });
        }));
        it('should update machine status when different from infinization', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockMachine = { id: testMachineId, name: 'Test VM', os: 'windows', status: 'stopped', internalName: 'vm-test' };
            const mockStatus = { processAlive: true };
            jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine);
            mockInfinization.getVMStatus.mockResolvedValue(mockStatus);
            yield service.getRunningMachine(testMachineId);
            expect(mockPrisma.machine.update).toHaveBeenCalled();
        }));
    });
});
