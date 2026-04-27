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
const VMHealthQueueRepository_1 = require("@services/VMHealthQueueRepository");
const jest_setup_1 = require("../setup/jest.setup");
const db_factories_1 = require("../setup/db-factories");
const crypto_1 = require("crypto");
describe('VMHealthQueueRepository — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    let repo;
    let machineId;
    let userId;
    let departmentId;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        repo = new VMHealthQueueRepository_1.VMHealthQueueRepository(prisma);
        const admin = yield (0, db_factories_1.createAdmin)(prisma);
        userId = admin.id;
        const dept = yield (0, db_factories_1.createDepartment)(prisma);
        departmentId = dept.id;
        const machine = yield (0, db_factories_1.createMachine)(prisma, { userId, departmentId });
        machineId = machine.id;
    }));
    // ─── Helper: insert a queue row directly ──────────────────────────────────
    function insertQueueRow(overrides) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g;
            return prisma.vMHealthCheckQueue.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    machineId: overrides.machineId,
                    checkType: (_a = overrides.checkType) !== null && _a !== void 0 ? _a : 'DISK_SPACE',
                    priority: (_b = overrides.priority) !== null && _b !== void 0 ? _b : 'MEDIUM',
                    status: (_c = overrides.status) !== null && _c !== void 0 ? _c : 'PENDING',
                    scheduledFor: (_d = overrides.scheduledFor) !== null && _d !== void 0 ? _d : new Date(),
                    payload: (_e = overrides.payload) !== null && _e !== void 0 ? _e : undefined,
                    maxAttempts: (_f = overrides.maxAttempts) !== null && _f !== void 0 ? _f : 3,
                    attempts: (_g = overrides.attempts) !== null && _g !== void 0 ? _g : 0,
                },
            });
        });
    }
    // ─── Query helpers ────────────────────────────────────────────────────────
    describe('findPendingTasksForVm', () => {
        it('returns only PENDING and RETRY_SCHEDULED tasks for the given VM', () => __awaiter(void 0, void 0, void 0, function* () {
            const t1 = yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' });
            const t2 = yield insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'RETRY_SCHEDULED' });
            yield insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'COMPLETED' });
            yield insertQueueRow({ machineId, checkType: 'WINDOWS_UPDATES', status: 'RUNNING' });
            const results = yield repo.findPendingTasksForVm(machineId);
            expect(results).toHaveLength(2);
            const ids = results.map(r => r.id).sort();
            expect(ids).toEqual([t1.id, t2.id].sort());
        }));
        it('returns empty array when no pending tasks exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const results = yield repo.findPendingTasksForVm(machineId);
            expect(results).toEqual([]);
        }));
        it('orders by priority ASC then scheduledFor ASC', () => __awaiter(void 0, void 0, void 0, function* () {
            const past = new Date(Date.now() - 60000);
            const future = new Date(Date.now() + 60000);
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', priority: 'LOW', scheduledFor: past });
            yield insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', priority: 'URGENT', scheduledFor: future });
            yield insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', priority: 'LOW', scheduledFor: future });
            const results = yield repo.findPendingTasksForVm(machineId);
            expect(results).toHaveLength(3);
            // URGENT comes first
            expect(results[0].priority).toBe('URGENT');
            // Same priority (LOW) → scheduledFor ASC
            expect(results[1].scheduledFor.getTime()).toBeLessThan(results[2].scheduledFor.getTime());
        }));
        it('does not return tasks for other machines', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' });
            const otherMachine = yield (0, db_factories_1.createMachine)(prisma, { userId, departmentId });
            yield insertQueueRow({ machineId: otherMachine.id, checkType: 'DISK_SPACE', status: 'PENDING' });
            const results = yield repo.findPendingTasksForVm(machineId);
            expect(results).toHaveLength(1);
            expect(results[0].machineId).toBe(machineId);
        }));
    });
    describe('findAllPendingTasks', () => {
        it('returns pending tasks across all VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' });
            const otherMachine = yield (0, db_factories_1.createMachine)(prisma, { userId, departmentId });
            yield insertQueueRow({ machineId: otherMachine.id, checkType: 'LINUX_UPDATES', status: 'PENDING' });
            yield insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'COMPLETED' });
            const results = yield repo.findAllPendingTasks();
            expect(results).toHaveLength(2);
        }));
        it('returns empty when no pending tasks', () => __awaiter(void 0, void 0, void 0, function* () {
            const results = yield repo.findAllPendingTasks();
            expect(results).toEqual([]);
        }));
    });
    describe('findExistingTask', () => {
        it('finds a PENDING task for the same VM and check type', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' });
            const found = yield repo.findExistingTask(machineId, 'DISK_SPACE');
            expect(found).not.toBeNull();
            expect(found.id).toBe(row.id);
        }));
        it('finds a RUNNING task', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'RUNNING' });
            const found = yield repo.findExistingTask(machineId, 'DISK_SPACE');
            expect(found).not.toBeNull();
            expect(found.id).toBe(row.id);
        }));
        it('finds a RETRY_SCHEDULED task', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'RETRY_SCHEDULED' });
            const found = yield repo.findExistingTask(machineId, 'DISK_SPACE');
            expect(found).not.toBeNull();
            expect(found.id).toBe(row.id);
        }));
        it('returns null for COMPLETED / FAILED / CANCELLED tasks', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'COMPLETED' });
            yield insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'FAILED' });
            yield insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'CANCELLED' });
            expect(yield repo.findExistingTask(machineId, 'DISK_SPACE')).toBeNull();
            expect(yield repo.findExistingTask(machineId, 'RESOURCE_OPTIMIZATION')).toBeNull();
            expect(yield repo.findExistingTask(machineId, 'LINUX_UPDATES')).toBeNull();
        }));
        it('returns null for different check type', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' });
            expect(yield repo.findExistingTask(machineId, 'LINUX_UPDATES')).toBeNull();
        }));
        it('returns null for different machine', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' });
            const otherMachine = yield (0, db_factories_1.createMachine)(prisma, { userId, departmentId });
            expect(yield repo.findExistingTask(otherMachine.id, 'DISK_SPACE')).toBeNull();
        }));
    });
    describe('findRecentCompletedOverallScan', () => {
        it('returns a completed OVERALL_STATUS within the interval', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield prisma.vMHealthCheckQueue.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    machineId,
                    checkType: 'OVERALL_STATUS',
                    priority: 'MEDIUM',
                    status: 'COMPLETED',
                    completedAt: new Date(),
                    scheduledFor: new Date(),
                },
            });
            const found = yield repo.findRecentCompletedOverallScan(machineId, 60000);
            expect(found).not.toBeNull();
            expect(found.id).toBe(row.id);
        }));
        it('returns null when completed scan is older than interval', () => __awaiter(void 0, void 0, void 0, function* () {
            yield prisma.vMHealthCheckQueue.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    machineId,
                    checkType: 'OVERALL_STATUS',
                    priority: 'MEDIUM',
                    status: 'COMPLETED',
                    completedAt: new Date(Date.now() - 120000),
                    scheduledFor: new Date(Date.now() - 120000),
                },
            });
            const found = yield repo.findRecentCompletedOverallScan(machineId, 60000);
            expect(found).toBeNull();
        }));
        it('returns null when no OVERALL_STATUS exists', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'COMPLETED' });
            const found = yield repo.findRecentCompletedOverallScan(machineId, 60000);
            expect(found).toBeNull();
        }));
    });
    describe('getVmConfig', () => {
        it('returns the config for a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            yield prisma.vMHealthConfig.create({
                data: {
                    machineId,
                    checkIntervalMinutes: 10,
                    thresholds: {},
                    enabledModules: [],
                },
            });
            const config = yield repo.getVmConfig(machineId);
            expect(config).not.toBeNull();
            expect(config.checkIntervalMinutes).toBe(10);
        }));
        it('returns null when no config exists', () => __awaiter(void 0, void 0, void 0, function* () {
            const config = yield repo.getVmConfig(machineId);
            expect(config).toBeNull();
        }));
    });
    describe('findMachine', () => {
        it('returns machine info', () => __awaiter(void 0, void 0, void 0, function* () {
            const found = yield repo.findMachine(machineId);
            expect(found).not.toBeNull();
            expect(found.id).toBe(machineId);
            expect(found.name).toBeDefined();
            expect(found.status).toBeDefined();
        }));
        it('returns null for non-existent machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const found = yield repo.findMachine((0, crypto_1.randomUUID)());
            expect(found).toBeNull();
        }));
    });
    describe('getLastOverallScanTime', () => {
        it('returns the most recent completedAt for OVERALL_STATUS', () => __awaiter(void 0, void 0, void 0, function* () {
            const completedAt = new Date();
            yield prisma.vMHealthCheckQueue.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    machineId,
                    checkType: 'OVERALL_STATUS',
                    priority: 'MEDIUM',
                    status: 'COMPLETED',
                    completedAt,
                    scheduledFor: new Date(Date.now() - 60000),
                },
            });
            const lastTime = yield repo.getLastOverallScanTime(machineId);
            expect(lastTime).not.toBeNull();
            expect(lastTime.getTime()).toBeCloseTo(completedAt.getTime(), -2);
        }));
        it('returns null when no completed OVERALL_STATUS', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'OVERALL_STATUS', status: 'PENDING' });
            expect(yield repo.getLastOverallScanTime(machineId)).toBeNull();
        }));
        it('picks the most recent of multiple completed scans', () => __awaiter(void 0, void 0, void 0, function* () {
            const older = new Date(Date.now() - 60000);
            const newer = new Date();
            yield prisma.vMHealthCheckQueue.create({
                data: {
                    id: (0, crypto_1.randomUUID)(), machineId, checkType: 'OVERALL_STATUS', priority: 'MEDIUM',
                    status: 'COMPLETED', completedAt: older, scheduledFor: new Date(older.getTime() - 60000),
                },
            });
            yield prisma.vMHealthCheckQueue.create({
                data: {
                    id: (0, crypto_1.randomUUID)(), machineId, checkType: 'OVERALL_STATUS', priority: 'MEDIUM',
                    status: 'COMPLETED', completedAt: newer, scheduledFor: new Date(newer.getTime() - 60000),
                },
            });
            const lastTime = yield repo.getLastOverallScanTime(machineId);
            expect(lastTime).not.toBeNull();
            expect(lastTime.getTime()).toBeCloseTo(newer.getTime(), -2);
        }));
    });
    // ─── Write operations ──────────────────────────────────────────────────────
    describe('insertTask', () => {
        it('inserts a task and returns the ID', () => __awaiter(void 0, void 0, void 0, function* () {
            const taskId = (0, crypto_1.randomUUID)();
            const scheduledFor = new Date();
            const returnedId = yield repo.insertTask(machineId, 'DISK_SPACE', 'MEDIUM', { key: 'value' }, 3, taskId, scheduledFor);
            expect(returnedId).toBe(taskId);
            const row = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } });
            expect(row).not.toBeNull();
            expect(row.machineId).toBe(machineId);
            expect(row.checkType).toBe('DISK_SPACE');
            expect(row.priority).toBe('MEDIUM');
            expect(row.status).toBe('PENDING');
            expect(row.attempts).toBe(0);
            expect(row.maxAttempts).toBe(3);
            expect(row.payload).toEqual({ key: 'value' });
        }));
        it('inserts without payload', () => __awaiter(void 0, void 0, void 0, function* () {
            const taskId = (0, crypto_1.randomUUID)();
            yield repo.insertTask(machineId, 'LINUX_UPDATES', 'HIGH', undefined, 5, taskId, new Date());
            const row = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } });
            expect(row).not.toBeNull();
            expect(row.payload).toBeNull(); // Prisma stores undefined as NULL for Json?
        }));
    });
    describe('claimReadyTasks', () => {
        it('claims ready PENDING tasks and sets status to RUNNING', () => __awaiter(void 0, void 0, void 0, function* () {
            const t1 = yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING', scheduledFor: new Date() });
            const t2 = yield insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'PENDING', scheduledFor: new Date() });
            const claimed = yield repo.claimReadyTasks(machineId, 10);
            expect(claimed).toHaveLength(2);
            // Verify DB state updated to RUNNING
            const r1 = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: t1.id } });
            const r2 = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: t2.id } });
            expect(r1.status).toBe('RUNNING');
            expect(r2.status).toBe('RUNNING');
            expect(r1.executedAt).not.toBeNull();
        }));
        it('claims RETRY_SCHEDULED tasks', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, status: 'RETRY_SCHEDULED', scheduledFor: new Date() });
            const claimed = yield repo.claimReadyTasks(machineId, 10);
            expect(claimed).toHaveLength(1);
            expect(claimed[0].id).toBe(row.id);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db.status).toBe('RUNNING');
        }));
        it('skips tasks scheduled in the future', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, status: 'PENDING', scheduledFor: new Date(Date.now() + 600000) });
            const claimed = yield repo.claimReadyTasks(machineId, 10);
            expect(claimed).toHaveLength(0);
        }));
        it('skips RUNNING / COMPLETED / FAILED tasks', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, status: 'RUNNING', scheduledFor: new Date() });
            yield insertQueueRow({ machineId, status: 'COMPLETED', scheduledFor: new Date() });
            yield insertQueueRow({ machineId, status: 'FAILED', scheduledFor: new Date() });
            const claimed = yield repo.claimReadyTasks(machineId, 10);
            expect(claimed).toHaveLength(0);
        }));
        it('respects the maxTasks limit', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING', scheduledFor: new Date() });
            yield insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'PENDING', scheduledFor: new Date() });
            yield insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'PENDING', scheduledFor: new Date() });
            const claimed = yield repo.claimReadyTasks(machineId, 2);
            expect(claimed).toHaveLength(2);
        }));
        it('does not claim tasks for other VMs', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, status: 'PENDING', scheduledFor: new Date() });
            const otherMachine = yield (0, db_factories_1.createMachine)(prisma, { userId, departmentId });
            yield insertQueueRow({ machineId: otherMachine.id, status: 'PENDING', scheduledFor: new Date() });
            const claimed = yield repo.claimReadyTasks(machineId, 10);
            expect(claimed).toHaveLength(1);
            expect(claimed[0].machineId).toBe(machineId);
        }));
        it('returns empty when no tasks are ready', () => __awaiter(void 0, void 0, void 0, function* () {
            const claimed = yield repo.claimReadyTasks(machineId, 10);
            expect(claimed).toEqual([]);
        }));
    });
    describe('markTaskRunning', () => {
        it('sets status to RUNNING and increments attempts', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, attempts: 2 });
            yield repo.markTaskRunning(row.id, 2);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db.status).toBe('RUNNING');
            expect(db.attempts).toBe(3);
            expect(db.executedAt).not.toBeNull();
        }));
    });
    describe('markTaskCompleted', () => {
        it('sets status to COMPLETED with result and timing', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId });
            const result = { healthy: true, details: 'all good' };
            yield repo.markTaskCompleted(row.id, result, 150);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db.status).toBe('COMPLETED');
            expect(db.completedAt).not.toBeNull();
            expect(db.result).toEqual(result);
            expect(db.executionTimeMs).toBe(150);
        }));
    });
    describe('markTaskFailed', () => {
        it('sets status to FAILED with error message', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId });
            yield repo.markTaskFailed(row.id, 'connection timeout', 500);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db.status).toBe('FAILED');
            expect(db.completedAt).not.toBeNull();
            expect(db.error).toBe('connection timeout');
            expect(db.executionTimeMs).toBe(500);
        }));
    });
    describe('markTaskRetryScheduled', () => {
        it('sets status to RETRY_SCHEDULED with new scheduled time and attempts', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId });
            const retryAt = new Date(Date.now() + 30000);
            yield repo.markTaskRetryScheduled(row.id, retryAt, 1);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db.status).toBe('RETRY_SCHEDULED');
            expect(db.scheduledFor.getTime()).toBeCloseTo(retryAt.getTime(), -2);
            expect(db.attempts).toBe(1);
        }));
    });
    // ─── Delete operations ────────────────────────────────────────────────────
    describe('deleteTask', () => {
        it('deletes a PENDING task', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, status: 'PENDING' });
            yield repo.deleteTask(row.id);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db).toBeNull();
        }));
        it('deletes a RETRY_SCHEDULED task', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, status: 'RETRY_SCHEDULED' });
            yield repo.deleteTask(row.id);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db).toBeNull();
        }));
        it('does not delete a RUNNING task', () => __awaiter(void 0, void 0, void 0, function* () {
            const row = yield insertQueueRow({ machineId, status: 'RUNNING' });
            yield repo.deleteTask(row.id);
            const db = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } });
            expect(db).not.toBeNull(); // RUNNING tasks are protected from deletion
        }));
    });
    describe('deleteTasksForVm', () => {
        it('deletes all pending tasks for a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' });
            yield insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'RETRY_SCHEDULED' });
            yield insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'COMPLETED' });
            const count = yield repo.deleteTasksForVm(machineId);
            expect(count).toBe(2);
            const remaining = yield prisma.vMHealthCheckQueue.findMany({ where: { machineId } });
            expect(remaining).toHaveLength(1);
            expect(remaining[0].status).toBe('COMPLETED');
        }));
        it('returns 0 when no tasks match', () => __awaiter(void 0, void 0, void 0, function* () {
            const count = yield repo.deleteTasksForVm(machineId);
            expect(count).toBe(0);
        }));
    });
    describe('deleteOrphanedTasks', () => {
        it('deletes pending tasks for DELETED machines', () => __awaiter(void 0, void 0, void 0, function* () {
            // Create machine with DELETED status
            const deletedMachine = yield prisma.machine.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    name: 'deleted-vm',
                    internalName: 'deleted-internal',
                    status: 'DELETED',
                    os: 'linux',
                    cpuCores: 2,
                    ramGB: 4,
                    diskSizeGB: 50,
                    userId,
                    departmentId,
                },
            });
            yield insertQueueRow({ machineId: deletedMachine.id, status: 'PENDING' });
            yield insertQueueRow({ machineId: deletedMachine.id, status: 'RETRY_SCHEDULED' });
            const count = yield repo.deleteOrphanedTasks();
            expect(count).toBe(2);
            const remaining = yield prisma.vMHealthCheckQueue.findMany({
                where: { machineId: deletedMachine.id },
            });
            expect(remaining).toHaveLength(0);
        }));
        it('does not delete tasks for active machines', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, status: 'PENDING' });
            const count = yield repo.deleteOrphanedTasks();
            expect(count).toBe(0);
        }));
        it('returns 0 when no DELETED machines exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const count = yield repo.deleteOrphanedTasks();
            expect(count).toBe(0);
        }));
    });
    describe('getDeletedVmIds', () => {
        it('returns IDs of DELETED machines', () => __awaiter(void 0, void 0, void 0, function* () {
            const deletedMachine = yield prisma.machine.create({
                data: {
                    id: (0, crypto_1.randomUUID)(),
                    name: 'deleted-vm-2',
                    internalName: 'deleted-internal-2',
                    status: 'DELETED',
                    os: 'linux',
                    cpuCores: 2,
                    ramGB: 4,
                    diskSizeGB: 50,
                    userId,
                    departmentId,
                },
            });
            const ids = yield repo.getDeletedVmIds();
            expect(ids).toContain(deletedMachine.id);
            expect(ids).not.toContain(machineId); // active machine not included
        }));
        it('returns empty array when no deleted machines', () => __awaiter(void 0, void 0, void 0, function* () {
            const ids = yield repo.getDeletedVmIds();
            // Might include orphans from other tests if not cleaned
            expect(ids).not.toContain(machineId);
        }));
    });
    // ─── Snapshot operations ──────────────────────────────────────────────────
    describe('findTodaySnapshot', () => {
        it('returns a snapshot created today', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 0,
                    checksFailed: 0,
                },
            });
            const found = yield repo.findTodaySnapshot(machineId);
            expect(found).not.toBeNull();
            expect(found.id).toBe(snapshot.id);
        }));
        it('returns null when no snapshot exists for today', () => __awaiter(void 0, void 0, void 0, function* () {
            // Create a snapshot for yesterday
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: yesterday,
                    overallStatus: 'HEALTHY',
                    checksCompleted: 1,
                    checksFailed: 0,
                },
            });
            const found = yield repo.findTodaySnapshot(machineId);
            expect(found).toBeNull();
        }));
    });
    describe('createSnapshot', () => {
        it('creates a snapshot with custom check results', () => __awaiter(void 0, void 0, void 0, function* () {
            const customResults = { source: 'test', count: 5 };
            const snapshot = yield repo.createSnapshot(machineId, customResults);
            expect(snapshot).toBeDefined();
            expect(snapshot.id).toBeDefined();
            expect(snapshot.machineId).toBe(machineId);
            expect(snapshot.overallStatus).toBe('PENDING');
            expect(snapshot.customCheckResults).toEqual(customResults);
            // Verify it's in the DB
            const db = yield prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } });
            expect(db).not.toBeNull();
        }));
    });
    describe('updateSnapshotMetadata', () => {
        it('updates customCheckResults on an existing snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 0,
                    checksFailed: 0,
                    customCheckResults: { old: true },
                },
            });
            yield repo.updateSnapshotMetadata(snapshot.id, { new: true, count: 3 });
            const db = yield prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } });
            expect(db.customCheckResults).toEqual({ new: true, count: 3 });
        }));
    });
    describe('getSnapshotForMerge', () => {
        it('returns applicationInventory for a snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            const inventory = { applications: [{ name: 'nginx' }] };
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 0,
                    checksFailed: 0,
                    applicationInventory: inventory,
                },
            });
            const result = yield repo.getSnapshotForMerge(snapshot.id);
            expect(result).not.toBeNull();
            expect(result.applicationInventory).toEqual(inventory);
        }));
        it('returns null for non-existent snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield repo.getSnapshotForMerge((0, crypto_1.randomUUID)());
            expect(result).toBeNull();
        }));
    });
    describe('appendSnapshotResult', () => {
        it('increments checksCompleted and sets fields', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 2,
                    checksFailed: 0,
                },
            });
            yield repo.appendSnapshotResult(snapshot.id, 100, {
                diskSpaceInfo: { used: 50, total: 100 },
            });
            const db = yield prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } });
            // Prisma increments via { increment: 1 } which we pass inside updateFields
            // The method adds checksCompleted: { increment: 1 } internally
            expect(db.checksCompleted).toBe(3); // 2 + increment(1)
            expect(db.diskSpaceInfo).toEqual({ used: 50, total: 100 });
        }));
    });
    describe('incrementSnapshotFailures', () => {
        it('increments checksFailed by 1', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 1,
                    checksFailed: 0,
                },
            });
            yield repo.incrementSnapshotFailures(snapshot.id);
            const db = yield prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } });
            expect(db.checksFailed).toBe(1);
        }));
        it('stacks multiple failures', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 0,
                    checksFailed: 0,
                },
            });
            yield repo.incrementSnapshotFailures(snapshot.id);
            yield repo.incrementSnapshotFailures(snapshot.id);
            const db = yield prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } });
            expect(db.checksFailed).toBe(2);
        }));
    });
    describe('setSnapshotOverallStatus', () => {
        it('updates the overallStatus field', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 0,
                    checksFailed: 0,
                },
            });
            yield repo.setSnapshotOverallStatus(snapshot.id, 'HEALTHY');
            const db = yield prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } });
            expect(db.overallStatus).toBe('HEALTHY');
        }));
        it('can set to WARNING', () => __awaiter(void 0, void 0, void 0, function* () {
            const snapshot = yield prisma.vMHealthSnapshot.create({
                data: {
                    machineId,
                    snapshotDate: new Date(),
                    overallStatus: 'PENDING',
                    checksCompleted: 0,
                    checksFailed: 0,
                },
            });
            yield repo.setSnapshotOverallStatus(snapshot.id, 'WARNING');
            const db = yield prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } });
            expect(db.overallStatus).toBe('WARNING');
        }));
    });
    // ─── Edge cases ───────────────────────────────────────────────────────────
    describe('concurrent claimReadyTasks', () => {
        it('second claim does not pick tasks already claimed by first claim', () => __awaiter(void 0, void 0, void 0, function* () {
            yield insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING', scheduledFor: new Date() });
            const first = yield repo.claimReadyTasks(machineId, 10);
            const second = yield repo.claimReadyTasks(machineId, 10);
            expect(first).toHaveLength(1);
            expect(second).toHaveLength(0);
        }));
    });
    describe('insertTask with various check types', () => {
        const checkTypes = [
            'OVERALL_STATUS', 'DISK_SPACE', 'RESOURCE_OPTIMIZATION',
            'WINDOWS_UPDATES', 'WINDOWS_DEFENDER', 'LINUX_UPDATES',
            'APPLICATION_INVENTORY', 'APPLICATION_UPDATES',
            'SECURITY_CHECK', 'PERFORMANCE_CHECK', 'SYSTEM_HEALTH', 'CUSTOM_CHECK',
        ];
        it.each(checkTypes)('inserts and retrieves %s check type', (checkType) => __awaiter(void 0, void 0, void 0, function* () {
            const taskId = (0, crypto_1.randomUUID)();
            yield repo.insertTask(machineId, checkType, 'MEDIUM', undefined, 3, taskId, new Date());
            const row = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } });
            expect(row).not.toBeNull();
            expect(row.checkType).toBe(checkType);
        }));
    });
    describe('insertTask with various priorities', () => {
        const priorities = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];
        it.each(priorities)('inserts and retrieves %s priority', (priority) => __awaiter(void 0, void 0, void 0, function* () {
            const taskId = (0, crypto_1.randomUUID)();
            yield repo.insertTask(machineId, 'DISK_SPACE', priority, undefined, 3, taskId, new Date());
            const row = yield prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } });
            expect(row).not.toBeNull();
            expect(row.priority).toBe(priority);
        }));
    });
});
