import logger from '@main/logger'
import { HealthCheckType } from '@prisma/client'
import { EventManager } from './EventManager'
import { getVirtioSocketWatcherService, CommandResponse, SafeCommandType } from './VirtioSocketWatcherService'
import { VMHealthQueueRepository, QueuedHealthCheck } from './VMHealthQueueRepository'
import { MachineStatus } from '../graphql/resolvers/machine/type'

// ─── Configuration constants ────────────────────────────────────────────────

export const DEFAULT_MAX_ATTEMPTS = 20
export const INITIAL_BACKOFF_MS = 30_000
export const NON_CONNECTION_BACKOFF_MS = 10_000
export const MAX_BACKOFF_MS = 300_000
export const BACKOFF_MULTIPLIER = 1.5

/** Timeout per check type (ms), indexed by HealthCheckType */
export const HEALTH_CHECK_TIMEOUTS: Record<HealthCheckType, number> = {
  OVERALL_STATUS: 300_000,          // 5 min
  DISK_SPACE: 60_000,              // 1 min
  RESOURCE_OPTIMIZATION: 240_000,  // 4 min
  WINDOWS_UPDATES: 300_000,        // 5 min
  WINDOWS_DEFENDER: 300_000,        // 5 min
  LINUX_UPDATES: 300_000,          // 5 min
  APPLICATION_INVENTORY: 180_000,   // 3 min
  APPLICATION_UPDATES: 180_000,    // 3 min
  SECURITY_CHECK: 180_000,          // 3 min
  PERFORMANCE_CHECK: 180_000,      // 3 min
  SYSTEM_HEALTH: 300_000,          // 5 min
  CUSTOM_CHECK: 120_000,            // 2 min
}

/** Maps HealthCheckType → VirtioSocket action string */
export const CHECK_TYPE_TO_ACTION: Record<HealthCheckType, SafeCommandType['action']> = {
  OVERALL_STATUS:         'RunAllHealthChecks',
  DISK_SPACE:             'CheckDiskSpace',
  RESOURCE_OPTIMIZATION:   'CheckResourceOptimization',
  WINDOWS_UPDATES:        'CheckWindowsUpdates',
  WINDOWS_DEFENDER:       'CheckWindowsDefender',
  LINUX_UPDATES:          'CheckLinuxUpdates',
  APPLICATION_INVENTORY:  'GetInstalledApplicationsWMI',
  APPLICATION_UPDATES:    'CheckApplicationUpdates',
  SECURITY_CHECK:         'RunAllHealthChecks',  // fallback
  PERFORMANCE_CHECK:      'RunAllHealthChecks',  // fallback
  SYSTEM_HEALTH:          'RunAllHealthChecks',  // fallback
  CUSTOM_CHECK:           'RunAllHealthChecks',  // fallback
}

/** Error category labels for observability */
export type HealthCheckErrorCategory = 'timeout' | 'connection' | 'disconnected' | 'unknown'

// ─── HealthCheckExecutor ────────────────────────────────────────────────────

/**
 * Executes a single health-check task: validates VM state, dispatches the
 * VirtioSocket command, stores results, emits events, and handles retries.
 *
 * All external I/O (database, socket, event bus) is injected through the
 * constructor so the class remains fully unit-testable with mocks.
 *
 * Snapshot storage is delegated to the injected repository, which the
 * caller (VMHealthQueueManager facade) can wrap in its own snapshot manager
 * if needed.
 */
// ─── Snapshot manager interface ─────────────────────────────────────────────────────

/**
 * Interface for snapshot storage, injected so HealthCheckExecutor
 * remains testable without a real snapshot manager.
 */
export interface SnapshotStore {
  storeSuccess(
    machineId: string,
    checkType: HealthCheckType,
    result: CommandResponse,
    executionTimeMs: number,
  ): Promise<void>
}

