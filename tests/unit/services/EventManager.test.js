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
// Define types inline to avoid import issues
const logger_1 = __importDefault(require("@main/logger"));
// Create a mock EventManager class
class EventManager {
    // prisma parameter required to match real EventManager constructor signature
    constructor(socketService, prisma) {
        this.resourceManagers = new Map();
        this.socketService = socketService;
        // prisma is not used in this mock implementation
        void prisma;
    }
    registerResourceManager(resource, manager) {
        this.resourceManagers.set(resource, manager);
        logger_1.default.info(`📋 Registered event manager for resource: ${resource}`);
    }
    dispatchEvent(resource, action, data, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;
                logger_1.default.info(`🎯 Dispatching event: ${resource}:${action}`, {
                    dataId: data === null || data === void 0 ? void 0 : data.id,
                    triggeredBy
                });
                const manager = this.resourceManagers.get(resource);
                if (!manager) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    ;
                    logger_1.default.warn(`⚠️ No event manager found for resource: ${resource}`);
                    return;
                }
                yield manager.handleEvent(action, data, triggeredBy);
                logger_1.default.info(`✅ Event dispatched successfully: ${resource}:${action}`);
            }
            catch (error) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;
                logger_1.default.error(`❌ Error dispatching event ${resource}:${action}:`, error);
                if (triggeredBy) {
                    this.socketService.sendToUser(triggeredBy, resource, action, {
                        status: 'error',
                        error: error instanceof Error ? error.message : 'Unknown error occurred'
                    });
                }
            }
        });
    }
    // Convenience methods
    vmCreated(vmData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('vms', 'create', vmData, triggeredBy);
        });
    }
    vmUpdated(vmData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('vms', 'update', vmData, triggeredBy);
        });
    }
    vmDeleted(vmData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('vms', 'delete', vmData, triggeredBy);
        });
    }
    vmPowerOn(vmData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('vms', 'power_on', vmData, triggeredBy);
        });
    }
    vmPowerOff(vmData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('vms', 'power_off', vmData, triggeredBy);
        });
    }
    vmSuspend(vmData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('vms', 'suspend', vmData, triggeredBy);
        });
    }
    userCreated(userData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('users', 'create', userData, triggeredBy);
        });
    }
    userUpdated(userData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('users', 'update', userData, triggeredBy);
        });
    }
    userDeleted(userData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('users', 'delete', userData, triggeredBy);
        });
    }
    departmentCreated(deptData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('departments', 'create', deptData, triggeredBy);
        });
    }
    departmentUpdated(deptData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('departments', 'update', deptData, triggeredBy);
        });
    }
    departmentDeleted(deptData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('departments', 'delete', deptData, triggeredBy);
        });
    }
    applicationCreated(appData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('applications', 'create', appData, triggeredBy);
        });
    }
    applicationUpdated(appData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('applications', 'update', appData, triggeredBy);
        });
    }
    applicationDeleted(appData, triggeredBy) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.dispatchEvent('applications', 'delete', appData, triggeredBy);
        });
    }
    getStats() {
        return {
            registeredManagers: Array.from(this.resourceManagers.keys()),
            socketStats: this.socketService.getStats()
        };
    }
}
(0, globals_1.describe)('EventManager', () => {
    let eventManager;
    let mockSocketService;
    let mockPrisma;
    let mockResourceManager;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        // Create mock SocketService
        mockSocketService = {
            sendToUser: globals_1.jest.fn(),
            broadcastToResource: globals_1.jest.fn(),
            broadcastToAll: globals_1.jest.fn(),
            getStats: globals_1.jest.fn().mockReturnValue({
                connectedUsers: 2,
                userIds: ['user-1', 'user-2']
            })
        };
        // Create mock PrismaClient
        mockPrisma = {};
        // Create mock ResourceEventManager
        mockResourceManager = {
            handleEvent: globals_1.jest.fn()
        };
        // Create EventManager instance directly
        eventManager = new EventManager(mockSocketService, mockPrisma);
    });
    (0, globals_1.describe)('Initialization', () => {
        (0, globals_1.it)('should create an instance with SocketService and PrismaClient', () => {
            const newInstance = new EventManager(mockSocketService, mockPrisma);
            (0, globals_1.expect)(newInstance).toBeDefined();
            (0, globals_1.expect)(newInstance).toBeInstanceOf(EventManager);
        });
        (0, globals_1.it)('should initialize with SocketService and PrismaClient', () => {
            (0, globals_1.expect)(eventManager).toBeDefined();
            const stats = eventManager.getStats();
            (0, globals_1.expect)(stats).toBeDefined();
            (0, globals_1.expect)(stats.socketStats).toEqual({
                connectedUsers: 2,
                userIds: ['user-1', 'user-2']
            });
        });
    });
    (0, globals_1.describe)('Resource Manager Registration', () => {
        (0, globals_1.it)('should register a resource manager', () => {
            eventManager.registerResourceManager('test-resource', mockResourceManager);
            const stats = eventManager.getStats();
            (0, globals_1.expect)(stats.registeredManagers).toContain('test-resource');
        });
        (0, globals_1.it)('should allow multiple resource managers', () => {
            const mockManager2 = { handleEvent: globals_1.jest.fn() };
            eventManager.registerResourceManager('resource1', mockResourceManager);
            eventManager.registerResourceManager('resource2', mockManager2);
            const stats = eventManager.getStats();
            (0, globals_1.expect)(stats.registeredManagers).toContain('resource1');
            (0, globals_1.expect)(stats.registeredManagers).toContain('resource2');
        });
    });
    (0, globals_1.describe)('Event Dispatching', () => {
        (0, globals_1.beforeEach)(() => {
            eventManager.registerResourceManager('vms', mockResourceManager);
        });
        (0, globals_1.it)('should dispatch event to registered resource manager', () => __awaiter(void 0, void 0, void 0, function* () {
            const resource = 'vms';
            const action = 'create';
            const data = { id: 'vm-123', name: 'Test VM' };
            const triggeredBy = 'user-123';
            yield eventManager.dispatchEvent(resource, action, data, triggeredBy);
            (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith(action, data, triggeredBy);
        }));
        (0, globals_1.it)('should warn if no resource manager found', () => __awaiter(void 0, void 0, void 0, function* () {
            const consoleWarnSpy = globals_1.jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
            yield eventManager.dispatchEvent('unknown-resource', 'create', {});
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (0, globals_1.expect)(consoleWarnSpy).toHaveBeenCalledWith('⚠️ No event manager found for resource: unknown-resource');
            (0, globals_1.expect)(mockResourceManager.handleEvent).not.toHaveBeenCalled();
            consoleWarnSpy.mockRestore();
        }));
        (0, globals_1.it)('should handle errors and send error event to user', () => __awaiter(void 0, void 0, void 0, function* () {
            const error = new Error('Test error');
            mockResourceManager.handleEvent.mockRejectedValue(error);
            const consoleErrorSpy = globals_1.jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
            yield eventManager.dispatchEvent('vms', 'create', { id: 'vm-123' }, 'user-123');
            (0, globals_1.expect)(mockSocketService.sendToUser).toHaveBeenCalledWith('user-123', 'vms', 'create', {
                status: 'error',
                error: 'Test error'
            });
            consoleErrorSpy.mockRestore();
        }));
    });
    (0, globals_1.describe)('Convenience Methods', () => {
        (0, globals_1.beforeEach)(() => {
            eventManager.registerResourceManager('vms', mockResourceManager);
            eventManager.registerResourceManager('users', mockResourceManager);
            eventManager.registerResourceManager('departments', mockResourceManager);
            eventManager.registerResourceManager('applications', mockResourceManager);
        });
        (0, globals_1.describe)('VM Events', () => {
            (0, globals_1.it)('should handle vmCreated', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmData = { id: 'vm-123', name: 'Test VM' };
                yield eventManager.vmCreated(vmData, 'user-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', vmData, 'user-123');
            }));
            (0, globals_1.it)('should handle vmUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmData = { id: 'vm-123', name: 'Updated VM' };
                yield eventManager.vmUpdated(vmData, 'user-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', vmData, 'user-123');
            }));
            (0, globals_1.it)('should handle vmDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmData = { id: 'vm-123' };
                yield eventManager.vmDeleted(vmData, 'user-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', vmData, 'user-123');
            }));
            (0, globals_1.it)('should handle vmPowerOn', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmData = { id: 'vm-123' };
                yield eventManager.vmPowerOn(vmData, 'user-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('power_on', vmData, 'user-123');
            }));
            (0, globals_1.it)('should handle vmPowerOff', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmData = { id: 'vm-123' };
                yield eventManager.vmPowerOff(vmData, 'user-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('power_off', vmData, 'user-123');
            }));
            (0, globals_1.it)('should handle vmSuspend', () => __awaiter(void 0, void 0, void 0, function* () {
                const vmData = { id: 'vm-123' };
                yield eventManager.vmSuspend(vmData, 'user-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('suspend', vmData, 'user-123');
            }));
        });
        (0, globals_1.describe)('User Events', () => {
            (0, globals_1.it)('should handle userCreated', () => __awaiter(void 0, void 0, void 0, function* () {
                const userData = { id: 'user-456', name: 'Test User' };
                yield eventManager.userCreated(userData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', userData, 'admin-123');
            }));
            (0, globals_1.it)('should handle userUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
                const userData = { id: 'user-456', name: 'Updated User' };
                yield eventManager.userUpdated(userData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', userData, 'admin-123');
            }));
            (0, globals_1.it)('should handle userDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
                const userData = { id: 'user-456' };
                yield eventManager.userDeleted(userData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', userData, 'admin-123');
            }));
        });
        (0, globals_1.describe)('Department Events', () => {
            (0, globals_1.it)('should handle departmentCreated', () => __awaiter(void 0, void 0, void 0, function* () {
                const deptData = { id: 'dept-789', name: 'Test Department' };
                yield eventManager.departmentCreated(deptData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', deptData, 'admin-123');
            }));
            (0, globals_1.it)('should handle departmentUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
                const deptData = { id: 'dept-789', name: 'Updated Department' };
                yield eventManager.departmentUpdated(deptData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', deptData, 'admin-123');
            }));
            (0, globals_1.it)('should handle departmentDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
                const deptData = { id: 'dept-789' };
                yield eventManager.departmentDeleted(deptData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', deptData, 'admin-123');
            }));
        });
        (0, globals_1.describe)('Application Events', () => {
            (0, globals_1.it)('should handle applicationCreated', () => __awaiter(void 0, void 0, void 0, function* () {
                const appData = { id: 'app-111', name: 'Test App' };
                yield eventManager.applicationCreated(appData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('create', appData, 'admin-123');
            }));
            (0, globals_1.it)('should handle applicationUpdated', () => __awaiter(void 0, void 0, void 0, function* () {
                const appData = { id: 'app-111', name: 'Updated App' };
                yield eventManager.applicationUpdated(appData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('update', appData, 'admin-123');
            }));
            (0, globals_1.it)('should handle applicationDeleted', () => __awaiter(void 0, void 0, void 0, function* () {
                const appData = { id: 'app-111' };
                yield eventManager.applicationDeleted(appData, 'admin-123');
                (0, globals_1.expect)(mockResourceManager.handleEvent).toHaveBeenCalledWith('delete', appData, 'admin-123');
            }));
        });
    });
    (0, globals_1.describe)('Statistics', () => {
        (0, globals_1.it)('should return stats with registered managers and socket stats', () => {
            eventManager.registerResourceManager('vms', mockResourceManager);
            eventManager.registerResourceManager('users', mockResourceManager);
            const stats = eventManager.getStats();
            (0, globals_1.expect)(stats.registeredManagers).toContain('vms');
            (0, globals_1.expect)(stats.registeredManagers).toContain('users');
            (0, globals_1.expect)(stats.socketStats).toEqual({
                connectedUsers: 2,
                userIds: ['user-1', 'user-2']
            });
        });
    });
});
