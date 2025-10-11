/**
 * Integration tests for firewall cleanup when deleting VMs and departments
 *
 * Tests verify:
 * 1. VM deletion removes nwfilter from libvirt
 * 2. VM deletion removes FirewallRuleSet from database
 * 3. Department deletion removes nwfilter from libvirt
 * 4. Department deletion removes FirewallRuleSet from database
 * 5. Graceful handling of missing resources
 */

import { PrismaClient, RuleSetType } from '@prisma/client'
import * as libvirtNode from '@infinibay/libvirt-node'

import { MachineCleanupService } from '@services/cleanup/machineCleanupService'
import { DepartmentCleanupService } from '@services/cleanup/departmentCleanupService'
import { NWFilterXMLGeneratorService } from '@services/firewall/NWFilterXMLGeneratorService'

// Mock libvirt
jest.mock('@infinibay/libvirt-node', () => {
  class MockNWFilter {
    static lookupByName = jest.fn()
    static defineXml = jest.fn()
    undefine = jest.fn()
  }

  class MockMachine {
    static lookupByName = jest.fn()
    destroy = jest.fn()
    undefine = jest.fn()
  }

  class MockConnection {
    static open = jest.fn(() => new MockConnection())
    close = jest.fn()
  }

  return {
    __esModule: true,
    Connection: MockConnection,
    Machine: MockMachine,
    NWFilter: MockNWFilter
  }
})

// Mock VirtioSocketWatcherService
jest.mock('@services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => ({
    cleanupVmConnection: jest.fn()
  }))
}))

// Mock XMLGenerator
jest.mock('@utils/VirtManager/xmlGenerator', () => ({
  XMLGenerator: jest.fn().mockImplementation(() => ({
    load: jest.fn(),
    getUefiVarFile: jest.fn(() => null),
    getDisks: jest.fn(() => [])
  }))
}))