export class HealthCheckExecutor {
  constructor(
    private readonly repository: VMHealthQueueRepository,
    private readonly eventManager: EventManager,
    private readonly snapshotStore?: SnapshotStore,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────────

  /**
   * Execute a single queued health-check task end-to-end.
   *
   * Marks the task RUNNING, emits a "started" event, sends the command,
   * stores the result, emits a "completed" event, and re-throws
   * on error so the caller can decide queue removal.
   */
  async executeHealthCheck(task: QueuedHealthCheck): Promise<void> {
    const startTime = Date.now()

    // 1. Verify VM is still running before attempting anything
    await this.verifyVmRunning(task)

    // 2. Mark task as RUNNING in the database
    await this.repository.markTaskRunning(task.id, task.attempts)

    // 3. Emit "started" event
    await this.eventManager.dispatchEvent('vms', 'update', {
      id: task.machineId,
      healthCheckStarted: {
        taskId: task.id,
        checkType: task.checkType,
        attempt: task.attempts + 1,
      },
    })

    // 4. Resolve action and timeout
    const action = this.resolveAction(task.checkType)
    const timeout = this.resolveTimeout(task.checkType)

    // 5. Send the command
    const result = await this.sendCommand(task, action, timeout, startTime)
    const executionTime = Date.now() - startTime

    // 6. Record success in DB
    await this.recordSuccess(task, result, executionTime)

    // 7. Store health snapshot (best-effort — errors here must not break the flow)
    if (this.snapshotStore) {
      await this.snapshotStore.storeSuccess(task.machineId, task.checkType, result, executionTime)
        .catch((err: unknown) => {
          logger.error(
            `\u274c Failed to store health snapshot for VM ${task.machineId} check ${task.checkType}:`,
            err,
          )
        })
    }
  }

  /**
   * Handle task failure with retry/backoff logic.
   *
   * Mutates `task` in place (increments attempts, updates scheduledFor).
   * Returns `true` if the task was retried; `false` if max attempts reached.
   */
  async handleTaskFailure(task: QueuedHealthCheck, error: Error): Promise<boolean> {
    const category = this.categorizeError(error)
    task.attempts++

    if (task.attempts >= task.maxAttempts) {
      await this.eventManager.dispatchEvent('vms', 'update', {
        id: task.machineId,
        healthCheckStatusChanged: {
          checkType: task.checkType,
          status: 'failed',
          error: error.message,
          attempts: task.attempts,
        },
      })
      logger.info(
        `\ud83d\uddc2\ufe0f Health check ${task.checkType} for VM ${task.machineId} ` +
        `failed after ${task.maxAttempts} attempts \u2014 InfiniService may not be running`,
      )
      return false
    }

    // Compute backoff using the actual error category — connection errors get 30s base,
    // non-connection errors get 10s base (restoring the nuanced backoff from the original).
    const { backoffMs, isConnectionError } = this.computeBackoff(task, category)
    task.scheduledFor = new Date(Date.now() + backoffMs)

    await this.repository.markTaskRetryScheduled(task.id, task.scheduledFor, task.attempts)

    const backoffSeconds = Math.round(backoffMs / 1_000)
    const errorType = isConnectionError ? 'VM/InfiniService starting up' : 'other error'
    logger.info(
      `\ud83d\uddc2\ufe0f Retrying health check ${task.checkType} for VM ${task.machineId} ` +
      `in ${backoffSeconds}s (attempt ${task.attempts}/${task.maxAttempts}) ` +
      `\u2014 ${errorType}: ${error.message}`,
    )

    await this.eventManager.dispatchEvent('vms', 'update', {
      id: task.machineId,
      healthCheckStatusChanged: {
        checkType: task.checkType,
        status: 'retry_scheduled',
        error: error.message,
        attempts: task.attempts,
      },
    })

    return true
  }

  // ─── Timeout resolution ───────────────────────────────────────────────────────

  /**
   * Return the timeout (ms) for a check type, honouring `HEALTH_CHECK_TIMEOUT_<TYPE>`
   * environment variable overrides.
   */
  resolveTimeout(checkType: HealthCheckType): number {
    const envKey = `HEALTH_CHECK_TIMEOUT_${checkType}`
    const envValue = process.env[envKey]
    if (envValue) {
      const parsed = parseInt(envValue, 10)
      if (!isNaN(parsed) && parsed > 0) return parsed
      const fallback = HEALTH_CHECK_TIMEOUTS[checkType] ?? 120_000
      logger.warn(
        `\u26a0\ufe0f Invalid value for ${envKey}: '${envValue}'. Using default: ${fallback}ms`,
      )
    }
    return HEALTH_CHECK_TIMEOUTS[checkType] ?? 120_000
  }

  // ─── Error categorisation ────────────────────────────────────────────────────

  /**
   * Categorise an error thrown during health-check execution.
   * Used for structured logging and observability, and to drive nuanced backoff.
   */
  categorizeError(error: unknown): HealthCheckErrorCategory {
    const message = this.extractErrorMessage(error)
    const code    = this.extractErrorCode(error)

    if (message.includes('timeout') || code === 'ETIMEDOUT')      return 'timeout'
    if (
      message.includes('No connection') ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'EPIPE'
    )                                                                   return 'connection'
    if (message.includes('not connected'))                             return 'disconnected'
    return 'unknown'
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async verifyVmRunning(task: QueuedHealthCheck): Promise<void> {
    const vm = await this.repository.findMachine(task.machineId)
    if (!vm) {
      throw new Error(`VM ${task.machineId} not found in database`)
    }
    if (vm.status !== MachineStatus.RUNNING) {
      throw new Error(
        `VM ${vm.name} (${task.machineId}) is not running (status: ${vm.status}). ` +
        'Cannot execute health check.',
      )
    }
  }

  private resolveAction(checkType: HealthCheckType): SafeCommandType['action'] {
    const action = CHECK_TYPE_TO_ACTION[checkType]
    if (!action) {
      throw new Error(`Unsupported health check type: ${checkType}`)
    }
    return action
  }

  private async sendCommand(
    task: QueuedHealthCheck,
    action: SafeCommandType['action'],
    timeout: number,
    startTime: number,
  ): Promise<CommandResponse> {
    const virtioService = getVirtioSocketWatcherService()
    const result = await virtioService.sendSafeCommand(
      task.machineId,
      { action, params: task.payload || undefined },
      timeout,
    )

    const executionTime = Date.now() - startTime
    if (executionTime > timeout * 0.8) {
      logger.warn(
        `\ud83e\ude7a Health check ${task.checkType} for VM ${task.machineId} ` +
        `is taking longer than expected (${executionTime}ms)`,
      )
    }

    return result
  }

  private async recordSuccess(
    task: QueuedHealthCheck,
    result: CommandResponse,
    executionTime: number,
  ): Promise<void> {
    await this.repository.markTaskCompleted(task.id, result, executionTime)

    await this.eventManager.dispatchEvent('vms', 'update', {
      id: task.machineId,
      healthCheckCompleted: {
        taskId: task.id,
        checkType: task.checkType,
        executionTimeMs: executionTime,
        success: result.success,
      },
    })

    logger.info(
      `\ud83e\ude7a Completed health check ${task.checkType} for VM ${task.machineId} ` +
      `(${executionTime}ms) \u2014 Success: ${result.success}`,
    )
  }

  /**
   * Compute backoff using the actual error category (not just check type).
   * Connection/categorised errors get INITIAL_BACKOFF_MS (30s),
   * non-connection errors get NON_CONNECTION_BACKOFF_MS (10s).
   */
  private computeBackoff(
    task: QueuedHealthCheck,
    category: HealthCheckErrorCategory,
  ): { backoffMs: number; isConnectionError: boolean } {
    const isConnectionError = category === 'connection' || category === 'timeout'
    const baseBackoff = isConnectionError
      ? INITIAL_BACKOFF_MS
      : NON_CONNECTION_BACKOFF_MS

    const backoffMs = Math.min(
      baseBackoff * Math.pow(BACKOFF_MULTIPLIER, task.attempts - 1),
      MAX_BACKOFF_MS,
    )
    return { backoffMs, isConnectionError }
  }

  private extractErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message)
    }
    return ''
  }

  private extractErrorCode(error: unknown): string {
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code: unknown }).code)
    }
    return ''
  }
}
