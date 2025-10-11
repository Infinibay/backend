/**
 * Unit tests for DepartmentCleanupService
 */

import { PrismaClient, RuleSetType } from '@prisma/client'
import { DepartmentCleanupService } from '@services/cleanup/departmentCleanupService'

// Mock libvirt
jest.mock('@infinibay/libvirt-node', () => {
  class MockNWFilter {
    static lookupByName = jest.fn()
    static defineXml = jest.fn()
    undefine = jest.fn()
  }

  class MockConnection {
    static open = jest.fn(() => new MockConnection())
    close = jest.fn()
  }

  return {
    __esModule: true,
    Connection: MockConnection,
    NWFilter: MockNWFilter
  }
})

describe('DepartmentCleanupService', () => {
  let service: DepartmentCleanupService
  let mockPrisma: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Create mock Prisma
    mockPrisma = {
      department: {
        findUnique: jest.fn(),
        delete: jest.fn()
      },
      firewallRule: {
        deleteMany: jest.fn()
      },
      firewallRuleSet: {
        delete: jest.fn()
      },
      $transaction: jest.fn(async (callback) => {
        const mockTx = {
          department: mockPrisma.department,
          firewallRule: mockPrisma.firewallRule,
          firewallRuleSet: mockPrisma.firewallRuleSet
        }
        return callback(mockTx)
      })
    }

    service = new DepartmentCleanupService(mockPrisma as PrismaClient)
  })

  describe('cleanupDepartment', () => {
    it('should cleanup nwfilter when deleting department', async () => {
      const deptId = 'test-dept-123'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: {
          id: 'dept-ruleset-123',
          rules: [
            { id: 'dept-rule-1', name: 'Test Dept Rule' }
          ]
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter, Connection } = require('@infinibay/libvirt-node')
      const mockFilter = {
        undefine: jest.fn()
      }
      NWFilter.lookupByName.mockReturnValue(mockFilter)

      await service.cleanupDepartment(deptId)

      // Verify nwfilter was looked up and undefined
      expect(NWFilter.lookupByName).toHaveBeenCalled()
      const lookupCall = NWFilter.lookupByName.mock.calls[0]
      const [, filterName] = lookupCall

      // Filter name should match department ID pattern
      expect(filterName).toMatch(/^ibay-department-[a-f0-9]{8}$/)
      expect(mockFilter.undefine).toHaveBeenCalled()
    })

    it('should cleanup FirewallRuleSet and rules from database', async () => {
      const deptId = 'test-dept-456'
      const ruleSetId = 'dept-ruleset-456'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: {
          id: ruleSetId,
          rules: [
            { id: 'dept-rule-1', name: 'Rule 1' },
            { id: 'dept-rule-2', name: 'Rule 2' }
          ]
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null) // Filter doesn't exist

      await service.cleanupDepartment(deptId)

      // Verify FirewallRule deletion
      expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
        where: { ruleSetId }
      })

      // Verify FirewallRuleSet deletion
      expect(mockPrisma.firewallRuleSet.delete).toHaveBeenCalledWith({
        where: { id: ruleSetId }
      })
    })

    it('should not fail if nwfilter does not exist', async () => {
      const deptId = 'test-dept-789'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: null
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null) // Filter doesn't exist

      // Should not throw
      await expect(service.cleanupDepartment(deptId)).resolves.not.toThrow()

      // Verify department was deleted
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
    })

    it('should not fail if FirewallRuleSet does not exist', async () => {
      const deptId = 'test-dept-no-firewall'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: null // No firewall rules
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null)

      // Should not throw
      await expect(service.cleanupDepartment(deptId)).resolves.not.toThrow()

      // Firewall deletion methods should not be called
      expect(mockPrisma.firewallRule.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.firewallRuleSet.delete).not.toHaveBeenCalled()
    })

    it('should complete department deletion even if nwfilter cleanup fails', async () => {
      const deptId = 'test-dept-fail-filter'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: {
          id: 'dept-ruleset-fail',
          rules: []
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockImplementation(() => {
        throw new Error('Libvirt connection failed')
      })

      // Should not throw - cleanup should continue
      await expect(service.cleanupDepartment(deptId)).resolves.not.toThrow()

      // Department should still be deleted from database
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
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

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      // Should throw error
      await expect(service.cleanupDepartment(deptId))
        .rejects
        .toThrow(/Cannot cleanup department.*2 VMs still exist/)

      // Department should NOT be deleted
      expect(mockPrisma.department.delete).not.toHaveBeenCalled()
    })

    it('should return early if department not found', async () => {
      const deptId = 'non-existent-dept'
      mockPrisma.department.findUnique.mockResolvedValue(null)

      // Should not throw
      await expect(service.cleanupDepartment(deptId)).resolves.not.toThrow()

      // No deletion should occur
      expect(mockPrisma.department.delete).not.toHaveBeenCalled()
      expect(mockPrisma.firewallRule.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.firewallRuleSet.delete).not.toHaveBeenCalled()
    })

    it('should delete firewall resources before department', async () => {
      const deptId = 'test-dept-order'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: {
          id: 'dept-ruleset-order',
          rules: [{ id: 'dept-rule-1', name: 'Rule 1' }]
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null)

      await service.cleanupDepartment(deptId)

      // Verify deletion was attempted in correct order
      const ruleDeleteCallIndex = mockPrisma.firewallRule.deleteMany.mock.invocationCallOrder[0]
      const ruleSetDeleteCallIndex = mockPrisma.firewallRuleSet.delete.mock.invocationCallOrder[0]
      const deptDeleteCallIndex = mockPrisma.department.delete.mock.invocationCallOrder[0]

      // Rules → RuleSet → Department
      expect(ruleDeleteCallIndex).toBeLessThan(ruleSetDeleteCallIndex)
      expect(ruleSetDeleteCallIndex).toBeLessThan(deptDeleteCallIndex)
    })
  })
})
