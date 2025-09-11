import { Resolver, Query, Mutation, Arg, ID, Authorized, Ctx } from 'type-graphql'
import { getVirtioSocketWatcherService, VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { InfinibayContext } from '@utils/context'
import { parseInfiniServiceTimestamp, InfiniServiceTimestamp } from '@utils/dateHelpers'
import {
  HealthCheckStatus,
  HealthCheckResult,
  HealthCheckSeverity,
  HealthCheckName,
  DiskSpaceInfo,
  DiskDriveInfo,
  ResourceOptimizationInfo,
  ResourceRecommendation,
  WindowsUpdateInfo,
  WindowsUpdateItem,
  WindowsUpdateHistory,
  WindowsUpdateHistoryItem,
  WindowsDefenderStatus,
  ApplicationInventory,
  ApplicationInfo,
  ApplicationUpdates,
  ApplicationUpdateInfo,
  GenericHealthCheckResponse,
  DefenderScanResult,
  DiskCleanupResult
} from '../types/HealthCheckTypes'

// Constants for command timeouts
const LONG_RUNNING_COMMAND_TIMEOUT = 300000 // 5 minutes for WMI-heavy operations

// Interface for InfiniService health check responses
interface InfiniServiceHealthCheckData {
  status?: string;
  message?: string;
  details?: unknown;
  [key: string]: unknown;
}

interface InfiniServiceHealthCheckResponse {
  [checkName: string]: InfiniServiceHealthCheckData;
}

interface InfiniServiceDiskData {
  drive?: string;
  label?: string;
  total_gb?: number;
  used_gb?: number;
  free_gb?: number;
  used_percent?: number;
  status?: string;
}

interface InfiniServiceResourceData {
  resource?: string;
  current_value?: number;
  recommended_value?: number;
  unit?: string;
  reason?: string;
  potential_savings_percent?: number;
}

interface InfiniServiceUpdateData {
  title?: string;
  kb_article?: string;
  severity?: string;
  description?: string;
  size_mb?: number;
  install_date?: InfiniServiceTimestamp;
  status?: string;
  result_code?: string;
}

interface InfiniServiceDefenderData {
  real_time_protection?: boolean;
  antivirus_enabled?: boolean;
  antispyware_enabled?: boolean;
  signature_version?: string;
  signature_last_updated?: InfiniServiceTimestamp;
  last_quick_scan?: InfiniServiceTimestamp;
  last_full_scan?: InfiniServiceTimestamp;
  threats_detected?: number;
  threats_quarantined?: number;
}

interface InfiniServiceApplicationData {
  name?: string;
  version?: string;
  publisher?: string;
  install_date?: InfiniServiceTimestamp;
  install_location?: string;
  size_mb?: number;
}

interface InfiniServiceApplicationUpdateData {
  name?: string;
  version?: string;
  vendor?: string;
  install_type?: string;
  install_date?: InfiniServiceTimestamp;
  install_location?: string | null;
  registry_key?: string;
  size_mb?: number | null;
  can_update?: boolean;
  // New optimized format fields
  update_available?: string;
  update_source?: string;
  update_size_bytes?: number | null;
  is_security_update?: boolean;
  last_update_check?: InfiniServiceTimestamp;
  // Legacy fields for backwards compatibility
  application_name?: string;
  current_version?: string;
  available_version?: string;
  update_type?: string;
  release_date?: InfiniServiceTimestamp;
  download_url?: string;
}

@Resolver()
export class AutoCheckResolver {
  private getVirtioSocketService (): VirtioSocketWatcherService {
    return getVirtioSocketWatcherService()
  }

  @Query(() => HealthCheckStatus, {
    description: 'Get comprehensive health check status for a VM'
  })
  @Authorized('USER')
  async getVMHealthStatus (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckStatus> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'RunAllHealthChecks' },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      // Parse the result data and transform it to typed structure
      const data = result.data as InfiniServiceHealthCheckResponse
      const checks: HealthCheckResult[] = []
      let overallScore = 100

      // Process each check result
      if (data && typeof data === 'object') {
        Object.entries(data).forEach(([checkName, checkData]) => {
          const severity = checkData.status === 'passed'
            ? HealthCheckSeverity.PASSED
            : checkData.status === 'warning'
              ? HealthCheckSeverity.WARNING
              : checkData.status === 'failed'
                ? HealthCheckSeverity.FAILED
                : HealthCheckSeverity.INFO

          if (severity === HealthCheckSeverity.WARNING) overallScore -= 10
          if (severity === HealthCheckSeverity.FAILED) overallScore -= 25

          checks.push({
            checkName,
            severity,
            message: checkData.message || checkData.status || 'Check completed',
            details: JSON.stringify(checkData.details || checkData),
            timestamp: new Date()
          })
        })
      }

      return {
        success: true,
        vmId,
        overallScore: Math.max(0, overallScore),
        checks,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        overallScore: 0,
        checks: [],
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => GenericHealthCheckResponse, {
    description: 'Run a specific health check on a VM'
  })
  @Authorized('USER')
  async runHealthCheck (
    @Arg('vmId', () => ID) vmId: string,
    @Arg('checkName', () => HealthCheckName) checkName: HealthCheckName,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<GenericHealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'RunHealthCheck', params: { check_name: checkName } },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as InfiniServiceHealthCheckData
      const severity = data.status === 'passed'
        ? HealthCheckSeverity.PASSED
        : data.status === 'warning'
          ? HealthCheckSeverity.WARNING
          : data.status === 'failed'
            ? HealthCheckSeverity.FAILED
            : HealthCheckSeverity.INFO

      return {
        success: true,
        vmId,
        checkName,
        severity,
        message: data.message || data.status || 'Check completed',
        details: data.details ? JSON.stringify(data.details) : undefined,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        checkName,
        severity: HealthCheckSeverity.FAILED,
        message: 'Check failed',
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => DiskSpaceInfo, {
    description: 'Check disk space status for a VM'
  })
  @Authorized('USER')
  async checkVMDiskSpace (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('warningThreshold', () => Number, { nullable: true }) warningThreshold?: number,
    @Arg('criticalThreshold', () => Number, { nullable: true }) criticalThreshold?: number
  ): Promise<DiskSpaceInfo> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const params: Record<string, unknown> = {}
      if (warningThreshold !== undefined) {
        params.warning_threshold = warningThreshold
      }
      if (criticalThreshold !== undefined) {
        params.critical_threshold = criticalThreshold
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckDiskSpace', params }
      )

      const data = result.data as { drives?: InfiniServiceDiskData[] }
      const drives: DiskDriveInfo[] = []

      if (data.drives && Array.isArray(data.drives)) {
        data.drives.forEach(drive => {
          const usedPercent = drive.used_percent || 0
          const status = usedPercent >= (criticalThreshold || 90)
            ? HealthCheckSeverity.FAILED
            : usedPercent >= (warningThreshold || 80)
              ? HealthCheckSeverity.WARNING
              : HealthCheckSeverity.PASSED

          drives.push({
            drive: drive.drive || 'Unknown',
            label: drive.label || '',
            totalGB: drive.total_gb || 0,
            usedGB: drive.used_gb || 0,
            freeGB: drive.free_gb || 0,
            usedPercent,
            status
          })
        })
      }

      return {
        success: true,
        vmId,
        drives,
        warningThreshold,
        criticalThreshold,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        drives: [],
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => ResourceOptimizationInfo, {
    description: 'Check resource optimization opportunities for a VM'
  })
  @Authorized('USER')
  async checkResourceOptimization (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('evaluationWindowDays', () => Number, { nullable: true }) evaluationWindowDays?: number
  ): Promise<ResourceOptimizationInfo> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const params: Record<string, unknown> = {}
      if (evaluationWindowDays !== undefined) {
        params.evaluation_window_days = evaluationWindowDays
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckResourceOptimization', params }
      )

      const data = result.data as { recommendations?: InfiniServiceResourceData[], status?: string }
      const recommendations: ResourceRecommendation[] = []

      if (data.recommendations && Array.isArray(data.recommendations)) {
        data.recommendations.forEach(rec => {
          recommendations.push({
            resource: rec.resource || 'Unknown',
            currentValue: rec.current_value || 0,
            recommendedValue: rec.recommended_value || 0,
            unit: rec.unit || '',
            reason: rec.reason || '',
            potentialSavingsPercent: rec.potential_savings_percent
          })
        })
      }

      const overallStatus = data.status === 'optimal'
        ? HealthCheckSeverity.PASSED
        : data.status === 'suboptimal'
          ? HealthCheckSeverity.WARNING
          : HealthCheckSeverity.INFO

      return {
        success: true,
        vmId,
        recommendations,
        evaluationWindowDays,
        overallStatus,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        recommendations: [],
        overallStatus: HealthCheckSeverity.FAILED,
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => WindowsUpdateInfo, {
    description: 'Check Windows Updates status for a VM'
  })
  @Authorized('USER')
  async checkWindowsUpdates (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<WindowsUpdateInfo> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckWindowsUpdates' },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as {
        pending_updates?: InfiniServiceUpdateData[],
        pending_count?: number,
        critical_count?: number,
        security_count?: number,
        last_check?: InfiniServiceTimestamp,
        last_install?: InfiniServiceTimestamp
      }

      const pendingUpdates: WindowsUpdateItem[] = []
      if (data.pending_updates && Array.isArray(data.pending_updates)) {
        data.pending_updates.forEach(update => {
          pendingUpdates.push({
            title: update.title || 'Unknown Update',
            kbArticle: update.kb_article,
            severity: update.severity || 'Unknown',
            description: update.description,
            sizeInMB: update.size_mb || 0
          })
        })
      }

      return {
        success: true,
        vmId,
        pendingUpdatesCount: data.pending_count || 0,
        criticalUpdatesCount: data.critical_count || 0,
        securityUpdatesCount: data.security_count || 0,
        pendingUpdates,
        lastCheckTime: parseInfiniServiceTimestamp(data.last_check, 'checkWindowsUpdates.lastCheckTime'),
        lastInstallTime: parseInfiniServiceTimestamp(data.last_install, 'checkWindowsUpdates.lastInstallTime'),
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        pendingUpdatesCount: 0,
        criticalUpdatesCount: 0,
        securityUpdatesCount: 0,
        pendingUpdates: [],
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => WindowsUpdateHistory, {
    description: 'Get Windows Update history for a VM'
  })
  @Authorized('USER')
  async getWindowsUpdateHistory (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('days', () => Number, { nullable: true }) days?: number
  ): Promise<WindowsUpdateHistory> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const params: Record<string, unknown> = {}
      if (days !== undefined) {
        params.days = days
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'GetUpdateHistory', params },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as { updates?: InfiniServiceUpdateData[] }
      const updates: WindowsUpdateHistoryItem[] = []

      if (data.updates && Array.isArray(data.updates)) {
        data.updates.forEach(update => {
          updates.push({
            title: update.title || 'Unknown Update',
            kbArticle: update.kb_article,
            installDate: parseInfiniServiceTimestamp(update.install_date, 'getWindowsUpdateHistory.installDate') || new Date(),
            status: update.status || 'Unknown',
            resultCode: update.result_code,
            description: update.description
          })
        })
      }

      return {
        success: true,
        vmId,
        updates,
        totalCount: updates.length,
        daysIncluded: days,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        updates: [],
        totalCount: 0,
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => WindowsDefenderStatus, {
    description: 'Check Windows Defender status for a VM'
  })
  @Authorized('USER')
  async checkWindowsDefender (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<WindowsDefenderStatus> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckWindowsDefender' },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as InfiniServiceDefenderData

      const realTimeProtection = data.real_time_protection ?? false
      const antivirusEnabled = data.antivirus_enabled ?? false
      const antispywareEnabled = data.antispyware_enabled ?? false
      const threatsDetected = data.threats_detected || 0

      const overallStatus = !realTimeProtection || !antivirusEnabled
        ? HealthCheckSeverity.FAILED
        : threatsDetected > 0
          ? HealthCheckSeverity.WARNING
          : HealthCheckSeverity.PASSED

      return {
        success: true,
        vmId,
        realTimeProtectionEnabled: realTimeProtection,
        antivirusEnabled,
        antispywareEnabled,
        antivirusSignatureVersion: data.signature_version || 'Unknown',
        antivirusSignatureLastUpdated: parseInfiniServiceTimestamp(data.signature_last_updated, 'checkWindowsDefender.signatureLastUpdated') || new Date(),
        lastQuickScanTime: parseInfiniServiceTimestamp(data.last_quick_scan, 'checkWindowsDefender.lastQuickScan'),
        lastFullScanTime: parseInfiniServiceTimestamp(data.last_full_scan, 'checkWindowsDefender.lastFullScan'),
        threatsDetected,
        threatsQuarantined: data.threats_quarantined || 0,
        overallStatus,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        realTimeProtectionEnabled: false,
        antivirusEnabled: false,
        antispywareEnabled: false,
        antivirusSignatureVersion: 'Unknown',
        antivirusSignatureLastUpdated: new Date(),
        threatsDetected: 0,
        threatsQuarantined: 0,
        overallStatus: HealthCheckSeverity.FAILED,
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => ApplicationInventory, {
    description: 'Get installed applications inventory for a VM'
  })
  @Authorized('USER')
  async getVMApplicationInventory (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<ApplicationInventory> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'GetInstalledApplicationsWMI' },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as { applications?: InfiniServiceApplicationData[] }
      const applications: ApplicationInfo[] = []

      if (data.applications && Array.isArray(data.applications)) {
        data.applications.forEach(app => {
          applications.push({
            name: app.name || 'Unknown Application',
            version: app.version,
            publisher: app.publisher,
            installDate: parseInfiniServiceTimestamp(app.install_date, 'getVMApplicationInventory.installDate'),
            installLocation: app.install_location,
            sizeInMB: app.size_mb
          })
        })
      }

      return {
        success: true,
        vmId,
        applications,
        totalCount: applications.length,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        applications: [],
        totalCount: 0,
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Query(() => ApplicationUpdates, {
    description: 'Check for application updates on a VM'
  })
  @Authorized('USER')
  async checkApplicationUpdates (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<ApplicationUpdates> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckApplicationUpdates' },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as InfiniServiceApplicationUpdateData[] | {
        updates?: InfiniServiceApplicationUpdateData[];
        applications?: InfiniServiceApplicationUpdateData[];
      }
      const availableUpdates: ApplicationUpdateInfo[] = []

      // Handle multiple response formats:
      // 1. Direct array response (legacy)
      // 2. Wrapped response with 'updates' field (legacy)
      // 3. New optimized format with 'applications' field
      const updates = Array.isArray(data) ? data : (data.applications || data.updates)

      if (updates && Array.isArray(updates)) {
        updates.forEach(update => {
          availableUpdates.push({
            applicationName: update.name || update.application_name || 'Unknown Application',
            currentVersion: update.version || update.current_version || 'Unknown',
            availableVersion: update.available_version || update.update_available || 'Unknown',
            updateType: update.update_type || update.install_type || 'Unknown',
            releaseDate: parseInfiniServiceTimestamp(update.release_date, 'checkApplicationUpdates.releaseDate'),
            downloadUrl: update.download_url,
            sizeInMB: update.size_mb || undefined,
            // New fields with default values
            vendor: update.vendor || undefined,
            installType: update.install_type || undefined,
            installDate: parseInfiniServiceTimestamp(update.install_date, 'checkApplicationUpdates.installDate'),
            installLocation: update.install_location || undefined,
            registryKey: update.registry_key || undefined,
            canUpdate: update.can_update ?? false,
            updateSource: update.update_source || undefined,
            updateSizeBytes: update.update_size_bytes || undefined,
            isSecurityUpdate: update.is_security_update ?? false,
            lastUpdateCheck: parseInfiniServiceTimestamp(update.last_update_check, 'checkApplicationUpdates.lastUpdateCheck')
          })
        })
      }

      // Parse summary information from stdout
      let summary: string | undefined
      let windowsUpdatesCount: number | undefined
      let microsoftStoreUpdatesCount: number | undefined

      if (result.stdout) {
        summary = result.stdout

        // Extract counts from summary like: "Found 113 applications with available updates | Sources: Windows Update: 2, Microsoft Store: 111"
        const windowsMatch = result.stdout.match(/Windows Update:\s*(\d+)/)
        const storeMatch = result.stdout.match(/Microsoft Store:\s*(\d+)/)

        if (windowsMatch) windowsUpdatesCount = parseInt(windowsMatch[1], 10)
        if (storeMatch) microsoftStoreUpdatesCount = parseInt(storeMatch[1], 10)
      }

      return {
        success: true,
        vmId,
        availableUpdates,
        totalUpdatesCount: availableUpdates.length,
        timestamp: new Date(),
        // New optimized format fields
        summary,
        windowsUpdatesCount,
        microsoftStoreUpdatesCount,
        executionTimeMs: result.execution_time_ms
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        availableUpdates: [],
        totalUpdatesCount: 0,
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Mutation(() => DefenderScanResult, {
    description: 'Run Windows Defender quick scan on a VM'
  })
  @Authorized('USER')
  async runDefenderQuickScan (
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DefenderScanResult> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'RunDefenderQuickScan' },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as { threats_found?: number, files_scanned?: number, scan_duration?: number }

      return {
        success: true,
        vmId,
        scanType: 'Quick Scan',
        threatsFound: data.threats_found || 0,
        filesScanned: data.files_scanned || 0,
        scanDuration: data.scan_duration || 0,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        scanType: 'Quick Scan',
        threatsFound: 0,
        filesScanned: 0,
        scanDuration: 0,
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }

  @Mutation(() => DiskCleanupResult, {
    description: 'Perform disk cleanup on a VM'
  })
  @Authorized('USER')
  async performDiskCleanup (
    @Arg('vmId', () => ID) vmId: string,
    @Arg('drive', () => String) drive: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('targets', () => [String], { nullable: true }) targets?: string[]
  ): Promise<DiskCleanupResult> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const targetsToProcess = targets || ['temp_files', 'browser_cache', 'system_cache', 'recycle_bin']
      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        {
          action: 'DiskCleanup',
          params: {
            drive,
            targets: targetsToProcess
          }
        },
        LONG_RUNNING_COMMAND_TIMEOUT
      )

      const data = result.data as { space_cleared_mb?: number, files_deleted?: number }

      return {
        success: true,
        vmId,
        drive,
        spaceClearedMB: data.space_cleared_mb || 0,
        targetsProcessed: targetsToProcess,
        filesDeleted: data.files_deleted || 0,
        timestamp: new Date()
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        vmId,
        drive,
        spaceClearedMB: 0,
        targetsProcessed: targets || ['temp_files', 'browser_cache', 'system_cache', 'recycle_bin'],
        filesDeleted: 0,
        error: errorMessage,
        timestamp: new Date()
      }
    }
  }
}
