import {
  VMRecommendation,
  VMHealthSnapshot,
  RecommendationType,
  Machine,
  SystemMetrics
} from '@prisma/client'
import { randomBytes } from 'crypto'

// Types for test data generation
export interface RecommendationInputOverrides {
  id?: string
  machineId?: string
  snapshotId?: string | null
  type?: RecommendationType
  text?: string
  actionText?: string
  data?: Record<string, any> | null
  createdAt?: Date
}

export interface HealthSnapshotInputOverrides {
  id?: string
  machineId?: string
  snapshotDate?: Date
  overallStatus?: string
  diskSpaceInfo?: Record<string, any> | null
  resourceOptInfo?: Record<string, any> | null
  windowsUpdateInfo?: Record<string, any> | null
  defenderStatus?: Record<string, any> | null
  applicationInventory?: Record<string, any> | null
  customCheckResults?: Record<string, any> | null
}

export interface SystemMetricsInputOverrides {
  id?: string
  machineId?: string
  timestamp?: Date
  cpuUsagePercent?: number
  totalMemoryKB?: number
  usedMemoryKB?: number
  availableMemoryKB?: number
  cpuCoresUsage?: number[]
  diskUsageStats?: Record<string, any>
  diskIOStats?: Record<string, any>
  networkStats?: Record<string, any>
  uptime?: number
}

/**
 * Create mock VM recommendation with realistic data
 */
export function createMockVMRecommendation (overrides: RecommendationInputOverrides = {}): VMRecommendation {
  const id = overrides.id || randomBytes(12).toString('hex')
  const machineId = overrides.machineId || randomBytes(12).toString('hex')

  return {
    id,
    machineId,
    snapshotId: overrides.snapshotId !== undefined ? overrides.snapshotId : randomBytes(12).toString('hex'),
    type: overrides.type || RecommendationType.DISK_SPACE_LOW,
    text: overrides.text || 'Disk space is running low on drive C:',
    actionText: overrides.actionText || 'Clean up disk space or add more storage',
    data: overrides.data || {
      drive: 'C:',
      usedPercent: 85,
      freeGB: 5.2,
      threshold: 80
    },
    createdAt: overrides.createdAt || new Date(),
    ...overrides
  } as VMRecommendation
}

/**
 * Create mock health snapshot with comprehensive test data
 */