describe('Firewall Cleanup Integration Tests', () => {
  let mockPrisma: any
  let machineCleanupService: MachineCleanupService
  let departmentCleanupService: DepartmentCleanupService
  let xmlGenerator: NWFilterXMLGeneratorService

  beforeEach(() => {
    jest.clearAllMocks()

    // Create comprehensive mock Prisma
    mockPrisma = {
      machine: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn()
      },
      department: {
        findUnique: jest.fn(),
        delete: jest.fn()
      },
      machineConfiguration: {
        delete: jest.fn()
      },
      machineApplication: {
        deleteMany: jest.fn()
      },
      firewallRule: {
        deleteMany: jest.fn()
      },
      firewallRuleSet: {
        delete: jest.fn()
      },
      $transaction: jest.fn(async (callback) => {
        const mockTx = {
          machine: mockPrisma.machine,
          department: mockPrisma.department,
          machineConfiguration: mockPrisma.machineConfiguration,
          machineApplication: mockPrisma.machineApplication,
          firewallRule: mockPrisma.firewallRule,
          firewallRuleSet: mockPrisma.firewallRuleSet
        }
        return callback(mockTx)
      })
    }

    machineCleanupService = new MachineCleanupService(mockPrisma as PrismaClient)
    departmentCleanupService = new DepartmentCleanupService(mockPrisma as PrismaClient)
    xmlGenerator = new NWFilterXMLGeneratorService()
  })

  describe('VM Firewall Cleanup', () => {
    it('should remove VM nwfilter from libvirt when deleting VM', async () => {
      const vmId = 'test-vm-123'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-123',
          rules: [
            { id: 'rule-1', name: 'Allow HTTPS', action: 'ACCEPT', direction: 'IN', protocol: 'tcp', dstPortStart: 443, dstPortEnd: 443, priority: 100 }
          ]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      const mockFilter = {
        undefine: jest.fn()
      }
      NWFilter.lookupByName.mockReturnValue(mockFilter)
      Machine.lookupByName.mockReturnValue(null) // VM already destroyed

      await machineCleanupService.cleanupVM(vmId)

      // Verify nwfilter was looked up
      expect(NWFilter.lookupByName).toHaveBeenCalled()
      const lookupCall = NWFilter.lookupByName.mock.calls[0]
      const [, filterName] = lookupCall

      // Verify filter name matches expected pattern
      const expectedFilterName = xmlGenerator.generateFilterName(RuleSetType.VM, vmId)
      expect(filterName).toBe(expectedFilterName)
      expect(filterName).toMatch(/^ibay-vm-[a-f0-9]{8}$/)

      // Verify filter was undefined (deleted)
      expect(mockFilter.undefine).toHaveBeenCalled()
    })

    it('should remove VM FirewallRuleSet and rules from database when deleting VM', async () => {
      const vmId = 'test-vm-456'
      const ruleSetId = 'ruleset-456'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: ruleSetId,
          rules: [
            { id: 'rule-1', name: 'Rule 1' },
            { id: 'rule-2', name: 'Rule 2' },
            { id: 'rule-3', name: 'Rule 3' }
          ]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null) // Filter doesn't exist
      Machine.lookupByName.mockReturnValue(null)

      await machineCleanupService.cleanupVM(vmId)

      // Verify FirewallRule deletion was called with correct ruleSetId
      expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
        where: { ruleSetId }
      })

      // Verify FirewallRuleSet deletion was called
      expect(mockPrisma.firewallRuleSet.delete).toHaveBeenCalledWith({
        where: { id: ruleSetId }
      })

      // Verify deletion order: rules before ruleset
      const ruleDeleteCallIndex = mockPrisma.firewallRule.deleteMany.mock.invocationCallOrder[0]
      const ruleSetDeleteCallIndex = mockPrisma.firewallRuleSet.delete.mock.invocationCallOrder[0]
      expect(ruleDeleteCallIndex).toBeLessThan(ruleSetDeleteCallIndex)
    })

    it('should complete VM deletion gracefully if nwfilter does not exist', async () => {
      const vmId = 'test-vm-no-filter'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: null
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null) // Filter doesn't exist
      Machine.lookupByName.mockReturnValue(null)

      // Should not throw
      await expect(machineCleanupService.cleanupVM(vmId)).resolves.not.toThrow()

      // Verify VM was still deleted from database
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: vmId }
      })
    })

    it('should complete VM deletion even if nwfilter cleanup fails', async () => {
      const vmId = 'test-vm-filter-error'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-error',
          rules: []
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockImplementation(() => {
        throw new Error('Libvirt connection failed')
      })
      Machine.lookupByName.mockReturnValue(null)

      // Should not throw - graceful degradation
      await expect(machineCleanupService.cleanupVM(vmId)).resolves.not.toThrow()

      // VM should still be deleted from database
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: vmId }
      })
    })
  })

  describe('Department Firewall Cleanup', () => {
    it('should remove department nwfilter from libvirt when deleting department', async () => {
      const deptId = 'dept-123'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [], // No machines
        firewallRuleSet: {
          id: 'dept-ruleset-123',
          rules: [
            { id: 'dept-rule-1', name: 'Dept HTTPS', action: 'ACCEPT', direction: 'IN', protocol: 'tcp', dstPortStart: 443, dstPortEnd: 443, priority: 100 }
          ]
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter } = require('@infinibay/libvirt-node')
      const mockFilter = {
        undefine: jest.fn()
      }
      NWFilter.lookupByName.mockReturnValue(mockFilter)

      await departmentCleanupService.cleanupDepartment(deptId)

      // Verify nwfilter was looked up
      expect(NWFilter.lookupByName).toHaveBeenCalled()
      const lookupCall = NWFilter.lookupByName.mock.calls[0]
      const [, filterName] = lookupCall

      // Verify filter name matches expected pattern
      const expectedFilterName = xmlGenerator.generateFilterName(RuleSetType.DEPARTMENT, deptId)
      expect(filterName).toBe(expectedFilterName)
      expect(filterName).toMatch(/^ibay-department-[a-f0-9]{8}$/)

      // Verify filter was undefined (deleted)
      expect(mockFilter.undefine).toHaveBeenCalled()
    })

    it('should remove department FirewallRuleSet and rules from database when deleting department', async () => {
      const deptId = 'dept-456'
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

      await departmentCleanupService.cleanupDepartment(deptId)

      // Verify FirewallRule deletion was called
      expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
        where: { ruleSetId }
      })

      // Verify FirewallRuleSet deletion was called
      expect(mockPrisma.firewallRuleSet.delete).toHaveBeenCalledWith({
        where: { id: ruleSetId }
      })

      // Verify department deletion was called
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
    })

    it('should throw error if department has VMs', async () => {
      const deptId = 'dept-with-vms'
      const mockDepartment = {
        id: deptId,
        name: 'Department with VMs',
        machines: [
          { id: 'vm-1', name: 'VM 1' },
          { id: 'vm-2', name: 'VM 2' }
        ],
        firewallRuleSet: null
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      // Should throw error
      await expect(departmentCleanupService.cleanupDepartment(deptId))
        .rejects
        .toThrow('Cannot cleanup department dept-with-vms: 2 VMs still exist')

      // Department should NOT be deleted
      expect(mockPrisma.department.delete).not.toHaveBeenCalled()
    })

    it('should complete department deletion gracefully if nwfilter does not exist', async () => {
      const deptId = 'dept-no-filter'
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
      await expect(departmentCleanupService.cleanupDepartment(deptId)).resolves.not.toThrow()

      // Department should still be deleted from database
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
    })

    it('should complete department deletion even if nwfilter cleanup fails', async () => {
      const deptId = 'dept-filter-error'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        firewallRuleSet: {
          id: 'dept-ruleset-error',
          rules: []
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      const { NWFilter } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockImplementation(() => {
        throw new Error('Libvirt connection failed')
      })

      // Should not throw - graceful degradation
      await expect(departmentCleanupService.cleanupDepartment(deptId)).resolves.not.toThrow()

      // Department should still be deleted from database
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
    })
  })

  describe('Filter Name Generation Consistency', () => {
    it('should generate consistent filter names for same entity', () => {
      const vmId = 'test-vm-999'
      const deptId = 'dept-999'

      // Generate names multiple times
      const vmName1 = xmlGenerator.generateFilterName(RuleSetType.VM, vmId)
      const vmName2 = xmlGenerator.generateFilterName(RuleSetType.VM, vmId)
      const deptName1 = xmlGenerator.generateFilterName(RuleSetType.DEPARTMENT, deptId)
      const deptName2 = xmlGenerator.generateFilterName(RuleSetType.DEPARTMENT, deptId)

      // Names should be consistent
      expect(vmName1).toBe(vmName2)
      expect(deptName1).toBe(deptName2)

      // Names should be different for different entity types
      expect(vmName1).not.toBe(deptName1)
    })

    it('should generate names matching expected patterns', () => {
      const vmId = 'test-vm-abc'
      const deptId = 'dept-xyz'

      const vmName = xmlGenerator.generateFilterName(RuleSetType.VM, vmId)
      const deptName = xmlGenerator.generateFilterName(RuleSetType.DEPARTMENT, deptId)

      // Verify patterns
      expect(vmName).toMatch(/^ibay-vm-[a-f0-9]{8}$/)
      expect(deptName).toMatch(/^ibay-department-[a-f0-9]{8}$/)
    })
  })

  describe('Cleanup Order and Transaction Safety', () => {
    it('should delete VM resources in correct order', async () => {
      const vmId = 'test-vm-order'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: { id: 'config-1', machineId: vmId },
        firewallRuleSet: {
          id: 'ruleset-order',
          rules: [{ id: 'rule-1', name: 'Rule 1' }]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null)
      Machine.lookupByName.mockReturnValue(null)

      await machineCleanupService.cleanupVM(vmId)

      // Verify deletion order
      const configDeleteOrder = mockPrisma.machineConfiguration.delete.mock.invocationCallOrder[0]
      const appDeleteOrder = mockPrisma.machineApplication.deleteMany.mock.invocationCallOrder[0]
      const ruleDeleteOrder = mockPrisma.firewallRule.deleteMany.mock.invocationCallOrder[0]
      const ruleSetDeleteOrder = mockPrisma.firewallRuleSet.delete.mock.invocationCallOrder[0]
      const machineDeleteOrder = mockPrisma.machine.delete.mock.invocationCallOrder[0]

      // Configuration, applications, rules, ruleset should be deleted before machine
      expect(configDeleteOrder).toBeLessThan(machineDeleteOrder)
      expect(appDeleteOrder).toBeLessThan(machineDeleteOrder)
      expect(ruleDeleteOrder).toBeLessThan(ruleSetDeleteOrder)
      expect(ruleSetDeleteOrder).toBeLessThan(machineDeleteOrder)
    })

    it('should delete department resources in correct order', async () => {
      const deptId = 'dept-order'
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

      await departmentCleanupService.cleanupDepartment(deptId)

      // Verify deletion order
      const ruleDeleteOrder = mockPrisma.firewallRule.deleteMany.mock.invocationCallOrder[0]
      const ruleSetDeleteOrder = mockPrisma.firewallRuleSet.delete.mock.invocationCallOrder[0]
      const deptDeleteOrder = mockPrisma.department.delete.mock.invocationCallOrder[0]

      // Rules → RuleSet → Department
      expect(ruleDeleteOrder).toBeLessThan(ruleSetDeleteOrder)
      expect(ruleSetDeleteOrder).toBeLessThan(deptDeleteOrder)
    })
  })
})
