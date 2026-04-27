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
const client_1 = require("@prisma/client");
const jest_setup_1 = require("../../setup/jest.setup");
const VMRecommendationResolver_1 = require("../../../app/graphql/resolvers/VMRecommendationResolver");
const recommendation_test_helpers_1 = require("../../setup/recommendation-test-helpers");
const mock_factories_1 = require("../../setup/mock-factories");
// Mock the VMRecommendationService
jest.mock('../../../app/services/VMRecommendationService');
const MockVMRecommendationService = require('../../../app/services/VMRecommendationService').VMRecommendationService;
describe('VMRecommendationResolver', () => {
    let resolver;
    let mockContext;
    let mockService;
    beforeEach(() => {
        jest.clearAllMocks();
        // Setup mock service instance
        mockService = {
            getRecommendations: jest.fn(),
            generateRecommendations: jest.fn()
        };
        // Mock the service constructor to return our mock
        MockVMRecommendationService.mockImplementation(() => mockService);
        resolver = new VMRecommendationResolver_1.VMRecommendationResolver();
        // Setup mock context
        mockContext = {
            prisma: jest_setup_1.mockPrisma,
            user: (0, mock_factories_1.createMockUser)({ id: 'user-1', role: 'USER' }),
            req: {},
            res: {},
            setupMode: false,
            virtioSocketWatcher: {}
        };
    });
    describe('getVMRecommendations Query', () => {
        const vmId = 'test-vm-1';
        const mockMachine = (0, mock_factories_1.createMockMachine)({
            id: vmId,
            userId: 'user-1',
            name: 'test-vm'
        });
        beforeEach(() => {
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
        });
        describe('Authorization', () => {
            it('should allow user to access their own machine', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.DISK_SPACE_LOW }),
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.OS_UPDATE_AVAILABLE })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                const result = yield resolver.getVMRecommendations(vmId, mockContext);
                expect(result).toHaveLength(2);
                expect(result[0]).toHaveProperty('type', client_1.RecommendationType.DISK_SPACE_LOW);
                expect(result[1]).toHaveProperty('type', client_1.RecommendationType.OS_UPDATE_AVAILABLE);
                expect(jest_setup_1.mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                    where: { id: vmId },
                    select: { id: true, userId: true }
                });
            }));
            it('should allow admin to access any machine', () => __awaiter(void 0, void 0, void 0, function* () {
                const adminContext = Object.assign(Object.assign({}, mockContext), { user: (0, mock_factories_1.createMockUser)({ id: 'admin-1', role: 'ADMIN' }) });
                const otherUserMachine = (0, mock_factories_1.createMockMachine)({
                    id: vmId,
                    userId: 'other-user-1',
                    name: 'other-user-vm'
                });
                jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(otherUserMachine);
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.DISK_SPACE_LOW })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                const result = yield resolver.getVMRecommendations(vmId, adminContext);
                expect(result).toHaveLength(1);
                expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, undefined);
            }));
            it('should deny access to other users machines', () => __awaiter(void 0, void 0, void 0, function* () {
                const otherUserMachine = (0, mock_factories_1.createMockMachine)({
                    id: vmId,
                    userId: 'other-user-1',
                    name: 'other-user-vm'
                });
                jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(otherUserMachine);
                yield expect(resolver.getVMRecommendations(vmId, mockContext))
                    .rejects.toThrow('Access denied');
                expect(mockService.getRecommendations).not.toHaveBeenCalled();
            }));
            it('should deny access when user is not authenticated', () => __awaiter(void 0, void 0, void 0, function* () {
                const unauthenticatedContext = Object.assign(Object.assign({}, mockContext), { user: null });
                yield expect(resolver.getVMRecommendations(vmId, unauthenticatedContext))
                    .rejects.toThrow('Access denied');
                expect(mockService.getRecommendations).not.toHaveBeenCalled();
            }));
            it('should throw error when machine not found', () => __awaiter(void 0, void 0, void 0, function* () {
                jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
                yield expect(resolver.getVMRecommendations(vmId, mockContext))
                    .rejects.toThrow('Machine not found');
                expect(mockService.getRecommendations).not.toHaveBeenCalled();
            }));
        });
        describe('Parameter Handling', () => {
            it('should pass refresh parameter correctly', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.DISK_SPACE_LOW })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                yield resolver.getVMRecommendations(vmId, mockContext, true);
                expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, true, undefined);
            }));
            it('should default refresh to false when not provided', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.DISK_SPACE_LOW })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                yield resolver.getVMRecommendations(vmId, mockContext);
                expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, undefined);
            }));
            it('should pass filter parameters correctly', () => __awaiter(void 0, void 0, void 0, function* () {
                const filter = {
                    types: [client_1.RecommendationType.DISK_SPACE_LOW, client_1.RecommendationType.OS_UPDATE_AVAILABLE],
                    limit: 10,
                    createdAfter: new Date('2023-01-01'),
                    createdBefore: new Date('2023-12-31')
                };
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                        machineId: vmId,
                        type: client_1.RecommendationType.DISK_SPACE_LOW,
                        createdAt: new Date('2023-06-15')
                    })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                yield resolver.getVMRecommendations(vmId, mockContext, false, filter);
                expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, filter);
            }));
            it('should handle undefined filter gracefully', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.DISK_SPACE_LOW })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                yield resolver.getVMRecommendations(vmId, mockContext, false, undefined);
                expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, undefined);
            }));
        });
        describe('Service Integration', () => {
            it('should create VMRecommendationService with correct Prisma client', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.DISK_SPACE_LOW })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                yield resolver.getVMRecommendations(vmId, mockContext);
                expect(MockVMRecommendationService).toHaveBeenCalledWith(mockContext.prisma);
            }));
            it('should return recommendations in correct GraphQL format', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                        machineId: vmId,
                        type: client_1.RecommendationType.DISK_SPACE_LOW,
                        text: 'Low disk space on drive C:',
                        actionText: 'Clean up disk space or add storage',
                        data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 }
                    }),
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                        machineId: vmId,
                        type: client_1.RecommendationType.OS_UPDATE_AVAILABLE,
                        text: 'Critical Windows updates available',
                        actionText: 'Install pending Windows updates',
                        data: { criticalCount: 3, securityCount: 5 }
                    })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                const result = yield resolver.getVMRecommendations(vmId, mockContext);
                expect(result).toHaveLength(2);
                // Verify first recommendation
                expect(result[0]).toMatchObject({
                    id: expect.any(String),
                    machineId: vmId,
                    type: client_1.RecommendationType.DISK_SPACE_LOW,
                    text: 'Low disk space on drive C:',
                    actionText: 'Clean up disk space or add storage',
                    data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 },
                    createdAt: expect.any(Date)
                });
                // Verify second recommendation
                expect(result[1]).toMatchObject({
                    id: expect.any(String),
                    machineId: vmId,
                    type: client_1.RecommendationType.OS_UPDATE_AVAILABLE,
                    text: 'Critical Windows updates available',
                    actionText: 'Install pending Windows updates',
                    data: { criticalCount: 3, securityCount: 5 },
                    createdAt: expect.any(Date)
                });
            }));
            it('should handle empty recommendations list', () => __awaiter(void 0, void 0, void 0, function* () {
                mockService.getRecommendations.mockResolvedValue([]);
                const result = yield resolver.getVMRecommendations(vmId, mockContext);
                expect(result).toEqual([]);
                expect(result).toHaveLength(0);
            }));
            it('should handle service returning null data fields', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                        machineId: vmId,
                        type: client_1.RecommendationType.OTHER,
                        data: null,
                        snapshotId: null
                    })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                const result = yield resolver.getVMRecommendations(vmId, mockContext);
                expect(result).toHaveLength(1);
                expect(result[0].data).toBeNull();
                expect(result[0].snapshotId).toBeNull();
            }));
        });
        describe('Error Handling', () => {
            it('should handle VMRecommendationService initialization failure', () => __awaiter(void 0, void 0, void 0, function* () {
                MockVMRecommendationService.mockImplementation(() => {
                    throw new Error('Service initialization failed');
                });
                yield expect(resolver.getVMRecommendations(vmId, mockContext))
                    .rejects.toThrow('Service initialization failed');
            }));
            it('should handle service method failures', () => __awaiter(void 0, void 0, void 0, function* () {
                mockService.getRecommendations.mockRejectedValue(new Error('Database connection lost'));
                yield expect(resolver.getVMRecommendations(vmId, mockContext))
                    .rejects.toThrow('Database connection lost');
            }));
            it('should handle service timeout errors', () => __awaiter(void 0, void 0, void 0, function* () {
                mockService.getRecommendations.mockRejectedValue(new Error('Operation timed out'));
                yield expect(resolver.getVMRecommendations(vmId, mockContext))
                    .rejects.toThrow('Operation timed out');
            }));
            it('should handle malformed service response', () => __awaiter(void 0, void 0, void 0, function* () {
                // Service returns invalid data structure
                mockService.getRecommendations.mockResolvedValue([
                    { invalidField: 'invalid' } // Missing required fields
                ]);
                const result = yield resolver.getVMRecommendations(vmId, mockContext);
                // Should still return the data as-is but cast to expected type
                expect(result).toHaveLength(1);
            }));
            it('should handle database connection errors', () => __awaiter(void 0, void 0, void 0, function* () {
                jest_setup_1.mockPrisma.machine.findUnique.mockRejectedValue(new Error('Database connection failed'));
                yield expect(resolver.getVMRecommendations(vmId, mockContext))
                    .rejects.toThrow('Database connection failed');
                expect(mockService.getRecommendations).not.toHaveBeenCalled();
            }));
        });
        describe('Input Validation', () => {
            it('should handle valid UUID vmId', () => __awaiter(void 0, void 0, void 0, function* () {
                const uuidVmId = '550e8400-e29b-41d4-a716-446655440000';
                const machineWithUuid = (0, mock_factories_1.createMockMachine)({
                    id: uuidVmId,
                    userId: 'user-1'
                });
                jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machineWithUuid);
                mockService.getRecommendations.mockResolvedValue([]);
                const result = yield resolver.getVMRecommendations(uuidVmId, mockContext);
                expect(result).toEqual([]);
                expect(jest_setup_1.mockPrisma.machine.findUnique).toHaveBeenCalledWith({
                    where: { id: uuidVmId },
                    select: { id: true, userId: true }
                });
            }));
            it('should handle various vmId formats', () => __awaiter(void 0, void 0, void 0, function* () {
                const hexVmId = 'abc123def456';
                const machineWithHex = (0, mock_factories_1.createMockMachine)({
                    id: hexVmId,
                    userId: 'user-1'
                });
                jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(machineWithHex);
                mockService.getRecommendations.mockResolvedValue([]);
                const result = yield resolver.getVMRecommendations(hexVmId, mockContext);
                expect(result).toEqual([]);
            }));
            it('should handle empty string vmId', () => __awaiter(void 0, void 0, void 0, function* () {
                jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(null);
                yield expect(resolver.getVMRecommendations('', mockContext))
                    .rejects.toThrow('Machine not found');
            }));
            it('should validate filter input types', () => __awaiter(void 0, void 0, void 0, function* () {
                const invalidFilter = {
                    types: 'invalid', // Should be array
                    limit: 'invalid' // Should be number
                };
                mockService.getRecommendations.mockResolvedValue([]);
                // The resolver should pass the filter as-is to the service
                // Type validation is handled by GraphQL schema
                yield resolver.getVMRecommendations(vmId, mockContext, false, invalidFilter);
                expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, invalidFilter);
            }));
        });
        describe('Performance', () => {
            it('should handle concurrent requests correctly', () => __awaiter(void 0, void 0, void 0, function* () {
                const mockRecommendations = [
                    (0, recommendation_test_helpers_1.createMockVMRecommendation)({ machineId: vmId, type: client_1.RecommendationType.DISK_SPACE_LOW })
                ];
                mockService.getRecommendations.mockResolvedValue(mockRecommendations);
                // Simulate concurrent requests to the same VM
                const promises = Array.from({ length: 5 }, () => resolver.getVMRecommendations(vmId, mockContext));
                const results = yield Promise.all(promises);
                expect(results).toHaveLength(5);
                results.forEach(result => {
                    expect(result).toHaveLength(1);
                    expect(result[0]).toHaveProperty('type', client_1.RecommendationType.DISK_SPACE_LOW);
                });
                expect(mockService.getRecommendations).toHaveBeenCalledTimes(5);
            }));
            it('should handle large recommendation datasets', () => __awaiter(void 0, void 0, void 0, function* () {
                // Generate large number of recommendations
                const largeRecommendationSet = Array.from({ length: 100 }, (_, i) => (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                    machineId: vmId,
                    type: Object.values(client_1.RecommendationType)[i % Object.values(client_1.RecommendationType).length],
                    text: `Recommendation ${i + 1}`,
                    actionText: `Action ${i + 1}`
                }));
                mockService.getRecommendations.mockResolvedValue(largeRecommendationSet);
                const startTime = Date.now();
                const result = yield resolver.getVMRecommendations(vmId, mockContext);
                const endTime = Date.now();
                expect(result).toHaveLength(100);
                expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
            }));
            it('should create new service instance per request', () => __awaiter(void 0, void 0, void 0, function* () {
                mockService.getRecommendations.mockResolvedValue([]);
                // Make multiple requests
                yield resolver.getVMRecommendations(vmId, mockContext);
                yield resolver.getVMRecommendations(vmId, mockContext);
                // Service should be instantiated for each request
                expect(MockVMRecommendationService).toHaveBeenCalledTimes(2);
            }));
        });
        describe('Context Usage', () => {
            it('should use context.prisma for service instantiation', () => __awaiter(void 0, void 0, void 0, function* () {
                mockService.getRecommendations.mockResolvedValue([]);
                yield resolver.getVMRecommendations(vmId, mockContext);
                expect(MockVMRecommendationService).toHaveBeenCalledWith(mockContext.prisma);
            }));
            it('should use context.user for authorization', () => __awaiter(void 0, void 0, void 0, function* () {
                const userContext = Object.assign(Object.assign({}, mockContext), { user: (0, mock_factories_1.createMockUser)({ id: 'test-user', role: 'USER' }) });
                const userMachine = (0, mock_factories_1.createMockMachine)({
                    id: vmId,
                    userId: 'test-user'
                });
                jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(userMachine);
                mockService.getRecommendations.mockResolvedValue([]);
                yield resolver.getVMRecommendations(vmId, userContext);
                expect(mockService.getRecommendations).toHaveBeenCalled();
            }));
            it('should handle context with missing properties', () => __awaiter(void 0, void 0, void 0, function* () {
                const incompleteContext = Object.assign(Object.assign({}, mockContext), { user: undefined });
                yield expect(resolver.getVMRecommendations(vmId, incompleteContext))
                    .rejects.toThrow('Access denied');
            }));
        });
    });
    describe('GraphQL Type Compliance', () => {
        const vmId = 'test-vm-1';
        const mockMachine = (0, mock_factories_1.createMockMachine)({
            id: vmId,
            userId: 'user-1'
        });
        beforeEach(() => {
            jest_setup_1.mockPrisma.machine.findUnique.mockResolvedValue(mockMachine);
        });
        it('should return data matching VMRecommendationType schema', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockRecommendation = (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                id: 'rec-123',
                machineId: vmId,
                snapshotId: 'snapshot-456',
                type: client_1.RecommendationType.DISK_SPACE_LOW,
                text: 'Test recommendation text',
                actionText: 'Test action text',
                data: { testKey: 'testValue' },
                createdAt: new Date('2023-10-15T10:30:00Z')
            });
            mockService.getRecommendations.mockResolvedValue([mockRecommendation]);
            const result = yield resolver.getVMRecommendations(vmId, mockContext);
            expect(result[0]).toMatchObject({
                id: 'rec-123',
                machineId: vmId,
                snapshotId: 'snapshot-456',
                type: client_1.RecommendationType.DISK_SPACE_LOW,
                text: 'Test recommendation text',
                actionText: 'Test action text',
                data: { testKey: 'testValue' },
                createdAt: new Date('2023-10-15T10:30:00Z')
            });
            // Verify all required GraphQL fields are present
            expect(result[0]).toHaveProperty('id');
            expect(result[0]).toHaveProperty('machineId');
            expect(result[0]).toHaveProperty('type');
            expect(result[0]).toHaveProperty('text');
            expect(result[0]).toHaveProperty('actionText');
            expect(result[0]).toHaveProperty('createdAt');
            // Verify optional fields can be null
            expect(['string', 'object']).toContain(typeof result[0].snapshotId);
            expect(['object']).toContain(typeof result[0].data);
        }));
        it('should handle all RecommendationType enum values', () => __awaiter(void 0, void 0, void 0, function* () {
            const allTypes = Object.values(client_1.RecommendationType);
            const mockRecommendations = allTypes.map((type, index) => (0, recommendation_test_helpers_1.createMockVMRecommendation)({
                id: `rec-${index}`,
                machineId: vmId,
                type,
                text: `Recommendation for ${type}`,
                actionText: `Action for ${type}`
            }));
            mockService.getRecommendations.mockResolvedValue(mockRecommendations);
            const result = yield resolver.getVMRecommendations(vmId, mockContext);
            expect(result).toHaveLength(allTypes.length);
            allTypes.forEach((type, index) => {
                expect(result[index].type).toBe(type);
            });
        }));
    });
});
