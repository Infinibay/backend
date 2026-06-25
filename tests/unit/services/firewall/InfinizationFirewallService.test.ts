import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { InfinizationFirewallService } from '@services/firewall/InfinizationFirewallService'
import { type NftablesError, VM_CHAIN_PREFIX } from '@infinibay/infinization'
import { getInfinization } from '@services/InfinizationService'

// Mock NftablesService. generateVMChainName is stubbed to a reversible form so the
// listVMChains DB reverse-map (chain name -> vmId) is easy to assert in tests; the
// real implementation hashes the vmId (non-invertible) — see firewall.types.
jest.mock('@infinibay/infinization', () => ({
  NftablesService: jest.fn(),
  VM_CHAIN_PREFIX: 'vm_',
  generateVMChainName: (id: string) => `vm_${id}`
}))

// The service now uses the SHARED NftablesService via getInfinization() (I2) instead
// of constructing its own — mock the accessor to hand back our mock instance.
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn()
}))

describe('InfinizationFirewallService', () => {
  let service: InfinizationFirewallService
  let mockPrisma: DeepMockProxy<PrismaClient>
  let mockNftablesService: any
  let mockInitialize: jest.Mock
  let mockApplyRules: jest.Mock
  let mockRemoveVMChain: jest.Mock
  let mockListChains: jest.Mock

  const mockVM = {
    id: 'vm-123',
    name: 'Test VM',
    configuration: {
      tapDeviceName: 'tap-vm-123'
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock functions
    mockInitialize = jest.fn()
    mockApplyRules = jest.fn()
    mockRemoveVMChain = jest.fn()
    mockListChains = jest.fn()

    mockPrisma = mockDeep<PrismaClient>()

    mockNftablesService = {
      initialize: mockInitialize,
      applyRules: mockApplyRules,
      removeVMChain: mockRemoveVMChain,
      removeVMChainByName: jest.fn(),
      listChains: mockListChains
    }

    ;(getInfinization as jest.Mock).mockResolvedValue({
      getNftablesService: () => mockNftablesService
    })

    service = new InfinizationFirewallService(mockPrisma)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('initialize', () => {
    it('should initialize nftables service successfully', async () => {
      mockInitialize.mockResolvedValue(undefined)

      await service.initialize()

      expect(mockInitialize).toHaveBeenCalledTimes(1)
    })

    it('should throw error if initialization fails', async () => {
      const error = new Error('Failed to initialize')
      mockInitialize.mockRejectedValue(error)

      await expect(service.initialize()).rejects.toThrow('Failed to initialize')
      expect(mockInitialize).toHaveBeenCalledTimes(1)
    })

    it('should handle NftablesError with structured details', async () => {
      const nftError = new Error('Failed to initialize') as any
      nftError.code = 'INIT_FAILED'
      nftError.context = { reason: 'permission denied' }
      mockInitialize.mockRejectedValue(nftError)

      await expect(service.initialize()).rejects.toThrow()
      expect(mockInitialize).toHaveBeenCalledTimes(1)
    })
  })

  describe('applyVMRules', () => {
    beforeEach(() => {
      // Default mock behavior
      mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)
      mockApplyRules.mockResolvedValue({
        appliedRules: 5,
        totalRules: 5,
        failedRules: 0,
        failures: []
      })
    })

    it('should throw error if VM ID is missing', async () => {
      await expect(service.applyVMRules('', [], [])).rejects.toThrow('VM ID is required')
    })

    it('should throw error if VM not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.applyVMRules('nonexistent-vm', [], []))
        .rejects.toThrow('VM not found: nonexistent-vm')
    })

    it('should throw error if TAP device not configured', async () => {
      const vmWithoutTap = { ...mockVM, configuration: null }
      mockPrisma.machine.findUnique.mockResolvedValue(vmWithoutTap as any)

      await expect(service.applyVMRules('vm-123', [], []))
        .rejects.toThrow('VM configuration not found for VM: vm-123')
    })

    it('should apply VM rules successfully', async () => {
      const departmentRules = [{ name: 'Dept Rule 1' }] as any[]
      const vmRules = [{ name: 'VM Rule 1' }] as any[]

      const result = await service.applyVMRules('vm-123', departmentRules, vmRules)

      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: 'vm-123' },
        include: { configuration: true }
      })
      expect(mockApplyRules).toHaveBeenCalledWith(
        'vm-123',
        'tap-vm-123',
        departmentRules,
        vmRules,
        // Terminal posture defaults to fail-closed 'drop' when no policy is threaded.
        'drop'
      )
      expect(result).toEqual({
        appliedRules: 5,
        totalRules: 5,
        failedRules: 0,
        failures: []
      })
    })

    it('should log and return partial failures', async () => {
      const failures = [
        { ruleName: 'Rule 1', error: 'Connection refused' }
      ]
      mockApplyRules.mockResolvedValue({
        appliedRules: 4,
        totalRules: 5,
        failedRules: 1,
        failures
      })

      const result = await service.applyVMRules('vm-123', [], [])

      expect(result.failedRules).toBe(1)
      expect(result.failures).toEqual(failures)
    })

    it('should throw error if nftables operation fails', async () => {
      const error = new Error('nftables error') as any
      error.code = 'RULE_APPLY_FAILED'
      mockApplyRules.mockRejectedValue(error)

      await expect(service.applyVMRules('vm-123', [], []))
        .rejects.toThrow('nftables error')
    })
  })

  describe('applyDepartmentRules', () => {
    const mockDepartment = {
      id: 'dept-123',
      name: 'Engineering'
    }

    const mockVMs = [
      {
        id: 'vm-1',
        name: 'Web Server',
        configuration: { tapDeviceName: 'tap-v1' },
        firewallRuleSet: { rules: [{ id: 'r1' }] }
      },
      {
        id: 'vm-2',
        name: 'Database',
        configuration: { tapDeviceName: 'tap-v2' },
        firewallRuleSet: { rules: [{ id: 'r2' }] }
      }
    ]

    beforeEach(() => {
      mockPrisma.machine.findMany.mockResolvedValue(mockVMs as any)
      mockApplyRules.mockResolvedValue({
        appliedRules: 1,
        totalRules: 1,
        failedRules: 0,
        failures: []
      })
    })

    it('should throw error if department ID is missing', async () => {
      await expect(service.applyDepartmentRules('', [])).rejects.toThrow('Department ID is required')
    })

    it('should apply department rules to all VMs in department', async () => {
      const departmentRules = [{ name: 'Dept Rule 1' }] as any[]

      const result = await service.applyDepartmentRules('dept-123', departmentRules)

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        where: { departmentId: 'dept-123' },
        include: {
          configuration: true,
          firewallRuleSet: { include: { rules: true } }
        }
      })
      expect(result.totalVms).toBe(2)
      expect(result.vmsUpdated).toBe(2)
      expect(result.errors).toEqual([])
    })

    it('should DEFER (not fail) VMs without a TAP device', async () => {
      const vmWithoutTap = { ...mockVMs[0], configuration: null }
      mockPrisma.machine.findMany.mockResolvedValue([vmWithoutTap, mockVMs[1]] as any)

      const departmentRules = [{ name: 'Dept Rule 1' }] as any[]
      const result = await service.applyDepartmentRules('dept-123', departmentRules)

      // A VM with no TAP is not running — it's a deferral counted separately, NOT an
      // error (callers no longer string-match "no TAP device" to tell them apart).
      expect(result.vmsUpdated).toBe(1)
      expect(result.vmsSkippedNoTap).toBe(1)
      expect(result.vmsFailed).toBe(0)
      expect(result.errors.length).toBe(0)
    })

    it('should count partial failures as FAILED, not updated', async () => {
      mockApplyRules.mockResolvedValue({
        appliedRules: 0,
        totalRules: 1,
        failedRules: 1,
        failures: [{ ruleName: 'Rule 1', error: 'Connection refused' }]
      })

      const departmentRules = [{ name: 'Dept Rule 1' }] as any[]
      const result = await service.applyDepartmentRules('dept-123', departmentRules)

      expect(result.vmsUpdated).toBe(0)
      expect(result.vmsFailed).toBe(2)
      expect(result.errors.length).toBe(2)
      expect(result.errors[0]).toContain('rules failed')
    })

    it('should handle hard failures gracefully', async () => {
      mockApplyRules.mockRejectedValue(new Error('Network unreachable'))

      const departmentRules = [{ name: 'Dept Rule 1' }] as any[]
      const result = await service.applyDepartmentRules('dept-123', departmentRules)

      expect(result.vmsUpdated).toBe(0)
      expect(result.errors.length).toBe(2)
      expect(result.errors[0]).toContain('Network unreachable')
    })

    it('should return 0 VMs if department has no VMs', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([])

      const departmentRules = [{ name: 'Dept Rule 1' }] as any[]
      const result = await service.applyDepartmentRules('dept-123', departmentRules)

      expect(result.totalVms).toBe(0)
      expect(result.vmsUpdated).toBe(0)
      expect(result.errors).toEqual([])
    })
  })

  describe('removeVMFirewall', () => {
    it('should throw error if VM ID is missing', async () => {
      await expect(service.removeVMFirewall('')).rejects.toThrow('VM ID is required')
    })

    it('should remove VM firewall chain', async () => {
      await service.removeVMFirewall('vm-123')

      expect(mockRemoveVMChain).toHaveBeenCalledWith('vm-123')
    })

    it('should not throw on removal failure', async () => {
      // Mock does not throw
      await expect(service.removeVMFirewall('vm-123')).resolves.not.toThrow()
    })
  })

  describe('listVMChains', () => {
    it('should list all VM firewall chains', async () => {
      const mockChains = [
        'vm_vm123',
        'vm_vm456',
        'some-other-chain'
      ]
      mockListChains.mockResolvedValue(mockChains)
      // listVMChains reverse-maps chain names to vmIds via the DB (the name is a
      // non-invertible hash of the id). With the stubbed generator (vm_<id>), these
      // machines map to the listed chains.
      mockPrisma.machine.findMany.mockResolvedValue([
        { id: 'vm123' }, { id: 'vm456' }
      ] as never)

      const result = await service.listVMChains()

      expect(mockListChains).toHaveBeenCalledTimes(1)
      expect(result).toEqual([
        { chainName: 'vm_vm123', vmId: 'vm123' },
        { chainName: 'vm_vm456', vmId: 'vm456' }
      ])
    })

    it('should return empty array if no VM chains exist', async () => {
      mockListChains.mockResolvedValue(['other-chain-1', 'other-chain-2'])

      const result = await service.listVMChains()

      expect(result).toEqual([])
    })

    it('should throw error if listing chains fails', async () => {
      mockListChains.mockRejectedValue(new Error('Failed to list chains'))

      await expect(service.listVMChains()).rejects.toThrow('Failed to list chains')
    })
  })

  describe('convertPrismaRulesToInput', () => {
    it('should convert Prisma rules to FirewallRuleInput format', () => {
      const prismaRules = [
        {
          id: 'rule-1',
          name: 'Allow HTTP',
          description: 'Allow incoming HTTP',
          action: 'ACCEPT',
          direction: 'IN',
          priority: 100,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          srcPortStart: null,
          srcPortEnd: null,
          srcIpAddr: null,
          srcIpMask: null,
          dstIpAddr: null,
          dstIpMask: null,
          connectionState: null,
          overridesDept: false
        }
      ]

      const result = service.convertPrismaRulesToInput(prismaRules as any)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Allow HTTP')
      expect(result[0].action).toBe('ACCEPT')
      expect(result[0].direction).toBe('IN')
    })

    it('should handle empty array', () => {
      const result = service.convertPrismaRulesToInput([])
      expect(result).toEqual([])
    })

    it('should convert all fields correctly', () => {
      const prismaRules = [
        {
          id: 'rule-1',
          name: 'Test',
          description: 'Test desc',
          action: 'DROP',
          direction: 'INOUT',
          priority: 50,
          protocol: 'udp',
          dstPortStart: 53,
          dstPortEnd: 53,
          srcPortStart: 1024,
          srcPortEnd: 65535,
          srcIpAddr: '192.168.1.0',
          srcIpMask: '255.255.255.0',
          dstIpAddr: '8.8.8.8',
          dstIpMask: '255.255.255.255',
          connectionState: { states: ['ESTABLISHED'] },
          overridesDept: true
        }
      ]

      const result = service.convertPrismaRulesToInput(prismaRules as any)

      expect(result[0].id).toBe('rule-1')
      expect(result[0].name).toBe('Test')
      expect(result[0].description).toBe('Test desc')
      expect(result[0].action).toBe('DROP')
      expect(result[0].direction).toBe('INOUT')
      expect(result[0].priority).toBe(50)
      expect(result[0].protocol).toBe('udp')
      expect(result[0].dstPortStart).toBe(53)
      expect(result[0].dstPortEnd).toBe(53)
      expect(result[0].srcPortStart).toBe(1024)
      expect(result[0].srcPortEnd).toBe(65535)
      expect(result[0].srcIpAddr).toBe('192.168.1.0')
      expect(result[0].srcIpMask).toBe('255.255.255.0')
      expect(result[0].dstIpAddr).toBe('8.8.8.8')
      expect(result[0].dstIpMask).toBe('255.255.255.255')
      expect(result[0].overridesDept).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle VMs with empty firewallRuleSet', async () => {
      const vm = {
        id: 'vm-1',
        name: 'Test VM',
        configuration: { tapDeviceName: 'tap-v1' },
        firewallRuleSet: null
      }
      mockPrisma.machine.findMany.mockResolvedValue([vm] as any)
      mockApplyRules.mockResolvedValue({
        appliedRules: 0,
        totalRules: 0,
        failedRules: 0,
        failures: []
      })

      const result = await service.applyDepartmentRules('dept-123', [])

      expect(result.vmsUpdated).toBe(1)
    })

    it('should handle VMs with empty rules array', async () => {
      const vm = {
        id: 'vm-1',
        name: 'Test VM',
        configuration: { tapDeviceName: 'tap-v1' },
        firewallRuleSet: { rules: [] }
      }
      mockPrisma.machine.findMany.mockResolvedValue([vm] as any)
      mockApplyRules.mockResolvedValue({
        appliedRules: 0,
        totalRules: 0,
        failedRules: 0,
        failures: []
      })

      const result = await service.applyDepartmentRules('dept-123', [])

      expect(result.vmsUpdated).toBe(1)
    })

    it('should handle multiple VMs with mixed success', async () => {
      const vm1 = { id: 'vm-1', name: 'VM1', configuration: { tapDeviceName: 'tap-v1' }, firewallRuleSet: { rules: [] } }
      const vm2 = { id: 'vm-2', name: 'VM2', configuration: { tapDeviceName: 'tap-v2' }, firewallRuleSet: { rules: [] } }
      mockPrisma.machine.findMany.mockResolvedValue([vm1, vm2] as any)

      mockApplyRules
        .mockResolvedValueOnce({ appliedRules: 1, totalRules: 1, failedRules: 0, failures: [] })
        .mockRejectedValueOnce(new Error('Network error'))

      const result = await service.applyDepartmentRules('dept-123', [])

      expect(result.vmsUpdated).toBe(1)
      expect(result.errors.length).toBe(1)
    })
  })
})
