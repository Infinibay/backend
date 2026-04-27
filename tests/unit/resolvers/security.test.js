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
// SecurityResolver, FirewallService, and knownServices modules have been removed/refactored.
// These tests are skipped until the security resolver is reimplemented.
// Original imports:
// import { SecurityResolver } from '@resolvers/security/resolver'
// import { FirewallService } from '@services/firewallService'
// import { ServiceRiskLevel } from '@main/config/knownServices'
const jest_setup_1 = require("../../setup/jest.setup");
const test_helpers_1 = require("../../setup/test-helpers");
const mock_factories_1 = require("../../setup/mock-factories");
const errors_1 = require("@utils/errors");
// Stub types/values for skipped tests
class SecurityResolver {
}
class FirewallService {
}
const ServiceRiskLevel = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };
const ServiceAction = { USE: 'USE', PROVIDE: 'PROVIDE' };
describe.skip('SecurityResolver - skipped: SecurityResolver, FirewallService, and knownServices modules have been removed/refactored', () => {
    let resolver;
    let mockFirewallService;
    const ctx = (0, test_helpers_1.createAdminContext)();
    beforeEach(() => {
        jest.clearAllMocks();
        resolver = new SecurityResolver();
        // Create a mock FirewallService
        mockFirewallService = {
            getServices: jest.fn(),
            getVmServiceStatus: jest.fn(),
            getDepartmentServiceStatus: jest.fn(),
            getGlobalServiceStatus: jest.fn(),
            toggleVmService: jest.fn(),
            toggleDepartmentService: jest.fn(),
            toggleGlobalService: jest.fn()
        };
        // Mock the private getFirewallService method
        // @ts-ignore - accessing private method for testing
        resolver.getFirewallService = jest.fn().mockReturnValue(mockFirewallService);
    });
    describe('Query: listServices', () => {
        it('should return list of available services', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const mockServices = [
                {
                    id: 'http',
                    name: 'HTTP',
                    displayName: 'Web (HTTP)',
                    description: 'Web Server',
                    ports: [{ protocol: 'tcp', portStart: 80, portEnd: 80 }],
                    riskLevel: ServiceRiskLevel.MEDIUM,
                    riskDescription: 'Unencrypted web traffic'
                },
                {
                    id: 'https',
                    name: 'HTTPS',
                    displayName: 'Secure Web (HTTPS)',
                    description: 'Secure Web Server',
                    ports: [{ protocol: 'tcp', portStart: 443, portEnd: 443 }],
                    riskLevel: ServiceRiskLevel.LOW,
                    riskDescription: 'Encrypted web traffic'
                }
            ];
            mockFirewallService.getServices.mockResolvedValue(mockServices);
            // Act
            const result = yield resolver.listServices(ctx);
            // Assert
            expect(mockFirewallService.getServices).toHaveBeenCalledTimes(1);
            expect(result).toEqual(mockServices);
            expect(result).toHaveLength(2);
        }));
    });
    describe('Query: getVmServiceStatus', () => {
        it('should return service status for a VM', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const vmId = 'vm-123';
            const mockVm = (0, mock_factories_1.createMockMachine)({ id: vmId });
            const mockStatus = [
                {
                    serviceId: 'http',
                    vmId,
                    vmName: mockVm.name,
                    serviceName: 'HTTP',
                    useEnabled: true,
                    provideEnabled: false,
                    running: true
                }
            ];
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockVm);
            mockFirewallService.getVmServiceStatus.mockResolvedValue(mockStatus);
            // Act
            const result = yield resolver.getVmServiceStatus(ctx, vmId);
            // Assert
            expect(jest_setup_1.mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: vmId },
                select: { id: true }
            });
            expect(mockFirewallService.getVmServiceStatus).toHaveBeenCalledWith(vmId, undefined);
            expect(result).toEqual(mockStatus);
        }));
        it('should filter by service ID when provided', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const vmId = 'vm-123';
            const serviceId = 'http';
            const mockVm = (0, mock_factories_1.createMockMachine)({ id: vmId });
            const mockStatus = [
                {
                    serviceId: 'http',
                    vmId,
                    vmName: mockVm.name,
                    serviceName: 'HTTP',
                    useEnabled: true,
                    provideEnabled: false,
                    running: true
                }
            ];
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockVm);
            mockFirewallService.getVmServiceStatus.mockResolvedValue(mockStatus);
            // Act
            const result = yield resolver.getVmServiceStatus(ctx, vmId, serviceId);
            // Assert
            expect(mockFirewallService.getVmServiceStatus).toHaveBeenCalledWith(vmId, serviceId);
            expect(result).toEqual(mockStatus);
        }));
        it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const vmId = 'non-existent';
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
            // Act & Assert
            yield expect(resolver.getVmServiceStatus(ctx, vmId)).rejects.toThrow(errors_1.UserInputError);
            expect(mockFirewallService.getVmServiceStatus).not.toHaveBeenCalled();
        }));
    });
    describe('Query: getDepartmentServiceStatus', () => {
        it('should return service status for a department', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const departmentId = 'dept-123';
            const mockDepartment = (0, mock_factories_1.createMockDepartment)({ id: departmentId });
            const mockStatus = [
                {
                    serviceId: 'ssh',
                    departmentId,
                    departmentName: mockDepartment.name,
                    serviceName: 'SSH',
                    useEnabled: true,
                    provideEnabled: false,
                    vmCount: 5,
                    enabledVmCount: 3
                }
            ];
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
            mockFirewallService.getDepartmentServiceStatus.mockResolvedValue(mockStatus);
            // Act
            const result = yield resolver.getDepartmentServiceStatus(ctx, departmentId);
            // Assert
            expect(jest_setup_1.mockPrisma.department.findUnique).toHaveBeenCalledWith({
                where: { id: departmentId },
                select: { id: true }
            });
            expect(mockFirewallService.getDepartmentServiceStatus).toHaveBeenCalledWith(departmentId, undefined);
            expect(result).toEqual(mockStatus);
        }));
        it('should throw error when department not found', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const departmentId = 'non-existent';
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(null);
            // Act & Assert
            yield expect(resolver.getDepartmentServiceStatus(ctx, departmentId)).rejects.toThrow(errors_1.UserInputError);
            expect(mockFirewallService.getDepartmentServiceStatus).not.toHaveBeenCalled();
        }));
    });
    describe('Query: getGlobalServiceStatus', () => {
        it('should return global service status', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const mockStatus = [
                {
                    serviceId: 'rdp',
                    serviceName: 'RDP',
                    useEnabled: false,
                    provideEnabled: false
                }
            ];
            mockFirewallService.getGlobalServiceStatus.mockResolvedValue(mockStatus);
            // Act
            const result = yield resolver.getGlobalServiceStatus(ctx);
            // Assert
            expect(mockFirewallService.getGlobalServiceStatus).toHaveBeenCalledWith(undefined);
            expect(result).toEqual(mockStatus);
        }));
        it('should filter by service ID when provided', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const serviceId = 'rdp';
            const mockStatus = [
                {
                    serviceId: 'rdp',
                    serviceName: 'Remote Desktop',
                    useEnabled: false,
                    provideEnabled: false
                }
            ];
            mockFirewallService.getGlobalServiceStatus.mockResolvedValue(mockStatus);
            // Act
            const result = yield resolver.getGlobalServiceStatus(ctx, serviceId);
            // Assert
            expect(mockFirewallService.getGlobalServiceStatus).toHaveBeenCalledWith(serviceId);
            expect(result).toEqual(mockStatus);
        }));
    });
    describe('Mutation: toggleVmService', () => {
        it('should toggle VM service status', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const input = {
                vmId: 'vm-123',
                serviceId: 'http',
                action: ServiceAction.USE,
                enabled: true
            };
            const mockVm = (0, mock_factories_1.createMockMachine)({ id: input.vmId });
            const mockResult = {
                serviceId: input.serviceId,
                vmId: input.vmId,
                vmName: mockVm.name,
                serviceName: 'HTTP',
                useEnabled: input.enabled,
                provideEnabled: false,
                running: true
            };
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockVm);
            mockFirewallService.toggleVmService.mockResolvedValue(mockResult);
            // Act
            const result = yield resolver.toggleVmService(ctx, input);
            // Assert
            expect(jest_setup_1.mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                where: { id: input.vmId },
                select: { id: true }
            });
            expect(mockFirewallService.toggleVmService).toHaveBeenCalledWith(input.vmId, input.serviceId, input.action, input.enabled);
            expect(result).toEqual(mockResult);
        }));
        it('should throw error when VM not found', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const input = {
                vmId: 'non-existent',
                serviceId: 'http',
                action: ServiceAction.USE,
                enabled: true
            };
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
            // Act & Assert
            yield expect(resolver.toggleVmService(ctx, input)).rejects.toThrow(errors_1.UserInputError);
            expect(mockFirewallService.toggleVmService).not.toHaveBeenCalled();
        }));
    });
    describe('Mutation: toggleDepartmentService', () => {
        it('should toggle department service status', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const input = {
                departmentId: 'dept-123',
                serviceId: 'ssh',
                action: ServiceAction.USE,
                enabled: true
            };
            const mockDepartment = (0, mock_factories_1.createMockDepartment)({ id: input.departmentId });
            const mockResult = {
                serviceId: input.serviceId,
                departmentId: input.departmentId,
                departmentName: mockDepartment.name,
                serviceName: 'SSH',
                useEnabled: input.enabled,
                provideEnabled: false,
                vmCount: 5,
                enabledVmCount: 3
            };
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(mockDepartment);
            mockFirewallService.toggleDepartmentService.mockResolvedValue(mockResult);
            // Act
            const result = yield resolver.toggleDepartmentService(ctx, input);
            // Assert
            expect(jest_setup_1.mockPrisma.department.findUnique).toHaveBeenCalledWith({
                where: { id: input.departmentId },
                select: { id: true }
            });
            expect(mockFirewallService.toggleDepartmentService).toHaveBeenCalledWith(input.departmentId, input.serviceId, input.action, input.enabled);
            expect(result).toEqual(mockResult);
        }));
        it('should throw error when department not found', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const input = {
                departmentId: 'non-existent',
                serviceId: 'ssh',
                action: ServiceAction.USE,
                enabled: true
            };
            jest_setup_1.mockPrisma.department.findUnique.mockResolvedValue(null);
            // Act & Assert
            yield expect(resolver.toggleDepartmentService(ctx, input)).rejects.toThrow(errors_1.UserInputError);
            expect(mockFirewallService.toggleDepartmentService).not.toHaveBeenCalled();
        }));
    });
    describe('Mutation: toggleGlobalService', () => {
        it('should toggle global service status', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const input = {
                serviceId: 'rdp',
                action: ServiceAction.USE,
                enabled: false
            };
            const mockResult = {
                serviceId: input.serviceId,
                serviceName: 'Remote Desktop',
                useEnabled: false,
                provideEnabled: false
            };
            mockFirewallService.toggleGlobalService.mockResolvedValue(mockResult);
            // Act
            const result = yield resolver.toggleGlobalService(ctx, input);
            // Assert
            expect(mockFirewallService.toggleGlobalService).toHaveBeenCalledWith(input.serviceId, input.action, input.enabled);
            expect(result).toEqual(mockResult);
        }));
    });
    describe('Query: getServiceStatusSummary', () => {
        it('should return service status summary', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const mockSummary = [
                {
                    serviceId: 'http',
                    serviceName: 'Web (HTTP)',
                    totalVms: 5,
                    runningVms: 2,
                    enabledVms: 3
                },
                {
                    serviceId: 'ssh',
                    serviceName: 'Secure Shell',
                    totalVms: 5,
                    runningVms: 1,
                    enabledVms: 4
                }
            ];
            mockFirewallService.getServices.mockResolvedValue([
                {
                    id: 'http',
                    name: 'HTTP',
                    displayName: 'Web (HTTP)',
                    description: 'Web Server',
                    ports: [{ protocol: 'tcp', portStart: 80, portEnd: 80 }],
                    riskLevel: ServiceRiskLevel.MEDIUM,
                    riskDescription: 'Unencrypted web traffic'
                }
            ]);
            jest_setup_1.mockPrisma.machine.findMany.mockResolvedValue([]);
            // Act
            const result = yield resolver.getServiceStatusSummary(ctx);
            // Assert
            expect(mockFirewallService.getServices).toHaveBeenCalledTimes(1);
            expect(result).toHaveLength(1);
        }));
    });
});
