import { mockDeep, mockReset } from 'jest-mock-extended'
import { VMManagementResolver } from '../../../app/graphql/resolvers/vmManagement/resolver'
import { VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService'
import {
  createMockUser,
  createMockAdminUser,
  createMockMachine
} from '../../setup/mock-factories'
import {
  createMockContext,
  createAdminContext,
  createUserContext
} from '../../setup/test-helpers'
import { UserInputError } from '@utils/errors'

// Mock the service modules
jest.mock('@services/VirtioSocketWatcherService')

const MockVirtioSocketWatcherService = VirtioSocketWatcherService as jest.MockedClass<typeof VirtioSocketWatcherService>

const mockVirtioSocketWatcherService = mockDeep<VirtioSocketWatcherService>()

describe('VMManagementResolver', () => {
  let resolver: VMManagementResolver
  let mockUser: any
  let mockAdminUser: any
  let mockVM: any
  let mockContext: any
  let mockAdminContext: any

  beforeEach(() => {
    mockReset(mockVirtioSocketWatcherService)

    // Set up mocked constructors
    MockVirtioSocketWatcherService.mockImplementation(() => mockVirtioSocketWatcherService)

    resolver = new VMManagementResolver(
      mockVirtioSocketWatcherService as any
    )

    mockUser = createMockUser()
    mockAdminUser = createMockAdminUser()
    mockVM = createMockMachine({ userId: mockUser.id })
    mockContext = createMockContext(mockUser)
    mockAdminContext = createAdminContext()
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

      // The resolver uses vm.id (from DB) not the input vmId
      expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(
        mockVM.id,
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
        data: null as any
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

      // The resolver uses vm.id (from DB) not input.vmId
      expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(
        mockVM.id,
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
        // The resolver uses vm.id (from DB) not input.vmId
        expect(mockVirtioSocketWatcherService.sendSafeCommand).toHaveBeenCalledWith(
          mockVM.id,
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
  })

  describe('Error Handling', () => {
    const vmId = 'vm-123'

    it('should handle database connection errors', async () => {
      mockContext.prisma.machine.findUnique.mockRejectedValue(new Error('Database connection failed'))

      // DB errors from findUnique happen before the try/catch, so they propagate as-is
      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow('Database connection failed')
    })

    it('should handle virtio service timeout gracefully', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(mockVM)
      mockVirtioSocketWatcherService.sendSafeCommand.mockRejectedValue(new Error('Virtio error'))

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow(UserInputError)
    })

    it('should provide meaningful error messages', async () => {
      mockContext.prisma.machine.findUnique.mockResolvedValue(null)

      await expect(resolver.listVMServices(vmId, mockContext))
        .rejects.toThrow('VM not found')
    })
  })
})
