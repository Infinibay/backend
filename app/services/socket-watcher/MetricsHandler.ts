import logger from '@main/logger'
import { Logger } from 'winston'
/**
 * MetricsHandler — Handles metrics storage, auto-check analysis, and VM setup
 *
 * Extracted from VirtioSocketWatcherService. This module owns:
 * - Storing system metrics, processes, applications, ports, Windows services (storeMetrics)
 * - Updating VM IP addresses from network interfaces (updateVmIpAddresses)
 * - First InfiniService message handling / VM setup completion (handleFirstInfiniserviceMessage)
 * - Auto-check response analysis for issues and remediation (handleAutoCheckResponse + helpers)
 * - IP address utilities (isPrivateIP, isValidIPAddress, maskIP, etc.)
 *
 * Dependencies are injected via constructor.
 */

import { EventEmitter } from 'events'
import { isIP } from 'net'
import type {
  MetricsMessage,
  ResponseMessage,
  ResponseData,
  WindowsUpdatesData,
  WindowsUpdate,
  DefenderData,
  DiskSpaceData,
  ResourceOptimizationData,
  HealthCheckData,
  DefenderScanData,
} from './types'

// ────────────────────────────────────────────────────────────────────────────────
// Types for injected dependencies
// ────────────────────────────────────────────────────────────────────────────────

export interface MetricsHandlerDeps {
  debug: Logger
  /** Prisma client instance */
  prisma: any
  /** VmEventManager — may be undefined if not yet initialized */
  getVmEventManager: () => any | undefined
  /** EventEmitter for emitting metricsUpdated etc. */
  emitter: EventEmitter
}

// ────────────────────────────────────────────────────────────────────────────────
// MetricsHandler
// ────────────────────────────────────────────────────────────────────────────────

export class MetricsHandler {
  private readonly debug: Logger
  private readonly prisma: any
  private readonly getVmEventManager: () => any | undefined
  private readonly emitter: EventEmitter
  /** Last observed health status per VM; used to dedup health_status:change emissions (avoids toast spam, including a spurious toast for every VM after each backend restart) */
  private readonly lastHealthStatusByVm = new Map<string, string>()

  constructor(deps: MetricsHandlerDeps) {
    this.debug = deps.debug
    this.prisma = deps.prisma
    this.getVmEventManager = deps.getVmEventManager
    this.emitter = deps.emitter
  }

