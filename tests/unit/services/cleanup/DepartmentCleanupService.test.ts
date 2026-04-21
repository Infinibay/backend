/**
 * Unit tests for DepartmentCleanupService
 */

import { PrismaClient, RuleSetType } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { DepartmentCleanupService } from '@services/cleanup/departmentCleanupService'
import { getInfinization } from '@services/InfinizationService'

// Mock infinization service before importing the service
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn()
}))

jest.mock('@main/logger', () => {
  const mockChild = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
  }
  return {
    __esModule: true,
    default: {
      ...mockChild,
      child: () => mockChild
    }
  }
})

jest.mock('@services/network/DepartmentNetworkService', () => ({
  DepartmentNetworkService: jest.fn().mockImplementation(() => ({
    forceDestroyNetworkForDepartment: jest.fn().mockResolvedValue({
      success: true,
      tapDevicesRemoved: [],
      errors: []
    })
  })),
  ForceDestroyResult: undefined
}))

jest.mock('@infinibay/infinization', () => ({
  TapDeviceManager: jest.fn().mockImplementation(() => ({
    exists: jest.fn()
  })),
  generateVMChainName: jest.fn().mockReturnValue('chain-test')
}))

const mockNftablesService = {
  chainExists: jest.fn()
}

const mockInfinization = {
  getNftablesService: jest.fn(() => mockNftablesService)
}

describe('DepartmentCleanupService', () => {
  let service: DepartmentCleanupService
  let mockPrisma: DeepMockProxy<PrismaClient>

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getInfinization as jest.Mock).mockResolvedValue(mockInfinization)

    mockPrisma = mockDeep<PrismaClient>()
    mockPrisma.department.findUnique.mockResolvedValue(null)
    mockPrisma.department.delete.mockResolvedValue({ id: 'test' } as any)
    mockPrisma.firewallRule.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.firewallRuleSet.delete.mockResolvedValue({ id: 'test' } as any)
    mockPrisma.machine.findMany.mockResolvedValue([])
    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      return callback(mockPrisma)
    })

    service = new DepartmentCleanupService(mockPrisma)
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('cleanupDepartment', () => {
    it('should return early with errors if department not found', async () => {
      const deptId = 'non-existent-dept'
      mockPrisma.department.findUnique.mockResolvedValue(null)

      const result = await service.cleanupDepartment(deptId)

      expect(result).toEqual({
        success: false,
        databaseCleanup: {
          attempted: false,
          success: false
        },
        errors: [expect.stringContaining('not found')]
      })
      expect(result.errors[0]).toContain(deptId)

      // No deletion should occur
      expect(mockPrisma.department.delete).not.toHaveBeenCalled()
      expect(mockPrisma.firewallRule.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.firewallRuleSet.delete).not.toHaveBeenCalled()
    })

    it('should throw error if department has machines', async () => {
      const deptId = 'test-dept-with-vms'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [
          { id: 'vm-1', name: 'VM 1' },
          { id: 'vm-2', name: 'VM 2' }
        ],
        firewallRuleSet: null
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment as any)

      // Should throw error
      await expect(service.cleanupDepartment(deptId))
        .rejects
        .toThrow(/Cannot cleanup department.*2 VMs still exist/)

      // Department should NOT be deleted
      expect(mockPrisma.department.delete).not.toHaveBeenCalled()
    })

    it('should cleanup department with no firewall rules', async () => {
      const deptId = 'test-dept-no-firewall'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: null, // No firewall rules
        bridgeName: null,
        firewallRuleSetId: null
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment as any)

      const result = await service.cleanupDepartment(deptId)

      // Should succeed
      expect(result.success).toBe(true)
      expect(result.errors).toEqual([])

      // Department should be deleted
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
    })

    it('should delete firewall rules and ruleset before department', async () => {
      const deptId = 'test-dept-order'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: {
          id: 'dept-ruleset-order',
          rules: [{ id: 'dept-rule-1', name: 'Rule 1' }],
          rulesCount: 1
        },
        bridgeName: null,
        firewallRuleSetId: 'dept-ruleset-order'
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment as any)

      const result = await service.cleanupDepartment(deptId)

      // Verify firewallRule.deleteMany was called first
      expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
        where: { ruleSetId: 'dept-ruleset-order' }
      })

      // Verify firewallRuleSet.delete was called
      expect(mockPrisma.firewallRuleSet.delete).toHaveBeenCalledWith({
        where: { id: 'dept-ruleset-order' }
      })

      // Verify department.delete was called last
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })

      expect(result.success).toBe(true)
    })

    it('should throw error if orphaned resources are found', async () => {
      const deptId = 'test-dept-orphaned'
      const mockMachine = {
        id: 'vm-1',
        name: 'Orphaned VM',
        internalName: 'orphaned-vm',
        configuration: {
          tapDeviceName: 'tap-orphaned'
        }
      }

      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [mockMachine],
        firewallRuleSet: null,
        bridgeName: null,
        firewallRuleSetId: null
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment as any)

      // Setup mock to find the machine (not empty)
      mockPrisma.machine.findMany.mockResolvedValue([mockMachine] as any)
      mockNftablesService.chainExists.mockResolvedValue(true)
      require('@infinibay/infinization').TapDeviceManager.mockImplementation(() => ({
        exists: jest.fn().mockResolvedValue(true)
      }))

      // Should throw error
      await expect(service.cleanupDepartment(deptId))
        .rejects
        .toThrow(/orphaned/i)

      // Department should NOT be deleted
      expect(mockPrisma.department.delete).not.toHaveBeenCalled()
    })

    it('should succeed when no orphaned resources exist', async () => {
      const deptId = 'test-dept-clean'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: null,
        bridgeName: null,
        firewallRuleSetId: null
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment as any)

      // Ensure findMany returns empty array
      mockPrisma.machine.findMany.mockResolvedValue([])

      const result = await service.cleanupDepartment(deptId)

      // Should succeed
      expect(result.success).toBe(true)

      // Department should be deleted
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
    })
  })
})
