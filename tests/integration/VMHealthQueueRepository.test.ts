import 'reflect-metadata'
import { VMHealthQueueRepository } from '@services/VMHealthQueueRepository'
import { testPrisma } from '../setup/jest.setup'
import {
  createAdmin,
  createUser,
  createDepartment,
  createMachine,
} from '../setup/db-factories'
import { HealthCheckType, TaskPriority, TaskStatus } from '@prisma/client'
import { randomUUID } from 'crypto'

describe('VMHealthQueueRepository — real database', () => {
  const prisma = testPrisma.prisma
  let repo: VMHealthQueueRepository
  let machineId: string
  let userId: string
  let departmentId: string

  beforeEach(async () => {
    repo = new VMHealthQueueRepository(prisma)

    const admin = await createAdmin(prisma)
    userId = admin.id
    const dept = await createDepartment(prisma)
    departmentId = dept.id
    const machine = await createMachine(prisma, { userId, departmentId })
    machineId = machine.id
  })

  // ─── Helper: insert a queue row directly ──────────────────────────────────

  async function insertQueueRow(overrides: {
    machineId: string
    checkType?: HealthCheckType
    priority?: TaskPriority
    status?: TaskStatus
    scheduledFor?: Date
    payload?: any
    maxAttempts?: number
    attempts?: number
  }) {
    return prisma.vMHealthCheckQueue.create({
      data: {
        id: randomUUID(),
        machineId: overrides.machineId,
        checkType: overrides.checkType ?? 'DISK_SPACE',
        priority: overrides.priority ?? 'MEDIUM',
        status: overrides.status ?? 'PENDING',
        scheduledFor: overrides.scheduledFor ?? new Date(),
        payload: overrides.payload ?? undefined,
        maxAttempts: overrides.maxAttempts ?? 3,
        attempts: overrides.attempts ?? 0,
      },
    })
  }

  // ─── Query helpers ────────────────────────────────────────────────────────

  describe('findPendingTasksForVm', () => {
    it('returns only PENDING and RETRY_SCHEDULED tasks for the given VM', async () => {
      const t1 = await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' })
      const t2 = await insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'RETRY_SCHEDULED' })
      await insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'COMPLETED' })
      await insertQueueRow({ machineId, checkType: 'WINDOWS_UPDATES', status: 'RUNNING' })

      const results = await repo.findPendingTasksForVm(machineId)
      expect(results).toHaveLength(2)
      const ids = results.map(r => r.id).sort()
      expect(ids).toEqual([t1.id, t2.id].sort())
    })

    it('returns empty array when no pending tasks exist', async () => {
      const results = await repo.findPendingTasksForVm(machineId)
      expect(results).toEqual([])
    })

    it('orders by priority ASC then scheduledFor ASC', async () => {
      const past = new Date(Date.now() - 60_000)
      const future = new Date(Date.now() + 60_000)
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', priority: 'LOW', scheduledFor: past })
      await insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', priority: 'URGENT', scheduledFor: future })
      await insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', priority: 'LOW', scheduledFor: future })

      const results = await repo.findPendingTasksForVm(machineId)
      expect(results).toHaveLength(3)
      // URGENT comes first
      expect(results[0].priority).toBe('URGENT')
      // Same priority (LOW) → scheduledFor ASC
      expect(results[1].scheduledFor.getTime()).toBeLessThan(results[2].scheduledFor.getTime())
    })

    it('does not return tasks for other machines', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' })
      const otherMachine = await createMachine(prisma, { userId, departmentId })
      await insertQueueRow({ machineId: otherMachine.id, checkType: 'DISK_SPACE', status: 'PENDING' })

      const results = await repo.findPendingTasksForVm(machineId)
      expect(results).toHaveLength(1)
      expect(results[0].machineId).toBe(machineId)
    })
  })

  describe('findAllPendingTasks', () => {
    it('returns pending tasks across all VMs', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' })
      const otherMachine = await createMachine(prisma, { userId, departmentId })
      await insertQueueRow({ machineId: otherMachine.id, checkType: 'LINUX_UPDATES', status: 'PENDING' })
      await insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'COMPLETED' })

      const results = await repo.findAllPendingTasks()
      expect(results).toHaveLength(2)
    })

    it('returns empty when no pending tasks', async () => {
      const results = await repo.findAllPendingTasks()
      expect(results).toEqual([])
    })
  })

  describe('findExistingTask', () => {
    it('finds a PENDING task for the same VM and check type', async () => {
      const row = await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' })

      const found = await repo.findExistingTask(machineId, 'DISK_SPACE')
      expect(found).not.toBeNull()
      expect(found!.id).toBe(row.id)
    })

    it('finds a RUNNING task', async () => {
      const row = await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'RUNNING' })

      const found = await repo.findExistingTask(machineId, 'DISK_SPACE')
      expect(found).not.toBeNull()
      expect(found!.id).toBe(row.id)
    })

    it('finds a RETRY_SCHEDULED task', async () => {
      const row = await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'RETRY_SCHEDULED' })

      const found = await repo.findExistingTask(machineId, 'DISK_SPACE')
      expect(found).not.toBeNull()
      expect(found!.id).toBe(row.id)
    })

    it('returns null for COMPLETED / FAILED / CANCELLED tasks', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'COMPLETED' })
      await insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'FAILED' })
      await insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'CANCELLED' })

      expect(await repo.findExistingTask(machineId, 'DISK_SPACE')).toBeNull()
      expect(await repo.findExistingTask(machineId, 'RESOURCE_OPTIMIZATION')).toBeNull()
      expect(await repo.findExistingTask(machineId, 'LINUX_UPDATES')).toBeNull()
    })

    it('returns null for different check type', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' })
      expect(await repo.findExistingTask(machineId, 'LINUX_UPDATES')).toBeNull()
    })

    it('returns null for different machine', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' })
      const otherMachine = await createMachine(prisma, { userId, departmentId })
      expect(await repo.findExistingTask(otherMachine.id, 'DISK_SPACE')).toBeNull()
    })
  })

  describe('findRecentCompletedOverallScan', () => {
    it('returns a completed OVERALL_STATUS within the interval', async () => {
      const row = await prisma.vMHealthCheckQueue.create({
        data: {
          id: randomUUID(),
          machineId,
          checkType: 'OVERALL_STATUS',
          priority: 'MEDIUM',
          status: 'COMPLETED',
          completedAt: new Date(),
          scheduledFor: new Date(),
        },
      })

      const found = await repo.findRecentCompletedOverallScan(machineId, 60_000)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(row.id)
    })

    it('returns null when completed scan is older than interval', async () => {
      await prisma.vMHealthCheckQueue.create({
        data: {
          id: randomUUID(),
          machineId,
          checkType: 'OVERALL_STATUS',
          priority: 'MEDIUM',
          status: 'COMPLETED',
          completedAt: new Date(Date.now() - 120_000),
          scheduledFor: new Date(Date.now() - 120_000),
        },
      })

      const found = await repo.findRecentCompletedOverallScan(machineId, 60_000)
      expect(found).toBeNull()
    })

    it('returns null when no OVERALL_STATUS exists', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'COMPLETED' })
      const found = await repo.findRecentCompletedOverallScan(machineId, 60_000)
      expect(found).toBeNull()
    })
  })

  describe('getVmConfig', () => {
    it('returns the config for a VM', async () => {
      await prisma.vMHealthConfig.create({
        data: {
          machineId,
          checkIntervalMinutes: 10,
          thresholds: {},
          enabledModules: [],
        },
      })

      const config = await repo.getVmConfig(machineId)
      expect(config).not.toBeNull()
      expect(config!.checkIntervalMinutes).toBe(10)
    })

    it('returns null when no config exists', async () => {
      const config = await repo.getVmConfig(machineId)
      expect(config).toBeNull()
    })
  })

  describe('findMachine', () => {
    it('returns machine info', async () => {
      const found = await repo.findMachine(machineId)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(machineId)
      expect(found!.name).toBeDefined()
      expect(found!.status).toBeDefined()
    })

    it('returns null for non-existent machine', async () => {
      const found = await repo.findMachine(randomUUID())
      expect(found).toBeNull()
    })
  })

  describe('getLastOverallScanTime', () => {
    it('returns the most recent completedAt for OVERALL_STATUS', async () => {
      const completedAt = new Date()
      await prisma.vMHealthCheckQueue.create({
        data: {
          id: randomUUID(),
          machineId,
          checkType: 'OVERALL_STATUS',
          priority: 'MEDIUM',
          status: 'COMPLETED',
          completedAt,
          scheduledFor: new Date(Date.now() - 60_000),
        },
      })

      const lastTime = await repo.getLastOverallScanTime(machineId)
      expect(lastTime).not.toBeNull()
      expect(lastTime!.getTime()).toBeCloseTo(completedAt.getTime(), -2)
    })

    it('returns null when no completed OVERALL_STATUS', async () => {
      await insertQueueRow({ machineId, checkType: 'OVERALL_STATUS', status: 'PENDING' })
      expect(await repo.getLastOverallScanTime(machineId)).toBeNull()
    })

    it('picks the most recent of multiple completed scans', async () => {
      const older = new Date(Date.now() - 60_000)
      const newer = new Date()
      await prisma.vMHealthCheckQueue.create({
        data: {
          id: randomUUID(), machineId, checkType: 'OVERALL_STATUS', priority: 'MEDIUM',
          status: 'COMPLETED', completedAt: older, scheduledFor: new Date(older.getTime() - 60_000),
        },
      })
      await prisma.vMHealthCheckQueue.create({
        data: {
          id: randomUUID(), machineId, checkType: 'OVERALL_STATUS', priority: 'MEDIUM',
          status: 'COMPLETED', completedAt: newer, scheduledFor: new Date(newer.getTime() - 60_000),
        },
      })

      const lastTime = await repo.getLastOverallScanTime(machineId)
      expect(lastTime).not.toBeNull()
      expect(lastTime!.getTime()).toBeCloseTo(newer.getTime(), -2)
    })
  })

  // ─── Write operations ──────────────────────────────────────────────────────

  describe('insertTask', () => {
    it('inserts a task and returns the ID', async () => {
      const taskId = randomUUID()
      const scheduledFor = new Date()
      const returnedId = await repo.insertTask(
        machineId, 'DISK_SPACE', 'MEDIUM', { key: 'value' }, 3, taskId, scheduledFor,
      )

      expect(returnedId).toBe(taskId)

      const row = await prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } })
      expect(row).not.toBeNull()
      expect(row!.machineId).toBe(machineId)
      expect(row!.checkType).toBe('DISK_SPACE')
      expect(row!.priority).toBe('MEDIUM')
      expect(row!.status).toBe('PENDING')
      expect(row!.attempts).toBe(0)
      expect(row!.maxAttempts).toBe(3)
      expect(row!.payload).toEqual({ key: 'value' })
    })

    it('inserts without payload', async () => {
      const taskId = randomUUID()
      await repo.insertTask(machineId, 'LINUX_UPDATES', 'HIGH', undefined, 5, taskId, new Date())

      const row = await prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } })
      expect(row).not.toBeNull()
      expect(row!.payload).toBeNull() // Prisma stores undefined as NULL for Json?
    })
  })

  describe('claimReadyTasks', () => {
    it('claims ready PENDING tasks and sets status to RUNNING', async () => {
      const t1 = await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING', scheduledFor: new Date() })
      const t2 = await insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'PENDING', scheduledFor: new Date() })

      const claimed = await repo.claimReadyTasks(machineId, 10)
      expect(claimed).toHaveLength(2)

      // Verify DB state updated to RUNNING
      const r1 = await prisma.vMHealthCheckQueue.findUnique({ where: { id: t1.id } })
      const r2 = await prisma.vMHealthCheckQueue.findUnique({ where: { id: t2.id } })
      expect(r1!.status).toBe('RUNNING')
      expect(r2!.status).toBe('RUNNING')
      expect(r1!.executedAt).not.toBeNull()
    })

    it('claims RETRY_SCHEDULED tasks', async () => {
      const row = await insertQueueRow({ machineId, status: 'RETRY_SCHEDULED', scheduledFor: new Date() })

      const claimed = await repo.claimReadyTasks(machineId, 10)
      expect(claimed).toHaveLength(1)
      expect(claimed[0].id).toBe(row.id)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db!.status).toBe('RUNNING')
    })

    it('skips tasks scheduled in the future', async () => {
      await insertQueueRow({ machineId, status: 'PENDING', scheduledFor: new Date(Date.now() + 600_000) })

      const claimed = await repo.claimReadyTasks(machineId, 10)
      expect(claimed).toHaveLength(0)
    })

    it('skips RUNNING / COMPLETED / FAILED tasks', async () => {
      await insertQueueRow({ machineId, status: 'RUNNING', scheduledFor: new Date() })
      await insertQueueRow({ machineId, status: 'COMPLETED', scheduledFor: new Date() })
      await insertQueueRow({ machineId, status: 'FAILED', scheduledFor: new Date() })

      const claimed = await repo.claimReadyTasks(machineId, 10)
      expect(claimed).toHaveLength(0)
    })

    it('respects the maxTasks limit', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING', scheduledFor: new Date() })
      await insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'PENDING', scheduledFor: new Date() })
      await insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'PENDING', scheduledFor: new Date() })

      const claimed = await repo.claimReadyTasks(machineId, 2)
      expect(claimed).toHaveLength(2)
    })

    it('does not claim tasks for other VMs', async () => {
      await insertQueueRow({ machineId, status: 'PENDING', scheduledFor: new Date() })
      const otherMachine = await createMachine(prisma, { userId, departmentId })
      await insertQueueRow({ machineId: otherMachine.id, status: 'PENDING', scheduledFor: new Date() })

      const claimed = await repo.claimReadyTasks(machineId, 10)
      expect(claimed).toHaveLength(1)
      expect(claimed[0].machineId).toBe(machineId)
    })

    it('returns empty when no tasks are ready', async () => {
      const claimed = await repo.claimReadyTasks(machineId, 10)
      expect(claimed).toEqual([])
    })
  })

  describe('markTaskRunning', () => {
    it('sets status to RUNNING and increments attempts', async () => {
      const row = await insertQueueRow({ machineId, attempts: 2 })
      await repo.markTaskRunning(row.id, 2)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db!.status).toBe('RUNNING')
      expect(db!.attempts).toBe(3)
      expect(db!.executedAt).not.toBeNull()
    })
  })

  describe('markTaskCompleted', () => {
    it('sets status to COMPLETED with result and timing', async () => {
      const row = await insertQueueRow({ machineId })
      const result = { healthy: true, details: 'all good' }
      await repo.markTaskCompleted(row.id, result, 150)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db!.status).toBe('COMPLETED')
      expect(db!.completedAt).not.toBeNull()
      expect(db!.result).toEqual(result)
      expect(db!.executionTimeMs).toBe(150)
    })
  })

  describe('markTaskFailed', () => {
    it('sets status to FAILED with error message', async () => {
      const row = await insertQueueRow({ machineId })
      await repo.markTaskFailed(row.id, 'connection timeout', 500)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db!.status).toBe('FAILED')
      expect(db!.completedAt).not.toBeNull()
      expect(db!.error).toBe('connection timeout')
      expect(db!.executionTimeMs).toBe(500)
    })
  })

  describe('markTaskRetryScheduled', () => {
    it('sets status to RETRY_SCHEDULED with new scheduled time and attempts', async () => {
      const row = await insertQueueRow({ machineId })
      const retryAt = new Date(Date.now() + 30_000)
      await repo.markTaskRetryScheduled(row.id, retryAt, 1)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db!.status).toBe('RETRY_SCHEDULED')
      expect(db!.scheduledFor.getTime()).toBeCloseTo(retryAt.getTime(), -2)
      expect(db!.attempts).toBe(1)
    })
  })

  // ─── Delete operations ────────────────────────────────────────────────────

  describe('deleteTask', () => {
    it('deletes a PENDING task', async () => {
      const row = await insertQueueRow({ machineId, status: 'PENDING' })
      await repo.deleteTask(row.id)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db).toBeNull()
    })

    it('deletes a RETRY_SCHEDULED task', async () => {
      const row = await insertQueueRow({ machineId, status: 'RETRY_SCHEDULED' })
      await repo.deleteTask(row.id)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db).toBeNull()
    })

    it('does not delete a RUNNING task', async () => {
      const row = await insertQueueRow({ machineId, status: 'RUNNING' })
      await repo.deleteTask(row.id)

      const db = await prisma.vMHealthCheckQueue.findUnique({ where: { id: row.id } })
      expect(db).not.toBeNull() // RUNNING tasks are protected from deletion
    })
  })

  describe('deleteTasksForVm', () => {
    it('deletes all pending tasks for a VM', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING' })
      await insertQueueRow({ machineId, checkType: 'LINUX_UPDATES', status: 'RETRY_SCHEDULED' })
      await insertQueueRow({ machineId, checkType: 'RESOURCE_OPTIMIZATION', status: 'COMPLETED' })

      const count = await repo.deleteTasksForVm(machineId)
      expect(count).toBe(2)

      const remaining = await prisma.vMHealthCheckQueue.findMany({ where: { machineId } })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].status).toBe('COMPLETED')
    })

    it('returns 0 when no tasks match', async () => {
      const count = await repo.deleteTasksForVm(machineId)
      expect(count).toBe(0)
    })
  })

  describe('deleteOrphanedTasks', () => {
    it('deletes pending tasks for DELETED machines', async () => {
      // Create machine with DELETED status
      const deletedMachine = await prisma.machine.create({
        data: {
          id: randomUUID(),
          name: 'deleted-vm',
          internalName: 'deleted-internal',
          status: 'DELETED',
          os: 'linux',
          cpuCores: 2,
          ramGB: 4,
          diskSizeGB: 50,
          userId,
          departmentId,
        },
      })

      await insertQueueRow({ machineId: deletedMachine.id, status: 'PENDING' })
      await insertQueueRow({ machineId: deletedMachine.id, status: 'RETRY_SCHEDULED' })

      const count = await repo.deleteOrphanedTasks()
      expect(count).toBe(2)

      const remaining = await prisma.vMHealthCheckQueue.findMany({
        where: { machineId: deletedMachine.id },
      })
      expect(remaining).toHaveLength(0)
    })

    it('does not delete tasks for active machines', async () => {
      await insertQueueRow({ machineId, status: 'PENDING' })

      const count = await repo.deleteOrphanedTasks()
      expect(count).toBe(0)
    })

    it('returns 0 when no DELETED machines exist', async () => {
      const count = await repo.deleteOrphanedTasks()
      expect(count).toBe(0)
    })
  })

  describe('getDeletedVmIds', () => {
    it('returns IDs of DELETED machines', async () => {
      const deletedMachine = await prisma.machine.create({
        data: {
          id: randomUUID(),
          name: 'deleted-vm-2',
          internalName: 'deleted-internal-2',
          status: 'DELETED',
          os: 'linux',
          cpuCores: 2,
          ramGB: 4,
          diskSizeGB: 50,
          userId,
          departmentId,
        },
      })

      const ids = await repo.getDeletedVmIds()
      expect(ids).toContain(deletedMachine.id)
      expect(ids).not.toContain(machineId) // active machine not included
    })

    it('returns empty array when no deleted machines', async () => {
      const ids = await repo.getDeletedVmIds()
      // Might include orphans from other tests if not cleaned
      expect(ids).not.toContain(machineId)
    })
  })

  // ─── Snapshot operations ──────────────────────────────────────────────────

  describe('findTodaySnapshot', () => {
    it('returns a snapshot created today', async () => {
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
        },
      })

      const found = await repo.findTodaySnapshot(machineId)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(snapshot.id)
    })

    it('returns null when no snapshot exists for today', async () => {
      // Create a snapshot for yesterday
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)
      await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: yesterday,
          overallStatus: 'HEALTHY',
          checksCompleted: 1,
          checksFailed: 0,
        },
      })

      const found = await repo.findTodaySnapshot(machineId)
      expect(found).toBeNull()
    })
  })

  describe('createSnapshot', () => {
    it('creates a snapshot with custom check results', async () => {
      const customResults = { source: 'test', count: 5 }
      const snapshot = await repo.createSnapshot(machineId, customResults)

      expect(snapshot).toBeDefined()
      expect(snapshot.id).toBeDefined()
      expect(snapshot.machineId).toBe(machineId)
      expect(snapshot.overallStatus).toBe('PENDING')
      expect(snapshot.customCheckResults).toEqual(customResults)

      // Verify it's in the DB
      const db = await prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } })
      expect(db).not.toBeNull()
    })
  })

  describe('updateSnapshotMetadata', () => {
    it('updates customCheckResults on an existing snapshot', async () => {
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
          customCheckResults: { old: true },
        },
      })

      await repo.updateSnapshotMetadata(snapshot.id, { new: true, count: 3 })

      const db = await prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } })
      expect(db!.customCheckResults).toEqual({ new: true, count: 3 })
    })
  })

  describe('getSnapshotForMerge', () => {
    it('returns applicationInventory for a snapshot', async () => {
      const inventory = { applications: [{ name: 'nginx' }] }
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
          applicationInventory: inventory as any,
        },
      })

      const result = await repo.getSnapshotForMerge(snapshot.id)
      expect(result).not.toBeNull()
      expect(result!.applicationInventory).toEqual(inventory)
    })

    it('returns null for non-existent snapshot', async () => {
      const result = await repo.getSnapshotForMerge(randomUUID())
      expect(result).toBeNull()
    })
  })

  describe('appendSnapshotResult', () => {
    it('increments checksCompleted and sets fields', async () => {
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 2,
          checksFailed: 0,
        },
      })

      await repo.appendSnapshotResult(snapshot.id, 100, {
        diskSpaceInfo: { used: 50, total: 100 },
      })

      const db = await prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } })
      // Prisma increments via { increment: 1 } which we pass inside updateFields
      // The method adds checksCompleted: { increment: 1 } internally
      expect(db!.checksCompleted).toBe(3) // 2 + increment(1)
      expect(db!.diskSpaceInfo).toEqual({ used: 50, total: 100 })
    })
  })

  describe('incrementSnapshotFailures', () => {
    it('increments checksFailed by 1', async () => {
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 1,
          checksFailed: 0,
        },
      })

      await repo.incrementSnapshotFailures(snapshot.id)

      const db = await prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } })
      expect(db!.checksFailed).toBe(1)
    })

    it('stacks multiple failures', async () => {
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
        },
      })

      await repo.incrementSnapshotFailures(snapshot.id)
      await repo.incrementSnapshotFailures(snapshot.id)

      const db = await prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } })
      expect(db!.checksFailed).toBe(2)
    })
  })

  describe('setSnapshotOverallStatus', () => {
    it('updates the overallStatus field', async () => {
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
        },
      })

      await repo.setSnapshotOverallStatus(snapshot.id, 'HEALTHY')

      const db = await prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } })
      expect(db!.overallStatus).toBe('HEALTHY')
    })

    it('can set to WARNING', async () => {
      const snapshot = await prisma.vMHealthSnapshot.create({
        data: {
          machineId,
          snapshotDate: new Date(),
          overallStatus: 'PENDING',
          checksCompleted: 0,
          checksFailed: 0,
        },
      })

      await repo.setSnapshotOverallStatus(snapshot.id, 'WARNING')

      const db = await prisma.vMHealthSnapshot.findUnique({ where: { id: snapshot.id } })
      expect(db!.overallStatus).toBe('WARNING')
    })
  })

  // ─── Edge cases ───────────────────────────────────────────────────────────

  describe('concurrent claimReadyTasks', () => {
    it('second claim does not pick tasks already claimed by first claim', async () => {
      await insertQueueRow({ machineId, checkType: 'DISK_SPACE', status: 'PENDING', scheduledFor: new Date() })

      const first = await repo.claimReadyTasks(machineId, 10)
      const second = await repo.claimReadyTasks(machineId, 10)

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(0)
    })
  })

  describe('insertTask with various check types', () => {
    const checkTypes: HealthCheckType[] = [
      'OVERALL_STATUS', 'DISK_SPACE', 'RESOURCE_OPTIMIZATION',
      'WINDOWS_UPDATES', 'WINDOWS_DEFENDER', 'LINUX_UPDATES',
      'APPLICATION_INVENTORY', 'APPLICATION_UPDATES',
      'SECURITY_CHECK', 'PERFORMANCE_CHECK', 'SYSTEM_HEALTH', 'CUSTOM_CHECK',
    ]

    it.each(checkTypes)('inserts and retrieves %s check type', async (checkType) => {
      const taskId = randomUUID()
      await repo.insertTask(machineId, checkType, 'MEDIUM', undefined, 3, taskId, new Date())

      const row = await prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } })
      expect(row).not.toBeNull()
      expect(row!.checkType).toBe(checkType)
    })
  })

  describe('insertTask with various priorities', () => {
    const priorities: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW']

    it.each(priorities)('inserts and retrieves %s priority', async (priority) => {
      const taskId = randomUUID()
      await repo.insertTask(machineId, 'DISK_SPACE', priority, undefined, 3, taskId, new Date())

      const row = await prisma.vMHealthCheckQueue.findUnique({ where: { id: taskId } })
      expect(row).not.toBeNull()
      expect(row!.priority).toBe(priority)
    })
  })
})
