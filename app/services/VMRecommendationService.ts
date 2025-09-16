import { PrismaClient, Machine, VMHealthSnapshot, SystemMetrics, ProcessSnapshot, PortUsage, VMNWFilter, FWRule, VMRecommendation, RecommendationType, Prisma, VmPort, DepartmentNWFilter } from '@prisma/client'
import { RecommendationFilterInput } from '../graphql/types/RecommendationTypes'
import { AppError, ErrorCode, ErrorContext } from '../utils/errors/ErrorHandler'

interface AppUpdateInfo {
  name: string | undefined
  currentVersion: string | undefined
  availableVersion: string | undefined
  isSecurityUpdate: boolean
}

interface ThreatTimelineInfo {
  name: string | null
  detectionTime: string | null
  status: string | null
  severity: string | number | null
}

export interface RecommendationData {
  [key: string]: string | number | boolean | null | undefined | (string | undefined)[] | AppUpdateInfo[] | ThreatTimelineInfo[] | string[]
}

export type RecommendationOperationResult = {
  success: true;
  recommendations: VMRecommendation[];
} | {
  success: false;
  error: string; // generic, e.g., 'Service unavailable' or 'Failed to generate recommendations'
}

interface ProcessData {
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
  // Additional fields for ProcessSnapshot aggregation
  sampleCount?: number
  maxCpu?: number
  maxMemory?: number
}

interface DiskUsageData {
  used?: number
  usedGB?: number
  total?: number
  totalGB?: number
}

interface DiskSpaceInfo {
  diskUsage?: Record<string, DiskUsageData>
  [key: string]: unknown
}

interface ApplicationInventoryData {
  processes?: ProcessData[]
  [key: string]: unknown
}

interface ResourceOptInfo {
  processes?: ProcessData[]
  [key: string]: unknown
}

interface WindowsUpdate {
  title?: string
  name?: string
  kb_number?: string
  severity?: string
  importance?: string
  is_security_update?: boolean
  security?: boolean
  size_bytes?: number
  download_size?: number
}

interface UpdateStatus {
  pending_updates?: WindowsUpdate[]
  reboot_required?: boolean
  automatic_updates_enabled?: boolean
  last_check_date?: string
  pending_reboot_updates?: number
}

interface Application {
  name?: string
  app_name?: string
  version?: string
  current_version?: string
  update_available?: string
  new_version?: string
  is_security_update?: boolean
  update_source?: string
  update_size_bytes?: number
}

interface ApplicationInventory {
  applications?: Application[]
}

interface ThreatInfo {
  name?: string
  threat_name?: string
  status?: string
  severity_id?: number
  detection_time?: string
  detected_at?: string
  quarantine_time?: string
}

interface DefenderStatus {
  enabled?: boolean
  real_time_protection?: boolean
  signature_age_days?: number
  threats_detected?: number
  recent_threats?: ThreatInfo[]
  last_quick_scan?: string
  last_full_scan?: string
  last_signature_update?: string
  engine_version?: string
  scan_history?: unknown[]
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
  firewallFilters: (VMNWFilter & { nwFilter: { rules: FWRule[] } })[]
  machineConfig: Machine | null
  vmPorts: VmPort[]
}

export abstract class RecommendationChecker {
  abstract analyze(context: RecommendationContext): Promise<RecommendationResult[]>
  abstract getName(): string
  abstract getCategory(): string

  // Default implementation allows all checkers to run
  // Subclasses can override to check context-specific conditions (e.g., OS type, available data)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isApplicable (context: RecommendationContext): boolean {
    return true
  }

  /**
   * Safely parse a date string and calculate days since now using UTC
   * @param dateString - The date string to parse
   * @returns Object with isValid, date, and daysSince properties, or null if invalid
   */
  protected parseAndCalculateDaysSince (dateString: string | null | undefined): { isValid: true; date: Date; daysSince: number } | { isValid: false; date: null; daysSince: null } {
    if (!dateString) {
      return { isValid: false, date: null, daysSince: null }
    }

    try {
      const parsedDate = new Date(dateString)

      // Validate that the date is valid
      if (isNaN(parsedDate.getTime())) {
        return { isValid: false, date: null, daysSince: null }
      }

      // Use UTC calculations for consistent day comparisons across timezones
      const nowUtc = new Date()
      const parsedUtc = new Date(parsedDate.getTime())

      // Calculate days using UTC dates to avoid timezone issues
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
    // Try primary source: diskSpaceInfo
    if (context.latestSnapshot?.diskSpaceInfo) {
      try {
        const diskSpaceData = typeof context.latestSnapshot.diskSpaceInfo === 'string'
          ? JSON.parse(context.latestSnapshot.diskSpaceInfo) as DiskSpaceInfo
          : context.latestSnapshot.diskSpaceInfo as DiskSpaceInfo

        if (diskSpaceData && typeof diskSpaceData === 'object') {
          // Try structured format first
          if (diskSpaceData.diskUsage && typeof diskSpaceData.diskUsage === 'object') {
            return diskSpaceData.diskUsage
          }
          // Fallback: treat entire object as disk usage data if it has drive-like keys
          if (this.looksLikeDiskUsageData(diskSpaceData)) {
            return diskSpaceData as Record<string, DiskUsageData>
          }
        }
      } catch (error) {
        console.warn('Failed to parse diskSpaceInfo:', error)
      }
    }

    // If no disk data available, log for debugging
    console.debug('VM Recommendations: No disk space data available for analysis')
    return null
  }

  protected looksLikeDiskUsageData (data: Record<string, unknown>): boolean {
    if (!data || typeof data !== 'object') return false

    // Check if it has at least one entry that looks like disk usage
    for (const [, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        const usage = value as Record<string, unknown>
        // Check for common disk usage properties
        if ((usage.used !== undefined || usage.usedGB !== undefined) &&
            (usage.total !== undefined || usage.totalGB !== undefined)) {
          return true
        }
      }
    }
    return false
  }
}

class DiskSpaceChecker extends RecommendationChecker {
  getName (): string { return 'DiskSpaceChecker' }
  getCategory (): string { return 'Storage' }

  private getCriticalThreshold (): number {
    return parseInt(process.env.DISK_SPACE_CRITICAL_THRESHOLD || '95', 10)
  }

  private getWarningThreshold (): number {
    return parseInt(process.env.DISK_SPACE_WARNING_THRESHOLD || '85', 10)
  }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []
    const criticalThreshold = this.getCriticalThreshold()
    const warningThreshold = this.getWarningThreshold()

    console.debug(`VM Recommendations: DiskSpaceChecker using thresholds - Critical: ${criticalThreshold}%, Warning: ${warningThreshold}%`)

    const diskUsage = this.extractDiskSpaceData(context)
    if (!diskUsage) {
      return results
    }

