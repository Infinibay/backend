import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { PrismaClient, RecommendationType } from '@prisma/client'
import { mockPrisma } from '../../setup/jest.setup'
import { VMRecommendationResolver } from '../../../app/graphql/resolvers/VMRecommendationResolver'
import { InfinibayContext } from '../../../app/utils/context'
import { RecommendationFilterInput } from '../../../app/graphql/types/RecommendationTypes'
import { createMockVMRecommendation } from '../../setup/recommendation-test-helpers'
import { createMockMachine, createMockUser } from '../../setup/mock-factories'

// Mock the VMRecommendationService
jest.mock('../../../app/services/VMRecommendationService')
const MockVMRecommendationService = require('../../../app/services/VMRecommendationService').VMRecommendationService

describe('VMRecommendationResolver', () => {
  let resolver: VMRecommendationResolver
  let mockContext: InfinibayContext
  let mockService: jest.Mocked<any>

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock service instance
    mockService = {
      getRecommendations: jest.fn(),
      generateRecommendations: jest.fn()
    }

    // Mock the service constructor to return our mock
    MockVMRecommendationService.mockImplementation(() => mockService)

    resolver = new VMRecommendationResolver()

    // Setup mock context
    mockContext = {
      prisma: mockPrisma as unknown as PrismaClient,
      user: createMockUser({ id: 'user-1', role: 'USER' }),
      req: {} as any,
      res: {} as any,
      setupMode: false,
      virtioSocketWatcher: {} as any
    }
  })

  describe('getVMRecommendations Query', () => {
    const vmId = 'test-vm-1'
    const mockMachine = createMockMachine({
      id: vmId,
      userId: 'user-1',
      name: 'test-vm'
    })

    beforeEach(() => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
    })

    describe('Authorization', () => {
      it('should allow user to access their own machine', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.DISK_SPACE_LOW }),
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.OS_UPDATE_AVAILABLE })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        const result = await resolver.getVMRecommendations(vmId, mockContext)

        expect(result).toHaveLength(2)
        expect(result[0]).toHaveProperty('type', RecommendationType.DISK_SPACE_LOW)
        expect(result[1]).toHaveProperty('type', RecommendationType.OS_UPDATE_AVAILABLE)

        expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
          where: { id: vmId },
          select: { id: true, userId: true }
        })
      })

      it('should allow admin to access any machine', async () => {
        const adminContext = {
          ...mockContext,
          user: createMockUser({ id: 'admin-1', role: 'ADMIN' })
        }

        const otherUserMachine = createMockMachine({
          id: vmId,
          userId: 'other-user-1',
          name: 'other-user-vm'
        })

        mockPrisma.machine.findUnique.mockResolvedValue(otherUserMachine)

        const mockRecommendations = [
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.DISK_SPACE_LOW })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        const result = await resolver.getVMRecommendations(vmId, adminContext)

        expect(result).toHaveLength(1)
        expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, undefined)
      })

      it('should deny access to other users machines', async () => {
        const otherUserMachine = createMockMachine({
          id: vmId,
          userId: 'other-user-1',
          name: 'other-user-vm'
        })

        mockPrisma.machine.findUnique.mockResolvedValue(otherUserMachine)

        await expect(resolver.getVMRecommendations(vmId, mockContext))
          .rejects.toThrow('Access denied')

        expect(mockService.getRecommendations).not.toHaveBeenCalled()
      })

      it('should deny access when user is not authenticated', async () => {
        const unauthenticatedContext = {
          ...mockContext,
          user: null
        }

        await expect(resolver.getVMRecommendations(vmId, unauthenticatedContext))
          .rejects.toThrow('Access denied')

        expect(mockService.getRecommendations).not.toHaveBeenCalled()
      })

      it('should throw error when machine not found', async () => {
        mockPrisma.machine.findUnique.mockResolvedValue(null)

        await expect(resolver.getVMRecommendations(vmId, mockContext))
          .rejects.toThrow('Machine not found')

        expect(mockService.getRecommendations).not.toHaveBeenCalled()
      })
    })

    describe('Parameter Handling', () => {
      it('should pass refresh parameter correctly', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.DISK_SPACE_LOW })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        await resolver.getVMRecommendations(vmId, mockContext, true)

        expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, true, undefined)
      })

      it('should default refresh to false when not provided', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.DISK_SPACE_LOW })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        await resolver.getVMRecommendations(vmId, mockContext)

        expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, undefined)
      })

      it('should pass filter parameters correctly', async () => {
        const filter: RecommendationFilterInput = {
          types: [RecommendationType.DISK_SPACE_LOW, RecommendationType.OS_UPDATE_AVAILABLE],
          limit: 10,
          createdAfter: new Date('2023-01-01'),
          createdBefore: new Date('2023-12-31')
        }

        const mockRecommendations = [
          createMockVMRecommendation({
            machineId: vmId,
            type: RecommendationType.DISK_SPACE_LOW,
            createdAt: new Date('2023-06-15')
          })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        await resolver.getVMRecommendations(vmId, mockContext, false, filter)

        expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, filter)
      })

      it('should handle undefined filter gracefully', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.DISK_SPACE_LOW })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        await resolver.getVMRecommendations(vmId, mockContext, false, undefined)

        expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, undefined)
      })
    })

    describe('Service Integration', () => {
      it('should create VMRecommendationService with correct Prisma client', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.DISK_SPACE_LOW })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        await resolver.getVMRecommendations(vmId, mockContext)

        expect(MockVMRecommendationService).toHaveBeenCalledWith(mockContext.prisma)
      })

      it('should return recommendations in correct GraphQL format', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({
            machineId: vmId,
            type: RecommendationType.DISK_SPACE_LOW,
            text: 'Low disk space on drive C:',
            actionText: 'Clean up disk space or add storage',
            data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 }
          }),
          createMockVMRecommendation({
            machineId: vmId,
            type: RecommendationType.OS_UPDATE_AVAILABLE,
            text: 'Critical Windows updates available',
            actionText: 'Install pending Windows updates',
            data: { criticalCount: 3, securityCount: 5 }
          })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        const result = await resolver.getVMRecommendations(vmId, mockContext)

        expect(result).toHaveLength(2)

        // Verify first recommendation
        expect(result[0]).toMatchObject({
          id: expect.any(String),
          machineId: vmId,
          type: RecommendationType.DISK_SPACE_LOW,
          text: 'Low disk space on drive C:',
          actionText: 'Clean up disk space or add storage',
          data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 },
          createdAt: expect.any(Date)
        })

        // Verify second recommendation
        expect(result[1]).toMatchObject({
          id: expect.any(String),
          machineId: vmId,
          type: RecommendationType.OS_UPDATE_AVAILABLE,
          text: 'Critical Windows updates available',
          actionText: 'Install pending Windows updates',
          data: { criticalCount: 3, securityCount: 5 },
          createdAt: expect.any(Date)
        })
      })

      it('should handle empty recommendations list', async () => {
        mockService.getRecommendations.mockResolvedValue([])

        const result = await resolver.getVMRecommendations(vmId, mockContext)

        expect(result).toEqual([])
        expect(result).toHaveLength(0)
      })

      it('should handle service returning null data fields', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({
            machineId: vmId,
            type: RecommendationType.OTHER,
            data: null,
            snapshotId: null
          })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        const result = await resolver.getVMRecommendations(vmId, mockContext)

        expect(result).toHaveLength(1)
        expect(result[0].data).toBeNull()
        expect(result[0].snapshotId).toBeNull()
      })
    })

    describe('Error Handling', () => {
      it('should handle VMRecommendationService initialization failure', async () => {
        MockVMRecommendationService.mockImplementation(() => {
          throw new Error('Service initialization failed')
        })

        await expect(resolver.getVMRecommendations(vmId, mockContext))
          .rejects.toThrow('Failed to fetch recommendations')
      })

      it('should handle service method failures', async () => {
        mockService.getRecommendations.mockRejectedValue(
          new Error('Database connection lost')
        )

        await expect(resolver.getVMRecommendations(vmId, mockContext))
          .rejects.toThrow('Failed to fetch recommendations')
      })

      it('should handle service timeout errors', async () => {
        mockService.getRecommendations.mockRejectedValue(
          new Error('Operation timed out')
        )

        await expect(resolver.getVMRecommendations(vmId, mockContext))
          .rejects.toThrow('Failed to fetch recommendations')
      })

      it('should handle malformed service response', async () => {
        // Service returns invalid data structure
        mockService.getRecommendations.mockResolvedValue([
          { invalidField: 'invalid' } // Missing required fields
        ])

        const result = await resolver.getVMRecommendations(vmId, mockContext)

        // Should still return the data as-is but cast to expected type
        expect(result).toHaveLength(1)
      })

      it('should handle database connection errors', async () => {
        mockPrisma.machine.findUnique.mockRejectedValue(
          new Error('Database connection failed')
        )

        await expect(resolver.getVMRecommendations(vmId, mockContext))
          .rejects.toThrow('Failed to fetch recommendations')

        expect(mockService.getRecommendations).not.toHaveBeenCalled()
      })
    })

    describe('Input Validation', () => {
      it('should handle valid UUID vmId', async () => {
        const uuidVmId = '550e8400-e29b-41d4-a716-446655440000'
        const machineWithUuid = createMockMachine({
          id: uuidVmId,
          userId: 'user-1'
        })

        mockPrisma.machine.findUnique.mockResolvedValue(machineWithUuid)
        mockService.getRecommendations.mockResolvedValue([])

        const result = await resolver.getVMRecommendations(uuidVmId, mockContext)

        expect(result).toEqual([])
        expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
          where: { id: uuidVmId },
          select: { id: true, userId: true }
        })
      })

      it('should handle various vmId formats', async () => {
        const hexVmId = 'abc123def456'
        const machineWithHex = createMockMachine({
          id: hexVmId,
          userId: 'user-1'
        })

        mockPrisma.machine.findUnique.mockResolvedValue(machineWithHex)
        mockService.getRecommendations.mockResolvedValue([])

        const result = await resolver.getVMRecommendations(hexVmId, mockContext)

        expect(result).toEqual([])
      })

      it('should handle empty string vmId', async () => {
        mockPrisma.machine.findUnique.mockResolvedValue(null)

        await expect(resolver.getVMRecommendations('', mockContext))
          .rejects.toThrow('Machine not found')
      })

      it('should validate filter input types', async () => {
        const invalidFilter = {
          types: 'invalid' as any, // Should be array
          limit: 'invalid' as any   // Should be number
        }

        mockService.getRecommendations.mockResolvedValue([])

        // The resolver should pass the filter as-is to the service
        // Type validation is handled by GraphQL schema
        await resolver.getVMRecommendations(vmId, mockContext, false, invalidFilter)

        expect(mockService.getRecommendations).toHaveBeenCalledWith(vmId, false, invalidFilter)
      })
    })

    describe('Performance', () => {
      it('should handle concurrent requests correctly', async () => {
        const mockRecommendations = [
          createMockVMRecommendation({ machineId: vmId, type: RecommendationType.DISK_SPACE_LOW })
        ]

        mockService.getRecommendations.mockResolvedValue(mockRecommendations)

        // Simulate concurrent requests to the same VM
        const promises = Array.from({ length: 5 }, () =>
          resolver.getVMRecommendations(vmId, mockContext)
        )

        const results = await Promise.all(promises)

        expect(results).toHaveLength(5)
        results.forEach(result => {
          expect(result).toHaveLength(1)
          expect(result[0]).toHaveProperty('type', RecommendationType.DISK_SPACE_LOW)
        })

        expect(mockService.getRecommendations).toHaveBeenCalledTimes(5)
      })

      it('should handle large recommendation datasets', async () => {
        // Generate large number of recommendations
        const largeRecommendationSet = Array.from({ length: 100 }, (_, i) =>
          createMockVMRecommendation({
            machineId: vmId,
            type: Object.values(RecommendationType)[i % Object.values(RecommendationType).length] as RecommendationType,
            text: `Recommendation ${i + 1}`,
            actionText: `Action ${i + 1}`
          })
        )

        mockService.getRecommendations.mockResolvedValue(largeRecommendationSet)

        const startTime = Date.now()
        const result = await resolver.getVMRecommendations(vmId, mockContext)
        const endTime = Date.now()

        expect(result).toHaveLength(100)
        expect(endTime - startTime).toBeLessThan(1000) // Should complete within 1 second
      })

      it('should create new service instance per request', async () => {
        mockService.getRecommendations.mockResolvedValue([])

        // Make multiple requests
        await resolver.getVMRecommendations(vmId, mockContext)
        await resolver.getVMRecommendations(vmId, mockContext)

        // Service should be instantiated for each request
        expect(MockVMRecommendationService).toHaveBeenCalledTimes(2)
      })
    })

    describe('Context Usage', () => {
      it('should use context.prisma for service instantiation', async () => {
        mockService.getRecommendations.mockResolvedValue([])

        await resolver.getVMRecommendations(vmId, mockContext)

        expect(MockVMRecommendationService).toHaveBeenCalledWith(mockContext.prisma)
      })

      it('should use context.user for authorization', async () => {
        const userContext = {
          ...mockContext,
          user: createMockUser({ id: 'test-user', role: 'USER' })
        }

        const userMachine = createMockMachine({
          id: vmId,
          userId: 'test-user'
        })

        mockPrisma.machine.findUnique.mockResolvedValue(userMachine)
        mockService.getRecommendations.mockResolvedValue([])

        await resolver.getVMRecommendations(vmId, userContext)

        expect(mockService.getRecommendations).toHaveBeenCalled()
      })

      it('should handle context with missing properties', async () => {
        const incompleteContext = {
          ...mockContext,
          user: undefined
        } as any

        await expect(resolver.getVMRecommendations(vmId, incompleteContext))
          .rejects.toThrow('Access denied')
      })
    })
  })

  describe('GraphQL Type Compliance', () => {
    const vmId = 'test-vm-1'
    const mockMachine = createMockMachine({
      id: vmId,
      userId: 'user-1'
    })

    beforeEach(() => {
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
    })

    it('should return data matching VMRecommendationType schema', async () => {
      const mockRecommendation = createMockVMRecommendation({
        id: 'rec-123',
        machineId: vmId,
        snapshotId: 'snapshot-456',
        type: RecommendationType.DISK_SPACE_LOW,
        text: 'Test recommendation text',
        actionText: 'Test action text',
        data: { testKey: 'testValue' },
        createdAt: new Date('2023-10-15T10:30:00Z')
      })

      mockService.getRecommendations.mockResolvedValue([mockRecommendation])

      const result = await resolver.getVMRecommendations(vmId, mockContext)

      expect(result[0]).toMatchObject({
        id: 'rec-123',
        machineId: vmId,
        snapshotId: 'snapshot-456',
        type: RecommendationType.DISK_SPACE_LOW,
        text: 'Test recommendation text',
        actionText: 'Test action text',
        data: { testKey: 'testValue' },
        createdAt: new Date('2023-10-15T10:30:00Z')
      })

      // Verify all required GraphQL fields are present
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('machineId')
      expect(result[0]).toHaveProperty('type')
      expect(result[0]).toHaveProperty('text')
      expect(result[0]).toHaveProperty('actionText')
      expect(result[0]).toHaveProperty('createdAt')

      // Verify optional fields can be null
      expect(['string', 'object']).toContain(typeof result[0].snapshotId)
      expect(['object']).toContain(typeof result[0].data)
    })

    it('should handle all RecommendationType enum values', async () => {
      const allTypes = Object.values(RecommendationType)
      const mockRecommendations = allTypes.map((type, index) =>
        createMockVMRecommendation({
          id: `rec-${index}`,
          machineId: vmId,
          type,
          text: `Recommendation for ${type}`,
          actionText: `Action for ${type}`
        })
      )

      mockService.getRecommendations.mockResolvedValue(mockRecommendations)

      const result = await resolver.getVMRecommendations(vmId, mockContext)

      expect(result).toHaveLength(allTypes.length)

      allTypes.forEach((type, index) => {
        expect(result[index].type).toBe(type)
      })
    })
  })
})