  // ──────────────────────────────────────────────────────────────────────────
  // First InfiniService message / VM setup completion
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Handles the first message from infiniservice. This signals the OS
   * finished installing and the agent handshaked, so we mark
   * MachineConfiguration.setupComplete=true and eject installation ISOs.
   *
   * Machine.status is owned by infinization (QMP events) — we don't touch it.
   */
  async handleFirstInfiniserviceMessage(vmId: string): Promise<void> {
    try {
      const machine = await this.prisma.machine.findUnique({
        where: { id: vmId },
        include: { configuration: true }
      })

      if (!machine || !machine.configuration) {
        return
      }

      // Idempotency: don't re-fire on subsequent infiniservice messages.
      if (machine.configuration.setupComplete) {
        return
      }

      this.debug.info(`First infiniservice message from VM ${vmId} - marking setupComplete`)

      // 1. Mark setup as complete (the orthogonal "OS is ready" flag).
      await this.prisma.machineConfiguration.update({
        where: { machineId: vmId },
        data: { setupComplete: true }
      })

      // 2. Eject all CD-ROMs (async, non-blocking)
      const { ejectAllCdroms } = await import('../InfinizationService')
      ejectAllCdroms(vmId).catch((err: Error) => {
        this.debug.warn(`Failed to eject CD-ROMs: ${err.message}`)
      })

      // 3. Emit event so the UI flips Installing → Running without a refetch.
      const vmEventManager = this.getVmEventManager()
      if (vmEventManager) {
        await vmEventManager.handleEvent('update', {
          id: vmId,
          setupComplete: true
        })
      }

      this.debug.info(`VM ${vmId} setupComplete=true`)

    } catch (error: any) {
      this.debug.error(`Error handling first infiniservice message: ${error.message}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Metrics storage
  // ──────────────────────────────────────────────────────────────────────────

  /** Store metrics in database */
  async storeMetrics(vmId: string, message: MetricsMessage): Promise<void> {
    try {
      const { data } = message

      // Log the incoming data structure for debugging
      this.debug.debug(`Metrics data structure for VM ${vmId}:`)
      this.debug.debug(`- system.cpu: ${JSON.stringify(data.system?.cpu)}`)
      this.debug.debug(`- system.memory: ${JSON.stringify(data.system?.memory)}`)
      this.debug.debug(`- system.disk: ${JSON.stringify(data.system?.disk)}`)
      this.debug.debug(`- system.network: ${JSON.stringify(data.system?.network)}`)
      this.debug.debug(`- system.uptime_seconds: ${data.system?.uptime_seconds}`)

      // Validate required fields exist
      if (!data.system) {
        this.debug.error(`Missing 'system' field in metrics data for VM ${vmId}`)
        return
      }

      if (!data.system.memory) {
        this.debug.error(`Missing 'system.memory' field in metrics data for VM ${vmId}`)
        return
      }

      // SECURITY (input-validation): the remaining sub-objects are dereferenced
      // unconditionally below. A malformed/malicious agent message that omits any
      // of them would throw a TypeError mid-write and silently drop metrics, so
      // guard their existence up-front like memory above.
      if (!data.system.cpu) {
        this.debug.error(`Missing 'system.cpu' field in metrics data for VM ${vmId}`)
        return
      }
      if (!data.system.disk) {
        this.debug.error(`Missing 'system.disk' field in metrics data for VM ${vmId}`)
        return
      }
      if (!data.system.network || !data.system.network.interfaces) {
        this.debug.error(`Missing 'system.network.interfaces' field in metrics data for VM ${vmId}`)
        return
      }

      // SECURITY (input-validation): the numbers below are attacker-controlled and
      // fed straight into Float/BigInt/DateTime columns. Sanitize so a malicious
      // value (NaN/Infinity/negative, BigInt('1.5') RangeError, non-integer, or an
      // Invalid Date) cannot throw mid-write (leaving partially-persisted rows) or
      // corrupt stored dashboards. Valid values pass through unchanged.
      const finitePercent = (n: number): number =>
        Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
      const finiteFloat = (n: number | undefined | null): number | null =>
        typeof n === 'number' && Number.isFinite(n) ? n : null
      const toBigIntSafe = (n: unknown): bigint => {
        const v = Math.trunc(Number(n))
        return Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER ? BigInt(v) : BigInt(0)
      }
      const toDateSafe = (v: unknown): Date | null => {
        if (v === undefined || v === null || v === '') return null
        const d = new Date(v as string | number | Date)
        return isNaN(d.getTime()) ? null : d
      }
      // Timestamp is used across all rows written here; reject an invalid one.
      const tsCandidate = new Date(message.timestamp)
      const ts = isNaN(tsCandidate.getTime()) ? new Date() : tsCandidate

      // SECURITY (dos-resource): the agent-supplied collections have no upper
      // bound and each drives per-element DB round-trips (sequential upserts for
      // applications/windows_services). Clamp them so one guest cannot saturate
      // the shared Postgres pool with a single message.
      const MAX_METRIC_ITEMS = 1000
      const clampMetricArray = <T>(arr: T[] | undefined, label: string): T[] | undefined => {
        if (Array.isArray(arr) && arr.length > MAX_METRIC_ITEMS) {
          this.debug.warn(`Truncating ${label} array for VM ${vmId} from ${arr.length} to ${MAX_METRIC_ITEMS} items`)
          return arr.slice(0, MAX_METRIC_ITEMS)
        }
        return arr
      }
      data.processes = clampMetricArray(data.processes, 'processes')
      data.applications = clampMetricArray(data.applications, 'applications')
      data.ports = clampMetricArray(data.ports, 'ports')
      data.windows_services = clampMetricArray(data.windows_services, 'windows_services')

      // Store system metrics
      // InfiniService now correctly sends memory values in KB as the field names indicate
      const systemMetrics = await this.prisma.systemMetrics.create({
        data: {
          machineId: vmId,
          cpuUsagePercent: finitePercent(data.system.cpu.usage_percent),
          cpuCoresUsage: data.system.cpu.cores_usage,
          cpuTemperature: finiteFloat(data.system.cpu.temperature),
          totalMemoryKB: toBigIntSafe(data.system.memory.total_kb),
          usedMemoryKB: toBigIntSafe(data.system.memory.used_kb),
          availableMemoryKB: toBigIntSafe(data.system.memory.available_kb),
          swapTotalKB: data.system.memory.swap_total_kb ? toBigIntSafe(data.system.memory.swap_total_kb) : null,
          swapUsedKB: data.system.memory.swap_used_kb ? toBigIntSafe(data.system.memory.swap_used_kb) : null,
          diskUsageStats: data.system.disk.usage_stats,
          diskIOStats: data.system.disk.io_stats,
          networkStats: data.system.network.interfaces,
          uptime: toBigIntSafe(data.system.uptime_seconds),
          loadAverage: data.system.load_average,
          timestamp: ts
        }
      })

      // Extract and update VM IP addresses from network interfaces
      await this.updateVmIpAddresses(vmId, data.system.network.interfaces)

      // Store process snapshots
      if (data.processes && data.processes.length > 0) {
        await this.prisma.processSnapshot.createMany({
          data: data.processes.map((proc: any) => ({
            machineId: vmId,
            processId: proc.pid,
            parentPid: proc.ppid,
            name: proc.name,
            executablePath: proc.exe_path,
            commandLine: proc.cmd_line,
            cpuUsagePercent: proc.cpu_percent,
            memoryUsageKB: toBigIntSafe(proc.memory_kb), // Now correctly in KB
            diskReadBytes: proc.disk_read_bytes ? toBigIntSafe(proc.disk_read_bytes) : null,
            diskWriteBytes: proc.disk_write_bytes ? toBigIntSafe(proc.disk_write_bytes) : null,
            status: proc.status,
            startTime: toDateSafe(proc.start_time),
            timestamp: ts
          }))
        })
      }

      // Store/update application usage
      if (data.applications && data.applications.length > 0) {
        for (const app of data.applications) {
          await this.prisma.applicationUsage.upsert({
            where: {
              machineId_executablePath: {
                machineId: vmId,
                executablePath: app.exe_path
              }
            },
            update: {
              applicationName: app.name,
              version: app.version,
              description: app.description,
              publisher: app.publisher,
              lastAccessTime: toDateSafe(app.last_access),
              lastModifiedTime: toDateSafe(app.last_modified),
              accessCount: app.access_count,
              totalUsageMinutes: app.usage_minutes,
              fileSize: app.file_size ? toBigIntSafe(app.file_size) : null,
              isActive: app.is_active,
              lastSeen: new Date()
            },
            create: {
              machineId: vmId,
              executablePath: app.exe_path,
              applicationName: app.name,
              version: app.version,
              description: app.description,
              publisher: app.publisher,
              lastAccessTime: toDateSafe(app.last_access),
              lastModifiedTime: toDateSafe(app.last_modified),
              accessCount: app.access_count,
              totalUsageMinutes: app.usage_minutes,
              fileSize: app.file_size ? toBigIntSafe(app.file_size) : null,
              isActive: app.is_active
            }
          })
        }
      }

      // Store port usage
      if (data.ports && data.ports.length > 0) {
        // Clear old port data first
        await this.prisma.portUsage.deleteMany({
          where: {
            machineId: vmId,
            timestamp: {
              lt: new Date(Date.now() - 5 * 60 * 1000) // Delete entries older than 5 minutes
            }
          }
        })

        // Insert new port data
        await this.prisma.portUsage.createMany({
          data: data.ports.map((port: any) => ({
            machineId: vmId,
            port: port.port,
            protocol: port.protocol,
            state: port.state,
            processId: port.pid,
            processName: port.process_name,
            executablePath: port.exe_path,
            isListening: port.is_listening,
            connectionCount: port.connection_count,
            timestamp: ts
          }))
        })
      }

      // Store Windows services
      if (data.windows_services && data.windows_services.length > 0) {
        for (const service of data.windows_services) {
          const existingService = await this.prisma.windowsService.findUnique({
            where: {
              machineId_serviceName: {
                machineId: vmId,
                serviceName: service.name
              }
            }
          })

          // Track state changes
          if (existingService && existingService.currentState !== service.state) {
            await this.prisma.serviceStateHistory.create({
              data: {
                serviceId: existingService.id,
                fromState: existingService.currentState,
                toState: service.state,
                reason: 'automatic',
                timestamp: ts
              }
            })
          }

          // Update or create service
          await this.prisma.windowsService.upsert({
            where: {
              machineId_serviceName: {
                machineId: vmId,
                serviceName: service.name
              }
            },
            update: {
              displayName: service.display_name,
              description: service.description,
              startType: service.start_type,
              serviceType: service.service_type,
              executablePath: service.exe_path,
              dependencies: service.dependencies,
              currentState: service.state,
              processId: service.pid,
              lastStateChange: existingService?.currentState !== service.state
                ? ts
                : existingService?.lastStateChange,
              stateChangeCount: existingService?.currentState !== service.state
                ? (existingService?.stateChangeCount || 0) + 1
                : existingService?.stateChangeCount,
              isDefaultService: service.is_default,
              lastSeen: new Date()
            },
            create: {
              machineId: vmId,
              serviceName: service.name,
              displayName: service.display_name,
              description: service.description,
              startType: service.start_type,
              serviceType: service.service_type,
              executablePath: service.exe_path,
              dependencies: service.dependencies,
              currentState: service.state,
              processId: service.pid,
              isDefaultService: service.is_default,
              lastStateChange: ts
            }
          })
        }
      }

      // Emit event for real-time update
      const formattedMetrics = {
        ...systemMetrics,
        cpuCoresUsage: systemMetrics.cpuCoresUsage as number[],
        totalMemoryKB: Number(systemMetrics.totalMemoryKB),
        usedMemoryKB: Number(systemMetrics.usedMemoryKB),
        availableMemoryKB: Number(systemMetrics.availableMemoryKB),
        swapTotalKB: systemMetrics.swapTotalKB ? Number(systemMetrics.swapTotalKB) : undefined,
        swapUsedKB: systemMetrics.swapUsedKB ? Number(systemMetrics.swapUsedKB) : undefined,
        uptime: Number(systemMetrics.uptime)
      }

      // Emit metrics update event that can be handled by other services
      this.emitter.emit('metricsUpdated', {
        vmId,
        metrics: formattedMetrics
      })

      this.debug.debug('metrics', `Stored metrics for VM ${vmId}`)
    } catch (error) {
      this.debug.error(`Failed to store metrics for VM ${vmId}: ${error}`)
      // Log more details about the specific error
      if (error instanceof Error) {
        this.debug.error(`Error details: ${error.stack}`)
      }
      // Log the problematic data that caused the error
      this.debug.error(`Problematic message data: ${JSON.stringify(message, null, 2)}`)
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Auto-check response analysis
  // ──────────────────────────────────────────────────────────────────────────

  /** Handle auto-check related command responses and emit appropriate events */
  async handleAutoCheckResponse(vmId: string, response: ResponseMessage, data: ResponseData | null): Promise<void> {
    try {
      const vmEventManager = this.getVmEventManager()
      if (!response.command_type || !vmEventManager) {
        return
      }

      const commandType = response.command_type

      // Check if this is an auto-check related command
      const autoCheckCommands = [
        'CheckWindowsUpdates', 'CheckWindowsDefender', 'CheckDiskSpace',
        'CheckResourceOptimization', 'RunHealthCheck', 'RunAllHealthChecks',
        'AutoFixWindowsUpdates', 'AutoFixDefender', 'AutoOptimizeDisk',
        'DiskCleanup', 'RunDefenderQuickScan'
      ]

      if (!autoCheckCommands.includes(commandType)) {
        return
      }

      this.debug.debug(`Processing auto-check response for VM ${vmId}: ${commandType}`)

      // If command failed, this might indicate an issue
      if (!response.success) {
        await vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: commandType,
          severity: 'warning',
          description: `Auto-check command ${commandType} failed`,
          details: {
            error: response.error || response.stderr,
            commandId: response.id,
            executionTime: response.execution_time_ms
          }
        })
        return
      }

      // For successful responses, analyze the data to detect issues or remediations
      await this.analyzeAutoCheckData(vmId, commandType, data, response)
    } catch (error) {
      this.debug.error(`Error handling auto-check response for VM ${vmId}: ${error}`)
    }
  }

  /** Analyze auto-check command data to determine if issues or remediations should be reported */
  private async analyzeAutoCheckData(
    vmId: string,
    commandType: string,
    data: ResponseData | null,
    response: ResponseMessage
  ): Promise<void> {
    try {
      const vmEventManager = this.getVmEventManager()
      if (!vmEventManager) {
        return
      }

      // Analyze different types of auto-check responses
      switch (commandType) {
        case 'CheckWindowsUpdates':
          await this.analyzeWindowsUpdatesResponse(vmId, data, response)
          break

        case 'CheckWindowsDefender':
          await this.analyzeDefenderResponse(vmId, data, response)
          break

        case 'CheckDiskSpace':
          await this.analyzeDiskSpaceResponse(vmId, data, response)
          break

        case 'CheckResourceOptimization':
          await this.analyzeResourceOptimizationResponse(vmId, data, response)
          break

        case 'RunAllHealthChecks':
        case 'RunHealthCheck':
          await this.analyzeHealthCheckResponse(vmId, data, response)
          break

        case 'AutoFixWindowsUpdates':
        case 'AutoFixDefender':
        case 'AutoOptimizeDisk':
        case 'DiskCleanup':
          await this.analyzeRemediationResponse(vmId, commandType, data, response)
          break

        case 'RunDefenderQuickScan':
          await this.analyzeDefenderScanResponse(vmId, data, response)
          break

        default:
          this.debug.debug(`No specific analysis for command type: ${commandType}`)
      }
    } catch (error) {
      this.debug.error(`Error analyzing auto-check data for VM ${vmId}: ${error}`)
    }
  }

  /** Analyze Windows Updates response for issues */
  private async analyzeWindowsUpdatesResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    const vmEventManager = this.getVmEventManager()
    if (!vmEventManager || !data) return

    try {
      // Type guard to check if data is WindowsUpdatesData
      const isWindowsUpdatesData = (data: ResponseData | null): data is WindowsUpdatesData => {
        return data !== null &&
          typeof data === 'object' &&
          'pending_updates' in data &&
          Array.isArray((data as WindowsUpdatesData).pending_updates)
      }

      if (!isWindowsUpdatesData(data)) {
        this.debug.debug('Data is not WindowsUpdatesData format')
        return
      }

      const updateData = data as WindowsUpdatesData

      if (updateData.pending_updates && updateData.pending_updates.length > 0) {
        // Critical updates pending
        const criticalUpdates = updateData.pending_updates.filter((update: WindowsUpdate) =>
          update.importance === 'Critical' || update.importance === 'Important'
        )

        if (criticalUpdates.length > 0) {
          await vmEventManager.handleAutoCheckIssueDetected(vmId, {
            checkType: 'WindowsUpdates',
            severity: 'critical',
            description: `${criticalUpdates.length} critical Windows updates are pending`,
            details: { criticalUpdates, totalUpdates: updateData.pending_updates.length }
          })

          // Offer automatic remediation
          await vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
            checkType: 'WindowsUpdates',
            remediationType: 'AutoFixWindowsUpdates',
            description: 'Automatically install pending Windows updates',
            isAutomatic: true,
            estimatedTime: '15-30 minutes',
            details: { updateCount: criticalUpdates.length }
          })
        }
      }
    } catch (error) {
      this.debug.error(`Error analyzing Windows updates response: ${error}`)
    }
  }

  /** Analyze Windows Defender response for issues */
  private async analyzeDefenderResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    const vmEventManager = this.getVmEventManager()
    if (!vmEventManager || !data) return

    try {
      // Type guard to check if data is DefenderData
      const isDefenderData = (data: ResponseData | null): data is DefenderData => {
        return data !== null &&
          typeof data === 'object' &&
          ('real_time_protection' in data || 'antivirus_enabled' in data || 'definitions_outdated' in data)
      }

      if (!isDefenderData(data)) {
        this.debug.debug('Data is not DefenderData format')
        return
      }

      const defenderData = data as DefenderData

      if (defenderData.real_time_protection === false || defenderData.antivirus_enabled === false) {
        await vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'WindowsDefender',
          severity: 'critical',
          description: 'Windows Defender real-time protection is disabled',
          details: defenderData
        })

        await vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
          checkType: 'WindowsDefender',
          remediationType: 'AutoFixDefender',
          description: 'Enable Windows Defender real-time protection',
          isAutomatic: true,
          estimatedTime: '1-2 minutes',
          details: {}
        })
      }

      if (defenderData.definitions_outdated === true) {
        await vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'WindowsDefender',
          severity: 'warning',
          description: 'Windows Defender definitions are outdated',
          details: { last_update: defenderData.last_definition_update }
        })
      }
    } catch (error) {
      this.debug.error(`Error analyzing Defender response: ${error}`)
    }
  }

  /** Analyze disk space response for issues */
  private async analyzeDiskSpaceResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    const vmEventManager = this.getVmEventManager()
    if (!vmEventManager || !data) return

    try {
      // Type guard to check if data is DiskSpaceData
      const isDiskSpaceData = (data: ResponseData | null): data is DiskSpaceData => {
        return data !== null &&
          typeof data === 'object' &&
          'drives' in data &&
          Array.isArray((data as DiskSpaceData).drives)
      }

      if (!isDiskSpaceData(data)) {
        this.debug.debug('Data is not DiskSpaceData format')
        return
      }

      const diskData = data as DiskSpaceData

      if (diskData.drives && Array.isArray(diskData.drives)) {
        for (const drive of diskData.drives) {
          // SECURITY (input-validation): total_gb/used_gb are agent-controlled.
          // total_gb=0 would yield Infinity ('Drive X is Infinity% full' — a false
          // critical alert) and NaN inputs would silently misreport. Skip drives
          // whose figures are not finite positives.
          if (!Number.isFinite(drive.total_gb) || drive.total_gb <= 0 || !Number.isFinite(drive.used_gb)) {
            this.debug.debug(`Skipping drive ${drive.drive_letter} with invalid capacity (total_gb=${drive.total_gb}, used_gb=${drive.used_gb})`)
            continue
          }

          const usagePercent = (drive.used_gb / drive.total_gb) * 100

          if (usagePercent > 90) {
            await vmEventManager.handleAutoCheckIssueDetected(vmId, {
              checkType: 'DiskSpace',
              severity: 'critical',
              description: `Drive ${drive.drive_letter} is ${usagePercent.toFixed(1)}% full`,
              details: drive
            })

            await vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
              checkType: 'DiskSpace',
              remediationType: 'DiskCleanup',
              description: `Clean up temporary files on drive ${drive.drive_letter}`,
              isAutomatic: true,
              estimatedTime: '5-10 minutes',
              details: { drive: drive.drive_letter }
            })
          } else if (usagePercent > 80) {
            await vmEventManager.handleAutoCheckIssueDetected(vmId, {
              checkType: 'DiskSpace',
              severity: 'warning',
              description: `Drive ${drive.drive_letter} is ${usagePercent.toFixed(1)}% full`,
              details: drive
            })
          }
        }
      }
    } catch (error) {
      this.debug.error(`Error analyzing disk space response: ${error}`)
    }
  }

  /** Analyze resource optimization response */
  private async analyzeResourceOptimizationResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    const vmEventManager = this.getVmEventManager()
    if (!vmEventManager || !data) return

    try {
      // Type guard to check if data is ResourceOptimizationData
      const isResourceOptimizationData = (data: ResponseData | null): data is ResourceOptimizationData => {
        return data !== null &&
          typeof data === 'object' &&
          ('cpu_optimization_available' in data || 'memory_optimization_available' in data || 'disk_optimization_available' in data)
      }

      if (!isResourceOptimizationData(data)) {
        this.debug.debug('Data is not ResourceOptimizationData format')
        return
      }

      const optimizationData = data as ResourceOptimizationData

      if (optimizationData.cpu_optimization_available || optimizationData.memory_optimization_available) {
        await vmEventManager.handleAutoCheckRemediationAvailable(vmId, {
          checkType: 'ResourceOptimization',
          remediationType: 'AutoOptimizeDisk',
          description: 'System resources can be optimized for better performance',
          isAutomatic: false,
          estimatedTime: '10-15 minutes',
          details: optimizationData
        })
      }
    } catch (error) {
      this.debug.error(`Error analyzing resource optimization response: ${error}`)
    }
  }

  /** Analyze general health check response */
  private async analyzeHealthCheckResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    const vmEventManager = this.getVmEventManager()
    if (!vmEventManager || !data) return

    try {
      // Type guard to check if data is HealthCheckData
      const isHealthCheckData = (data: ResponseData | null): data is HealthCheckData => {
        return data !== null &&
          typeof data === 'object' &&
          ('overall_health' in data || 'checks' in data)
      }

      if (!isHealthCheckData(data)) {
        this.debug.debug('Data is not HealthCheckData format')
        return
      }

      const healthData = data as HealthCheckData

      if (healthData.overall_health === 'Critical' || healthData.overall_health === 'Warning') {
        await vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'HealthCheck',
          severity: healthData.overall_health === 'Critical' ? 'critical' : 'warning',
          description: `System health check detected ${healthData.overall_health.toLowerCase()} issues`,
          details: healthData
        })
      }

      // Emit the agent's TRUE health verdict to the frontend (resource 'health_status', action 'change').
      // Only the three known verdicts are emitted; anything else/undefined is ignored.
      if (
        healthData.overall_health === 'Healthy' ||
        healthData.overall_health === 'Warning' ||
        healthData.overall_health === 'Critical'
      ) {
        const status = healthData.overall_health.toLowerCase()
        const previousStatus = this.lastHealthStatusByVm.get(vmId)

        // First observation establishes a silent baseline (no toast on backend restart);
        // only real transitions are emitted afterwards.
        if (previousStatus === undefined) {
          this.lastHealthStatusByVm.set(vmId, status)
        } else if (previousStatus !== status) {
          this.lastHealthStatusByVm.set(vmId, status)
          // Error isolation: handleHealthStatusChange is async and rethrows on failure;
          // attach a .catch so an async emit failure never escapes as an unhandled rejection.
          this.getVmEventManager()?.handleHealthStatusChange(vmId, status, healthData.checks)?.catch((emitError: unknown) => this.debug.error(`Error emitting health_status change for VM ${vmId}: ${emitError}`))
        }
      }
    } catch (error) {
      this.debug.error(`Error analyzing health check response: ${error}`)
    }
  }

  /** Analyze remediation command responses */
  private async analyzeRemediationResponse(vmId: string, commandType: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    const vmEventManager = this.getVmEventManager()
    if (!vmEventManager) return

    try {
      const success = response.success && (!response.exit_code || response.exit_code === 0)

      await vmEventManager.handleAutoCheckRemediationCompleted(vmId, {
        checkType: this.getCheckTypeFromRemediationCommand(commandType),
        remediationType: commandType,
        success,
        description: success
          ? `${commandType} completed successfully`
          : `${commandType} failed to complete`,
        executionTime: response.execution_time_ms ? `${response.execution_time_ms}ms` : undefined,
        details: data,
        error: success ? undefined : (response.error || response.stderr || 'Unknown error')
      })
    } catch (error) {
      this.debug.error(`Error analyzing remediation response: ${error}`)
    }
  }

  /** Analyze Defender scan response */
  private async analyzeDefenderScanResponse(vmId: string, data: ResponseData | null, response: ResponseMessage): Promise<void> {
    const vmEventManager = this.getVmEventManager()
    if (!vmEventManager || !data) return

    try {
      // Type guard to check if data is DefenderScanData
      const isDefenderScanData = (data: ResponseData | null): data is DefenderScanData => {
        return data !== null &&
          typeof data === 'object' &&
          ('threats_found' in data || 'scan_duration' in data || 'threats' in data)
      }

      if (!isDefenderScanData(data)) {
        this.debug.debug('Data is not DefenderScanData format')
        return
      }

      const scanData = data as DefenderScanData

      if (scanData.threats_found && scanData.threats_found > 0) {
        await vmEventManager.handleAutoCheckIssueDetected(vmId, {
          checkType: 'DefenderScan',
          severity: 'critical',
          description: `Windows Defender scan found ${scanData.threats_found} threats`,
          details: scanData
        })
      }
    } catch (error) {
      this.debug.error(`Error analyzing Defender scan response: ${error}`)
    }
  }

  /** Helper method to map remediation commands to their check types */
  private getCheckTypeFromRemediationCommand(commandType: string): string {
    const mapping: Record<string, string> = {
      AutoFixWindowsUpdates: 'WindowsUpdates',
      AutoFixDefender: 'WindowsDefender',
      AutoOptimizeDisk: 'ResourceOptimization',
      DiskCleanup: 'DiskSpace'
    }
    return mapping[commandType] || commandType
  }

  // ──────────────────────────────────────────────────────────────────────────
  // IP address utilities
  // ──────────────────────────────────────────────────────────────────────────

  /** Update VM IP addresses from network interfaces */
  async updateVmIpAddresses(vmId: string, interfaces: Array<{
    name: string
    bytes_received: number
    bytes_sent: number
    packets_received: number
    packets_sent: number
    ip_addresses?: string[]
    is_up?: boolean
  }>): Promise<void> {
    try {
      const totalInterfaces = interfaces.length
      const interfacesWithIPs = interfaces.filter(iface =>
        (iface.ip_addresses?.length || 0) > 0
      ).length
      const upInterfaces = interfaces.filter(iface =>
        (iface.is_up ?? true) // Treat undefined as true for backward compatibility
      ).length
      const upInterfacesWithIPs = interfaces.filter(iface =>
        (iface.is_up ?? true) && (iface.ip_addresses?.length || 0) > 0
      ).length

      this.debug.info(`Processing IP addresses for VM ${vmId}: ${totalInterfaces} total interfaces, ${interfacesWithIPs} with IPs, ${upInterfaces} UP, ${upInterfacesWithIPs} UP with IPs`)

      // Log individual interface details for diagnostics
      interfaces.forEach(iface => {
        const ipCount = iface.ip_addresses?.length || 0
        const isUp = iface.is_up ?? true
        this.debug.debug(`Interface ${iface.name}: is_up=${isUp}, ip_count=${ipCount}, ips=[${iface.ip_addresses?.join(', ') || 'none'}]`)
      })

      if (upInterfacesWithIPs === 0 && totalInterfaces > 0) {
        this.debug.warn(`No UP interfaces with IP addresses detected for VM ${vmId} (${totalInterfaces} total interfaces)`)
      }

      let localIP: string | null = null
      let publicIP: string | null = null
      let selectedInterface: string | null = null
      const allDetectedIPs: string[] = []

      // Enhanced IP extraction with prioritization
      for (const iface of interfaces) {
        // Handle undefined ip_addresses gracefully
        const ipAddresses = iface.ip_addresses || []
        const isUp = iface.is_up ?? true // Treat undefined as true for backward compatibility

        if (ipAddresses.length === 0 || !isUp) {
          continue
        }

        for (const ip of ipAddresses) {
          // Validate IP address format
          if (!this.isValidIPAddress(ip)) {
            this.debug.debug(`Skipping invalid IP address format: ${this.maskIP(ip)}`)
            continue
          }

          allDetectedIPs.push(ip)

          // Skip loopback and other special addresses
          if (this.isLoopbackAddress(ip)) {
            this.debug.debug(`Skipping loopback address: ${ip}`)
            continue
          }

          // Check if it's a private IP (local)
          if (this.isPrivateIP(ip)) {
            if (!localIP || this.shouldPreferIP(ip, localIP)) {
              localIP = ip
              selectedInterface = iface.name
              this.debug.debug(`Selected local IP ${this.maskIP(ip)} from interface ${iface.name}`)
            }
          } else {
            // Public IP
            if (!publicIP || this.shouldPreferIP(ip, publicIP)) {
              publicIP = ip
              selectedInterface = iface.name
              this.debug.debug(`Selected public IP ${this.maskIP(ip)} from interface ${iface.name}`)
            }
          }
        }
      }

      // Check if IPs have actually changed before updating
      const currentMachine = await this.prisma.machine.findUnique({
        where: { id: vmId },
        select: { localIP: true, publicIP: true }
      })

      if (!currentMachine) {
        this.debug.error(`VM ${vmId} not found in database during IP update`)
        return
      }

      const ipChanged = currentMachine.localIP !== localIP || currentMachine.publicIP !== publicIP

      if (!ipChanged) {
        this.debug.debug(`No IP changes detected for VM ${vmId}, skipping database update`)
        return
      }

      // Update the machine record with the detected IPs
      await this.prisma.machine.update({
        where: { id: vmId },
        data: {
          localIP,
          publicIP
        }
      }).catch((error: any) => {
        // Handle database constraint errors gracefully
        if (error.code === 'P2025') {
          this.debug.warn(`VM ${vmId} no longer exists in database during IP update`)
        } else {
          throw error
        }
      })

      this.debug.info(`Updated IP addresses for VM ${vmId}: local=${this.maskIP(localIP)} (was ${this.maskIP(currentMachine.localIP)}), public=${this.maskIP(publicIP)} (was ${this.maskIP(currentMachine.publicIP)}), selected_interface=${selectedInterface}`)
      this.debug.info(`All detected IPs for VM ${vmId}: [${allDetectedIPs.map(ip => this.maskIP(ip)).join(', ')}]`)

      // Emit event for real-time updates only when IPs actually change
      const vmEventManager = this.getVmEventManager()
      if (vmEventManager) {
        // Determine if this is first IP detection or change
        const isFirstDetection = !currentMachine.localIP && !currentMachine.publicIP
        const eventType = isFirstDetection ? 'ip_first_detection' : 'ip_change'

        await vmEventManager.handleEvent('update', {
          id: vmId,
          oldLocalIP: currentMachine.localIP,
          oldPublicIP: currentMachine.publicIP,
          newLocalIP: localIP,
          newPublicIP: publicIP,
          selectedInterface,
          allDetectedIPs
        }, eventType)
      }
    } catch (error) {
      this.debug.error(`Failed to update IP addresses for VM ${vmId}: ${error}`)

      // Add context about which interface caused the error
      if (error instanceof Error) {
        this.debug.error(`Error details: ${error.stack}`)
      }

      // Log the interface data for debugging
      this.debug.error(`Interface data that caused error: ${JSON.stringify(interfaces, null, 2)}`)
    }
  }

  private isPrivateIP(ip: string): boolean {
    // IPv4 private ranges:
    // 10.0.0.0/8 (10.0.0.0 - 10.255.255.255)
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    // 192.168.0.0/16 (192.168.0.0 - 192.168.255.255)
    // 169.254.0.0/16 (169.254.0.0 - 169.254.255.255) - Link-local

    if (ip.includes(':')) {
      // Enhanced IPv6 classification
      return this.isIPv6Private(ip)
    }

    const parts = ip.split('.').map(Number)
    if (parts.length !== 4) return false

    // 10.0.0.0/8
    if (parts[0] === 10) return true

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true

    // 169.254.0.0/16 (Link-local)
    if (parts[0] === 169 && parts[1] === 254) return true

    return false
  }

  private isValidIPAddress(ip: string): boolean {
    // SECURITY (input-validation): use Node's strict parser. The old hand-rolled
    // IPv4 check used parseInt(), which accepts trailing garbage
    // (parseInt('12abc',10) === 12), so '12abc.0.0.1' passed as valid; the IPv6
    // path never validated the zone id after '%'. isIP() rejects both. We validate
    // only the address part and separately allow a link-local IPv6 zone suffix, so
    // an attacker-chosen string can no longer pollute machine.localIP/publicIP.
    if (typeof ip !== 'string' || ip.length === 0) return false

    const zoneIndex = ip.indexOf('%')
    if (zoneIndex === -1) {
      return isIP(ip) !== 0
    }

    // Zone id only makes sense for IPv6; require a valid IPv6 address part and a
    // non-empty, restricted zone id (interface name).
    const addr = ip.slice(0, zoneIndex)
    const zone = ip.slice(zoneIndex + 1)
    return isIP(addr) === 6 && /^[A-Za-z0-9._-]+$/.test(zone)
  }

  private shouldPreferIP(newIP: string, currentIP: string): boolean {
    // Enhanced IP preference logic supporting IPv6

    // Get IP types for both addresses
    const newType = this.getIPAddressType(newIP)
    const currentType = this.getIPAddressType(currentIP)

    // Define preference order (higher number = more preferred)
    const preferenceOrder: Record<string, number> = {
      'ipv4-link-local': 1, // 169.254.x.x
      'ipv6-link-local': 2, // fe80::/10
      'ipv4-private': 3, // 10.x.x.x, 192.168.x.x, 172.16-31.x.x
      'ipv6-ula': 4, // fc00::/7 (Unique Local Address)
      'ipv4-public': 5, // Public IPv4
      'ipv6-global': 6 // Global unicast IPv6
    }

    const newPreference = preferenceOrder[newType] || 0
    const currentPreference = preferenceOrder[currentType] || 0

    // Prefer higher preference values
    return newPreference > currentPreference
  }

  private maskIP(ip: string | null | undefined): string {
    if (!ip) return 'null'

    // Keep first and last octets, mask middle ones for IPv4
    if (ip.includes('.')) {
      const parts = ip.split('.')
      if (parts.length === 4) {
        return `${parts[0]}.xxx.xxx.${parts[3]}`
      }
    }

    // For IPv6, show only prefix and suffix
    if (ip.includes(':')) {
      const parts = ip.split(':')
      if (parts.length > 2) {
        return `${parts[0]}:xxxx:xxxx:${parts[parts.length - 1]}`
      }
    }

    // For other formats, show only first 3 and last 3 chars
    if (ip.length > 6) {
      return `${ip.substring(0, 3)}...${ip.substring(ip.length - 3)}`
    }

    return 'xxx'
  }

  private isIPv6Private(ip: string): boolean {
    // Remove any zone identifier (e.g., %eth0)
    const cleanIP = ip.split('%')[0]

    // Link-local addresses: fe80::/10
    if (cleanIP.toLowerCase().startsWith('fe8') || cleanIP.toLowerCase().startsWith('fe9') ||
      cleanIP.toLowerCase().startsWith('fea') || cleanIP.toLowerCase().startsWith('feb')) {
      return true
    }

    // Unique Local Addresses (ULA): fc00::/7 (fc00:: to fdff::)
    if (cleanIP.toLowerCase().startsWith('fc') || cleanIP.toLowerCase().startsWith('fd')) {
      return true
    }

    // Site-local addresses (deprecated but still used): fec0::/10
    if (cleanIP.toLowerCase().startsWith('fec') || cleanIP.toLowerCase().startsWith('fed') ||
      cleanIP.toLowerCase().startsWith('fee') || cleanIP.toLowerCase().startsWith('fef')) {
      return true
    }

    // Global unicast addresses (2000::/3) are considered public
    // All other IPv6 addresses are considered private by default
    return !cleanIP.toLowerCase().startsWith('2')
  }

  private isValidIPv6(ip: string): boolean {
    // Remove any zone identifier (e.g., %eth0)
    const cleanIP = ip.split('%')[0]

    // Basic IPv6 format validation
    // Must contain at least one colon
    if (!cleanIP.includes(':')) return false

    // Can't start or end with more than two colons
    if (cleanIP.startsWith(':::') || cleanIP.endsWith(':::')) return false

    // Can't have more than one double colon sequence
    const doubleColonCount = (cleanIP.match(/::/g) || []).length
    if (doubleColonCount > 1) return false

    // Split by double colon to handle compressed zeros
    const parts = cleanIP.split('::')
    if (parts.length > 2) return false

    // Validate each part
    for (const part of parts) {
      if (part === '') continue // Empty part is OK for compressed notation

      const groups = part.split(':')
      for (const group of groups) {
        if (group === '') continue // Empty group is OK

        // Each group should be 1-4 hex digits
        if (group.length > 4) return false
        if (!/^[0-9a-fA-F]+$/.test(group)) return false
      }

      // Check total number of groups doesn't exceed 8
      if (groups.length > 8) return false
    }

    return true
  }

  private isLoopbackAddress(ip: string): boolean {
    // IPv4 loopback: 127.x.x.x
    if (ip.startsWith('127.')) return true

    // IPv6 loopback: ::1
    if (ip === '::1' || ip.toLowerCase() === '0:0:0:0:0:0:0:1') return true

    return false
  }

  private getIPAddressType(ip: string): string {
    if (ip.includes(':')) {
      // IPv6 address
      const cleanIP = ip.split('%')[0].toLowerCase()

      // Link-local: fe80::/10
      if (cleanIP.startsWith('fe8') || cleanIP.startsWith('fe9') ||
        cleanIP.startsWith('fea') || cleanIP.startsWith('feb')) {
        return 'ipv6-link-local'
      }

      // ULA: fc00::/7
      if (cleanIP.startsWith('fc') || cleanIP.startsWith('fd')) {
        return 'ipv6-ula'
      }

      // Global unicast: 2000::/3
      if (cleanIP.startsWith('2')) {
        return 'ipv6-global'
      }

      // Other IPv6 (site-local, etc.) - treat as ULA
      return 'ipv6-ula'
    } else {
      // IPv4 address
      if (ip.startsWith('169.254.')) {
        return 'ipv4-link-local'
      }

      if (this.isPrivateIP(ip)) {
        return 'ipv4-private'
      }

      return 'ipv4-public'
    }
  }
}
