import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { FirewallService } from '../../../app/services/firewallService'
import { NetworkFilterService } from '../../../app/services/networkFilterService'
import { mockPrisma } from '../../setup/jest.setup'
import { KNOWN_SERVICES, getServiceById } from '../../../app/config/knownServices'
import { createMockFWRule } from '../../setup/mock-factories'
import type {
  VmServiceStatus,
  DepartmentServiceStatus,
  GlobalServiceStatus,
  DepartmentServiceDetailedStats
} from '../../../app/services/firewallService'
import type { Machine } from '@prisma/client'

// Mock dependencies
jest.mock('../../../app/services/networkFilterService')

// Helper to add timestamp fields
const withTimestamps = <T extends object>(obj: T): T & { createdAt: Date; updatedAt: Date } => ({
  ...obj,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01')
})

// Helper to create a mock VM with required fields
const createMockVm = (partial: {
  id: string
  name: string
  serviceConfigs?: Array<{ serviceId: string; useEnabled: boolean; provideEnabled: boolean }>
  ports?: Array<{ protocol: string; portStart: number; portEnd: number; running: boolean; enabled: boolean; toEnable: boolean }>
  department?: { id: string; name: string; serviceConfigs: Array<{ serviceId: string; useEnabled: boolean; provideEnabled: boolean }> } | null
}) => withTimestamps({
  id: partial.id,
  name: partial.name,
  internalName: partial.name.toLowerCase().replace(/\s/g, '-'),
  status: 'running',
  userId: 'user-123',
  templateId: null,
  os: 'ubuntu',
  cpuCores: 2,
  ram: 4096,
  ramGB: 4,
  diskSize: 20480,
  diskSizeGB: 20,
  pciBus: null,
  iso: null,
  gpuPciAddress: null,
  firewallTemplates: [],
  departmentId: partial.department?.id || null,
  serviceConfigs: partial.serviceConfigs || [],
  ports: partial.ports || [],
  department: partial.department || null
})

jest.mock('../../../app/config/knownServices', () => ({
  KNOWN_SERVICES: [
    {
      id: 'ssh',
      displayName: 'SSH',
      ports: [{ protocol: 'TCP', portStart: 22, portEnd: 22 }]
    },
    {
      id: 'http',
      displayName: 'HTTP',
      ports: [{ protocol: 'TCP', portStart: 80, portEnd: 80 }]
    },
    {
      id: 'https',
      displayName: 'HTTPS',
      ports: [{ protocol: 'TCP', portStart: 443, portEnd: 443 }]
    }
  ],
  getServiceById: jest.fn((id: string) => {
    const services = [
      {
        id: 'ssh',
        displayName: 'SSH',
        ports: [{ protocol: 'TCP', portStart: 22, portEnd: 22 }]
      },
      {
        id: 'http',
        displayName: 'HTTP',
        ports: [{ protocol: 'TCP', portStart: 80, portEnd: 80 }]
      },
      {
        id: 'https',
        displayName: 'HTTPS',
        ports: [{ protocol: 'TCP', portStart: 443, portEnd: 443 }]
      }
    ]
    return services.find(s => s.id === id)
  })
}))

