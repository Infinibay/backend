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
// Unmock EventManager so we test the real implementation
const logger_1 = __importDefault(require("@main/logger"));
globals_1.jest.unmock('@services/EventManager');
const EventManager_1 = require("../../../app/services/EventManager");
// Mock SocketService
// Mock SocketService
class MockSocketService {
    constructor() {
        this.sendToUser = globals_1.jest.fn();
    }
}
(0, globals_1.describe)('EventManager', () => {
    let eventManager;
    let mockSocketService;
    let mockPrisma;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        mockSocketService = new MockSocketService();
        mockPrisma = {};
        eventManager = new EventManager_1.EventManager(mockSocketService, mockPrisma);
    });
    (0, globals_1.describe)('constructor', () => {
        (0, globals_1.it)('should initialize with socket service and prisma', () => {
            (0, globals_1.expect)(eventManager).toBeDefined();
            (0, globals_1.expect)(eventManager.socketService).toBe(mockSocketService);
            (0, globals_1.expect)(eventManager.prisma).toBe(mockPrisma);
        });
    });
    (0, globals_1.describe)('registerResourceManager', () => {
        (0, globals_1.it)('should register a new resource manager', () => {
            const mockManager = {
                handleEvent: globals_1.jest.fn()
            };
            eventManager.registerResourceManager('vms', mockManager);
            (0, globals_1.expect)(mockSocketService.sendToUser).not.toHaveBeenCalled();
        });
        (0, globals_1.it)('should overwrite existing manager for same resource', () => {
            const manager1 = { handleEvent: globals_1.jest.fn() };
            const manager2 = { handleEvent: globals_1.jest.fn() };
            eventManager.registerResourceManager('vms', manager1);
            eventManager.registerResourceManager('vms', manager2);
            const registeredManager = eventManager.resourceManagers.get('vms');
            (0, globals_1.expect)(registeredManager).toBe(manager2);
        });
    });
    (0, globals_1.describe)('dispatchEvent', () => {
        const mockData = {
            id: 'vm-123',
            name: 'test-vm',
            status: 'running'
        };
        (0, globals_1.it)('should dispatch event to registered manager', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockManager = {
                handleEvent: globals_1.jest.fn().mockResolvedValue(undefined)
            };
            eventManager.registerResourceManager('vms', mockManager);
            yield eventManager.dispatchEvent('vms', 'create', mockData, 'user-123');
            (0, globals_1.expect)(mockManager.handleEvent).toHaveBeenCalledWith('create', mockData, 'user-123');
        }));
        (0, globals_1.it)('should log warning when no manager registered', () => __awaiter(void 0, void 0, void 0, function* () {
            const consoleSpy = globals_1.jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
            yield eventManager.dispatchEvent('vms', 'create', mockData, 'user-123');
            (0, globals_1.expect)(consoleSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('No event manager found for resource: vms'));
            consoleSpy.mockRestore();
        }));
        (0, globals_1.it)('should send error event when dispatch fails', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockManager = {
                handleEvent: globals_1.jest.fn().mockRejectedValue(new Error('Dispatch failed'))
            };
            eventManager.registerResourceManager('vms', mockManager);
            yield eventManager.dispatchEvent('vms', 'create', mockData, 'user-123');
            (0, globals_1.expect)(mockSocketService.sendToUser).toHaveBeenCalledWith('user-123', 'vms', 'create', globals_1.expect.objectContaining({
                status: 'error',
                error: 'Dispatch failed'
            }));
        }));
        (0, globals_1.it)('should handle missing triggeredBy parameter', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockManager = {
                handleEvent: globals_1.jest.fn().mockResolvedValue(undefined)
            };
            eventManager.registerResourceManager('vms', mockManager);
            yield eventManager.dispatchEvent('vms', 'create', mockData, undefined);
            (0, globals_1.expect)(mockSocketService.sendToUser).not.toHaveBeenCalled();
        }));
    });
    (0, globals_1.describe)('VM Event Helpers', () => {
        (0, globals_1.beforeEach)(() => {
            const mockManager = { handleEvent: globals_1.jest.fn().mockResolvedValue(undefined) };
            eventManager.registerResourceManager('vms', mockManager);
        });
        (0, globals_1.describe)('vmCreated', () => {
            (0, globals_1.it)('should dispatch create event for VM', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockManager = eventManager.resourceManagers.get('vms');
                const vmData = { id: 'vm-123', name: 'test-vm' };
                yield eventManager.vmCreated(vmData);
                (0, globals_1.expect)(mockManager.handleEvent).toHaveBeenCalledWith('create', vmData, undefined);
            }));
        });
        (0, globals_1.describe)('vmUpdated', () => {
            (0, globals_1.it)('should dispatch update event for VM', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockManager = eventManager.resourceManagers.get('vms');
                const vmData = { id: 'vm-123', name: 'updated-vm' };
                yield eventManager.vmUpdated(vmData);
                (0, globals_1.expect)(mockManager.handleEvent).toHaveBeenCalledWith('update', vmData, undefined);
            }));
        });
        (0, globals_1.describe)('vmDeleted', () => {
            (0, globals_1.it)('should dispatch delete event for VM', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockManager = eventManager.resourceManagers.get('vms');
                const vmData = { id: 'vm-123', name: 'deleted-vm' };
                yield eventManager.vmDeleted(vmData);
                (0, globals_1.expect)(mockManager.handleEvent).toHaveBeenCalledWith('delete', vmData, undefined);
            }));
        });
        (0, globals_1.describe)('vmPowerOn', () => {
            (0, globals_1.it)('should dispatch power_on event for VM', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockManager = eventManager.resourceManagers.get('vms');
                const vmData = { id: 'vm-123', status: 'running' };
                yield eventManager.vmPowerOn(vmData);
                (0, globals_1.expect)(mockManager.handleEvent).toHaveBeenCalledWith('power_on', vmData, undefined);
            }));
        });
        (0, globals_1.describe)('vmPowerOff', () => {
            (0, globals_1.it)('should dispatch power_off event for VM', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockManager = eventManager.resourceManagers.get('vms');
                const vmData = { id: 'vm-123', status: 'stopped' };
                yield eventManager.vmPowerOff(vmData);
                (0, globals_1.expect)(mockManager.handleEvent).toHaveBeenCalledWith('power_off', vmData, undefined);
            }));
        });
    });
    (0, globals_1.describe)('edge cases', () => {
        (0, globals_1.it)('should handle empty event data', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockManager = { handleEvent: globals_1.jest.fn().mockResolvedValue(undefined) };
            eventManager.registerResourceManager('vms', mockManager);
            yield (0, globals_1.expect)(eventManager.dispatchEvent('vms', 'create', {}, 'user-123')).resolves.toBeUndefined();
        }));
        (0, globals_1.it)('should handle null event data', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockManager = { handleEvent: globals_1.jest.fn().mockResolvedValue(undefined) };
            eventManager.registerResourceManager('vms', mockManager);
            yield (0, globals_1.expect)(eventManager.dispatchEvent('vms', 'create', null, 'user-123')).resolves.toBeUndefined();
        }));
        (0, globals_1.it)('should handle exception in manager handleEvent', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockManager = {
                handleEvent: globals_1.jest.fn().mockRejectedValue(new Error('Test error'))
            };
            eventManager.registerResourceManager('vms', mockManager);
            yield eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123');
            (0, globals_1.expect)(mockSocketService.sendToUser).toHaveBeenCalledWith('user-123', 'vms', 'create', globals_1.expect.objectContaining({
                status: 'error',
                error: 'Test error'
            }));
        }));
        (0, globals_1.it)('should handle non-Error exceptions', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockManager = {
                handleEvent: globals_1.jest.fn().mockRejectedValue('String error')
            };
            eventManager.registerResourceManager('vms', mockManager);
            yield eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123');
            // Non-Error exceptions result in 'Unknown error occurred' message
            (0, globals_1.expect)(mockSocketService.sendToUser).toHaveBeenCalledWith('user-123', 'vms', 'create', globals_1.expect.objectContaining({
                status: 'error',
                error: 'Unknown error occurred'
            }));
        }));
    });
    (0, globals_1.describe)('console logging', () => {
        (0, globals_1.it)('should log event dispatching', () => __awaiter(void 0, void 0, void 0, function* () {
            const logSpy = globals_1.jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
            const mockMgr = { handleEvent: globals_1.jest.fn().mockResolvedValue(undefined) };
            eventManager.registerResourceManager('vms', mockMgr);
            yield eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (0, globals_1.expect)(logSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('Dispatching event'), globals_1.expect.objectContaining({
                dataId: 'vm-123',
                triggeredBy: 'user-123'
            }));
            logSpy.mockRestore();
        }));
        (0, globals_1.it)('should log successful dispatch', () => __awaiter(void 0, void 0, void 0, function* () {
            const logSpy2 = globals_1.jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
            const mockMgr2 = { handleEvent: globals_1.jest.fn().mockResolvedValue(undefined) };
            eventManager.registerResourceManager('vms', mockMgr2);
            yield eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (0, globals_1.expect)(logSpy2).toHaveBeenCalledWith(globals_1.expect.stringContaining('Event dispatched successfully'));
            logSpy2.mockRestore();
        }));
        (0, globals_1.it)('should log dispatch errors', () => __awaiter(void 0, void 0, void 0, function* () {
            const errSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            const mockMgr3 = { handleEvent: globals_1.jest.fn().mockRejectedValue(new Error('Test error')) };
            eventManager.registerResourceManager('vms', mockMgr3);
            yield eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123');
            (0, globals_1.expect)(errSpy).toHaveBeenCalledWith(globals_1.expect.stringContaining('Error dispatching event'), globals_1.expect.any(Error));
            errSpy.mockRestore();
        }));
    });
    (0, globals_1.describe)('event actions', () => {
        (0, globals_1.it)('should support all defined event actions', () => __awaiter(void 0, void 0, void 0, function* () {
            const actions = [
                'create', 'update', 'delete', 'power_on', 'power_off',
                'suspend', 'resume', 'crash', 'registered', 'removed',
                'validated', 'progress', 'status_changed', 'health_check',
                'health_status_change', 'remediation', 'autocheck_issue_detected',
                'autocheck_remediation_available', 'autocheck_remediation_completed',
                'round_started', 'round_completed', 'round_failed',
                'task_started', 'task_completed', 'task_failed',
                'maintenance_completed', 'maintenance_failed',
                'started', 'completed', 'failed'
            ];
            actions.forEach(action => {
                const mockManager = { handleEvent: globals_1.jest.fn().mockResolvedValue(undefined) };
                eventManager.registerResourceManager('vms', mockManager);
                eventManager.dispatchEvent('vms', action, { id: 'vm-123' }, 'user-123');
                // Reset for next iteration
                const resourceManagers = eventManager.resourceManagers;
                resourceManagers.clear();
            });
        }));
    });
});
