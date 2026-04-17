import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import logger from '@main/logger'
import {
  RecommendationChecker,
  RecommendationContext,
  RecommendationResult
} from '../../../../app/services/recommendations/BaseRecommendationChecker'
import { RecommendationType } from '@prisma/client'

/**
 * Concrete implementation for testing the abstract base class.
 * Exposes protected methods via public wrappers for testing.
 */
class TestableChecker extends RecommendationChecker {
  getName (): string { return 'TestChecker' }
  getCategory (): string { return 'test' }
  async analyze (_context: RecommendationContext): Promise<RecommendationResult[]> {
    return []
  }
  // Expose protected methods for testing
  public testParseAndCalculateDaysSince = this.parseAndCalculateDaysSince.bind(this)
  public testExtractDiskSpaceData = this.extractDiskSpaceData.bind(this)
  public testLooksLikeDiskUsageData = this.looksLikeDiskUsageData.bind(this)
}

const createBaseContext = (): RecommendationContext => ({
  vmId: 'test-vm-1',
  latestSnapshot: null,
  historicalMetrics: [],
  recentProcessSnapshots: [],
  portUsage: [],
  machineConfig: null
})

describe('BaseRecommendationChecker', () => {
  let checker: TestableChecker
  let consoleWarnSpy: any
  let consoleDebugSpy: any

  beforeEach(() => {
    checker = new TestableChecker()
    consoleWarnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any)
    consoleDebugSpy = jest.spyOn(logger, 'debug').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleDebugSpy.mockRestore()
  })

  describe('isApplicable', () => {
    it('should return true by default', () => {
      expect(checker.isApplicable(createBaseContext())).toBe(true)
    })
  })

  describe('parseAndCalculateDaysSince', () => {
    it('should return invalid for null/undefined date', () => {
      expect(checker.testParseAndCalculateDaysSince(null)).toEqual({
        isValid: false, date: null, daysSince: null
      })
      expect(checker.testParseAndCalculateDaysSince(undefined)).toEqual({
        isValid: false, date: null, daysSince: null
      })
    })

    it('should return invalid for empty string', () => {
      expect(checker.testParseAndCalculateDaysSince('')).toEqual({
        isValid: false, date: null, daysSince: null
      })
    })

    it('should return invalid for invalid date string', () => {
      expect(checker.testParseAndCalculateDaysSince('not-a-date')).toEqual({
        isValid: false, date: null, daysSince: null
      })
    })

    it('should return 0 days for today', () => {
      const today = new Date().toISOString().split('T')[0]
      const result = checker.testParseAndCalculateDaysSince(today)

      expect(result.isValid).toBe(true)
      expect(result.date).toBeInstanceOf(Date)
      expect(result.daysSince).toBe(0)
    })

    it('should calculate correct days for past date', () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 5)
      const result = checker.testParseAndCalculateDaysSince(pastDate.toISOString())

      expect(result.isValid).toBe(true)
      expect(result.daysSince).toBe(5)
    })

    it('should calculate correct days for dates far in the past', () => {
      const pastDate = new Date()
      pastDate.setDate(pastDate.getDate() - 90)
      const result = checker.testParseAndCalculateDaysSince(pastDate.toISOString())

      expect(result.isValid).toBe(true)
      expect(result.daysSince).toBe(90)
    })

    it('should handle various ISO date formats', () => {
      const result1 = checker.testParseAndCalculateDaysSince('2024-01-15T10:30:00.000Z')
      expect(result1.isValid).toBe(true)

      const result2 = checker.testParseAndCalculateDaysSince('2024-01-15')
      expect(result2.isValid).toBe(true)
    })
  })

  describe('extractDiskSpaceData', () => {
    it('should return null when no latestSnapshot exists', () => {
      const context = createBaseContext()
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).toBeNull()
    })

    it('should return null when diskSpaceInfo is null', () => {
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: { diskSpaceInfo: null } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).toBeNull()
    })

    it('should parse string diskSpaceInfo', () => {
      const diskInfo = JSON.stringify({
        'C:': { used: 80, total: 100, usedGB: 80, totalGB: 100 }
      })
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: { diskSpaceInfo: diskInfo } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).not.toBeNull()
      expect(result!['C:'].usedGB).toBe(80)
      expect(result!['C:'].totalGB).toBe(100)
    })

    it('should parse object diskSpaceInfo (Format 4: direct keyed data)', () => {
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: {
          diskSpaceInfo: {
            'C:': { usedGB: 85, totalGB: 100, available_gb: 15, usage_percent: 85 },
            'D:': { usedGB: 200, totalGB: 500, available_gb: 300, usage_percent: 40 }
          }
        } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).not.toBeNull()
      expect(result!['C:'].usedGB).toBe(85)
      expect(result!['D:'].usedGB).toBe(200)
    })

    it('should parse Format 1: AutoCheckEngine CheckResult', () => {
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: {
          diskSpaceInfo: {
            check_name: 'disk_space',
            details: { drive: '/', free_gb: 10, total_gb: 100, usage_percent: 90 }
          }
        } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).not.toBeNull()
      expect(result!['/'].used_gb).toBe(90) // total - free
      expect(result!['/'].total_gb).toBe(100)
      expect(result!['/'].available_gb).toBe(10)
      expect(result!['/'].mount_point).toBe('/')
    })

    it('should parse Format 2: system_operations disk check with disks array', () => {
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: {
          diskSpaceInfo: {
            status: 'ok',
            disks: [
              { mount_point: '/', total_gb: 100, used_gb: 45, available_gb: 55, usage_percent: 45 },
              { mount_point: '/data', total_gb: 500, used_gb: 400, available_gb: 100, usage_percent: 80 }
            ]
          }
        } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).not.toBeNull()
      expect(result!['/'].used_gb).toBe(45)
      expect(result!['/data'].used_gb).toBe(400)
    })

    it('should parse Format 3: Legacy diskUsage format', () => {
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: {
          diskSpaceInfo: {
            diskUsage: {
              'C:': { used: 80, total: 100 },
              'D:': { used: 200, total: 500 }
            }
          }
        } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).not.toBeNull()
      expect(result!['C:'].used).toBe(80)
      expect(result!['D:'].total).toBe(500)
    })

    it('should return null for invalid diskSpaceInfo', () => {
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: { diskSpaceInfo: 'not-json' } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).toBeNull()
    })

    it('should return null for unrecognised format', () => {
      const context: RecommendationContext = {
        ...createBaseContext(),
        latestSnapshot: { diskSpaceInfo: { foo: 'bar' } } as any
      }
      const result = checker.testExtractDiskSpaceData(context)
      expect(result).toBeNull()
    })

    it('should log debug when no disk space data available', () => {
      const context = createBaseContext()
      checker.testExtractDiskSpaceData(context)

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('No disk space data available')
      )
    })
  })

  describe('looksLikeDiskUsageData', () => {
    it('should return true for objects with used/total', () => {
      expect(checker.testLooksLikeDiskUsageData({
        'C:': { used: 80, total: 100 }
      })).toBe(true)
    })

    it('should return true for objects with usedGB/totalGB', () => {
      expect(checker.testLooksLikeDiskUsageData({
        'C:': { usedGB: 80, totalGB: 100 }
      })).toBe(true)
    })

    it('should return true for objects with used_gb/total_gb', () => {
      expect(checker.testLooksLikeDiskUsageData({
        '/': { used_gb: 80, total_gb: 100 }
      })).toBe(true)
    })

    it('should return false for objects without usage fields', () => {
      expect(checker.testLooksLikeDiskUsageData({
        'C:': { name: 'disk' }
      })).toBe(false)
    })

    it('should return false for null', () => {
      expect(checker.testLooksLikeDiskUsageData(null as any)).toBe(false)
    })

    it('should return false for empty object', () => {
      expect(checker.testLooksLikeDiskUsageData({})).toBe(false)
    })

    it('should return true when mixed used/total variants are present', () => {
      expect(checker.testLooksLikeDiskUsageData({
        'C:': { usedGB: 80, total: 100 }
      })).toBe(true)
    })
  })
})
