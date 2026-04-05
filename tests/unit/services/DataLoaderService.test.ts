import { PrismaClient } from '@prisma/client'
import { DataLoaderService } from '../../../app/services/vm/DataLoaderService'
import { createMockUser, createMockMachine, createMockDepartment, createMockMachineTemplate, createMockApplication, createMockProcessSnapshot, createMockSystemMetrics, createMockMachineConfiguration } from '../../setup/mock-factories'

// Create a mock PrismaClient for unit testing
function createMockPrisma () {
  return {
    user: {
      findMany: jest.fn().mockResolvedValue([])
    },
    machineTemplate: {
      findMany: jest.fn().mockResolvedValue([])
    },
    department: {
      findMany: jest.fn().mockResolvedValue([])
    },
    application: {
      findMany: jest.fn().mockResolvedValue([])
    },
    processSnapshot: {
      findMany: jest.fn().mockResolvedValue([])
    },
    systemMetrics: {
      findMany: jest.fn().mockResolvedValue([])
    },
    machineConfiguration: {
      findMany: jest.fn().mockResolvedValue([])
    },
    machine: {
      findMany: jest.fn().mockResolvedValue([])
    }
  } as unknown as PrismaClient
}

describe('DataLoaderService', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let dataLoaderService: DataLoaderService

  beforeEach(() => {
    prisma = createMockPrisma()
    dataLoaderService = new DataLoaderService(prisma as unknown as PrismaClient)
  })

  describe('Basic Service Setup', () => {
    it('should instantiate with Prisma client', () => {
      expect(dataLoaderService).toBeDefined()
      expect(dataLoaderService).toHaveProperty('loadUser')
      expect(dataLoaderService).toHaveProperty('loadTemplate')
      expect(dataLoaderService).toHaveProperty('loadDepartment')
      expect(dataLoaderService).toHaveProperty('loadApplication')
      expect(dataLoaderService).toHaveProperty('loadProcessSnapshot')
      expect(dataLoaderService).toHaveProperty('loadSystemMetrics')
      expect(dataLoaderService).toHaveProperty('loadMachineConfiguration')
      expect(dataLoaderService).toHaveProperty('loadMachine')
      expect(dataLoaderService).toHaveProperty('clearAll')
      expect(dataLoaderService).toHaveProperty('clear')
    })
  })

  describe('DataLoaders initialization', () => {
    it('should initialize all data loaders', () => {
      const service = dataLoaderService as any
      expect(service.userLoader).toBeDefined()
      expect(service.templateLoader).toBeDefined()
      expect(service.departmentLoader).toBeDefined()
      expect(service.applicationLoader).toBeDefined()
      expect(service.processSnapshotLoader).toBeDefined()
      expect(service.systemMetricsLoader).toBeDefined()
      expect(service.machineConfigurationLoader).toBeDefined()
      expect(service.machineLoader).toBeDefined()
    })
  })

  describe('loadUser', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadUser(null)
      expect(result).toBeNull()
    })

    it('should return null when id is undefined', async () => {
      const result = await dataLoaderService.loadUser(undefined as any)
      expect(result).toBeNull()
    })

    it('should return user when valid id is provided', async () => {
      const testUser = createMockUser({ id: 'user-1' })
      ;(prisma as any).user.findMany.mockResolvedValue([testUser])

      const result = await dataLoaderService.loadUser('user-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('user-1')
      expect(result!.email).toBe(testUser.email)
    })

    it('should return null when user does not exist', async () => {
      ;(prisma as any).user.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadUser('non-existent-id')
      expect(result).toBeNull()
    })

    it('should cache subsequent loads of the same id', async () => {
      const testUser = createMockUser({ id: 'user-cache' })
      ;(prisma as any).user.findMany.mockResolvedValue([testUser])

      const result1 = await dataLoaderService.loadUser('user-cache')
      const result2 = await dataLoaderService.loadUser('user-cache')

      expect(result1!.id).toBe(result2!.id)
      // DataLoader should batch and cache, so findMany called only once
      expect((prisma as any).user.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('loadTemplate', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadTemplate(null)
      expect(result).toBeNull()
    })

    it('should return machine template when valid id is provided', async () => {
      const testTemplate = createMockMachineTemplate({ id: 'template-1', name: 'Test Template' })
      ;(prisma as any).machineTemplate.findMany.mockResolvedValue([testTemplate])

      const result = await dataLoaderService.loadTemplate('template-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('template-1')
      expect(result!.name).toBe('Test Template')
    })

    it('should return null when template does not exist', async () => {
      ;(prisma as any).machineTemplate.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadTemplate('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('loadDepartment', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadDepartment(null)
      expect(result).toBeNull()
    })

    it('should return department when valid id is provided', async () => {
      const testDepartment = createMockDepartment({ id: 'dept-1', name: 'Test Department' })
      ;(prisma as any).department.findMany.mockResolvedValue([testDepartment])

      const result = await dataLoaderService.loadDepartment('dept-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('dept-1')
      expect(result!.name).toBe('Test Department')
    })

    it('should return null when department does not exist', async () => {
      ;(prisma as any).department.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadDepartment('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('loadApplication', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadApplication(null)
      expect(result).toBeNull()
    })

    it('should return application when valid id is provided', async () => {
      const testApp = createMockApplication({ id: 'app-1', name: 'Test App' })
      ;(prisma as any).application.findMany.mockResolvedValue([testApp])

      const result = await dataLoaderService.loadApplication('app-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('app-1')
      expect(result!.name).toBe('Test App')
    })

    it('should return null when application does not exist', async () => {
      ;(prisma as any).application.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadApplication('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('loadProcessSnapshot', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadProcessSnapshot(null)
      expect(result).toBeNull()
    })

    it('should return process snapshot when valid id is provided', async () => {
      const testSnapshot = createMockProcessSnapshot({ id: 'snap-1', machineId: 'vm-1' })
      ;(prisma as any).processSnapshot.findMany.mockResolvedValue([testSnapshot])

      const result = await dataLoaderService.loadProcessSnapshot('snap-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('snap-1')
      expect(result!.machineId).toBe('vm-1')
    })

    it('should return null when process snapshot does not exist', async () => {
      ;(prisma as any).processSnapshot.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadProcessSnapshot('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('loadSystemMetrics', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadSystemMetrics(null)
      expect(result).toBeNull()
    })

    it('should return system metrics when valid id is provided', async () => {
      const testMetrics = createMockSystemMetrics({ id: 'metrics-1', cpuUsagePercent: 50.5 })
      ;(prisma as any).systemMetrics.findMany.mockResolvedValue([testMetrics])

      const result = await dataLoaderService.loadSystemMetrics('metrics-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('metrics-1')
      expect(result!.cpuUsagePercent).toBe(50.5)
    })

    it('should return null when system metrics does not exist', async () => {
      ;(prisma as any).systemMetrics.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadSystemMetrics('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('loadMachineConfiguration', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadMachineConfiguration(null)
      expect(result).toBeNull()
    })

    it('should return machine configuration when valid id is provided', async () => {
      const testConfig = createMockMachineConfiguration({ id: 'config-1', bridge: 'br-test' })
      ;(prisma as any).machineConfiguration.findMany.mockResolvedValue([testConfig])

      const result = await dataLoaderService.loadMachineConfiguration('config-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('config-1')
      expect(result!.bridge).toBe('br-test')
    })

    it('should return null when machine configuration does not exist', async () => {
      ;(prisma as any).machineConfiguration.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadMachineConfiguration('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('loadMachine', () => {
    it('should return null when id is null', async () => {
      const result = await dataLoaderService.loadMachine(null)
      expect(result).toBeNull()
    })

    it('should return machine when valid id is provided', async () => {
      const testMachine = createMockMachine({ id: 'vm-1', name: 'Test VM', departmentId: 'dept-1' })
      ;(prisma as any).machine.findMany.mockResolvedValue([testMachine])

      const result = await dataLoaderService.loadMachine('vm-1')

      expect(result).not.toBeNull()
      expect(result!.id).toBe('vm-1')
      expect(result!.name).toBe('Test VM')
      expect(result!.departmentId).toBe('dept-1')
    })

    it('should return null when machine does not exist', async () => {
      ;(prisma as any).machine.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadMachine('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('clearAll', () => {
    it('should clear all loaders without error', () => {
      expect(() => dataLoaderService.clearAll()).not.toThrow()
    })

    it('should allow reloading after clear', async () => {
      const testUser = createMockUser({ id: 'user-1' })
      ;(prisma as any).user.findMany.mockResolvedValue([testUser])

      await dataLoaderService.loadUser('user-1')
      dataLoaderService.clearAll()

      const result = await dataLoaderService.loadUser('user-1')
      expect(result).not.toBeNull()
      // After clear, findMany is called again
      expect((prisma as any).user.findMany).toHaveBeenCalledTimes(2)
    })
  })

  describe('clear', () => {
    it('should clear specific loader by name - user', () => {
      expect(() => dataLoaderService.clear('user')).not.toThrow()
    })

    it('should clear specific loader by name - template', () => {
      expect(() => dataLoaderService.clear('template')).not.toThrow()
    })

    it('should clear specific loader by name - department', () => {
      expect(() => dataLoaderService.clear('department')).not.toThrow()
    })

    it('should clear specific loader by name - application', () => {
      expect(() => dataLoaderService.clear('application')).not.toThrow()
    })

    it('should clear specific loader by name - processSnapshot', () => {
      expect(() => dataLoaderService.clear('processSnapshot')).not.toThrow()
    })

    it('should clear specific loader by name - systemMetrics', () => {
      expect(() => dataLoaderService.clear('systemMetrics')).not.toThrow()
    })

    it('should clear specific loader by name - machineConfiguration', () => {
      expect(() => dataLoaderService.clear('machineConfiguration')).not.toThrow()
    })

    it('should clear specific loader by name - machine', () => {
      expect(() => dataLoaderService.clear('machine')).not.toThrow()
    })
  })

  describe('DataLoader batching behavior', () => {
    it('should batch multiple user loads efficiently', async () => {
      const users = [
        createMockUser({ id: 'user-1' }),
        createMockUser({ id: 'user-2' }),
        createMockUser({ id: 'user-3' })
      ]
      ;(prisma as any).user.findMany.mockResolvedValue(users)

      const [user1, user2, user3] = await Promise.all([
        dataLoaderService.loadUser('user-1'),
        dataLoaderService.loadUser('user-2'),
        dataLoaderService.loadUser('user-3')
      ])

      expect(user1).not.toBeNull()
      expect(user2).not.toBeNull()
      expect(user3).not.toBeNull()
      expect(user1!.id).toBe('user-1')
      expect(user2!.id).toBe('user-2')
      expect(user3!.id).toBe('user-3')
      // DataLoader should batch into a single query
      expect((prisma as any).user.findMany).toHaveBeenCalledTimes(1)
    })

    it('should handle null values in batch loads', async () => {
      ;(prisma as any).user.findMany.mockResolvedValue([])

      const [result1, result2] = await Promise.all([
        dataLoaderService.loadUser('non-existent-id-1'),
        dataLoaderService.loadUser('non-existent-id-2')
      ])

      expect(result1).toBeNull()
      expect(result2).toBeNull()
    })
  })

  describe('Integration - Loading related entities', () => {
    it('should allow loading machine and department in same tick', async () => {
      const testDepartment = createMockDepartment({ id: 'dept-1', name: 'Test Department' })
      const testMachine = createMockMachine({ id: 'vm-1', departmentId: 'dept-1' })

      ;(prisma as any).machine.findMany.mockResolvedValue([testMachine])
      ;(prisma as any).department.findMany.mockResolvedValue([testDepartment])

      const [machine, department] = await Promise.all([
        dataLoaderService.loadMachine('vm-1'),
        dataLoaderService.loadDepartment('dept-1')
      ])

      expect(machine).not.toBeNull()
      expect(department).not.toBeNull()
      expect(machine!.id).toBe('vm-1')
      expect(machine!.departmentId).toBe('dept-1')
      expect(department!.id).toBe('dept-1')
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string id', async () => {
      const result = await dataLoaderService.loadUser('')
      // Empty string is falsy, so loadUser returns null without calling DataLoader
      expect(result).toBeNull()
    })

    it('should handle whitespace-only id', async () => {
      ;(prisma as any).user.findMany.mockResolvedValue([])

      const result = await dataLoaderService.loadUser('   ')
      expect(result).toBeNull()
    })

    it('should handle UUID format strings', async () => {
      const testUser = createMockUser({ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
      ;(prisma as any).user.findMany.mockResolvedValue([testUser])

      const result = await dataLoaderService.loadUser('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
      expect(result?.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890')
    })
  })
})
