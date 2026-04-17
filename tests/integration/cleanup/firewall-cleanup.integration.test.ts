/**
 * Integration tests for firewall cleanup when deleting VMs and departments
 *
 * Tests verify:
 * 1. VM deletion cleans up firewall via infinization
 * 2. VM deletion removes FirewallRuleSet from database
 * 3. Department deletion removes FirewallRuleSet from database
 * 4. Graceful handling of missing resources
 */

import { PrismaClient, RuleSetType } from '@prisma/client'

import { MachineCleanupServiceV2 } from '@services/cleanup/machineCleanupServiceV2'
import { DepartmentCleanupService } from '@services/cleanup/departmentCleanupService'

// Mock infinization
const mockDestroyVM = jest.fn().mockResolvedValue({ success: true })
const mockGetNftablesService = jest.fn(() => ({
  chainExists: jest.fn().mockResolvedValue(false)
}))

jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => ({
    destroyVM: mockDestroyVM,
    getNftablesService: mockGetNftablesService
  }))
}))

// Mock TapDeviceManager and generateVMChainName from infinization
jest.mock('@infinibay/infinization', () => ({
  TapDeviceManager: jest.fn().mockImplementation(() => ({
    exists: jest.fn().mockResolvedValue(false)
  })),
  generateVMChainName: jest.fn((vmId: string) => `vm_${vmId.substring(0, 8)}`)
}))

// Mock VirtioSocketWatcherService
jest.mock('@services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => ({
    cleanupVmConnection: jest.fn()
  }))
}))

// Mock DepartmentNetworkService
jest.mock('@services/network/DepartmentNetworkService', () => ({
  DepartmentNetworkService: jest.fn().mockImplementation(() => ({
    destroyNetwork: jest.fn().mockResolvedValue(undefined),
    forceDestroyNetwork: jest.fn().mockResolvedValue({ success: true })
  }))
}))

// Mock fs/promises
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockRejectedValue({ code: 'ENOENT' })
}))

