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
/**
 * Unit tests for ScriptScheduler.
 *
 * ScriptScheduler has many internal dependencies (ScriptManager,
 * TemplateEngine, ScriptParser, getVirtioSocketWatcherService,
 * getEventManager), so we use jest.mock() heavily.
 * PrismaClient is mocked with jest-mock-extended.
 */
const ScriptScheduler_1 = require("../../../app/services/scripts/ScriptScheduler");
const jest_mock_extended_1 = require("jest-mock-extended");
const client_1 = require("@prisma/client");
// ─── Mocks ──────────────────────────────────────────────────────────────────
const mockGetScript = jest.fn();
const mockValidateRequiredInputs = jest.fn();
const mockValidateInputValue = jest.fn();
jest.mock('../../../app/services/scripts/ScriptManager', () => {
    return {
        ScriptManager: jest.fn().mockImplementation(() => ({
            getScript: mockGetScript,
        })),
    };
});
jest.mock('../../../app/services/scripts/TemplateEngine', () => ({
    TemplateEngine: jest.fn().mockImplementation(() => ({
        validateRequiredInputs: mockValidateRequiredInputs,
    })),
}));
jest.mock('../../../app/services/scripts/ScriptParser', () => ({
    ScriptParser: jest.fn().mockImplementation(() => ({
        validateInputValue: mockValidateInputValue,
    })),
}));
const mockPushPendingScripts = jest.fn();
jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
    getVirtioSocketWatcherService: () => ({
        pushPendingScriptsToVM: mockPushPendingScripts,
    }),
}));
const mockDispatchEvent = jest.fn();
jest.mock('../../../app/services/EventManager', () => ({
    getEventManager: () => ({
        dispatchEvent: mockDispatchEvent,
    }),
}));
// ─── Helpers ────────────────────────────────────────────────────────────────
function makeScript() {
    return {
        id: 'script-1',
        name: 'Test Script',
        content: 'name: Test\nscript: |-\n  echo hello',
        scriptBody: 'echo hello',
        os: [],
        parsedInputs: [],
        shell: 'BASH',
    };
}
function makeConfig(overrides) {
    return Object.assign({ scriptId: 'script-1', machineIds: ['vm-1', 'vm-2'], inputValues: {}, scheduleType: 'immediate', userId: 'user-1' }, overrides);
}
// ─── Test Suite ─────────────────────────────────────────────────────────────
describe('ScriptScheduler', () => {
    let scheduler;
    let mockPrisma;
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma = (0, jest_mock_extended_1.mockDeep)();
        // Default: script exists
        mockGetScript.mockResolvedValue(makeScript());
        mockValidateRequiredInputs.mockReturnValue(undefined);
        mockValidateInputValue.mockReturnValue(undefined);
        // Default: machines are running
        mockPrisma.machine.findMany.mockResolvedValue([
            { id: 'vm-1', name: 'VM1', status: 'running' },
            { id: 'vm-2', name: 'VM2', status: 'running' },
        ]);
        // Default: scriptExecution.create returns an execution record
        mockPrisma.scriptExecution.create.mockResolvedValue({
            id: 'exec-1',
            scriptId: 'script-1',
            machineId: 'vm-1',
        });
        // Default: scriptAuditLog.create succeeds
        mockPrisma.scriptAuditLog.create.mockResolvedValue({});
        // Default: script has no OS restriction (for validateScriptOSCompatibility)
        mockPrisma.script.findUnique.mockResolvedValue({
            os: [],
            name: 'Test Script',
        });
        // Default: push succeeds
        mockPushPendingScripts.mockResolvedValue({ success: true, scriptCount: 1 });
        scheduler = new ScriptScheduler_1.ScriptScheduler(mockPrisma);
    });
    // ─── scheduleScript ────────────────────────────────────────────────────
    describe('scheduleScript', () => {
        it('schedules an immediate script for multiple VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = makeConfig();
            const result = yield scheduler.scheduleScript(config);
            expect(result.success).toBe(true);
            expect(result.executionIds).toHaveLength(2);
            expect(mockPrisma.scriptExecution.create).toHaveBeenCalledTimes(2);
            const createCall = mockPrisma.scriptExecution.create.mock.calls[0][0];
            expect(createCall.data).toEqual(expect.objectContaining({
                scriptId: 'script-1',
                executionType: client_1.ExecutionType.SCHEDULED,
                status: client_1.ExecutionStatus.PENDING,
                triggeredById: 'user-1',
            }));
        }));
        it('schedules for department when departmentId provided', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findMany
                .mockResolvedValueOnce([{ id: 'vm-dept-1' }]) // expandDepartmentToVMs
                .mockResolvedValueOnce([{ id: 'vm-dept-1', name: 'DeptVM', status: 'running' }]); // VM status check
            const config = makeConfig({
                machineIds: undefined,
                departmentId: 'dept-1',
            });
            const result = yield scheduler.scheduleScript(config);
            expect(result.success).toBe(true);
            expect(result.executionIds).toHaveLength(1);
        }));
        it('returns error when neither machineIds nor departmentId provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = makeConfig({ machineIds: undefined });
            const result = yield scheduler.scheduleScript(config);
            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('INVALID_TARGET');
        }));
        it('returns error when script not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockGetScript.mockResolvedValue(null);
            const result = yield scheduler.scheduleScript(makeConfig());
            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('SCRIPT_NOT_FOUND');
        }));
        it('returns error when no target machines found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findMany.mockResolvedValue([]);
            const config = makeConfig({ machineIds: undefined, departmentId: 'empty-dept' });
            const result = yield scheduler.scheduleScript(config);
            expect(result.success).toBe(false);
            expect(result.error).toContain('No target machines');
        }));
        it('returns error for one-time schedule without scheduledFor', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = makeConfig({ scheduleType: 'one-time', scheduledFor: undefined });
            const result = yield scheduler.scheduleScript(config);
            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('MISSING_SCHEDULE_TIME');
        }));
        it('returns error for periodic schedule without repeatIntervalMinutes', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = makeConfig({
                scheduleType: 'periodic',
                repeatIntervalMinutes: undefined,
            });
            const result = yield scheduler.scheduleScript(config);
            expect(result.success).toBe(false);
            expect(result.error).toContain('repeatIntervalMinutes');
        }));
        it('returns error for periodic schedule with invalid repeatIntervalMinutes', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = makeConfig({
                scheduleType: 'periodic',
                repeatIntervalMinutes: -5,
            });
            const result = yield scheduler.scheduleScript(config);
            expect(result.success).toBe(false);
            expect(result.error).toContain('repeatIntervalMinutes');
        }));
        it('warns about offline VMs but still schedules', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.machine.findMany.mockResolvedValue([
                { id: 'vm-1', name: 'OnlineVM', status: 'running' },
                { id: 'vm-2', name: 'OfflineVM', status: 'stopped' },
            ]);
            const result = yield scheduler.scheduleScript(makeConfig());
            expect(result.success).toBe(true);
            expect(result.warnings).toBeDefined();
            expect(result.warnings).toHaveLength(1);
            expect(result.warnings[0]).toContain('OfflineVM');
        }));
        it('validates OS compatibility and rejects incompatible VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.script.findUnique.mockResolvedValue({
                os: ['LINUX'],
                name: 'Linux Script',
            });
            mockPrisma.machine.findMany.mockResolvedValue([
                { id: 'vm-1', name: 'WinVM', os: 'windows11' },
            ]);
            const result = yield scheduler.scheduleScript(makeConfig());
            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('OS_INCOMPATIBLE');
        }));
        it('creates audit logs with redacted passwords', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = makeConfig({
                inputValues: { username: 'admin', password: 'secret123' },
            });
            yield scheduler.scheduleScript(config);
            const auditCall = mockPrisma.scriptAuditLog.create.mock.calls[0][0];
            expect(auditCall.data.details.inputValues.password).toBe('***REDACTED***');
            expect(auditCall.data.details.inputValues.username).toBe('admin');
        }));
        it('emits schedule_created event', () => __awaiter(void 0, void 0, void 0, function* () {
            yield scheduler.scheduleScript(makeConfig());
            expect(mockDispatchEvent).toHaveBeenCalledWith('scripts', 'create', expect.objectContaining({
                action: 'schedule_created',
                scriptId: 'script-1',
            }), 'user-1');
        }));
        it('handles event emission failure gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockDispatchEvent.mockRejectedValue(new Error('Event bus down'));
            const result = yield scheduler.scheduleScript(makeConfig());
            expect(result.success).toBe(true); // Should not fail
        }));
        it('handles push scripts failure gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPushPendingScripts.mockRejectedValue(new Error('Push failed'));
            const result = yield scheduler.scheduleScript(makeConfig());
            expect(result.success).toBe(true); // Polling serves as fallback
        }));
    });
    // ─── updateScheduledScript ─────────────────────────────────────────────
    describe('updateScheduledScript', () => {
        it('updates a pending scheduled execution', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                scriptId: 'script-1',
                status: client_1.ExecutionStatus.PENDING,
                script: makeScript(),
                machine: { id: 'vm-1', name: 'VM1' },
            });
            mockPrisma.scriptExecution.update.mockResolvedValue({});
            const result = yield scheduler.updateScheduledScript('exec-1', {
                scheduledFor: new Date('2025-12-01'),
                runAs: 'admin',
            }, 'user-1');
            expect(result.success).toBe(true);
            expect(mockPrisma.scriptExecution.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'exec-1' },
                data: expect.objectContaining({
                    scheduledFor: expect.any(Date),
                    executedAs: 'admin',
                }),
            }));
        }));
        it('returns error when execution not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue(null);
            const result = yield scheduler.updateScheduledScript('nonexistent', {}, 'user-1');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        }));
        it('returns error when execution is not PENDING', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                status: client_1.ExecutionStatus.RUNNING,
            });
            const result = yield scheduler.updateScheduledScript('exec-1', {}, 'user-1');
            expect(result.success).toBe(false);
            expect(result.error).toContain('Only PENDING');
        }));
        it('re-validates input values when updating inputs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                scriptId: 'script-1',
                status: client_1.ExecutionStatus.PENDING,
                script: makeScript(),
                machine: { id: 'vm-1', name: 'VM1' },
            });
            mockPrisma.scriptExecution.update.mockResolvedValue({});
            yield scheduler.updateScheduledScript('exec-1', {
                inputValues: { key: 'value' },
            }, 'user-1');
            expect(mockValidateRequiredInputs).toHaveBeenCalled();
        }));
    });
    // ─── cancelScheduledScript ─────────────────────────────────────────────
    describe('cancelScheduledScript', () => {
        it('cancels a pending execution', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                scriptId: 'script-1',
                status: client_1.ExecutionStatus.PENDING,
            });
            mockPrisma.scriptExecution.update.mockResolvedValue({});
            const result = yield scheduler.cancelScheduledScript('exec-1', 'user-1');
            expect(result).toBe(true);
            expect(mockPrisma.scriptExecution.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'exec-1' },
                data: {
                    status: client_1.ExecutionStatus.CANCELLED,
                    completedAt: expect.any(Date),
                    error: 'Cancelled by user',
                },
            }));
        }));
        it('cancels a running execution', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                scriptId: 'script-1',
                status: client_1.ExecutionStatus.RUNNING,
            });
            mockPrisma.scriptExecution.update.mockResolvedValue({});
            const result = yield scheduler.cancelScheduledScript('exec-1', 'user-1');
            expect(result).toBe(true);
        }));
        it('throws when execution not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue(null);
            yield expect(scheduler.cancelScheduledScript('nonexistent', 'user-1')).rejects.toThrow('not found');
        }));
        it('throws when execution status cannot be cancelled', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findUnique.mockResolvedValue({
                id: 'exec-1',
                status: client_1.ExecutionStatus.SUCCESS,
            });
            yield expect(scheduler.cancelScheduledScript('exec-1', 'user-1')).rejects.toThrow('Cannot cancel');
        }));
    });
    // ─── hasActiveSchedules ────────────────────────────────────────────────
    describe('hasActiveSchedules', () => {
        it('returns count and affected VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findMany.mockResolvedValue([
                { scriptId: 's1', machine: { id: 'vm-1', name: 'VM1' } },
                { scriptId: 's1', machine: { id: 'vm-2', name: 'VM2' } },
            ]);
            const result = yield scheduler.hasActiveSchedules('s1');
            expect(result.count).toBe(2);
            expect(result.affectedVMs).toHaveLength(2);
        }));
        it('returns empty when no active schedules', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findMany.mockResolvedValue([]);
            const result = yield scheduler.hasActiveSchedules('s1');
            expect(result.count).toBe(0);
            expect(result.affectedVMs).toEqual([]);
        }));
        it('deduplicates VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            mockPrisma.scriptExecution.findMany.mockResolvedValue([
                { scriptId: 's1', machine: { id: 'vm-1', name: 'VM1' } },
                { scriptId: 's1', machine: { id: 'vm-1', name: 'VM1' } },
            ]);
            const result = yield scheduler.hasActiveSchedules('s1');
            expect(result.count).toBe(2);
            expect(result.affectedVMs).toHaveLength(1); // deduplicated
        }));
    });
});
