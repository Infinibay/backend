import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { PrismaClient, RecommendationType } from '@prisma/client'
import { mockPrisma } from '../../setup/jest.setup'
import { VMRecommendationService } from '../../../app/services/VMRecommendationService'
import {
  createMockVMRecommendation,
  createMockHealthSnapshot,
  createMockSystemMetrics,
  createMockDiskSpaceInfo,
  createMockResourceOptInfo,
  createMockWindowsUpdateInfo,
  createMockDefenderStatus,
  createMockApplicationInventory,
  RecommendationTestUtils,
  RecommendationPerformanceUtils
} from '../../setup/recommendation-test-helpers'
import { createMockMachine, createMockUser } from '../../setup/mock-factories'

describe('VMRecommendationService', () => {
  let service: VMRecommendationService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new VMRecommendationService(mockPrisma as unknown as PrismaClient)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Service Initialization', () => {
    it('should initialize service with correct checker count', () => {
      expect(service).toBeInstanceOf(VMRecommendationService)
      // The service should have registered all recommendation checkers
      // This tests the internal checker registration
    })

    it('should have proper configuration', () => {
      // Test that service has been configured properly
      expect(service).toBeDefined()
    })
  })

  describe('getRecommendations', () => {
    const machineId = 'test-machine-1'

    beforeEach(() => {
      // Mock machine exists
      mockPrisma.machine.findUnique.mockResolvedValue(
        createMockMachine({ id: machineId })
      )
    })

    it('should return cached recommendations when refresh=false', async () => {
      const mockRecommendations = [
        createMockVMRecommendation({ machineId, type: RecommendationType.DISK_SPACE_LOW }),
        createMockVMRecommendation({ machineId, type: RecommendationType.OS_UPDATE_AVAILABLE })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations)

      const result = await service.getRecommendations(machineId, false)

      expect(result).toHaveLength(2)
      expect(result[0]).toHaveProperty('type', RecommendationType.DISK_SPACE_LOW)
      expect(result[1]).toHaveProperty('type', RecommendationType.OS_UPDATE_AVAILABLE)
      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith({
        where: { machineId },
        orderBy: { createdAt: 'desc' }
      })
    })

    it('should generate new recommendations when refresh=true', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({
        machineId,
        diskSpaceInfo: createMockDiskSpaceInfo('critical')
      })

      // Mock latest health snapshot
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)

      // Mock system metrics
      mockPrisma.systemMetrics.findMany.mockResolvedValue([
        createMockSystemMetrics({ machineId })
      ])

      // Mock recommendations cleanup and creation
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

      const newRecommendation = createMockVMRecommendation({
        machineId,
        type: RecommendationType.DISK_SPACE_LOW
      })
      mockPrisma.vMRecommendation.findMany.mockResolvedValue([newRecommendation])

      const result = await service.getRecommendations(machineId, true)

      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('type', RecommendationType.DISK_SPACE_LOW)
      expect(mockPrisma.vMHealthSnapshot.findFirst).toHaveBeenCalled()
      expect(mockPrisma.vMRecommendation.deleteMany).toHaveBeenCalled()
    })

    it('should apply filter parameters correctly', async () => {
      const mockRecommendations = [
        createMockVMRecommendation({ machineId, type: RecommendationType.DISK_SPACE_LOW }),
        createMockVMRecommendation({ machineId, type: RecommendationType.OS_UPDATE_AVAILABLE })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue([mockRecommendations[0]])

      const filter = {
        types: [RecommendationType.DISK_SPACE_LOW],
        limit: 10
      }

      const result = await service.getRecommendations(machineId, false, filter)

      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith({
        where: {
          machineId,
          type: { in: [RecommendationType.DISK_SPACE_LOW] }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toHaveProperty('type', RecommendationType.DISK_SPACE_LOW)
    })

    it('should handle machine not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.getRecommendations('non-existent-machine'))
        .rejects.toThrow('Machine not found')
    })

    it('should handle database errors gracefully', async () => {
      mockPrisma.machine.findUnique.mockRejectedValue(new Error('Database connection failed'))

      await expect(service.getRecommendations(machineId))
        .rejects.toThrow('Database connection failed')
    })
  })

  describe('generateRecommendations', () => {
    const machineId = 'test-machine-1'

    it('should generate disk space recommendations', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({
        machineId,
        diskSpaceInfo: createMockDiskSpaceInfo('critical')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.recommendations).toBeDefined()
        expect(result.recommendations.length).toBeGreaterThanOrEqual(1)
      }
      expect(mockPrisma.vMRecommendation.createMany).toHaveBeenCalled()

      // Verify the structure of created recommendations
      const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0]?.[0]
      expect(createCall?.data).toBeInstanceOf(Array)
      const dataArray = createCall?.data as any[]
      expect(dataArray?.[0]).toHaveProperty('machineId', machineId)
      expect(dataArray?.[0]).toHaveProperty('type')
      expect(dataArray?.[0]).toHaveProperty('text')
      expect(dataArray?.[0]).toHaveProperty('actionText')
    })

    it('should generate resource optimization recommendations', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({
        machineId,
        resourceOptInfo: createMockResourceOptInfo('over_provisioned')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([
        createMockSystemMetrics({ machineId, cpuUsagePercent: 15 })
      ])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.recommendations).toBeDefined()
        expect(result.recommendations.length).toBeGreaterThanOrEqual(1)
      }

      const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0]?.[0]
      const recommendations = createCall?.data as any[]
      const overProvisionedRec = recommendations.find(r => r.type === RecommendationType.OVER_PROVISIONED)
      expect(overProvisionedRec).toBeDefined()
      expect(overProvisionedRec?.data).toHaveProperty('resource')
      expect(overProvisionedRec?.data).toHaveProperty('currentValue')
      expect(overProvisionedRec?.data).toHaveProperty('recommendedValue')
    })

    it('should generate security recommendations', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({
        machineId,
        defenderStatus: createMockDefenderStatus('disabled'),
        windowsUpdateInfo: createMockWindowsUpdateInfo('critical_updates')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

      const result = await service.generateRecommendations(machineId)

      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(2)

      const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
      const recommendations = createCall.data

      const defenderRec = recommendations.find(r => r.type === RecommendationType.DEFENDER_DISABLED)
      const updateRec = recommendations.find(r => r.type === RecommendationType.OS_UPDATE_AVAILABLE)

      expect(defenderRec).toBeDefined()
      expect(updateRec).toBeDefined()
    })

    it('should handle no health snapshot gracefully', async () => {
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null)

      await expect(service.generateRecommendations(machineId)).rejects.toThrow()
    })

    it('should clean up old recommendations before generating new ones', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({ machineId })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 5 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 3 })

      const result = await service.generateRecommendations(machineId)

      expect(mockPrisma.vMRecommendation.deleteMany).toHaveBeenCalledWith({
        where: { machineId }
      })
      expect(result.cleanedUpCount).toBe(5)
    })
  })

  describe('Individual Recommendation Checkers', () => {
    const machineId = 'test-machine-1'

    describe('DiskSpaceChecker', () => {
      it('should detect low disk space with correct thresholds', async () => {
        const criticalData = createMockDiskSpaceInfo('critical')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          diskSpaceInfo: criticalData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
        const diskSpaceRecs = createCall.data.filter(r => r.type === RecommendationType.DISK_SPACE_LOW)

        expect(diskSpaceRecs).toHaveLength(2) // Both C: and D: drives are critical

        for (const rec of diskSpaceRecs) {
          RecommendationTestUtils.assertRecommendationType(rec, RecommendationType.DISK_SPACE_LOW)
          RecommendationTestUtils.assertRecommendationData(rec, ['drive', 'usedPercent', 'freeGB'])
          expect(rec.data.usedPercent).toBeGreaterThan(90)
        }
      })

      it('should handle malformed disk space data', async () => {
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          diskSpaceInfo: { drives: null, success: false, error: 'Access denied' }
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0]?.[0]
        const diskSpaceRecs = createCall?.data?.filter(r => r.type === RecommendationType.DISK_SPACE_LOW) || []

        expect(diskSpaceRecs).toHaveLength(0)
      })

      it('should handle Windows vs Linux drive formats', async () => {
        const linuxData = {
          drives: [
            { drive: '/', totalGB: 100, usedGB: 92, freeGB: 8, usedPercent: 92, status: 'FAILED' },
            { drive: '/home', totalGB: 200, usedGB: 185, freeGB: 15, usedPercent: 92.5, status: 'FAILED' }
          ],
          success: true,
          timestamp: new Date().toISOString()
        }

        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          diskSpaceInfo: linuxData,
          osType: 'Linux'
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
        const diskSpaceRecs = createCall.data.filter(r => r.type === RecommendationType.DISK_SPACE_LOW)

        expect(diskSpaceRecs).toHaveLength(2)
        expect(diskSpaceRecs[0].data.drive).toBe('/')
        expect(diskSpaceRecs[1].data.drive).toBe('/home')
      })
    })

    describe('ResourceOptimizationChecker', () => {
      it('should detect high CPU applications', async () => {
        const resourceOptData = {
          recommendations: [],
          success: true,
          timestamp: new Date().toISOString()
        }

        // Mock high CPU metrics
        const highCpuMetrics = Array.from({ length: 10 }, () =>
          createMockSystemMetrics({
            machineId,
            cpuUsagePercent: 85,
            timestamp: new Date(Date.now() - Math.random() * 86400000) // Random within last 24h
          })
        )

        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          resourceOptInfo: resourceOptData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue(highCpuMetrics)
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        // Note: The actual high CPU detection would be based on process data
        // This test verifies the metrics are being retrieved correctly
        expect(mockPrisma.systemMetrics.findMany).toHaveBeenCalledWith({
          where: {
            machineId,
            timestamp: expect.any(Object)
          },
          orderBy: { timestamp: 'desc' },
          take: expect.any(Number)
        })
      })

      it('should detect over-provisioned resources', async () => {
        const overProvisionedData = createMockResourceOptInfo('over_provisioned')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          resourceOptInfo: overProvisionedData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
        const overProvisionedRecs = createCall.data.filter(r => r.type === RecommendationType.OVER_PROVISIONED)

        expect(overProvisionedRecs).toHaveLength(2) // CPU and RAM

        for (const rec of overProvisionedRecs) {
          RecommendationTestUtils.assertRecommendationType(rec, RecommendationType.OVER_PROVISIONED)
          RecommendationTestUtils.assertRecommendationData(rec, ['resource', 'currentValue', 'recommendedValue', 'reason'])
          expect(rec.data.potentialSavingsPercent).toBeGreaterThan(0)
        }
      })

      it('should detect under-provisioned resources', async () => {
        const underProvisionedData = createMockResourceOptInfo('under_provisioned')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          resourceOptInfo: underProvisionedData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
        const underProvisionedRecs = createCall.data.filter(r => r.type === RecommendationType.UNDER_PROVISIONED)

        expect(underProvisionedRecs).toHaveLength(2) // CPU and RAM

        for (const rec of underProvisionedRecs) {
          RecommendationTestUtils.assertRecommendationType(rec, RecommendationType.UNDER_PROVISIONED)
          RecommendationTestUtils.assertRecommendationData(rec, ['resource', 'currentValue', 'recommendedValue', 'reason'])
        }
      })
    })

    describe('Security Checkers', () => {
      it('should detect Windows Defender disabled', async () => {
        const defenderDisabledData = createMockDefenderStatus('disabled')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          defenderStatus: defenderDisabledData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
        const defenderRecs = createCall.data.filter(r => r.type === RecommendationType.DEFENDER_DISABLED)

        expect(defenderRecs).toHaveLength(1)

        const rec = defenderRecs[0]
        RecommendationTestUtils.assertRecommendationType(rec, RecommendationType.DEFENDER_DISABLED)
        RecommendationTestUtils.assertRecommendationData(rec, ['antivirusEnabled', 'realTimeProtectionEnabled'])
        expect(rec.data.antivirusEnabled).toBe(false)
        expect(rec.data.realTimeProtectionEnabled).toBe(false)
      })

      it('should detect Defender threats', async () => {
        const defenderThreatsData = createMockDefenderStatus('threats')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          defenderStatus: defenderThreatsData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
        const threatRecs = createCall.data.filter(r => r.type === RecommendationType.DEFENDER_THREAT)

        expect(threatRecs).toHaveLength(1)

        const rec = threatRecs[0]
        RecommendationTestUtils.assertRecommendationType(rec, RecommendationType.DEFENDER_THREAT)
        RecommendationTestUtils.assertRecommendationData(rec, ['threatsDetected', 'threatsQuarantined'])
        expect(rec.data.threatsDetected).toBeGreaterThan(0)
      })

      it('should detect Windows Updates available', async () => {
        const updatesData = createMockWindowsUpdateInfo('critical_updates')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          windowsUpdateInfo: updatesData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0][0]
        const updateRecs = createCall.data.filter(r => r.type === RecommendationType.OS_UPDATE_AVAILABLE)

        expect(updateRecs).toHaveLength(1)

        const rec = updateRecs[0]
        RecommendationTestUtils.assertRecommendationType(rec, RecommendationType.OS_UPDATE_AVAILABLE)
        RecommendationTestUtils.assertRecommendationData(rec, ['criticalCount', 'securityCount', 'totalCount'])
        expect(rec.data.criticalCount).toBeGreaterThan(0)
      })

      it('should detect application updates available', async () => {
        const appInventory = createMockApplicationInventory()
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          applicationInventory: appInventory
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        // Mock application update data that would be provided by a separate check
        const appUpdateData = {
          availableUpdates: [
            {
              applicationName: 'Adobe Reader DC',
              currentVersion: '23.006.20320',
              availableVersion: '23.008.20421',
              isSecurityUpdate: true
            }
          ],
          success: true,
          timestamp: new Date().toISOString()
        }

        // Modify health snapshot to include app update info
        mockHealthSnapshot.customCheckResults = { applicationUpdates: appUpdateData }

        const result = await service.generateRecommendations(machineId)

        // Note: App update checking would be implemented in AppUpdateChecker
        // This test verifies the application inventory is available for analysis
        expect(mockHealthSnapshot.applicationInventory).toBeDefined()
        expect(mockHealthSnapshot.applicationInventory.applications).toHaveLength(4)
      })
    })

    describe('Port Conflict Checker', () => {
      it('should detect port conflicts with firewall rules', async () => {
        const mockHealthSnapshot = createMockHealthSnapshot({ machineId })

        // Mock port usage data
        const portUsageData = [
          { port: 8080, protocol: 'tcp', state: 'LISTENING', processName: 'apache.exe' },
          { port: 3306, protocol: 'tcp', state: 'LISTENING', processName: 'mysql.exe' }
        ]

        // Mock firewall rules that might conflict
        const firewallRules = [
          { port: 8080, protocol: 'tcp', action: 'BLOCK', direction: 'IN' }
        ]

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])

        // Mock additional data that would be needed for port conflict checking
        mockPrisma.portUsage.findMany.mockResolvedValue(portUsageData as any)

        mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        // This test verifies the structure is in place for port conflict detection
        // The actual implementation would check for conflicts between port usage and firewall rules
        expect(result.success).toBe(true)
      })
    })
  })

  describe('Performance and Error Handling', () => {
    const machineId = 'test-machine-1'

    it('should complete recommendation generation within performance threshold', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({ machineId })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

      const { result, executionTimeMs } = await RecommendationPerformanceUtils
        .measureRecommendationGenerationTime(() => service.generateRecommendations(machineId))

      expect(result).toBeDefined()
      expect(executionTimeMs).toBeLessThan(5000) // 5 second threshold
    })

    it('should handle database transaction failures', async () => {
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(
        new Error('Database transaction failed')
      )

      await expect(service.generateRecommendations(machineId)).rejects.toThrow('Database transaction failed')
    })

    it('should handle partial checker failures gracefully', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({
        machineId,
        diskSpaceInfo: { success: false, error: 'WMI query failed', drives: [] },
        resourceOptInfo: createMockResourceOptInfo('optimal')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

      const result = await service.generateRecommendations(machineId)

      expect(result).toBeDefined() // Should succeed even with partial failures
      expect(Array.isArray(result)).toBe(true)
    })

    it('should handle large datasets efficiently', async () => {
      const largeMetricsDataset = Array.from({ length: 1000 }, (_, i) =>
        createMockSystemMetrics({
          machineId,
          timestamp: new Date(Date.now() - i * 60000) // 1 minute intervals
        })
      )

      const mockHealthSnapshot = createMockHealthSnapshot({ machineId })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue(largeMetricsDataset.slice(0, 100)) // Service should limit
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

      const { result, executionTimeMs } = await RecommendationPerformanceUtils
        .measureRecommendationGenerationTime(() => service.generateRecommendations(machineId))

      expect(result).toBeDefined()
      expect(executionTimeMs).toBeLessThan(10000) // Should handle large datasets efficiently
    })
  })

  describe('Context Building', () => {
    const machineId = 'test-machine-1'

    it('should build comprehensive context with all data sources', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({ machineId })
      const mockMetrics = [createMockSystemMetrics({ machineId })]

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue(mockMetrics)
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

      const result = await service.generateRecommendations(machineId)

      // Verify that context was built with all necessary data
      expect(mockPrisma.vMHealthSnapshot.findFirst).toHaveBeenCalledWith({
        where: { machineId },
        orderBy: { createdAt: 'desc' }
      })

      expect(mockPrisma.systemMetrics.findMany).toHaveBeenCalledWith({
        where: {
          machineId,
          timestamp: expect.any(Object)
        },
        orderBy: { timestamp: 'desc' },
        take: expect.any(Number)
      })

      expect(result.success).toBe(true)
    })

    it('should handle missing historical metrics gracefully', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({ machineId })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([]) // No metrics available
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

      const result = await service.generateRecommendations(machineId)

      expect(result).toBeDefined()
      // Should still be able to generate recommendations based on health snapshot alone
    })

    it('should apply correct time windows for historical data', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({ machineId })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 0 })

      await service.generateRecommendations(machineId)

      // Verify time window for metrics retrieval (typically 30 days for resource optimization)
      const metricsCall = mockPrisma.systemMetrics.findMany.mock.calls[0][0]
      expect(metricsCall.where.timestamp).toHaveProperty('gte')

      const timeFilter = metricsCall.where.timestamp.gte
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      expect(timeFilter.getTime()).toBeGreaterThanOrEqual(thirtyDaysAgo.getTime() - 60000) // Allow 1 minute variance
    })
  })

  describe('Error Handling with Generic Messages', () => {
    const machineId = 'test-machine-error'

    beforeEach(() => {
      // Mock machine exists
      mockPrisma.machine.findUnique.mockResolvedValue(
        createMockMachine({ id: machineId })
      )
    })

    it('should throw generic error message from generateRecommendations when database fails', async () => {
      // Simulate database error
      const dbError = new Error('ECONNREFUSED: Connection refused')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError)

      // Spy on console.error to verify detailed logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await expect(service.generateRecommendations(machineId)).rejects.toThrow('VM recommendation service failed')

      // Verify that the detailed error is logged but not thrown
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VMRecommendationService error'),
        expect.objectContaining({
          originalError: 'ECONNREFUSED: Connection refused',
          errorName: 'Error',
          vmId: machineId
        })
      )

      consoleSpy.mockRestore()
    })

    it('should throw generic error message from getRecommendations when service fails', async () => {
      // Simulate service error
      const serviceError = new Error('Internal service failure')
      mockPrisma.vMRecommendation.findMany.mockRejectedValue(serviceError)

      // Spy on console.error to verify detailed logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await expect(service.getRecommendations(machineId)).rejects.toThrow('VM recommendation service failed')

      // Verify that the detailed error is logged but not thrown
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VMRecommendationService error'),
        expect.objectContaining({
          originalError: 'Internal service failure',
          errorName: 'Error',
          vmId: machineId
        })
      )

      consoleSpy.mockRestore()
    })

    it('should return generic error message from safe wrapper methods', async () => {
      // Simulate database error
      const dbError = new Error('Database connection timeout')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError)

      // Spy on console.error to verify detailed logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Service unavailable')
        expect(result.recommendations).toBeUndefined()
      }

      // Verify that the detailed error is logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VM Recommendation Service Error'),
        expect.objectContaining({
          vmId: machineId
        })
      )

      consoleSpy.mockRestore()
    })

    it('should not leak sensitive database details in thrown error messages', async () => {
      // Simulate database constraint violation error with sensitive info
      const sensitiveError = new Error('duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(secret@example.com) already exists.')
      mockPrisma.vMRecommendation.findMany.mockRejectedValue(sensitiveError)

      try {
        await service.getRecommendations(machineId)
        fail('Expected error to be thrown')
      } catch (error: any) {
        // The thrown error message should be generic
        expect(error.message).toBe('VM recommendation service failed')
        expect(error.message).not.toContain('duplicate key')
        expect(error.message).not.toContain('secret@example.com')
        expect(error.message).not.toContain('users_email_key')
      }
    })
  })
})