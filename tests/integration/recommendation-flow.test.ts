import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { PrismaClient, RecommendationType, Machine, User, VMHealthSnapshot } from '@prisma/client'
import { mockPrisma } from '../setup/jest.setup'
import { VMRecommendationService } from '../../app/services/VMRecommendationService'
import { VMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { VMRecommendationResolver } from '../../app/graphql/resolvers/VMRecommendationResolver'
import { InfinibayContext } from '../../app/utils/context'
import { buildSchema } from 'type-graphql'
import { graphql } from 'graphql'
import resolvers from '../../app/graphql/resolvers'
import {
  createMockVMRecommendation,
  createMockHealthSnapshot,
  createMockSystemMetrics,
  createMockDiskSpaceInfo,
  createMockResourceOptInfo,
  createMockWindowsUpdateInfo,
  createMockDefenderStatus,
  RecommendationTestUtils,
  RECOMMENDATION_TEST_QUERIES
} from '../setup/recommendation-test-helpers'
import { createMockMachine, createMockUser } from '../setup/mock-factories'

describe('Recommendation Flow Integration Tests', () => {
  let recommendationService: VMRecommendationService
  let healthQueueManager: VMHealthQueueManager
  let resolver: VMRecommendationResolver
  let mockContext: InfinibayContext
  let schema: any

  const testUser = createMockUser({
    id: 'user-integration-test',
    role: 'USER',
    email: 'integration@test.com'
  })

  const testMachine = createMockMachine({
    id: 'machine-integration-test',
    userId: testUser.id,
    name: 'Integration Test VM'
  })

  beforeEach(async () => {
    jest.clearAllMocks()

    // Setup services
    recommendationService = new VMRecommendationService(mockPrisma as unknown as PrismaClient)

    // Mock event manager for health queue manager
    const mockEventManager = {
      dispatchEvent: jest.fn().mockResolvedValue(undefined)
    }

    healthQueueManager = new VMHealthQueueManager(
      mockPrisma as unknown as PrismaClient,
      mockEventManager as any
    )

    resolver = new VMRecommendationResolver()

    // Setup GraphQL schema for integration testing
    schema = await buildSchema({
      resolvers: [VMRecommendationResolver] as any,
      authChecker: ({ context }: { context: InfinibayContext }) => {
        return !!context.user
      }
    })

    // Setup mock context
    mockContext = {
      prisma: mockPrisma as unknown as PrismaClient,
      user: testUser,
      req: {} as any,
      res: {} as any,
      setupMode: false,
      virtioSocketWatcher: {} as any
    }

    // Setup basic mocks
    mockPrisma.user.findUnique.mockResolvedValue(testUser as any)
    mockPrisma.machine.findUnique.mockResolvedValue(testMachine as any)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Complete Recommendation Generation Flow', () => {
    it('should generate recommendations from health check completion', async () => {
      // Step 1: Setup health snapshot data
      const healthSnapshot = createMockHealthSnapshot({
        id: 'snapshot-integration-test',
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('critical'),
        resourceOptInfo: createMockResourceOptInfo('over_provisioned'),
        windowsUpdateInfo: createMockWindowsUpdateInfo('critical_updates'),
        defenderStatus: createMockDefenderStatus('disabled')
      })

      // Step 2: Mock database responses for recommendation generation
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(healthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([
        createMockSystemMetrics({
          machineId: testMachine.id,
          cpuUsagePercent: 15, // Low usage for over-provisioning detection
          timestamp: new Date(Date.now() - 3600000) // 1 hour ago
        })
      ] as any)

      // Mock recommendation cleanup and creation
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })

      // Create expected recommendations based on health data
      const expectedRecommendations = [
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.DISK_SPACE_LOW,
          text: 'Critical disk space warning on drive C:',
          actionText: 'Clean up disk space or expand storage',
          data: { drive: 'C:', usedPercent: 92, freeGB: 8 }
        }),
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.OVER_PROVISIONED,
          text: 'VM appears to be over-provisioned for CPU resources',
          actionText: 'Consider reducing CPU allocation to optimize costs',
          data: { resource: 'CPU', currentValue: 8, recommendedValue: 4 }
        }),
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.OS_UPDATE_AVAILABLE,
          text: 'Critical Windows updates available',
          actionText: 'Install pending security updates immediately',
          data: { criticalCount: 3, securityCount: 5 }
        }),
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.DEFENDER_DISABLED,
          text: 'Windows Defender is disabled',
          actionText: 'Enable Windows Defender real-time protection',
          data: { antivirusEnabled: false, realTimeProtectionEnabled: false }
        })
      ]

      mockPrisma.vMRecommendation.createMany.mockResolvedValue({
        count: expectedRecommendations.length
      })

      // Step 3: Generate recommendations through the service
      const generationResult = await recommendationService.generateRecommendations(testMachine.id)

      expect(generationResult.success).toBe(true)
      expect(generationResult.generatedCount).toBe(expectedRecommendations.length)
      expect(mockPrisma.vMRecommendation.createMany).toHaveBeenCalled()

      // Verify the recommendations were created with correct data
      const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
      const createdRecommendations = createCall.data

      expect(createdRecommendations).toHaveLength(expectedRecommendations.length)

      // Verify disk space recommendation
      const diskSpaceRec = createdRecommendations.find(r => r.type === RecommendationType.DISK_SPACE_LOW)
      expect(diskSpaceRec).toBeDefined()
      RecommendationTestUtils.assertRecommendationType(diskSpaceRec, RecommendationType.DISK_SPACE_LOW)
      RecommendationTestUtils.assertRecommendationData(diskSpaceRec, ['drive', 'usedPercent', 'freeGB'])

      // Verify over-provisioning recommendation
      const overProvisionedRec = createdRecommendations.find(r => r.type === RecommendationType.OVER_PROVISIONED)
      expect(overProvisionedRec).toBeDefined()
      RecommendationTestUtils.assertRecommendationType(overProvisionedRec, RecommendationType.OVER_PROVISIONED)
      RecommendationTestUtils.assertRecommendationData(overProvisionedRec, ['resource', 'currentValue', 'recommendedValue'])

      // Verify security recommendations
      const updateRec = createdRecommendations.find(r => r.type === RecommendationType.OS_UPDATE_AVAILABLE)
      const defenderRec = createdRecommendations.find(r => r.type === RecommendationType.DEFENDER_DISABLED)
      expect(updateRec).toBeDefined()
      expect(defenderRec).toBeDefined()
    })

    it('should handle health check completion triggering recommendation generation', async () => {
      // Setup health snapshot
      const healthSnapshot = createMockHealthSnapshot({
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('warning')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(healthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

      // Simulate health check completion that would trigger recommendation generation
      // This would typically be called by BackgroundHealthService after health checks complete
      const result = await recommendationService.generateRecommendations(testMachine.id)

      expect(result.success).toBe(true)
      expect(mockPrisma.vMHealthSnapshot.findFirst).toHaveBeenCalled()
      expect(mockPrisma.vMRecommendation.deleteMany).toHaveBeenCalledWith({
        where: { machineId: testMachine.id }
      })
    })
  })

  describe('GraphQL Integration Tests', () => {
    it('should execute getVMRecommendations query through GraphQL schema', async () => {
      // Setup mock recommendations
      const mockRecommendations = [
        createMockVMRecommendation({
          id: 'rec-1',
          machineId: testMachine.id,
          type: RecommendationType.DISK_SPACE_LOW,
          text: 'Low disk space detected',
          actionText: 'Clean up files or expand storage',
          data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 },
          createdAt: new Date('2023-10-15T10:30:00Z')
        }),
        createMockVMRecommendation({
          id: 'rec-2',
          machineId: testMachine.id,
          type: RecommendationType.OS_UPDATE_AVAILABLE,
          text: 'Security updates available',
          actionText: 'Install Windows updates',
          data: { criticalCount: 2, securityCount: 3 },
          createdAt: new Date('2023-10-15T11:00:00Z')
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations as any)

      // Execute GraphQL query
      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: {
          vmId: testMachine.id,
          refresh: false
        },
        contextValue: mockContext
      })

      expect(result.errors).toBeUndefined()
      expect(result.data).toBeDefined()
      expect(result.data?.getVMRecommendations).toHaveLength(2)

      const recommendations = result.data?.getVMRecommendations

      // Verify first recommendation
      expect(recommendations[0]).toMatchObject({
        id: 'rec-1',
        machineId: testMachine.id,
        type: 'DISK_SPACE_LOW',
        text: 'Low disk space detected',
        actionText: 'Clean up files or expand storage',
        data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 }
      })

      // Verify second recommendation
      expect(recommendations[1]).toMatchObject({
        id: 'rec-2',
        machineId: testMachine.id,
        type: 'OS_UPDATE_AVAILABLE',
        text: 'Security updates available',
        actionText: 'Install Windows updates',
        data: { criticalCount: 2, securityCount: 3 }
      })
    })

    it('should execute filtered recommendations query', async () => {
      const diskSpaceRecommendations = [
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.DISK_SPACE_LOW,
          text: 'Disk space low on C:'
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(diskSpaceRecommendations as any)

      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
        variableValues: {
          vmId: testMachine.id,
          types: ['DISK_SPACE_LOW']
        },
        contextValue: mockContext
      })

      expect(result.errors).toBeUndefined()
      expect(result.data?.getVMRecommendations).toHaveLength(1)
      expect(result.data?.getVMRecommendations[0].type).toBe('DISK_SPACE_LOW')

      // Verify service was called with correct filter
      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith({
        where: {
          machineId: testMachine.id,
          type: { in: [RecommendationType.DISK_SPACE_LOW] }
        },
        orderBy: { createdAt: 'desc' }
      })
    })

    it('should handle authorization in GraphQL queries', async () => {
      // Test unauthorized access
      const unauthorizedContext = {
        ...mockContext,
        user: null
      }

      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: testMachine.id },
        contextValue: unauthorizedContext
      })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].message).toContain('Not authorized')
    })

    it('should handle machine not found in GraphQL queries', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: 'non-existent-machine' },
        contextValue: mockContext
      })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].message).toBe('Machine not found')
    })
  })

  describe('Real-World Scenario Integration Tests', () => {
    it('should handle complete disk cleanup scenario', async () => {
      // Scenario: VM has critical disk space, recommendations generated, user takes action

      // Step 1: Critical disk space detected
      const criticalHealthSnapshot = createMockHealthSnapshot({
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('critical')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(criticalHealthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 }) // Both C: and D: drives

      // Generate initial recommendations
      const initialResult = await recommendationService.generateRecommendations(testMachine.id)
      expect(initialResult.success).toBe(true)
      expect(initialResult.generatedCount).toBe(2)

      // Step 2: User views recommendations
      const criticalRecommendations = [
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.DISK_SPACE_LOW,
          data: { drive: 'C:', usedPercent: 92, freeGB: 8 }
        }),
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.DISK_SPACE_LOW,
          data: { drive: 'D:', usedPercent: 92.5, freeGB: 15 }
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(criticalRecommendations as any)

      const viewResult = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: testMachine.id },
        contextValue: mockContext
      })

      expect(viewResult.data?.getVMRecommendations).toHaveLength(2)
      expect(viewResult.data?.getVMRecommendations.every(r => r.type === 'DISK_SPACE_LOW')).toBe(true)

      // Step 3: After user cleans up disk, health check runs again
      const improvedHealthSnapshot = createMockHealthSnapshot({
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('healthy') // Disk space now healthy
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(improvedHealthSnapshot as any)
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 2 }) // Remove old recommendations
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 }) // No new recommendations

      // Generate updated recommendations
      const updatedResult = await recommendationService.generateRecommendations(testMachine.id)
      expect(updatedResult.success).toBe(true)
      expect(updatedResult.generatedCount).toBe(0) // No more disk space issues
      expect(updatedResult.cleanedUpCount).toBe(2) // Old recommendations cleaned up

      // Step 4: User refreshes view, sees no more disk space recommendations
      mockPrisma.vMRecommendation.findMany.mockResolvedValue([])

      const refreshResult = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: testMachine.id, refresh: true },
        contextValue: mockContext
      })

      expect(refreshResult.data?.getVMRecommendations).toHaveLength(0)
    })

    it('should handle multi-category recommendation scenario', async () => {
      // Scenario: VM has multiple issues across different categories

      const complexHealthSnapshot = createMockHealthSnapshot({
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('warning'),
        resourceOptInfo: createMockResourceOptInfo('over_provisioned'),
        windowsUpdateInfo: createMockWindowsUpdateInfo('updates_available'),
        defenderStatus: createMockDefenderStatus('outdated')
      })

      // Historical metrics showing over-provisioning
      const historicalMetrics = Array.from({ length: 30 }, (_, i) =>
        createMockSystemMetrics({
          machineId: testMachine.id,
          cpuUsagePercent: 12 + Math.random() * 8, // Low CPU usage
          timestamp: new Date(Date.now() - i * 86400000) // Daily intervals
        })
      )

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(complexHealthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue(historicalMetrics as any)
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 5 })

      const result = await recommendationService.generateRecommendations(testMachine.id)

      expect(result.success).toBe(true)
      expect(result.generatedCount).toBe(5) // Multiple categories of recommendations

      // Verify service retrieves historical data for resource analysis
      expect(mockPrisma.systemMetrics.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            machineId: testMachine.id,
            timestamp: expect.objectContaining({
              gte: expect.any(Date)
            })
          }),
          orderBy: { timestamp: 'desc' },
          take: expect.any(Number)
        })
      )

      // Verify all recommendation categories are created
      const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
      const recommendations = createCall.data

      const recommendationTypes = recommendations.map(r => r.type)
      expect(recommendationTypes).toContain(RecommendationType.DISK_SPACE_LOW)
      expect(recommendationTypes).toContain(RecommendationType.OVER_PROVISIONED)
      expect(recommendationTypes).toContain(RecommendationType.OS_UPDATE_AVAILABLE)
    })

    it('should handle concurrent recommendation requests', async () => {
      // Scenario: Multiple users or processes request recommendations simultaneously

      const healthSnapshot = createMockHealthSnapshot({
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('critical')
      })

      const mockRecommendations = [
        createMockVMRecommendation({
          machineId: testMachine.id,
          type: RecommendationType.DISK_SPACE_LOW
        })
      ]

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(healthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations as any)

      // Simulate concurrent requests
      const concurrentRequests = Array.from({ length: 5 }, () =>
        graphql({
          schema,
          source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
          variableValues: { vmId: testMachine.id },
          contextValue: mockContext
        })
      )

      const results = await Promise.all(concurrentRequests)

      // All requests should succeed
      results.forEach(result => {
        expect(result.errors).toBeUndefined()
        expect(result.data?.getVMRecommendations).toHaveLength(1)
        expect(result.data?.getVMRecommendations[0].type).toBe('DISK_SPACE_LOW')
      })

      // Verify database was called for each request
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledTimes(5)
      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledTimes(5)
    })
  })

  describe('Performance Integration Tests', () => {
    it('should handle large recommendation datasets efficiently', async () => {
      // Generate large number of recommendations
      const largeRecommendationSet = Array.from({ length: 100 }, (_, i) => {
        const types = Object.values(RecommendationType)
        return createMockVMRecommendation({
          id: `rec-${i}`,
          machineId: testMachine.id,
          type: types[i % types.length] as RecommendationType,
          text: `Recommendation ${i + 1}`,
          actionText: `Action ${i + 1}`,
          createdAt: new Date(Date.now() - i * 60000) // 1 minute intervals
        })
      })

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(largeRecommendationSet as any)

      const startTime = Date.now()

      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: testMachine.id },
        contextValue: mockContext
      })

      const endTime = Date.now()
      const executionTime = endTime - startTime

      expect(result.errors).toBeUndefined()
      expect(result.data?.getVMRecommendations).toHaveLength(100)
      expect(executionTime).toBeLessThan(2000) // Should complete within 2 seconds
    })

    it('should handle recommendation generation under load', async () => {
      const healthSnapshot = createMockHealthSnapshot({
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('critical')
      })

      // Large historical dataset
      const largeMetricsSet = Array.from({ length: 1000 }, (_, i) =>
        createMockSystemMetrics({
          machineId: testMachine.id,
          timestamp: new Date(Date.now() - i * 3600000) // Hourly intervals
        })
      )

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(healthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue(largeMetricsSet.slice(0, 100) as any) // Service should limit
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

      const startTime = Date.now()
      const result = await recommendationService.generateRecommendations(testMachine.id)
      const endTime = Date.now()
      const executionTime = endTime - startTime

      expect(result.success).toBe(true)
      expect(executionTime).toBeLessThan(5000) // Should complete within 5 seconds even with large datasets
    })
  })

  describe('Error Handling Integration Tests', () => {
    it('should handle database failures gracefully in complete flow', async () => {
      // Simulate database failure during recommendation retrieval
      mockPrisma.vMRecommendation.findMany.mockRejectedValue(
        new Error('Database connection lost')
      )

      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: testMachine.id },
        contextValue: mockContext
      })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].message).toBe('Failed to fetch recommendations')
    })

    it('should handle partial data corruption gracefully', async () => {
      // Simulate corrupted health snapshot data
      const corruptedHealthSnapshot = {
        ...createMockHealthSnapshot({ machineId: testMachine.id }),
        diskSpaceInfo: null, // Corrupted data
        resourceOptInfo: { success: false, error: 'WMI query failed' }
      }

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(corruptedHealthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

      const result = await recommendationService.generateRecommendations(testMachine.id)

      expect(result.success).toBe(true) // Should still succeed with partial data
      expect(result.generatedCount).toBe(0) // But generate no recommendations from corrupted data
    })

    it('should handle service timeouts in integration flow', async () => {
      // Simulate service timeout
      jest.setTimeout(30000) // Extend timeout for this test

      const slowHealthSnapshot = createMockHealthSnapshot({
        machineId: testMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('critical')
      })

      // Simulate slow database response
      mockPrisma.vMHealthSnapshot.findFirst.mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve(slowHealthSnapshot as any), 100))
      )
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

      const startTime = Date.now()
      const result = await recommendationService.generateRecommendations(testMachine.id)
      const endTime = Date.now()

      expect(result.success).toBe(true)
      expect(endTime - startTime).toBeGreaterThan(100) // Verify the delay was applied
      expect(endTime - startTime).toBeLessThan(5000) // But still completed reasonably quickly
    })
  })
})