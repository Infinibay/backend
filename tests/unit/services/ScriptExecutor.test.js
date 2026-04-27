"use strict";
/**
 * Unit tests for ScriptExecutor.
 *
 * Uses jest.mock() for ScriptManager, TemplateEngine, ScriptParser,
 * VirtioSocketWatcherService, and SocketService. PrismaClient is mocked
 * with jest-mock-extended.
 */
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
const ScriptExecutor_1 = require("../../../app/services/scripts/ScriptExecutor");
const jest_mock_extended_1 = require("jest-mock-extended");
const client_1 = require("@prisma/client");
// ─── Mocks ──────────────────────────────────────────────────────────────────
const mockGetScript = jest.fn();
const mockValidateRequiredInputs = jest.fn();
const mockValidateInputValue = jest.fn();
const mockInterpolate = jest.fn();
const mockSanitizeForLogging = jest.fn().mockReturnValue({});
jest.mock('../../../app/services/scripts/ScriptManager', () => ({
    ScriptManager: jest.fn().mockImplementation(() => ({
        getScript: mockGetScript,
    })),
}));
jest.mock('../../../app/services/scripts/TemplateEngine', () => ({
    TemplateEngine: jest.fn().mockImplementation(() => ({
        validateRequiredInputs: mockValidateRequiredInputs,
        interpolate: mockInterpolate,
        sanitizeForLogging: mockSanitizeForLogging,
    })),
}));
jest.mock('../../../app/services/scripts/ScriptParser', () => ({
    ScriptParser: jest.fn().mockImplementation(() => ({
        validateInputValue: mockValidateInputValue,
    })),
}));
const mockSendSafeCommand = jest.fn();
const mockSendUnsafeCommand = jest.fn();
jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: () => ({
        sendSafeCommand: mockSendSafeCommand,
        sendUnsafeCommand: mockSendUnsafeCommand,
    }),
}));
const mockSendToUser = jest.fn();
jest.mock('../../../app/services/SocketService', () => ({
    getSocketService: () => ({
        sendToUser: mockSendToUser,
    }),
}));
// ─── Helpers ────────────────────────────────────────────────────────────────
function makeScript(overrides) {
    return Object.assign({ id: 'script-1', name: 'Test Script', scriptBody: 'echo {{message}}', os: [], parsedInputs: [{ name: 'message', type: 'text', required: true }], shell: client_1.ShellType.BASH }, overrides);
}
function makeMachine(overrides) {
    return Object.assign({ id: 'vm-1', name: 'TestVM', os: 'ubuntu-22.04', user: { id: 'user-1', name: 'Admin' } }, overrides);
}
function makeOptions(overrides) {
    return Object.assign({ scriptId: 'script-1', machineId: 'vm-1', inputValues: { message: 'hello' }, executionType: client_1.ExecutionType.ON_DEMAND, triggeredById: 'user-1' }, overrides);
}
function makeCommandResponse(overrides) {
    return Object.assign({ id: 'cmd-1', success: true, exit_code: 0, stdout: 'hello\n', stderr: '', execution_time_ms: 500, command_type: 'safe' }, overrides);
}
// ─── Test Suite ─────────────────────────────────────────────────────────────
describe('ScriptExecutor', () => {
    let executor;
    let mockPrisma;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        mockGetScript.mockResolvedValue(makeScript());
        mockValidateRequiredInputs.mockReturnValue(undefined);
        mockValidateInputValue.mockReturnValue(undefined);
        mockInterpolate.mockReturnValue('echo hello');
        mockSanitizeForLogging.mockReturnValue({ message: 'hello' });
        mockPrisma.machine.findUnique.mockResolvedValue(makeMachine());
        mockPrisma.scriptExecution.create.mockResolvedValue({
            id: 'exec-1',
            scriptId: 'script-1',
            machineId: 'vm-1',
        });
        mockPrisma.scriptExecution.update.mockResolvedValue({});
        mockPrisma.scriptAuditLog.create.mockResolvedValue({});
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
        mockSendUnsafeCommand.mockResolvedValue(makeCommandResponse());
        mockSendSafeCommand.mockResolvedValue(makeCommandResponse());
        executor = new ScriptExecutor_1.ScriptExecutor(mockPrisma);
    });
    // ─── executeScript - success ───────────────────────────────────────────
    describe('executeScript - success', () => {
        it('executes a script on a Linux VM successfully', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(true);
            expect(result.executionId).toBe('exec-1');
            expect(mockGetScript).toHaveBeenCalledWith('script-1');
            expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'vm-1' } }));
            expect(mockValidateRequiredInputs).toHaveBeenCalled();
            const createCall = mockPrisma.scriptExecution.create.mock.calls[0][0];
            expect(createCall.data.status).toBe(client_1.ExecutionStatus.PENDING);
            expect(mockInterpolate).toHaveBeenCalledWith('echo {{message}}', { message: 'hello' });
            expect(mockSendUnsafeCommand).toHaveBeenCalled();
            const updateCalls = mockPrisma.scriptExecution.update.mock.calls;
            const successUpdate = updateCalls.find((c) => { var _a, _b; return ((_b = (_a = c[0]) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.status) === client_1.ExecutionStatus.SUCCESS; });
            expect(successUpdate).toBeDefined();
            expect(successUpdate[0].data.stdout).toBe('hello\n');
        }));
        it('uses safe command for Windows PowerShell with admin elevation', () => __awaiter(void 0, void 0, void 0, function* () {
            // Override script to have PowerShell shell for this test
            mockGetScript.mockResolvedValue(makeScript({ shell: client_1.ShellType.POWERSHELL }));
            mockPrisma.machine.findUnique.mockResolvedValue(makeMachine({ os: 'windows11' }));
            const response = makeCommandResponse();
            mockSendSafeCommand.mockResolvedValue(response);
            const result = yield executor.executeScript(makeOptions({
                runAs: 'administrator',
            }));
            expect(result.success).toBe(true);
            expect(mockSendSafeCommand).toHaveBeenCalledWith('vm-1', expect.objectContaining({
                action: 'ExecutePowerShellScript',
            }), expect.any(Number));
        }));
        it('creates audit log with sanitized passwords', () => __awaiter(void 0, void 0, void 0, function* () {
            yield executor.executeScript(makeOptions({
                inputValues: { username: 'admin', password: 'secret' },
            }));
            const auditCall = mockPrisma.scriptAuditLog.create.mock.calls[0][0];
            expect(auditCall.data.details.inputValues.password).toBe('***REDACTED***');
        }));
        it('emits socket events to relevant users', () => __awaiter(void 0, void 0, void 0, function* () {
            yield executor.executeScript(makeOptions());
            expect(mockSendToUser).toHaveBeenCalled();
        }));
    });
    // ─── executeScript - validation errors ─────────────────────────────────
    describe('executeScript - validation errors', () => {
        it('returns error when script not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockGetScript.mockResolvedValue(null);
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        }));
        it('returns error when machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findUnique.mockResolvedValue(null);
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.error).toContain('Machine');
        }));
        it('returns error for OS incompatibility', () => __awaiter(void 0, void 0, void 0, function* () {
            mockGetScript.mockResolvedValue(makeScript({ os: ['LINUX'] }));
            mockPrisma.machine.findUnique.mockResolvedValue(makeMachine({ os: 'windows11' }));
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.error).toContain('not compatible');
        }));
        it('returns error for unsupported OS type', () => __awaiter(void 0, void 0, void 0, function* () {
            mockGetScript.mockResolvedValue(makeScript({ os: ['LINUX'] }));
            mockPrisma.machine.findUnique.mockResolvedValue(makeMachine({ os: 'haiku' }));
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.error).toContain('unsupported OS');
        }));
    });
    // ─── executeScript - execution failures ────────────────────────────────
    describe('executeScript - execution failures', () => {
        it('handles command failure response', () => __awaiter(void 0, void 0, void 0, function* () {
            mockSendUnsafeCommand.mockResolvedValue(makeCommandResponse({
                success: false,
                exit_code: 1,
                stderr: 'command not found',
                error: 'Script failed',
            }));
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.error).toBe('Script failed');
            const updateCalls = mockPrisma.scriptExecution.update.mock.calls;
            const failUpdate = updateCalls.find((c) => { var _a, _b; return ((_b = (_a = c[0]) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.status) === client_1.ExecutionStatus.FAILED; });
            expect(failUpdate).toBeDefined();
        }));
        it('handles timeout errors', () => __awaiter(void 0, void 0, void 0, function* () {
            mockSendUnsafeCommand.mockRejectedValue(new Error('Command timeout after 600000ms'));
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.error).toContain('timed out');
            const updateCalls = mockPrisma.scriptExecution.update.mock.calls;
            const timeoutUpdate = updateCalls.find((c) => { var _a, _b; return ((_b = (_a = c[0]) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.status) === client_1.ExecutionStatus.TIMEOUT; });
            expect(timeoutUpdate).toBeDefined();
        }));
        it('handles unexpected errors and marks execution as failed', () => __awaiter(void 0, void 0, void 0, function* () {
            mockSendUnsafeCommand.mockRejectedValue(new Error('Socket disconnected'));
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.error).toContain('Socket disconnected');
            const calls = mockPrisma.scriptExecution.update.mock.calls;
            const lastUpdate = calls[calls.length - 1];
            expect(lastUpdate[0].data.status).toBe(client_1.ExecutionStatus.FAILED);
        }));
        it('returns empty executionId when error occurs before record creation', () => __awaiter(void 0, void 0, void 0, function* () {
            mockGetScript.mockImplementation(() => {
                throw new Error('DB connection lost');
            });
            const result = yield executor.executeScript(makeOptions());
            expect(result.success).toBe(false);
            expect(result.executionId).toBe('');
        }));
    });
    // ─── cancelScriptExecution ─────────────────────────────────────────────
    describe('cancelScriptExecution', () => {
        it('cancels a pending execution', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                scriptId: 'script-1',
                machineId: 'vm-1',
                status: client_1.ExecutionStatus.PENDING,
                machine: { id: 'vm-1' },
            });
            mockPrisma.scriptExecution.update.mockResolvedValue({});
            const result = yield executor.cancelScriptExecution('exec-1');
            expect(result).toBe(true);
            expect(mockPrisma.scriptExecution.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'exec-1' },
                data: {
                    status: client_1.ExecutionStatus.CANCELLED,
                    completedAt: expect.any(Date),
                    error: 'Execution cancelled by user',
                },
            }));
        }));
        it('cancels a running execution', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                scriptId: 'script-1',
                machineId: 'vm-1',
                status: client_1.ExecutionStatus.RUNNING,
                machine: { id: 'vm-1' },
            });
            mockPrisma.scriptExecution.update.mockResolvedValue({});
            const result = yield executor.cancelScriptExecution('exec-1');
            expect(result).toBe(true);
        }));
        it('throws when execution not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue(null);
            yield expect(executor.cancelScriptExecution('nonexistent')).rejects.toThrow('not found');
        }));
        it('throws when execution cannot be cancelled', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                status: client_1.ExecutionStatus.SUCCESS,
                machine: { id: 'vm-1' },
            });
            yield expect(executor.cancelScriptExecution('exec-1')).rejects.toThrow('Cannot cancel');
        }));
    });
    // ─── getExecutionStatus ────────────────────────────────────────────────
    describe('getExecutionStatus', () => {
        it('returns execution with relations', () => __awaiter(void 0, void 0, void 0, function* () {
            const execution = {
                id: 'exec-1',
                scriptId: 'script-1',
                machineId: 'vm-1',
                script: { id: 'script-1', name: 'Test' },
                machine: { id: 'vm-1', name: 'VM1' },
                triggeredBy: { id: 'user-1', name: 'Admin' },
            };
            mockPrisma.scriptExecution.findUnique.mockResolvedValue(execution);
            const result = yield executor.getExecutionStatus('exec-1');
            expect(result.id).toBe('exec-1');
            expect(mockPrisma.scriptExecution.findUnique).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'exec-1' },
                include: { script: true, machine: true, triggeredBy: true },
            }));
        }));
        it('throws when execution not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue(null);
            yield expect(executor.getExecutionStatus('nonexistent')).rejects.toThrow('not found');
        }));
    });
});