describe('Firewall Cleanup Integration Tests', () => {
  let mockPrisma: any
  let machineCleanupService: MachineCleanupServiceV2
  let departmentCleanupService: DepartmentCleanupService

  beforeEach(() => {
    jest.clearAllMocks()

    // Create comprehensive mock Prisma
    mockPrisma = {
      machine: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn()
      },
      department: {
        findUnique: jest.fn(),
        delete: jest.fn()
      },
      machineConfiguration: {
        delete: jest.fn().mockResolvedValue(undefined)
      },
      machineApplication: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      pendingCommand: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      scriptExecution: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      firewallRule: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      firewallRuleSet: {
        delete: jest.fn()
      },
      $transaction: jest.fn(async (callback: any) => {
        const mockTx = {
          machine: mockPrisma.machine,
          department: mockPrisma.department,
          machineConfiguration: mockPrisma.machineConfiguration,
          machineApplication: mockPrisma.machineApplication,
          pendingCommand: mockPrisma.pendingCommand,
          scriptExecution: mockPrisma.scriptExecution,
          firewallRule: mockPrisma.firewallRule,
          firewallRuleSet: mockPrisma.firewallRuleSet
        }
        return callback(mockTx)
      })
    }

    machineCleanupService = new MachineCleanupServiceV2(mockPrisma as PrismaClient)
    departmentCleanupService = new DepartmentCleanupService(mockPrisma as PrismaClient)
  })

  describe('VM Firewall Cleanup', () => {
    it('should clean up VM firewall via infinization when deleting VM', async () => {
      const vmId = 'test-vm-123'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-123',
          internalName: 'vm_testvmin',
          rules: [
            { id: 'rule-1', name: 'Allow HTTPS', action: 'ACCEPT', direction: 'IN', protocol: 'tcp', dstPortStart: 443, dstPortEnd: 443, priority: 100 }
          ]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      await machineCleanupService.cleanupVM(vmId)

      // Verify infinization.destroyVM was called (handles TAP + firewall chain cleanup)
      expect(mockDestroyVM).toHaveBeenCalledWith(vmId)
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
          internalName: 'vm_testvmin',
          rules: [
            { id: 'rule-1', name: 'Rule 1' },
            { id: 'rule-2', name: 'Rule 2' },
            { id: 'rule-3', name: 'Rule 3' }
          ]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

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

    it('should complete VM deletion gracefully if firewall does not exist', async () => {
      const vmId = 'test-vm-no-filter'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: null
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      // Should not throw
      await expect(machineCleanupService.cleanupVM(vmId)).resolves.not.toThrow()

      // Verify VM was still deleted from database
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: vmId }
      })
    })

    it('should complete VM deletion even if infinization cleanup fails', async () => {
      const vmId = 'test-vm-filter-error'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-error',
          internalName: 'vm_testvmin',
          rules: []
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)
      mockDestroyVM.mockResolvedValue({ success: false, error: 'Process not found' })

      // Should not throw - graceful degradation
      await expect(machineCleanupService.cleanupVM(vmId)).resolves.not.toThrow()

      // VM should still be deleted from database
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: vmId }
      })
    })
  })

  describe('Department Firewall Cleanup', () => {
    it('should remove department FirewallRuleSet and rules from database when deleting department', async () => {
      const deptId = 'dept-456'
      const ruleSetId = 'dept-ruleset-456'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        bridgeName: null,
        firewallRuleSetId: ruleSetId,
        firewallRuleSet: {
          id: ruleSetId,
          rules: [
            { id: 'dept-rule-1', name: 'Rule 1' },
            { id: 'dept-rule-2', name: 'Rule 2' }
          ]
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

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
        bridgeName: null,
        firewallRuleSetId: null,
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

    it('should complete department deletion gracefully if firewall does not exist', async () => {
      const deptId = 'dept-no-filter'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        bridgeName: null,
        firewallRuleSetId: null,
        firewallRuleSet: null
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      // Should not throw
      await expect(departmentCleanupService.cleanupDepartment(deptId)).resolves.not.toThrow()

      // Department should still be deleted from database
      expect(mockPrisma.department.delete).toHaveBeenCalledWith({
        where: { id: deptId }
      })
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
          internalName: 'vm_testvmin',
          rules: [{ id: 'rule-1', name: 'Rule 1' }]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      await machineCleanupService.cleanupVM(vmId)

      // Verify deletion order: rules before ruleset, ruleset before machine
      const ruleDeleteOrder = mockPrisma.firewallRule.deleteMany.mock.invocationCallOrder[0]
      const ruleSetDeleteOrder = mockPrisma.firewallRuleSet.delete.mock.invocationCallOrder[0]
      const machineDeleteOrder = mockPrisma.machine.delete.mock.invocationCallOrder[0]

      expect(ruleDeleteOrder).toBeLessThan(ruleSetDeleteOrder)
      expect(ruleSetDeleteOrder).toBeLessThan(machineDeleteOrder)
    })

    it('should delete department resources in correct order', async () => {
      const deptId = 'dept-order'
      const mockDepartment = {
        id: deptId,
        name: 'Test Department',
        machines: [],
        bridgeName: null,
        firewallRuleSetId: 'dept-ruleset-order',
        firewallRuleSet: {
          id: 'dept-ruleset-order',
          rules: [{ id: 'dept-rule-1', name: 'Rule 1' }]
        }
      }

      mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

      await departmentCleanupService.cleanupDepartment(deptId)

      // Verify deletion order
      const ruleDeleteOrder = mockPrisma.firewallRule.deleteMany.mock.invocationCallOrder[0]
      const ruleSetDeleteOrder = mockPrisma.firewallRuleSet.delete.mock.invocationCallOrder[0]
      const deptDeleteOrder = mockPrisma.department.delete.mock.invocationCallOrder[0]

      // Rules -> RuleSet -> Department
      expect(ruleDeleteOrder).toBeLessThan(ruleSetDeleteOrder)
      expect(ruleSetDeleteOrder).toBeLessThan(deptDeleteOrder)
    })
  })
})