    try {
      for (const [drive, usage] of Object.entries(diskUsage)) {
        if (usage && typeof usage === 'object') {
          const usageData = usage as DiskUsageData
          const used = usageData.used || usageData.usedGB || 0
          const total = usageData.total || usageData.totalGB || 1
          const percentage = total > 0 ? Math.round((used / total) * 100) : 0
          const available = total - used

          // Critical threshold (configurable, default 95%)
          if (percentage >= criticalThreshold) {
            results.push({
              type: 'DISK_SPACE_LOW',
              text: `Drive ${drive} is critically low on space (${used}GB of ${total}GB used, ${percentage}%)`,
              actionText: 'Immediately free up space by deleting unnecessary files, moving data to another drive, or expanding the disk',
              data: {
                drive,
                usedGB: used,
                totalGB: total,
                availableGB: available,
                usagePercent: percentage,
                severity: 'critical'
              }
            })
          } else if (percentage >= warningThreshold) {
            // Warning threshold (configurable, default 85%)
            results.push({
              type: 'DISK_SPACE_LOW',
              text: `Drive ${drive} is running low on space (${used}GB of ${total}GB used, ${percentage}%)`,
              actionText: 'Free up space by deleting unnecessary files, moving data to another drive, or expanding the disk',
              data: {
                drive,
                usedGB: used,
                totalGB: total,
                availableGB: available,
                usagePercent: percentage,
                severity: 'medium'
              }
            })
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse disk space info:', error)
    }

    return results
  }
}

class ResourceOptimizationChecker extends RecommendationChecker {
  getName (): string { return 'ResourceOptimizationChecker' }
  getCategory (): string { return 'Performance' }

  private getHighCpuThreshold (): number {
    return parseInt(process.env.HIGH_CPU_THRESHOLD || '80', 10)
  }

  private getCriticalCpuThreshold (): number {
    return parseInt(process.env.CRITICAL_CPU_THRESHOLD || '90', 10)
  }

  private getHighRamThresholdMB (): number {
    return parseInt(process.env.HIGH_RAM_THRESHOLD_MB || '1024', 10)
  }

  private getHighRamThresholdPercent (): number {
    return parseInt(process.env.HIGH_RAM_THRESHOLD_PERCENT || '20', 10)
  }

  private extractApplicationName (processName: string, executablePath: string): string {
    // Extract base application name for grouping similar processes
    let appName = processName

    // Remove common extensions
    appName = appName.replace(/\.(exe|com|bat|cmd|scr)$/i, '')

    // Remove version numbers and common suffixes
    appName = appName.replace(/\s*v?\d+\.?\d*\.?\d*\.?\d*$/i, '') // version numbers
    appName = appName.replace(/\s*\(?\d+\-bit\)?$/i, '') // 32-bit, 64-bit
    appName = appName.replace(/\s*x(86|64)$/i, '') // x86, x64

    // Use executable filename if process name is generic
    if (appName.toLowerCase().match(/^(process|service|app|application|program|tool|utility)$/i)) {
      const executableName = executablePath.split(/[/\\]/).pop() || processName
      appName = executableName.replace(/\.(exe|com|bat|cmd|scr)$/i, '')
    }

    // Handle common browser instances
    if (appName.toLowerCase().includes('chrome')) return 'Google Chrome'
    if (appName.toLowerCase().includes('firefox')) return 'Mozilla Firefox'
    if (appName.toLowerCase().includes('edge')) return 'Microsoft Edge'
    if (appName.toLowerCase().includes('safari')) return 'Safari'

    // Handle common office applications
    if (appName.toLowerCase().includes('word')) return 'Microsoft Word'
    if (appName.toLowerCase().includes('excel')) return 'Microsoft Excel'
    if (appName.toLowerCase().includes('powerpoint')) return 'Microsoft PowerPoint'
    if (appName.toLowerCase().includes('outlook')) return 'Microsoft Outlook'

    // Handle development tools
    if (appName.toLowerCase().includes('code')) return 'Visual Studio Code'
    if (appName.toLowerCase().includes('studio')) return 'Visual Studio'
    if (appName.toLowerCase().includes('intellij')) return 'IntelliJ IDEA'

    return appName
  }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []
    const highCpuThreshold = this.getHighCpuThreshold()
    const criticalCpuThreshold = this.getCriticalCpuThreshold()
    const highRamThresholdMB = this.getHighRamThresholdMB()
    const highRamThresholdPercent = this.getHighRamThresholdPercent()
    const topAppsLimit = parseInt(process.env.TOP_APPS_LIMIT || '5', 10)

    console.debug(`VM Recommendations: ResourceOptimizationChecker using thresholds - CPU High: ${highCpuThreshold}%, CPU Critical: ${criticalCpuThreshold}%, RAM: ${highRamThresholdMB}MB or ${highRamThresholdPercent}%, Top Apps Limit: ${topAppsLimit}`)

    if (!context.latestSnapshot) {
      return results
    }

    try {
      // Merge process data from multiple sources (prefer DB ProcessSnapshot when available)
      const processData = this.mergeProcessData(context)

      if (processData && Array.isArray(processData)) {
        // Get total system memory for percentage calculations
        const totalMemoryKB = context.machineConfig?.ramGB
          ? context.machineConfig.ramGB * 1024 * 1024
          : context.historicalMetrics[0]?.totalMemoryKB || 8000000 // Use machine config, fallback to metrics, then 8GB default
        const totalMemoryMB = (typeof totalMemoryKB === 'bigint' ? Number(totalMemoryKB) : totalMemoryKB) / 1024

        // Group processes by application
        const appGroups = new Map<string, {
          appName: string
          processes: Array<{
            processName: string
            executablePath: string
            cpuPercent: number
            memoryMB: number
            pid: number
            sampleCount: number
          }>
          totalCpuPercent: number
          totalMemoryMB: number
          maxCpuPercent: number
          peakMemoryMB: number
          processCount: number
          exampleExecutablePath: string
        }>()

        for (const process of processData) {
          if (!process || typeof process !== 'object') continue

          const processName = process.name || process.processName || 'Unknown'
          const executablePath = process.executablePath || process.path || ''
          const cpuPercent = parseFloat(String(process.cpuPercent || process.cpu || '0'))
          const memoryKB = parseFloat(String(process.memoryKB || process.memory || '0'))
          const memoryMB = memoryKB / 1024
          const pid = process.pid || process.processId || 0
          const sampleCount = process.sampleCount || 1

          // Skip system processes
          if (this.isSystemProcess(processName, executablePath)) {
            continue
          }

          // Extract application name for grouping
          const appKey = this.extractApplicationName(processName, executablePath) || processName.split('.')[0] || 'Unknown'

          if (!appGroups.has(appKey)) {
            appGroups.set(appKey, {
              appName: appKey,
              processes: [],
              totalCpuPercent: 0,
              totalMemoryMB: 0,
              maxCpuPercent: 0,
              peakMemoryMB: 0,
              processCount: 0,
              exampleExecutablePath: executablePath
            })
          }

          const group = appGroups.get(appKey)!
          group.processes.push({
            processName,
            executablePath,
            cpuPercent,
            memoryMB,
            pid: typeof pid === 'number' ? pid : parseInt(String(pid), 10) || 0,
            sampleCount
          })

          // Aggregate metrics properly
          group.totalCpuPercent += cpuPercent * sampleCount // Weighted by sample count
          group.totalMemoryMB += memoryMB // Sum of concurrent processes' memory
          group.maxCpuPercent = Math.max(group.maxCpuPercent, cpuPercent)
          group.peakMemoryMB = Math.max(group.peakMemoryMB, memoryMB)
          group.processCount = group.processes.length

          // Keep the most specific executable path as example
          if (executablePath && executablePath.length > group.exampleExecutablePath.length) {
            group.exampleExecutablePath = executablePath
          }
        }

        // Calculate sustained averages and prepare for ranking
        const appMetrics = Array.from(appGroups.values()).map(group => {
          const totalSamples = group.processes.reduce((sum, p) => sum + p.sampleCount, 0)
          const avgCpuPercent = totalSamples > 0 ? group.totalCpuPercent / totalSamples : 0
          const totalMemoryPercent = totalMemoryMB > 0 ? Math.round((group.totalMemoryMB / totalMemoryMB) * 100) : 0

          return {
            ...group,
            avgCpuPercent,
            totalMemoryPercent,
            // Sort processes by resource usage for top contributors
            topProcesses: group.processes
              .sort((a, b) => (b.cpuPercent + b.memoryMB) - (a.cpuPercent + a.memoryMB))
              .slice(0, 3) // Keep top 3 contributing processes
          }
        })

        // Select top N CPU-intensive apps
        const topCpuApps = appMetrics
          .filter(app => app.avgCpuPercent > highCpuThreshold)
          .sort((a, b) => b.avgCpuPercent - a.avgCpuPercent)
          .slice(0, topAppsLimit)

        // Select top N memory-intensive apps
        const topRamApps = appMetrics
          .filter(app => app.totalMemoryMB > highRamThresholdMB || app.totalMemoryPercent > highRamThresholdPercent)
          .sort((a, b) => b.totalMemoryMB - a.totalMemoryMB)
          .slice(0, topAppsLimit)

        // Emit CPU recommendations
        for (const app of topCpuApps) {
          results.push({
            type: 'HIGH_CPU_APP',
            text: `Application '${app.appName}' is consuming high CPU resources (${Math.round(app.avgCpuPercent)}% average across ${app.processCount} process${app.processCount > 1 ? 'es' : ''})`,
            actionText: 'Consider closing the application if not needed, checking for updates, or investigating if it\'s behaving normally',
            data: {
              appName: app.appName,
              processCount: app.processCount,
              avgCpuPercent: Math.round(app.avgCpuPercent),
              maxCpuPercent: Math.round(app.maxCpuPercent),
              totalMemoryMB: Math.round(app.totalMemoryMB),
              exampleExecutablePath: app.exampleExecutablePath,
              topProcesses: JSON.stringify(app.topProcesses.map(p => ({
                processName: p.processName,
                pid: p.pid,
                cpuPercent: p.cpuPercent,
                memoryMB: Math.round(p.memoryMB)
              }))),
              severity: app.avgCpuPercent > criticalCpuThreshold ? 'critical' : 'medium'
            }
          })
        }

        // Emit RAM recommendations
        for (const app of topRamApps) {
          // Avoid duplicate recommendations for apps already flagged for CPU
          if (topCpuApps.some(cpuApp => cpuApp.appName === app.appName)) {
            continue
          }

          results.push({
            type: 'HIGH_RAM_APP',
            text: `Application '${app.appName}' is using significant memory (${Math.round(app.totalMemoryMB)}MB across ${app.processCount} process${app.processCount > 1 ? 'es' : ''}, ${app.totalMemoryPercent}% of total RAM)`,
            actionText: 'Consider restarting the application, checking for memory leaks, or closing it if not actively used',
            data: {
              appName: app.appName,
              processCount: app.processCount,
              totalMemoryMB: Math.round(app.totalMemoryMB),
              totalMemoryPercent: app.totalMemoryPercent,
              peakMemoryMB: Math.round(app.peakMemoryMB),
              avgCpuPercent: Math.round(app.avgCpuPercent),
              exampleExecutablePath: app.exampleExecutablePath,
              topProcesses: JSON.stringify(app.topProcesses.map(p => ({
                processName: p.processName,
                pid: p.pid,
                cpuPercent: p.cpuPercent,
                memoryMB: Math.round(p.memoryMB)
              }))),
              severity: app.totalMemoryPercent > 30 ? 'critical' : 'medium'
            }
          })
        }
      }
    } catch (error) {
      console.warn('Failed to analyze process data:', error)
    }

    return results
  }

  private mergeProcessData (context: RecommendationContext): ProcessData[] | null {
    // Prefer ProcessSnapshot data when available (more accurate and recent)
    if (context.recentProcessSnapshots.length > 0) {
      const processMap = new Map<string, ProcessData>()

      // Aggregate process data by process name/executable to compute sustained CPU/RAM usage
      for (const ps of context.recentProcessSnapshots) {
        const key = ps.name || ps.executablePath || `pid_${ps.processId}`

        if (!processMap.has(key)) {
          processMap.set(key, {
            name: ps.name,
            executablePath: ps.executablePath || undefined,
            cpuPercent: ps.cpuUsagePercent,
            memoryKB: Number(ps.memoryUsageKB),
            pid: ps.processId,
            sampleCount: 1,
            maxCpu: ps.cpuUsagePercent,
            maxMemory: Number(ps.memoryUsageKB)
          })
        } else {
          const existing = processMap.get(key)
          if (!existing) continue // Skip if somehow the key doesn't exist
          const existingCpu = typeof existing.cpuPercent === 'number' ? existing.cpuPercent : parseFloat(String(existing.cpuPercent || 0))
          const existingMem = typeof existing.memoryKB === 'number' ? existing.memoryKB : parseFloat(String(existing.memoryKB || 0))

          existing.cpuPercent = (existingCpu + ps.cpuUsagePercent) / 2 // Average CPU
          existing.memoryKB = Math.max(existingMem, Number(ps.memoryUsageKB)) // Peak memory
          existing.sampleCount = (existing.sampleCount || 1) + 1
          existing.maxCpu = Math.max(existing.maxCpu || 0, ps.cpuUsagePercent)
          existing.maxMemory = Math.max(existing.maxMemory || 0, Number(ps.memoryUsageKB))
        }
      }

      return Array.from(processMap.values())
    }

    // Fallback to snapshot data if no ProcessSnapshot available
    return this.extractProcessData(context.latestSnapshot)
  }

  private extractProcessData (snapshot: VMHealthSnapshot | undefined | null): ProcessData[] | null {
    if (!snapshot) {
      return null
    }

    try {
      // Try different possible locations for process data
      if (snapshot.applicationInventory) {
        const appData = typeof snapshot.applicationInventory === 'string'
          ? JSON.parse(snapshot.applicationInventory) as ApplicationInventoryData
          : snapshot.applicationInventory as ApplicationInventoryData

        if (appData.processes && Array.isArray(appData.processes)) {
          return appData.processes
        }
      }

      // Try resourceOptInfo for process data
      if (snapshot.resourceOptInfo) {
        const resourceData = typeof snapshot.resourceOptInfo === 'string'
          ? JSON.parse(snapshot.resourceOptInfo) as ResourceOptInfo
          : snapshot.resourceOptInfo as ResourceOptInfo

        if (resourceData.processes && Array.isArray(resourceData.processes)) {
          return resourceData.processes
        }
      }

      return null
    } catch (error) {
      console.warn('Failed to extract process data:', error)
      return null
    }
  }

  private isSystemProcess (processName: string, executablePath: string): boolean {
    const lowerProcessName = processName.toLowerCase()
    const lowerPath = executablePath.toLowerCase()

    // Check environment overrides first
    const systemProcessExcludes = process.env.SYSTEM_PROCESS_EXCLUDES?.toLowerCase().split(',').map(s => s.trim()) || []
    const systemProcessIncludes = process.env.SYSTEM_PROCESS_INCLUDE?.toLowerCase().split(',').map(s => s.trim()) || []

    // Force-include specific names even if path suggests system
    if (systemProcessIncludes.some(include => lowerProcessName.includes(include))) {
      return false
    }

    // Exclude additional names from env
    if (systemProcessExcludes.some(exclude => lowerProcessName.includes(exclude))) {
      return true
    }

    // Check if path indicates system process (Windows system directories)
    const isSystemPath = lowerPath.includes('system32') ||
                        lowerPath.includes('syswow64') ||
                        lowerPath.includes('windows\\system') ||
                        lowerPath.includes('windows/system')

    if (isSystemPath) {
      return true
    }

    // Minimal core system processes (essential Windows system processes only)
    const coreSystemProcesses = [
      'system', 'idle', 'csrss.exe', 'lsass.exe', 'smss.exe',
      'wininit.exe', 'services.exe'
    ]

    return coreSystemProcesses.some(sp => lowerProcessName.includes(sp))
  }
}

class DiskIOBottleneckChecker extends RecommendationChecker {
  getName (): string { return 'DiskIOBottleneckChecker' }
  getCategory (): string { return 'Performance' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (context.historicalMetrics.length < 10) {
      return results // Need sufficient data points for I/O analysis
    }

    try {
      // Analyze disk I/O patterns from SystemMetrics.diskIOStats
      const ioMetrics = context.historicalMetrics
        .map(m => {
          if (m.diskIOStats) {
            try {
              const ioData = typeof m.diskIOStats === 'string'
                ? JSON.parse(m.diskIOStats)
                : m.diskIOStats

              if (ioData && typeof ioData === 'object') {
                // Try to extract read/write bytes from various possible formats
                const readBytes = ioData.readBytes || ioData.diskReadBytes || ioData.bytesRead || 0
                const writeBytes = ioData.writeBytes || ioData.diskWriteBytes || ioData.bytesWrite || 0

                if (readBytes > 0 || writeBytes > 0) {
                  return {
                    readMB: Math.round(readBytes / (1024 * 1024)),
                    writeMB: Math.round(writeBytes / (1024 * 1024)),
                    totalMB: Math.round((readBytes + writeBytes) / (1024 * 1024)),
                    timestamp: m.timestamp
                  }
                }
              }
            } catch (error) {
              console.warn('Failed to parse diskIOStats:', error)
            }
          }
          return null
        })
        .filter(m => m !== null) as { readMB: number; writeMB: number; totalMB: number; timestamp: Date }[]

      if (ioMetrics.length < 5) {
        return results // Not enough I/O data
      }

      // Calculate I/O rates and patterns
      const ioRates = []
      for (let i = 1; i < ioMetrics.length; i++) {
        const current = ioMetrics[i]
        const previous = ioMetrics[i - 1]
        const timeDiffSeconds = (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000

        if (timeDiffSeconds > 0 && timeDiffSeconds < 3600) { // Ignore gaps > 1 hour
          const readRate = Math.max(0, (current.readMB - previous.readMB) / timeDiffSeconds) // MB/s
          const writeRate = Math.max(0, (current.writeMB - previous.writeMB) / timeDiffSeconds) // MB/s
          const totalRate = readRate + writeRate

          ioRates.push({
            readRate,
            writeRate,
            totalRate,
            timestamp: current.timestamp
          })
        }
      }

      if (ioRates.length < 3) {
        return results
      }

      // Analyze I/O bottleneck indicators
      const totalRates = ioRates.map(r => r.totalRate)
      const avgTotalRate = totalRates.reduce((sum, rate) => sum + rate, 0) / totalRates.length
      const peakTotalRate = Math.max(...totalRates)

      // Check for I/O bottleneck patterns
      const lowThroughputCount = totalRates.filter(rate => rate < 5).length // Less than 5 MB/s is considered low
      const lowThroughputPercent = (lowThroughputCount / totalRates.length) * 100

      // Analyze disk I/O stats if available from resourceOptInfo
      let ioWaitHigh = false
      let avgIoWait = 0

      if (context.latestSnapshot?.resourceOptInfo) {
        try {
          const resourceData = typeof context.latestSnapshot.resourceOptInfo === 'string'
            ? JSON.parse(context.latestSnapshot.resourceOptInfo)
            : context.latestSnapshot.resourceOptInfo

          if (resourceData && typeof resourceData === 'object') {
            // Look for I/O wait indicators in resource optimization data
            if (resourceData.ioWaitPercent || resourceData.await || resourceData.avgWait || resourceData.diskIOStats) {
              const ioStats = resourceData.diskIOStats || resourceData
              avgIoWait = ioStats.ioWaitPercent || ioStats.await || ioStats.avgWait || 0
              ioWaitHigh = avgIoWait > 20 // >20% I/O wait is concerning
            }
          }
        } catch (error) {
          console.warn('Failed to parse resource optimization data for I/O stats:', error)
        }
      }

      // Generate recommendations based on I/O bottleneck indicators
      if (lowThroughputPercent > 60 || ioWaitHigh || (avgTotalRate < 10 && peakTotalRate > 50)) {
        let severity = 'medium'
        let message = ''
        let actionText = ''

        if (ioWaitHigh && lowThroughputPercent > 80) {
          severity = 'critical'
          message = `VM experiencing severe disk I/O bottlenecks - average I/O wait time ${Math.round(avgIoWait)}% and low throughput ${Math.round(lowThroughputPercent)}% of the time`
          actionText = 'Consider upgrading to faster storage (SSD), increasing IOPS allocation, or optimizing applications to reduce I/O operations'
        } else if (ioWaitHigh) {
          severity = 'medium'
          message = `VM experiencing high disk I/O wait times (${Math.round(avgIoWait)}%) indicating storage bottlenecks`
          actionText = 'Consider upgrading storage performance or investigating high I/O applications'
        } else if (lowThroughputPercent > 60) {
          severity = 'medium'
          message = `VM showing low disk throughput (${Math.round(avgTotalRate)} MB/s average) in ${Math.round(lowThroughputPercent)}% of measurements`
          actionText = 'Monitor disk performance and consider storage optimization or upgrade if applications are affected'
        } else {
          severity = 'medium'
          message = `VM showing inconsistent disk I/O performance - peak throughput ${Math.round(peakTotalRate)} MB/s but average only ${Math.round(avgTotalRate)} MB/s`
          actionText = 'Investigate I/O patterns and consider storage optimization'
        }

        results.push({
          type: 'OTHER',
          text: message,
          actionText,
          data: {
            checkType: 'DISK_IO_BOTTLENECK',
            avgThroughputMBs: Math.round(avgTotalRate),
            peakThroughputMBs: Math.round(peakTotalRate),
            lowThroughputPercent: Math.round(lowThroughputPercent),
            avgIoWaitPercent: Math.round(avgIoWait),
            ioWaitHigh,
            metricsAnalyzed: ioRates.length,
            severity
          }
        })
      }
    } catch (error) {
      console.warn('Failed to analyze disk I/O bottlenecks:', error)
    }

    return results
  }
}

class PortConflictChecker extends RecommendationChecker {
  getName (): string { return 'PortConflictChecker' }
  getCategory (): string { return 'Security' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    try {
      // Comment 6: No recommendation when no firewall filters exist
      if (!context.firewallFilters?.length) {
        results.push({
          type: RecommendationType.PORT_BLOCKED,
          text: 'No firewall rules attached to this VM',
          actionText: 'Attach appropriate NWFilter or configure department-level firewall policies to secure network access',
          data: {
            conflictType: 'no_firewall',
            priority: 'HIGH',
            category: 'Security',
            recommendation: 'Configure network filters for VM security'
          }
        })
        return results
      }

      // Skip port analysis if no port data available
      if (!context.portUsage?.length) {
        return results
      }

      // Comment 7: De-duplicate listening ports
      const listeningPorts = this.extractListeningPorts(context.portUsage)
      if (listeningPorts.length === 0) {
        return results
      }

      // Comment 5: Refactor port ranges for scalability
      const allowedPortRanges = this.extractAllowedPortRanges(context.firewallFilters)

      // Analyze each listening port for conflicts
      const conflicts = this.detectPortConflicts(listeningPorts, allowedPortRanges, context.vmPorts)

      // Generate recommendations for conflicts
      results.push(...this.generateConflictRecommendations(conflicts))
    } catch (error) {
      console.warn('Error analyzing port conflicts:', error)
    }

    return results
  }

