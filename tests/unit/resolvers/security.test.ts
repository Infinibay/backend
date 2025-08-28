import 'reflect-metadata'
import { SecurityResolver } from '@resolvers/security/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockContext, createAdminContext } from '../../setup/test-helpers'
import { UserInputError } from 'apollo-server-errors'
import { FirewallService } from '@services/firewallService'

// Mock the FirewallService
jest.mock('@services/firewallService')

describe('SecurityResolver', () => {
  let resolver: SecurityResolver
  let mockFirewallService: jest.Mocked<FirewallService>
  const ctx = createAdminContext()

  beforeEach(() => {
    jest.clearAllMocks()
    resolver = new SecurityResolver()
    
    // Create a mock FirewallService
    mockFirewallService = {
      getServices: jest.fn(),
      getVmServiceStatus: jest.fn(),
      getDepartmentServiceStatus: jest.fn(),
      getGlobalServiceStatus: jest.fn(),
      toggleVmService: jest.fn(),
      toggleDepartmentService: jest.fn(),
      toggleGlobalService: jest.fn(),
      getServiceStatusSummary: jest.fn()
    } as unknown as jest.Mocked<FirewallService>
    
    // Mock the private getFirewallService method
    // @ts-ignore - accessing private method for testing
    resolver.getFirewallService = jest.fn().mockReturnValue(mockFirewallService)
  })

  describe('Query: listServices', () => {
    it('should return list of available services', async () => {
      // Arrange
      const mockServices = [
        {
          id: 'http',
          name: 'HTTP',
          description: 'Web Server',
          port: 80,
          protocol: 'TCP',
          category: 'Web'
        },
        {
          id: 'https',
          name: 'HTTPS',
          description: 'Secure Web Server',
          port: 443,
          protocol: 'TCP',
          category: 'Web'
        }
      ]
      mockFirewallService.getServices.mockReturnValue(mockServices)

      // Act
      const result = await resolver.listServices(ctx)

      // Assert
      expect(mockFirewallService.getServices).toHaveBeenCalledTimes(1)
      expect(result).toEqual(mockServices)
      expect(result).toHaveLength(2)
    })
  })

  describe('Query: getVmServiceStatus', () => {
    it('should return service status for a VM', async () => {
      // Arrange
      const vmId = 'vm-123'
      const mockVm = { id: vmId }
      const mockStatus = [
        {
          serviceId: 'http',
          vmId: vmId,
          useEnabled: true,
          provideEnabled: false,
          status: 'active'
        }
      ]
      
      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockFirewallService.getVmServiceStatus.mockResolvedValue(mockStatus)

      // Act
      const result = await resolver.getVmServiceStatus(ctx, vmId)

      // Assert
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: vmId },
        select: { id: true }
      })
      expect(mockFirewallService.getVmServiceStatus).toHaveBeenCalledWith(vmId, undefined)
      expect(result).toEqual(mockStatus)
    })

    it('should filter by service ID when provided', async () => {
      // Arrange
      const vmId = 'vm-123'
      const serviceId = 'http'
      const mockVm = { id: vmId }
      const mockStatus = [
        {
          serviceId: 'http',
          vmId: vmId,
          useEnabled: true,
          provideEnabled: false,
          status: 'active'
        }
      ]
      
      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockFirewallService.getVmServiceStatus.mockResolvedValue(mockStatus)

      // Act
      const result = await resolver.getVmServiceStatus(ctx, vmId, serviceId)

      // Assert
      expect(mockFirewallService.getVmServiceStatus).toHaveBeenCalledWith(vmId, serviceId)
      expect(result).toEqual(mockStatus)
    })

    it('should throw error when VM not found', async () => {
      // Arrange
      const vmId = 'non-existent'
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.getVmServiceStatus(ctx, vmId)).rejects.toThrow(UserInputError)
      expect(mockFirewallService.getVmServiceStatus).not.toHaveBeenCalled()
    })
  })

  describe('Query: getDepartmentServiceStatus', () => {
    it('should return service status for a department', async () => {
      // Arrange
      const departmentId = 'dept-123'
      const mockDepartment = { id: departmentId }
      const mockStatus = [
        {
          serviceId: 'ssh',
          departmentId: departmentId,
          useEnabled: true,
          provideEnabled: false,
          status: 'active'
        }
      ]
      
      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)
      mockFirewallService.getDepartmentServiceStatus.mockResolvedValue(mockStatus)

      // Act
      const result = await resolver.getDepartmentServiceStatus(ctx, departmentId)

      // Assert
      expect(mockPrisma.department.findUnique).toHaveBeenCalledWith({
        where: { id: departmentId },
        select: { id: true }
      })
      expect(mockFirewallService.getDepartmentServiceStatus).toHaveBeenCalledWith(departmentId, undefined)
      expect(result).toEqual(mockStatus)
    })

    it('should throw error when department not found', async () => {
      // Arrange
      const departmentId = 'non-existent'
      mockPrisma.department.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.getDepartmentServiceStatus(ctx, departmentId)).rejects.toThrow(UserInputError)
      expect(mockFirewallService.getDepartmentServiceStatus).not.toHaveBeenCalled()
    })
  })

  describe('Query: getGlobalServiceStatus', () => {
    it('should return global service status', async () => {
      // Arrange
      const mockStatus = [
        {
          serviceId: 'rdp',
          useEnabled: false,
          provideEnabled: false,
          status: 'disabled'
        }
      ]
      
      mockFirewallService.getGlobalServiceStatus.mockResolvedValue(mockStatus)

      // Act
      const result = await resolver.getGlobalServiceStatus(ctx)

      // Assert
      expect(mockFirewallService.getGlobalServiceStatus).toHaveBeenCalledWith(undefined)
      expect(result).toEqual(mockStatus)
    })

    it('should filter by service ID when provided', async () => {
      // Arrange
      const serviceId = 'rdp'
      const mockStatus = [
        {
          serviceId: 'rdp',
          useEnabled: false,
          provideEnabled: false,
          status: 'disabled'
        }
      ]
      
      mockFirewallService.getGlobalServiceStatus.mockResolvedValue(mockStatus)

      // Act
      const result = await resolver.getGlobalServiceStatus(ctx, serviceId)

      // Assert
      expect(mockFirewallService.getGlobalServiceStatus).toHaveBeenCalledWith(serviceId)
      expect(result).toEqual(mockStatus)
    })
  })

  describe('Mutation: toggleVmService', () => {
    it('should toggle VM service status', async () => {
      // Arrange
      const input = {
        vmId: 'vm-123',
        serviceId: 'http',
        useEnabled: true,
        provideEnabled: false
      }
      const mockVm = { id: input.vmId }
      const mockResult = {
        serviceId: input.serviceId,
        vmId: input.vmId,
        useEnabled: input.useEnabled,
        provideEnabled: input.provideEnabled,
        status: 'updated'
      }
      
      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockFirewallService.toggleVmService.mockResolvedValue(mockResult)

      // Act
      const result = await resolver.toggleVmService(input, ctx)

      // Assert
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: input.vmId }
      })
      expect(mockFirewallService.toggleVmService).toHaveBeenCalledWith(
        input.vmId,
        input.serviceId,
        input.useEnabled,
        input.provideEnabled
      )
      expect(result).toEqual(mockResult)
    })

    it('should throw error when VM not found', async () => {
      // Arrange
      const input = {
        vmId: 'non-existent',
        serviceId: 'http',
        useEnabled: true,
        provideEnabled: false
      }
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.toggleVmService(input, ctx)).rejects.toThrow(UserInputError)
      expect(mockFirewallService.toggleVmService).not.toHaveBeenCalled()
    })
  })

  describe('Mutation: toggleDepartmentService', () => {
    it('should toggle department service status', async () => {
      // Arrange
      const input = {
        departmentId: 'dept-123',
        serviceId: 'ssh',
        useEnabled: true,
        provideEnabled: false
      }
      const mockDepartment = { id: input.departmentId }
      const mockResult = {
        serviceId: input.serviceId,
        departmentId: input.departmentId,
        useEnabled: input.useEnabled,
        provideEnabled: input.provideEnabled,
        status: 'updated'
      }
      
      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)
      mockFirewallService.toggleDepartmentService.mockResolvedValue(mockResult)

      // Act
      const result = await resolver.toggleDepartmentService(input, ctx)

      // Assert
      expect(mockPrisma.department.findUnique).toHaveBeenCalledWith({
        where: { id: input.departmentId }
      })
      expect(mockFirewallService.toggleDepartmentService).toHaveBeenCalledWith(
        input.departmentId,
        input.serviceId,
        input.useEnabled,
        input.provideEnabled
      )
      expect(result).toEqual(mockResult)
    })

    it('should throw error when department not found', async () => {
      // Arrange
      const input = {
        departmentId: 'non-existent',
        serviceId: 'ssh',
        useEnabled: true,
        provideEnabled: false
      }
      mockPrisma.department.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.toggleDepartmentService(input, ctx)).rejects.toThrow(UserInputError)
      expect(mockFirewallService.toggleDepartmentService).not.toHaveBeenCalled()
    })
  })

  describe('Mutation: toggleGlobalService', () => {
    it('should toggle global service status', async () => {
      // Arrange
      const input = {
        serviceId: 'rdp',
        useEnabled: false,
        provideEnabled: false
      }
      const mockResult = {
        serviceId: input.serviceId,
        useEnabled: input.useEnabled,
        provideEnabled: input.provideEnabled,
        status: 'updated'
      }
      
      mockFirewallService.toggleGlobalService.mockResolvedValue(mockResult)

      // Act
      const result = await resolver.toggleGlobalService(input, ctx)

      // Assert
      expect(mockFirewallService.toggleGlobalService).toHaveBeenCalledWith(
        input.serviceId,
        input.useEnabled,
        input.provideEnabled
      )
      expect(result).toEqual(mockResult)
    })
  })

  describe('Query: serviceStatusSummary', () => {
    it('should return service status summary', async () => {
      // Arrange
      const vmId = 'vm-123'
      const mockVm = { id: vmId, departmentId: 'dept-456' }
      const mockSummary = {
        globalStatus: [],
        departmentStatus: [],
        vmStatus: [],
        effectiveStatus: []
      }
      
      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockFirewallService.getServiceStatusSummary.mockResolvedValue(mockSummary)

      // Act
      const result = await resolver.serviceStatusSummary(ctx, vmId)

      // Assert
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: vmId },
        select: { id: true, departmentId: true }
      })
      expect(mockFirewallService.getServiceStatusSummary).toHaveBeenCalledWith(vmId, 'dept-456')
      expect(result).toEqual(mockSummary)
    })

    it('should throw error when VM not found', async () => {
      // Arrange
      const vmId = 'non-existent'
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.serviceStatusSummary(ctx, vmId)).rejects.toThrow(UserInputError)
      expect(mockFirewallService.getServiceStatusSummary).not.toHaveBeenCalled()
    })
  })
})