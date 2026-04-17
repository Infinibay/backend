import { PrismaClient, HealthCheckType, TaskPriority } from '@prisma/client'


/**
 * Health check payload — compatible with Prisma JSON fields.
 * (HealthCheckPayload was originally defined in VMHealthQueueManager and
 * is re-exported from there for backward compatibility.)
 */
export interface HealthCheckPayload {
  [key: string]: string | number | boolean | undefined
}

/**
 * Queued health check — the canonical in-memory representation
 * of a row in vMHealthCheckQueue.
 */
export interface QueuedHealthCheck {
  id: string
  machineId: string
  checkType: HealthCheckType
  priority: TaskPriority
  attempts: number
  maxAttempts: number
  scheduledFor: Date
  payload?: HealthCheckPayload | null
  createdAt: Date
}

/** Raw Prisma row shape */
type HealthCheckQueueRow = {
  id: string
  machineId: string
  checkType: HealthCheckType
  priority: TaskPriority
  status: string
  payload: unknown
  attempts: number
  maxAttempts: number
  scheduledFor: Date
  executedAt: Date | null
  completedAt: Date | null
  error: string | null
  result: unknown
  executionTimeMs: number | null
  createdAt: Date
  updatedAt: Date
}

/** Maps a raw Prisma row to the internal QueuedHealthCheck representation */
function toQueuedHealthCheck(row: HealthCheckQueueRow): QueuedHealthCheck {
  return {
    id: row.id,
    machineId: row.machineId,
    checkType: row.checkType,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    scheduledFor: row.scheduledFor,
    payload: row.payload as QueuedHealthCheck['payload'],
    createdAt: row.createdAt,
  }
}

/**
 * VMHealthQueueRepository — all database access for the health-check queue.
 *
 * Design: returns plain data objects; the caller (VMHealthQueueManager facade)
 * is responsible for merging results into its own state.
 */
