/**
 * Tests for firewall cleanup in MachineCleanupServiceV2
 */

import { PrismaClient, RuleSetType } from '@prisma/client'
import { MachineCleanupServiceV2 } from '@services/cleanup/machineCleanupServiceV2'

// Mock infinization
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => ({
    destroyVM: jest.fn().mockResolvedValue({ success: true })
  }))
}))

// Mock VirtioSocketWatcherService
jest.mock('@services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => ({
    cleanupVmConnection: jest.fn()
  }))
}))

// Mock fs/promises
jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockRejectedValue({ code: 'ENOENT' })
}))

describe('MachineCleanupServiceV2 - Firewall Cleanup', () => {
  let service: MachineCleanupServiceV2
  let mockPrisma: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Create mock Prisma
    mockPrisma = {
      machine: {
        findUnique: jest.fn(),
        delete: jest.fn()
      },
      machineConfiguration: {
        delete: jest.fn()
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
        // Execute transaction callback with mock tx
        const mockTx = {
          machine: mockPrisma.machine,
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

    service = new MachineCleanupServiceV2(mockPrisma as PrismaClient)
  })

  describe('cleanupVM', () => {
    it('should cleanup firewall resources via infinization when deleting VM', async () => {
      const vmId = 'test-vm-123'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-123',
          internalName: 'vm_abc12345',
          rules: [
            { id: 'rule-1', name: 'Test Rule' }
          ]
        }
      }

      // First call for initial lookup, second call inside transaction for firewall cleanup
      mockPrisma.machine.findUnique
        .mockResolvedValueOnce(mockVM)
        .mockResolvedValueOnce(mockVM)
        .mockResolvedValue(mockVM)

      const { getInfinization } = require('@services/InfinizationService')
      const mockInfinization = {
        destroyVM: jest.fn().mockResolvedValue({ success: true })
      }
      getInfinization.mockResolvedValue(mockInfinization)

      await service.cleanupVM(vmId)

      // Verify infinization.destroyVM was called (handles TAP + firewall chain cleanup)
      expect(mockInfinization.destroyVM).toHaveBeenCalledWith(vmId)
    })

    it('should cleanup FirewallRuleSet and rules from database', async () => {
      const vmId = 'test-vm-456'
      const ruleSetId = 'ruleset-456'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: ruleSetId,
          internalName: 'vm_def12345',
          rules: [
            { id: 'rule-1', name: 'Rule 1' },
            { id: 'rule-2', name: 'Rule 2' }
          ]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { getInfinization } = require('@services/InfinizationService')
      getInfinization.mockResolvedValue({
        destroyVM: jest.fn().mockResolvedValue({ success: true })
      })

      await service.cleanupVM(vmId)

      // Verify FirewallRule deletion
      expect(mockPrisma.firewallRule.deleteMany).toHaveBeenCalledWith({
        where: { ruleSetId }
      })

      // Verify FirewallRuleSet deletion
      expect(mockPrisma.firewallRuleSet.delete).toHaveBeenCalledWith({
        where: { id: ruleSetId }
      })
    })

    it('should not fail if FirewallRuleSet does not exist', async () => {
      const vmId = 'test-vm-no-firewall'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: null // No firewall rules
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { getInfinization } = require('@services/InfinizationService')
      getInfinization.mockResolvedValue({
        destroyVM: jest.fn().mockResolvedValue({ success: true })
      })

      // Should not throw
      await expect(service.cleanupVM(vmId)).resolves.not.toThrow()

      // Firewall deletion methods should not be called
      expect(mockPrisma.firewallRule.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.firewallRuleSet.delete).not.toHaveBeenCalled()
    })

    it('should complete VM deletion even if infinization cleanup fails', async () => {
      const vmId = 'test-vm-fail-infini'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-fail',
          internalName: 'vm_fail1234',
          rules: []
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { getInfinization } = require('@services/InfinizationService')
      getInfinization.mockResolvedValue({
        destroyVM: jest.fn().mockResolvedValue({ success: false, error: 'Process not found' })
      })

      // Should not throw - cleanup should continue
      await expect(service.cleanupVM(vmId)).resolves.not.toThrow()

      // VM should still be deleted from database
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: vmId }
      })
    })

    it('should delete machine applications before VM', async () => {
      const vmId = 'test-vm-apps'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: null
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { getInfinization } = require('@services/InfinizationService')
      getInfinization.mockResolvedValue({
        destroyVM: jest.fn().mockResolvedValue({ success: true })
      })

      await service.cleanupVM(vmId)

      // Verify deletion order (applications before machine)
      expect(mockPrisma.machineApplication.deleteMany).toHaveBeenCalledWith({
        where: { machineId: vmId }
      })
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: vmId }
      })
    })
  })
})
