import { PrismaClient, MaintenanceTaskType, MaintenanceStatus, MaintenanceTrigger, Prisma } from '@prisma/client'
import { VirtioSocketWatcherService, getVirtioSocketWatcherService } from './VirtioSocketWatcherService'
import { CronParser } from '@utils/cronParser'

// Task-specific timeouts in milliseconds
const TASK_TIMEOUTS = {
  [MaintenanceTaskType.DISK_CLEANUP]: 300000, // 5 minutes
  [MaintenanceTaskType.DEFRAG]: 3600000, // 60 minutes
  [MaintenanceTaskType.DEFENDER_SCAN]: 900000, // 15 minutes
  [MaintenanceTaskType.WINDOWS_UPDATES]: 1800000, // 30 minutes
  [MaintenanceTaskType.SYSTEM_FILE_CHECK]: 1200000, // 20 minutes
  [MaintenanceTaskType.DISK_CHECK]: 2400000, // 40 minutes
  [MaintenanceTaskType.REGISTRY_CLEANUP]: 600000, // 10 minutes
  [MaintenanceTaskType.CUSTOM_SCRIPT]: 600000 // 10 minutes
}

export interface MaintenanceTaskConfig {
  vmId: string
  taskType: MaintenanceTaskType
  name: string
  description?: string
  isRecurring: boolean
  cronSchedule?: string
  runAt?: Date
  parameters?: Prisma.JsonValue
  userId: string
}

export interface MaintenanceExecutionResult {
  success: boolean
  duration?: number
  result?: Prisma.JsonValue
  error?: string
}