  private extractListeningPorts (portUsage: PortUsage[]): Array<{
    port: number
    protocol: string
    processName?: string
    executablePath?: string
    processId?: number
  }> {
    // Comment 7: De-duplicate listening ports using Map
    const portMap = new Map<string, {
      port: number
      protocol: string
      processName?: string
      executablePath?: string
      processId?: number
      timestamp?: Date
    }>()

    for (const p of portUsage) {
      if (p.isListening && !this.isSystemPort(p.port)) {
        const key = `${p.port}/${p.protocol.toLowerCase()}`
        const existing = portMap.get(key)
        const current = {
          port: p.port,
          protocol: p.protocol.toLowerCase(),
          processName: p.processName || undefined,
          executablePath: p.executablePath || undefined,
          processId: p.processId || undefined,
          timestamp: p.timestamp
        }

        // Keep the most recent entry or one with richer process info
        if (!existing ||
            (current.timestamp && existing.timestamp && current.timestamp > existing.timestamp) ||
            (!existing.processName && current.processName)) {
          portMap.set(key, current)
        }
      }
    }

    return Array.from(portMap.values()).map(({ timestamp, ...port }) => port)
  }

  // Comment 5: Refactor to use port ranges instead of expanding per-port
  private extractAllowedPortRanges (firewallFilters: (VMNWFilter & { nwFilter: { rules: FWRule[] } })[]): Array<{
    start: number
    end: number
    protocol: string
    allowAllDestPorts?: boolean
  }> {
    const allowedRanges: Array<{
      start: number
      end: number
      protocol: string
      allowAllDestPorts?: boolean
    }> = []

    for (const filter of firewallFilters) {
      for (const rule of filter.nwFilter.rules) {
        // Only consider 'accept' rules for inbound or bidirectional traffic
        if (rule.action !== 'accept' || (rule.direction !== 'in' && rule.direction !== 'inout')) {
          continue
        }

        const protocol = rule.protocol?.toLowerCase() || 'all'

        // Comment 1 & 2: Handle accept rules without explicit ports (not src-only rules)
        if (!rule.dstPortStart && !rule.dstPortEnd && !rule.srcPortStart && !rule.srcPortEnd) {
          allowedRanges.push({
            start: 0,
            end: 65535,
            protocol,
            allowAllDestPorts: true
          })
          continue
        }

        // Comment 4: Remove srcPortStart consideration for inbound analysis
        // Handle destination ports (for incoming traffic)
        if (rule.dstPortStart) {
          const startPort = Number(rule.dstPortStart)
          const endPort = rule.dstPortEnd ? Number(rule.dstPortEnd) : startPort

          allowedRanges.push({
            start: startPort,
            end: endPort,
            protocol
          })
        }
      }
    }

    return allowedRanges
  }

  private detectPortConflicts (
    listeningPorts: Array<{
      port: number
      protocol: string
      processName?: string
      executablePath?: string
      processId?: number
    }>,
    allowedRanges: Array<{
      start: number
      end: number
      protocol: string
      allowAllDestPorts?: boolean
    }>,
    vmPorts: VmPort[]
  ): Array<{
    type: 'uncovered' | 'protocol_mismatch' | 'port_blocked' | 'vm_port_missing'
    port: number
    protocol: string
    processName?: string
    executablePath?: string
    processId?: number
    allowedProtocols?: string[]
    vmPortEnabled?: boolean
    vmPortToEnable?: boolean
  }> {
    const conflicts: Array<{
      type: 'uncovered' | 'protocol_mismatch' | 'port_blocked' | 'vm_port_missing'
      port: number
      protocol: string
      processName?: string
      executablePath?: string
      processId?: number
      allowedProtocols?: string[]
      vmPortEnabled?: boolean
      vmPortToEnable?: boolean
    }> = []

    for (const listening of listeningPorts) {
      const { port, protocol } = listening

      // Comment 1: Always check VmPort data for misconfiguration (independent of firewall)
      const vmPort = vmPorts.find(vp =>
        (port >= vp.portStart && port <= vp.portEnd) &&
        vp.protocol.toLowerCase() === protocol
      )

      if (vmPort && !vmPort.enabled) {
        conflicts.push({
          type: 'port_blocked',
          ...listening,
          vmPortEnabled: vmPort.enabled,
          vmPortToEnable: vmPort.toEnable
        })
      } else if (!vmPort) {
        // Missing VmPort entry
        conflicts.push({
          type: 'vm_port_missing',
          ...listening
        })
      }

      // Always check firewall rules regardless of VmPort status
      // Comment 9: Fast path for protocol-only rules
      if (this.isPortAllowedByRules(port, protocol, allowedRanges)) {
        continue // Port is allowed by firewall, no firewall conflict
      }

      // Find matching firewall rules for detailed analysis
      const matchingRules = allowedRanges.filter(range =>
        port >= range.start && port <= range.end
      )

      if (matchingRules.length === 0) {
        // No firewall rules covering this port
        conflicts.push({
          type: 'uncovered',
          ...listening
        })
      } else {
        // Check for protocol compatibility
        const compatibleRules = matchingRules.filter(rule =>
          rule.protocol === 'all' ||
          rule.protocol === protocol
        )

        if (compatibleRules.length === 0) {
          // Port is covered but protocol doesn't match
          const allowedProtocols = Array.from(new Set(matchingRules.map(r => r.protocol)))
          conflicts.push({
            type: 'protocol_mismatch',
            ...listening,
            allowedProtocols
          })
        }
      }
    }

    return conflicts
  }

  // Comment 5: Implement efficient port checking
  private isPortAllowedByRules (
    port: number,
    protocol: string,
    allowedRanges: Array<{
      start: number
      end: number
      protocol: string
      allowAllDestPorts?: boolean
    }>
  ): boolean {
    // Comment 1 & 9: Check for allow-all rules first
    for (const range of allowedRanges) {
      if (range.allowAllDestPorts && (range.protocol === 'all' || range.protocol === protocol)) {
        return true
      }
    }

    // Check specific port ranges
    return allowedRanges.some(range =>
      port >= range.start &&
      port <= range.end &&
      (range.protocol === 'all' || range.protocol === protocol)
    )
  }

  private generateConflictRecommendations (conflicts: Array<{
    type: 'uncovered' | 'protocol_mismatch' | 'port_blocked' | 'vm_port_missing'
    port: number
    protocol: string
    processName?: string
    executablePath?: string
    processId?: number
    allowedProtocols?: string[]
    vmPortEnabled?: boolean
    vmPortToEnable?: boolean
  }>): RecommendationResult[] {
    const results: RecommendationResult[] = []

    if (conflicts.length === 0) {
      return results
    }

    // Group conflicts by type
    const uncoveredPorts = conflicts.filter(c => c.type === 'uncovered')
    const protocolMismatches = conflicts.filter(c => c.type === 'protocol_mismatch')
    const blockedPorts = conflicts.filter(c => c.type === 'port_blocked')
    const missingVmPorts = conflicts.filter(c => c.type === 'vm_port_missing')

    // Generate recommendations for uncovered ports
    if (uncoveredPorts.length > 0) {
      if (uncoveredPorts.length === 1) {
        const conflict = uncoveredPorts[0]
        const processInfo = conflict.processName ? ` (${conflict.processName})` : ''

        results.push({
          type: RecommendationType.PORT_BLOCKED,
          text: `Application${processInfo} is using port ${conflict.port}/${conflict.protocol} which is not allowed by firewall rules`,
          actionText: `Add a firewall rule to allow port ${conflict.port}/${conflict.protocol} or stop the application if not needed`,
          data: {
            port: conflict.port,
            protocol: conflict.protocol,
            processName: conflict.processName || 'Unknown',
            executablePath: conflict.executablePath || 'Unknown',
            processId: conflict.processId || 0,
            conflictType: 'uncovered',
            priority: 'HIGH',
            category: 'Security',
            firewallRuleSuggestion: `Add rule: allow ${conflict.protocol} port ${conflict.port} (destination)`
          }
        })
      } else {
        const portList = uncoveredPorts.map(c => `${c.port}/${c.protocol}`).join(', ')
        const uncoveredPortsList = uncoveredPorts.map(c =>
          `${c.port}/${c.protocol} (${c.processName || 'Unknown'})`
        ).join(', ')

        results.push({
          type: RecommendationType.PORT_BLOCKED,
          text: `${uncoveredPorts.length} applications are using ports not covered by firewall rules: ${portList}`,
          actionText: 'Review and update firewall configuration to allow necessary ports or stop unused applications',
          data: {
            conflictCount: uncoveredPorts.length,
            conflictType: 'uncovered',
            uncoveredPortsList,
            priority: 'HIGH',
            category: 'Security',
            firewallRuleSuggestion: 'Review each port and add appropriate firewall rules'
          }
        })
      }
    }

    // Comment 3: Generate recommendations for VM port blocks
    for (const conflict of blockedPorts) {
      const processInfo = conflict.processName ? ` (${conflict.processName})` : ''

      results.push({
        type: RecommendationType.PORT_BLOCKED,
        text: `Application${processInfo} is using port ${conflict.port}/${conflict.protocol} but VM port settings don't allow this service`,
        actionText: `Enable port ${conflict.port}/${conflict.protocol} in VM port configuration or stop the application if not needed`,
        data: {
          port: conflict.port,
          protocol: conflict.protocol,
          processName: conflict.processName || 'Unknown',
          executablePath: conflict.executablePath || 'Unknown',
          processId: conflict.processId || 0,
          conflictType: 'vm_port_disabled',
          vmPortEnabled: conflict.vmPortEnabled,
          vmPortToEnable: conflict.vmPortToEnable,
          priority: 'HIGH',
          category: 'Configuration'
        }
      })
    }

    // Comment 1: Generate recommendations for missing VM port entries
    for (const conflict of missingVmPorts) {
      const processInfo = conflict.processName ? ` (${conflict.processName})` : ''

      results.push({
        type: RecommendationType.PORT_BLOCKED,
        text: `Service${processInfo} is using port ${conflict.port}/${conflict.protocol} but it is not declared in VM port settings`,
        actionText: `Declare and enable ${conflict.port}/${conflict.protocol} in VM port configuration or stop the service`,
        data: {
          port: conflict.port,
          protocol: conflict.protocol,
          processName: conflict.processName || 'Unknown',
          executablePath: conflict.executablePath || 'Unknown',
          processId: conflict.processId || 0,
          conflictType: 'vm_port_missing',
          category: 'Configuration',
          priority: 'HIGH'
        }
      })
    }

    // Generate recommendations for protocol mismatches
    for (const conflict of protocolMismatches) {
      const processInfo = conflict.processName ? ` (${conflict.processName})` : ''
      const allowedProtocolsText = conflict.allowedProtocols?.join(', ') || 'unknown'

      results.push({
        type: RecommendationType.PORT_BLOCKED,
        text: `Port ${conflict.port} has firewall rules for ${allowedProtocolsText} but application${processInfo} is using ${conflict.protocol}`,
        actionText: `Update firewall rules to allow ${conflict.protocol} protocol or configure application to use ${allowedProtocolsText}`,
        data: {
          port: conflict.port,
          actualProtocol: conflict.protocol,
          allowedProtocols: conflict.allowedProtocols?.join(', ') || '',
          processName: conflict.processName || 'Unknown',
          executablePath: conflict.executablePath || 'Unknown',
          processId: conflict.processId || 0,
          conflictType: 'protocol_mismatch',
          priority: 'MEDIUM',
          category: 'Security',
          firewallRuleSuggestion: `Update rule: allow ${conflict.protocol} port ${conflict.port}`
        }
      })
    }

    return results
  }

  private isSystemPort (port: number): boolean {
    // Common system ports that should be excluded from conflict analysis
    const systemPorts = new Set([
      22, // SSH
      53, // DNS
      80, // HTTP
      443, // HTTPS
      123, // NTP
      135, // RPC Endpoint Mapper (Windows)
      139, // NetBIOS Session Service
      445, // SMB over IP
      993, // IMAPS
      995, // POP3S
      3389, // RDP
      5985, // WinRM HTTP
      5986 // WinRM HTTPS
    ])

    // Also exclude well-known ports below 1024 (except for common services listed above)
    return systemPorts.has(port) || (port < 1024 && ![80, 443].includes(port))
  }
}

class OverProvisionedChecker extends RecommendationChecker {
  getName (): string { return 'OverProvisionedChecker' }
  getCategory (): string { return 'Resource Optimization' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.machineConfig || context.historicalMetrics.length < 5) {
      return results // Need at least 5 data points for meaningful analysis
    }

    const allocatedCores = context.machineConfig.cpuCores || 1
    const allocatedRamGB = context.machineConfig.ramGB || 1
    const allocatedDiskGB = context.machineConfig.diskSizeGB || 1

    // Calculate usage statistics from historical data with timestamps
    const cpuMetrics = context.historicalMetrics
      .map(m => ({
        value: m.cpuUsagePercent,
        timestamp: m.timestamp
      }))
      .filter(m => m.value !== null && m.value !== undefined) as { value: number; timestamp: Date }[]

    const ramMetrics = context.historicalMetrics
      .map(m => {
        if (m.totalMemoryKB && m.usedMemoryKB) {
          const totalMem = typeof m.totalMemoryKB === 'bigint' ? Number(m.totalMemoryKB) : m.totalMemoryKB
          const usedMem = typeof m.usedMemoryKB === 'bigint' ? Number(m.usedMemoryKB) : m.usedMemoryKB
          return {
            value: (usedMem / totalMem) * 100,
            timestamp: m.timestamp
          }
        }
        return null
      })
      .filter(m => m !== null) as { value: number; timestamp: Date }[]

    // Analyze CPU over-provisioning
    if (cpuMetrics.length >= 5) {
      const cpuValues = cpuMetrics.map(m => m.value)
      const avgCpuUsage = cpuValues.reduce((sum, usage) => sum + usage, 0) / cpuValues.length
      const peakCpuUsage = Math.max(...cpuValues)

      // Calculate actual time window coverage
      const timestamps = cpuMetrics.map(m => m.timestamp.getTime())
      const minTimestamp = Math.min(...timestamps)
      const maxTimestamp = Math.max(...timestamps)
      const daysAnalyzed = (maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24)

      // CPU over-provisioning: Average usage <30% for >5 days of coverage
      if (avgCpuUsage < 30 && daysAnalyzed >= 5) {
        const recommendedCores = Math.max(1, Math.ceil(allocatedCores * (peakCpuUsage / 100) * 1.2)) // 20% buffer
        const potentialSavings = allocatedCores - recommendedCores

        results.push({
          type: 'OVER_PROVISIONED',
          text: `VM has ${allocatedCores} CPU cores allocated but only uses ${Math.round(avgCpuUsage)}% on average`,
          actionText: `Consider reducing allocated CPU cores to ${recommendedCores} to optimize resource utilization`,
          data: {
            resourceType: 'CPU',
            allocatedCores,
            avgUsagePercent: Math.round(avgCpuUsage),
            peakUsagePercent: Math.round(peakCpuUsage),
            recommendedCores,
            potentialSavings,
            efficiency: Math.round((avgCpuUsage / 100) * 100),
            daysAnalyzed: Math.round(daysAnalyzed * 10) / 10
          }
        })
      }
    }

