import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { PrismaClient, MaintenanceTaskType, MaintenanceStatus, MaintenanceTrigger } from '@prisma/client'
import { MaintenanceService, MaintenanceTaskConfig } from '../../../app/services/MaintenanceService'
import { VirtioSocketWatcherService, getVirtioSocketWatcherService } from '../../../app/services/VirtioSocketWatcherService'

jest.mock('../../../app/services/VirtioSocketWatcherService')

jest.mock('@utils/cronParser', () => ({
  CronParser: {
    getNextRunTime: jest.fn(() => new Date('2025-12-31T23:59:59Z'))
  }
}))

describe('MaintenanceService', () => {
  let service: MaintenanceService
  let mockPrisma: jest.Mocked<PrismaClient>
  let mockVirtioService: jest.Mocked<VirtioSocketWatcherService>
  const testVMId = 'vm-test-123'
  const testUserId = 'user-456'

  const validConfig: MaintenanceTaskConfig = {
    vmId: testVMId,
    taskType: MaintenanceTaskType.DISK_CLEANUP,
    name: 'Test Cleanup',
    description: 'Test maintenance task',
    isRecurring: false,
    runAt: new Date(),
    parameters: { drive: 'C:' },
    userId: testUserId
  }

  beforeEach(() => {
    jest.clearAllMocks()

    const maintenanceTaskMock: any = {
      create: jest.fn(),
      update: jest.fn().mockImplementation(async (args: any) => {
        // Return the last findUnique result merged with update data
        const lastResult = maintenanceTaskMock.findUnique.mock.results?.[
          maintenanceTaskMock.findUnique.mock.results.length - 1
        ]?.value
        const resolved = lastResult instanceof Promise ? await lastResult : lastResult
        return resolved ? { ...resolved, ...args?.data } : null
      }),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      // Idempotent fallback lock-release in executeTask's finally block.
      updateMany: jest.fn(async () => ({ count: 1 }))
    }

    mockPrisma = {
      machine: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn()
      },
      maintenanceTask: maintenanceTaskMock,
      maintenanceHistory: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn()
      },
      $transaction: jest.fn().mockImplementation(async (fn: any) => {
        if (typeof fn === 'function') {
          // Pass a transaction proxy that has the same methods
          return fn({
            maintenanceTask: maintenanceTaskMock,
            machine: mockPrisma.machine
          })
        }
        return fn
      })
    } as unknown as jest.Mocked<PrismaClient>

    mockVirtioService = {
      isVmConnected: jest.fn(),
      sendUnsafeCommand: jest.fn()
    } as unknown as jest.Mocked<VirtioSocketWatcherService>

    jest.mocked(getVirtioSocketWatcherService).mockReturnValue(mockVirtioService)
    service = new MaintenanceService(mockPrisma)
  })

  describe('scheduleTask', () => {
    it('should successfully schedule a maintenance task', async () => {
      const mockMachine = { id: testVMId, name: 'Test VM', os: 'windows', status: 'running' } as any
      const mockTask = {
        id: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        name: 'Test Cleanup',
        description: 'Test maintenance task',
        createdAt: new Date(),
        updatedAt: new Date(),
        isEnabled: true,
        isRecurring: false,
        cronSchedule: null,
        runAt: new Date(),
        nextRunAt: null,
        lastRunAt: null,
        parameters: { drive: 'C:' },
        createdByUserId: testUserId,
        executionStatus: 'IDLE',
        machine: mockMachine,
        createdBy: { id: testUserId, email: 'test@example.com' }
      }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine)
      jest.spyOn(mockPrisma.maintenanceTask, 'create').mockResolvedValue(mockTask as any)

      const result = await service.scheduleTask(validConfig)

      expect(result).toEqual(expect.objectContaining({
        id: 'task-123',
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        machineId: testVMId
      }))
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: testVMId },
        include: { user: true }
      })
      expect(mockPrisma.maintenanceTask.create).toHaveBeenCalled()
    })

    it('should throw error when VM does not exist', async () => {
      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(null)

      await expect(service.scheduleTask(validConfig)).rejects.toThrow('Virtual machine not found')
      expect(mockPrisma.maintenanceTask.create).not.toHaveBeenCalled()
    })

    it('should handle recurring tasks with cron schedule', async () => {
      const recurringConfig = { ...validConfig, isRecurring: true, cronSchedule: '0 * * * *' }
      const mockMachine = { id: testVMId, name: 'Test VM', os: 'windows', status: 'running' } as any
      const mockTask = { 
        id: 'task-123', 
        ...recurringConfig, 
        createdAt: new Date(),
        updatedAt: new Date(),
        isEnabled: true,
        isRecurring: true,
        cronSchedule: '0 * * * *',
        nextRunAt: new Date('2025-12-31T23:59:59Z'),
        lastRunAt: null,
        parameters: null,
        createdByUserId: testUserId,
        executionStatus: 'IDLE',
        machine: mockMachine,
        createdBy: { id: testUserId, email: 'test@example.com' }
      }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine)
      jest.spyOn(mockPrisma.maintenanceTask, 'create').mockResolvedValue(mockTask as any)

      const result = await service.scheduleTask(recurringConfig)

      expect(result.nextRunAt).toEqual(new Date('2025-12-31T23:59:59Z'))
    })

    it('should handle one-time tasks without cron schedule', async () => {
      const oneTimeConfig = { ...validConfig, isRecurring: false, runAt: new Date('2025-06-01T10:00:00Z') }
      const mockMachine = { id: testVMId, name: 'Test', os: 'windows', status: 'running' } as any
      const mockTask = {
        id: 'task-456',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        name: oneTimeConfig.name,
        isRecurring: false,
        nextRunAt: oneTimeConfig.runAt,
        createdAt: new Date(),
        updatedAt: new Date()
      }

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine)
      jest.spyOn(mockPrisma.maintenanceTask, 'create').mockResolvedValue(mockTask as any)

      const result = await service.scheduleTask(oneTimeConfig)

      expect(result.nextRunAt).toBeInstanceOf(Date)
    })
  })

  describe('executeTask', () => {
    it('should execute a maintenance task successfully', async () => {
      const mockTask = {
        id: 'task-123',
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        machineId: testVMId,
        executionStatus: 'IDLE',
        isEnabled: true,
        createdByUserId: testUserId,
        parameters: { drive: 'C:' },
        machine: { id: testVMId, name: 'Test VM' } as any
      }

      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask as any)
      // The $transaction update needs to return the task with RUNNING status
      jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue({ ...mockTask, executionStatus: 'RUNNING' } as any)
      jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true as any)
      jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({
        success: true,
        stdout: 'Cleanup completed',
        exit_code: 0
      })
      jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.RUNNING,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)
      jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.SUCCESS,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        duration: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
        result: null,
        error: null
      } as any)
      jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue(mockTask as any)

      const result = await service.executeTask('task-123', MaintenanceTrigger.MANUAL)

      expect(result.success).toBe(true)
      expect(mockVirtioService.isVmConnected).toHaveBeenCalledWith(testVMId)
      expect(mockVirtioService.sendUnsafeCommand).toHaveBeenCalled()
    })

    it('should handle task execution failure', async () => {
      const mockTask = { 
        id: 'task-123', 
        taskType: MaintenanceTaskType.DISK_CLEANUP, 
        machineId: testVMId, 
        executionStatus: 'IDLE',
        isEnabled: true,
        createdByUserId: testUserId,
        parameters: { drive: 'C:' },
        machine: { id: testVMId, name: 'Test VM' } as any
      }

      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask as any)
      jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true as any)
      jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({
        success: false,
        stderr: 'Disk cleanup failed',
        exit_code: 1
      })
      jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.RUNNING,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)
      jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.FAILED,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        duration: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
        error: 'Disk cleanup failed'
      } as any)
      jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue({ ...mockTask, executionStatus: 'IDLE' } as any)

      const result = await service.executeTask('task-123', MaintenanceTrigger.MANUAL)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should throw error when task does not exist', async () => {
      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(null)

      await expect(service.executeTask('non-existent-task', MaintenanceTrigger.MANUAL)).rejects.toThrow('Maintenance task not found')
    })

    it('should handle command execution exceptions', async () => {
      const mockTask = { 
        id: 'task-123', 
        taskType: MaintenanceTaskType.DISK_CLEANUP, 
        machineId: testVMId, 
        executionStatus: 'IDLE',
        isEnabled: true,
        createdByUserId: testUserId,
        parameters: { drive: 'C:' },
        machine: { id: testVMId, name: 'Test VM' } as any
      }

      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask as any)
      jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true as any)
      jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockRejectedValue(new Error('Connection timeout'))

      jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.RUNNING,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)
      jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.FAILED,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        duration: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        error: 'Connection timeout'
      } as any)

      const result = await service.executeTask('task-123', MaintenanceTrigger.MANUAL)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should throw error when task is already running', async () => {
      const mockTask = { 
        id: 'task-123', 
        taskType: MaintenanceTaskType.DISK_CLEANUP, 
        machineId: testVMId, 
        executionStatus: 'RUNNING',
        isEnabled: true,
        createdByUserId: testUserId,
        parameters: { drive: 'C:' },
        machine: { id: testVMId, name: 'Test VM' } as any
      }

      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask as any)

      await expect(service.executeTask('task-123', MaintenanceTrigger.MANUAL)).rejects.toThrow('Task is already running in another instance')
    })

    it('should apply task-specific timeouts', async () => {
      const mockTask = { 
        id: 'task-123', 
        taskType: MaintenanceTaskType.DEFRAG, 
        machineId: testVMId, 
        executionStatus: 'IDLE',
        isEnabled: true,
        createdByUserId: testUserId,
        parameters: { drive: 'C:' },
        machine: { id: testVMId, name: 'Test VM' } as any
      }

      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask as any)
      jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true as any)
      jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({ success: true })
      jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DEFRAG,
        status: MaintenanceStatus.RUNNING,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)
      jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
        id: 'history-1',
        taskId: 'task-123',
        machineId: testVMId,
        taskType: MaintenanceTaskType.DEFRAG,
        status: MaintenanceStatus.SUCCESS,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        duration: 1000,
        createdAt: new Date(),
        updatedAt: new Date()
      } as any)

      await service.executeTask('task-123', MaintenanceTrigger.MANUAL)

      expect(mockVirtioService.sendUnsafeCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ timeout: 3600000 })
      )
    })

    it('should throw error when VM is not connected', async () => {
      const mockTask = { 
        id: 'task-123', 
        taskType: MaintenanceTaskType.DISK_CLEANUP, 
        machineId: testVMId, 
        executionStatus: 'IDLE',
        isEnabled: true,
        createdByUserId: testUserId,
        parameters: { drive: 'C:' },
        machine: { id: testVMId, name: 'Test VM' } as any
      }

      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask as any)
      jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(false as any)

      await expect(service.executeTask('task-123', MaintenanceTrigger.MANUAL)).rejects.toThrow('VM is not connected or powered off')
    })
  })

  describe('executeImmediate', () => {
    it('should execute immediate maintenance successfully', async () => {
      const mockMachine = { id: testVMId, name: 'Test VM', os: 'windows' } as any

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as any)
      jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(true as any)
      jest.spyOn(mockVirtioService, 'sendUnsafeCommand').mockResolvedValue({ success: true })
      jest.spyOn(mockPrisma.maintenanceHistory, 'create').mockResolvedValue({
        id: 'history-1',
        taskId: null,
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.RUNNING,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        error: null,
        result: null,
        duration: 0
      } as any)
      jest.spyOn(mockPrisma.maintenanceHistory, 'update').mockResolvedValue({
        id: 'history-1',
        taskId: null,
        machineId: testVMId,
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        status: MaintenanceStatus.SUCCESS,
        triggeredBy: MaintenanceTrigger.MANUAL,
        executedByUserId: testUserId,
        executedAt: new Date(),
        duration: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
        error: null,
        result: null
      } as any)

      const result = await service.executeImmediate(
        testVMId,
        MaintenanceTaskType.DISK_CLEANUP,
        {},
        testUserId
      )

      expect(result.success).toBe(true)
      expect(mockVirtioService.isVmConnected).toHaveBeenCalledWith(testVMId)
      expect(mockVirtioService.sendUnsafeCommand).toHaveBeenCalled()
    })

    it('should throw error when VM does not exist', async () => {
      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(null)

      await expect(service.executeImmediate(
        testVMId,
        MaintenanceTaskType.DISK_CLEANUP,
        {},
        testUserId
      )).rejects.toThrow('Virtual machine not found')
    })

    it('should throw error when VM is not connected', async () => {
      const mockMachine = { id: testVMId, name: 'Test VM' } as any

      jest.spyOn(mockPrisma.machine, 'findUnique').mockResolvedValue(mockMachine as any)
      jest.spyOn(mockVirtioService, 'isVmConnected').mockReturnValue(false as any)

      await expect(service.executeImmediate(
        testVMId,
        MaintenanceTaskType.DISK_CLEANUP,
        {},
        testUserId
      )).rejects.toThrow('VM is not connected or powered off')
    })
  })


  describe('getTasksForVM', () => {
    it('should retrieve all maintenance tasks for a VM', async () => {
      const mockTasks = [
        { id: 'task-1', taskType: MaintenanceTaskType.DISK_CLEANUP, executionStatus: 'IDLE' },
        { id: 'task-2', taskType: MaintenanceTaskType.DEFRAG, executionStatus: 'RUNNING' }
      ]

      jest.spyOn(mockPrisma.maintenanceTask, 'findMany').mockResolvedValue(mockTasks as any)

      const result = await service.getTasksForVM(testVMId)

      expect(result).toEqual(mockTasks)
      expect(mockPrisma.maintenanceTask.findMany).toHaveBeenCalledWith({
        where: { machineId: testVMId },
        include: { machine: true, createdBy: true, _count: { select: { history: true } } },
        orderBy: { createdAt: 'desc' }
      })
    })

    it('should filter tasks by enabled status', async () => {
      jest.spyOn(mockPrisma.maintenanceTask, 'findMany').mockResolvedValue([] as any)

      await service.getTasksForVM(testVMId, 'enabled')

      expect(mockPrisma.maintenanceTask.findMany).toHaveBeenCalledWith({
        where: { machineId: testVMId, isEnabled: true },
        include: { machine: true, createdBy: true, _count: { select: { history: true } } },
        orderBy: { createdAt: 'desc' }
      })
    })
  })

  describe('getDueTasks', () => {
    it('should retrieve tasks due for execution', async () => {
      const mockTasks = [
        { id: 'task-1', taskType: MaintenanceTaskType.DISK_CLEANUP, executionStatus: 'IDLE' }
      ]

      jest.spyOn(mockPrisma.maintenanceTask, 'findMany').mockResolvedValue(mockTasks as any)

      const result = await service.getDueTasks()

      expect(result).toEqual(mockTasks)
      expect(mockPrisma.maintenanceTask.findMany).toHaveBeenCalled()
    })
  })

  describe('validateTaskParameters', () => {
    it('should validate DISK_CLEANUP parameters', () => {
      const validParams = { drive: 'C:' }
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.DISK_CLEANUP, validParams as any)).not.toThrow()
    })

    it('should validate DEFRAG parameters', () => {
      const validParams = { drive: 'C:' }
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.DEFRAG, validParams as any)).not.toThrow()
    })

    it('should validate DEFENDER_SCAN parameters', () => {
      const validParams = { scanType: 'quick' }
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.DEFENDER_SCAN, validParams as any)).not.toThrow()
    })

    it('should validate CUSTOM_SCRIPT parameters', () => {
      const validParams = { script: 'Get-Service' }
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.CUSTOM_SCRIPT, validParams as any)).not.toThrow()
    })

    it('should throw for invalid drive parameter', () => {
      const invalidParams = { drive: 123 }
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.DISK_CLEANUP, invalidParams as any)).toThrow('Drive must be a single drive letter followed by a colon')
    })

    it('should throw for missing script in CUSTOM_SCRIPT', () => {
      const invalidParams = {}
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.CUSTOM_SCRIPT, invalidParams as any)).toThrow('Script parameter is required')
    })

    it('should throw for invalid timeout', () => {
      const invalidParams = { timeoutMs: 500 }
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.DISK_CLEANUP, invalidParams as any)).toThrow('Timeout must be a number between 1000 and 3600000ms')
    })

    it('should accept valid timeout', () => {
      const validParams = { timeoutMs: 300000 }
      expect(() => service['validateTaskParameters'](MaintenanceTaskType.DISK_CLEANUP, validParams as any)).not.toThrow()
    })
  })

  describe('updateTask', () => {
    it('should update task configuration', async () => {
      const mockTask = {
        id: 'task-123',
        name: 'Old Name',
        taskType: MaintenanceTaskType.DISK_CLEANUP,
        isRecurring: false,
        cronSchedule: null,
        nextRunAt: null,
        parameters: null,
        machine: { id: testVMId, name: 'Test VM' } as any,
        createdBy: { id: testUserId, email: 'test@example.com' } as any
      }

      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(mockTask as any)
      jest.spyOn(mockPrisma.maintenanceTask, 'update').mockResolvedValue({
        ...mockTask,
        name: 'New Name',
        nextRunAt: null
      } as any)

      const result = await service.updateTask('task-123', { name: 'New Name' })

      expect(result.name).toBe('New Name')
      expect(mockPrisma.maintenanceTask.update).toHaveBeenCalled()
    })

    it('should throw error when task does not exist', async () => {
      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(null)

      await expect(service.updateTask('non-existent', { name: 'Test' })).rejects.toThrow('Maintenance task not found')
    })
  })

  describe('deleteTask', () => {
    it('should delete a maintenance task', async () => {
      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue({ id: 'task-123' } as any)
      jest.spyOn(mockPrisma.maintenanceTask, 'delete').mockResolvedValue({ id: 'task-123' } as any)

      const result = await service.deleteTask('task-123')

      expect(result.id).toBe('task-123')
      expect(mockPrisma.maintenanceTask.delete).toHaveBeenCalledWith({ where: { id: 'task-123' } })
    })

    it('should throw error when task does not exist', async () => {
      jest.spyOn(mockPrisma.maintenanceTask, 'findUnique').mockResolvedValue(null)

      await expect(service.deleteTask('non-existent')).rejects.toThrow('Maintenance task not found')
    })
  })

  describe('getTaskHistory', () => {
    it('should retrieve execution history for a VM', async () => {
      const mockHistory = [
        { id: 'history-1', taskType: MaintenanceTaskType.DISK_CLEANUP, status: MaintenanceStatus.SUCCESS }
      ]

      jest.spyOn(mockPrisma.maintenanceHistory, 'findMany').mockResolvedValue(mockHistory as any)

      const result = await service.getTaskHistory(testVMId, 10, 0)

      expect(result).toEqual(mockHistory)
      expect(mockPrisma.maintenanceHistory.findMany).toHaveBeenCalledWith({
        where: { machineId: testVMId },
        include: { task: true, machine: true, executedBy: true },
        orderBy: { executedAt: 'desc' },
        take: 10,
        skip: 0
      })
    })
  })
})