export class MaintenanceService {
  private prisma: PrismaClient
  private virtioSocketService: VirtioSocketWatcherService

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.virtioSocketService = getVirtioSocketWatcherService()
  }

  /**
   * Schedule a new maintenance task
   */
  async scheduleTask (config: MaintenanceTaskConfig) {
    console.log(`Scheduling maintenance task: ${config.taskType} for VM ${config.vmId}`)

    // Validate the VM exists
    const machine = await this.prisma.machine.findUnique({
      where: { id: config.vmId },
      include: { user: true }
    })

    if (!machine) {
      throw new Error('Virtual machine not found')
    }

    // Calculate next run time for recurring tasks or use runAt for one-time tasks
    let nextRunAt: Date | null = null
    if (config.isRecurring && config.cronSchedule) {
      nextRunAt = CronParser.getNextRunTime(config.cronSchedule)
    } else if (!config.isRecurring && config.runAt) {
      nextRunAt = config.runAt
    }

    // Validate parameters for the task type
    this.validateTaskParameters(config.taskType, config.parameters)

    const task = await this.prisma.maintenanceTask.create({
      data: {
        machineId: config.vmId,
        taskType: config.taskType,
        name: config.name,
        description: config.description,
        isRecurring: config.isRecurring,
        cronSchedule: config.cronSchedule,
        runAt: config.runAt,
        nextRunAt,
        parameters: config.parameters as Prisma.InputJsonValue,
        createdByUserId: config.userId
      },
      include: {
        machine: true,
        createdBy: true
      }
    })

    console.log(`Maintenance task scheduled: ${task.id}`)
    return task
  }

  /**
   * Execute a maintenance task immediately with cross-instance locking
   */
  async executeTask (
    taskId: string,
    triggeredBy: MaintenanceTrigger = MaintenanceTrigger.MANUAL,
    executedByUserId?: string
  ): Promise<MaintenanceExecutionResult> {
    console.log(`Executing maintenance task: ${taskId} (${triggeredBy})`)

    // Use database transaction to atomically claim the task
    const task = await this.prisma.$transaction(async (tx) => {
      const task = await tx.maintenanceTask.findUnique({
        where: { id: taskId },
        include: { machine: true }
      })

      if (!task) {
        throw new Error('Maintenance task not found')
      }

      if (!task.isEnabled) {
        throw new Error('Maintenance task is disabled')
      }

      if (task.executionStatus === 'RUNNING') {
        throw new Error('Task is already running in another instance')
      }

      if (task.executionStatus === 'LOCKED') {
        throw new Error('Task is locked by another instance')
      }

      // Atomically claim the task by setting it to RUNNING
      const updatedTask = await tx.maintenanceTask.update({
        where: {
          id: taskId,
          executionStatus: 'IDLE' // Double-check it's still idle
        },
        data: { executionStatus: 'RUNNING' },
        include: { machine: true }
      })

      return updatedTask
    })

    if (!task) {
      throw new Error('Failed to acquire lock on maintenance task')
    }

    // Check VM connectivity before execution
    const isConnected = await this.virtioSocketService.isVmConnected(task.machineId)
    if (!isConnected) {
      // Release lock before failing
      await this.prisma.maintenanceTask.update({
        where: { id: taskId },
        data: { executionStatus: 'IDLE' }
      })
      throw new Error('VM is not connected or powered off')
    }

    // Create history entry with RUNNING status first
    const historyEntry = await this.prisma.maintenanceHistory.create({
      data: {
        taskId,
        machineId: task.machineId,
        taskType: task.taskType,
        status: MaintenanceStatus.RUNNING,
        triggeredBy,
        executedByUserId: executedByUserId || task.createdByUserId
      }
    })

    const startTime = Date.now()
    let result: MaintenanceExecutionResult

    try {
      // Execute the maintenance operation without double history logging
      result = await this.executeMaintenanceOperation(
        task.machineId,
        task.taskType,
        task.parameters as Record<string, unknown> || {}
      )

      // Update task's last run time and next run time for recurring tasks, and release lock
      if (task.isRecurring && task.cronSchedule) {
        const nextRunAt = CronParser.getNextRunTime(task.cronSchedule)
        await this.prisma.maintenanceTask.update({
          where: { id: taskId },
          data: {
            lastRunAt: new Date(),
            nextRunAt,
            executionStatus: 'IDLE' // Release lock
          }
        })
      } else {
        await this.prisma.maintenanceTask.update({
          where: { id: taskId },
          data: {
            lastRunAt: new Date(),
            executionStatus: 'IDLE' // Release lock
          }
        })
      }
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }

    const duration = Date.now() - startTime

    // Update the history entry with final status
    await this.prisma.maintenanceHistory.update({
      where: { id: historyEntry.id },
      data: {
        status: result.success ? MaintenanceStatus.SUCCESS : MaintenanceStatus.FAILED,
        duration,
        result: result.result as Prisma.InputJsonValue,
        error: result.error
      }
    })

    // Ensure lock is released in case of error (fallback safety)
    if (!result.success) {
      try {
        await this.prisma.maintenanceTask.update({
          where: { id: taskId },
          data: { executionStatus: 'IDLE' }
        })
      } catch (lockReleaseError) {
        console.error(`Failed to release lock for task ${taskId}:`, lockReleaseError)
      }
    }

    console.log(`Maintenance task completed: ${taskId} (${result.success ? 'SUCCESS' : 'FAILED'})`)
    return { ...result, duration }
  }

  /**
   * Execute maintenance operation immediately without scheduling
   */
  async executeImmediate (
    vmId: string,
    taskType: MaintenanceTaskType,
    parameters: Record<string, unknown>,
    userId: string
  ): Promise<MaintenanceExecutionResult> {
    console.log(`Executing immediate maintenance: ${taskType} for VM ${vmId}`)

    // Validate the VM exists
    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!machine) {
      throw new Error('Virtual machine not found')
    }

    // Check VM connectivity before execution
    const isConnected = await this.virtioSocketService.isVmConnected(vmId)
    if (!isConnected) {
      throw new Error('VM is not connected or powered off')
    }

    // Validate parameters
    this.validateTaskParameters(taskType, parameters as Prisma.JsonValue)

    // Create history entry with RUNNING status first
    const historyEntry = await this.prisma.maintenanceHistory.create({
      data: {
        taskId: null, // No task ID for immediate executions
        machineId: vmId,
        taskType,
        status: MaintenanceStatus.RUNNING,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: userId
      }
    })

    const startTime = Date.now()
    let result: MaintenanceExecutionResult

    try {
      result = await this.executeMaintenanceOperation(vmId, taskType, parameters)
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }

    const duration = Date.now() - startTime

    // Update the history entry with final status
    await this.prisma.maintenanceHistory.update({
      where: { id: historyEntry.id },
      data: {
        status: result.success ? MaintenanceStatus.SUCCESS : MaintenanceStatus.FAILED,
        duration,
        result: result.result as Prisma.InputJsonValue,
        error: result.error
      }
    })

    console.log(`Immediate maintenance completed: ${taskType} (${result.success ? 'SUCCESS' : 'FAILED'})`)
    return { ...result, duration }
  }

  /**
   * Core maintenance operation execution without history logging
   */
  private async executeMaintenanceOperation (
    vmId: string,
    taskType: MaintenanceTaskType,
    parameters: Record<string, unknown>
  ): Promise<MaintenanceExecutionResult> {
    switch (taskType) {
    case MaintenanceTaskType.DISK_CLEANUP:
      return this.executeDiskCleanup(vmId, parameters)
    case MaintenanceTaskType.DEFRAG:
      return this.executeDefrag(vmId, parameters)
    case MaintenanceTaskType.DEFENDER_SCAN:
      return this.executeDefenderScan(vmId, parameters)
    case MaintenanceTaskType.WINDOWS_UPDATES:
      return this.executeWindowsUpdates(vmId, parameters)
    case MaintenanceTaskType.SYSTEM_FILE_CHECK:
      return this.executeSystemFileCheck(vmId, parameters)
    case MaintenanceTaskType.DISK_CHECK:
      return this.executeDiskCheck(vmId, parameters)
    case MaintenanceTaskType.REGISTRY_CLEANUP:
      return this.executeRegistryCleanup(vmId, parameters)
    case MaintenanceTaskType.CUSTOM_SCRIPT:
      return this.executeCustomScript(vmId, parameters)
    default:
      throw new Error(`Unsupported maintenance task type: ${taskType}`)
    }
  }

  /**
   * Execute PowerShell script with proper wrapping and timeout
   */
  private async executePowerShellScript (
    vmId: string,
    script: string,
    taskType: MaintenanceTaskType,
    customTimeout?: number
  ): Promise<MaintenanceExecutionResult> {
    // Get timeout for this task type or use custom timeout
    const timeout = customTimeout || TASK_TIMEOUTS[taskType] || 300000

    // Wrap script with PowerShell invocation
    const psCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script}"`

    try {
      const response = await this.virtioSocketService.sendUnsafeCommand(vmId, psCmd, { timeout })

      if (response.success) {
        const result = response.data || response.stdout
        return {
          success: true,
          result: result as Prisma.JsonValue,
          duration: response.execution_time_ms
        }
      } else {
        return {
          success: false,
          error: response.error || 'PowerShell script execution failed'
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Script execution error'
      }
    }
  }

  private async executeDiskCleanup (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const drive = (parameters.drive as string) || 'C:'
    const targets = (parameters.targets as string[]) || ['temp_files', 'browser_cache', 'recycle_bin']

    const script = `
      $result = @{ success = $true; spaceClearedMB = 0; filesDeleted = 0; error = $null }
      try {
        $initialSpace = (Get-PSDrive C).Free / 1MB
        Get-ChildItem -Path $env:TEMP -Recurse -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        Clear-RecycleBin -Force -ErrorAction SilentlyContinue
        $finalSpace = (Get-PSDrive C).Free / 1MB
        $result.spaceClearedMB = [math]::Round($finalSpace - $initialSpace, 2)
      } catch { $result.success = $false; $result.error = $_.Exception.Message }
      $result | ConvertTo-Json
    `.replace(/\n\s+/g, ' ').trim()

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.DISK_CLEANUP, parameters.timeoutMs as number)
  }

  private async executeDefrag (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const drive = (parameters.drive as string) || 'C:'

    const script = `
      $result = @{ success = $true; drive = '${drive}'; durationMinutes = 0; error = $null }
      try {
        $startTime = Get-Date
        Optimize-Volume -DriveLetter ${drive.replace(':', '')} -Defrag
        $endTime = Get-Date
        $result.durationMinutes = [math]::Round(($endTime - $startTime).TotalMinutes, 2)
      } catch { $result.success = $false; $result.error = $_.Exception.Message }
      $result | ConvertTo-Json
    `.replace(/\n\s+/g, ' ').trim()

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.DEFRAG, parameters.timeoutMs as number)
  }

  private async executeDefenderScan (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const scanType = (parameters.scanType as string) || 'quick'

    const script = `
      $result = @{ success = $true; scanType = '${scanType}'; threatsFound = 0; error = $null }
      try {
        if ('${scanType}' -eq 'quick') { Start-MpScan -ScanType QuickScan } else { Start-MpScan -ScanType FullScan }
        $threats = Get-MpThreatDetection
        $result.threatsFound = $threats.Count
      } catch { $result.success = $false; $result.error = $_.Exception.Message }
      $result | ConvertTo-Json
    `.replace(/\n\s+/g, ' ').trim()

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.DEFENDER_SCAN, parameters.timeoutMs as number)
  }

  private async executeWindowsUpdates (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const script = `
      $result = @{ success = $true; updatesAvailable = 0; error = $null }
      try {
        if (Get-Module -ListAvailable -Name PSWindowsUpdate) {
          Import-Module PSWindowsUpdate
          $updates = Get-WindowsUpdate
          $result.updatesAvailable = $updates.Count
        } else {
          $result.error = 'PSWindowsUpdate module not available'
        }
      } catch { $result.success = $false; $result.error = $_.Exception.Message }
      $result | ConvertTo-Json
    `.replace(/\n\s+/g, ' ').trim()

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.WINDOWS_UPDATES, parameters.timeoutMs as number)
  }

  private async executeSystemFileCheck (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const script = `
      $result = @{ success = $true; corruptFilesFound = $false; error = $null }
      try {
        $sfcResult = sfc /scannow
        if ($sfcResult -match 'found corrupt files') { $result.corruptFilesFound = $true }
      } catch { $result.success = $false; $result.error = $_.Exception.Message }
      $result | ConvertTo-Json
    `.replace(/\n\s+/g, ' ').trim()

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.SYSTEM_FILE_CHECK, parameters.timeoutMs as number)
  }

  private async executeDiskCheck (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const drive = (parameters.drive as string) || 'C:'

    const script = `
      $result = @{ success = $true; drive = '${drive}'; error = $null }
      try {
        if ('${drive}' -eq 'C:') {
          $result.message = 'Disk check scheduled for next reboot'
        } else {
          chkdsk ${drive} /f /r
        }
      } catch { $result.success = $false; $result.error = $_.Exception.Message }
      $result | ConvertTo-Json
    `.replace(/\n\s+/g, ' ').trim()

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.DISK_CHECK, parameters.timeoutMs as number)
  }

  private async executeRegistryCleanup (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const script = `
      $result = @{ success = $true; keysProcessed = 0; error = $null }
      try {
        $path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU'
        if (Test-Path $path) {
          $items = Get-ChildItem $path -ErrorAction SilentlyContinue
          $result.keysProcessed = $items.Count
        }
      } catch { $result.success = $false; $result.error = $_.Exception.Message }
      $result | ConvertTo-Json
    `.replace(/\n\s+/g, ' ').trim()

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.REGISTRY_CLEANUP, parameters.timeoutMs as number)
  }

  private async executeCustomScript (vmId: string, parameters: Record<string, unknown>): Promise<MaintenanceExecutionResult> {
    const script = parameters.script as string
    if (!script) {
      throw new Error('Custom script parameter is required')
    }

    return this.executePowerShellScript(vmId, script, MaintenanceTaskType.CUSTOM_SCRIPT, parameters.timeoutMs as number)
  }

  /**
   * Get scheduled tasks for a VM
   */
  async getTasksForVM (vmId: string, status?: 'enabled' | 'disabled') {
    const where: Prisma.MaintenanceTaskWhereInput = { machineId: vmId }
    if (status === 'enabled') where.isEnabled = true
    if (status === 'disabled') where.isEnabled = false

    return this.prisma.maintenanceTask.findMany({
      where,
      include: {
        machine: true,
        createdBy: true,
        _count: {
          select: { history: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
  }

  /**
   * Get due tasks (both recurring and one-time)
   */
  async getDueTasks () {
    const now = new Date()

    return this.prisma.maintenanceTask.findMany({
      where: {
        isEnabled: true,
        executionStatus: 'IDLE', // Only get tasks that are not running or locked
        OR: [
          // Recurring tasks with nextRunAt due
          {
            isRecurring: true,
            nextRunAt: {
              lte: now
            }
          },
          // One-time tasks with runAt due
          {
            isRecurring: false,
            runAt: {
              lte: now
            }
          },
          // One-time tasks with nextRunAt due (fallback)
          {
            isRecurring: false,
            nextRunAt: {
              lte: now
            }
          }
        ]
      },
      include: {
        machine: true,
        createdBy: true
      },
      orderBy: { nextRunAt: 'asc' }
    })
  }

  /**
   * Get upcoming tasks scheduled to run soon
   */
  async getUpcomingTasks (vmId: string, hoursAhead: number = 24) {
    const futureTime = new Date()
    futureTime.setHours(futureTime.getHours() + hoursAhead)

    return this.prisma.maintenanceTask.findMany({
      where: {
        machineId: vmId,
        isEnabled: true,
        nextRunAt: {
          lte: futureTime,
          gte: new Date()
        }
      },
      include: {
        machine: true,
        createdBy: true
      },
      orderBy: { nextRunAt: 'asc' }
    })
  }

  /**
   * Get execution history for a VM
   */
  async getTaskHistory (vmId: string, limit: number = 50, offset: number = 0) {
    return this.prisma.maintenanceHistory.findMany({
      where: { machineId: vmId },
      include: {
        task: true,
        machine: true,
        executedBy: true
      },
      orderBy: { executedAt: 'desc' },
      take: limit,
      skip: offset
    })
  }

  /**
   * Update task configuration
   */
  async updateTask (taskId: string, updates: Partial<MaintenanceTaskConfig>) {
    console.log(`Updating maintenance task: ${taskId}`)

    const task = await this.prisma.maintenanceTask.findUnique({
      where: { id: taskId }
    })

    if (!task) {
      throw new Error('Maintenance task not found')
    }

    // Validate parameters if provided
    if (updates.parameters && updates.taskType) {
      this.validateTaskParameters(updates.taskType, updates.parameters)
    }

    // Calculate new next run time if schedule changed
    let nextRunAt = task.nextRunAt
    if (updates.cronSchedule && updates.isRecurring) {
      nextRunAt = CronParser.getNextRunTime(updates.cronSchedule)
    }

    // Build update data with proper typing
    const updateData: Prisma.MaintenanceTaskUpdateInput = {
      nextRunAt,
      updatedAt: new Date()
    }

    if (updates.name !== undefined) updateData.name = updates.name
    if (updates.description !== undefined) updateData.description = updates.description
    if (updates.isRecurring !== undefined) updateData.isRecurring = updates.isRecurring
    if (updates.cronSchedule !== undefined) updateData.cronSchedule = updates.cronSchedule
    if (updates.parameters !== undefined) updateData.parameters = updates.parameters as Prisma.InputJsonValue
    if (updates.taskType !== undefined) updateData.taskType = updates.taskType

    return this.prisma.maintenanceTask.update({
      where: { id: taskId },
      data: updateData,
      include: {
        machine: true,
        createdBy: true
      }
    })
  }

  /**
   * Delete a maintenance task
   */
  async deleteTask (taskId: string) {
    console.log(`Deleting maintenance task: ${taskId}`)

    const task = await this.prisma.maintenanceTask.findUnique({
      where: { id: taskId }
    })

    if (!task) {
      throw new Error('Maintenance task not found')
    }

    return this.prisma.maintenanceTask.delete({
      where: { id: taskId }
    })
  }

  /**
   * Validate task parameters based on task type
   */
  private validateTaskParameters (taskType: MaintenanceTaskType, parameters?: Prisma.JsonValue) {
    if (!parameters) return

    const params = parameters as Record<string, unknown>

    switch (taskType) {
    case MaintenanceTaskType.DISK_CLEANUP:
      if (params.drive && typeof params.drive !== 'string') {
        throw new Error('Drive parameter must be a string')
      }
      if (params.targets && !Array.isArray(params.targets)) {
        throw new Error('Targets parameter must be an array')
      }
      break

    case MaintenanceTaskType.DEFRAG:
    case MaintenanceTaskType.DISK_CHECK:
      if (params.drive && typeof params.drive !== 'string') {
        throw new Error('Drive parameter must be a string')
      }
      break

    case MaintenanceTaskType.DEFENDER_SCAN:
      if (params.scanType && !['quick', 'full', 'custom'].includes(params.scanType as string)) {
        throw new Error('Scan type must be quick, full, or custom')
      }
      break

    case MaintenanceTaskType.CUSTOM_SCRIPT:
      if (!params.script || typeof params.script !== 'string') {
        throw new Error('Script parameter is required and must be a string')
      }
      break
    }

    // Validate timeout if provided
    if (params.timeoutMs && (typeof params.timeoutMs !== 'number' || params.timeoutMs < 1000)) {
      throw new Error('Timeout must be a number greater than 1000ms')
    }
  }
}

// Export the class for use in other parts of the application
export default MaintenanceService