    // Analyze RAM over-provisioning
    if (ramMetrics.length >= 5) {
      const ramValues = ramMetrics.map(m => m.value)
      const avgRamUsage = ramValues.reduce((sum, usage) => sum + usage, 0) / ramValues.length
      const peakRamUsage = Math.max(...ramValues)

      // Calculate actual time window coverage
      const timestamps = ramMetrics.map(m => m.timestamp.getTime())
      const minTimestamp = Math.min(...timestamps)
      const maxTimestamp = Math.max(...timestamps)
      const daysAnalyzed = (maxTimestamp - minTimestamp) / (1000 * 60 * 60 * 24)

      // RAM over-provisioning: Average usage <40% for >5 days of coverage
      if (avgRamUsage < 40 && daysAnalyzed >= 5) {
        const recommendedRamGB = Math.max(1, Math.ceil(allocatedRamGB * (peakRamUsage / 100) * 1.3)) // 30% buffer
        const potentialSavings = allocatedRamGB - recommendedRamGB

        results.push({
          type: 'OVER_PROVISIONED',
          text: `VM has ${allocatedRamGB}GB RAM allocated but only uses ${Math.round(avgRamUsage)}% on average`,
          actionText: `Consider reducing allocated RAM to ${recommendedRamGB}GB to optimize resource utilization`,
          data: {
            resourceType: 'RAM',
            allocatedGB: allocatedRamGB,
            avgUsagePercent: Math.round(avgRamUsage),
            peakUsagePercent: Math.round(peakRamUsage),
            recommendedGB: recommendedRamGB,
            potentialSavingsGB: potentialSavings,
            efficiency: Math.round((avgRamUsage / 100) * 100),
            daysAnalyzed: Math.round(daysAnalyzed * 10) / 10
          }
        })
      }
    }

    // Analyze disk over-provisioning from latest snapshot
    const diskUsage = this.extractDiskSpaceData(context)
    if (diskUsage) {
      try {
        let totalUsedGB = 0
        let totalAvailableGB = 0

        for (const [, usage] of Object.entries(diskUsage)) {
          if (usage && typeof usage === 'object') {
            const usageData = usage as DiskUsageData
            // Validate each entry has numeric used/usedGB and total/totalGB before including in totals
            const used = usageData.used || usageData.usedGB
            const total = usageData.total || usageData.totalGB
            if (typeof used === 'number' && typeof total === 'number') {
              totalUsedGB += used
              totalAvailableGB += total
            }
          }
        }

        const diskUsagePercent = totalAvailableGB > 0 ? (totalUsedGB / totalAvailableGB) * 100 : 0

        // Disk over-provisioning: Usage <50% of allocated storage
        if (diskUsagePercent < 50 && allocatedDiskGB > totalUsedGB * 2) {
          const recommendedDiskGB = Math.max(10, Math.ceil(totalUsedGB * 1.5)) // 50% buffer
          const potentialSavings = allocatedDiskGB - recommendedDiskGB

          results.push({
            type: 'OVER_PROVISIONED',
            text: `VM has ${allocatedDiskGB}GB disk allocated but only uses ${Math.round(diskUsagePercent)}% (${Math.round(totalUsedGB)}GB)`,
            actionText: `Consider reducing allocated disk space to ${recommendedDiskGB}GB to optimize storage utilization`,
            data: {
              resourceType: 'DISK',
              allocatedGB: allocatedDiskGB,
              usedGB: Math.round(totalUsedGB),
              availableGB: Math.round(totalAvailableGB),
              usagePercent: Math.round(diskUsagePercent),
              recommendedGB: recommendedDiskGB,
              potentialSavingsGB: potentialSavings,
              efficiency: Math.round(diskUsagePercent)
            }
          })
        }
      } catch (error) {
        console.warn('Failed to analyze disk usage for over-provisioning:', error)
      }
    }

    return results
  }
}

class UnderProvisionedChecker extends RecommendationChecker {
  getName (): string { return 'UnderProvisionedChecker' }
  getCategory (): string { return 'Resource Optimization' }

  private calculateHighUsageTime (
    metrics: { value: number; timestamp: Date }[],
    threshold: number
  ): number {
    if (metrics.length < 2) return 0

    let totalHighUsageMs = 0
    const sortedMetrics = [...metrics].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    for (let i = 0; i < sortedMetrics.length - 1; i++) {
      const current = sortedMetrics[i]
      const next = sortedMetrics[i + 1]

      // If current value is above threshold, count the time until next measurement
      if (current.value > threshold) {
        const timeSpanMs = next.timestamp.getTime() - current.timestamp.getTime()
        totalHighUsageMs += timeSpanMs
      }
    }

    // Convert milliseconds to hours
    return totalHighUsageMs / (1000 * 60 * 60)
  }

  private calculateLowAvailableTime (
    metrics: { availableMB: number; totalMB: number; timestamp: Date }[],
    thresholdMB: number,
    thresholdPercent: number
  ): number {
    if (metrics.length < 2) return 0

    let totalLowAvailableMs = 0
    const sortedMetrics = [...metrics].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    for (let i = 0; i < sortedMetrics.length - 1; i++) {
      const current = sortedMetrics[i]
      const next = sortedMetrics[i + 1]

      // Check if available memory is below threshold (either absolute MB or percentage of total)
      const availablePercent = current.totalMB > 0 ? (current.availableMB / current.totalMB) * 100 : 0
      const isLowAvailable = current.availableMB < thresholdMB || availablePercent < thresholdPercent

      if (isLowAvailable) {
        const timeSpanMs = next.timestamp.getTime() - current.timestamp.getTime()
        totalLowAvailableMs += timeSpanMs
      }
    }

    // Convert milliseconds to hours
    return totalLowAvailableMs / (1000 * 60 * 60)
  }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.machineConfig || context.historicalMetrics.length < 5) {
      return results // Need at least 5 data points for meaningful analysis
    }

    const allocatedCores = context.machineConfig.cpuCores || 1
    const allocatedRamGB = context.machineConfig.ramGB || 1
    const allocatedDiskGB = context.machineConfig.diskSizeGB || 1

    // Prepare CPU metrics with timestamps for time-based analysis
    const cpuMetrics = context.historicalMetrics
      .map(m => ({
        value: m.cpuUsagePercent,
        timestamp: m.timestamp
      }))
      .filter(m => m.value !== null && m.value !== undefined) as { value: number; timestamp: Date }[]

    // Prepare RAM metrics with timestamps for time-based analysis
    const ramMetrics = context.historicalMetrics
      .map(m => {
        if (m.totalMemoryKB && m.usedMemoryKB) {
          const totalMem = typeof m.totalMemoryKB === 'bigint' ? Number(m.totalMemoryKB) : m.totalMemoryKB
          const usedMem = typeof m.usedMemoryKB === 'bigint' ? Number(m.usedMemoryKB) : m.usedMemoryKB
          return {
            value: (usedMem / totalMem) * 100,
            timestamp: m.timestamp
          }
        }
        return null
      })
      .filter(m => m !== null) as { value: number; timestamp: Date }[]

    // Prepare swap metrics for swap pressure analysis
    const swapMetrics = context.historicalMetrics
      .map(m => {
        if (m.swapTotalKB && m.swapUsedKB) {
          const totalSwap = typeof m.swapTotalKB === 'bigint' ? Number(m.swapTotalKB) : m.swapTotalKB
          const usedSwap = typeof m.swapUsedKB === 'bigint' ? Number(m.swapUsedKB) : m.swapUsedKB
          return {
            usagePercent: totalSwap > 0 ? (usedSwap / totalSwap) * 100 : 0,
            usedMB: Math.round(usedSwap / 1024),
            totalMB: Math.round(totalSwap / 1024),
            timestamp: m.timestamp
          }
        }
        return null
      })
      .filter(m => m !== null) as { usagePercent: number; usedMB: number; totalMB: number; timestamp: Date }[]

    // Prepare available memory metrics for memory pressure analysis
    const availableMemoryMetrics = context.historicalMetrics
      .map(m => {
        if (m.availableMemoryKB && m.totalMemoryKB) {
          const availableKB = typeof m.availableMemoryKB === 'bigint' ? Number(m.availableMemoryKB) : m.availableMemoryKB
          const totalKB = typeof m.totalMemoryKB === 'bigint' ? Number(m.totalMemoryKB) : m.totalMemoryKB
          return {
            availableMB: Math.round(availableKB / 1024),
            totalMB: Math.round(totalKB / 1024),
            timestamp: m.timestamp
          }
        }
        return null
      })
      .filter(m => m !== null) as { availableMB: number; totalMB: number; timestamp: Date }[]

    // Analyze CPU under-provisioning
    if (cpuMetrics.length >= 5) {
      const cpuValues = cpuMetrics.map(m => m.value)
      const avgCpuUsage = cpuValues.reduce((sum, usage) => sum + usage, 0) / cpuValues.length
      const peakCpuUsage = Math.max(...cpuValues)
      const hoursHighUsage = this.calculateHighUsageTime(cpuMetrics, 85)

      // CPU under-provisioning: Sustained usage >85% for multiple hours per day
      if (hoursHighUsage > 2 && peakCpuUsage > 90) {
        const recommendedCores = Math.ceil(allocatedCores * 1.5) // 50% increase
        const performanceImpact = hoursHighUsage > 6 ? 'high' : 'medium'

        results.push({
          type: 'UNDER_PROVISIONED',
          text: `VM frequently runs out of CPU resources - usage exceeds 85% for ${Math.round(hoursHighUsage)} hours in analyzed period`,
          actionText: `Consider increasing CPU allocation from ${allocatedCores} to ${recommendedCores} cores to improve performance`,
          data: {
            resourceType: 'CPU',
            currentCores: allocatedCores,
            avgUsagePercent: Math.round(avgCpuUsage),
            peakUsagePercent: Math.round(peakCpuUsage),
            hoursHighUsage: Math.round(hoursHighUsage),
            recommendedCores,
            performanceImpact,
            metricsAnalyzed: cpuMetrics.length,
            highUsageFrequency: Math.round((cpuValues.filter(u => u > 85).length / cpuValues.length) * 100)
          }
        })
      }
    }

    // Analyze RAM under-provisioning with swap indicators
    if (ramMetrics.length >= 5) {
      const ramValues = ramMetrics.map(m => m.value)
      const avgRamUsage = ramValues.reduce((sum, usage) => sum + usage, 0) / ramValues.length
      const peakRamUsage = Math.max(...ramValues)
      const hoursHighUsage = this.calculateHighUsageTime(ramMetrics, 90)

      // Analyze swap usage patterns
      let swapPressure = false
      let avgSwapUsage = 0
      let peakSwapUsage = 0
      let swapUsageCount = 0
      let hoursSwapUsed = 0

      if (swapMetrics.length > 0) {
        const swapValues = swapMetrics.map(m => m.usagePercent)
        avgSwapUsage = swapValues.reduce((sum, usage) => sum + usage, 0) / swapValues.length
        peakSwapUsage = Math.max(...swapValues)
        swapUsageCount = swapValues.filter(usage => usage > 10).length // >10% swap usage is concerning

        // Calculate time spent using significant swap (>10%)
        const swapHighUsageMetrics = swapMetrics
          .filter(m => m.usagePercent > 10)
          .map(m => ({ value: m.usagePercent, timestamp: m.timestamp }))
        hoursSwapUsed = this.calculateHighUsageTime(swapHighUsageMetrics, 10)

        swapPressure = swapUsageCount > 0 && (avgSwapUsage > 5 || peakSwapUsage > 20)
      }

      // Analyze available memory patterns
      let lowAvailableMemHours = 0
      let avgAvailableMB = 0
      let minAvailableMB = 0
      let availablePressure = false

      if (availableMemoryMetrics.length > 0) {
        const availableValues = availableMemoryMetrics.map(m => m.availableMB)
        avgAvailableMB = availableValues.reduce((sum, available) => sum + available, 0) / availableValues.length
        minAvailableMB = Math.min(...availableValues)

        // Calculate time spent with low available memory (<512MB or <10% of total)
        lowAvailableMemHours = this.calculateLowAvailableTime(availableMemoryMetrics, 512, 10)

        // Available memory pressure: frequently low available memory
        availablePressure = lowAvailableMemHours > 1 && (avgAvailableMB < 1024 || minAvailableMB < 256)
      }

      // RAM under-provisioning: High memory usage OR significant swap usage OR low available memory
      const memoryPressure = hoursHighUsage > 1 && peakRamUsage > 95
      const shouldRecommend = memoryPressure || swapPressure || availablePressure

      if (shouldRecommend) {
        // Increase recommendation severity when both swap is used significantly and availableMemoryKB is frequently low
        const severePressure = swapPressure && availablePressure
        const recommendedRamGB = Math.ceil(allocatedRamGB * (severePressure ? 2.5 : swapPressure ? 2.0 : 1.5))
        const performanceImpact = (hoursHighUsage > 4 || hoursSwapUsed > 2 || lowAvailableMemHours > 4) ? 'high' : 'medium'

        // Construct message based on indicators
        let message = ''
        let actionText = ''

        if (severePressure) {
          message = `VM is critically memory-constrained - RAM usage exceeds 90% for ${Math.round(hoursHighUsage)} hours, swap is heavily used (${Math.round(avgSwapUsage)}% average), and available memory is low for ${Math.round(lowAvailableMemHours)} hours`
          actionText = `Urgently increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB - multiple memory pressure indicators detected`
        } else if (swapPressure && memoryPressure) {
          message = `VM is severely memory-constrained - RAM usage exceeds 90% for ${Math.round(hoursHighUsage)} hours and swap is heavily used (${Math.round(avgSwapUsage)}% average, ${Math.round(peakSwapUsage)}% peak)`
          actionText = `Urgently increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB - swap usage indicates severe memory pressure`
        } else if (availablePressure && memoryPressure) {
          message = `VM is memory-constrained - RAM usage exceeds 90% for ${Math.round(hoursHighUsage)} hours and available memory is frequently low (${Math.round(avgAvailableMB)}MB average, ${minAvailableMB}MB minimum)`
          actionText = `Increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to improve memory availability`
        } else if (swapPressure) {
          message = `VM is using swap memory heavily (${Math.round(avgSwapUsage)}% average, ${Math.round(peakSwapUsage)}% peak) indicating insufficient RAM`
          actionText = `Increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to reduce swap usage and improve performance`
        } else if (availablePressure) {
          message = `VM has frequently low available memory (${Math.round(avgAvailableMB)}MB average, ${minAvailableMB}MB minimum) for ${Math.round(lowAvailableMemHours)} hours`
          actionText = `Increase RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to improve memory availability`
        } else {
          message = `VM frequently runs out of memory - usage exceeds 90% for ${Math.round(hoursHighUsage)} hours in analyzed period`
          actionText = `Consider increasing RAM allocation from ${allocatedRamGB}GB to ${recommendedRamGB}GB to improve performance`
        }

        results.push({
          type: 'UNDER_PROVISIONED',
          text: message,
          actionText,
          data: {
            resourceType: 'RAM',
            currentGB: allocatedRamGB,
            avgUsagePercent: Math.round(avgRamUsage),
            peakUsagePercent: Math.round(peakRamUsage),
            hoursHighUsage: Math.round(hoursHighUsage),
            recommendedGB: recommendedRamGB,
            performanceImpact,
            metricsAnalyzed: ramMetrics.length,
            highUsageFrequency: Math.round((ramValues.filter(u => u > 90).length / ramValues.length) * 100),
            // Swap indicators
            swapPressure,
            avgSwapUsage: Math.round(avgSwapUsage),
            peakSwapUsage: Math.round(peakSwapUsage),
            hoursSwapUsed: Math.round(hoursSwapUsed),
            swapMetricsAnalyzed: swapMetrics.length,
            // Available memory indicators
            availablePressure,
            avgAvailableMB: Math.round(avgAvailableMB),
            minAvailableMB,
            lowAvailableMemHours: Math.round(lowAvailableMemHours),
            availableMetricsAnalyzed: availableMemoryMetrics.length
          }
        })
      }
    }