describe('FirewallService', () => {
  let firewallService: FirewallService
  let mockNetworkFilterService: jest.Mocked<NetworkFilterService>

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock NetworkFilterService
    mockNetworkFilterService = {
      deduplicateRules: jest.fn(),
      applyServiceRules: jest.fn(),
      addRuleToFilter: jest.fn(),
      removeRuleFromFilter: jest.fn(),
      createRule: jest.fn(() => Promise.resolve({
        id: 'rule-1',
        filterId: 'filter-1',
        direction: 'out',
        action: 'accept',
        protocol: 'tcp',
        srcIpAddress: null,
        dstIpAddress: null,
        srcPort: null,
        dstPort: 80,
        priority: 100
      })),
      deleteRule: jest.fn(() => Promise.resolve({
        id: 'rule-1',
        filterId: 'filter-1'
      }))
    } as unknown as jest.Mocked<NetworkFilterService>

    const NetworkFilterServiceMock = (jest.requireMock('../../../app/services/networkFilterService') as { NetworkFilterService: jest.Mock }).NetworkFilterService
    NetworkFilterServiceMock.mockImplementation(() => mockNetworkFilterService)

    firewallService = new FirewallService(mockPrisma)
  })

  describe('getServices', () => {
    it('should return all known services', async () => {
      const services = await firewallService.getServices()

      expect(services).toEqual(KNOWN_SERVICES)
      expect(services).toHaveLength(3)
      expect(services[0]).toHaveProperty('id')
      expect(services[0]).toHaveProperty('displayName')
      expect(services[0]).toHaveProperty('ports')
    })
  })

  describe('getVmFilter', () => {
    it('should return VM filter when found', async () => {
      const mockVmFilter = withTimestamps({
        id: 'filter-1',
        vmId: 'vm-123',
        nwFilterId: 'nw-filter-1'
      })

      mockPrisma.vMNWFilter.findFirst.mockResolvedValue(mockVmFilter)

      const result = await firewallService.getVmFilter('vm-123')

      expect(mockPrisma.vMNWFilter.findFirst).toHaveBeenCalledWith({
        where: { vmId: 'vm-123' }
      })
      expect(result).toEqual(mockVmFilter)
    })

    it('should return null when VM filter not found', async () => {
      mockPrisma.vMNWFilter.findFirst.mockResolvedValue(null)

      const result = await firewallService.getVmFilter('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getDepartmentFilter', () => {
    it('should return department filter when found', async () => {
      const mockDeptFilter = withTimestamps({
        id: 'filter-1',
        departmentId: 'dept-123',
        nwFilterId: 'nw-filter-1'
      })

      mockPrisma.departmentNWFilter.findFirst.mockResolvedValue(mockDeptFilter)

      const result = await firewallService.getDepartmentFilter('dept-123')

      expect(mockPrisma.departmentNWFilter.findFirst).toHaveBeenCalledWith({
        where: { departmentId: 'dept-123' }
      })
      expect(result).toEqual(mockDeptFilter)
    })

    it('should return null when department filter not found', async () => {
      mockPrisma.departmentNWFilter.findFirst.mockResolvedValue(null)

      const result = await firewallService.getDepartmentFilter('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('getVmServiceStatus', () => {
    it('should return service status for all services when no serviceId provided', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM',
        serviceConfigs: [],
        ports: [
          {
            protocol: 'TCP',
            portStart: 22,
            portEnd: 22,
            running: true,
            enabled: true,
            toEnable: false
          }
        ],
        department: {
          id: 'dept-123',
          name: 'Test Dept',
          serviceConfigs: []
        }
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      const result = await firewallService.getVmServiceStatus('vm-123')

      expect(result).toHaveLength(3) // All 3 services
      expect(result[0]).toMatchObject({
        vmId: 'vm-123',
        vmName: 'Test VM',
        serviceId: 'ssh',
        serviceName: 'SSH',
        running: true
      })
    })

    it('should return service status for specific service when serviceId provided', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM',
        serviceConfigs: [
          {
            serviceId: 'ssh',
            useEnabled: true,
            provideEnabled: false
          }
        ],
        ports: [],
        department: null
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      const result = await firewallService.getVmServiceStatus('vm-123', 'ssh')

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        serviceId: 'ssh',
        useEnabled: true,
        provideEnabled: false,
        running: false
      })
    })

    it('should inherit department settings when VM has no config', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM',
        serviceConfigs: [],
        ports: [],
        department: {
          id: 'dept-123',
          name: 'Test Dept',
          serviceConfigs: [
            {
              serviceId: 'http',
              useEnabled: true,
              provideEnabled: true
            }
          ]
        }
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      const result = await firewallService.getVmServiceStatus('vm-123', 'http')

      expect(result[0]).toMatchObject({
        serviceId: 'http',
        useEnabled: true,
        provideEnabled: true
      })
    })

    it('should inherit global settings when no VM or department config', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM',
        serviceConfigs: [],
        ports: [],
        department: {
          id: 'dept-123',
          name: 'Test Dept',
          serviceConfigs: []
        }
      })

      const mockGlobalConfig = [
        withTimestamps({
          id: 'global-1',
          serviceId: 'https',
          useEnabled: false,
          provideEnabled: true
        })
      ]

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue(mockGlobalConfig)

      const result = await firewallService.getVmServiceStatus('vm-123', 'https')

      expect(result[0]).toMatchObject({
        serviceId: 'https',
        useEnabled: false,
        provideEnabled: true
      })
    })

    it('should throw error if VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(firewallService.getVmServiceStatus('non-existent'))
        .rejects.toThrow('VM with ID non-existent not found')
    })

    it('should detect running services based on ports', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM',
        serviceConfigs: [],
        ports: [
          {
            protocol: 'TCP',
            portStart: 80,
            portEnd: 80,
            running: true,
            enabled: true,
            toEnable: false
          },
          {
            protocol: 'TCP',
            portStart: 443,
            portEnd: 443,
            running: false,
            enabled: true,
            toEnable: false
          }
        ],
        department: null
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      const result = await firewallService.getVmServiceStatus('vm-123')

      const httpService = result.find(s => s.serviceId === 'http')
      const httpsService = result.find(s => s.serviceId === 'https')

      expect(httpService?.running).toBe(true)
      expect(httpsService?.running).toBe(false)
    })
  })

  describe('toggleVmService', () => {
    it('should toggle use permission for VM service', async () => {
      const mockVmConfig = withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'ssh',
        useEnabled: false,
        provideEnabled: false
      })

      const mockVmFilter = withTimestamps({
        id: 'filter-1',
        vmId: 'vm-123',
        nwFilterId: 'nw-filter-1'
      })

      mockPrisma.vMServiceConfig.findUnique.mockResolvedValue(null)
      mockPrisma.vMServiceConfig.create.mockResolvedValue(mockVmConfig)
      mockPrisma.vMServiceConfig.update.mockResolvedValue({
        ...mockVmConfig,
        useEnabled: true
      })
      mockPrisma.vMNWFilter.findFirst.mockResolvedValue(mockVmFilter)
      mockPrisma.nWFilter.update.mockResolvedValue(withTimestamps({
        id: 'nw-filter-1',
        name: 'nw-filter-1',
        internalName: 'nw-filter-1',
        description: null,
        uuid: 'uuid-1',
        chain: null,
        type: 'filter',
        priority: 0,
        stateMatch: false,
        flushedAt: null
      }))

      // Mock the return value for getVmServiceStatus
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVm({
        id: 'vm-123',
        name: 'Test VM'
      }))
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      const result = await firewallService.toggleVmService('vm-123', 'ssh', 'use', true)

      expect(mockPrisma.vMServiceConfig.update).toHaveBeenCalledWith({
        where: { id: mockVmConfig.id },
        data: {
          useEnabled: true,
          provideEnabled: false
        }
      })
      expect(mockNetworkFilterService.deduplicateRules).toHaveBeenCalledWith('nw-filter-1')
      expect(result.serviceId).toBe('ssh')
    })

    it('should toggle provide permission for VM service', async () => {
      const mockVmConfig = withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'http',
        useEnabled: false,
        provideEnabled: false
      })

      const mockVmFilter = withTimestamps({
        id: 'filter-1',
        vmId: 'vm-123',
        nwFilterId: 'nw-filter-1'
      })

      mockPrisma.vMServiceConfig.findUnique.mockResolvedValue(mockVmConfig)
      mockPrisma.vMServiceConfig.update.mockResolvedValue({
        ...mockVmConfig,
        provideEnabled: true
      })
      mockPrisma.vMNWFilter.findFirst.mockResolvedValue(mockVmFilter)
      mockPrisma.nWFilter.update.mockResolvedValue(withTimestamps({
        id: 'nw-filter-1',
        name: 'nw-filter-1',
        internalName: 'nw-filter-1',
        description: null,
        uuid: 'uuid-1',
        chain: null,
        type: 'filter',
        priority: 0,
        stateMatch: false,
        flushedAt: null
      }))
      mockPrisma.vmPort.findMany.mockResolvedValue([])
      mockPrisma.vmPort.upsert.mockResolvedValue(withTimestamps({
        id: 'port-1',
        vmId: 'vm-123',
        protocol: 'TCP',
        portStart: 80,
        portEnd: 80,
        toEnable: true,
        enabled: false,
        running: false,
        lastSeen: new Date()
      }))

      // Mock the return value for getVmServiceStatus
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVm({
        id: 'vm-123',
        name: 'Test VM'
      }))
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      const result = await firewallService.toggleVmService('vm-123', 'http', 'provide', true)

      expect(mockPrisma.vMServiceConfig.update).toHaveBeenCalledWith({
        where: { id: mockVmConfig.id },
        data: {
          useEnabled: false,
          provideEnabled: true
        }
      })
      expect(result.serviceId).toBe('http')
    })

    it('should create new config if not exists', async () => {
      const mockVmFilter = withTimestamps({
        id: 'filter-1',
        vmId: 'vm-123',
        nwFilterId: 'nw-filter-1'
      })

      mockPrisma.vMServiceConfig.findUnique.mockResolvedValue(null)
      mockPrisma.vMServiceConfig.create.mockResolvedValue(withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'ssh',
        useEnabled: false,
        provideEnabled: false
      }))
      mockPrisma.vMServiceConfig.update.mockResolvedValue(withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'ssh',
        useEnabled: true,
        provideEnabled: false
      }))
      mockPrisma.vMNWFilter.findFirst.mockResolvedValue(mockVmFilter)
      mockPrisma.nWFilter.update.mockResolvedValue(withTimestamps({
        id: 'nw-filter-1',
        name: 'nw-filter-1',
        internalName: 'nw-filter-1',
        description: null,
        uuid: 'uuid-1',
        chain: null,
        type: 'filter',
        priority: 0,
        stateMatch: false,
        flushedAt: null
      }))

      // Mock the return value for getVmServiceStatus
      mockPrisma.machine.findUnique.mockResolvedValue(createMockVm({
        id: 'vm-123',
        name: 'Test VM'
      }))
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      await firewallService.toggleVmService('vm-123', 'ssh', 'use', true)

      expect(mockPrisma.vMServiceConfig.create).toHaveBeenCalledWith({
        data: {
          vmId: 'vm-123',
          serviceId: 'ssh',
          useEnabled: false,
          provideEnabled: false
        }
      })
    })

    it('should throw error if service not found', async () => {
      await expect(firewallService.toggleVmService('vm-123', 'invalid-service', 'use', true))
        .rejects.toThrow('Service with ID invalid-service not found')
    })

    it('should throw error if VM filter not found', async () => {
      mockPrisma.vMServiceConfig.findUnique.mockResolvedValue(withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'ssh',
        useEnabled: false,
        provideEnabled: false
      }))
      mockPrisma.vMServiceConfig.update.mockResolvedValue(withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'ssh',
        useEnabled: true,
        provideEnabled: false
      }))
      mockPrisma.vMNWFilter.findFirst.mockResolvedValue(null)

      await expect(firewallService.toggleVmService('vm-123', 'ssh', 'use', true))
        .rejects.toThrow('Filter for VM vm-123 not found')
    })
  })

  describe('clearVmServiceOverrides', () => {
    it('should clear specific service override', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM'
      })

      const mockVmFilter = withTimestamps({
        id: 'filter-1',
        vmId: 'vm-123',
        nwFilterId: 'nw-filter-1'
      })

      mockPrisma.machine.findUnique.mockResolvedValue({
        ...mockVm,
        departmentId: 'dept-123',
        serviceConfigs: [
          withTimestamps({
            id: 'config-1',
            serviceId: 'ssh',
            useEnabled: true,
            provideEnabled: false
          })
        ],
        ports: []
      } as unknown as Machine)
      mockPrisma.vMServiceConfig.findUnique.mockResolvedValue(withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'ssh',
        useEnabled: true,
        provideEnabled: false
      }))
      mockPrisma.vMServiceConfig.delete.mockResolvedValue(withTimestamps({
        id: 'config-1',
        vmId: 'vm-123',
        serviceId: 'ssh',
        useEnabled: true,
        provideEnabled: false
      }))
      mockPrisma.vMNWFilter.findFirst.mockResolvedValue(mockVmFilter)
      mockPrisma.departmentServiceConfig.findUnique.mockResolvedValue(null)
      mockPrisma.globalServiceConfig.findUnique.mockResolvedValue(null)
      mockPrisma.nWFilter.update.mockResolvedValue(withTimestamps({
        id: 'nw-filter-1',
        name: 'nw-filter-1',
        internalName: 'nw-filter-1',
        description: null,
        uuid: 'uuid-1',
        chain: null,
        type: 'filter',
        priority: 0,
        stateMatch: false,
        flushedAt: null
      }))
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      // Mock fWRule for rule deletion
      mockPrisma.fWRule.findMany.mockResolvedValue([])
      mockPrisma.fWRule.delete.mockResolvedValue(createMockFWRule({ id: 'rule-1' }))

      const result = await firewallService.clearVmServiceOverrides('vm-123', 'ssh')

      expect(mockPrisma.vMServiceConfig.delete).toHaveBeenCalledWith({
        where: { id: 'config-1' }
      })
      expect(result).toHaveLength(1)
      expect(result[0].serviceId).toBe('ssh')
    })

    it('should clear all service overrides when no serviceId provided', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM',
        department: { id: 'dept-123', name: 'Test Dept', serviceConfigs: [] },
        serviceConfigs: [
          {
            serviceId: 'ssh',
            useEnabled: true,
            provideEnabled: false
          },
          {
            serviceId: 'http',
            useEnabled: false,
            provideEnabled: true
          }
        ],
        ports: []
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockPrisma.vMServiceConfig.deleteMany.mockResolvedValue({ count: 2 })
      mockPrisma.globalServiceConfig.findMany.mockResolvedValue([])

      const result = await firewallService.clearVmServiceOverrides('vm-123')

      expect(mockPrisma.vMServiceConfig.deleteMany).toHaveBeenCalledWith({
        where: { vmId: 'vm-123' }
      })
      expect(result).toHaveLength(3) // All services status returned
    })

    it('should throw error if VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(firewallService.clearVmServiceOverrides('non-existent'))
        .rejects.toThrow('VM with ID non-existent not found')
    })

    it('should throw error if service not found', async () => {
      const mockVm = createMockVm({
        id: 'vm-123',
        name: 'Test VM',
        department: { id: 'dept-123', name: 'Test Dept', serviceConfigs: [] },
        serviceConfigs: [],
        ports: []
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)

      await expect(firewallService.clearVmServiceOverrides('vm-123', 'invalid-service'))
        .rejects.toThrow('Service with ID invalid-service not found')
    })
  })
})