export class VMHealthQueueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Query helpers ────────────────────────────────────────────────────────

  async findPendingTasksForVm(machineId: string): Promise<QueuedHealthCheck[]> {
    const rows = await this.prisma.vMHealthCheckQueue.findMany({
      where: { machineId, status: { in: ['PENDING', 'RETRY_SCHEDULED'] } },
      orderBy: [{ priority: 'asc' }, { scheduledFor: 'asc' }],
    })
    return rows.map(toQueuedHealthCheck)
  }

  async findAllPendingTasks(): Promise<QueuedHealthCheck[]> {
    const rows = await this.prisma.vMHealthCheckQueue.findMany({
      where: { status: { in: ['PENDING', 'RETRY_SCHEDULED'] } },
      orderBy: [{ priority: 'asc' }, { scheduledFor: 'asc' }],
    })
    return rows.map(toQueuedHealthCheck)
  }

  async findExistingTask(machineId: string, checkType: HealthCheckType): Promise<{ id: string } | null> {
    const row = await this.prisma.vMHealthCheckQueue.findFirst({
      where: { machineId, checkType, status: { in: ['PENDING', 'RETRY_SCHEDULED', 'RUNNING'] } },
      select: { id: true },
    })
    return row
  }

  async findRecentCompletedOverallScan(machineId: string, intervalMs: number): Promise<{ id: string } | null> {
    const row = await this.prisma.vMHealthCheckQueue.findFirst({
      where: {
        machineId,
        checkType: 'OVERALL_STATUS',
        status: 'COMPLETED',
        completedAt: { gte: new Date(Date.now() - intervalMs) },
      },
      select: { id: true },
    })
    return row
  }

  async getVmConfig(machineId: string): Promise<{ checkIntervalMinutes: number | null } | null> {
    return this.prisma.vMHealthConfig.findUnique({
      where: { machineId },
      select: { checkIntervalMinutes: true },
    })
  }

  async findMachine(machineId: string): Promise<{ id: string; name: string; status: string; os?: string | null } | null> {
    return this.prisma.machine.findUnique({
      where: { id: machineId },
      select: { id: true, name: true, status: true, os: true },
    })
  }

  async getLastOverallScanTime(machineId: string): Promise<Date | null> {
    const row = await this.prisma.vMHealthCheckQueue.findFirst({
      where: { machineId, checkType: 'OVERALL_STATUS', status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true },
    })
    return row?.completedAt ?? null
  }

  // ─── Write operations ──────────────────────────────────────────────────────

  async insertTask(
    machineId: string,
    checkType: HealthCheckType,
    priority: TaskPriority,
    payload: Record<string, unknown> | undefined,
    maxAttempts: number,
    taskId: string,
    scheduledFor: Date,
  ): Promise<string> {
    await this.prisma.vMHealthCheckQueue.create({
      data: {
        id: taskId,
        machineId,
        checkType,
        priority,
        status: 'PENDING',
        payload: (payload as any) ?? undefined,
        attempts: 0,
        maxAttempts,
        scheduledFor,
      },
    })
    return taskId
  }

  async claimReadyTasks(machineId: string, maxTasks: number): Promise<QueuedHealthCheck[]> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const readyRows = await tx.vMHealthCheckQueue.findMany({
        where: {
          machineId,
          status: { in: ['PENDING', 'RETRY_SCHEDULED'] },
          scheduledFor: { lte: new Date() },
        },
        orderBy: [{ priority: 'asc' }, { scheduledFor: 'asc' }],
        take: maxTasks,
      })
      if (readyRows.length === 0) return []
      const taskIds = readyRows.map((r) => r.id)
      await tx.vMHealthCheckQueue.updateMany({
        where: { id: { in: taskIds }, status: { in: ['PENDING', 'RETRY_SCHEDULED'] } },
        data: { status: 'RUNNING', executedAt: new Date() },
      })
      return readyRows
    })
    return claimed.map(toQueuedHealthCheck)
  }

  async markTaskRunning(taskId: string, taskAttempts: number): Promise<void> {
    await this.prisma.vMHealthCheckQueue.update({
      where: { id: taskId },
      data: { status: 'RUNNING', executedAt: new Date(), attempts: taskAttempts + 1 },
    })
  }

  async markTaskCompleted(taskId: string, result: unknown, executionTimeMs: number): Promise<void> {
    await this.prisma.vMHealthCheckQueue.update({
      where: { id: taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        result: result as any,
        executionTimeMs,
      },
    })
  }

  async markTaskFailed(taskId: string, errorMessage: string, executionTimeMs: number): Promise<void> {
    await this.prisma.vMHealthCheckQueue.update({
      where: { id: taskId },
      data: { status: 'FAILED', completedAt: new Date(), error: errorMessage, executionTimeMs },
    })
  }

  async markTaskRetryScheduled(taskId: string, scheduledFor: Date, attempts: number): Promise<void> {
    await this.prisma.vMHealthCheckQueue.update({
      where: { id: taskId },
      data: { status: 'RETRY_SCHEDULED', scheduledFor, attempts },
    })
  }

  async deleteTask(taskId: string): Promise<void> {
    await this.prisma.vMHealthCheckQueue.deleteMany({
      where: { id: taskId, status: { in: ['PENDING', 'RETRY_SCHEDULED'] } },
    })
  }

  async deleteTasksForVm(machineId: string): Promise<number> {
    const result = await this.prisma.vMHealthCheckQueue.deleteMany({
      where: { machineId, status: { in: ['PENDING', 'RETRY_SCHEDULED'] } },
    })
    return result.count
  }

  async deleteOrphanedTasks(): Promise<number> {
    const deletedVMs = await this.prisma.machine.findMany({
      where: { status: 'DELETED' },
      select: { id: true },
    })
    if (deletedVMs.length === 0) return 0
    const result = await this.prisma.vMHealthCheckQueue.deleteMany({
      where: {
        machineId: { in: deletedVMs.map((v) => v.id) },
        status: { in: ['PENDING', 'RETRY_SCHEDULED'] },
      },
    })
    return result.count
  }

  async getDeletedVmIds(): Promise<string[]> {
    const deletedVMs = await this.prisma.machine.findMany({
      where: { status: 'DELETED' },
      select: { id: true },
    })
    return deletedVMs.map((v) => v.id)
  }

  // ─── Snapshot operations ──────────────────────────────────────────────────

  async findTodaySnapshot(machineId: string) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return this.prisma.vMHealthSnapshot.findFirst({
      where: {
        machineId,
        snapshotDate: { gte: today, lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) },
      },
    })
  }

  async createSnapshot(machineId: string, customCheckResults: Record<string, unknown>) {
    return this.prisma.vMHealthSnapshot.create({
      data: {
        machineId,
        snapshotDate: new Date(),
        overallStatus: 'PENDING',
        checksCompleted: 0,
        checksFailed: 0,
        customCheckResults: customCheckResults as any,
      },
    })
  }

  async updateSnapshotMetadata(snapshotId: string, customCheckResults: Record<string, unknown>): Promise<void> {
    await this.prisma.vMHealthSnapshot.update({
      where: { id: snapshotId },
      data: { customCheckResults: customCheckResults as any },
    })
  }

  async getSnapshotForMerge(snapshotId: string) {
    return this.prisma.vMHealthSnapshot.findUnique({
      where: { id: snapshotId },
      select: { applicationInventory: true },
    })
  }

  async appendSnapshotResult(
    snapshotId: string,
    executionTimeMs: number,
    updateFields: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.vMHealthSnapshot.update({
      where: { id: snapshotId },
      data: {
        checksCompleted: { increment: 1 },
        executionTimeMs: { increment: executionTimeMs },
        ...(updateFields as any),
      },
    })
  }

  async incrementSnapshotFailures(snapshotId: string): Promise<void> {
    await this.prisma.vMHealthSnapshot.update({
      where: { id: snapshotId },
      data: { checksFailed: { increment: 1 } },
    })
  }

  async setSnapshotOverallStatus(snapshotId: string, overallStatus: string): Promise<void> {
    await this.prisma.vMHealthSnapshot.update({
      where: { id: snapshotId },
      data: { overallStatus },
    })
  }
}