    // Analyze disk under-provisioning from latest snapshot
    const diskUsage = this.extractDiskSpaceData(context)
    if (diskUsage) {
      try {
        for (const [drive, usage] of Object.entries(diskUsage)) {
          if (usage && typeof usage === 'object') {
            const usageData = usage as DiskUsageData
            const used = usageData.used || usageData.usedGB || 0
            const total = usageData.total || usageData.totalGB || 1
            const percentage = total > 0 ? (used / total) * 100 : 0

            // Disk under-provisioning: Storage usage >90%
            if (percentage > 90) {
              // Calculate recommendation based on this specific drive's capacity
              const currentDriveGB = Math.round(total)
              const recommendedDriveGB = Math.ceil(currentDriveGB * 1.3) // 30% increase
              const performanceImpact = percentage > 95 ? 'high' : 'medium'

              // Calculate additional space needed
              const additionalSpaceNeeded = recommendedDriveGB - currentDriveGB

              results.push({
                type: 'UNDER_PROVISIONED',
                text: `VM disk space is critically low - ${drive} drive usage is ${Math.round(percentage)}% (${Math.round(used)}GB of ${currentDriveGB}GB used)`,
                actionText: `Consider expanding ${drive} drive from ${currentDriveGB}GB to ${recommendedDriveGB}GB (add ${additionalSpaceNeeded}GB) to prevent performance issues`,
                data: {
                  resourceType: 'DISK',
                  drive,
                  currentDriveGB,
                  usedGB: Math.round(used),
                  totalGB: Math.round(total),
                  usagePercent: Math.round(percentage),
                  recommendedDriveGB,
                  additionalSpaceNeeded,
                  performanceImpact,
                  availableGB: Math.round(total - used),
                  // Include machine-level disk config for context
                  machineConfigDiskGB: allocatedDiskGB
                }
              })
            }
          }
        }
      } catch (error) {
        console.warn('Failed to analyze disk usage for under-provisioning:', error)
      }
    }

    // Analyze disk I/O under-provisioning from historical metrics
    if (context.historicalMetrics.length >= 10) {
      try {
        const ioMetrics = context.historicalMetrics
          .map(m => {
            if (m.diskIOStats) {
              try {
                const ioData = typeof m.diskIOStats === 'string'
                  ? JSON.parse(m.diskIOStats)
                  : m.diskIOStats

                if (ioData && typeof ioData === 'object') {
                  const readBytes = ioData.readBytes || ioData.diskReadBytes || ioData.bytesRead || 0
                  const writeBytes = ioData.writeBytes || ioData.diskWriteBytes || ioData.bytesWrite || 0

                  if (readBytes > 0 || writeBytes > 0) {
                    return {
                      readMB: Math.round(readBytes / (1024 * 1024)),
                      writeMB: Math.round(writeBytes / (1024 * 1024)),
                      totalMB: Math.round((readBytes + writeBytes) / (1024 * 1024)),
                      timestamp: m.timestamp
                    }
                  }
                }
              } catch (error) {
                console.warn('Failed to parse diskIOStats:', error)
              }
            }
            return null
          })
          .filter(m => m !== null) as { readMB: number; writeMB: number; totalMB: number; timestamp: Date }[]

        if (ioMetrics.length >= 5) {
          // Calculate I/O rates and patterns
          const ioRates = []
          for (let i = 1; i < ioMetrics.length; i++) {
            const current = ioMetrics[i]
            const previous = ioMetrics[i - 1]
            const timeDiffSeconds = (current.timestamp.getTime() - previous.timestamp.getTime()) / 1000

            if (timeDiffSeconds > 0 && timeDiffSeconds < 3600) { // Ignore gaps > 1 hour
              const readRate = Math.max(0, (current.readMB - previous.readMB) / timeDiffSeconds) // MB/s
              const writeRate = Math.max(0, (current.writeMB - previous.writeMB) / timeDiffSeconds) // MB/s
              const totalRate = readRate + writeRate

              ioRates.push({
                readRate,
                writeRate,
                totalRate,
                timestamp: current.timestamp
              })
            }
          }

          if (ioRates.length >= 3) {
            const totalRates = ioRates.map(r => r.totalRate)
            const avgTotalRate = totalRates.reduce((sum, rate) => sum + rate, 0) / totalRates.length

            // Check for sustained low throughput indicating I/O bottlenecks
            const lowThroughputCount = totalRates.filter(rate => rate < 5).length // Less than 5 MB/s
            const lowThroughputPercent = (lowThroughputCount / totalRates.length) * 100

            // Analyze I/O wait from resourceOptInfo
            let avgIoWaitPercent = 0
            let ioWaitHigh = false

            if (context.latestSnapshot?.resourceOptInfo) {
              try {
                const resourceData = typeof context.latestSnapshot.resourceOptInfo === 'string'
                  ? JSON.parse(context.latestSnapshot.resourceOptInfo)
                  : context.latestSnapshot.resourceOptInfo

                if (resourceData && typeof resourceData === 'object') {
                  const ioStats = resourceData.diskIOStats || resourceData
                  avgIoWaitPercent = ioStats.ioWaitPercent || ioStats.await || ioStats.avgWait || 0
                  ioWaitHigh = avgIoWaitPercent > 20 // >20% I/O wait is concerning
                }
              } catch (error) {
                console.warn('Failed to parse resource optimization data for I/O stats:', error)
              }
            }

            // Generate under-provisioning recommendation for sustained I/O bottlenecks
            if (lowThroughputPercent > 60 || ioWaitHigh) {
              const performanceImpact = (ioWaitHigh && lowThroughputPercent > 80) ? 'high' : 'medium'
              let message = ''
              let actionText = ''

              if (ioWaitHigh && lowThroughputPercent > 60) {
                message = `VM experiencing sustained disk I/O bottlenecks - high I/O wait time (${Math.round(avgIoWaitPercent)}%) and low throughput ${Math.round(lowThroughputPercent)}% of the time`
                actionText = 'Upgrade to faster storage (SSD), increase IOPS allocation, or optimize disk configuration for better performance'
              } else if (ioWaitHigh) {
                message = `VM experiencing high disk I/O wait times (${Math.round(avgIoWaitPercent)}%) indicating storage performance bottlenecks`
                actionText = 'Upgrade storage performance or investigate high I/O applications'
              } else {
                message = `VM showing sustained low disk throughput (${Math.round(avgTotalRate)} MB/s average) in ${Math.round(lowThroughputPercent)}% of measurements`
                actionText = 'Consider storage optimization, upgrade to faster storage, or increase IOPS allocation'
              }

              results.push({
                type: 'UNDER_PROVISIONED',
                text: message,
                actionText,
                data: {
                  resourceType: 'DISK_PERF',
                  avgThroughputMBs: Math.round(avgTotalRate),
                  lowThroughputPercent: Math.round(lowThroughputPercent),
                  avgIoWaitPercent: Math.round(avgIoWaitPercent),
                  ioWaitHigh,
                  performanceImpact,
                  metricsAnalyzed: ioRates.length,
                  recommendedAction: ioWaitHigh ? 'upgrade_storage_performance' : 'optimize_disk_configuration'
                }
              })
            }
          }
        }
      } catch (error) {
        console.warn('Failed to analyze disk I/O for under-provisioning:', error)
      }
    }

    return results
  }
}

class OsUpdateChecker extends RecommendationChecker {
  getName (): string { return 'OsUpdateChecker' }
  getCategory (): string { return 'Maintenance' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.latestSnapshot?.windowsUpdateInfo) {
      return results
    }

    try {
      // Parse windowsUpdateInfo JSON data
      const updateData = typeof context.latestSnapshot.windowsUpdateInfo === 'string'
        ? JSON.parse(context.latestSnapshot.windowsUpdateInfo)
        : context.latestSnapshot.windowsUpdateInfo

      if (!updateData || typeof updateData !== 'object') {
        console.warn('VMRecommendationService: Invalid windowsUpdateInfo format')
        return results
      }

      // Collect all update-related issues into flags and details
      const flags: string[] = []
      const details: Record<string, string | number | boolean | (string | undefined)[]> = {}
      const issues: string[] = []
      const actions: string[] = []
      let highestSeverity = 'low'

      // Check Windows Update last check freshness (7 days threshold)
      const lastCheckResult = this.parseAndCalculateDaysSince(updateData.last_check_date)
      if (lastCheckResult.isValid && lastCheckResult.daysSince > 7) {
        flags.push('stale_check_date')
        details.lastCheckDate = updateData.last_check_date
        details.daysSinceLastCheck = lastCheckResult.daysSince
        issues.push(`last checked ${lastCheckResult.daysSince} days ago`)
        actions.push('check for updates')
        if (highestSeverity === 'low') highestSeverity = 'medium'
      }

      // Analyze pending updates
      const pendingUpdates = updateData.pending_updates || []
      if (Array.isArray(pendingUpdates) && pendingUpdates.length > 0) {
        flags.push('pending_updates')

        // Categorize updates by severity
        const criticalUpdates = pendingUpdates.filter(u => u.severity === 'Critical' || u.importance === 'Critical')
        const importantUpdates = pendingUpdates.filter(u => u.severity === 'Important' || u.importance === 'Important')
        const securityUpdates = pendingUpdates.filter(u => u.is_security_update === true || u.security === true)

        // Calculate total update size if available
        const totalSizeMB = pendingUpdates.reduce((sum, update) => {
          const sizeBytes = update.size_bytes || update.download_size || 0
          return sum + (sizeBytes / (1024 * 1024))
        }, 0)

        details.totalUpdates = pendingUpdates.length
        details.criticalCount = criticalUpdates.length
        details.importantCount = importantUpdates.length
        details.securityCount = securityUpdates.length
        details.optionalCount = pendingUpdates.length - criticalUpdates.length - importantUpdates.length
        details.totalSizeMB = Math.round(totalSizeMB)
        details.updateTitles = pendingUpdates.slice(0, 10).map((u: WindowsUpdate) => u.title || u.name || u.kb_number).filter(Boolean)

        issues.push(`${pendingUpdates.length} updates available (${criticalUpdates.length} critical, ${importantUpdates.length} important, ${securityUpdates.length} security)`)
        actions.push('install pending updates')

        // Determine severity based on update criticality
        if (criticalUpdates.length > 0) {
          highestSeverity = 'critical'
        } else if (importantUpdates.length > 0 && (highestSeverity === 'low' || highestSeverity === 'medium')) {
          highestSeverity = 'high'
        } else if (highestSeverity === 'low') {
          highestSeverity = 'medium'
        }
      }

      // Check for required reboot
      if (updateData.reboot_required === true) {
        flags.push('reboot_required')
        details.rebootRequired = true
        details.updatesPendingReboot = updateData.pending_reboot_updates || 0
        issues.push('system restart required')
        actions.push('restart computer')
        if (highestSeverity === 'low') highestSeverity = 'medium'
      }

      // Check for disabled automatic updates
      if (updateData.automatic_updates_enabled === false) {
        flags.push('auto_updates_disabled')
        details.automaticUpdatesDisabled = true
        issues.push('automatic updates disabled')
        actions.push('enable automatic updates')
        if (highestSeverity === 'low') highestSeverity = 'medium'
      }

      // Create consolidated recommendation if any issues found
      if (flags.length > 0) {
        const vmName = context.machineConfig?.name || 'VM'
        const text = `Windows Update issues detected on ${vmName}: ${issues.join(', ')}`
        const actionText = `Address Windows Update issues on ${vmName}: ${actions.join(', ')} through Settings > Update & Security > Windows Update`

        results.push({
          type: 'OS_UPDATE_AVAILABLE',
          text,
          actionText,
          data: {
            flags,
            severity: highestSeverity,
            ...details
          }
        })
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse windowsUpdateInfo:', error)
    }

    return results
  }
}

class AppUpdateChecker extends RecommendationChecker {
  getName (): string { return 'AppUpdateChecker' }
  getCategory (): string { return 'Maintenance' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.latestSnapshot?.applicationInventory) {
      return results
    }

    try {
      // Parse applicationInventory JSON data
      const inventoryData = typeof context.latestSnapshot.applicationInventory === 'string'
        ? JSON.parse(context.latestSnapshot.applicationInventory)
        : context.latestSnapshot.applicationInventory

      if (!inventoryData || typeof inventoryData !== 'object') {
        console.warn('VMRecommendationService: Invalid applicationInventory format')
        return results
      }

      // Access the applications array within the inventory
      const applications = inventoryData.applications || []
      if (!Array.isArray(applications)) {
        return results
      }

      // Filter applications with available updates
      const updatableApps = applications.filter(app =>
        app &&
        typeof app === 'object' &&
        app.update_available &&
        app.update_available !== null &&
        app.update_available !== ''
      )

      if (updatableApps.length === 0) {
        return results
      }

      // Prioritize security updates
      const securityUpdates = updatableApps.filter(app => app.is_security_update === true)
      const regularUpdates = updatableApps.filter(app => app.is_security_update !== true)

      // Calculate total update size
      const totalSizeMB = updatableApps.reduce((sum, app) => {
        const sizeBytes = app.update_size_bytes || 0
        return sum + (sizeBytes / (1024 * 1024))
      }, 0)

      // Generate individual recommendations for top 5 most important apps
      const topApps = [
        ...securityUpdates.slice(0, 3), // Top 3 security updates
        ...regularUpdates.slice(0, 2) // Top 2 regular updates
      ].slice(0, 5)

      for (const app of topApps) {
        const isSecurityUpdate = app.is_security_update === true
        const appName = app.name || app.app_name || 'Unknown Application'
        const currentVersion = app.version || app.current_version || 'Unknown'
        const availableVersion = app.update_available || app.new_version || 'Unknown'
        const updateSource = app.update_source || 'Windows Update'
        const vmName = context.machineConfig?.name || 'VM'

        const text = isSecurityUpdate
          ? `Security update available for ${appName} on ${vmName} (current: ${currentVersion}, available: ${availableVersion})`
          : `Update available for ${appName} on ${vmName} (current: ${currentVersion}, available: ${availableVersion})`

        const actionText = isSecurityUpdate
          ? `Update ${appName} on ${vmName} through ${updateSource} to fix security vulnerabilities`
          : `Update ${appName} on ${vmName} through ${updateSource} to get new features and improvements`

        results.push({
          type: 'APP_UPDATE_AVAILABLE',
          text,
          actionText,
          data: {
            appName,
            currentVersion,
            availableVersion,
            updateSource,
            isSecurityUpdate,
            updateSizeMB: app.update_size_bytes ? Math.round(app.update_size_bytes / (1024 * 1024)) : null,
            severity: isSecurityUpdate ? 'high' : 'medium'
          }
        })
      }

      // Create summary recommendation if more than 5 apps have updates
      if (updatableApps.length > 5) {
        const totalCount = updatableApps.length
        const securityCount = securityUpdates.length

        results.push({
          type: 'APP_UPDATE_AVAILABLE',
          text: `${totalCount} application updates available (${securityCount} security updates)`,
          actionText: 'Review and install available updates to keep applications secure and up-to-date',
          data: {
            totalCount,
            securityCount,
            regularCount: regularUpdates.length,
            totalSizeMB: Math.round(totalSizeMB),
            topApps: updatableApps.slice(0, 10).map((app: Application) => ({
              name: app.name || app.app_name,
              currentVersion: app.version || app.current_version,
              availableVersion: app.update_available || app.new_version,
              isSecurityUpdate: app.is_security_update === true
            })),
            severity: securityCount > 0 ? 'high' : 'medium'
          }
        })
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse applicationInventory:', error)
    }

    return results
  }
}

