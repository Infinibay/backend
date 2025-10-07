import { PrismaClient, Machine, VMHealthSnapshot, SystemMetrics, ProcessSnapshot, PortUsage, VMRecommendation, RecommendationType } from '@prisma/client'

export interface AppUpdateInfo {
  name: string | undefined
  currentVersion: string | undefined
  availableVersion: string | undefined
  isSecurityUpdate: boolean
}

export interface ThreatTimelineInfo {
  name: string | null
  detectionTime: string | null
  status: string | null
  severity: string | number | null
}

export interface RecommendationData {
  [key: string]: string | number | boolean | null | undefined | (string | undefined)[] | AppUpdateInfo[] | ThreatTimelineInfo[] | string[]
}

export interface ProcessData {
  name?: string
  processName?: string
  executablePath?: string
  path?: string
  cpuPercent?: string | number
  cpu?: string | number
  memoryKB?: string | number
  memory?: string | number
  pid?: string | number
  processId?: string | number
  sampleCount?: number
  maxCpu?: number
  maxMemory?: number
}

export interface DiskUsageData {
  used?: number
  usedGB?: number
  total?: number
  totalGB?: number
}

export interface DiskSpaceInfo {
  diskUsage?: Record<string, DiskUsageData>
  [key: string]: unknown
}

export interface RecommendationResult {
  type: RecommendationType
  text: string
  actionText: string
  data?: RecommendationData
}

export interface RecommendationContext {
  vmId: string
  latestSnapshot?: VMHealthSnapshot | null
  historicalMetrics: SystemMetrics[]
  recentProcessSnapshots: ProcessSnapshot[]
  portUsage: PortUsage[]
  machineConfig: Machine | null
}

export abstract class RecommendationChecker {
  abstract analyze(context: RecommendationContext): Promise<RecommendationResult[]>
  abstract getName(): string
  abstract getCategory(): string

  isApplicable (context: RecommendationContext): boolean {
    return true
  }

  protected parseAndCalculateDaysSince (dateString: string | null | undefined): { isValid: true; date: Date; daysSince: number } | { isValid: false; date: null; daysSince: null } {
    if (!dateString) {
      return { isValid: false, date: null, daysSince: null }
    }

    try {
      const parsedDate = new Date(dateString)

      if (isNaN(parsedDate.getTime())) {
        return { isValid: false, date: null, daysSince: null }
      }

      const nowUtc = new Date()
      const parsedUtc = new Date(parsedDate.getTime())

      const nowUtcMidnight = Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate())
      const parsedUtcMidnight = Date.UTC(parsedUtc.getUTCFullYear(), parsedUtc.getUTCMonth(), parsedUtc.getUTCDate())

      const daysSince = Math.floor((nowUtcMidnight - parsedUtcMidnight) / (1000 * 60 * 60 * 24))

      return { isValid: true, date: parsedDate, daysSince }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse date string:', dateString, error)
      return { isValid: false, date: null, daysSince: null }
    }
  }

  protected extractDiskSpaceData (context: RecommendationContext): Record<string, DiskUsageData> | null {
    if (context.latestSnapshot?.diskSpaceInfo) {
      try {
        const diskSpaceData = typeof context.latestSnapshot.diskSpaceInfo === 'string'
          ? JSON.parse(context.latestSnapshot.diskSpaceInfo) as DiskSpaceInfo
          : context.latestSnapshot.diskSpaceInfo as DiskSpaceInfo

        if (diskSpaceData && typeof diskSpaceData === 'object') {
          if (diskSpaceData.diskUsage && typeof diskSpaceData.diskUsage === 'object') {
            return diskSpaceData.diskUsage
          }
          if (this.looksLikeDiskUsageData(diskSpaceData)) {
            return diskSpaceData as Record<string, DiskUsageData>
          }
        }
      } catch (error) {
        console.warn('Failed to parse diskSpaceInfo:', error)
      }
    }

    console.debug('VM Recommendations: No disk space data available for analysis')
    return null
  }

  protected looksLikeDiskUsageData (data: Record<string, unknown>): boolean {
    if (!data || typeof data !== 'object') return false

    for (const [, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        const usage = value as Record<string, unknown>
        if ((usage.used !== undefined || usage.usedGB !== undefined) &&
            (usage.total !== undefined || usage.totalGB !== undefined)) {
          return true
        }
      }
    }
    return false
  }
}
