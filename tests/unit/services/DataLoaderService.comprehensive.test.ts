import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { DataLoaderService } from '../../../app/services/DataLoaderService'
import { PrismaClient, User, MachineTemplate, Department, Application, ProcessSnapshot, SystemMetrics, MachineConfiguration, Machine } from '@prisma/client'

describe('DataLoaderService', () => {
  let service: DataLoaderService
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockTables: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockTables = {
      user: { findMany: jest.fn() },
      machineTemplate: { findMany: jest.fn() },
      department: { findMany: jest.fn() },
      application: { findMany: jest.fn() },
      processSnapshot: { findMany: jest.fn() },
      systemMetrics: { findMany: jest.fn() },
      machineConfiguration: { findMany: jest.fn() },
      machine: { findMany: jest.fn() }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new DataLoaderService(mockTables as any)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('loadUser', () => {
    it('should load a user successfully', async () => {
      const mockUser: User = { id: 'user-1', name: 'Test User', email: 'test@example.com' } as any
      mockTables.user.findMany.mockResolvedValue([mockUser])

      const result = await service.loadUser('user-1')

      expect(result).toEqual(mockUser)
      expect(mockTables.user.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['user-1'] } }
      })
    })

    it('should return null for non-existent user', async () => {
      mockTables.user.findMany.mockResolvedValue([])

      const result = await service.loadUser('non-existent-id')

      expect(result).toBeNull()
    })

    it('should return null when id is null', async () => {
      const result = await service.loadUser(null)

      expect(result).toBeNull()
    })

    it('should return null when id is empty string', async () => {
      const result = await service.loadUser('')

      expect(result).toBeNull()
    })

    it('should handle user not found gracefully', async () => {
      const mockUser: User = { id: 'user-2', name: 'Other User', email: 'other@example.com' } as any
      mockTables.user.findMany.mockResolvedValue([mockUser])

      const result = await service.loadUser('user-1')

      expect(result).toBeNull()
    })
  })

  describe('loadTemplate', () => {
    it('should load a template successfully', async () => {
      const mockTemplate: MachineTemplate = { id: 'template-1', name: 'Test Template', cpu: 4, memory: 8192, createdAt: new Date(), updatedAt: new Date() } as any
      mockTables.machineTemplate.findMany.mockResolvedValue([mockTemplate])

      const result = await service.loadTemplate('template-1')

      expect(result).toEqual(mockTemplate)
    })

    it('should return null for non-existent template', async () => {
      mockTables.machineTemplate.findMany.mockResolvedValue([])

      const result = await service.loadTemplate('non-existent-id')

      expect(result).toBeNull()
    })

    it('should return null when id is null', async () => {
      const result = await service.loadTemplate(null)

      expect(result).toBeNull()
    })
  })

  describe('loadDepartment', () => {
    it('should load a department successfully', async () => {
      const mockDepartment: Department = { id: 'dept-1', name: 'IT Department', description: 'IT Department', bridgeName: 'br-test', firewallPolicyId: null, mtu: 1500, dnsServers: [], ntpServers: [], createdAt: new Date(), updatedAt: new Date(), firewallPolicy: null } as any
      mockTables.department.findMany.mockResolvedValue([mockDepartment])

      const result = await service.loadDepartment('dept-1')

      expect(result).toEqual(mockDepartment)
    })

    it('should return null for non-existent department', async () => {
      mockTables.department.findMany.mockResolvedValue([])

      const result = await service.loadDepartment('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('loadApplication', () => {
    it('should load an application successfully', async () => {
      const mockApplication: Application = { id: 'app-1', name: 'Test App', version: '1.0.0', createdAt: new Date(), updatedAt: new Date() } as any
      mockTables.application.findMany.mockResolvedValue([mockApplication])

      const result = await service.loadApplication('app-1')

      expect(result).toEqual(mockApplication)
    })

    it('should return null for non-existent application', async () => {
      mockTables.application.findMany.mockResolvedValue([])

      const result = await service.loadApplication('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('loadProcessSnapshot', () => {
    it('should load a process snapshot successfully', async () => {
      const mockSnapshot: ProcessSnapshot = { id: 'snapshot-1', status: 'completed', createdAt: new Date(), updatedAt: new Date(), machineId: 'test' } as any
      mockTables.processSnapshot.findMany.mockResolvedValue([mockSnapshot])

      const result = await service.loadProcessSnapshot('snapshot-1')

      expect(result).toEqual(mockSnapshot)
    })

    it('should return null for non-existent snapshot', async () => {
      mockTables.processSnapshot.findMany.mockResolvedValue([])

      const result = await service.loadProcessSnapshot('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('loadSystemMetrics', () => {
    it('should load system metrics successfully', async () => {
      const mockMetrics: SystemMetrics = { id: 'metrics-1', cpuUsage: 45, memoryUsage: 62, createdAt: new Date(), updatedAt: new Date() } as any
      mockTables.systemMetrics.findMany.mockResolvedValue([mockMetrics])

      const result = await service.loadSystemMetrics('metrics-1')

      expect(result).toEqual(mockMetrics)
    })

    it('should return null for non-existent metrics', async () => {
      mockTables.systemMetrics.findMany.mockResolvedValue([])

      const result = await service.loadSystemMetrics('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('loadMachineConfiguration', () => {
    it('should load a machine configuration successfully', async () => {
      const mockConfig: MachineConfiguration = { id: 'config-1', machineId: 'machine-1', bridge: 'br-test', tapDeviceName: 'tap1', networkInterfaceType: 'virtio', vhostNet: true, maxVirtioSockLinks: 6, createdAt: new Date(), updatedAt: new Date(), configuration: { cpu: 4, memory: 8192 } as any } as any
      mockTables.machineConfiguration.findMany.mockResolvedValue([mockConfig])

      const result = await service.loadMachineConfiguration('config-1')

      expect(result).toEqual(mockConfig)
    })

    it('should return null for non-existent configuration', async () => {
      mockTables.machineConfiguration.findMany.mockResolvedValue([])

      const result = await service.loadMachineConfiguration('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('loadMachine', () => {
    it('should load a machine successfully', async () => {
      const mockMachine: Machine = { id: 'machine-1', name: 'Test Machine', status: 'running', userId: 'user-1', createdAt: new Date(), updatedAt: new Date(), description: '', machineTemplateId: null, osId: null, deviceType: 'kvm', deviceModel: 'q35', machineType: 'pc', bios: 'ovmf', efi: false, bootDevice: 'disk', efiDiskPath: null, efiVarsPath: null, secureBoot: false, vnc: false, vncPassword: null, virtioSocketWatcherEnabled: false, qemuGuestAgentEnabled: false, qmpSocketPath: null, devicePath: null, qemudSockPath: null, vhostUserSocks: null, internalName: 'test', cpuCores: 4, ramGB: 8, diskSizeGB: 100, gpuPciAddress: null, departmentId: null, templateId: null, firewallTemplates: {} } as any
      mockTables.machine.findMany.mockResolvedValue([mockMachine])

      const result = await service.loadMachine('machine-1')

      expect(result).toEqual(mockMachine)
    })

    it('should return null for non-existent machine', async () => {
      mockTables.machine.findMany.mockResolvedValue([])

      const result = await service.loadMachine('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('clearAll', () => {
    it('should clear all loaders', () => {
      const mockClearAll = jest.fn()

      // Mock all loaders with clearAll method
      ;(service as any).userLoader.clearAll = mockClearAll
      ;(service as any).templateLoader.clearAll = mockClearAll
      ;(service as any).departmentLoader.clearAll = mockClearAll
      ;(service as any).applicationLoader.clearAll = mockClearAll
      ;(service as any).processSnapshotLoader.clearAll = mockClearAll
      ;(service as any).systemMetricsLoader.clearAll = mockClearAll
      ;(service as any).machineConfigurationLoader.clearAll = mockClearAll
      ;(service as any).machineLoader.clearAll = mockClearAll

      service.clearAll()

      expect(mockClearAll).toHaveBeenCalledTimes(8)
    })
  })

  describe('clear by loader name', () => {
    it('should clear user loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).userLoader.clearAll = mockClearAll

      service.clear('user')

      expect(mockClearAll).toHaveBeenCalled()
    })

    it('should clear template loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).templateLoader.clearAll = mockClearAll

      service.clear('template')

      expect(mockClearAll).toHaveBeenCalled()
    })

    it('should clear department loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).departmentLoader.clearAll = mockClearAll

      service.clear('department')

      expect(mockClearAll).toHaveBeenCalled()
    })

    it('should clear application loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).applicationLoader.clearAll = mockClearAll

      service.clear('application')

      expect(mockClearAll).toHaveBeenCalled()
    })

    it('should clear process snapshot loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).processSnapshotLoader.clearAll = mockClearAll

      service.clear('processSnapshot')

      expect(mockClearAll).toHaveBeenCalled()
    })

    it('should clear system metrics loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).systemMetricsLoader.clearAll = mockClearAll

      service.clear('systemMetrics')

      expect(mockClearAll).toHaveBeenCalled()
    })

    it('should clear machine configuration loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).machineConfigurationLoader.clearAll = mockClearAll

      service.clear('machineConfiguration')

      expect(mockClearAll).toHaveBeenCalled()
    })

    it('should clear machine loader by name', () => {
      const mockClearAll = jest.fn()
      ;(service as any).machineLoader.clearAll = mockClearAll

      service.clear('machine')

      expect(mockClearAll).toHaveBeenCalled()
    })
  })

  describe('null and edge case handling', () => {
    it('should handle all loader methods with null IDs', async () => {
      const nullId = null

      const userResult = await service.loadUser(nullId)
      const templateResult = await service.loadTemplate(nullId)
      const deptResult = await service.loadDepartment(nullId)
      const appResult = await service.loadApplication(nullId)
      const snapshotResult = await service.loadProcessSnapshot(nullId)
      const metricsResult = await service.loadSystemMetrics(nullId)
      const configResult = await service.loadMachineConfiguration(nullId)
      const machineResult = await service.loadMachine(nullId)

      expect(userResult).toBeNull()
      expect(templateResult).toBeNull()
      expect(deptResult).toBeNull()
      expect(appResult).toBeNull()
      expect(snapshotResult).toBeNull()
      expect(metricsResult).toBeNull()
      expect(configResult).toBeNull()
      expect(machineResult).toBeNull()
    })

    it('should handle all loader methods with empty string IDs', async () => {
      const emptyId = ''

      const userResult = await service.loadUser(emptyId)
      const templateResult = await service.loadTemplate(emptyId)

      expect(userResult).toBeNull()
      expect(templateResult).toBeNull()
    })

    it('should handle empty results from database gracefully', async () => {
      mockTables.user.findMany.mockResolvedValue([])

      const result = await service.loadUser('user-1')

      expect(result).toBeNull()
    })

    it('should handle database errors gracefully', async () => {
      const mockError = new Error('Database connection failed')
      mockTables.user.findMany.mockRejectedValue(mockError)

      await expect(service.loadUser('user-1')).rejects.toThrow('Database connection failed')
    })
  })

  describe('DataLoader batching behavior', () => {
    it('should batch multiple load requests efficiently', async () => {
      const mockUsers = [
        { id: 'user-1', name: 'User 1', email: 'user1@example.com' },
        { id: 'user-2', name: 'User 2', email: 'user2@example.com' },
        { id: 'user-3', name: 'User 3', email: 'user3@example.com' }
      ]
      mockTables.user.findMany.mockResolvedValue(mockUsers)

      // Load multiple users concurrently
      const [user1, user2, user3] = await Promise.all([
        service.loadUser('user-1'),
        service.loadUser('user-2'),
        service.loadUser('user-3')
      ])

      expect(user1).toEqual(mockUsers[0])
      expect(user2).toEqual(mockUsers[1])
      expect(user3).toEqual(mockUsers[2])

      // DataLoader should have batched these into a single query
      expect(mockTables.user.findMany).toHaveBeenCalledTimes(1)
    })
  })
})
