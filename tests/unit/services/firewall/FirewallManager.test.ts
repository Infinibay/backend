import type { Connection } from '@infinibay/libvirt-node'
import { PrismaClient, RuleSetType } from '@prisma/client'

import { FirewallFilterFactory } from '@services/firewall/FirewallFilterFactory'
import { FirewallManager } from '@services/firewall/FirewallManager'
import { FirewallRuleService } from '@services/firewall/FirewallRuleService'

// Mock dependencies
jest.mock('@services/firewall/FirewallRuleService')
jest.mock('@services/firewall/FirewallFilterFactory')

describe('FirewallManager', () => {
  let manager: FirewallManager
  let mockPrisma: PrismaClient
  let mockConnection: Connection
  let mockRuleService: jest.Mocked<FirewallRuleService>
  let mockFilterFactory: jest.Mocked<FirewallFilterFactory>

  beforeEach(() => {
    // Create mock Prisma client
    mockPrisma = {
      machine: {
        findUnique: jest.fn()
      }
    } as unknown as PrismaClient

    mockConnection = {} as Connection

    // Create mock service instances
    mockRuleService = {
      createRuleSet: jest.fn()
    } as any

    mockFilterFactory = {
      ensureDepartmentFilter: jest.fn(),
      ensureVMFilter: jest.fn()
    } as any

    // Mock constructors
    ;(FirewallRuleService as jest.Mock).mockImplementation(() => mockRuleService)
    ;(FirewallFilterFactory as jest.Mock).mockImplementation(() => mockFilterFactory)

    manager = new FirewallManager(mockPrisma, mockConnection)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('ensureFirewallForVM', () => {
    const vmId = 'vm-123'
    const departmentId = 'dept-456'

    it('should throw error if VM not found', async () => {
      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(
        manager.ensureFirewallForVM(vmId, departmentId)
      ).rejects.toThrow('VM not found')
    })

    it('should throw error if VM has no department', async () => {
      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        department: null,
        firewallRuleSet: null
      })

      await expect(
        manager.ensureFirewallForVM(vmId, departmentId)
      ).rejects.toThrow('VM vm-123 has no department')
    })

    it('should throw error if departmentId does not match VM department', async () => {
      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        department: {
          id: 'different-dept-id',
          name: 'Different Department',
          firewallRuleSet: null
        },
        firewallRuleSet: null
      })

      await expect(
        manager.ensureFirewallForVM(vmId, departmentId)
      ).rejects.toThrow('Department ID mismatch')
    })

    it('should create department and VM rulesets if they do not exist', async () => {
      const mockVM = {
        id: vmId,
        name: 'Test VM',
        department: {
          id: departmentId,
          name: 'Engineering',
          firewallRuleSet: null
        },
        firewallRuleSet: null
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const mockDeptRuleSet = {
        id: 'ruleset-dept-1',
        name: 'Department Firewall: Engineering',
        internalName: 'ibay-department-abc123',
        entityType: RuleSetType.DEPARTMENT,
        entityId: departmentId,
        priority: 1000,
        rules: []
      }

      const mockVMRuleSet = {
        id: 'ruleset-vm-1',
        name: 'VM Firewall: Test VM',
        internalName: 'ibay-vm-def456',
        entityType: RuleSetType.VM,
        entityId: vmId,
        priority: 500,
        rules: []
      }

      mockRuleService.createRuleSet
        .mockResolvedValueOnce(mockDeptRuleSet as any)
        .mockResolvedValueOnce(mockVMRuleSet as any)

      // Mock VM filter creation (always created even with zero rules)
      const mockVMFilterResult = {
        filterName: 'ibay-vm-def456',
        libvirtUuid: 'uuid-vm',
        xmlContent: '<filter>...</filter>',
        rulesApplied: 0
      }
      mockFilterFactory.ensureVMFilter.mockResolvedValue(mockVMFilterResult)

      const result = await manager.ensureFirewallForVM(vmId, departmentId)

      expect(mockRuleService.createRuleSet).toHaveBeenCalledTimes(2)
      expect(mockRuleService.createRuleSet).toHaveBeenCalledWith(
        RuleSetType.DEPARTMENT,
        departmentId,
        'Department Firewall: Engineering',
        expect.stringMatching(/^ibay-department-/),
        1000
      )
      expect(mockRuleService.createRuleSet).toHaveBeenCalledWith(
        RuleSetType.VM,
        vmId,
        'VM Firewall: Test VM',
        expect.stringMatching(/^ibay-vm-/),
        500
      )

      expect(result.departmentRuleSetCreated).toBe(true)
      expect(result.vmRuleSetCreated).toBe(true)
      expect(result.success).toBe(true)
    })

    it('should create filters in libvirt when rulesets have rules', async () => {
      const mockDeptRule = {
        id: 'rule-1',
        name: 'Allow HTTPS',
        action: 'ACCEPT',
        direction: 'INOUT',
        priority: 500
      }

      const mockVMRule = {
        id: 'rule-2',
        name: 'Allow SSH',
        action: 'ACCEPT',
        direction: 'INOUT',
        priority: 500
      }

      const mockVM = {
        id: vmId,
        name: 'Test VM',
        department: {
          id: departmentId,
          name: 'Engineering',
          firewallRuleSet: {
            id: 'ruleset-dept-1',
            rules: [mockDeptRule]
          }
        },
        firewallRuleSet: {
          id: 'ruleset-vm-1',
          rules: [mockVMRule]
        }
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const mockDeptFilterResult = {
        filterName: 'ibay-department-abc123',
        libvirtUuid: 'uuid-dept',
        xmlContent: '<filter>...</filter>',
        rulesApplied: 1
      }

      const mockVMFilterResult = {
        filterName: 'ibay-vm-def456',
        libvirtUuid: 'uuid-vm',
        xmlContent: '<filter>...</filter>',
        rulesApplied: 1
      }

      mockFilterFactory.ensureDepartmentFilter.mockResolvedValue(mockDeptFilterResult)
      mockFilterFactory.ensureVMFilter.mockResolvedValue(mockVMFilterResult)

      const result = await manager.ensureFirewallForVM(vmId, departmentId)

      expect(mockFilterFactory.ensureDepartmentFilter).toHaveBeenCalledWith(departmentId)
      expect(mockFilterFactory.ensureVMFilter).toHaveBeenCalledWith(vmId)

      expect(result.departmentFilterName).toMatch(/^ibay-department-/)
      expect(result.vmFilterName).toMatch(/^ibay-vm-/)
      expect(result.departmentRulesApplied).toBe(1)
      expect(result.vmRulesApplied).toBe(1)
      expect(result.success).toBe(true)
    })

    it('should handle the case when filters already exist in libvirt', async () => {
      const mockVM = {
        id: vmId,
        name: 'Test VM',
        department: {
          id: departmentId,
          name: 'Engineering',
          firewallRuleSet: {
            id: 'ruleset-dept-1',
            rules: [{ id: 'rule-1' }]
          }
        },
        firewallRuleSet: {
          id: 'ruleset-vm-1',
          rules: [{ id: 'rule-2' }]
        }
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      // Simulate filter already exists error
      mockFilterFactory.ensureDepartmentFilter.mockRejectedValue(
        new Error('Filter already exists')
      )
      mockFilterFactory.ensureVMFilter.mockRejectedValue(
        new Error('Filter already exists')
      )

      const result = await manager.ensureFirewallForVM(vmId, departmentId)

      // Should still return success as this is a graceful error
      expect(result.success).toBe(true)
    })

    it('should create VM filter even with zero VM rules but skip department filter if no dept rules', async () => {
      const mockVM = {
        id: vmId,
        name: 'Test VM',
        department: {
          id: departmentId,
          name: 'Engineering',
          firewallRuleSet: {
            id: 'ruleset-dept-1',
            rules: []
          }
        },
        firewallRuleSet: {
          id: 'ruleset-vm-1',
          rules: []
        }
      }

      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)

      const mockVMFilterResult = {
        filterName: 'ibay-vm-def456',
        libvirtUuid: 'uuid-vm',
        xmlContent: '<filter>...</filter>',
        rulesApplied: 0
      }

      mockFilterFactory.ensureVMFilter.mockResolvedValue(mockVMFilterResult)

      const result = await manager.ensureFirewallForVM(vmId, departmentId)

      // Department filter should NOT be created (no rules)
      expect(mockFilterFactory.ensureDepartmentFilter).not.toHaveBeenCalled()

      // VM filter SHOULD be created (always created to establish inheritance)
      expect(mockFilterFactory.ensureVMFilter).toHaveBeenCalledWith(vmId)

      expect(result.departmentRulesApplied).toBe(0)
      expect(result.vmRulesApplied).toBe(0)
      expect(result.success).toBe(true)
    })
  })

  describe('getFilterNames', () => {
    const vmId = 'vm-123'
    const departmentId = 'dept-456'

    it('should throw error if VM not found', async () => {
      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(
        manager.getFilterNames(vmId)
      ).rejects.toThrow('VM not found')
    })

    it('should throw error if VM has no department', async () => {
      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        department: null
      })

      await expect(
        manager.getFilterNames(vmId)
      ).rejects.toThrow('VM vm-123 has no department')
    })

    it('should return filter names for VM and department', async () => {
      (mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        id: vmId,
        name: 'Test VM',
        department: {
          id: departmentId,
          name: 'Engineering'
        }
      })

      const result = await manager.getFilterNames(vmId)

      expect(result.departmentFilterName).toMatch(/^ibay-department-/)
      expect(result.vmFilterName).toMatch(/^ibay-vm-/)
    })
  })
})
