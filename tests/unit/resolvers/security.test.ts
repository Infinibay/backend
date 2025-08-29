import 'reflect-metadata'
import { SecurityResolver } from '@resolvers/security/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockContext, createAdminContext } from '../../setup/test-helpers'
import { createMockMachine, createMockDepartment } from '../../setup/mock-factories'
import { UserInputError } from 'apollo-server-errors'
import { FirewallService } from '@services/firewallService'
import { ServiceRiskLevel } from '@main/config/knownServices'
import { ServiceAction } from '@resolvers/security/types'

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
      toggleGlobalService: jest.fn()
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
          displayName: 'Web (HTTP)',
          description: 'Web Server',
          ports: [{ protocol: 'tcp', portStart: 80, portEnd: 80 }],
          riskLevel: ServiceRiskLevel.MEDIUM,
          riskDescription: 'Unencrypted web traffic'
        },
        {
          id: 'https',
          name: 'HTTPS',
          displayName: 'Secure Web (HTTPS)',
          description: 'Secure Web Server',
          ports: [{ protocol: 'tcp', portStart: 443, portEnd: 443 }],
          riskLevel: ServiceRiskLevel.LOW,
          riskDescription: 'Encrypted web traffic'
        }
      ]
      mockFirewallService.getServices.mockResolvedValue(mockServices)

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
      const mockVm = createMockMachine({ id: vmId })
      const mockStatus = [
        {
          serviceId: 'http',
          vmId,
          vmName: mockVm.name,
          serviceName: 'HTTP',
          useEnabled: true,
          provideEnabled: false,
          running: true
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
      const mockVm = createMockMachine({ id: vmId })
      const mockStatus = [
        {
          serviceId: 'http',
          vmId,
          vmName: mockVm.name,
          serviceName: 'HTTP',
          useEnabled: true,
          provideEnabled: false,
          running: true
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
      const mockDepartment = createMockDepartment({ id: departmentId })
      const mockStatus = [
        {
          serviceId: 'ssh',
          departmentId,
          departmentName: mockDepartment.name,
          serviceName: 'SSH',
          useEnabled: true,
          provideEnabled: false,
          vmCount: 5,
          enabledVmCount: 3
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
          serviceName: 'RDP',
          useEnabled: false,
          provideEnabled: false
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
          serviceName: 'Remote Desktop',
          useEnabled: false,
          provideEnabled: false
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
        action: ServiceAction.USE,
        enabled: true
      }
      const mockVm = createMockMachine({ id: input.vmId })
      const mockResult = {
        serviceId: input.serviceId,
        vmId: input.vmId,
        vmName: mockVm.name,
        serviceName: 'HTTP',
        useEnabled: input.enabled,
        provideEnabled: false,
        running: true
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVm)
      mockFirewallService.toggleVmService.mockResolvedValue(mockResult)

      // Act
      const result = await resolver.toggleVmService(ctx, input)

      // Assert
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: input.vmId },
        select: { id: true }
      })
      expect(mockFirewallService.toggleVmService).toHaveBeenCalledWith(
        input.vmId,
        input.serviceId,
        input.action,
        input.enabled
      )
      expect(result).toEqual(mockResult)
    })

    it('should throw error when VM not found', async () => {
      // Arrange
      const input = {
        vmId: 'non-existent',
        serviceId: 'http',
        action: ServiceAction.USE,
        enabled: true
      }
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.toggleVmService(ctx, input)).rejects.toThrow(UserInputError)
      expect(mockFirewallService.toggleVmService).not.toHaveBeenCalled()
    })
  })

  describe('Mutation: toggleDepartmentService', () => {
    it('should toggle department service status', async () => {
      // Arrange
      const input = {
        departmentId: 'dept-123',
        serviceId: 'ssh',
        action: ServiceAction.USE,
        enabled: true
      }
      const mockDepartment = createMockDepartment({ id: input.departmentId })
      const mockResult = {
        serviceId: input.serviceId,
        departmentId: input.departmentId,
        departmentName: mockDepartment.name,
        serviceName: 'SSH',
        useEnabled: input.enabled,
        provideEnabled: false,
        vmCount: 5,
        enabledVmCount: 3
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)
      mockFirewallService.toggleDepartmentService.mockResolvedValue(mockResult)

      // Act
      const result = await resolver.toggleDepartmentService(ctx, input)

      // Assert
      expect(mockPrisma.department.findUnique).toHaveBeenCalledWith({
        where: { id: input.departmentId },
        select: { id: true }
      })
      expect(mockFirewallService.toggleDepartmentService).toHaveBeenCalledWith(
        input.departmentId,
        input.serviceId,
        input.action,
        input.enabled
      )
      expect(result).toEqual(mockResult)
    })

    it('should throw error when department not found', async () => {
      // Arrange
      const input = {
        departmentId: 'non-existent',
        serviceId: 'ssh',
        action: ServiceAction.USE,
        enabled: true
      }
      mockPrisma.department.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(resolver.toggleDepartmentService(ctx, input)).rejects.toThrow(UserInputError)
      expect(mockFirewallService.toggleDepartmentService).not.toHaveBeenCalled()
    })
  })

  describe('Mutation: toggleGlobalService', () => {
    it('should toggle global service status', async () => {
      // Arrange
      const input = {
        serviceId: 'rdp',
        action: ServiceAction.USE,
        enabled: false
      }
      const mockResult = {
        serviceId: input.serviceId,
        serviceName: 'Remote Desktop',
        useEnabled: false,
        provideEnabled: false
      }

      mockFirewallService.toggleGlobalService.mockResolvedValue(mockResult)

      // Act
      const result = await resolver.toggleGlobalService(ctx, input)

      // Assert
      expect(mockFirewallService.toggleGlobalService).toHaveBeenCalledWith(
        input.serviceId,
        input.action,
        input.enabled
      )
      expect(result).toEqual(mockResult)
    })
  })

  describe('Query: getServiceStatusSummary', () => {
    it('should return service status summary', async () => {
      // Arrange
      const mockSummary = [
        {
          serviceId: 'http',
          serviceName: 'Web (HTTP)',
          totalVms: 5,
          runningVms: 2,
          enabledVms: 3
        },
        {
          serviceId: 'ssh',
          serviceName: 'Secure Shell',
          totalVms: 5,
          runningVms: 1,
          enabledVms: 4
        }
      ]

      mockFirewallService.getServices.mockResolvedValue([
        {
          id: 'http',
          name: 'HTTP',
          displayName: 'Web (HTTP)',
          description: 'Web Server',
          ports: [{ protocol: 'tcp', portStart: 80, portEnd: 80 }],
          riskLevel: ServiceRiskLevel.MEDIUM,
          riskDescription: 'Unencrypted web traffic'
        }
      ])

      mockPrisma.machine.findMany.mockResolvedValue([])

      // Act
      const result = await resolver.getServiceStatusSummary(ctx)

      // Assert
      expect(mockFirewallService.getServices).toHaveBeenCalledTimes(1)
      expect(result).toHaveLength(1)
    })
  })
})