class DefenderDisabledChecker extends RecommendationChecker {
  getName (): string { return 'DefenderDisabledChecker' }
  getCategory (): string { return 'Security' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.latestSnapshot?.defenderStatus) {
      return results
    }

    try {
      // Parse defenderStatus JSON data
      const defenderData = typeof context.latestSnapshot.defenderStatus === 'string'
        ? JSON.parse(context.latestSnapshot.defenderStatus)
        : context.latestSnapshot.defenderStatus

      if (!defenderData || typeof defenderData !== 'object') {
        console.warn('VMRecommendationService: Invalid defenderStatus format')
        return results
      }

      // Check if Defender is completely disabled
      if (defenderData.enabled === false) {
        results.push({
          type: 'DEFENDER_DISABLED',
          text: 'Windows Defender antivirus protection is disabled',
          actionText: 'Enable Windows Defender through Settings > Update & Security > Windows Security',
          data: {
            defenderDisabled: true,
            realTimeProtection: defenderData.real_time_protection || false,
            lastQuickScan: defenderData.last_quick_scan,
            lastFullScan: defenderData.last_full_scan,
            signatureAge: defenderData.signature_age_days,
            severity: 'critical'
          }
        })
      }
      // Check if real-time protection is disabled (but Defender is enabled)
      else if (defenderData.real_time_protection === false) {
        const vmName = context.machineConfig?.name || 'VM'
        results.push({
          type: 'DEFENDER_DISABLED',
          text: `Windows Defender real-time protection is disabled on ${vmName}`,
          actionText: `Enable real-time protection on ${vmName} in Windows Security > Virus & threat protection settings`,
          data: {
            realTimeProtectionDisabled: true,
            defenderEnabled: true,
            lastQuickScan: defenderData.last_quick_scan,
            lastFullScan: defenderData.last_full_scan,
            signatureAge: defenderData.signature_age_days,
            severity: 'high'
          }
        })
      }

      // Check signature age (skip if unknown - signature_age_days: 999 indicates unknown)
      const signatureAge = defenderData.signature_age_days
      if (typeof signatureAge === 'number' && signatureAge !== 999) {
        const vmName = context.machineConfig?.name || 'VM'
        if (signatureAge > 7) {
          results.push({
            type: 'DEFENDER_DISABLED',
            text: `Windows Defender virus signatures on ${vmName} are ${signatureAge} days old`,
            actionText: `Update virus signatures on ${vmName} through Windows Security > Virus & threat protection > Check for updates`,
            data: {
              outdatedSignatures: true,
              signatureAgeDays: signatureAge,
              lastSignatureUpdate: defenderData.last_signature_update,
              engineVersion: defenderData.engine_version,
              severity: signatureAge > 14 ? 'high' : 'medium'
            }
          })
        } else if (signatureAge > 3) {
          results.push({
            type: 'DEFENDER_DISABLED',
            text: `Windows Defender virus signatures on ${vmName} are ${signatureAge} days old`,
            actionText: `Update virus signatures on ${vmName} through Windows Security > Virus & threat protection > Check for updates`,
            data: {
              outdatedSignatures: true,
              signatureAgeDays: signatureAge,
              lastSignatureUpdate: defenderData.last_signature_update,
              engineVersion: defenderData.engine_version,
              severity: 'medium'
            }
          })
        }
      }

      // Check for missing recent scans
      const lastQuickScan = defenderData.last_quick_scan
      const lastFullScan = defenderData.last_full_scan

      if (!lastQuickScan && !lastFullScan) {
        results.push({
          type: 'DEFENDER_DISABLED',
          text: 'No recent Windows Defender scans detected',
          actionText: 'Run a quick scan through Windows Security > Virus & threat protection',
          data: {
            noRecentScans: true,
            lastQuickScan: null,
            lastFullScan: null,
            scanHistory: defenderData.scan_history || [],
            severity: 'medium'
          }
        })
      } else {
        // Check if scans are too old (more than 7 days for quick scan)
        const quickScanResult = this.parseAndCalculateDaysSince(lastQuickScan)
        if (quickScanResult.isValid && quickScanResult.daysSince > 7) {
          results.push({
            type: 'DEFENDER_DISABLED',
            text: `Last Windows Defender quick scan was ${quickScanResult.daysSince} days ago`,
            actionText: 'Run a quick scan through Windows Security > Virus & threat protection',
            data: {
              outdatedScans: true,
              daysSinceQuickScan: quickScanResult.daysSince,
              lastQuickScan,
              lastFullScan,
              severity: quickScanResult.daysSince > 14 ? 'medium' : 'low'
            }
          })
        }
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse defenderStatus:', error)
    }

    return results
  }
}

class DefenderThreatChecker extends RecommendationChecker {
  getName (): string { return 'DefenderThreatChecker' }
  getCategory (): string { return 'Security' }

  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    const results: RecommendationResult[] = []

    if (!context.latestSnapshot?.defenderStatus) {
      return results
    }

    try {
      // Parse defenderStatus JSON data
      const defenderData = typeof context.latestSnapshot.defenderStatus === 'string'
        ? JSON.parse(context.latestSnapshot.defenderStatus)
        : context.latestSnapshot.defenderStatus

      if (!defenderData || typeof defenderData !== 'object') {
        console.warn('VMRecommendationService: Invalid defenderStatus format for threat analysis')
        return results
      }

      // Check threats detected count
      const threatsDetected = defenderData.threats_detected || 0
      const recentThreats = defenderData.recent_threats || []

      if (threatsDetected > 0 || (Array.isArray(recentThreats) && recentThreats.length > 0)) {
        // Analyze recent threats for severity and status
        const activeThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          threat.status &&
          (threat.status.toLowerCase() === 'active' || threat.status.toLowerCase() === 'detected')
        )

        const quarantinedThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          threat.status &&
          threat.status.toLowerCase() === 'quarantined'
        )

        const highSeverityThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          typeof threat.severity_id === 'number' &&
          threat.severity_id >= 4 // High/Severe threats (4-5)
        )

        const mediumSeverityThreats = recentThreats.filter((threat: ThreatInfo) =>
          threat &&
          typeof threat.severity_id === 'number' &&
          threat.severity_id >= 2 && threat.severity_id < 4 // Medium threats (2-3)
        )

        // Generate recommendations based on threat analysis
        if (activeThreats.length > 0) {
          // Active threats - highest priority
          const threatNames = activeThreats.slice(0, 3).map((t: ThreatInfo) => t.name || t.threat_name || 'Unknown threat')

          results.push({
            type: 'DEFENDER_THREAT',
            text: `${activeThreats.length} active security threats detected by Windows Defender`,
            actionText: 'Immediately review and remove threats through Windows Security > Virus & threat protection > Protection history',
            data: {
              activeThreats: activeThreats.length,
              totalThreats: threatsDetected,
              threatNames,
              highSeverityCount: highSeverityThreats.length,
              detectionDates: activeThreats.slice(0, 5).map((t: ThreatInfo) => t.detection_time || t.detected_at),
              severity: 'critical'
            }
          })
        } else if (highSeverityThreats.length > 0) {
          // High-severity threats (even if not active)
          const threatName = highSeverityThreats[0].name || highSeverityThreats[0].threat_name || 'Unknown threat'

          results.push({
            type: 'DEFENDER_THREAT',
            text: `High-severity threat detected: ${threatName}`,
            actionText: 'Immediately review and remove this threat through Windows Security',
            data: {
              highSeverityThreats: highSeverityThreats.length,
              totalThreats: threatsDetected,
              threatName,
              severityId: highSeverityThreats[0].severity_id,
              detectionTime: highSeverityThreats[0].detection_time || highSeverityThreats[0].detected_at,
              status: highSeverityThreats[0].status,
              severity: 'high'
            }
          })
        } else if (quarantinedThreats.length > 0) {
          // Quarantined threats
          results.push({
            type: 'DEFENDER_THREAT',
            text: `${quarantinedThreats.length} threats quarantined by Windows Defender`,
            actionText: 'Review quarantined threats and ensure they are properly removed',
            data: {
              quarantinedThreats: quarantinedThreats.length,
              totalThreats: threatsDetected,
              threatNames: quarantinedThreats.slice(0, 5).map((t: ThreatInfo) => t.name || t.threat_name || 'Unknown threat'),
              quarantineDates: quarantinedThreats.slice(0, 5).map((t: ThreatInfo) => t.quarantine_time || t.detection_time),
              severity: 'medium'
            }
          })
        } else if (threatsDetected > 0) {
          // General threat activity
          const recentActivity = recentThreats.some((threat: ThreatInfo) => {
            const dateResult = this.parseAndCalculateDaysSince(threat.detection_time || threat.detected_at)
            return dateResult.isValid && dateResult.daysSince <= 7
          })

          if (recentActivity) {
            results.push({
              type: 'DEFENDER_THREAT',
              text: 'Recent security threat activity detected (last 7 days)',
              actionText: 'Monitor system security and consider running a full system scan',
              data: {
                totalThreats: threatsDetected,
                recentActivity: true,
                mediumSeverityCount: mediumSeverityThreats.length,
                threatTimeline: recentThreats.slice(0, 5).map((t: ThreatInfo) => ({
                  name: t.name || t.threat_name,
                  detectionTime: t.detection_time || t.detected_at,
                  status: t.status,
                  severity: t.severity_id
                })),
                severity: 'medium'
              }
            })
          }
        }
      }
    } catch (error) {
      console.warn('VMRecommendationService: Failed to parse defenderStatus for threat analysis:', error)
    }

    return results
  }
}

interface CacheEntry {
  data: any
  timestamp: number
  ttl: number
}

interface PerformanceMetrics {
  totalGenerations: number
  averageGenerationTime: number
  cacheHitRate: number
  cacheHits: number
  cacheMisses: number
  contextBuildTime: number
  checkerTimes: Map<string, number>
  errorCount: number
  lastError: string | null
}

interface ServiceConfiguration {
  cacheTTLMinutes: number
  maxCacheSize: number
  enablePerformanceMonitoring: boolean
  enableContextCaching: boolean
  contextCacheTTLMinutes: number
  performanceLoggingThreshold: number
  maxRetries: number
  retryDelayMs: number
}

export class VMRecommendationService {
  private checkers: RecommendationChecker[] = []
  private cache = new Map<string, CacheEntry>()
  private contextCache = new Map<string, CacheEntry>()
  private performanceMetrics: PerformanceMetrics
  private config: ServiceConfiguration
  private maintenanceTimer: NodeJS.Timeout | null = null
  private isDisposed: boolean = false

  constructor (private prisma: PrismaClient) {
    this.config = this.loadConfiguration()
    this.performanceMetrics = this.initializePerformanceMetrics()
    this.registerDefaultCheckers()
    this.validateConfiguration()
    this.startMaintenanceTimer()
  }

  private registerDefaultCheckers (): void {
    const enabledCheckers: string[] = []
    const disabledCheckers: string[] = []

    // Helper function to register checker with validation and logging
    const registerIfEnabled = (envVar: string, CheckerClass: new () => RecommendationChecker, description: string): void => {
      if (process.env[envVar] !== 'false') {
        try {
          const checker = new CheckerClass()
          this.registerChecker(checker)
          enabledCheckers.push(`${checker.getName()} (${checker.getCategory()})`)
          console.debug(`VM Recommendations: ${description} enabled`)
        } catch (error) {
          const standardizedError = new AppError(
            `Failed to register VM recommendation checker: ${description}`,
            ErrorCode.VM_RECOMMENDATION_ERROR,
            500,
            true,
            { checker: description, operation: 'registerChecker' }
          )
          console.error(`VM Recommendations: Failed to register ${description}:`, {
            message: standardizedError.message,
            code: standardizedError.code,
            context: standardizedError.context,
            originalError: (error as Error).message
          })
        }
      } else {
        disabledCheckers.push(description)
        console.debug(`VM Recommendations: ${description} disabled via ${envVar}`)
      }
    }

    // Core resource analysis checkers
    registerIfEnabled('ENABLE_DISK_SPACE_CHECKER', DiskSpaceChecker, 'DiskSpaceChecker')
    registerIfEnabled('ENABLE_RESOURCE_OPTIMIZATION_CHECKER', ResourceOptimizationChecker, 'ResourceOptimizationChecker')
    registerIfEnabled('ENABLE_OVER_PROVISIONED_CHECKER', OverProvisionedChecker, 'OverProvisionedChecker')
    registerIfEnabled('ENABLE_UNDER_PROVISIONED_CHECKER', UnderProvisionedChecker, 'UnderProvisionedChecker')
    registerIfEnabled('ENABLE_DISK_IO_BOTTLENECK_CHECKER', DiskIOBottleneckChecker, 'DiskIOBottleneckChecker')

    // Security checkers (prioritized first for security recommendations)
    registerIfEnabled('ENABLE_DEFENDER_DISABLED_CHECKER', DefenderDisabledChecker, 'DefenderDisabledChecker')
    registerIfEnabled('ENABLE_DEFENDER_THREAT_CHECKER', DefenderThreatChecker, 'DefenderThreatChecker')
    registerIfEnabled('ENABLE_PORT_BLOCKED_CHECKER', PortConflictChecker, 'PortConflictChecker')

    // Update and maintenance checkers
    registerIfEnabled('ENABLE_OS_UPDATE_CHECKER', OsUpdateChecker, 'OsUpdateChecker')
    registerIfEnabled('ENABLE_APP_UPDATE_CHECKER', AppUpdateChecker, 'AppUpdateChecker')

    // Validation and summary logging
    const totalCheckers = this.checkers.length
    const uniqueNames = new Set(this.checkers.map(c => c.getName()))

    if (uniqueNames.size !== totalCheckers) {
      console.warn('VM Recommendations: Duplicate checker names detected - this may cause issues')
    }

    console.log(`VM Recommendations: Successfully registered ${totalCheckers} recommendation checkers`)
    console.log(`VM Recommendations: Enabled checkers: ${enabledCheckers.join(', ')}`)

    if (disabledCheckers.length > 0) {
      console.log(`VM Recommendations: Disabled checkers: ${disabledCheckers.join(', ')}`)
    }

    // Log security and update checker status
    const securityCheckers = this.checkers.filter(c => c.getCategory() === 'Security').length
    const maintenanceCheckers = this.checkers.filter(c => c.getCategory() === 'Maintenance').length
    console.log(`VM Recommendations: Security checkers: ${securityCheckers}, Maintenance checkers: ${maintenanceCheckers}`)
  }

