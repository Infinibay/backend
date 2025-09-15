import { PrismaClient, Machine, VMHealthSnapshot, SystemMetrics, ProcessSnapshot, PortUsage, VMNWFilter, FWRule, VMRecommendation, RecommendationType, Prisma } from '@prisma/client'
import { RecommendationFilterInput } from '../graphql/types/RecommendationTypes'

export interface RecommendationData {
  [key: string]: string | number | boolean | null | undefined
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
                severity: 'warning'
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
              severity: app.avgCpuPercent > criticalCpuThreshold ? 'critical' : 'warning'
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
              severity: app.totalMemoryPercent > 30 ? 'critical' : 'warning'
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
        let severity = 'warning'
        let message = ''
        let actionText = ''

        if (ioWaitHigh && lowThroughputPercent > 80) {
          severity = 'critical'
          message = `VM experiencing severe disk I/O bottlenecks - average I/O wait time ${Math.round(avgIoWait)}% and low throughput ${Math.round(lowThroughputPercent)}% of the time`
          actionText = 'Consider upgrading to faster storage (SSD), increasing IOPS allocation, or optimizing applications to reduce I/O operations'
        } else if (ioWaitHigh) {
          severity = 'warning'
          message = `VM experiencing high disk I/O wait times (${Math.round(avgIoWait)}%) indicating storage bottlenecks`
          actionText = 'Consider upgrading storage performance or investigating high I/O applications'
        } else if (lowThroughputPercent > 60) {
          severity = 'warning'
          message = `VM showing low disk throughput (${Math.round(avgTotalRate)} MB/s average) in ${Math.round(lowThroughputPercent)}% of measurements`
          actionText = 'Monitor disk performance and consider storage optimization or upgrade if applications are affected'
        } else {
          severity = 'warning'
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

class PortBlockedChecker extends RecommendationChecker {
  getName (): string { return 'PortBlockedChecker' }
  getCategory (): string { return 'Security' }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    // TODO: Implement port blocked analysis using context.portUsage and context.firewallFilters
    return []
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    // TODO: Implement OS update analysis using context.latestSnapshot.windowsUpdateInfo
    return []
  }
}

class AppUpdateChecker extends RecommendationChecker {
  getName (): string { return 'AppUpdateChecker' }
  getCategory (): string { return 'Maintenance' }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    // TODO: Implement application update analysis using context.latestSnapshot.applicationInventory
    return []
  }
}

class DefenderDisabledChecker extends RecommendationChecker {
  getName (): string { return 'DefenderDisabledChecker' }
  getCategory (): string { return 'Security' }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    // TODO: Implement Windows Defender analysis using context.latestSnapshot.defenderStatus
    return []
  }
}

class DefenderThreatChecker extends RecommendationChecker {
  getName (): string { return 'DefenderThreatChecker' }
  getCategory (): string { return 'Security' }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async analyze (context: RecommendationContext): Promise<RecommendationResult[]> {
    // TODO: Implement threat analysis using context.latestSnapshot.defenderStatus
    return []
  }
}

export class VMRecommendationService {
  private checkers: RecommendationChecker[] = []

  constructor (private prisma: PrismaClient) {
    this.registerDefaultCheckers()
  }

  private registerDefaultCheckers (): void {
    // Core resource analysis checkers
    if (process.env.ENABLE_DISK_SPACE_CHECKER !== 'false') {
      this.registerChecker(new DiskSpaceChecker())
      console.debug('VM Recommendations: DiskSpaceChecker enabled')
    }

    if (process.env.ENABLE_RESOURCE_OPTIMIZATION_CHECKER !== 'false') {
      this.registerChecker(new ResourceOptimizationChecker()) // Combines CPU and RAM app analysis
      console.debug('VM Recommendations: ResourceOptimizationChecker enabled')
    }

    if (process.env.ENABLE_OVER_PROVISIONED_CHECKER !== 'false') {
      this.registerChecker(new OverProvisionedChecker())
      console.debug('VM Recommendations: OverProvisionedChecker enabled')
    }

    if (process.env.ENABLE_UNDER_PROVISIONED_CHECKER !== 'false') {
      this.registerChecker(new UnderProvisionedChecker())
      console.debug('VM Recommendations: UnderProvisionedChecker enabled')
    }

    if (process.env.ENABLE_DISK_IO_BOTTLENECK_CHECKER !== 'false') {
      this.registerChecker(new DiskIOBottleneckChecker())
      console.debug('VM Recommendations: DiskIOBottleneckChecker enabled')
    }

    // Security and maintenance checkers (placeholders for future implementation)
    if (process.env.ENABLE_PORT_BLOCKED_CHECKER !== 'false') {
      this.registerChecker(new PortBlockedChecker())
      console.debug('VM Recommendations: PortBlockedChecker enabled')
    }

    if (process.env.ENABLE_OS_UPDATE_CHECKER !== 'false') {
      this.registerChecker(new OsUpdateChecker())
      console.debug('VM Recommendations: OsUpdateChecker enabled')
    }

    if (process.env.ENABLE_APP_UPDATE_CHECKER !== 'false') {
      this.registerChecker(new AppUpdateChecker())
      console.debug('VM Recommendations: AppUpdateChecker enabled')
    }

    if (process.env.ENABLE_DEFENDER_DISABLED_CHECKER !== 'false') {
      this.registerChecker(new DefenderDisabledChecker())
      console.debug('VM Recommendations: DefenderDisabledChecker enabled')
    }

    if (process.env.ENABLE_DEFENDER_THREAT_CHECKER !== 'false') {
      this.registerChecker(new DefenderThreatChecker())
      console.debug('VM Recommendations: DefenderThreatChecker enabled')
    }

    console.log(`VM Recommendations: Registered ${this.checkers.length} recommendation checkers`)
  }

  registerChecker (checker: RecommendationChecker): void {
    this.checkers.push(checker)
  }

  async generateRecommendations (vmId: string, snapshotId?: string): Promise<VMRecommendation[]> {
    const context = await this.buildContext(vmId, snapshotId)
    const results: RecommendationResult[] = []

    for (const checker of this.checkers) {
      if (checker.isApplicable(context)) {
        try {
          const checkerResults = await checker.analyze(context)
          results.push(...checkerResults)
        } catch (error) {
          console.error(`Error running checker ${checker.getName()}:`, error)
        }
      }
    }

    return this.saveRecommendations(vmId, context.latestSnapshot?.id ?? null, results)
  }

  async getRecommendations (vmId: string, refresh?: boolean, filter?: RecommendationFilterInput): Promise<VMRecommendation[]> {
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

    // Determine limit with safety bounds
    const maxLimit = parseInt(process.env.RECOMMENDATION_MAX_LIMIT || '100')
    const defaultLimit = 50
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

    // Fetch firewall filters with rules
    const firewallFilters = await this.prisma.vMNWFilter.findMany({
      where: { vmId },
      include: {
        nwFilter: {
          include: { rules: true }
        }
      }
    })

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

    // Fetch machine configuration
    const machineConfig = await this.prisma.machine.findUnique({
      where: { id: vmId }
    })

    return {
      vmId,
      latestSnapshot,
      historicalMetrics,
      recentProcessSnapshots,
      portUsage,
      firewallFilters,
      machineConfig
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

      return createdRecommendations
    })
  }

  private areRecommendationsStale (lastCreated: Date): boolean {
    const dayAgo = new Date()
    dayAgo.setHours(dayAgo.getHours() - 24)
    return lastCreated < dayAgo
  }
}
