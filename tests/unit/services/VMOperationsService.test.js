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
const VMOperationsService_1 = require("../../../app/services/VMOperationsService");
// Mock InfinizationService
const logger_1 = __importDefault(require("@main/logger"));
const mockInfinization = {
    startVM: jest.fn(),
    stopVM: jest.fn(),
    restartVM: jest.fn(),
    resetVM: jest.fn(),
    suspendVM: jest.fn(),
    resumeVM: jest.fn(),
    getVMStatus: jest.fn(),
    gracefulShutdown: jest.fn()
};
jest.mock('@services/InfinizationService', () => ({
    getInfinization: jest.fn(() => Promise.resolve(mockInfinization))
}));
describe('VMOperationsService', () => {
    let service;
    let mockPrisma;
    const validMachineId = 'vm-123';
    const invalidMachineId = '';
    const specialCharsMachineId = 'vm@#$%^&*()';
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = {};
        service = new VMOperationsService_1.VMOperationsService(mockPrisma);
        jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    describe('startMachine', () => {
        it('should successfully start a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockResolvedValue({
                success: true,
                message: 'VM started successfully'
            });
            const result = yield service.startMachine(validMachineId);
            expect(result.success).toBe(true);
            expect(result.message).toBe('VM started successfully');
            expect(mockInfinization.startVM).toHaveBeenCalledWith(validMachineId);
            expect(result.error).toBeUndefined();
        }));
        it('should handle start failure with error message', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockResolvedValue({
                success: false,
                error: 'VM already running'
            });
            const result = yield service.startMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('VM already running');
            expect(result.message).toBeUndefined();
        }));
        it('should handle exceptions and return error', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue(new Error('Connection failed'));
            const result = yield service.startMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Connection failed');
        }));
        it('should handle empty machineId gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'));
            const result = yield service.startMachine(invalidMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid machine ID');
        }));
        it('should handle special characters in machineId', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue(new Error('Invalid characters in machine ID'));
            const result = yield service.startMachine(specialCharsMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Invalid characters in machine ID');
        }));
    });
    describe('forcePowerOff', () => {
        it('should successfully force power off a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.stopVM.mockResolvedValue({
                success: true,
                message: 'VM forcefully stopped'
            });
            const result = yield service.forcePowerOff(validMachineId);
            expect(result.success).toBe(true);
            expect(mockInfinization.stopVM).toHaveBeenCalledWith(validMachineId, {
                graceful: false,
                force: true
            });
        }));
        it('should handle force power off failure when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.stopVM.mockResolvedValue({
                success: false,
                error: 'VM not found'
            });
            const result = yield service.forcePowerOff(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('VM not found');
        }));
        it('should handle force power off failure when VM is stopped', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.stopVM.mockResolvedValue({
                success: false,
                error: 'VM is already stopped'
            });
            const result = yield service.forcePowerOff(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('VM is already stopped');
        }));
        it('should handle exceptions during force power off', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.stopVM.mockRejectedValue(new Error('Libvirt connection error'));
            const result = yield service.forcePowerOff(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Libvirt connection error');
        }));
    });
    describe('gracefulPowerOff', () => {
        const machineId = 'vm-123';
        it('should successfully gracefully power off a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.stopVM.mockResolvedValue({
                success: true,
                message: 'VM powered off'
            });
            const result = yield service.gracefulPowerOff(machineId);
            expect(result.success).toBe(true);
            expect(mockInfinization.stopVM).toHaveBeenCalledWith(machineId, {
                graceful: true,
                timeout: 120000,
                force: true
            });
        }));
        it('should handle graceful shutdown timeout', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.stopVM.mockResolvedValue({
                success: false,
                error: 'Shutdown timeout'
            });
            const result = yield service.gracefulPowerOff(machineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Shutdown timeout');
        }));
        it('should handle graceful power off when VM is stopped', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.stopVM.mockResolvedValue({
                success: false,
                error: 'VM already stopped'
            });
            const result = yield service.gracefulPowerOff(machineId);
            expect(result.success).toBe(false);
            expect(result.error).toContain('VM already stopped');
        }));
    });
    describe('restartMachine', () => {
        it('should successfully restart a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.restartVM.mockResolvedValue({
                success: true,
                message: 'VM restarted successfully'
            });
            const result = yield service.restartMachine(validMachineId);
            expect(result.success).toBe(true);
            expect(mockInfinization.restartVM).toHaveBeenCalledWith(validMachineId);
        }));
        it('should handle restart failure when VM is stopped', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.restartVM.mockResolvedValue({
                success: false,
                error: 'Cannot restart stopped VM'
            });
            const result = yield service.restartMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Cannot restart stopped VM');
        }));
        it('should handle restart exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.restartVM.mockRejectedValue(new Error('Restart service unavailable'));
            const result = yield service.restartMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Restart service unavailable');
        }));
    });
    describe('resetMachine', () => {
        it('should successfully reset a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.resetVM.mockResolvedValue({
                success: true,
                message: 'VM hardware reset successfully'
            });
            const result = yield service.resetMachine(validMachineId);
            expect(result.success).toBe(true);
            expect(mockInfinization.resetVM).toHaveBeenCalledWith(validMachineId);
        }));
        it('should handle reset failure when VM is not running', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.resetVM.mockResolvedValue({
                success: false,
                error: 'VM must be running to reset'
            });
            const result = yield service.resetMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('VM must be running to reset');
        }));
        it('should handle reset exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.resetVM.mockRejectedValue(new Error('Reset failed'));
            const result = yield service.resetMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Reset failed');
        }));
    });
    describe('suspendMachine', () => {
        it('should successfully suspend a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.suspendVM.mockResolvedValue({
                success: true,
                message: 'VM suspended successfully'
            });
            const result = yield service.suspendMachine(validMachineId);
            expect(result.success).toBe(true);
            expect(mockInfinization.suspendVM).toHaveBeenCalledWith(validMachineId);
        }));
        it('should handle suspend failure when VM is already paused', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.suspendVM.mockResolvedValue({
                success: false,
                error: 'VM is already suspended'
            });
            const result = yield service.suspendMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('VM is already suspended');
        }));
        it('should handle suspend exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.suspendVM.mockRejectedValue(new Error('Suspend failed'));
            const result = yield service.suspendMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Suspend failed');
        }));
    });
    describe('resumeMachine', () => {
        it('should successfully resume a machine', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.resumeVM.mockResolvedValue({
                success: true,
                message: 'VM resumed successfully'
            });
            const result = yield service.resumeMachine(validMachineId);
            expect(result.success).toBe(true);
            expect(mockInfinization.resumeVM).toHaveBeenCalledWith(validMachineId);
        }));
        it('should handle resume failure when VM is not suspended', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.resumeVM.mockResolvedValue({
                success: false,
                error: 'VM is not suspended'
            });
            const result = yield service.resumeMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('VM is not suspended');
        }));
        it('should handle resume exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.resumeVM.mockRejectedValue(new Error('Resume failed'));
            const result = yield service.resumeMachine(validMachineId);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Resume failed');
        }));
    });
    describe('getStatus', () => {
        it('should return VM status when running', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.getVMStatus.mockResolvedValue({
                status: 'running',
                processAlive: true,
                consistent: true
            });
            const result = yield service.getStatus(validMachineId);
            expect(result).toEqual({
                status: 'running',
                processAlive: true,
                consistent: true
            });
        }));
        it('should return VM status when stopped', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.getVMStatus.mockResolvedValue({
                status: 'stopped',
                processAlive: false,
                consistent: true
            });
            const result = yield service.getStatus(validMachineId);
            expect(result).toEqual({
                status: 'stopped',
                processAlive: false,
                consistent: true
            });
        }));
        it('should return null on error', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.getVMStatus.mockRejectedValue(new Error('Failed'));
            const result = yield service.getStatus(validMachineId);
            expect(result).toBeNull();
        }));
        it('should handle empty machineId', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.getVMStatus.mockRejectedValue(new Error('Invalid machine ID'));
            const result = yield service.getStatus(invalidMachineId);
            expect(result).toBeNull();
        }));
    });
    describe('performGracefulRestart', () => {
        it('should restart on first attempt if successful', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.restartVM.mockResolvedValue({
                success: true,
                message: 'VM restarted'
            });
            const result = yield service.performGracefulRestart(validMachineId);
            expect(result.success).toBe(true);
            expect(mockInfinization.restartVM).toHaveBeenCalledTimes(1);
        }));
        it('should retry up to maxRetries on failure and fallback to force power off', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.restartVM.mockResolvedValue({
                success: false,
                error: 'Restart failed'
            });
            mockInfinization.stopVM.mockResolvedValue({
                success: true,
                message: 'VM stopped'
            });
            mockInfinization.startVM.mockResolvedValue({
                success: true,
                message: 'VM started'
            });
            const result = yield service.performGracefulRestart(validMachineId, 2);
            // 2 restart attempts + 1 force stop + 1 start
            expect(mockInfinization.restartVM).toHaveBeenCalledTimes(2);
            expect(mockInfinization.stopVM).toHaveBeenCalledTimes(1);
            expect(mockInfinization.startVM).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(true);
        }), 15000);
        it('should fail gracefully when all retries exhausted and force power off also fails', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.restartVM.mockResolvedValue({
                success: false,
                error: 'Restart failed'
            });
            mockInfinization.stopVM.mockResolvedValue({
                success: false,
                error: 'Force power off failed'
            });
            const result = yield service.performGracefulRestart(validMachineId, 2);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Force power off failed');
        }), 15000);
        it('should handle exceptions during retry attempts', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.restartVM.mockRejectedValue(new Error('Service unavailable'));
            mockInfinization.stopVM.mockRejectedValue(new Error('Force power off unavailable'));
            mockInfinization.startVM.mockRejectedValue(new Error('Start service unavailable'));
            const result = yield service.performGracefulRestart(validMachineId, 2);
            expect(result.success).toBe(false);
            // Should eventually fail on force power off
            expect(result.error).toBe('Force power off unavailable');
        }), 15000);
        it('should use default maxRetries of 3 when not specified', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRestart = mockInfinization.restartVM.mockRejectedValue(new Error('Always fails'));
            mockRestart.mockRejectedValue(new Error('Always fails'));
            const result = yield service.performGracefulRestart(validMachineId);
            expect(result.success).toBe(false);
            // Should have been called 3 times (default maxRetries)
            expect(mockRestart).toHaveBeenCalledTimes(3);
        }), 15000);
    });
    describe('concurrent operations', () => {
        it('should handle concurrent start and stop operations', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockResolvedValue({ success: true, message: 'Started' });
            mockInfinization.stopVM.mockResolvedValue({ success: true, message: 'Stopped' });
            const [startResult, stopResult] = yield Promise.all([
                service.startMachine(validMachineId),
                service.forcePowerOff(validMachineId)
            ]);
            expect(startResult.success).toBe(true);
            expect(stopResult.success).toBe(true);
        }));
        it('should handle multiple identical concurrent requests', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockResolvedValue({ success: true, message: 'Started' });
            const results = yield Promise.all([
                service.startMachine(validMachineId),
                service.startMachine(validMachineId),
                service.startMachine(validMachineId)
            ]);
            expect(results.every(r => r.success)).toBe(true);
            expect(mockInfinization.startVM).toHaveBeenCalledTimes(3);
        }));
    });
    describe('edge cases', () => {
        it('should handle null machineId', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'));
            const result = yield service.startMachine(null);
            expect(result.success).toBe(false);
        }));
        it('should handle undefined machineId', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'));
            const result = yield service.startMachine(undefined);
            expect(result.success).toBe(false);
        }));
        it('should handle machineId with whitespace', () => __awaiter(void 0, void 0, void 0, function* () {
            const whitespaceId = '  vm-123  ';
            mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'));
            const result = yield service.startMachine(whitespaceId);
            expect(result.success).toBe(false);
        }));
        it('should handle very long machineId', () => __awaiter(void 0, void 0, void 0, function* () {
            const longId = 'a'.repeat(1000);
            mockInfinization.startVM.mockRejectedValue(new Error('Invalid machine ID'));
            const result = yield service.startMachine(longId);
            expect(result.success).toBe(false);
        }));
    });
    describe('error message formatting', () => {
        it('should preserve error messages from infinization', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue(new Error('Specific error message from service'));
            const result = yield service.startMachine(validMachineId);
            expect(result.error).toBe('Specific error message from service');
        }));
        it('should handle errors without messages', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue(new Error());
            const result = yield service.startMachine(validMachineId);
            expect(result.success).toBe(false);
        }));
        it('should handle non-Error exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            mockInfinization.startVM.mockRejectedValue('String error');
            const result = yield service.startMachine(validMachineId);
            expect(result.success).toBe(false);
            // Non-Error values don't have .message, so error will be undefined
            expect(result.error).toBeUndefined();
        }));
    });
    describe('close', () => {
        it('should be a no-op for infinization', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.close()).resolves.toBeUndefined();
        }));
    });
});
