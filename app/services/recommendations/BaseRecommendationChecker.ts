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
  used_gb?: number
  total?: number
  totalGB?: number
  total_gb?: number
  available_gb?: number
  usage_percent?: number
  mount_point?: string
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
        const raw = typeof context.latestSnapshot.diskSpaceInfo === 'string'
          ? JSON.parse(context.latestSnapshot.diskSpaceInfo)
          : context.latestSnapshot.diskSpaceInfo

        if (raw && typeof raw === 'object') {
          const parsed = this.parseDiskFormats(raw)
          if (parsed) return parsed
        }
      } catch (error) {
        console.warn('Failed to parse diskSpaceInfo:', error)
      }
    }

    console.debug('VM Recommendations: No disk space data available for analysis')
    return null
  }

  private parseDiskFormats (data: Record<string, unknown>): Record<string, DiskUsageData> | null {
    // Format 1: AutoCheckEngine CheckResult
    // { check_name: "disk_space", details: { drive: "/", free_gb: 5, total_gb: 100, usage_percent: 95 } }
    if (data.check_name === 'disk_space' && data.details && typeof data.details === 'object') {
      const details = data.details as Record<string, unknown>
      const drive = (details.drive as string) || '/'
      const totalGb = Number(details.total_gb) || 0
      const freeGb = Number(details.free_gb) || 0
      const usedGb = totalGb - freeGb
      return {
        [drive]: {
          used_gb: usedGb,
          total_gb: totalGb,
          available_gb: freeGb,
          usage_percent: Number(details.usage_percent) || 0,
          mount_point: drive
        }
      }
    }

    // Format 2: system_operations disk check
    // { status: "ok", disks: [{ mount_point: "/", total_gb: 100, used_gb: 45, available_gb: 55, usage_percent: 45 }] }
    if (Array.isArray(data.disks)) {
      const result: Record<string, DiskUsageData> = {}
      for (const disk of data.disks) {
        if (disk && typeof disk === 'object') {
          const d = disk as Record<string, unknown>
          const mountPoint = (d.mount_point as string) || '/'
          result[mountPoint] = {
            used_gb: Number(d.used_gb) || 0,
            total_gb: Number(d.total_gb) || 0,
            available_gb: Number(d.available_gb) || 0,
            usage_percent: Number(d.usage_percent) || 0,
            mount_point: mountPoint
          }
        }
      }
      if (Object.keys(result).length > 0) return result
    }

    // Format 3: Legacy { diskUsage: { "C:": { used, total } } }
    const diskSpaceData = data as DiskSpaceInfo
    if (diskSpaceData.diskUsage && typeof diskSpaceData.diskUsage === 'object') {
      return diskSpaceData.diskUsage
    }

    // Format 4: Direct keyed data { "C:": { used, total } } or { "/": { used_gb, total_gb } }
    if (this.looksLikeDiskUsageData(data)) {
      return data as Record<string, DiskUsageData>
    }

    return null
  }

  protected looksLikeDiskUsageData (data: Record<string, unknown>): boolean {
    if (!data || typeof data !== 'object') return false

    for (const [, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        const usage = value as Record<string, unknown>
        if ((usage.used !== undefined || usage.usedGB !== undefined || usage.used_gb !== undefined) &&
            (usage.total !== undefined || usage.totalGB !== undefined || usage.total_gb !== undefined)) {
          return true
        }
      }
    }
    return false
  }
}