  registerChecker (checker: RecommendationChecker): void {
    this.checkers.push(checker)
  }

  /**
   * Safe wrapper for generating recommendations with standardized error handling
   * This method provides a service-level contract that prevents sensitive error details from leaking
   */
  public async generateRecommendationsSafe(vmId: string, snapshotId?: string): Promise<RecommendationOperationResult> {
    try {
      const recommendations = await this.generateRecommendations(vmId, snapshotId)
      return {
        success: true,
        recommendations
      }
    } catch (error) {
      // Log detailed error information (including context) for debugging
      if (error instanceof AppError) {
        console.error('VM Recommendation Service Error:', {
          message: error.message,
          code: error.code,
          context: error.context,
          vmId,
          snapshotId,
          timestamp: new Date().toISOString()
        })
      } else {
        console.error('Unexpected VM Recommendation Service Error:', {
          message: (error as Error).message,
          vmId,
          snapshotId,
          timestamp: new Date().toISOString(),
          stack: (error as Error).stack?.substring(0, 500)
        })
      }

      // Return generic error message to prevent sensitive information leakage
      return {
        success: false,
        error: 'Failed to generate recommendations'
      }
    }
  }

  async generateRecommendations (vmId: string, snapshotId?: string): Promise<VMRecommendation[]> {
    // Check if service has been disposed
    if (this.isDisposed) {
      throw new AppError(
        'VM recommendation service has been disposed and cannot generate recommendations',
        ErrorCode.VM_RECOMMENDATION_GENERATION_FAILED,
        500,
        true,
        { vmId, snapshotId, operation: 'generateRecommendations', service: 'VMRecommendationService' }
      )
    }

    const startTime = Date.now()
    const cacheKey = `recommendations:${vmId}:${snapshotId || 'latest'}`

    try {
      // Check cache first if enabled
      if (this.config.enableContextCaching) {
        const cachedResult = this.getFromCache(cacheKey)
        if (cachedResult) {
          console.log(`⚡ Cache hit for recommendations ${vmId} (${snapshotId || 'latest'})`)
          this.updateCacheHitRate(true)
          return cachedResult
        }
        this.updateCacheHitRate(false)
      }

      console.log(`💡 Generating recommendations for VM ${vmId}${snapshotId ? ` snapshot ${snapshotId}` : ' (latest snapshot)'}`)

      // Build context with performance timing
      const contextStartTime = Date.now()
      const context = await this.buildContextWithCaching(vmId, snapshotId)
      const contextBuildTime = Date.now() - contextStartTime
      this.performanceMetrics.contextBuildTime = this.updateAverageTime(this.performanceMetrics.contextBuildTime, contextBuildTime)

      if (contextBuildTime > this.config.performanceLoggingThreshold) {
        console.warn(`⚠️ Context building took ${contextBuildTime}ms for VM ${vmId} (threshold: ${this.config.performanceLoggingThreshold}ms)`)
      }

      const results: RecommendationResult[] = []
      const checkerPerformance = new Map<string, number>()

      // Run checkers with individual performance monitoring
      for (const checker of this.checkers) {
        if (checker.isApplicable(context)) {
          const checkerStartTime = Date.now()
          try {
            const checkerResults = await this.runCheckerWithRetry(checker, context)
            results.push(...checkerResults)

            const checkerTime = Date.now() - checkerStartTime
            checkerPerformance.set(checker.getName(), checkerTime)

            // Update checker performance metrics
            const existingTime = this.performanceMetrics.checkerTimes.get(checker.getName()) || 0
            this.performanceMetrics.checkerTimes.set(checker.getName(), this.updateAverageTime(existingTime, checkerTime))

          } catch (error) {
            const checkerTime = Date.now() - checkerStartTime
            this.handleCheckerError(checker.getName(), error as Error)
            console.error(`❌ Checker ${checker.getName()} failed after ${checkerTime}ms:`, error)
          }
        }
      }

      // Save recommendations
      const savedRecommendations = await this.saveRecommendations(vmId, context.latestSnapshot?.id ?? null, results)

      const totalTime = Date.now() - startTime
      this.updatePerformanceMetrics(totalTime, results.length)

      // Cache results if enabled
      if (this.config.enableContextCaching) {
        this.setCache(cacheKey, savedRecommendations, this.config.cacheTTLMinutes * 60 * 1000)
      }

      // Log performance summary
      this.logPerformanceSummary(vmId, totalTime, contextBuildTime, checkerPerformance, results.length)

      return savedRecommendations

    } catch (error) {
      const totalTime = Date.now() - startTime
      this.handleServiceError(error as Error, vmId, totalTime)
      throw error
    }
  }

  async getRecommendations (vmId: string, refresh?: boolean, filter?: RecommendationFilterInput): Promise<VMRecommendation[]> {
    const startTime = Date.now()

    try {
      // Check if service has been disposed
      if (this.isDisposed) {
        throw new AppError(
          'VM recommendation service has been disposed and cannot process requests',
          ErrorCode.VM_RECOMMENDATION_SERVICE_ERROR,
          500,
          true,
          { vmId, operation: 'getRecommendations', service: 'VMRecommendationService' }
        )
      }

      if (refresh) {
        return this.generateRecommendations(vmId)
      }

      // Build where clause from filter
      const where: Prisma.VMRecommendationWhereInput = { machineId: vmId }

      if (filter?.types && filter.types.length > 0) {
        where.type = { in: filter.types }
      }

      if (filter?.createdAfter || filter?.createdBefore) {
        const dateFilter: Prisma.DateTimeFilter = {}
        if (filter.createdAfter) {
          dateFilter.gte = filter.createdAfter
        }
        if (filter.createdBefore) {
          dateFilter.lte = filter.createdBefore
        }
        where.createdAt = dateFilter
      }

      // Determine limit with safety bounds to prevent over-fetch
      const maxLimit = parseInt(process.env.RECOMMENDATION_MAX_LIMIT || '100')
      const defaultLimit = 20 // Reduced default limit to prevent over-fetch
      const take = filter?.limit && filter.limit > 0
        ? Math.min(filter.limit, maxLimit)
        : defaultLimit

      // Get existing recommendations with filters applied at DB level
      const existing = await this.prisma.vMRecommendation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take
      })

      // If no recommendations exist or they're old (>24 hours), generate new ones (unless filtering is active)
      if (!filter && (existing.length === 0 || this.areRecommendationsStale(existing[0].createdAt))) {
        return this.generateRecommendations(vmId)
      }