export function createMockHealthSnapshot (overrides: HealthSnapshotInputOverrides = {}): VMHealthSnapshot {
  const id = overrides.id || randomBytes(12).toString('hex')
  const machineId = overrides.machineId || randomBytes(12).toString('hex')

  return {
    id,
    machineId,
    snapshotDate: overrides.snapshotDate || new Date(),
    overallStatus: overrides.overallStatus || 'HEALTHY',
    checksCompleted: 6,
    checksFailed: 0,
    executionTimeMs: 2500,
    errorSummary: null,
    osType: 'Windows',
    diskSpaceInfo: overrides.diskSpaceInfo || {
      drives: [
        { drive: 'C:', totalGB: 100, usedGB: 45, freeGB: 55, usedPercent: 45, status: 'PASSED' },
        { drive: 'D:', totalGB: 500, usedGB: 150, freeGB: 350, usedPercent: 30, status: 'PASSED' }
      ],
      success: true,
      timestamp: new Date().toISOString()
    },
    resourceOptInfo: overrides.resourceOptInfo || {
      recommendations: [
        {
          resource: 'CPU',
          currentValue: 8,
          recommendedValue: 4,
          reason: 'Low CPU utilization detected',
          potentialSavingsPercent: 50,
          unit: 'cores'
        }
      ],
      success: true,
      timestamp: new Date().toISOString()
    },
    windowsUpdateInfo: overrides.windowsUpdateInfo || {
      pendingUpdatesCount: 3,
      criticalUpdatesCount: 1,
      securityUpdatesCount: 2,
      lastCheckTime: new Date().toISOString(),
      pendingUpdates: [
        { title: 'Security Update KB123456', severity: 'Critical', sizeInMB: 45.2 }
      ],
      success: true,
      timestamp: new Date().toISOString()
    },
    defenderStatus: overrides.defenderStatus || {
      antivirusEnabled: true,
      realTimeProtectionEnabled: true,
      antivirusSignatureLastUpdated: new Date().toISOString(),
      threatsDetected: 0,
      overallStatus: 'PASSED',
      success: true,
      timestamp: new Date().toISOString()
    },
    applicationInventory: overrides.applicationInventory || {
      applications: [
        {
          name: 'Microsoft Office 365',
          version: '16.0.14326',
          publisher: 'Microsoft Corporation',
          installDate: '2023-01-15T00:00:00Z',
          sizeInMB: 2048.5
        },
        {
          name: 'Google Chrome',
          version: '118.0.5993.88',
          publisher: 'Google LLC',
          installDate: '2023-02-01T00:00:00Z',
          sizeInMB: 245.8
        }
      ],
      totalCount: 2,
      success: true,
      timestamp: new Date().toISOString()
    },
    customCheckResults: overrides.customCheckResults || {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as VMHealthSnapshot
}

/**
 * Create mock system metrics for recommendation context
 */
export function createMockSystemMetrics (overrides: SystemMetricsInputOverrides = {}): SystemMetrics {
  const id = overrides.id || randomBytes(12).toString('hex')
  const machineId = overrides.machineId || randomBytes(12).toString('hex')

  return {
    id,
    machineId,
    timestamp: overrides.timestamp || new Date(),
    cpuUsagePercent: overrides.cpuUsagePercent || 25.5,
    totalMemoryKB: overrides.totalMemoryKB || 8388608, // 8GB
    usedMemoryKB: overrides.usedMemoryKB || 4194304, // 4GB
    availableMemoryKB: overrides.availableMemoryKB || 4194304, // 4GB
    cpuCoresUsage: overrides.cpuCoresUsage || [20.1, 15.3, 30.7, 22.8],
    diskUsageStats: overrides.diskUsageStats || {
      'C:': { totalGB: 100, usedGB: 45, freeGB: 55, usedPercent: 45 },
      'D:': { totalGB: 500, usedGB: 150, freeGB: 350, usedPercent: 30 }
    },
    diskIOStats: overrides.diskIOStats || {
      readBytesPerSec: 1048576,
      writeBytesPerSec: 524288,
      diskQueueLength: 2.1
    },
    networkStats: overrides.networkStats || {
      bytesReceivedPerSec: 2097152,
      bytesSentPerSec: 1048576,
      packetsReceivedPerSec: 1500,
      packetsSentPerSec: 1200
    },
    uptime: overrides.uptime || 86400, // 24 hours
    swapTotalKB: 2097152, // 2GB
    swapUsedKB: 0,
    cpuTemperature: 45.5,
    loadAverage: { '1min': 1.2, '5min': 1.1, '15min': 1.0 },
    ...overrides
  } as SystemMetrics
}

/**
 * Create mock disk space data for testing disk space checker
 */
export function createMockDiskSpaceInfo (scenario: 'healthy' | 'warning' | 'critical' = 'healthy') {
  const scenarios = {
    healthy: {
      drives: [
        { drive: 'C:', totalGB: 100, usedGB: 45, freeGB: 55, usedPercent: 45, status: 'PASSED' },
        { drive: 'D:', totalGB: 500, usedGB: 150, freeGB: 350, usedPercent: 30, status: 'PASSED' }
      ]
    },
    warning: {
      drives: [
        { drive: 'C:', totalGB: 100, usedGB: 82, freeGB: 18, usedPercent: 82, status: 'WARNING' },
        { drive: 'D:', totalGB: 500, usedGB: 150, freeGB: 350, usedPercent: 30, status: 'PASSED' }
      ]
    },
    critical: {
      drives: [
        { drive: 'C:', totalGB: 100, usedGB: 92, freeGB: 8, usedPercent: 92, status: 'FAILED' },
        { drive: 'D:', totalGB: 200, usedGB: 185, freeGB: 15, usedPercent: 92.5, status: 'FAILED' }
      ]
    }
  }

  return {
    ...scenarios[scenario],
    success: true,
    timestamp: new Date().toISOString(),
    warningThreshold: 80,
    criticalThreshold: 90
  }
}

/**
 * Create mock resource optimization data
 */
export function createMockResourceOptInfo (scenario: 'over_provisioned' | 'under_provisioned' | 'optimal' = 'optimal') {
  const scenarios = {
    over_provisioned: {
      recommendations: [
        {
          resource: 'CPU',
          currentValue: 8,
          recommendedValue: 4,
          reason: 'Average CPU utilization is only 15% over 30 days',
          potentialSavingsPercent: 50,
          unit: 'cores'
        },
        {
          resource: 'RAM',
          currentValue: 16,
          recommendedValue: 8,
          reason: 'Average RAM utilization is only 35% over 30 days',
          potentialSavingsPercent: 50,
          unit: 'GB'
        }
      ]
    },
    under_provisioned: {
      recommendations: [
        {
          resource: 'CPU',
          currentValue: 2,
          recommendedValue: 4,
          reason: 'High CPU utilization detected (avg 85% over 7 days)',
          potentialSavingsPercent: 0,
          unit: 'cores'
        },
        {
          resource: 'RAM',
          currentValue: 4,
          recommendedValue: 8,
          reason: 'High RAM utilization detected (avg 92% over 7 days)',
          potentialSavingsPercent: 0,
          unit: 'GB'
        }
      ]
    },
    optimal: {
      recommendations: []
    }
  }

  return {
    ...scenarios[scenario],
    evaluationWindowDays: 30,
    overallStatus: 'PASSED',
    success: true,
    timestamp: new Date().toISOString()
  }
}

/**
 * Create mock Windows update data
 */
export function createMockWindowsUpdateInfo (scenario: 'up_to_date' | 'updates_available' | 'critical_updates' = 'up_to_date') {
  const scenarios = {
    up_to_date: {
      pendingUpdatesCount: 0,
      criticalUpdatesCount: 0,
      securityUpdatesCount: 0,
      pendingUpdates: []
    },
    updates_available: {
      pendingUpdatesCount: 5,
      criticalUpdatesCount: 0,
      securityUpdatesCount: 2,
      pendingUpdates: [
        { title: 'Monthly Quality Rollup KB123456', severity: 'Important', sizeInMB: 125.4 },
        { title: 'Security Update KB234567', severity: 'Important', sizeInMB: 45.2 },
        { title: 'Feature Update KB345678', severity: 'Optional', sizeInMB: 2048.8 }
      ]
    },
    critical_updates: {
      pendingUpdatesCount: 8,
      criticalUpdatesCount: 3,
      securityUpdatesCount: 5,
      pendingUpdates: [
        { title: 'Critical Security Update KB111111', severity: 'Critical', sizeInMB: 89.6 },
        { title: 'Critical Security Update KB222222', severity: 'Critical', sizeInMB: 156.3 },
        { title: 'Critical Security Update KB333333', severity: 'Critical', sizeInMB: 203.7 }
      ]
    }
  }

  return {
    ...scenarios[scenario],
    lastCheckTime: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    lastInstallTime: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
    success: true,
    timestamp: new Date().toISOString()
  }
}

/**
 * Create mock Windows Defender status
 */
export function createMockDefenderStatus (scenario: 'healthy' | 'disabled' | 'threats' | 'outdated' = 'healthy') {
  const scenarios = {
    healthy: {
      antivirusEnabled: true,
      antispywareEnabled: true,
      realTimeProtectionEnabled: true,
      antivirusSignatureLastUpdated: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      antivirusSignatureVersion: '1.375.123.0',
      threatsDetected: 0,
      threatsQuarantined: 0,
      lastQuickScanTime: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
      lastFullScanTime: new Date(Date.now() - 86400000 * 7).toISOString(), // 7 days ago
      overallStatus: 'PASSED'
    },
    disabled: {
      antivirusEnabled: false,
      antispywareEnabled: false,
      realTimeProtectionEnabled: false,
      antivirusSignatureLastUpdated: new Date(Date.now() - 86400000 * 30).toISOString(), // 30 days ago
      antivirusSignatureVersion: '1.365.100.0',
      threatsDetected: 0,
      threatsQuarantined: 0,
      lastQuickScanTime: null,
      lastFullScanTime: null,
      overallStatus: 'FAILED'
    },
    threats: {
      antivirusEnabled: true,
      antispywareEnabled: true,
      realTimeProtectionEnabled: true,
      antivirusSignatureLastUpdated: new Date(Date.now() - 3600000).toISOString(),
      antivirusSignatureVersion: '1.375.123.0',
      threatsDetected: 3,
      threatsQuarantined: 2,
      lastQuickScanTime: new Date(Date.now() - 86400000).toISOString(),
      lastFullScanTime: new Date(Date.now() - 86400000 * 7).toISOString(),
      overallStatus: 'WARNING'
    },
    outdated: {
      antivirusEnabled: true,
      antispywareEnabled: true,
      realTimeProtectionEnabled: true,
      antivirusSignatureLastUpdated: new Date(Date.now() - 86400000 * 10).toISOString(), // 10 days ago
      antivirusSignatureVersion: '1.365.100.0',
      threatsDetected: 0,
      threatsQuarantined: 0,
      lastQuickScanTime: new Date(Date.now() - 86400000 * 5).toISOString(),
      lastFullScanTime: new Date(Date.now() - 86400000 * 15).toISOString(),
      overallStatus: 'WARNING'
    }
  }

  return {
    ...scenarios[scenario],
    success: true,
    timestamp: new Date().toISOString()
  }
}

/**
 * Create mock application inventory for testing
 */
export function createMockApplicationInventory () {
  return {
    applications: [
      {
        name: 'Microsoft Office 365',
        version: '16.0.14326.20454',
        publisher: 'Microsoft Corporation',
        installDate: '2023-01-15T00:00:00Z',
        installLocation: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\',
        sizeInMB: 2048.5
      },
      {
        name: 'Google Chrome',
        version: '118.0.5993.88',
        publisher: 'Google LLC',
        installDate: '2023-02-01T00:00:00Z',
        installLocation: 'C:\\Program Files\\Google\\Chrome\\Application\\',
        sizeInMB: 245.8
      },
      {
        name: 'Adobe Reader DC',
        version: '23.006.20320',
        publisher: 'Adobe Inc.',
        installDate: '2023-03-10T00:00:00Z',
        installLocation: 'C:\\Program Files\\Adobe\\Acrobat DC\\',
        sizeInMB: 756.2
      },
      {
        name: 'Visual Studio Code',
        version: '1.83.1',
        publisher: 'Microsoft Corporation',
        installDate: '2023-10-01T00:00:00Z',
        installLocation: 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Microsoft VS Code\\',
        sizeInMB: 312.4
      }
    ],
    totalCount: 4,
    success: true,
    timestamp: new Date().toISOString()
  }
}

/**
 * Test utility functions for recommendation validation
 */
export class RecommendationTestUtils {
  /**
   * Assert that a recommendation has the expected type and structure
   */
  static assertRecommendationType (recommendation: any, expectedType: RecommendationType) {
    expect(recommendation).toHaveProperty('type', expectedType)
    expect(recommendation).toHaveProperty('text')
    expect(recommendation).toHaveProperty('actionText')
    expect(recommendation).toHaveProperty('machineId')
    expect(recommendation).toHaveProperty('createdAt')
    expect(typeof recommendation.text).toBe('string')
    expect(typeof recommendation.actionText).toBe('string')
    expect(recommendation.text.length).toBeGreaterThan(0)
    expect(recommendation.actionText.length).toBeGreaterThan(0)
  }

  /**
   * Assert that recommendation data contains expected fields
   */
  static assertRecommendationData (recommendation: any, expectedDataKeys: string[]) {
    expect(recommendation).toHaveProperty('data')
    expect(recommendation.data).toBeTruthy()

    for (const key of expectedDataKeys) {
      expect(recommendation.data).toHaveProperty(key)
    }
  }

  /**
   * Create a complete test scenario with related data
   */
  static createRecommendationTestScenario (scenarioName: string) {
    const machineId = randomBytes(12).toString('hex')
    const snapshotId = randomBytes(12).toString('hex')

    const scenarios: Record<string, any> = {
      diskSpaceCritical: {
        machine: { id: machineId, name: 'test-vm-1' },
        healthSnapshot: createMockHealthSnapshot({
          id: snapshotId,
          machineId,
          diskSpaceInfo: createMockDiskSpaceInfo('critical')
        }),
        expectedRecommendations: [
          { type: RecommendationType.DISK_SPACE_LOW, dataKeys: ['drive', 'usedPercent', 'freeGB'] }
        ]
      },
      resourceOverProvisioned: {
        machine: { id: machineId, name: 'test-vm-2' },
        healthSnapshot: createMockHealthSnapshot({
          id: snapshotId,
          machineId,
          resourceOptInfo: createMockResourceOptInfo('over_provisioned')
        }),
        expectedRecommendations: [
          { type: RecommendationType.OVER_PROVISIONED, dataKeys: ['resource', 'currentValue', 'recommendedValue'] }
        ]
      },
      securityUpdates: {
        machine: { id: machineId, name: 'test-vm-3' },
        healthSnapshot: createMockHealthSnapshot({
          id: snapshotId,
          machineId,
          windowsUpdateInfo: createMockWindowsUpdateInfo('critical_updates')
        }),
        expectedRecommendations: [
          { type: RecommendationType.OS_UPDATE_AVAILABLE, dataKeys: ['criticalCount', 'securityCount'] }
        ]
      },
      defenderDisabled: {
        machine: { id: machineId, name: 'test-vm-4' },
        healthSnapshot: createMockHealthSnapshot({
          id: snapshotId,
          machineId,
          defenderStatus: createMockDefenderStatus('disabled')
        }),
        expectedRecommendations: [
          { type: RecommendationType.DEFENDER_DISABLED, dataKeys: ['antivirusEnabled', 'realTimeProtectionEnabled'] }
        ]
      }
    }

    return scenarios[scenarioName] || scenarios.diskSpaceCritical
  }
}

/**
 * GraphQL test queries for recommendation testing
 */
export const RECOMMENDATION_TEST_QUERIES = {
  GET_VM_RECOMMENDATIONS: `
    query GetVMRecommendations($vmId: ID!, $refresh: Boolean, $filter: RecommendationFilterInput) {
      getVMRecommendations(vmId: $vmId, refresh: $refresh, filter: $filter) {
        id
        machineId
        snapshotId
        type
        text
        actionText
        data
        createdAt
      }
    }
  `,

  GET_VM_RECOMMENDATIONS_WITH_FILTER: `
    query GetVMRecommendationsFiltered($vmId: ID!, $types: [RecommendationType!]) {
      getVMRecommendations(vmId: $vmId, filter: { types: $types }) {
        id
        type
        text
        actionText
        createdAt
      }
    }
  `,

  GET_VM_RECOMMENDATIONS_WITH_LIMIT: `
    query GetVMRecommendationsLimited($vmId: ID!, $limit: Float) {
      getVMRecommendations(vmId: $vmId, filter: { limit: $limit }) {
        id
        type
        text
        createdAt
      }
    }
  `
}

/**
 * Performance measurement utilities for recommendation testing
 */
export class RecommendationPerformanceUtils {
  /**
   * Measure execution time of recommendation generation
   */
  static async measureRecommendationGenerationTime<T> (
    operation: () => Promise<T>
  ): Promise<{ result: T; executionTimeMs: number }> {
    const startTime = process.hrtime.bigint()
    const result = await operation()
    const endTime = process.hrtime.bigint()
    const executionTimeMs = Number(endTime - startTime) / 1000000

    return { result, executionTimeMs }
  }

  /**
   * Generate large dataset for performance testing
   */
  static createLargeDatasetScenario (vmCount: number = 100, recommendationsPerVm: number = 10) {
    const vms = []
    const recommendations = []

    for (let i = 0; i < vmCount; i++) {
      const machineId = randomBytes(12).toString('hex')
      vms.push({ id: machineId, name: `test-vm-${i}` })

      for (let j = 0; j < recommendationsPerVm; j++) {
        recommendations.push(createMockVMRecommendation({
          machineId,
          type: Object.values(RecommendationType)[j % Object.values(RecommendationType).length] as RecommendationType
        }))
      }
    }

    return { vms, recommendations }
  }
}
