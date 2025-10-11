/**
 * Tests for firewall cleanup in MachineCleanupService
 */

import { PrismaClient, RuleSetType } from '@prisma/client'
import { MachineCleanupService } from '@services/cleanup/machineCleanupService'

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

describe('MachineCleanupService - Firewall Cleanup', () => {
  let service: MachineCleanupService
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
        deleteMany: jest.fn()
      },
      firewallRule: {
        deleteMany: jest.fn()
      },
      firewallRuleSet: {
        delete: jest.fn()
      },
      $transaction: jest.fn(async (callback) => {
        // Execute transaction callback with mock tx
        const mockTx = {
          machine: mockPrisma.machine,
          machineConfiguration: mockPrisma.machineConfiguration,
          machineApplication: mockPrisma.machineApplication,
          firewallRule: mockPrisma.firewallRule,
          firewallRuleSet: mockPrisma.firewallRuleSet
        }
        return callback(mockTx)
      })
    }

    service = new MachineCleanupService(mockPrisma as PrismaClient)
  })

  describe('cleanupVM', () => {
    it('should cleanup nwfilter when deleting VM', async () => {
      const vmId = 'test-vm-123'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-123',
          rules: [
            { id: 'rule-1', name: 'Test Rule' }
          ]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine, Connection } = require('@infinibay/libvirt-node')
      const mockFilter = {
        undefine: jest.fn()
      }
      NWFilter.lookupByName.mockReturnValue(mockFilter)
      Machine.lookupByName.mockReturnValue(null) // VM already destroyed

      await service.cleanupVM(vmId)

      // Verify nwfilter was looked up and undefined
      expect(NWFilter.lookupByName).toHaveBeenCalled()
      const lookupCall = NWFilter.lookupByName.mock.calls[0]
      const [, filterName] = lookupCall

      // Filter name should match VM ID pattern
      expect(filterName).toMatch(/^ibay-vm-[a-f0-9]{8}$/)
      expect(mockFilter.undefine).toHaveBeenCalled()
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
          rules: [
            { id: 'rule-1', name: 'Rule 1' },
            { id: 'rule-2', name: 'Rule 2' }
          ]
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null) // Filter doesn't exist
      Machine.lookupByName.mockReturnValue(null)

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

    it('should not fail if nwfilter does not exist', async () => {
      const vmId = 'test-vm-789'
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
      await expect(service.cleanupVM(vmId)).resolves.not.toThrow()

      // Verify VM was deleted
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: vmId }
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

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null)
      Machine.lookupByName.mockReturnValue(null)

      // Should not throw
      await expect(service.cleanupVM(vmId)).resolves.not.toThrow()

      // Firewall deletion methods should not be called
      expect(mockPrisma.firewallRule.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.firewallRuleSet.delete).not.toHaveBeenCalled()
    })

    it('should complete VM deletion even if nwfilter cleanup fails', async () => {
      const vmId = 'test-vm-fail-filter'
      const mockVM = {
        id: vmId,
        internalName: 'test-vm-internal',
        configuration: null,
        firewallRuleSet: {
          id: 'ruleset-fail',
          rules: []
        }
      }

      mockPrisma.machine.findUnique.mockResolvedValue(mockVM)

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockImplementation(() => {
        throw new Error('Libvirt connection failed')
      })
      Machine.lookupByName.mockReturnValue(null)

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

      const { NWFilter, Machine } = require('@infinibay/libvirt-node')
      NWFilter.lookupByName.mockReturnValue(null)
      Machine.lookupByName.mockReturnValue(null)

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
