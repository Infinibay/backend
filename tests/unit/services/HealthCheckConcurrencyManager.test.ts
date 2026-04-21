import 'reflect-metadata'
import { describe, it, expect, beforeEach } from '@jest/globals'
import { HealthCheckConcurrencyManager, ConcurrencyLimits } from '../../../app/services/HealthCheckConcurrencyManager'
import { HealthCheckType } from '@prisma/client'

const { OVERALL_STATUS, DISK_SPACE, RESOURCE_OPTIMIZATION, WINDOWS_UPDATES, WINDOWS_DEFENDER, LINUX_UPDATES, APPLICATION_INVENTORY, APPLICATION_UPDATES, SECURITY_CHECK, PERFORMANCE_CHECK, SYSTEM_HEALTH, CUSTOM_CHECK } = HealthCheckType

describe('HealthCheckConcurrencyManager', () => {
  let manager: HealthCheckConcurrencyManager

  const defaultLimits: ConcurrencyLimits = {
    maxConcurrentPerVm: 2,
    maxHeavyChecksPerVm: 1,
    maxSystemWide: 50,
    heavyCheckTypes: ['OVERALL_STATUS', 'RESOURCE_OPTIMIZATION', 'WINDOWS_DEFENDER', 'WINDOWS_UPDATES', 'LINUX_UPDATES'],
  }

  beforeEach(() => {
    manager = new HealthCheckConcurrencyManager(defaultLimits)
  })

  describe('canExecute', () => {
    it('should allow execution when no checks are running', () => {
      const result = manager.canExecute('vm-1', 'OVERALL_STATUS')
      expect(result.allowed).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('should allow non-heavy checks when heavy limit is reached for a VM', () => {
      manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS')

      // Heavy check should be blocked
      const heavyResult = manager.canExecute('vm-1', 'RESOURCE_OPTIMIZATION')
      expect(heavyResult.allowed).toBe(false)
      expect(heavyResult.reason).toContain('heavy-check limit reached')

      // Non-heavy check should still be allowed
      const lightResult = manager.canExecute('vm-1', 'DISK_SPACE')
      expect(lightResult.allowed).toBe(true)
    })

    it('should block heavy checks when maxHeavyChecksPerVm is reached', () => {
      manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS')

      const result = manager.canExecute('vm-1', 'WINDOWS_DEFENDER')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('heavy-check limit reached')
    })

    it('should allow a second heavy check for a different VM', () => {
      manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS')

      const result = manager.canExecute('vm-2', 'RESOURCE_OPTIMIZATION')
      expect(result.allowed).toBe(true)
    })

    it('should block when maxConcurrentPerVm is reached', () => {
      manager.markRunning('task-1', 'vm-1', DISK_SPACE)
      manager.markRunning('task-2', 'vm-1', RESOURCE_OPTIMIZATION)
      const result = manager.canExecute('vm-1', DISK_SPACE)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('concurrent limit reached')
    })

    it('should allow checks for a different VM when one VM is at limit', () => {
      manager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      manager.markRunning('task-2', 'vm-1', DISK_SPACE)
      const result = manager.canExecute('vm-2', RESOURCE_OPTIMIZATION)
      expect(result.allowed).toBe(true)
    })

    it('should block when maxSystemWide is reached', () => {
      const customLimits: ConcurrencyLimits = {
        ...defaultLimits,
        maxSystemWide: 2,
      }
      const customManager = new HealthCheckConcurrencyManager(customLimits)

      customManager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      customManager.markRunning('task-2', 'vm-2', DISK_SPACE)
      const result = customManager.canExecute('vm-3', RESOURCE_OPTIMIZATION)
      expect(result.reason).toContain('System-wide concurrent limit reached')
    })

    it('should not count completed tasks toward limits', () => {
      manager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      manager.markDone('task-1', 'vm-1')

      const result = manager.canExecute('vm-1', DISK_SPACE)
      expect(result.allowed).toBe(true)
    })

    it('should handle mixed heavy and light checks correctly', () => {
      manager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS') // heavy

      // Should allow one more light check (maxConcurrentPerVm=2, 1 slot left)
      const result = manager.canExecute('vm-1', SECURITY_CHECK)
      expect(result.allowed).toBe(true)

      // But not another heavy check (maxHeavyChecksPerVm=1)
      const heavyResult = manager.canExecute('vm-1', RESOURCE_OPTIMIZATION)
      expect(heavyResult.allowed).toBe(false)
      expect(heavyResult.reason).toContain('heavy-check limit reached')
    })
  })

  describe('markRunning / markDone', () => {
    it('should track running tasks', () => {
      expect(manager.getActiveCount()).toBe(0)

      manager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      expect(manager.getActiveCount()).toBe(1)

      manager.markRunning('task-2', 'vm-1', DISK_SPACE)
      expect(manager.getActiveCount()).toBe(2)
    })

    it('should remove tasks when marked done', () => {
      manager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      manager.markRunning('task-2', 'vm-2', DISK_SPACE)
      expect(manager.getActiveCount()).toBe(2)

      manager.markDone('task-1', 'vm-1')
      expect(manager.getActiveCount()).toBe(1)

      manager.markDone('task-2', 'vm-2')
      expect(manager.getActiveCount()).toBe(0)
    })

    it('should not double-remove tasks', () => {
      manager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      manager.markDone('task-1', 'vm-1')
      manager.markDone('task-1', 'vm-1') // Should not throw

      expect(manager.getActiveCount()).toBe(0)
    })
  })

  describe('getVmActiveCount', () => {
    it('should return correct count per VM', () => {
      manager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      manager.markRunning('task-2', 'vm-1', DISK_SPACE)
      manager.markRunning('task-3', 'vm-2', SECURITY_CHECK)

      expect(manager.getVmActiveCount('vm-1')).toBe(2)
      expect(manager.getVmActiveCount('vm-2')).toBe(1)
      expect(manager.getVmActiveCount('vm-3')).toBe(0)
    })
  })

  describe('getActiveTaskIds', () => {
    it('should return all active task keys', () => {
      manager.markRunning('task-1', 'vm-1', 'DISK_SPACE')
      manager.markRunning('task-2', 'vm-2', DISK_SPACE)

      const taskIds = manager.getActiveTaskIds()
      expect(taskIds).toContain('vm-1_task-1')
      expect(taskIds).toContain('vm-2_task-2')
      expect(taskIds).toHaveLength(2)
    })

    it('should return empty array when no tasks are running', () => {
      const taskIds = manager.getActiveTaskIds()
      expect(taskIds).toEqual([])
    })
  })

  describe('custom limits', () => {
    it('should respect custom maxConcurrentPerVm', () => {
      const customLimits: ConcurrencyLimits = {
        ...defaultLimits,
        maxConcurrentPerVm: 1,
      }
      const customManager = new HealthCheckConcurrencyManager(customLimits)

      customManager.markRunning('task-1', 'vm-1', 'DISK_SPACE')

      const result = customManager.canExecute('vm-1', DISK_SPACE)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('concurrent limit reached')
    })

    it('should respect custom maxHeavyChecksPerVm', () => {
      const customLimits: ConcurrencyLimits = {
        ...defaultLimits,
        maxHeavyChecksPerVm: 0,
      }
      const customManager = new HealthCheckConcurrencyManager(customLimits)

      const result = customManager.canExecute('vm-1', 'OVERALL_STATUS')
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain('heavy-check limit reached')
    })

    it('should allow overriding heavyCheckTypes', () => {
      const customLimits: ConcurrencyLimits = {
        ...defaultLimits,
        heavyCheckTypes: ['OVERALL_STATUS'],
      }
      const customManager = new HealthCheckConcurrencyManager(customLimits)

      customManager.markRunning('task-1', 'vm-1', 'OVERALL_STATUS')

      // RESOURCE_OPTIMIZATION is no longer heavy
      const result = customManager.canExecute('vm-1', 'RESOURCE_OPTIMIZATION')
      expect(result.allowed).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('should handle empty machineId', () => {
      manager.markRunning('task-1', '', 'DISK_SPACE')
      expect(manager.getActiveCount()).toBe(1)
      expect(manager.getVmActiveCount('')).toBe(1)
    })

    it('should handle unknown check types', () => {
      const result = manager.canExecute('vm-1', 'UNKNOWN_CHECK' as HealthCheckType)
      expect(result.allowed).toBe(true)
    })

    it('should not count tasks for wrong machineId after markDone', () => {
      manager.markRunning('task-1', 'vm-1', DISK_SPACE)
      manager.markDone('task-1', 'vm-2') // Wrong machineId

      // Task should still be active because key doesn't match
      expect(manager.getActiveCount()).toBe(1)
      expect(manager.getVmActiveCount('vm-1')).toBe(1)
      expect(manager.getVmActiveCount('vm-2')).toBe(0)
    })
  })
})
