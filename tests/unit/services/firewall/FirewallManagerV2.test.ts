import 'reflect-metadata'
import { FirewallManagerV2 } from '../../../../app/services/firewall/FirewallManagerV2'
import { PrismaClient, RuleSetType } from '@prisma/client'

// Mock nftables
const mockNftables = {
  createVMChain: jest.fn(),
  applyRules: jest.fn(),
  removeVMChain: jest.fn(),
  flushVMRules: jest.fn()
}

// Mock InfinivirtService
jest.mock('../../../../app/services/InfinivirtService', () => ({
  getInfinivirt: jest.fn(() => Promise.resolve({
    getNftablesService: () => mockNftables
  }))
}))

describe('FirewallManagerV2', () => {
  let manager: FirewallManagerV2
  let mockPrisma: any

  const mockDepartment = {
    id: 'dept-123',
    name: 'Engineering',
    firewallRuleSet: {
      id: 'ruleset-dept-1',
      rules: [
        { id: 'rule-1', name: 'Allow HTTPS', action: 'ACCEPT', direction: 'INOUT', priority: 500 }
      ]
    }
  }

  const mockVM = {
    id: 'vm-123',
    name: 'Test VM',
    department: mockDepartment,
    firewallRuleSet: {
      id: 'ruleset-vm-1',
      rules: [
        { id: 'rule-2', name: 'Allow SSH', action: 'ACCEPT', direction: 'INOUT', priority: 500 }
      ]
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock Prisma
    mockPrisma = {
      machine: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      department: {
        update: jest.fn(),
        findUnique: jest.fn()
      },
      firewallRuleSet: {
        findFirst: jest.fn(),
        create: jest.fn()
      }
    }

    manager = new FirewallManagerV2(mockPrisma as PrismaClient)
  })

  describe('ensureFirewallInfrastructure', () => {
    it('should create ruleset for department if not exists', async () => {
      ;(mockPrisma.firewallRuleSet.findFirst as jest.Mock).mockResolvedValue(null)
      ;(mockPrisma.firewallRuleSet.create as jest.Mock).mockResolvedValue({
        id: 'ruleset-1',
        name: 'Department Firewall: Engineering',
        internalName: 'ibay-dept-abc12345'
      })
      ;(mockPrisma.department.update as jest.Mock).mockResolvedValue({})

      const result = await manager.ensureFirewallInfrastructure(
        RuleSetType.DEPARTMENT,
        'dept-123',
        'Department Firewall: Engineering'
      )

      expect(result.ruleSetCreated).toBe(true)
      expect(mockPrisma.firewallRuleSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: RuleSetType.DEPARTMENT,
          entityId: 'dept-123',
          priority: 1000
        })
      })
    })

    it('should create ruleset for VM if not exists', async () => {
      ;(mockPrisma.firewallRuleSet.findFirst as jest.Mock).mockResolvedValue(null)
      ;(mockPrisma.firewallRuleSet.create as jest.Mock).mockResolvedValue({
        id: 'ruleset-1',
        name: 'VM Firewall: Test VM',
        internalName: 'ibay-vm-abc12345'
      })
      ;(mockPrisma.machine.update as jest.Mock).mockResolvedValue({})

      const result = await manager.ensureFirewallInfrastructure(
        RuleSetType.VM,
        'vm-123',
        'VM Firewall: Test VM'
      )

      expect(result.ruleSetCreated).toBe(true)
      expect(mockPrisma.firewallRuleSet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityType: RuleSetType.VM,
          entityId: 'vm-123',
          priority: 500
        })
      })
    })

    it('should not create ruleset if already exists', async () => {
      ;(mockPrisma.firewallRuleSet.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-ruleset'
      })
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        firewallRuleSetId: 'existing-ruleset'
      })

      const result = await manager.ensureFirewallInfrastructure(
        RuleSetType.VM,
        'vm-123',
        'VM Firewall: Test VM'
      )

      expect(result.ruleSetCreated).toBe(false)
      expect(mockPrisma.firewallRuleSet.create).not.toHaveBeenCalled()
    })
  })

  describe('ensureFirewallForVM', () => {
    it('should setup complete firewall for VM', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      ;(mockPrisma.firewallRuleSet.findFirst as jest.Mock).mockResolvedValue({
        rules: []
      })
      mockNftables.createVMChain.mockResolvedValue('ibay-vm-123')
      mockNftables.applyRules.mockResolvedValue({
        appliedRules: 2,
        failedRules: 0
      })

      const result = await manager.ensureFirewallForVM(
        'vm-123',
        'dept-123',
        'tap-vm-123'
      )

      expect(result.success).toBe(true)
      expect(result.chainName).toBe('ibay-vm-123')
      expect(mockNftables.createVMChain).toHaveBeenCalledWith('vm-123', 'tap-vm-123')
      expect(mockNftables.applyRules).toHaveBeenCalledWith(
        'vm-123',
        'tap-vm-123',
        expect.any(Array),
        expect.any(Array)
      )
    })

    it('should throw error if VM not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(
        manager.ensureFirewallForVM('vm-123', 'dept-123', 'tap-vm-123')
      ).rejects.toThrow('VM not found')
    })

    it('should throw error if department mismatch', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        ...mockVM,
        department: { ...mockDepartment, id: 'different-dept' }
      })

      await expect(
        manager.ensureFirewallForVM('vm-123', 'dept-123', 'tap-vm-123')
      ).rejects.toThrow('Department mismatch')
    })
  })

  describe('resyncVMFirewall', () => {
    it('should resync firewall rules', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue(mockVM)
      ;(mockPrisma.firewallRuleSet.findFirst as jest.Mock).mockResolvedValue({
        rules: []
      })
      mockNftables.applyRules.mockResolvedValue({
        appliedRules: 2,
        failedRules: 0
      })

      const result = await manager.resyncVMFirewall('vm-123', 'tap-vm-123')

      expect(result.success).toBe(true)
      expect(result.chainApplied).toBe(true)
      expect(mockNftables.applyRules).toHaveBeenCalled()
    })

    it('should throw error if VM has no department', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock).mockResolvedValue({
        ...mockVM,
        department: null
      })

      await expect(
        manager.resyncVMFirewall('vm-123', 'tap-vm-123')
      ).rejects.toThrow('has no department')
    })
  })

  describe('removeVMFirewall', () => {
    it('should remove VM firewall chain', async () => {
      mockNftables.removeVMChain.mockResolvedValue(undefined)

      await manager.removeVMFirewall('vm-123')

      expect(mockNftables.removeVMChain).toHaveBeenCalledWith('vm-123')
    })

    it('should not throw on removal failure', async () => {
      mockNftables.removeVMChain.mockRejectedValue(new Error('Chain not found'))

      // Should not throw
      await expect(manager.removeVMFirewall('vm-123')).resolves.not.toThrow()
    })
  })

  describe('flushVMRules', () => {
    it('should flush VM firewall rules', async () => {
      mockNftables.flushVMRules.mockResolvedValue(undefined)

      await manager.flushVMRules('vm-123')

      expect(mockNftables.flushVMRules).toHaveBeenCalledWith('vm-123')
    })

    it('should not throw on flush failure', async () => {
      mockNftables.flushVMRules.mockRejectedValue(new Error('Chain not found'))

      // Should not throw
      await expect(manager.flushVMRules('vm-123')).resolves.not.toThrow()
    })
  })
})