      return existing

    } catch (error) {
      const totalTime = Date.now() - startTime
      this.handleServiceError(error as Error, vmId, totalTime)
      throw error
    }
  }

  /**
   * Safe wrapper for getting recommendations with standardized error handling
   * This method provides a service-level contract that prevents sensitive error details from leaking
   */
  public async getRecommendationsSafe(vmId: string, refresh?: boolean, filter?: RecommendationFilterInput): Promise<RecommendationOperationResult> {
    try {
      // Check if service has been disposed
      if (this.isDisposed) {
        return {
          success: false,
          error: 'Service unavailable'
        }
      }

      if (refresh) {
        // Use safe generation method for refresh
        return await this.generateRecommendationsSafe(vmId)
      }

      const recommendations = await this.getRecommendations(vmId, false, filter)
      return {
        success: true,
        recommendations
      }
    } catch (error) {
      // Log detailed error information (including context) for debugging
      if (error instanceof AppError) {
        console.error('VM Recommendation Service Error (getRecommendations):', {
          message: error.message,
          code: error.code,
          context: error.context,
          vmId,
          refresh,
          filter: filter ? JSON.stringify(filter) : undefined,
          timestamp: new Date().toISOString()
        })
      } else {
        console.error('Unexpected VM Recommendation Service Error (getRecommendations):', {
          message: (error as Error).message,
          vmId,
          refresh,
          filter: filter ? JSON.stringify(filter) : undefined,
          timestamp: new Date().toISOString(),
          stack: (error as Error).stack?.substring(0, 500)
        })
      }

      // Return generic error message to prevent sensitive information leakage
      return {
        success: false,
        error: 'Service unavailable'
      }
    }
  }

  async deleteOldRecommendations (vmId: string, olderThanDays: number): Promise<void> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    await this.prisma.vMRecommendation.deleteMany({
      where: {
        machineId: vmId,
        createdAt: {
          lt: cutoffDate
        }
      }
    })
  }

  private async buildContext (vmId: string, snapshotId?: string): Promise<RecommendationContext> {
    // Environment-configurable limits
    const metricsWindowDays = parseInt(process.env.RECOMMENDATION_METRICS_WINDOW_DAYS || '7')
    const metricsMaxRows = parseInt(process.env.RECOMMENDATION_METRICS_MAX_ROWS || '1000')
    const portUsageMaxRows = parseInt(process.env.RECOMMENDATION_PORT_USAGE_MAX_ROWS || '100')

    // Fetch health snapshot - specific one if provided, otherwise latest
    const latestSnapshot = snapshotId
      ? await this.prisma.vMHealthSnapshot.findUnique({
        where: { id: snapshotId }
      })
      : await this.prisma.vMHealthSnapshot.findFirst({
        where: { machineId: vmId },
        orderBy: { snapshotDate: 'desc' }
      })

    // Fetch historical metrics with configurable window and limit
    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - metricsWindowDays)

    const historicalMetrics = await this.prisma.systemMetrics.findMany({
      where: {
        machineId: vmId,
        timestamp: { gte: windowStart }
      },
      orderBy: { timestamp: 'desc' },
      take: metricsMaxRows
    })

    // Fetch current port usage with configurable limit
    const portUsage = await this.prisma.portUsage.findMany({
      where: { machineId: vmId },
      orderBy: { timestamp: 'desc' },
      take: portUsageMaxRows
    })

    // Comment 2: Fetch VM with department NWFilters and Comment 8: include references
    const machineWithDepartment = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        department: {
          include: {
            nwFilters: {
              include: {
                nwFilter: {
                  include: {
                    rules: true,
                    references: {
                      include: {
                        targetFilter: {
                          include: { rules: true }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        nwFilters: {
          include: {
            nwFilter: {
              include: {
                rules: true,
                references: {
                  include: {
                    targetFilter: {
                      include: { rules: true }
                    }
                  }
                }
              }
            }
          }
        }
      }
    })

    // Combine VM-level and department-level filters with recursive references
    const allFilters = await this.gatherAllNWFilters(
      machineWithDepartment?.nwFilters || [],
      machineWithDepartment?.department?.nwFilters || []
    )

    // Fetch recent process snapshots (last 15-60 minutes)
    const recentProcessWindow = new Date()
    recentProcessWindow.setMinutes(recentProcessWindow.getMinutes() - 60) // 60 minutes lookback

    const recentProcessSnapshots = await this.prisma.processSnapshot.findMany({
      where: {
        machineId: vmId,
        timestamp: { gte: recentProcessWindow }
      },
      orderBy: { timestamp: 'desc' },
      take: 1000 // Limit for performance
    })

    // Fetch VM ports for misconfiguration checks
    const vmPorts = await this.prisma.vmPort.findMany({
      where: { vmId }
    })

    // Use the machine config we already fetched
    const machineConfig = machineWithDepartment

    return {
      vmId,
      latestSnapshot,
      historicalMetrics,
      recentProcessSnapshots,
      portUsage,
      firewallFilters: allFilters,
      machineConfig,
      vmPorts
    }
  }

  private async saveRecommendations (
    vmId: string,
    snapshotId: string | null,
    results: RecommendationResult[]
  ): Promise<VMRecommendation[]> {
    if (results.length === 0) {
      return []
    }

    // Prepare bulk data for createMany
    const bulkData = results.map(result => ({
      machineId: vmId,
      snapshotId,
      type: result.type,
      text: result.text,
      actionText: result.actionText,
      data: result.data ? JSON.parse(JSON.stringify(result.data)) : undefined
    }))

    // Use transaction for atomic bulk create
    return await this.prisma.$transaction(async (tx) => {
      // Bulk create
      await tx.vMRecommendation.createMany({
        data: bulkData,
        skipDuplicates: false
      })

      // Fetch the created recommendations to return them with IDs
      const createdRecommendations = await tx.vMRecommendation.findMany({
        where: {
          machineId: vmId,
          snapshotId
        },
        orderBy: { createdAt: 'desc' },
        take: results.length
      })

      // Update snapshot with recommendation metadata if snapshotId provided
      // NOTE: Considers future schema fields recommendationCount and recommendationsGeneratedAt
      if (snapshotId) {
        try {
          const recommendationMetadata = {
            count: results.length,
            generatedAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          }

          await tx.vMHealthSnapshot.update({
            where: { id: snapshotId },
            data: {
              // Store in customCheckResults for now - should be dedicated fields in schema
              customCheckResults: recommendationMetadata
            }
          })
        } catch (error) {
          const standardizedError = new AppError(
            `Failed to update snapshot recommendation metadata for snapshot ${snapshotId}`,
            ErrorCode.VM_RECOMMENDATION_ERROR,
            500,
            true,
            { snapshotId, operation: 'updateSnapshotMetadata' }
          )
          console.error(`❌ Failed to update snapshot recommendation metadata for ${snapshotId}:`, {
            message: standardizedError.message,
            code: standardizedError.code,
            context: standardizedError.context,
            originalError: (error as Error).message
          })
          // Don't throw to avoid breaking recommendation creation
        }
      }

      return createdRecommendations
    })
  }

  private areRecommendationsStale (lastCreated: Date): boolean {
    const dayAgo = new Date()
    dayAgo.setHours(dayAgo.getHours() - 24)
    return lastCreated < dayAgo
  }

  // Comment 8: Recursively gather all NWFilter rules including references
  private async gatherAllNWFilters (
    vmFilters: (VMNWFilter & {
      nwFilter: {
        rules: FWRule[]
        references: Array<{
          targetFilter: {
            rules: FWRule[]
          }
        }>
      }
    })[],
    departmentFilters: (DepartmentNWFilter & {
      nwFilter: {
        rules: FWRule[]
        references: Array<{
          targetFilter: {
            rules: FWRule[]
          }
        }>
      }
    })[]
  ): Promise<(VMNWFilter & { nwFilter: { rules: FWRule[] } })[]> {
    const processedFilters = new Set<string>()
    const result: (VMNWFilter & { nwFilter: { rules: FWRule[] } })[] = []

    // Helper function to recursively collect rules
    const collectRules = (filter: {
      rules: FWRule[]
      references?: Array<{ targetFilter: { rules: FWRule[] } }>
    }, depth = 0): FWRule[] => {
      if (depth > 3) return [] // Comment 8: Guard with depth limit to avoid cycles

      const rules = [...filter.rules]

      // Recursively collect from referenced filters
      if (filter.references) {
        for (const ref of filter.references) {
          rules.push(...collectRules(ref.targetFilter, depth + 1))
        }
      }

      return rules
    }

    // Process VM-level filters
    for (const vmFilter of vmFilters) {
      if (!processedFilters.has(vmFilter.nwFilterId)) {
        const allRules = collectRules(vmFilter.nwFilter)
        processedFilters.add(vmFilter.nwFilterId)
        result.push({
          ...vmFilter,
          nwFilter: {
            ...vmFilter.nwFilter,
            rules: allRules
          }
        })
      }
    }

    // Process department-level filters
    for (const deptFilter of departmentFilters) {
      if (!processedFilters.has(deptFilter.nwFilterId)) {
        const allRules = collectRules(deptFilter.nwFilter)
        processedFilters.add(deptFilter.nwFilterId)
        // Convert DepartmentNWFilter to VMNWFilter-like structure
        result.push({
          id: `dept-${deptFilter.id}`,
          vmId: '', // Not applicable for department filters
          nwFilterId: deptFilter.nwFilterId,
          createdAt: deptFilter.createdAt,
          updatedAt: deptFilter.updatedAt,
          nwFilter: {
            ...deptFilter.nwFilter,
            rules: allRules
          }
        } as VMNWFilter & { nwFilter: { rules: FWRule[] } })
      }
    }

    return result
  }

  /**
   * Load service configuration from environment variables
   */
  private loadConfiguration(): ServiceConfiguration {
    return {
      cacheTTLMinutes: Number(process.env.RECOMMENDATION_CACHE_TTL_MINUTES) || 15,
      maxCacheSize: Number(process.env.RECOMMENDATION_MAX_CACHE_SIZE) || 100,
      enablePerformanceMonitoring: process.env.RECOMMENDATION_PERFORMANCE_MONITORING !== 'false',
      enableContextCaching: process.env.RECOMMENDATION_CONTEXT_CACHING !== 'false',
      contextCacheTTLMinutes: Number(process.env.RECOMMENDATION_CONTEXT_CACHE_TTL_MINUTES) || 5,
      performanceLoggingThreshold: Number(process.env.RECOMMENDATION_PERFORMANCE_THRESHOLD) || 5000,
      maxRetries: Number(process.env.RECOMMENDATION_MAX_RETRIES) || 3,
      retryDelayMs: Number(process.env.RECOMMENDATION_RETRY_DELAY_MS) || 1000
    }
  }

  /**
   * Initialize performance metrics
   */
  private initializePerformanceMetrics(): PerformanceMetrics {
    return {
      totalGenerations: 0,
      averageGenerationTime: 0,
      cacheHitRate: 0,
      cacheHits: 0,
      cacheMisses: 0,
      contextBuildTime: 0,
      checkerTimes: new Map<string, number>(),
      errorCount: 0,
      lastError: null
    }
  }

  /**
   * Validate configuration and log settings
   */
  private validateConfiguration(): void {
    try {
      console.log('🔧 VMRecommendationService configuration:')
      console.log(`   - Context caching: ${this.config.enableContextCaching} (TTL: ${this.config.contextCacheTTLMinutes}min)`)
      console.log(`   - Result caching: ${this.config.cacheTTLMinutes}min (Max size: ${this.config.maxCacheSize})`)
      console.log(`   - Performance monitoring: ${this.config.enablePerformanceMonitoring}`)
      console.log(`   - Performance threshold: ${this.config.performanceLoggingThreshold}ms`)
      console.log(`   - Max retries: ${this.config.maxRetries} (Delay: ${this.config.retryDelayMs}ms)`)

      if (this.config.cacheTTLMinutes <= 0) {
        console.warn('⚠️ Cache TTL is disabled or invalid')
      }

      console.log('✅ VMRecommendationService configuration validated')
    } catch (error) {
      const standardizedError = new AppError(
        'VM recommendation service configuration validation failed',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        false, // Non-operational error - indicates configuration issue
        { operation: 'validateConfiguration', service: 'VMRecommendationService' }
      )
      console.error('❌ Configuration validation failed:', {
        message: standardizedError.message,
        code: standardizedError.code,
        context: standardizedError.context,
        originalError: (error as Error).message
      })
      throw standardizedError
    }
  }

  /**
   * Start maintenance timer for cache cleanup
   */
  private startMaintenanceTimer(): void {
    // Run maintenance every 5 minutes
    this.maintenanceTimer = setInterval(() => {
      this.performMaintenance()
    }, 5 * 60 * 1000)

    console.log('✅ VMRecommendationService maintenance timer started (5-minute intervals)')
  }

  /**
   * Build context with caching support
   */
  private async buildContextWithCaching(vmId: string, snapshotId?: string): Promise<RecommendationContext> {
    const cacheKey = `context:${vmId}:${snapshotId || 'latest'}`

    if (this.config.enableContextCaching) {
      const cachedContext = this.getFromContextCache(cacheKey)
      if (cachedContext) {
        return cachedContext
      }
    }

    const context = await this.buildContext(vmId, snapshotId)

    if (this.config.enableContextCaching) {
      this.setContextCache(cacheKey, context, this.config.contextCacheTTLMinutes * 60 * 1000)
    }

    return context
  }

  /**
   * Run checker with retry logic
   */
  private async runCheckerWithRetry(checker: RecommendationChecker, context: RecommendationContext): Promise<RecommendationResult[]> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await checker.analyze(context)
      } catch (error) {
        lastError = error as Error

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * attempt // Linear backoff
          console.warn(`⚠️ Checker ${checker.getName()} failed (attempt ${attempt}/${this.config.maxRetries}), retrying in ${delay}ms:`, error)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError || new AppError(
      'Recommendation checker failed',
      ErrorCode.VM_RECOMMENDATION_CHECKER_FAILED,
      500,
      true,
      { checker: checker.getName(), maxRetries: this.config.maxRetries.toString() }
    )
  }

  /**
   * Get data from cache
   */
  private getFromCache(key: string): any | null {
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      return entry.data
    }

    if (entry) {
      this.cache.delete(key) // Clean up expired entry
    }

    return null
  }

  /**
   * Set data in cache
   */
  private setCache(key: string, data: any, ttl: number): void {
    // Implement cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })
  }

  /**
   * Get data from context cache
   */
  private getFromContextCache(key: string): RecommendationContext | null {
    const entry = this.contextCache.get(key)
    if (entry && Date.now() - entry.timestamp < entry.ttl) {
      return entry.data
    }

    if (entry) {
      this.contextCache.delete(key) // Clean up expired entry
    }

    return null
  }

  /**
   * Set data in context cache
   */
  private setContextCache(key: string, data: RecommendationContext, ttl: number): void {
    // Context cache has separate size limit
    if (this.contextCache.size >= 50) { // Fixed limit for context cache
      const firstKey = this.contextCache.keys().next().value
      if (firstKey) {
        this.contextCache.delete(firstKey)
      }
    }

    this.contextCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })
  }

  /**
   * Update cache hit rate
   */
  private updateCacheHitRate(isHit: boolean): void {
    if (isHit) {
      this.performanceMetrics.cacheHits++
    } else {
      this.performanceMetrics.cacheMisses++
    }

    const total = this.performanceMetrics.cacheHits + this.performanceMetrics.cacheMisses
    this.performanceMetrics.cacheHitRate = this.performanceMetrics.cacheHits / total
  }

  /**
   * Update average time metric
   */
  private updateAverageTime(currentAverage: number, newTime: number): number {
    const count = this.performanceMetrics.totalGenerations || 1
    return ((currentAverage * (count - 1)) + newTime) / count
  }

  /**
   * Update performance metrics after recommendation generation
   */
  private updatePerformanceMetrics(totalTime: number, recommendationCount: number): void {
    this.performanceMetrics.totalGenerations++
    this.performanceMetrics.averageGenerationTime = this.updateAverageTime(
      this.performanceMetrics.averageGenerationTime,
      totalTime
    )

    console.debug(`📊 Generated ${recommendationCount} recommendations in ${totalTime}ms (avg: ${Math.round(this.performanceMetrics.averageGenerationTime)}ms)`)
  }

  /**
   * Handle checker-specific errors
   */
  private handleCheckerError(checkerName: string, error: Error): void {
    this.performanceMetrics.errorCount++
    this.performanceMetrics.lastError = `${checkerName}: ${error.message}`

    const standardizedError = error instanceof AppError
      ? error
      : new AppError(
          'Recommendation checker failed',
          ErrorCode.VM_RECOMMENDATION_CHECKER_FAILED,
          500,
          true,
          { checker: checkerName, originalError: error.name }
        )

    console.error(`❌ Checker error in ${checkerName}:`, {
      originalError: error.message,
      errorName: error.name,
      errorStack: error.stack?.substring(0, 200) + '...',
      checkerName,
      code: standardizedError.code,
      context: standardizedError.context
    })
  }

  /**
   * Handle service-level errors
   */
  private handleServiceError(error: Error, vmId: string, totalTime: number): void {
    this.performanceMetrics.errorCount++
    this.performanceMetrics.lastError = `Service error for VM ${vmId}: ${error.message}`

    const standardizedError = error instanceof AppError
      ? error
      : new AppError(
          'VM recommendation service failed',
          ErrorCode.VM_RECOMMENDATION_SERVICE_ERROR,
          500,
          true,
          {
            vmId,
            totalTime: totalTime.toString(),
            operation: 'getRecommendations',
            service: 'VMRecommendationService'
          }
        )

    console.error(`❌ VMRecommendationService error for VM ${vmId} after ${totalTime}ms:`, {
      originalError: error.message,
      errorName: error.name,
      errorStack: error.stack?.substring(0, 300) + '...',
      vmId,
      totalTime,
      code: standardizedError.code,
      context: standardizedError.context
    })

    // Note: Error is logged but not re-thrown to allow safe wrapper methods to handle normalization
    // Re-throw the standardized error to propagate it properly (only for non-safe method calls)
    throw standardizedError
  }

  /**
   * Log performance summary
   */
  private logPerformanceSummary(vmId: string, totalTime: number, contextTime: number, checkerTimes: Map<string, number>, recommendationCount: number): void {
    if (!this.config.enablePerformanceMonitoring) return

    const slowCheckers = Array.from(checkerTimes.entries())
      .filter(([, time]) => time > 1000) // > 1 second
      .sort((a, b) => b[1] - a[1])

    if (totalTime > this.config.performanceLoggingThreshold || slowCheckers.length > 0) {
      console.log(`📊 Performance summary for VM ${vmId}:`)
      console.log(`   - Total time: ${totalTime}ms`)
      console.log(`   - Context build: ${contextTime}ms`)
      console.log(`   - Recommendations: ${recommendationCount}`)

      if (slowCheckers.length > 0) {
        console.log(`   - Slow checkers:`)
        slowCheckers.forEach(([name, time]) => {
          console.log(`     • ${name}: ${time}ms`)
        })
      }
    }
  }

  /**
   * Perform maintenance tasks
   */
  private performMaintenance(): void {
    try {
      // Clean expired cache entries
      let cacheCleanedCount = 0
      let contextCacheCleanedCount = 0

      const now = Date.now()

      // Clean main cache
      for (const [key, entry] of this.cache.entries()) {
        if (now - entry.timestamp >= entry.ttl) {
          this.cache.delete(key)
          cacheCleanedCount++
        }
      }

      // Clean context cache
      for (const [key, entry] of this.contextCache.entries()) {
        if (now - entry.timestamp >= entry.ttl) {
          this.contextCache.delete(key)
          contextCacheCleanedCount++
        }
      }

      if (cacheCleanedCount > 0 || contextCacheCleanedCount > 0) {
        console.log(`🧹 Cache maintenance: cleaned ${cacheCleanedCount} main cache entries, ${contextCacheCleanedCount} context cache entries`)
      }

      // Log performance statistics
      if (this.config.enablePerformanceMonitoring && this.performanceMetrics.totalGenerations > 0) {
        console.debug(`📊 VMRecommendationService performance stats:`)
        console.debug(`   - Total generations: ${this.performanceMetrics.totalGenerations}`)
        console.debug(`   - Average time: ${Math.round(this.performanceMetrics.averageGenerationTime)}ms`)
        console.debug(`   - Cache hit rate: ${(this.performanceMetrics.cacheHitRate * 100).toFixed(1)}%`)
        console.debug(`   - Error count: ${this.performanceMetrics.errorCount}`)

        if (this.performanceMetrics.lastError) {
          console.debug(`   - Last error: ${this.performanceMetrics.lastError}`)
        }
      }

    } catch (error) {
      const standardizedError = new AppError(
        'VM recommendation service maintenance task failed',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        true,
        { operation: 'performMaintenance', service: 'VMRecommendationService' }
      )
      console.error('❌ Maintenance task failed:', {
        message: standardizedError.message,
        code: standardizedError.code,
        context: standardizedError.context,
        originalError: (error as Error).message
      })
    }
  }

  /**
   * Get service health status
   */
  public getServiceHealth(): {
    isHealthy: boolean
    cacheSize: number
    contextCacheSize: number
    performanceMetrics: PerformanceMetrics
    configuration: ServiceConfiguration
  } {
    const recentErrorThreshold = 10 // Consider unhealthy if more than 10 errors recently
    const slowResponseThreshold = 30000 // 30 seconds

    const isHealthy =
      this.performanceMetrics.errorCount < recentErrorThreshold &&
      this.performanceMetrics.averageGenerationTime < slowResponseThreshold

    return {
      isHealthy,
      cacheSize: this.cache.size,
      contextCacheSize: this.contextCache.size,
      performanceMetrics: { ...this.performanceMetrics },
      configuration: { ...this.config }
    }
  }

  /**
   * Clear all caches
   */
  public clearCaches(): void {
    this.cache.clear()
    this.contextCache.clear()
    console.log('🧹 All VMRecommendationService caches cleared')
  }

  /**
   * Reset performance metrics
   */
  public resetPerformanceMetrics(): void {
    this.performanceMetrics = this.initializePerformanceMetrics()
    console.log('📊 VMRecommendationService performance metrics reset')
  }

  /**
   * Dispose method for complete service lifecycle cleanup
   * This should be called when the service is being shut down
   */
  public dispose(): void {
    try {
      console.log('🔄 Disposing VMRecommendationService...')

      // Stop maintenance timer
      if (this.maintenanceTimer) {
        clearInterval(this.maintenanceTimer)
        this.maintenanceTimer = null
        console.log('✓ Maintenance timer stopped')
      }

      // Clear all caches
      this.clearCaches()
      console.log('✓ Caches cleared')

      // Clear checkers array
      this.checkers = []
      console.log('✓ Checkers cleared')

      // Reset performance metrics
      this.performanceMetrics = this.initializePerformanceMetrics()
      console.log('✓ Performance metrics reset')

      // Mark service as disposed
      this.isDisposed = true
      console.log('✓ Service marked as disposed')

      console.log('✅ VMRecommendationService disposed successfully')
    } catch (error) {
      const standardizedError = new AppError(
        'Failed to dispose VM recommendation service',
        ErrorCode.VM_RECOMMENDATION_ERROR,
        500,
        true,
        { operation: 'dispose', service: 'VMRecommendationService' }
      )
      console.error('❌ Service disposal failed:', {
        message: standardizedError.message,
        code: standardizedError.code,
        context: standardizedError.context,
        originalError: (error as Error).message
      })
      throw standardizedError
    }
  }

  /**
   * Check if the service has been disposed
   */
  public get disposed(): boolean {
    return this.isDisposed
  }

  /**
   * Cleanup method for graceful shutdown (legacy method, use dispose() instead)
   * @deprecated Use dispose() method instead for complete lifecycle management
   */
  public cleanup(): void {
    console.warn('⚠️ cleanup() method is deprecated, use dispose() instead')
    this.dispose()
  }
}
