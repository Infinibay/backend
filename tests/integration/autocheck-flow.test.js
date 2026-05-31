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
const socket_io_1 = require("socket.io");
const http_1 = require("http");
const VirtioSocketWatcherService_1 = require("../../app/services/VirtioSocketWatcherService");
const VmEventManager_1 = require("../../app/services/VmEventManager");
const EventManager_1 = require("../../app/services/EventManager");
const SocketService_1 = require("../../app/services/SocketService");
const BackgroundHealthService_1 = require("../../app/services/BackgroundHealthService");
const VMHealthQueueManager_1 = require("../../app/services/VMHealthQueueManager");
const machine_status_1 = require("../../app/constants/machine-status");
const jest_setup_1 = require("../setup/jest.setup");
const db_factories_1 = require("../setup/db-factories");
const logger_1 = __importDefault(require("@main/logger"));
/**
 * Auto-check end-to-end integration.
 *
 * Covers the path from health-check detection through event dispatch. The DB
 * is real; Socket.IO is real but we spy on `sendToUser` to assert on delivery.
 * VMRecommendationService timers are captured by fake-timers when we need to
 * instantiate services that construct it transitively — otherwise Jest can't
 * exit.
 */
describe('Auto-check end-to-end integration — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    let virtioService;
    let vmEventManager;
    let eventManager;
    let socketService;
    let httpServer;
    let ioServer;
    beforeAll(() => {
        httpServer = (0, http_1.createServer)();
        httpServer.listen();
        const port = httpServer.address().port;
        void port;
        ioServer = new socket_io_1.Server(httpServer, {
            cors: { origin: '*', methods: ['GET', 'POST'] }
        });
        socketService = (0, SocketService_1.createSocketService)(prisma);
        socketService.initialize(httpServer);
    });
    afterAll(() => {
        // socket.io's Server is mocked globally in jest.setup; nothing to close on ioServer.
        httpServer === null || httpServer === void 0 ? void 0 : httpServer.close();
    });
    // These IDs are referenced by hard-coded strings across the tests; seeding
    // with explicit IDs keeps the test bodies readable.
    const OWNER_ID = 'test-user-id';
    const ADMIN_ID = 'admin-user-id';
    const DEPT_ID = 'test-dept-id';
    const VM_ID = 'test-vm-id';
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        eventManager = (0, EventManager_1.createEventManager)(socketService, prisma);
        vmEventManager = new VmEventManager_1.VmEventManager(socketService, prisma);
        virtioService = new VirtioSocketWatcherService_1.VirtioSocketWatcherService(prisma);
        eventManager.registerResourceManager('vms', vmEventManager);
        virtioService.initialize(vmEventManager);
        yield (0, db_factories_1.createUser)(prisma, { id: OWNER_ID, email: `${OWNER_ID}@test.infinibay` });
        yield (0, db_factories_1.createAdmin)(prisma, { id: ADMIN_ID, email: `${ADMIN_ID}@test.infinibay` });
        yield (0, db_factories_1.createDepartment)(prisma, { id: DEPT_ID, name: 'AutoCheckDept' });
        yield (0, db_factories_1.createMachine)(prisma, {
            userId: OWNER_ID,
            departmentId: DEPT_ID,
            overrides: { id: VM_ID, name: 'integration-test-vm', status: machine_status_1.RUNNING_STATUS, os: 'windows' }
        });
    }));
    describe('VmEventManager event dispatch', () => {
        it('dispatches issue-detected + remediation-available + remediation-completed events', () => __awaiter(void 0, void 0, void 0, function* () {
            const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn());
            yield vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
                checkType: 'WindowsUpdates',
                severity: 'critical',
                description: '2 critical Windows updates are pending',
                details: { criticalUpdates: 2 }
            });
            yield vmEventManager.handleAutoCheckRemediationAvailable(VM_ID, {
                checkType: 'WindowsUpdates',
                remediationType: 'AutoFixWindowsUpdates',
                description: 'Auto install',
                isAutomatic: true,
                estimatedTime: '15m',
                details: {}
            });
            yield vmEventManager.handleAutoCheckRemediationCompleted(VM_ID, {
                checkType: 'WindowsUpdates',
                remediationType: 'AutoFixWindowsUpdates',
                success: true,
                description: 'done',
                executionTime: '1s',
                details: {}
            });
            expect(spy).toHaveBeenCalledWith(OWNER_ID, 'autocheck', 'issue-detected', expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, issueType: 'WindowsUpdates' }) }));
            expect(spy).toHaveBeenCalledWith(OWNER_ID, 'autocheck', 'remediation-available', expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, isAutomatic: true }) }));
            expect(spy).toHaveBeenCalledWith(OWNER_ID, 'autocheck', 'remediation-completed', expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, success: true }) }));
        }));
        it('dispatches a disk-space issue-detected event', () => __awaiter(void 0, void 0, void 0, function* () {
            const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn());
            yield vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
                checkType: 'DiskSpace',
                severity: 'critical',
                description: 'Drive C: is critically low on space',
                details: { drive: 'C:', usedPercent: 95 }
            });
            expect(spy).toHaveBeenCalledWith(OWNER_ID, 'autocheck', 'issue-detected', expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, issueType: 'DiskSpace' }) }));
        }));
        it('dispatches a Windows Defender issue-detected event', () => __awaiter(void 0, void 0, void 0, function* () {
            const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn());
            yield vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
                checkType: 'WindowsDefender',
                severity: 'critical',
                description: 'Windows Defender is disabled',
                details: { antivirusEnabled: false }
            });
            expect(spy).toHaveBeenCalledWith(OWNER_ID, 'autocheck', 'issue-detected', expect.objectContaining({ data: expect.objectContaining({ issueType: 'WindowsDefender' }) }));
        }));
        it('still dispatches notifications for stopped VMs (status filter is upstream)', () => __awaiter(void 0, void 0, void 0, function* () {
            const STOPPED_ID = 'stopped-vm-id';
            yield (0, db_factories_1.createMachine)(prisma, {
                userId: OWNER_ID,
                departmentId: DEPT_ID,
                overrides: { id: STOPPED_ID, status: machine_status_1.OFF_STATUS, name: 'stopped-vm' }
            });
            const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn());
            yield vmEventManager.handleAutoCheckIssueDetected(STOPPED_ID, {
                checkType: 'HealthCheck', severity: 'warning', description: 'test', details: {}
            });
            expect(spy).toHaveBeenCalled();
        }));
    });
    describe('BackgroundHealthService — VM status filtering', () => {
        function buildBackgroundHealthService() {
            return __awaiter(this, arguments, void 0, function* (opts = {}) {
                var _a, _b;
                const mockBackgroundTaskService = {
                    queueTask: jest.fn().mockImplementation((_n, fn) => __awaiter(this, void 0, void 0, function* () {
                        yield fn();
                        return 'task-123';
                    }))
                };
                const mockEventManager = (_a = opts.eventManager) !== null && _a !== void 0 ? _a : { dispatchEvent: jest.fn() };
                const mockQueueManager = (_b = opts.queueManager) !== null && _b !== void 0 ? _b : { queueHealthChecks: jest.fn().mockResolvedValue(undefined) };
                // Fake timers swallow the setInterval/setTimeout that
                // VMRecommendationService schedules when constructed transitively.
                jest.useFakeTimers({ advanceTimers: false });
                const service = new BackgroundHealthService_1.BackgroundHealthService(prisma, mockBackgroundTaskService, mockEventManager, mockQueueManager);
                jest.useRealTimers();
                return { service, mockEventManager, mockQueueManager, mockBackgroundTaskService };
            });
        }
        it('queues health checks only for running VMs, ignoring stopped/paused', () => __awaiter(void 0, void 0, void 0, function* () {
            // Seed extra VMs with mixed statuses.
            yield (0, db_factories_1.createMachine)(prisma, {
                userId: OWNER_ID,
                departmentId: DEPT_ID,
                overrides: { status: machine_status_1.OFF_STATUS, name: 'stopped' }
            });
            yield (0, db_factories_1.createMachine)(prisma, {
                userId: OWNER_ID,
                departmentId: DEPT_ID,
                overrides: { status: machine_status_1.RUNNING_STATUS, name: 'running-extra' }
            });
            const { service, mockQueueManager, mockEventManager } = yield buildBackgroundHealthService();
            yield service.executeHealthCheckRound();
            // Exactly two running VMs exist (VM_ID + running-extra). queueHealthChecks
            // should be called once per each, and never for the stopped one.
            expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(2);
            const queuedIds = mockQueueManager.queueHealthChecks.mock.calls.map((c) => c[0]);
            expect(queuedIds).toContain(VM_ID);
            expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_started', expect.objectContaining({ vmCount: 2 }));
            expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith('health', 'round_completed', expect.objectContaining({ totalVMs: 2, successCount: 2, failureCount: 0 }));
        }));
    });
    describe('VMHealthQueueManager — stopped-VM short-circuit', () => {
        it('skips queueing and does not write when the VM is stopped', () => __awaiter(void 0, void 0, void 0, function* () {
            const STOPPED_ID = 'stopped-queue-vm';
            yield (0, db_factories_1.createMachine)(prisma, {
                userId: OWNER_ID,
                departmentId: DEPT_ID,
                overrides: { id: STOPPED_ID, status: machine_status_1.OFF_STATUS, name: 'stopped-queue-vm' }
            });
            const mockEventManager = { dispatchEvent: jest.fn() };
            jest.useFakeTimers({ advanceTimers: false });
            const queueManager = new VMHealthQueueManager_1.VMHealthQueueManager(prisma, mockEventManager);
            jest.useRealTimers();
            const infoSpy = jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
            yield queueManager.queueHealthChecks(STOPPED_ID);
            expect(yield prisma.vMHealthCheckQueue.count({ where: { machineId: STOPPED_ID } })).toBe(0);
            expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Skipping health checks for VM stopped-queue-vm"));
            infoSpy.mockRestore();
        }));
    });
    describe('Multi-user event distribution', () => {
        it('delivers auto-check events to the VM owner and every admin', () => __awaiter(void 0, void 0, void 0, function* () {
            // Seed a second admin so we can count recipients deterministically.
            yield (0, db_factories_1.createAdmin)(prisma, {
                id: 'admin-second',
                email: 'admin-second@test.infinibay'
            });
            const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn());
            yield vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
                checkType: 'HealthCheck',
                severity: 'warning',
                description: 'System health check detected warning issues',
                details: { overall_health: 'Warning' }
            });
            const recipients = new Set(spy.mock.calls.map(c => c[0]));
            expect(recipients.has(OWNER_ID)).toBe(true);
            expect(recipients.has(ADMIN_ID)).toBe(true);
            expect(recipients.has('admin-second')).toBe(true);
        }));
    });
});
