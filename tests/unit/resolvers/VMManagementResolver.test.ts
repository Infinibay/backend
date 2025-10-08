import { mockDeep, mockReset } from 'jest-mock-extended'
import { VMManagementResolver } from '../../../app/graphql/resolvers/vmManagement/resolver'
import { NetworkFilterService } from '@services/networkFilterService'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import { VirtManager } from '@utils/VirtManager'
import {
  createMockUser,
  createMockAdminUser,
  createMockMachine,
  createMockNWFilter,
  createMockFWRule
} from '../../setup/mock-factories'
import {
  createMockContext,
  createAdminContext,
  createUserContext
} from '../../setup/test-helpers'
import { UserInputError } from 'apollo-server-core'

// Mock the service modules
jest.mock('@services/networkFilterService')
jest.mock('@services/VirtioSocketWatcherService')
jest.mock('@utils/VirtManager')

const MockNetworkFilterService = NetworkFilterService as jest.MockedClass<typeof NetworkFilterService>
const MockVirtioSocketWatcherService = VirtioSocketWatcherService as jest.MockedClass<typeof VirtioSocketWatcherService>
const MockVirtManager = VirtManager as jest.MockedClass<typeof VirtManager>

const mockNetworkFilterService = mockDeep<NetworkFilterService>()
const mockVirtioSocketWatcherService = mockDeep<VirtioSocketWatcherService>()
const mockVirtManager = mockDeep<VirtManager>()

jest.mock('../../../app/utils/libvirt', () => ({
  getLibvirtConnection: jest.fn()
}))

