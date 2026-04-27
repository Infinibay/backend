"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const jest_mock_extended_1 = require("jest-mock-extended");
const VMMoveService_1 = require("../../../app/services/VMMoveService");
const infinization_1 = require("@infinibay/infinization");
const mock_factories_1 = require("../../setup/mock-factories");
// Create a configurable mock for InfinizationService
let mockGetVMStatusResult = { processAlive: true };
const logger_1 = __importDefault(require("@main/logger"));
// Set up mock module BEFORE it is used
jest.mock('../../../app/services/InfinizationService', () => ({
    __esModule: true,
    getInfinization: jest.fn(),
    initializeInfinization: jest.fn()
}));
// Import mocked module
const InfinizationService = __importStar(require("../../../app/services/InfinizationService"));
describe('VMMoveService', () => {
    let prisma;
    let firewallOrchestration;
    let moveService;
    let debugLogSpy;
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset mock VM status to running by default
        mockGetVMStatusResult = { processAlive: true };
        InfinizationService.getInfinization.mockResolvedValue({
            getVMStatus: jest.fn().mockImplementation(() => Promise.resolve(mockGetVMStatusResult)),
            getVMInfo: jest.fn().mockResolvedValue({}),
        });
        prisma = (0, jest_mock_extended_1.mockDeep)();
        firewallOrchestration = (0, jest_mock_extended_1.mockDeep)();
        moveService = new VMMoveService_1.VMMoveService(prisma, firewallOrchestration);
        debugLogSpy = jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
        jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
        jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        debugLogSpy.mockRestore();
    });
    describe('moveVMToDepartment', () => {
        const mockVM = (0, mock_factories_1.createMockMachine)({
            id: 'vm-123',
            name: 'Test VM',
            status: 'running',
            departmentId: 'dept-old',
            userId: 'user-123'
        });
        const mockConfig = (0, mock_factories_1.createMockMachineConfiguration)({
            id: 'config-123',
            machineId: 'vm-123',
            bridge: 'br-old',
            tapDeviceName: 'tap123',
            graphicProtocol: 'spice',
            graphicPort: 5900
        });
        const mockOldDept = (0, mock_factories_1.createMockDepartment)({
            id: 'dept-old',
            name: 'Old Department',
            bridgeName: 'br-old'
        });
        const mockNewDept = (0, mock_factories_1.createMockDepartment)({
            id: 'dept-new',
            name: 'New Department',
            bridgeName: 'br-new'
        });
        describe('successful moves', () => {
            it('should move a running VM with hot-swap when bridges differ', () => __awaiter(void 0, void 0, void 0, function* () {
                mockGetVMStatusResult = { processAlive: true };
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(mockNewDept);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockNewDept }));
                prisma.machine.update.mockResolvedValue(mockVM);
                prisma.machineConfiguration.update.mockResolvedValue(mockConfig);
                firewallOrchestration.applyVMRules.mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' });
                const tapDetachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'detachFromBridge').mockResolvedValue(undefined);
                const tapAttachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'attachToBridge').mockResolvedValue(undefined);
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(true);
                expect(result.hotSwapPerformed).toBe(true);
                expect(result.networkChanged).toBe(true);
                expect(result.firewallChanged).toBe(true);
                expect(prisma.machine.update).toHaveBeenCalledWith({
                    where: { id: 'vm-123' },
                    data: { departmentId: 'dept-new' }
                });
                expect(prisma.machineConfiguration.update).toHaveBeenCalledWith({
                    where: { id: 'config-123' },
                    data: { bridge: 'br-new' }
                });
                expect(infinization_1.TapDeviceManager.prototype.detachFromBridge).toHaveBeenCalledWith('tap123');
                expect(infinization_1.TapDeviceManager.prototype.attachToBridge).toHaveBeenCalledWith('tap123', 'br-new');
                expect(firewallOrchestration.applyVMRules).toHaveBeenCalledWith('vm-123');
                tapDetachSpy.mockRestore();
                tapAttachSpy.mockRestore();
            }));
            it('should update database only when VM is stopped', () => __awaiter(void 0, void 0, void 0, function* () {
                mockGetVMStatusResult = { processAlive: false };
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: Object.assign(Object.assign({}, mockConfig), { tapDeviceName: null }), department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(mockNewDept);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: Object.assign(Object.assign({}, mockConfig), { tapDeviceName: null }), department: mockNewDept }));
                prisma.machine.update.mockResolvedValue(mockVM);
                firewallOrchestration.applyVMRules.mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' });
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(true);
                expect(result.hotSwapPerformed).toBe(false);
                expect(result.networkChanged).toBe(false);
                expect(result.firewallChanged).toBe(false);
                expect(prisma.machine.update).toHaveBeenCalledWith({
                    where: { id: 'vm-123' },
                    data: { departmentId: 'dept-new' }
                });
            }));
            it('should move VM with no existing configuration', () => __awaiter(void 0, void 0, void 0, function* () {
                mockGetVMStatusResult = { processAlive: false };
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: null, department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(mockNewDept);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: null, department: mockNewDept }));
                prisma.machine.update.mockResolvedValue(mockVM);
                firewallOrchestration.applyVMRules.mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' });
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(true);
                expect(result.firewallChanged).toBe(false);
                expect(prisma.machineConfiguration.update).not.toHaveBeenCalled();
            }));
            it('should skip network change when bridges are the same', () => __awaiter(void 0, void 0, void 0, function* () {
                mockGetVMStatusResult = { processAlive: true };
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: Object.assign(Object.assign({}, mockOldDept), { bridgeName: 'br-same' }) }));
                prisma.department.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockNewDept), { bridgeName: 'br-same' }));
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: Object.assign(Object.assign({}, mockNewDept), { bridgeName: 'br-same' }) }));
                prisma.machine.update.mockResolvedValue(mockVM);
                firewallOrchestration.applyVMRules.mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' });
                const tapDetachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'detachFromBridge').mockImplementation();
                const tapAttachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'attachToBridge').mockImplementation();
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(true);
                expect(result.networkChanged).toBe(false);
                expect(infinization_1.TapDeviceManager.prototype.detachFromBridge).not.toHaveBeenCalled();
                expect(infinization_1.TapDeviceManager.prototype.attachToBridge).not.toHaveBeenCalled();
                tapDetachSpy.mockRestore();
                tapAttachSpy.mockRestore();
            }));
        });
        describe('error handling', () => {
            it('should return error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(null);
                const result = yield moveService.moveVMToDepartment('non-existent-vm', 'dept-new');
                expect(result.success).toBe(false);
                expect(result.error).toBe('VM not found');
                expect(result.hotSwapPerformed).toBe(false);
                expect(result.networkChanged).toBe(false);
                expect(result.firewallChanged).toBe(false);
                expect(prisma.machine.update).not.toHaveBeenCalled();
                expect(firewallOrchestration.applyVMRules).not.toHaveBeenCalled();
            }));
            it('should return error when target department not found', () => __awaiter(void 0, void 0, void 0, function* () {
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(null);
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-nonexistent');
                expect(result.success).toBe(false);
                expect(result.error).toBe('Target department not found');
                expect(prisma.machine.update).not.toHaveBeenCalled();
            }));
            it('should return error when target department has no network', () => __awaiter(void 0, void 0, void 0, function* () {
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                const deptWithoutNetwork = Object.assign(Object.assign({}, mockNewDept), { bridgeName: null });
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(deptWithoutNetwork);
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(false);
                expect(result.error).toBe('Target department has no network configured');
            }));
            it('should return error when VM has no department', () => __awaiter(void 0, void 0, void 0, function* () {
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                const vmNoDept = Object.assign(Object.assign({}, mockVM), { departmentId: null });
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, vmNoDept), { configuration: mockConfig, department: null }));
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(false);
                expect(result.error).toBe('VM has no department assigned');
            }));
            it('should continue with firewall rollback even if rollback fails', () => __awaiter(void 0, void 0, void 0, function* () {
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(mockNewDept);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockNewDept }));
                prisma.machine.update.mockRejectedValueOnce(new Error('Database error'));
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(false);
                expect(result.error).toBe('Database error');
            }));
            it('should not block move if firewall application fails', () => __awaiter(void 0, void 0, void 0, function* () {
                mockGetVMStatusResult = { processAlive: true };
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(mockNewDept);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockNewDept }));
                prisma.machine.update.mockResolvedValue(mockVM);
                prisma.machineConfiguration.update.mockResolvedValue(mockConfig);
                firewallOrchestration.applyVMRules.mockRejectedValueOnce(new Error('Firewall error'));
                const tapDetachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'detachFromBridge').mockResolvedValue(undefined);
                const tapAttachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'attachToBridge').mockResolvedValue(undefined);
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(true);
                expect(result.firewallChanged).toBe(false);
                expect(result.error).toBeUndefined();
                tapDetachSpy.mockRestore();
                tapAttachSpy.mockRestore();
            }));
        });
        describe('rollback behavior', () => {
            it('should rollback all changes when database update fails', () => __awaiter(void 0, void 0, void 0, function* () {
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                jest.spyOn(logger_1.default, 'error').mockImplementation(() => undefined);
                const originalVM = Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockOldDept });
                const updatedVM = Object.assign(Object.assign({}, mockVM), { department: mockNewDept });
                prisma.machine.findUnique.mockResolvedValueOnce(originalVM);
                prisma.department.findUnique.mockResolvedValueOnce(mockNewDept);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, originalVM), { department: mockNewDept }));
                prisma.machine.update
                    .mockResolvedValueOnce(originalVM)
                    .mockResolvedValueOnce(updatedVM);
                prisma.machineConfiguration.findFirst.mockResolvedValueOnce(mockConfig);
                prisma.machineConfiguration.update.mockResolvedValueOnce(mockConfig);
                firewallOrchestration.applyVMRules.mockResolvedValueOnce({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' });
                const tapAttachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'attachToBridge')
                    .mockRejectedValueOnce(new Error('Detach failed'));
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                expect(result.success).toBe(false);
                expect(infinization_1.TapDeviceManager.prototype.attachToBridge).toHaveBeenCalled();
                tapAttachSpy.mockRestore();
            }));
            it('should rollback network change if firewall fails', () => __awaiter(void 0, void 0, void 0, function* () {
                mockGetVMStatusResult = { processAlive: true };
                jest.spyOn(logger_1.default, 'info').mockImplementation(() => undefined);
                jest.spyOn(logger_1.default, 'warn').mockImplementation(() => undefined);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockOldDept }));
                prisma.department.findUnique.mockResolvedValueOnce(mockNewDept);
                prisma.machine.findUnique.mockResolvedValueOnce(Object.assign(Object.assign({}, mockVM), { configuration: mockConfig, department: mockNewDept }));
                prisma.machine.update.mockResolvedValue(mockVM);
                prisma.machineConfiguration.update.mockResolvedValue(mockConfig);
                const tapDetachSpy = jest.spyOn(infinization_1.TapDeviceManager.prototype, 'detachFromBridge')
                    .mockRejectedValueOnce(new Error('Detach failed'));
                const result = yield moveService.moveVMToDepartment('vm-123', 'dept-new');
                // Network change fails, error is the failure itself
                expect(result.success).toBe(false);
                expect(result.error).toBe('Detach failed');
                tapDetachSpy.mockRestore();
            }));
        });
    });
});
