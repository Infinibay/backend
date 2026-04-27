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
const ProcessResolver_1 = require("@graphql/resolvers/ProcessResolver");
const ProcessManager_1 = require("@services/ProcessManager");
const jest_mock_extended_1 = require("jest-mock-extended");
// Mock ProcessManager
jest.mock('@services/ProcessManager');
// Mock SocketService and EventManager to avoid side effects
jest.mock('@services/SocketService', () => ({
    getSocketService: jest.fn(() => ({
        sendToUser: jest.fn()
    }))
}));
jest.mock('@services/EventManager', () => ({
    getEventManager: jest.fn(() => ({
        dispatchEvent: jest.fn()
    }))
}));
describe('ProcessResolver', () => {
    let processResolver;
    let mockProcessManager;
    let mockContext;
    beforeEach(() => {
        jest.clearAllMocks();
        processResolver = new ProcessResolver_1.ProcessResolver();
        const ctxPrisma = (0, jest_mock_extended_1.mockDeep)();
        ctxPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' });
        mockContext = {
            prisma: ctxPrisma,
            virtioSocketWatcher: (0, jest_mock_extended_1.mockDeep)(),
            user: { id: 'user-1', role: 'USER' }
        };
        mockProcessManager = (0, jest_mock_extended_1.mockDeep)();
        ProcessManager_1.ProcessManager.mockImplementation(() => mockProcessManager);
    });
    describe('killProcess', () => {
        it('should kill a process successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'test-vm-1';
            const pid = 1234;
            const force = false;
            const mockResult = {
                success: true,
                message: 'Process 1234 terminated successfully',
                pid: 1234
            };
            mockProcessManager.killProcess.mockResolvedValue(mockResult);
            const result = yield processResolver.killProcess(machineId, pid, force, mockContext);
            expect(result).toEqual(mockResult);
            expect(mockProcessManager.killProcess).toHaveBeenCalledWith(machineId, pid, force);
        }));
        it('should kill a process with force', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'test-vm-1';
            const pid = 1234;
            const force = true;
            const mockResult = {
                success: true,
                message: 'Process 1234 forcefully terminated',
                pid: 1234
            };
            mockProcessManager.killProcess.mockResolvedValue(mockResult);
            const result = yield processResolver.killProcess(machineId, pid, force, mockContext);
            expect(result).toEqual(mockResult);
            expect(mockProcessManager.killProcess).toHaveBeenCalledWith(machineId, pid, force);
        }));
        it('should handle kill failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'test-vm-1';
            const pid = 9999;
            const force = false;
            const mockResult = {
                success: false,
                message: 'Process not found',
                pid: 9999,
                error: 'Process 9999 does not exist'
            };
            mockProcessManager.killProcess.mockResolvedValue(mockResult);
            const result = yield processResolver.killProcess(machineId, pid, force, mockContext);
            expect(result).toEqual(mockResult);
            expect(result.success).toBe(false);
        }));
        it('should handle exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'test-vm-1';
            const pid = 1234;
            const force = false;
            const error = new Error('VM not available');
            mockProcessManager.killProcess.mockRejectedValue(error);
            const result = yield processResolver.killProcess(machineId, pid, force, mockContext);
            expect(result).toEqual({
                success: false,
                message: 'Failed to kill process: Error: VM not available',
                pid: 1234,
                error: 'VM not available'
            });
        }));
    });
    describe('killProcesses', () => {
        it('should kill multiple processes', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'test-vm-1';
            const pids = [1234, 5678];
            const force = false;
            const mockResults = [
                {
                    success: true,
                    message: 'Process 1234 terminated successfully',
                    pid: 1234
                },
                {
                    success: true,
                    message: 'Process 5678 terminated successfully',
                    pid: 5678
                }
            ];
            mockProcessManager.killProcesses.mockResolvedValue(mockResults);
            const result = yield processResolver.killProcesses(machineId, pids, force, mockContext);
            expect(result).toEqual(mockResults);
            expect(mockProcessManager.killProcesses).toHaveBeenCalledWith(machineId, pids, force);
        }));
        it('should handle partial failures', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'test-vm-1';
            const pids = [1234, 9999];
            const force = false;
            const mockResults = [
                {
                    success: true,
                    message: 'Process 1234 terminated successfully',
                    pid: 1234
                },
                {
                    success: false,
                    message: 'Process not found',
                    pid: 9999,
                    error: 'Process 9999 does not exist'
                }
            ];
            mockProcessManager.killProcesses.mockResolvedValue(mockResults);
            const result = yield processResolver.killProcesses(machineId, pids, force, mockContext);
            expect(result).toEqual(mockResults);
            expect(result[0].success).toBe(true);
            expect(result[1].success).toBe(false);
        }));
        it('should handle exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            const machineId = 'test-vm-1';
            const pids = [1234, 5678];
            const force = false;
            const error = new Error('VM not available');
            mockProcessManager.killProcesses.mockRejectedValue(error);
            const result = yield processResolver.killProcesses(machineId, pids, force, mockContext);
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({
                success: false,
                message: 'Failed to kill process: Error: VM not available',
                pid: 1234,
                error: 'VM not available'
            });
            expect(result[1]).toEqual({
                success: false,
                message: 'Failed to kill process: Error: VM not available',
                pid: 5678,
                error: 'VM not available'
            });
        }));
    });
});
