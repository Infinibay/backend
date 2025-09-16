import { RecommendationChecker, RecommendationContext, RecommendationResult, ProcessData } from './BaseRecommendationChecker'
import { VMHealthSnapshot } from '@prisma/client'

interface ApplicationInventoryData {
  processes?: ProcessData[]
  [key: string]: unknown
}

interface ResourceOptInfo {
  processes?: ProcessData[]
  [key: string]: unknown
}

export class ResourceOptimizationChecker extends RecommendationChecker {
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
    let appName = processName

    appName = appName.replace(/\.(exe|com|bat|cmd|scr)$/i, '')
    appName = appName.replace(/\s*v?\d+\.?\d*\.?\d*\.?\d*$/i, '')
    appName = appName.replace(/\s*\(?\d+\-bit\)?$/i, '')
    appName = appName.replace(/\s*x(86|64)$/i, '')

    if (appName.toLowerCase().match(/^(process|service|app|application|program|tool|utility)$/i)) {
      const executableName = executablePath.split(/[/\\]/).pop() || processName
      appName = executableName.replace(/\.(exe|com|bat|cmd|scr)$/i, '')
    }

    if (appName.toLowerCase().includes('chrome')) return 'Google Chrome'
    if (appName.toLowerCase().includes('firefox')) return 'Mozilla Firefox'
    if (appName.toLowerCase().includes('edge')) return 'Microsoft Edge'
    if (appName.toLowerCase().includes('safari')) return 'Safari'

    if (appName.toLowerCase().includes('word')) return 'Microsoft Word'
    if (appName.toLowerCase().includes('excel')) return 'Microsoft Excel'
    if (appName.toLowerCase().includes('powerpoint')) return 'Microsoft PowerPoint'
    if (appName.toLowerCase().includes('outlook')) return 'Microsoft Outlook'

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
      const processData = this.mergeProcessData(context)

      if (processData && Array.isArray(processData)) {
        const totalMemoryKB = context.machineConfig?.ramGB
          ? context.machineConfig.ramGB * 1024 * 1024
          : context.historicalMetrics[0]?.totalMemoryKB || 8000000
        const totalMemoryMB = (typeof totalMemoryKB === 'bigint' ? Number(totalMemoryKB) : totalMemoryKB) / 1024

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

          if (this.isSystemProcess(processName, executablePath)) {
            continue
          }

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

          group.totalCpuPercent += cpuPercent * sampleCount
          group.totalMemoryMB += memoryMB
          group.maxCpuPercent = Math.max(group.maxCpuPercent, cpuPercent)
          group.peakMemoryMB = Math.max(group.peakMemoryMB, memoryMB)
          group.processCount = group.processes.length

          if (executablePath && executablePath.length > group.exampleExecutablePath.length) {
            group.exampleExecutablePath = executablePath
          }
        }

        const appMetrics = Array.from(appGroups.values()).map(group => {
          const totalSamples = group.processes.reduce((sum, p) => sum + p.sampleCount, 0)
          const avgCpuPercent = totalSamples > 0 ? group.totalCpuPercent / totalSamples : 0
          const totalMemoryPercent = totalMemoryMB > 0 ? Math.round((group.totalMemoryMB / totalMemoryMB) * 100) : 0

          return {
            ...group,
            avgCpuPercent,
            totalMemoryPercent,
            topProcesses: group.processes
              .sort((a, b) => (b.cpuPercent + b.memoryMB) - (a.cpuPercent + a.memoryMB))
              .slice(0, 3)
          }
        })

        const topCpuApps = appMetrics
          .filter(app => app.avgCpuPercent > highCpuThreshold)
          .sort((a, b) => b.avgCpuPercent - a.avgCpuPercent)
          .slice(0, topAppsLimit)

        const topRamApps = appMetrics
          .filter(app => app.totalMemoryMB > highRamThresholdMB || app.totalMemoryPercent > highRamThresholdPercent)
          .sort((a, b) => b.totalMemoryMB - a.totalMemoryMB)
          .slice(0, topAppsLimit)

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

        for (const app of topRamApps) {
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
    if (context.recentProcessSnapshots.length > 0) {
      const processMap = new Map<string, ProcessData>()

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
          if (!existing) continue
          const existingCpu = typeof existing.cpuPercent === 'number' ? existing.cpuPercent : parseFloat(String(existing.cpuPercent || 0))
          const existingMem = typeof existing.memoryKB === 'number' ? existing.memoryKB : parseFloat(String(existing.memoryKB || 0))

          existing.cpuPercent = (existingCpu + ps.cpuUsagePercent) / 2
          existing.memoryKB = Math.max(existingMem, Number(ps.memoryUsageKB))
          existing.sampleCount = (existing.sampleCount || 1) + 1
          existing.maxCpu = Math.max(existing.maxCpu || 0, ps.cpuUsagePercent)
          existing.maxMemory = Math.max(existing.maxMemory || 0, Number(ps.memoryUsageKB))
        }
      }

      return Array.from(processMap.values())
    }

    return this.extractProcessData(context.latestSnapshot)
  }

  private extractProcessData (snapshot: VMHealthSnapshot | undefined | null): ProcessData[] | null {
    if (!snapshot) {
      return null
    }

    try {
      if (snapshot.applicationInventory) {
        const appData = typeof snapshot.applicationInventory === 'string'
          ? JSON.parse(snapshot.applicationInventory) as ApplicationInventoryData
          : snapshot.applicationInventory as ApplicationInventoryData

        if (appData.processes && Array.isArray(appData.processes)) {
          return appData.processes
        }
      }

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

    const systemProcessExcludes = process.env.SYSTEM_PROCESS_EXCLUDES?.toLowerCase().split(',').map(s => s.trim()) || []
    const systemProcessIncludes = process.env.SYSTEM_PROCESS_INCLUDE?.toLowerCase().split(',').map(s => s.trim()) || []

    if (systemProcessIncludes.some(include => lowerProcessName.includes(include))) {
      return false
    }

    if (systemProcessExcludes.some(exclude => lowerProcessName.includes(exclude))) {
      return true
    }

    const isSystemPath = lowerPath.includes('system32') ||
                        lowerPath.includes('syswow64') ||
                        lowerPath.includes('windows\\system') ||
                        lowerPath.includes('windows/system')

    if (isSystemPath) {
      return true
    }

    const coreSystemProcesses = [
      'system', 'idle', 'csrss.exe', 'lsass.exe', 'smss.exe',
      'wininit.exe', 'services.exe'
    ]

    return coreSystemProcesses.some(sp => lowerProcessName.includes(sp))
  }
}