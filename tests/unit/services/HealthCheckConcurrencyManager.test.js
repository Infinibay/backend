"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const globals_1 = require("@jest/globals");
const HealthCheckConcurrencyManager_1 = require("../../../app/services/HealthCheckConcurrencyManager");
const client_1 = require("@prisma/client");
const { OVERALL_STATUS, DISK_SPACE, RESOURCE_OPTIMIZATION, WINDOWS_UPDATES, WINDOWS_DEFENDER, LINUX_UPDATES, APPLICATION_INVENTORY, APPLICATION_UPDATES, SECURITY_CHECK, PERFORMANCE_CHECK, SYSTEM_HEALTH, CUSTOM_CHECK } = client_1.HealthCheckType;
(0, globals_1.describe)('HealthCheckConcurrencyManager', () => {
    let manager;
    const defaultLimits = {
        maxConcurrentPerVm: 2,
        maxHeavyChecksPerVm: 1,
        maxSystemWide: 50,
        heavyCheckTypes: ['OVERALL_STATUS', 'RESOURCE_OPTIMIZATION', 'WINDOWS_DEFENDER', 'WINDOWS_UPDATES', 'LINUX_UPDATES'],
    };
    (0, globals_1.beforeEach)(() => {
        manager = new HealthCheckConcurrencyManager_1.HealthCheckConcurrencyManager(defaultLimits);
    });
    (0, globals_1.describe)('canExecute', () => {
        (0, globals_1.it)('should allow execution when no checks are running', () => {
            const result = manager.canExecute('vm-1', 'OVERALL_STATUS');
            (0, globals_1.expect)(result.allowed).toBe(true);
            (0, globals_1.expect)(result.reason).toBeUndefined();
        });
        (0, globals_1.it)('should allow non-heavy checks when heavy limit is reached for a VM', () => {
            manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS');
            // Heavy check should be blocked
            const heavyResult = manager.canExecute('vm-1', 'RESOURCE_OPTIMIZATION');
            (0, globals_1.expect)(heavyResult.allowed).toBe(false);
            (0, globals_1.expect)(heavyResult.reason).toContain('heavy-check limit reached');
            // Non-heavy check should still be allowed
            const lightResult = manager.canExecute('vm-1', 'DISK_SPACE');
            (0, globals_1.expect)(lightResult.allowed).toBe(true);
        });
        (0, globals_1.it)('should block heavy checks when maxHeavyChecksPerVm is reached', () => {
            manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS');
            const result = manager.canExecute('vm-1', 'WINDOWS_DEFENDER');
            (0, globals_1.expect)(result.allowed).toBe(false);
            (0, globals_1.expect)(result.reason).toContain('heavy-check limit reached');
        });
        (0, globals_1.it)('should allow a second heavy check for a different VM', () => {
            manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS');
            const result = manager.canExecute('vm-2', 'RESOURCE_OPTIMIZATION');
            (0, globals_1.expect)(result.allowed).toBe(true);
        });
        (0, globals_1.it)('should block when maxConcurrentPerVm is reached', () => {
            manager.markRunning('task-1', 'vm-1', DISK_SPACE);
            manager.markRunning('task-2', 'vm-1', RESOURCE_OPTIMIZATION);
            const result = manager.canExecute('vm-1', DISK_SPACE);
            (0, globals_1.expect)(result.allowed).toBe(false);
            (0, globals_1.expect)(result.reason).toContain('concurrent limit reached');
        });
        (0, globals_1.it)('should allow checks for a different VM when one VM is at limit', () => {
            manager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            manager.markRunning('task-2', 'vm-1', DISK_SPACE);
            const result = manager.canExecute('vm-2', RESOURCE_OPTIMIZATION);
            (0, globals_1.expect)(result.allowed).toBe(true);
        });
        (0, globals_1.it)('should block when maxSystemWide is reached', () => {
            const customLimits = Object.assign(Object.assign({}, defaultLimits), { maxSystemWide: 2 });
            const customManager = new HealthCheckConcurrencyManager_1.HealthCheckConcurrencyManager(customLimits);
            customManager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            customManager.markRunning('task-2', 'vm-2', DISK_SPACE);
            const result = customManager.canExecute('vm-3', RESOURCE_OPTIMIZATION);
            (0, globals_1.expect)(result.reason).toContain('System-wide concurrent limit reached');
        });
        (0, globals_1.it)('should not count completed tasks toward limits', () => {
            manager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            manager.markDone('task-1', 'vm-1');
            const result = manager.canExecute('vm-1', DISK_SPACE);
            (0, globals_1.expect)(result.allowed).toBe(true);
        });
        (0, globals_1.it)('should handle mixed heavy and light checks correctly', () => {
            manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS'); // heavy
            // Should allow one more light check (maxConcurrentPerVm=2, 1 slot left)
            const result = manager.canExecute('vm-1', SECURITY_CHECK);
            (0, globals_1.expect)(result.allowed).toBe(true);
            // But not another heavy check (maxHeavyChecksPerVm=1)
            const heavyResult = manager.canExecute('vm-1', RESOURCE_OPTIMIZATION);
            (0, globals_1.expect)(heavyResult.allowed).toBe(false);
            (0, globals_1.expect)(heavyResult.reason).toContain('heavy-check limit reached');
        });
    });
    (0, globals_1.describe)('markRunning / markDone', () => {
        (0, globals_1.it)('should track running tasks', () => {
            (0, globals_1.expect)(manager.getActiveCount()).toBe(0);
            manager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            (0, globals_1.expect)(manager.getActiveCount()).toBe(1);
            manager.markRunning('task-2', 'vm-1', DISK_SPACE);
            (0, globals_1.expect)(manager.getActiveCount()).toBe(2);
        });
        (0, globals_1.it)('should remove tasks when marked done', () => {
            manager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            manager.markRunning('task-2', 'vm-2', DISK_SPACE);
            (0, globals_1.expect)(manager.getActiveCount()).toBe(2);
            manager.markDone('task-1', 'vm-1');
            (0, globals_1.expect)(manager.getActiveCount()).toBe(1);
            manager.markDone('task-2', 'vm-2');
            (0, globals_1.expect)(manager.getActiveCount()).toBe(0);
        });
        (0, globals_1.it)('should not double-remove tasks', () => {
            manager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            manager.markDone('task-1', 'vm-1');
            manager.markDone('task-1', 'vm-1'); // Should not throw
            (0, globals_1.expect)(manager.getActiveCount()).toBe(0);
        });
    });
    (0, globals_1.describe)('getVmActiveCount', () => {
        (0, globals_1.it)('should return correct count per VM', () => {
            manager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            manager.markRunning('task-2', 'vm-1', DISK_SPACE);
            manager.markRunning('task-3', 'vm-2', SECURITY_CHECK);
            (0, globals_1.expect)(manager.getVmActiveCount('vm-1')).toBe(2);
            (0, globals_1.expect)(manager.getVmActiveCount('vm-2')).toBe(1);
            (0, globals_1.expect)(manager.getVmActiveCount('vm-3')).toBe(0);
        });
    });
    (0, globals_1.describe)('getActiveTaskIds', () => {
        (0, globals_1.it)('should return all active task keys', () => {
            manager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            manager.markRunning('task-2', 'vm-2', DISK_SPACE);
            const taskIds = manager.getActiveTaskIds();
            (0, globals_1.expect)(taskIds).toContain('vm-1_task-1');
            (0, globals_1.expect)(taskIds).toContain('vm-2_task-2');
            (0, globals_1.expect)(taskIds).toHaveLength(2);
        });
        (0, globals_1.it)('should return empty array when no tasks are running', () => {
            const taskIds = manager.getActiveTaskIds();
            (0, globals_1.expect)(taskIds).toEqual([]);
        });
    });
    (0, globals_1.describe)('custom limits', () => {
        (0, globals_1.it)('should respect custom maxConcurrentPerVm', () => {
            const customLimits = Object.assign(Object.assign({}, defaultLimits), { maxConcurrentPerVm: 1 });
            const customManager = new HealthCheckConcurrencyManager_1.HealthCheckConcurrencyManager(customLimits);
            customManager.markRunning('task-1', 'vm-1', 'DISK_SPACE');
            const result = customManager.canExecute('vm-1', DISK_SPACE);
            (0, globals_1.expect)(result.allowed).toBe(false);
            (0, globals_1.expect)(result.reason).toContain('concurrent limit reached');
        });
        (0, globals_1.it)('should respect custom maxHeavyChecksPerVm', () => {
            const customLimits = Object.assign(Object.assign({}, defaultLimits), { maxHeavyChecksPerVm: 0 });
            const customManager = new HealthCheckConcurrencyManager_1.HealthCheckConcurrencyManager(customLimits);
            const result = customManager.canExecute('vm-1', 'OVERALL_STATUS');
            (0, globals_1.expect)(result.allowed).toBe(false);
            (0, globals_1.expect)(result.reason).toContain('heavy-check limit reached');
        });
        (0, globals_1.it)('should allow overriding heavyCheckTypes', () => {
            const customLimits = Object.assign(Object.assign({}, defaultLimits), { heavyCheckTypes: ['OVERALL_STATUS'] });
            const customManager = new HealthCheckConcurrencyManager_1.HealthCheckConcurrencyManager(customLimits);
            customManager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS');
            // RESOURCE_OPTIMIZATION is no longer heavy
            const result = customManager.canExecute('vm-1', 'RESOURCE_OPTIMIZATION');
            (0, globals_1.expect)(result.allowed).toBe(true);
        });
    });
    (0, globals_1.describe)('edge cases', () => {
        (0, globals_1.it)('should handle empty machineId', () => {
            manager.markRunning('task-1', '', 'DISK_SPACE');
            (0, globals_1.expect)(manager.getActiveCount()).toBe(1);
            (0, globals_1.expect)(manager.getVmActiveCount('')).toBe(1);
        });
        (0, globals_1.it)('should handle unknown check types', () => {
            const result = manager.canExecute('vm-1', 'UNKNOWN_CHECK');
            (0, globals_1.expect)(result.allowed).toBe(true);
        });
        (0, globals_1.it)('should not count tasks for wrong machineId after markDone', () => {
            manager.markRunning('task-1', 'vm-1', DISK_SPACE);
            manager.markDone('task-1', 'vm-2'); // Wrong machineId
            // Task should still be active because key doesn't match
            (0, globals_1.expect)(manager.getActiveCount()).toBe(1);
            (0, globals_1.expect)(manager.getVmActiveCount('vm-1')).toBe(1);
            (0, globals_1.expect)(manager.getVmActiveCount('vm-2')).toBe(0);
        });
    });
});
