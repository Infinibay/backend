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
const jest_mock_extended_1 = require("jest-mock-extended");
const resolver_1 = require("../../../app/graphql/resolvers/vmManagement/resolver");
const VirtioSocketWatcherService_1 = require("@services/VirtioSocketWatcherService");
const mock_factories_1 = require("../../setup/mock-factories");
const test_helpers_1 = require("../../setup/test-helpers");
const errors_1 = require("@utils/errors");
// Mock the service modules
jest.mock('@services/VirtioSocketWatcherService');
const MockVirtioSocketWatcherService = VirtioSocketWatcherService_1.VirtioSocketWatcherService;
const mockVirtioSocketWatcherService = (0, jest_mock_extended_1.mockDeep)();
describe('VMManagementResolver', () => {
    let resolver;
    let mockUser;
    let mockAdminUser;
    let mockVM;
    let mockContext;
    let mockAdminContext;
    beforeEach(() => {
        (0, jest_mock_extended_1.mockReset)(mockVirtioSocketWatcherService);
        // Set up mocked constructors
        MockVirtioSocketWatcherService.mockImplementation(() => mockVirtioSocketWatcherService);
        resolver = new resolver_1.VMManagementResolver(mockVirtioSocketWatcherService);
        mockUser = (0, mock_factories_1.createMockUser)();
        mockAdminUser = (0, mock_factories_1.createMockAdminUser)();
        mockVM = (0, mock_factories_1.createMockMachine)({ userId: mockUser.id });
        mockContext = (0, test_helpers_1.createUserContext)();
        mockAdminContext = (0, test_helpers_1.createAdminContext)();
    });
    describe('listVMServices', () => {
        const vmId = 'vm-123';
        it('should successfully list VM services', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockServiceResponse = {
                success: true,
                data: [
                    { Name: 'nginx', Status: 'running', Description: 'Web server', can_start: false, can_stop: true, can_restart: true, StartType: 'auto' },
                    { name: 'mysql', status: 'stopped', description: 'Database server', can_start: true, can_stop: false, can_restart: false }
                ]
            };
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockServiceResponse);
            const result = yield resolver.listVMServices(vmId, mockContext);
            expect(mockContext.prisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: vmId }
            });
            // The resolver uses vm.id (from DB) not the input vmId
            expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(mockVM.id, { action: 'ServiceList' }, 30000);
            expect(result).toHaveLength(2);
            expect(result[0]).toMatchObject({
                name: 'nginx',
                displayName: 'nginx',
                status: 'running',
                description: 'Web server',
                canStart: false,
                canStop: true,
                canRestart: true,
                startupType: 'auto'
            });
            expect(result[1]).toMatchObject({
                name: 'mysql',
                displayName: 'mysql',
                status: 'stopped',
                description: 'Database server',
                canStart: true,
                canStop: false,
                canRestart: false,
                startupType: 'unknown'
            });
        }));
        it('should return empty array when no services found', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockServiceResponse = {
                success: true,
                data: []
            };
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockServiceResponse);
            const result = yield resolver.listVMServices(vmId, mockContext);
            expect(result).toEqual([]);
        }));
        it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockContext.prisma.machine.findUnique.mockResolvedValue(null);
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow(errors_1.UserInputError);
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow('VM not found');
        }));
        it('should handle VirtioSocketWatcher service failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockErrorResponse = {
                success: false,
                error: 'Failed to connect to VM'
            };
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockErrorResponse);
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow(errors_1.UserInputError);
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow('Failed to list VM services');
        }));
        it('should handle VirtioSocketWatcher timeout', () => __awaiter(void 0, void 0, void 0, function* () {
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockRejectedValue(new Error('timeout'));
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow(errors_1.UserInputError);
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow('Failed to list VM services');
        }));
        it('should handle invalid service response format', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockInvalidResponse = {
                success: true,
                data: null
            };
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockInvalidResponse);
            const result = yield resolver.listVMServices(vmId, mockContext);
            expect(result).toEqual([]);
        }));
    });
    describe('controlVMService', () => {
        const serviceControlInput = {
            vmId: 'vm-123',
            serviceName: 'nginx',
            action: 'start'
        };
        it('should successfully control VM service', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockCommandResult = {
                success: true,
                stdout: 'Service started successfully',
                stderr: '',
                exit_code: 0
            };
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockCommandResult);
            const result = yield resolver.controlVMService(serviceControlInput, mockContext);
            expect(mockContext.prisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: serviceControlInput.vmId }
            });
            // The resolver uses vm.id (from DB) not input.vmId
            expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(mockVM.id, {
                action: 'ServiceControl',
                params: {
                    service_name: serviceControlInput.serviceName,
                    action: serviceControlInput.action
                }
            }, 30000);
            expect(result).toEqual({
                success: true,
                output: 'Service started successfully',
                error: '',
                exitCode: 0
            });
        }));
        it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            mockContext.prisma.machine.findUnique.mockResolvedValue(null);
            yield expect(resolver.controlVMService(serviceControlInput, mockContext))
                .rejects.toThrow(errors_1.UserInputError);
            yield expect(resolver.controlVMService(serviceControlInput, mockContext))
                .rejects.toThrow('VM not found');
        }));
        it('should handle service control failure', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockFailureResult = {
                success: false,
                stdout: '',
                stderr: 'Service not found',
                exit_code: 1
            };
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockFailureResult);
            const result = yield resolver.controlVMService(serviceControlInput, mockContext);
            expect(result).toEqual({
                success: false,
                output: '',
                error: 'Service not found',
                exitCode: 1
            });
        }));
        it('should handle VirtioSocketWatcher timeout', () => __awaiter(void 0, void 0, void 0, function* () {
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockRejectedValue(new Error('timeout'));
            const result = yield resolver.controlVMService(serviceControlInput, mockContext);
            expect(result).toEqual({
                success: false,
                output: '',
                error: 'timeout',
                exitCode: 1
            });
        }));
        it('should handle different service actions', () => __awaiter(void 0, void 0, void 0, function* () {
            const actions = ['start', 'stop', 'restart'];
            for (const action of actions) {
                const input = Object.assign(Object.assign({}, serviceControlInput), { action });
                const mockResult = {
                    success: true,
                    stdout: `Service ${action}ed successfully`,
                    stderr: '',
                    exit_code: 0
                };
                mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
                mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockResult);
                const result = yield resolver.controlVMService(input, mockContext);
                expect(result.output).toContain(action);
                // The resolver uses vm.id (from DB) not input.vmId
                expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(mockVM.id, {
                    action: 'ServiceControl',
                    params: {
                        service_name: input.serviceName,
                        action
                    }
                }, 30000);
            }
        }));
    });
    describe('Error Handling', () => {
        const vmId = 'vm-123';
        it('should handle database connection errors', () => __awaiter(void 0, void 0, void 0, function* () {
            mockContext.prisma.machine.findUnique.mockRejectedValue(new Error('Database connection failed'));
            // DB errors from findUnique happen before the try/catch, so they propagate as-is
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow('Database connection failed');
        }));
        it('should handle virtio service timeout gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
            mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM);
            mockVirtioSocketWatcherService.sendSafeCommand.mockRejectedValue(new Error('Virtio error'));
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow(errors_1.UserInputError);
        }));
        it('should provide meaningful error messages', () => __awaiter(void 0, void 0, void 0, function* () {
            mockContext.prisma.machine.findUnique.mockResolvedValue(null);
            yield expect(resolver.listVMServices(vmId, mockContext))
                .rejects.toThrow('VM not found');
        }));
    });
});
