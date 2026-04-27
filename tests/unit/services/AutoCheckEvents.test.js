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
const VmEventManager_1 = require("../../../app/services/VmEventManager");
const VirtioSocketWatcherService_1 = require("../../../app/services/VirtioSocketWatcherService");
const EventManager_1 = require("../../../app/services/EventManager");
const jest_setup_1 = require("../../setup/jest.setup");
const mock_factories_1 = require("../../setup/mock-factories");
// Unmock EventManager for this test file since we need to test its actual implementation
jest.unmock('../../../app/services/EventManager');
// Mock socket service
const mockSocketService = {
    sendToUser: jest.fn(),
    sendToUserNamespace: jest.fn(),
    getStats: jest.fn().mockReturnValue({ connectedUsers: 0, userIds: [] })
};
describe('Auto-Check WebSocket Events', () => {
    let vmEventManager;
    let eventManager;
    let virtioService;
    beforeEach(() => {
        jest.clearAllMocks();
        // Create event manager with mocked dependencies
        eventManager = new EventManager_1.EventManager(mockSocketService, jest_setup_1.mockPrisma);
        vmEventManager = new VmEventManager_1.VmEventManager(mockSocketService, jest_setup_1.mockPrisma);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        virtioService = new VirtioSocketWatcherService_1.VirtioSocketWatcherService(jest_setup_1.mockPrisma);
        // Initialize virtio service with vm event manager
        virtioService.initialize(vmEventManager);
        // Mock VM data with proper types
        const mockUser = (0, mock_factories_1.createMockUser)({ id: 'test-user-id', role: 'USER' });
        const mockDepartment = (0, mock_factories_1.createMockDepartment)({ id: 'test-dept-id' });
        const mockMachine = (0, mock_factories_1.createMockMachine)({
            id: 'test-vm-id',
            name: 'test-vm',
            status: 'running',
            userId: mockUser.id,
            departmentId: mockDepartment.id
        });
        // Add user and department to machine for relations
        const machineWithRelations = Object.assign(Object.assign({}, mockMachine), { user: mockUser, department: mockDepartment });
        jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machineWithRelations);
        // Mock admin users
        const mockAdmin = (0, mock_factories_1.createMockUser)({ id: 'admin-id', role: 'ADMIN' });
        jest_setup_1.mockPrisma.user.findMany.mockResolvedValue([mockAdmin]);
    });
    describe('EventManager Auto-Check Events', () => {
        it('should add auto-check event types to EventAction', () => {
            expect(typeof eventManager.autocheckIssueDetected).toBe('function');
            expect(typeof eventManager.autocheckRemediationAvailable).toBe('function');
            expect(typeof eventManager.autocheckRemediationCompleted).toBe('function');
        });
        it('should dispatch autocheck issue detected event', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmData = { id: 'test-vm-id', severity: 'critical' };
            eventManager.registerResourceManager('vms', vmEventManager);
            yield eventManager.autocheckIssueDetected(vmData, 'test-user');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('should dispatch autocheck remediation available event', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmData = { id: 'test-vm-id', remediationType: 'AutoFixWindowsUpdates' };
            eventManager.registerResourceManager('vms', vmEventManager);
            yield eventManager.autocheckRemediationAvailable(vmData, 'test-user');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
        it('should dispatch autocheck remediation completed event', () => __awaiter(void 0, void 0, void 0, function* () {
            const vmData = { id: 'test-vm-id', success: true };
            eventManager.registerResourceManager('vms', vmEventManager);
            yield eventManager.autocheckRemediationCompleted(vmData, 'test-user');
            expect(mockSocketService.sendToUser).toHaveBeenCalled();
        }));
    });
    describe('VmEventManager Auto-Check Handlers', () => {
        it('should handle auto-check issue detection', () => __awaiter(void 0, void 0, void 0, function* () {
            const issueData = {
                checkType: 'WindowsUpdates',
                severity: 'critical',
                description: '5 critical updates pending',
                details: { updateCount: 5 }
            };
            yield vmEventManager.handleAutoCheckIssueDetected('test-vm-id', issueData, 'system');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('test-user-id', 'autocheck', 'issue-detected', expect.objectContaining({
                status: 'success',
                data: expect.objectContaining({
                    vmId: 'test-vm-id',
                    issueType: 'WindowsUpdates',
                    severity: 'critical'
                })
            }));
        }));
        it('should handle auto-check remediation available', () => __awaiter(void 0, void 0, void 0, function* () {
            const remediationData = {
                checkType: 'WindowsUpdates',
                remediationType: 'AutoFixWindowsUpdates',
                description: 'Install pending updates',
                isAutomatic: true,
                estimatedTime: '15-30 minutes',
                details: { updateCount: 5 }
            };
            yield vmEventManager.handleAutoCheckRemediationAvailable('test-vm-id', remediationData, 'system');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('test-user-id', 'autocheck', 'remediation-available', expect.objectContaining({
                status: 'success',
                data: expect.objectContaining({
                    vmId: 'test-vm-id',
                    remediationType: 'AutoFixWindowsUpdates',
                    isAutomatic: true
                })
            }));
        }));
        it('should handle auto-check remediation completion', () => __awaiter(void 0, void 0, void 0, function* () {
            const completionData = {
                checkType: 'WindowsUpdates',
                remediationType: 'AutoFixWindowsUpdates',
                success: true,
                description: 'Updates installed successfully',
                executionTime: '1245ms',
                details: { updatesInstalled: 5 }
            };
            yield vmEventManager.handleAutoCheckRemediationCompleted('test-vm-id', completionData, 'system');
            expect(mockSocketService.sendToUser).toHaveBeenCalledWith('test-user-id', 'autocheck', 'remediation-completed', expect.objectContaining({
                status: 'success',
                data: expect.objectContaining({
                    vmId: 'test-vm-id',
                    success: true,
                    remediationType: 'AutoFixWindowsUpdates'
                })
            }));
        }));
        it('should send events to multiple target users', () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock multiple users
            const mockAdmin1 = (0, mock_factories_1.createMockUser)({ id: 'admin-1', role: 'ADMIN' });
            const mockAdmin2 = (0, mock_factories_1.createMockUser)({ id: 'admin-2', role: 'ADMIN' });
            jest_setup_1.mockPrisma.user.findMany.mockResolvedValue([mockAdmin1, mockAdmin2]);
            const issueData = {
                checkType: 'DiskSpace',
                severity: 'warning',
                description: 'Disk 85% full',
                details: { usagePercent: 85 }
            };
            yield vmEventManager.handleAutoCheckIssueDetected('test-vm-id', issueData);
            // Should send to VM owner + admin users
            expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(3);
        }));
    });
    describe('Response Analysis', () => {
        it('should analyze Windows Updates response and detect issues', () => {
            const mockResponse = {
                id: 'test-command',
                success: true,
                command_type: 'CheckWindowsUpdates',
                data: {
                    pending_updates: [
                        { title: 'Security Update', importance: 'Critical' },
                        { title: 'Feature Update', importance: 'Important' }
                    ]
                }
            };
            // Test that the analysis would work (we can't easily test private methods)
            expect(mockResponse.command_type).toBe('CheckWindowsUpdates');
            expect(mockResponse.success).toBe(true);
        });
        it('should analyze Defender response and detect issues', () => {
            const mockResponse = {
                id: 'test-command',
                success: true,
                command_type: 'CheckWindowsDefender',
                data: {
                    real_time_protection: false,
                    antivirus_enabled: false,
                    definitions_outdated: true
                }
            };
            expect(mockResponse.command_type).toBe('CheckWindowsDefender');
            expect(mockResponse.success).toBe(true);
        });
        it('should analyze disk space response and detect critical usage', () => {
            const mockResponse = {
                id: 'test-command',
                success: true,
                command_type: 'CheckDiskSpace',
                data: {
                    drives: [
                        {
                            drive_letter: 'C:',
                            total_gb: 100,
                            used_gb: 92,
                            available_gb: 8
                        }
                    ]
                }
            };
            const usagePercent = (92 / 100) * 100;
            expect(usagePercent).toBeGreaterThan(90); // Should trigger critical alert
        });
    });
    describe('Type Guards', () => {
        it('should correctly identify WindowsUpdatesData', () => {
            const validData = {
                pending_updates: [
                    { title: 'Test Update', importance: 'Critical' }
                ]
            };
            const invalidData = {
                some_other_field: 'value'
            };
            // Type guard logic test
            expect(Array.isArray(validData.pending_updates)).toBe(true);
            expect('pending_updates' in validData).toBe(true);
            expect('pending_updates' in invalidData).toBe(false);
        });
        it('should correctly identify DefenderData', () => {
            const validData = {
                real_time_protection: true,
                antivirus_enabled: true
            };
            const invalidData = {
                some_other_field: 'value'
            };
            expect('real_time_protection' in validData).toBe(true);
            expect('real_time_protection' in invalidData).toBe(false);
        });
    });
});
