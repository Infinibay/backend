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
const jest_setup_1 = require("../../setup/jest.setup");
const VMRecommendationService_1 = require("../../../app/services/VMRecommendationService");
const mock_factories_1 = require("../../setup/mock-factories");
// Mock PackageManager to prevent DB calls during constructor
const logger_1 = __importDefault(require("@main/logger"));
globals_1.jest.mock('../../../app/services/packages/PackageManager', () => ({
    getPackageManager: globals_1.jest.fn().mockReturnValue({
        loadAll: globals_1.jest.fn().mockResolvedValue(undefined),
        getPackageStatuses: globals_1.jest.fn().mockReturnValue([]),
        runCheckers: globals_1.jest.fn().mockResolvedValue([])
    }),
    PackageManager: globals_1.jest.fn()
}));
(0, globals_1.describe)('VMRecommendationService Error Handling', () => {
    let service;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        globals_1.jest.useFakeTimers({ advanceTimers: false });
        service = new VMRecommendationService_1.VMRecommendationService(jest_setup_1.mockPrisma);
        globals_1.jest.useRealTimers();
        // Default mocks for buildContext
        jest_setup_1.mockPrisma.portUsage.findMany.mockResolvedValue([]);
        jest_setup_1.mockPrisma.processSnapshot.findMany.mockResolvedValue([]);
        jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)({ id: 'default-machine' })), { department: (0, mock_factories_1.createMockDepartment)() }));
        // Default transaction mock
        jest_setup_1.mockPrisma.$transaction.mockImplementation((fn) => __awaiter(void 0, void 0, void 0, function* () { return fn(jest_setup_1.mockPrisma); }));
        jest_setup_1.mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null });
    });
    (0, globals_1.afterEach)(() => {
        globals_1.jest.clearAllMocks();
        if (service && typeof service.dispose === 'function') {
            service.dispose();
        }
    });
    (0, globals_1.describe)('Error Handling with Generic Messages', () => {
        const machineId = 'test-machine-error';
        (0, globals_1.beforeEach)(() => {
            // Mock machine exists
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue((0, mock_factories_1.createMockMachine)({ id: machineId }));
            // Mock latest snapshot exists (needed by getRecommendations to reach findMany)
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue({
                id: 'test-snapshot-1',
                machineId,
                snapshotDate: new Date(),
                overallStatus: 'OK'
            });
        });
        (0, globals_1.it)('should throw generic error message from generateRecommendations when database fails', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate database error
            const dbError = new Error('ECONNREFUSED: Connection refused');
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError);
            // Spy on logger.error to verify detailed logging
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            yield (0, globals_1.expect)(service.generateRecommendations(machineId)).rejects.toThrow('VM recommendation service failed');
            // Verify that the detailed error is logged but not thrown
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('VMRecommendationService error'), globals_1.expect.objectContaining({
                originalError: 'ECONNREFUSED: Connection refused',
                errorName: 'Error',
                vmId: machineId
            }));
            consoleSpy.mockRestore();
        }));
        (0, globals_1.it)('should propagate error from getRecommendations when service fails', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate service error
            const serviceError = new Error('Internal service failure');
            jest_setup_1.mockPrisma.vMRecommendation.findMany.mockRejectedValue(serviceError);
            // Spy on logger.error to verify detailed logging
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            // getRecommendations wraps non-AppError errors via handleServiceError
            yield (0, globals_1.expect)(service.getRecommendations(machineId)).rejects.toThrow('VM recommendation service failed');
            consoleSpy.mockRestore();
        }));
        (0, globals_1.it)('should return generic error message from safe wrapper methods', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate database error
            const dbError = new Error('Database connection timeout');
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError);
            // Spy on logger.error to verify detailed logging
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            const result = yield service.generateRecommendationsSafe(machineId);
            (0, globals_1.expect)(result.success).toBe(false);
            if (!result.success) {
                // The safe wrapper returns a generic error message
                (0, globals_1.expect)(typeof result.error).toBe('string');
                (0, globals_1.expect)(result.error.length).toBeGreaterThan(0);
            }
            // Verify that the detailed error is logged
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('VM Recommendation Service Error'), globals_1.expect.objectContaining({
                vmId: machineId
            }));
            consoleSpy.mockRestore();
        }));
        (0, globals_1.it)('should not leak sensitive database details via safe wrapper methods', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate database constraint violation error with sensitive info
            const sensitiveError = new Error('duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(secret@example.com) already exists.');
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(sensitiveError);
            // Use the safe wrapper which wraps errors with generic messages
            const result = yield service.generateRecommendationsSafe(machineId);
            (0, globals_1.expect)(result.success).toBe(false);
            if (!result.success) {
                // The returned error message should be generic
                (0, globals_1.expect)(result.error).not.toContain('duplicate key');
                (0, globals_1.expect)(result.error).not.toContain('secret@example.com');
                (0, globals_1.expect)(result.error).not.toContain('users_email_key');
            }
        }));
        (0, globals_1.it)('should log sensitive details for debugging while keeping thrown messages generic', () => __awaiter(void 0, void 0, void 0, function* () {
            // Simulate error with sensitive information
            const sensitiveError = new Error('PostgreSQL connection failed: password authentication failed for user "db_admin"');
            jest_setup_1.mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(sensitiveError);
            // Spy on logger.error to verify detailed logging
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            try {
                yield service.generateRecommendations(machineId);
                fail('Expected error to be thrown');
            }
            catch (error) {
                // The thrown error message should be generic
                (0, globals_1.expect)(error.message).toBe('VM recommendation service failed');
                (0, globals_1.expect)(error.message).not.toContain('password authentication');
                (0, globals_1.expect)(error.message).not.toContain('db_admin');
            }
            // Verify that the detailed error is logged for debugging
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('VMRecommendationService error'), globals_1.expect.objectContaining({
                originalError: 'PostgreSQL connection failed: password authentication failed for user "db_admin"',
                errorName: 'Error',
                vmId: machineId
            }));
            consoleSpy.mockRestore();
        }));
    });
});