describe('VMManagementResolver', () => {
  let resolver: VMManagementResolver
  let mockUser: any
  let mockAdminUser: any
  let mockVM: any
  let mockContext: any
  let mockAdminContext: any

  beforeEach(() => {
    mockReset(mockNetworkFilterService)
    mockReset(mockVirtioSocketWatcherService)
    mockReset(mockVirtManager)

    // Set up mocked constructors
    MockNetworkFilterService.mockImplementation(() => mockNetworkFilterService)
    MockVirtioSocketWatcherService.mockImplementation(() => mockVirtioSocketWatcherService)
    MockVirtManager.mockImplementation(() => mockVirtManager)

    resolver = new VMManagementResolver(
      mockNetworkFilterService,
      mockVirtManager,
      mockVirtioSocketWatcherService
    )

    mockUser = createMockUser()
    mockAdminUser = createMockAdminUser()
    mockVM = createMockMachine({ userId: mockUser.id })
    mockContext = createUserContext()
    mockAdminContext = createAdminContext()
  })

  describe('getVMFirewallRules', () => {
    const vmId = 'vm-123'

    it('should successfully retrieve VM firewall rules', async () => {
      const mockNWFilter = createMockNWFilter()
      const mockFWRule = createMockFWRule()

      const vmWithFilters = {
        ...mockVM,
        nwFilters: [{
          nwFilter: {
            rules: [mockFWRule]
          }
        }]
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(vmWithFilters)

      const result = await resolver.getVMFirewallRules(vmId, mockContext)

      expect(mockContext.prisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: vmId },
        include: {
          nwFilters: {
            include: {
              nwFilter: {
                include: {
                  rules: true
                }
              }
            }
          }
        }
      })

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        id: mockFWRule.id,
        name: expect.any(String),
        action: mockFWRule.action || 'accept',
        direction: mockFWRule.direction || 'inbound',
        protocol: mockFWRule.protocol,
        port: mockFWRule.dstPortStart,
        sourceIp: mockFWRule.srcIpAddr,
        destinationIp: mockFWRule.dstIpAddr,
        priority: mockFWRule.priority || 1000,
        enabled: true
      })
    })

    it('should return empty array when VM has no firewall rules', async () => {
      const vmWithoutRules = {
        ...mockVM,
        nwFilters: []
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(vmWithoutRules)

      const result = await resolver.getVMFirewallRules(vmId, mockContext)

      expect(result).toEqual([])
    })

    it('should throw error when VM not found', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(null)

      await expect(resolver.getVMFirewallRules(vmId, mockContext))
        .rejects.toThrow(UserInputError)

      await expect(resolver.getVMFirewallRules(vmId, mockContext))
        .rejects.toThrow('VM not found')
    })

    it('should handle complex rule mapping with multiple filters', async () => {
      const mockFWRule1 = createMockFWRule({ id: 'rule-1', protocol: 'tcp' })
      const mockFWRule2 = createMockFWRule({ id: 'rule-2', protocol: 'udp' })

      const vmWithMultipleFilters = {
        ...mockVM,
        nwFilters: [
          { nwFilter: { rules: [mockFWRule1] } },
          { nwFilter: { rules: [mockFWRule2] } }
        ]
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(vmWithMultipleFilters)

      const result = await resolver.getVMFirewallRules(vmId, mockContext)

      expect(result).toHaveLength(2)
      expect(result.find(r => r.protocol === 'tcp')).toBeDefined()
      expect(result.find(r => r.protocol === 'udp')).toBeDefined()
    })
  })

  describe('createVMFirewallRule', () => {
    const createRuleInput = {
      vmId: 'vm-123',
      name: 'test-rule',
      action: 'accept' as const,
      direction: 'inbound' as const,
      protocol: 'tcp',
      port: 80,
      sourceIp: '192.168.1.0/24',
      destinationIp: '10.0.0.1',
      priority: 100
    }

    it('should successfully create firewall rule with existing filter for admin', async () => {
      const mockNWFilter = createMockNWFilter()
      const mockFWRule = createMockFWRule()

      const vmWithFilter = {
        ...mockVM,
        nwFilters: [{
          nwFilterId: mockNWFilter.id,
          nwFilter: mockNWFilter
        }]
      }

      mockAdminContext.prisma.machine.findUnique.mockResolvedValue(vmWithFilter)
      mockNetworkFilterService.createRule.mockResolvedValue(mockFWRule)

      const result = await resolver.createVMFirewallRule(createRuleInput, mockAdminContext)

      expect(mockAdminContext.prisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: createRuleInput.vmId },
        include: {
          nwFilters: {
            include: {
              nwFilter: true
            }
          }
        }
      })

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        mockNWFilter.id,
        createRuleInput.action || 'accept',
        createRuleInput.direction || 'inbound',
        createRuleInput.priority || 1000,
        createRuleInput.protocol || 'all',
        createRuleInput.port,
        expect.objectContaining({
          srcIpAddr: createRuleInput.sourceIp,
          dstIpAddr: createRuleInput.destinationIp,
          dstPortStart: createRuleInput.port,
          dstPortEnd: createRuleInput.port,
          comment: createRuleInput.name
        })
      )

      expect(result).toMatchObject({
        id: mockFWRule.id,
        name: createRuleInput.name,
        action: createRuleInput.action,
        direction: createRuleInput.direction,
        protocol: createRuleInput.protocol
      })
    })

    it('should successfully create firewall rule with new filter creation for admin', async () => {
      const mockNWFilter = createMockNWFilter()
      const mockFWRule = createMockFWRule()

      const vmWithoutFilter = {
        ...mockVM,
        nwFilters: []
      }

      mockAdminContext.prisma.machine.findUnique.mockResolvedValue(vmWithoutFilter)
      mockNetworkFilterService.createFilter.mockResolvedValue(mockNWFilter)
      mockNetworkFilterService.createRule.mockResolvedValue(mockFWRule)
      mockAdminContext.prisma.vMNWFilter.create.mockResolvedValue({
        vmId: mockVM.id,
        nwFilterId: mockNWFilter.id
      })

      const result = await resolver.createVMFirewallRule(createRuleInput, mockAdminContext)

      expect(mockNetworkFilterService.createFilter).toHaveBeenCalledWith(
        `vm_${mockVM.name}_filter`,
        `Firewall rules for VM ${mockVM.name}`,
        'root',
        'vm'
      )

      expect(mockAdminContext.prisma.vMNWFilter.create).toHaveBeenCalledWith({
        data: {
          vmId: mockVM.id,
          nwFilterId: mockNWFilter.id
        }
      })

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        mockNWFilter.id,
        createRuleInput.action || 'accept',
        createRuleInput.direction || 'inbound',
        createRuleInput.priority || 1000,
        createRuleInput.protocol || 'all',
        createRuleInput.port,
        expect.any(Object)
      )

      expect(result).toBeDefined()
    })

    // Note: Authorization is handled by @Authorized('ADMIN') decorator in GraphQL schema

    it('should throw error when VM not found', async () => {
      mockAdminContext.prisma.machine.findUnique.mockResolvedValue(null)

      await expect(resolver.createVMFirewallRule(createRuleInput, mockAdminContext))
        .rejects.toThrow(UserInputError)

      await expect(resolver.createVMFirewallRule(createRuleInput, mockAdminContext))
        .rejects.toThrow('VM not found')
    })

    it('should handle NetworkFilterService errors', async () => {
      const vmWithFilter = {
        ...mockVM,
        nwFilters: [{
          nwFilterId: 'filter-id',
          nwFilter: createMockNWFilter()
        }]
      }

      mockAdminContext.prisma.machine.findUnique.mockResolvedValue(vmWithFilter)
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Service error'))

      await expect(resolver.createVMFirewallRule(createRuleInput, mockAdminContext))
        .rejects.toThrow('Service error')
    })

    // Note: Input validation is handled by TypeGraphQL schema validation
  })

  describe('listVMServices', () => {
    const vmId = 'vm-123'

    it('should successfully list VM services', async () => {
      const mockServiceResponse = {
        success: true,
        data: [
          { Name: 'nginx', Status: 'running', Description: 'Web server', can_start: false, can_stop: true, can_restart: true, StartType: 'auto' },
          { name: 'mysql', status: 'stopped', description: 'Database server', can_start: true, can_stop: false, can_restart: false }
        ]
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockServiceResponse)

      const result = await resolver.listVMServices(vmId, mockContext)

      expect(mockContext.prisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: vmId }
      })

      expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(
        vmId,
        { action: 'ServiceList' },
        30000
      )

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        name: 'nginx',
        displayName: 'nginx',
        status: 'running',
        description: 'Web server',
        canStart: false,
        canStop: true,
        canRestart: true,
        startupType: 'auto'
      })
      expect(result[1]).toMatchObject({
        name: 'mysql',
        displayName: 'mysql',
        status: 'stopped',
        description: 'Database server',
        canStart: true,
        canStop: false,
        canRestart: false,
        startupType: 'unknown'
      })
    })

    it('should return empty array when no services found', async () => {
      const mockServiceResponse = {
        success: true,
        data: []
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockServiceResponse)

      const result = await resolver.listVMServices(vmId, mockContext)

      expect(result).toEqual([])
    })

    it('should throw error when VM not found', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(null)

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow(UserInputError)

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow('VM not found')
    })

    it('should handle VirtioSocketWatcher service failure', async () => {
      const mockErrorResponse = {
        success: false,
        error: 'Failed to connect to VM'
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockErrorResponse)

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow(UserInputError)

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow('Failed to list VM services')
    })

    it('should handle VirtioSocketWatcher timeout', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockRejectedValue(new Error('timeout'))

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow(UserInputError)

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow('Failed to list VM services')
    })

    it('should handle invalid service response format', async () => {
      const mockInvalidResponse = {
        success: true,
        data: null
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockInvalidResponse)

      const result = await resolver.listVMServices(vmId, mockContext)

      expect(result).toEqual([])
    })
  })

  describe('controlVMService', () => {
    const serviceControlInput = {
      vmId: 'vm-123',
      serviceName: 'nginx',
      action: 'start' as const
    }

    it('should successfully control VM service', async () => {
      const mockCommandResult = {
        success: true,
        stdout: 'Service started successfully',
        stderr: '',
        exit_code: 0
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockCommandResult)

      const result = await resolver.controlVMService(serviceControlInput, mockContext)

      expect(mockContext.prisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: serviceControlInput.vmId }
      })

      expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(
        serviceControlInput.vmId,
        {
          action: 'ServiceControl',
          params: {
            service_name: serviceControlInput.serviceName,
            action: serviceControlInput.action
          }
        },
        30000
      )

      expect(result).toEqual({
        success: true,
        output: 'Service started successfully',
        error: '',
        exitCode: 0
      })
    })

    it('should throw error when VM not found', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(null)

      await expect(resolver.controlVMService(serviceControlInput, mockContext))
        .rejects.toThrow(UserInputError)

      await expect(resolver.controlVMService(serviceControlInput, mockContext))
        .rejects.toThrow('VM not found')
    })

    it('should handle service control failure', async () => {
      const mockFailureResult = {
        success: false,
        stdout: '',
        stderr: 'Service not found',
        exit_code: 1
      }

      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockFailureResult)

      const result = await resolver.controlVMService(serviceControlInput, mockContext)

      expect(result).toEqual({
        success: false,
        output: '',
        error: 'Service not found',
        exitCode: 1
      })
    })

    it('should handle VirtioSocketWatcher timeout', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockRejectedValue(new Error('timeout'))

      const result = await resolver.controlVMService(serviceControlInput, mockContext)

      expect(result).toEqual({
        success: false,
        output: '',
        error: 'timeout',
        exitCode: 1
      })
    })

    it('should handle different service actions', async () => {
      const actions = ['start', 'stop', 'restart'] as const

      for (const action of actions) {
        const input = { ...serviceControlInput, action }
        const mockResult = {
          success: true,
          stdout: `Service ${action}ed successfully`,
          stderr: '',
          exit_code: 0
        }

        mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
        mockVirtioSocketWatcherService.sendSafeCommand.mockResolvedValue(mockResult)

        const result = await resolver.controlVMService(input, mockContext)

        expect(result.output).toContain(action)
        expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(
          input.vmId,
          {
            action: 'ServiceControl',
            params: {
              service_name: input.serviceName,
              action
            }
          },
          30000
        )
      }
    })

    // Note: Input validation is handled by TypeGraphQL schema validation

    // Note: Input validation is handled by TypeGraphQL schema validation
  })

  // Note: Authorization is handled by @Authorized() decorators in GraphQL schema
  // and would be tested in integration tests with actual GraphQL execution

  describe('Error Handling', () => {
    const vmId = 'vm-123'

    it('should handle database connection errors', async () => {
      mockContext.prisma.machine.findUnique.mockRejectedValue(new Error('Database connection failed'))

      await expect(resolver.getVMFirewallRules(vmId, mockContext))
        .rejects.toThrow('Database connection failed')
    })

    it('should handle network service errors gracefully', async () => {
      const vmWithFilter = {
        ...mockVM,
        nwFilters: [{
          nwFilterId: 'filter-id',
          nwFilter: createMockNWFilter()
        }]
      }
      mockAdminContext.prisma.machine.findUnique.mockResolvedValue(vmWithFilter)
      mockNetworkFilterService.createRule.mockRejectedValue(new Error('Network error'))

      const createRuleInput = {
        vmId,
        name: 'test-rule',
        action: 'accept' as const,
        direction: 'inbound' as const,
        protocol: 'tcp'
      }

      await expect(resolver.createVMFirewallRule(createRuleInput, mockAdminContext))
        .rejects.toThrow('Network error')
    })

    it('should handle virtio service timeout gracefully', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockRejectedValue(new Error('Virtio error'))

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow(UserInputError)
    })

    it('should provide meaningful error messages', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(null)

      await expect(resolver.getVMFirewallRules(vmId, mockContext))
        .rejects.toThrow('VM not found')
      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow('VM not found')
    })
  })
})
