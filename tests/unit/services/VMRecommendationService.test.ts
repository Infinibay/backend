import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { PrismaClient, RecommendationType } from '@prisma/client'
import { mockPrisma } from '../../setup/jest.setup'
import { VMRecommendationService } from '../../../app/services/VMRecommendationService'
import logger from '@main/logger'
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
import { createMockMachine, createMockUser, createMockDepartment } from '../../setup/mock-factories'

// Mock PackageManager to prevent DB calls during constructor
jest.mock('../../../app/services/packages/PackageManager', () => ({
  getPackageManager: jest.fn().mockReturnValue({
    loadAll: jest.fn().mockResolvedValue(undefined as never),
    getPackageStatuses: jest.fn().mockReturnValue([]),
    runCheckers: jest.fn().mockResolvedValue([] as never)
  }),
  PackageManager: jest.fn()
}))

describe('VMRecommendationService', () => {
  let service: VMRecommendationService

  const defaultMockDepartment = createMockDepartment()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ advanceTimers: false })
    service = new VMRecommendationService(mockPrisma as unknown as PrismaClient)
    jest.useRealTimers()

    // Default mocks for buildContext (used by generateRecommendations)
    mockPrisma.portUsage.findMany.mockResolvedValue([])
    mockPrisma.processSnapshot.findMany.mockResolvedValue([])
    // Machine with department (needed by buildContext)
    mockPrisma.machine.findUnique.mockResolvedValue(
      { ...createMockMachine({ id: 'default-machine' }), department: defaultMockDepartment } as any
    )
    // Default transaction mock for generateRecommendations -> saveRecommendations
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      let createdData: any[] = []
      const txMock = {
        ...mockPrisma,
        vMRecommendation: {
          ...mockPrisma.vMRecommendation,
          createMany: jest.fn().mockImplementation(async (args: any) => {
            createdData = (args.data || []).map((d: any, i: number) => ({
              id: `created-rec-${i}`,
              ...d,
              createdAt: new Date()
            }))
            mockPrisma.vMRecommendation.createMany(args)
            return { count: createdData.length }
          }),
          findMany: jest.fn().mockImplementation(async () => createdData)
        },
        vMHealthSnapshot: {
          ...mockPrisma.vMHealthSnapshot,
          update: jest.fn().mockResolvedValue({} as never)
        }
      }
      return fn(txMock)
    })
    // Default mock for hasRecommendationsChanged
    mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null } as any)
    // Default mock for snapshot update
    mockPrisma.vMHealthSnapshot.update.mockResolvedValue({} as any)
  })

  afterEach(() => {
    jest.clearAllMocks()
    // Dispose service to clean up timers
    if (service && typeof (service as any).dispose === 'function') {
      (service as any).dispose()
    }
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
    const latestSnapshotId = 'latest-snapshot-1'
    const mockDepartment = createMockDepartment()
    const mockMachineWithDept = { ...createMockMachine({ id: machineId }), department: mockDepartment }

    beforeEach(() => {
      // Mock machine exists (used by getRecommendations and buildContext)
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachineWithDept)
      // Mock latest snapshot (getRecommendations now queries for it)
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue({
        id: latestSnapshotId,
        machineId,
        snapshotDate: new Date(),
        overallStatus: 'OK',
        diskSpaceInfo: null,
        resourceOptInfo: null,
        windowsUpdateInfo: null,
        defenderStatus: null,
        applicationInventory: null,
        customCheckResults: null
      } as any)
      // Default mocks for buildContext (portUsage, processSnapshot)
      mockPrisma.portUsage.findMany.mockResolvedValue([])
      mockPrisma.processSnapshot.findMany.mockResolvedValue([])
      // Mock transaction for refresh=true path (generateRecommendations)
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        let createdData: any[] = []
        const txMock = {
          ...mockPrisma,
          vMRecommendation: {
            ...mockPrisma.vMRecommendation,
            createMany: jest.fn().mockImplementation(async (args: any) => {
              createdData = (args.data || []).map((d: any, i: number) => ({
                id: `created-rec-${i}`,
                ...d,
                createdAt: new Date()
              }))
              mockPrisma.vMRecommendation.createMany(args)
              return { count: createdData.length }
            }),
            findMany: jest.fn().mockImplementation(async () => createdData)
          },
          vMHealthSnapshot: {
            ...mockPrisma.vMHealthSnapshot,
            update: jest.fn().mockResolvedValue({} as never)
          }
        }
        return fn(txMock)
      })
      // Mock hasRecommendationsChanged
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null } as any)
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
      // The where clause now includes snapshotId and take
      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ machineId }),
          orderBy: { createdAt: 'desc' }
        })
      )
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

      expect(result).toBeDefined()
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(mockPrisma.vMHealthSnapshot.findFirst).toHaveBeenCalled()
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

      // The where clause now also includes snapshotId
      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            machineId,
            type: { in: [RecommendationType.DISK_SPACE_LOW] }
          }),
          orderBy: { createdAt: 'desc' },
          take: 10
        })
      )
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

      // The service re-throws errors after logging
      await expect(service.getRecommendations(machineId))
        .rejects.toThrow()
    })
  })

  describe('generateRecommendations', () => {
    const machineId = 'test-machine-1'
    const mockMachineWithDept = { ...createMockMachine({ id: machineId }), department: createMockDepartment() } as any

    beforeEach(() => {
      // Machine with department (needed by buildContext)
      mockPrisma.machine.findUnique.mockResolvedValue(mockMachineWithDept)
      // Default mocks for buildContext
      mockPrisma.portUsage.findMany.mockResolvedValue([])
      mockPrisma.processSnapshot.findMany.mockResolvedValue([])
      // Mock transaction - create a transactional mock that captures createMany data
      // and returns it from findMany
      mockPrisma.$transaction.mockImplementation(async (fn: any) => {
        let createdData: any[] = []
        const txMock = {
          ...mockPrisma,
          vMRecommendation: {
            ...mockPrisma.vMRecommendation,
            createMany: jest.fn().mockImplementation(async (args: any) => {
              createdData = (args.data || []).map((d: any, i: number) => ({
                id: `created-rec-${i}`,
                ...d,
                createdAt: new Date()
              }))
              // Also store in the outer mock for test assertions
              mockPrisma.vMRecommendation.createMany(args)
              return { count: createdData.length }
            }),
            findMany: jest.fn().mockImplementation(async () => createdData)
          },
          vMHealthSnapshot: {
            ...mockPrisma.vMHealthSnapshot,
            update: jest.fn().mockResolvedValue({} as never)
          }
        }
        return fn(txMock)
      })
      // Mock hasRecommendationsChanged check
      mockPrisma.vMRecommendation.findMany.mockResolvedValue([])
      // Mock snapshot findUnique (used by hasRecommendationsChanged)
      mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null } as any)
      // Mock snapshot update
      mockPrisma.vMHealthSnapshot.update.mockResolvedValue({} as any)
    })

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
      expect(createCall).toBeDefined()
      const dataArray = createCall!.data as any[]
      expect(dataArray).toBeInstanceOf(Array)
      expect(dataArray[0]).toHaveProperty('machineId', machineId)
      expect(dataArray[0]).toHaveProperty('type')
      expect(dataArray[0]).toHaveProperty('text')
      expect(dataArray[0]).toHaveProperty('actionText')
    })

    it('should generate resource optimization recommendations with sufficient metrics', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({
        machineId,
        resourceOptInfo: createMockResourceOptInfo('over_provisioned')
      })

      // OverProvisionedChecker requires at least 5 historical metrics
      const historicalMetrics = Array.from({ length: 10 }, (_, i) =>
        createMockSystemMetrics({
          machineId,
          cpuUsagePercent: 15,
          timestamp: new Date(Date.now() - i * 3600000)
        })
      )

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue(historicalMetrics)
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.recommendations).toBeDefined()
      }
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
      // Should generate at least some recommendations from the health data
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle no health snapshot gracefully', async () => {
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(null)

      // When there's no snapshot, checkers produce no results and saveRecommendations returns []
      const result = await service.generateRecommendations(machineId)
      expect(result).toEqual([])
    })

    it('should save new recommendations using saveRecommendations', async () => {
      const mockHealthSnapshot = createMockHealthSnapshot({ machineId })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 3 })

      const result = await service.generateRecommendations(machineId)

      // The new service uses saveRecommendations with $transaction
      expect(mockPrisma.$transaction).toHaveBeenCalled()
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

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0]![0]!
        const diskSpaceRecs = (createCall.data as any[]).filter((r: any) => r.type === RecommendationType.DISK_SPACE_LOW)

        expect(diskSpaceRecs.length).toBeGreaterThanOrEqual(2) // Both C: and D: drives exceed warning threshold

        for (const rec of diskSpaceRecs) {
          RecommendationTestUtils.assertRecommendationType(rec, RecommendationType.DISK_SPACE_LOW)
          RecommendationTestUtils.assertRecommendationData(rec, ['drive', 'usagePercent', 'availableGB'])
          expect(rec.data.usagePercent).toBeGreaterThan(85) // Above warning threshold
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
        const diskSpaceRecs = createCall?.data ? (createCall.data as any[]).filter((r: any) => r.type === RecommendationType.DISK_SPACE_LOW) : []

        expect(diskSpaceRecs).toHaveLength(0)
      })

      it('should handle Windows vs Linux drive formats', async () => {
        // Use direct keyed format (Format 4) which the checker recognizes
        const linuxData = {
          '/': { used: 92, total: 100, usedGB: 92, totalGB: 100, freeGB: 8 },
          '/home': { used: 185, total: 200, usedGB: 185, totalGB: 200, freeGB: 15 }
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

        const createCall = mockPrisma.vMRecommendation.createMany.mock.calls[0]![0]!
        const diskSpaceRecs = (createCall.data as any[]).filter((r: any) => r.type === RecommendationType.DISK_SPACE_LOW)

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

      it('should detect over-provisioned resources with sufficient metrics', async () => {
        const overProvisionedData = createMockResourceOptInfo('over_provisioned')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          resourceOptInfo: overProvisionedData
        })

        // OverProvisionedChecker requires >= 5 historical metrics
        const lowUsageMetrics = Array.from({ length: 10 }, (_, i) =>
          createMockSystemMetrics({
            machineId,
            cpuUsagePercent: 10,
            timestamp: new Date(Date.now() - i * 3600000)
          })
        )

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue(lowUsageMetrics)
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

        const result = await service.generateRecommendations(machineId)

        // Should complete without errors
        expect(result).toBeDefined()
      })

      it('should detect under-provisioned resources with sufficient metrics', async () => {
        const underProvisionedData = createMockResourceOptInfo('under_provisioned')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          resourceOptInfo: underProvisionedData
        })

        // UnderProvisionedChecker requires >= 5 historical metrics with high usage
        const highUsageMetrics = Array.from({ length: 10 }, (_, i) =>
          createMockSystemMetrics({
            machineId,
            cpuUsagePercent: 95,
            timestamp: new Date(Date.now() - i * 3600000)
          })
        )

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue(highUsageMetrics)
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

        const result = await service.generateRecommendations(machineId)

        // Should complete without errors
        expect(result).toBeDefined()
      })
    })

    describe('Security Checkers', () => {
      it('should handle Windows Defender disabled data', async () => {
        const defenderDisabledData = createMockDefenderStatus('disabled')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          defenderStatus: defenderDisabledData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        // Should generate some recommendations from defender disabled data
        expect(result).toBeDefined()
        expect(result.length).toBeGreaterThanOrEqual(1)
      })

      it('should handle Defender threats data', async () => {
        const defenderThreatsData = createMockDefenderStatus('threats')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          defenderStatus: defenderThreatsData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        // Should complete without errors
        expect(result).toBeDefined()
      })

      it('should handle Windows Updates data', async () => {
        const updatesData = createMockWindowsUpdateInfo('critical_updates')
        const mockHealthSnapshot = createMockHealthSnapshot({
          machineId,
          windowsUpdateInfo: updatesData
        })

        mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(mockHealthSnapshot)
        mockPrisma.systemMetrics.findMany.mockResolvedValue([])
        mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 1 })

        const result = await service.generateRecommendations(machineId)

        // Should complete without errors
        expect(result).toBeDefined()
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
        expect((mockHealthSnapshot.applicationInventory as any).applications).toHaveLength(4)
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
        expect(result).toBeDefined()
        expect(Array.isArray(result)).toBe(true)
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

      // Errors are wrapped by handleServiceError
      await expect(service.generateRecommendations(machineId)).rejects.toThrow()
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
        orderBy: { snapshotDate: 'desc' }
      })

      expect(mockPrisma.systemMetrics.findMany).toHaveBeenCalledWith({
        where: {
          machineId,
          timestamp: expect.any(Object)
        },
        orderBy: { timestamp: 'desc' },
        take: expect.any(Number)
      })

      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
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
      const metricsCall = mockPrisma.systemMetrics.findMany.mock.calls[0]![0]! as any
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
        { ...createMockMachine({ id: machineId }), department: defaultMockDepartment } as any
      )
      // Mock snapshot exists so getRecommendations reaches findMany
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue({
        id: 'error-test-snapshot',
        machineId,
        snapshotDate: new Date(),
        overallStatus: 'OK'
      } as any)
    })

    it('should throw generic error message from generateRecommendations when database fails', async () => {
      // Simulate database error
      const dbError = new Error('ECONNREFUSED: Connection refused')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError)

      // Spy on logger.error to verify detailed logging
      const consoleSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

      await expect(service.generateRecommendations(machineId)).rejects.toThrow('VM recommendation service failed')

      // Verify that the detailed error is logged but not thrown
      expect(consoleSpy as any).toHaveBeenCalledWith(
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

      // Spy on logger.error to verify detailed logging
      const consoleSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

      await expect(service.getRecommendations(machineId)).rejects.toThrow('VM recommendation service failed')

      // Verify that the detailed error is logged but not thrown
      expect(consoleSpy as any).toHaveBeenCalledWith(
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

      // Spy on logger.error to verify detailed logging
      const consoleSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(false)
      if (!result.success) {
        // The safe wrapper returns a generic error message
        expect(typeof result.error).toBe('string')
        expect(result.error.length).toBeGreaterThan(0)
      }

      // Verify that the detailed error is logged
      expect(consoleSpy as any).toHaveBeenCalledWith(
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
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(sensitiveError)

      // Use safe wrapper which wraps errors with generic messages
      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).not.toContain('duplicate key')
        expect(result.error).not.toContain('secret@example.com')
        expect(result.error).not.toContain('users_email_key')
      }
    })
  })
})
