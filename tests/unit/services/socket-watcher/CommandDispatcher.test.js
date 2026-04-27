"use strict";
/**
 * Unit tests for CommandDispatcher.
 *
 * CommandDispatcher receives all I/O through constructor injection
 * (connections map, reconnectFn, sendMessage, debug logger), so we
 * mock those directly. The only module-level deps are `uuid` and `fs`
 * which are both mocked globally by jest.config.js.
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
const CommandDispatcher_1 = require("../../../../app/services/socket-watcher/CommandDispatcher");
const winston_1 = require("winston");
// ─── Helpers ────────────────────────────────────────────────────────────────
function makeConnection(overrides) {
    return Object.assign({ vmId: 'vm-1', socket: {}, socketPath: '/tmp/test.sock', buffer: '', reconnectAttempts: 0, lastMessageTime: new Date(), isConnected: true, errorCount: 0, pendingCommands: new Map(), connectionStartTime: new Date(), healthCheckResults: [], messageStats: { sent: 0, received: 0, errors: 0, totalBytes: 0, averageLatency: 0 }, connectionQuality: 'excellent', disconnectionHistory: [], transmissionFailureCount: 0, connectionStabilityScore: 100, messageTypeCounts: {}, errorClassificationHistory: [], recoverableErrorCount: 0, fatalErrorCount: 0, circuitBreakerState: 'Closed', circuitBreakerFailureCount: 0, circuitBreakerLastStateChange: new Date(), keepAliveSequence: 0, keepAliveFailureCount: 0, keepAliveSentCount: 0, keepAliveReceivedCount: 0, keepAliveRttHistory: [], keepAliveAverageRtt: 0, keepAliveConsecutiveFailures: 0, reconnectBaseDelayMs: 1000, socketPaths: [], currentSocketIndex: 0, isDegraded: false }, overrides);
}
function makeSuccessResponse(overrides) {
    return Object.assign({ id: '00000000-0000-4000-8000-000000000001', success: true, exit_code: 0, stdout: '{"result": "ok"}', execution_time_ms: 150, command_type: 'safe' }, overrides);
}
function makeDeps(overrides) {
    const connections = new Map();
    const connection = makeConnection();
    connections.set('vm-1', connection);
    return Object.assign({ debug: (0, winston_1.createLogger)({ silent: true }), connections, reconnectFn: jest.fn().mockResolvedValue(undefined), sendMessage: jest.fn() }, overrides);
}
/** Resolve whatever pending command was most recently registered on vm-1 */
function resolveLastPendingCommand(connections, response) {
    const conn = connections.get('vm-1');
    for (const [id, pending] of conn.pendingCommands.entries()) {
        clearTimeout(pending.timeout);
        pending.resolve(response);
        conn.pendingCommands.delete(id);
        return;
    }
}
// ─── Test Suite ─────────────────────────────────────────────────────────────
describe('CommandDispatcher', () => {
    let dispatcher;
    let deps;
    beforeEach(() => {
        jest.clearAllMocks();
        deps = makeDeps();
        dispatcher = new CommandDispatcher_1.CommandDispatcher(deps);
    });
    // ─── sendSafeCommand ────────────────────────────────────────────────────
    describe('sendSafeCommand', () => {
        it('sends a safe command and resolves with response', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const commandType = { action: 'SystemInfo' };
            const sendPromise = dispatcher.sendSafeCommand('vm-1', commandType, 5000);
            yield new Promise(resolve => setTimeout(resolve, 0));
            resolveLastPendingCommand(deps.connections, response);
            const result = yield sendPromise;
            expect(result.success).toBe(true);
            expect(deps.sendMessage).toHaveBeenCalledTimes(1);
            const [conn, message] = deps.sendMessage.mock.calls[0];
            expect(conn.vmId).toBe('vm-1');
            expect(message.type).toBe('SafeCommand');
            expect(message.command_type).toEqual({ action: 'SystemInfo' });
        }));
        it('throws if no connection exists for VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const commandType = { action: 'SystemInfo' };
            yield expect(dispatcher.sendSafeCommand('vm-unknown', commandType)).rejects.toThrow('No connection to VM vm-unknown');
        }));
        it('throws if VM is disconnected and socket file not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const disconnectedConn = makeConnection({ isConnected: false });
            deps.connections.set('vm-1', disconnectedConn);
            const commandType = { action: 'SystemInfo' };
            yield expect(dispatcher.sendSafeCommand('vm-1', commandType)).rejects.toThrow('not connected and socket file not found');
        }));
        it('times out if no response is received', () => __awaiter(void 0, void 0, void 0, function* () {
            jest.useFakeTimers();
            const commandType = { action: 'SystemInfo' };
            const promise = dispatcher.sendSafeCommand('vm-1', commandType, 5000);
            jest.advanceTimersByTime(5001);
            yield expect(promise).rejects.toThrow('Command timeout after 5000ms');
            const conn = deps.connections.get('vm-1');
            expect(conn.pendingCommands.size).toBe(0);
            jest.useRealTimers();
        }));
    });
    // ─── sendUnsafeCommand ──────────────────────────────────────────────────
    describe('sendUnsafeCommand', () => {
        it('sends an unsafe command and resolves with response', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse({ command_type: 'unsafe' });
            const sendPromise = dispatcher.sendUnsafeCommand('vm-1', 'echo hello', { shell: 'bash', runAs: 'root' }, 10000);
            yield new Promise(resolve => setTimeout(resolve, 0));
            resolveLastPendingCommand(deps.connections, response);
            const result = yield sendPromise;
            expect(result.success).toBe(true);
            expect(deps.sendMessage).toHaveBeenCalledTimes(1);
            const [, message] = deps.sendMessage.mock.calls[0];
            expect(message.type).toBe('UnsafeCommand');
            expect(message.raw_command).toBe('echo hello');
            expect(message.shell).toBe('bash');
            expect(message.run_as).toBe('root');
        }));
        it('throws if no connection exists for VM', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(dispatcher.sendUnsafeCommand('vm-unknown', 'ls')).rejects.toThrow('No connection to VM vm-unknown');
        }));
        it('throws if VM is disconnected and socket file not found', () => __awaiter(void 0, void 0, void 0, function* () {
            const disconnectedConn = makeConnection({ isConnected: false });
            deps.connections.set('vm-1', disconnectedConn);
            yield expect(dispatcher.sendUnsafeCommand('vm-1', 'ls')).rejects.toThrow('not connected and socket file not found');
        }));
    });
    // ─── executeCommandWithRetry ────────────────────────────────────────────
    describe('executeCommandWithRetry', () => {
        it('returns response on first attempt when successful', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const builder = jest.fn().mockResolvedValue(response);
            const result = yield dispatcher.executeCommandWithRetry('vm-1', builder, 3, 10);
            expect(result.success).toBe(true);
            expect(builder).toHaveBeenCalledTimes(1);
        }));
        it('retries on failure and eventually succeeds', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const builder = jest.fn()
                .mockRejectedValueOnce(new Error('Connection lost'))
                .mockResolvedValue(response);
            const result = yield dispatcher.executeCommandWithRetry('vm-1', builder, 3, 10);
            expect(result.success).toBe(true);
            expect(builder).toHaveBeenCalledTimes(2);
        }));
        it('throws after all retries exhausted', () => __awaiter(void 0, void 0, void 0, function* () {
            const builder = jest.fn().mockRejectedValue(new Error('Persistent failure'));
            yield expect(dispatcher.executeCommandWithRetry('vm-1', builder, 2, 10)).rejects.toThrow('Persistent failure');
            expect(builder).toHaveBeenCalledTimes(2);
        }));
        it('returns failed response on last attempt even if not success', () => __awaiter(void 0, void 0, void 0, function* () {
            const failedResponse = {
                success: false,
                exit_code: 1,
                error: 'Something went wrong',
            };
            const builder = jest.fn()
                .mockResolvedValueOnce(Object.assign(Object.assign({}, failedResponse), { error: 'first fail' }))
                .mockResolvedValueOnce(failedResponse);
            const result = yield dispatcher.executeCommandWithRetry('vm-1', builder, 2, 10);
            expect(result.success).toBe(false);
            expect(result.error).toBe('Something went wrong');
            expect(builder).toHaveBeenCalledTimes(2);
        }));
    });
    // ─── formatCommandType (via sendSafeCommand) ───────────────────────────
    describe('formatCommandType', () => {
        it('formats PackageSearch with query param', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const commandType = {
                action: 'PackageSearch',
                params: { query: 'nginx' },
            };
            const sendPromise = dispatcher.sendSafeCommand('vm-1', commandType, 5000);
            yield new Promise(resolve => setTimeout(resolve, 0));
            resolveLastPendingCommand(deps.connections, response);
            yield sendPromise;
            const [, message] = deps.sendMessage.mock.calls[0];
            expect(message.command_type).toEqual({
                action: 'PackageSearch',
                query: 'nginx',
            });
        }));
        it('formats ExecutePowerShellScript with required params', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const commandType = {
                action: 'ExecutePowerShellScript',
                params: {
                    script: 'Get-Process',
                    script_type: 'inline',
                    run_as_admin: true,
                },
            };
            const sendPromise = dispatcher.sendSafeCommand('vm-1', commandType, 60000);
            yield new Promise(resolve => setTimeout(resolve, 0));
            resolveLastPendingCommand(deps.connections, response);
            yield sendPromise;
            const [, message] = deps.sendMessage.mock.calls[0];
            expect(message.command_type.action).toBe('ExecutePowerShellScript');
            expect(message.command_type.script).toBe('Get-Process');
            expect(message.command_type.run_as_admin).toBe(true);
        }));
        it('throws for ExecutePowerShellScript without script param', () => __awaiter(void 0, void 0, void 0, function* () {
            const commandType = {
                action: 'ExecutePowerShellScript',
                params: { script: '' },
            };
            yield expect(dispatcher.sendSafeCommand('vm-1', commandType, 60000)).rejects.toThrow('non-empty script parameter');
        }));
        it('formats ProcessKill with pid and force', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const commandType = {
                action: 'ProcessKill',
                params: { pid: 1234, force: true },
            };
            const sendPromise = dispatcher.sendSafeCommand('vm-1', commandType, 5000);
            yield new Promise(resolve => setTimeout(resolve, 0));
            resolveLastPendingCommand(deps.connections, response);
            yield sendPromise;
            const [, message] = deps.sendMessage.mock.calls[0];
            expect(message.command_type).toEqual({
                action: 'ProcessKill',
                pid: 1234,
                force: true,
            });
        }));
        it('formats RunMaintenanceTask with all params', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const commandType = {
                action: 'RunMaintenanceTask',
                params: {
                    task_type: 'cleanup',
                    task_name: 'temp_cleaner',
                    parameters: { max_age_days: 30 },
                    validate_before: true,
                    validate_after: true,
                },
            };
            const sendPromise = dispatcher.sendSafeCommand('vm-1', commandType, 60000);
            yield new Promise(resolve => setTimeout(resolve, 0));
            resolveLastPendingCommand(deps.connections, response);
            yield sendPromise;
            const [, message] = deps.sendMessage.mock.calls[0];
            expect(message.command_type.action).toBe('RunMaintenanceTask');
            expect(message.command_type.task_type).toBe('cleanup');
            expect(message.command_type.task_name).toBe('temp_cleaner');
            expect(message.command_type.validate_before).toBe(true);
        }));
        it('formats UserList action', () => __awaiter(void 0, void 0, void 0, function* () {
            const response = makeSuccessResponse();
            const commandType = {
                action: 'UserList',
            };
            const sendPromise = dispatcher.sendSafeCommand('vm-1', commandType, 5000);
            yield new Promise(resolve => setTimeout(resolve, 0));
            resolveLastPendingCommand(deps.connections, response);
            yield sendPromise;
            const [, message] = deps.sendMessage.mock.calls[0];
            expect(message.command_type).toEqual({ action: 'UserList' });
        }));
    });
    // ─── Convenience wrappers ──────────────────────────────────────────────
    describe('convenience wrappers', () => {
        function testWrapper(fn) {
            return __awaiter(this, void 0, void 0, function* () {
                const response = makeSuccessResponse();
                const promise = fn();
                yield new Promise(resolve => setTimeout(resolve, 0));
                resolveLastPendingCommand(deps.connections, response);
                return promise;
            });
        }
        it('sendPackageCommand - PackageList (no package)', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield testWrapper(() => dispatcher.sendPackageCommand('vm-1', 'PackageList'));
            expect(result.success).toBe(true);
            const [, msg] = deps.sendMessage.mock.calls[0];
            expect(msg.command_type).toEqual({ action: 'PackageList' });
        }));
        it('sendPackageCommand - PackageInstall with package name', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield testWrapper(() => dispatcher.sendPackageCommand('vm-1', 'PackageInstall', 'nginx'));
            expect(result.success).toBe(true);
            const [, msg] = deps.sendMessage.mock.calls[0];
            expect(msg.command_type).toEqual({ action: 'PackageInstall', package: 'nginx' });
        }));
        it('sendPackageCommand - PackageSearch uses query param', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield testWrapper(() => dispatcher.sendPackageCommand('vm-1', 'PackageSearch', 'python'));
            expect(result.success).toBe(true);
            const [, msg] = deps.sendMessage.mock.calls[0];
            expect(msg.command_type).toEqual({ action: 'PackageSearch', query: 'python' });
        }));
        it('sendProcessCommand - ProcessList', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield testWrapper(() => dispatcher.sendProcessCommand('vm-1', 'ProcessList', { limit: 50 }));
            expect(result.success).toBe(true);
            const [, msg] = deps.sendMessage.mock.calls[0];
            expect(msg.command_type.action).toBe('ProcessList');
        }));
        it('getUserList sends UserList action', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield testWrapper(() => dispatcher.getUserList('vm-1'));
            expect(result.success).toBe(true);
            const [, msg] = deps.sendMessage.mock.calls[0];
            expect(msg.command_type).toEqual({ action: 'UserList' });
        }));
        it('sendMaintenancePowerShellScript sends with correct params', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield testWrapper(() => dispatcher.sendMaintenancePowerShellScript('vm-1', 'Get-Service', {
                scriptType: 'inline',
                timeoutSeconds: 120,
                runAsAdmin: true,
            }));
            expect(result.success).toBe(true);
            const [, msg] = deps.sendMessage.mock.calls[0];
            expect(msg.command_type.action).toBe('ExecutePowerShellScript');
            expect(msg.command_type.script).toBe('Get-Service');
            expect(msg.command_type.run_as_admin).toBe(true);
        }));
        it('sendCleanTemporaryFiles sends with targets', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield testWrapper(() => dispatcher.sendCleanTemporaryFiles('vm-1', ['/tmp', '/var/tmp']));
            expect(result.success).toBe(true);
            const [, msg] = deps.sendMessage.mock.calls[0];
            expect(msg.command_type.action).toBe('CleanTemporaryFiles');
        }));
    });
});
