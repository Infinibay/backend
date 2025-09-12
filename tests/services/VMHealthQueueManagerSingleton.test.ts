import { getVMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { mockPrisma } from '../setup/jest.setup'

describe('VMHealthQueueManager Singleton', () => {
  it('should return the same instance when called multiple times', () => {
    const mockEventManager = {
      dispatchEvent: jest.fn()
    } as any

    const instance1 = getVMHealthQueueManager(mockPrisma, mockEventManager)
    const instance2 = getVMHealthQueueManager(mockPrisma, mockEventManager)

    expect(instance1).toBe(instance2)
  })

  it('should have the required methods', () => {
    const mockEventManager = {
      dispatchEvent: jest.fn()
    } as any

    const instance = getVMHealthQueueManager(mockPrisma, mockEventManager)

    expect(typeof instance.queueHealthCheck).toBe('function')
    expect(typeof instance.processQueue).toBe('function')
    expect(typeof instance.getLastOverallScanTime).toBe('function')
    expect(typeof instance.loadPendingTasksForVm).toBe('function')
    expect(typeof instance.syncFromDatabase).toBe('function')
    expect(typeof instance.cleanupOrphanedTasks).toBe('function')
  })
})
