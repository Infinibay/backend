import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { FirewallSimplifierService, SimplifiedRule, VMFirewallState } from '../../../app/services/FirewallSimplifierService'
import { NetworkFilterService } from '../../../app/services/networkFilterService'
import { PortValidationService, PortRange } from '../../../app/services/PortValidationService'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockMachine } from '../../setup/mock-factories'

// Mock dependencies
jest.mock('../../../app/services/networkFilterService')
jest.mock('../../../app/services/PortValidationService')

describe('FirewallSimplifierService - Optimization Methods', () => {
  let service: FirewallSimplifierService
  let mockNetworkFilterService: jest.Mocked<NetworkFilterService>
  let mockPortValidationService: jest.Mocked<PortValidationService>

  beforeEach(() => {
    jest.clearAllMocks()
    service = new FirewallSimplifierService(mockPrisma)
    mockNetworkFilterService = jest.mocked(NetworkFilterService.prototype)
    mockPortValidationService = jest.mocked(PortValidationService.prototype)

    // Setup default port validation service mocks
    mockPortValidationService.validatePortString.mockReturnValue({
      isValid: true,
      errors: []
    })

    mockPortValidationService.parsePortString.mockImplementation((portString: string) => {
      if (portString === 'all') {
        return [{ start: 1, end: 65535 }]
      }
      if (portString.includes('-')) {
        const [start, end] = portString.split('-').map(Number)
        return [{ start, end }]
      }
      if (portString.includes(',')) {
        return portString.split(',').map(port => ({ start: Number(port), end: Number(port) }))
      }
      const port = Number(portString)
      return [{ start: port, end: port }]
    })
  })

  describe('addMultipleCustomRules', () => {
    it('should add multiple valid rules successfully', async () => {
      const vmId = 'vm-123'
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS' },
        { port: '8080', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Alt HTTP' }
      ]

      const mockMachine = createMockMachine({
        id: vmId,
        name: 'test-vm',
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(mockMachine)

      // Mock the private method calls
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.addMultipleCustomRules(vmId, rules)

      expect(result).toBeDefined()
      expect(result.customRules).toHaveLength(3) // HTTP, HTTPS, and Alt HTTP are not adjacent ports
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: vmId },
        include: { nwFilters: true }
      })
    })

    it('should validate all rules before processing', async () => {
      const vmId = 'vm-123'
      const rules: SimplifiedRule[] = [
        { port: 'invalid-port', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: false,
        errors: ['Invalid port format']
      })

      await expect(service.addMultipleCustomRules(vmId, rules)).rejects.toThrow('Invalid port configuration in rule')
    })

    it('should throw error if machine not found', async () => {
      const vmId = 'nonexistent-vm'
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.addMultipleCustomRules(vmId, rules)).rejects.toThrow('Machine nonexistent-vm not found')
    })

    it('should optimize newly added rules', async () => {
      const vmId = 'vm-123'
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '81', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '82', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      const mockMachine = createMockMachine({
        id: vmId,
        name: 'test-vm',
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.addMultipleCustomRules(vmId, rules)

      expect(result.customRules).toHaveLength(1) // Should be optimized into one rule covering 80-82
      expect(result.customRules[0].port).toBe('80-82')
    })

    it('should integrate with existing custom rules', async () => {
      const vmId = 'vm-123'
      const existingRules: SimplifiedRule[] = [
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', sources: ['CUSTOM'] }
      ]
      const newRules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      const mockMachine = createMockMachine({
        id: vmId,
        name: 'test-vm',
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: existingRules,
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.addMultipleCustomRules(vmId, newRules)

      expect(result.customRules).toHaveLength(2) // Existing rule + new rule
    })
  })

  describe('extractPortRanges', () => {
    it('should extract ranges from individual ports', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' }
      ]

      const ranges = (service as any).extractPortRanges(rules)

      expect(ranges).toEqual([
        { start: 80, end: 80, description: 'HTTP' }
      ])
    })

    it('should extract ranges from port ranges', () => {
      const rules: SimplifiedRule[] = [
        { port: '80-90', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP Range' }
      ]

      const ranges = (service as any).extractPortRanges(rules)

      expect(ranges).toEqual([
        { start: 80, end: 90, description: 'HTTP Range' }
      ])
    })

    it('should extract ranges from multiple ports', () => {
      const rules: SimplifiedRule[] = [
        { port: '80,443,8080', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Web ports' }
      ]

      const ranges = (service as any).extractPortRanges(rules)

      expect(ranges).toEqual([
        { start: 80, end: 80, description: 'Web ports' },
        { start: 443, end: 443, description: 'Web ports' },
        { start: 8080, end: 8080, description: 'Web ports' }
      ])
    })

    it('should handle "all" ports', () => {
      const rules: SimplifiedRule[] = [
        { port: 'all', protocol: 'tcp', direction: 'in', action: 'accept', description: 'All ports' }
      ]

      const ranges = (service as any).extractPortRanges(rules)

      expect(ranges).toEqual([
        { start: 1, end: 65535, description: 'All ports' }
      ])
    })

    it('should handle invalid port strings gracefully', () => {
      const rules: SimplifiedRule[] = [
        { port: 'invalid-port', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Invalid' }
      ]

      mockPortValidationService.parsePortString.mockImplementation(() => {
        throw new Error('Invalid port format')
      })

      const ranges = (service as any).extractPortRanges(rules)

      expect(ranges).toEqual([]) // Should skip invalid port strings
    })

    it('should preserve descriptions in extracted ranges', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP Server' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS Server' }
      ]

      const ranges = (service as any).extractPortRanges(rules)

      expect(ranges).toEqual([
        { start: 80, end: 80, description: 'HTTP Server' },
        { start: 443, end: 443, description: 'HTTPS Server' }
      ])
    })
  })

  describe('mergeAdjacentRanges', () => {
    it('should merge adjacent ranges', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 90 },
        { start: 91, end: 100 }
      ]

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toEqual([
        { start: 80, end: 100 }
      ])
    })

    it('should merge overlapping ranges', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 90 },
        { start: 85, end: 95 }
      ]

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toEqual([
        { start: 80, end: 95 }
      ])
    })

    it('should preserve non-adjacent ranges', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 90 },
        { start: 100, end: 110 }
      ]

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toEqual([
        { start: 80, end: 90 },
        { start: 100, end: 110 }
      ])
    })

    it('should de-duplicate descriptions when merging ranges', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 80, description: 'HTTP, HTTPS' },
        { start: 81, end: 81, description: 'HTTP, API' }
      ]

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toHaveLength(1)
      expect(merged[0]).toEqual({
        start: 80,
        end: 81,
        description: 'HTTP, HTTPS, API' // Should de-duplicate 'HTTP'
      })
    })

    it('should combine descriptions from merged ranges', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 90, description: 'HTTP' },
        { start: 91, end: 100, description: 'Alt HTTP' }
      ]

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toEqual([
        { start: 80, end: 100, description: 'HTTP, Alt HTTP' }
      ])
    })

    it('should handle empty input arrays', () => {
      const ranges: PortRange[] = []

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toEqual([])
    })

    it('should sort ranges before merging', () => {
      const ranges: PortRange[] = [
        { start: 100, end: 110 },
        { start: 80, end: 90 },
        { start: 91, end: 99 }
      ]

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toEqual([
        { start: 80, end: 110 }
      ])
    })

    it('should handle single range', () => {
      const ranges: PortRange[] = [
        { start: 80, end: 90, description: 'HTTP' }
      ]

      const merged = (service as any).mergeAdjacentRanges(ranges)

      expect(merged).toEqual([
        { start: 80, end: 90, description: 'HTTP' }
      ])
    })
  })

  describe('optimizeCustomRules', () => {
    it('should group rules by protocol, direction, and action', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'drop' }
      ]

      const optimized = (service as any).optimizeCustomRules(rules)

      expect(optimized).toHaveLength(3) // Rules have different ports (80, 443, 22) so they won't be merged
    })

    it('should merge rules with adjacent port ranges', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '81', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '82', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      const optimized = (service as any).optimizeCustomRules(rules)

      expect(optimized).toHaveLength(1)
      expect(optimized[0].port).toBe('80-82')
    })

    it('should preserve rule properties during optimization', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '81', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' }
      ]

      const optimized = (service as any).optimizeCustomRules(rules)

      expect(optimized).toHaveLength(1)
      expect(optimized[0].protocol).toBe('tcp')
      expect(optimized[0].direction).toBe('in')
      expect(optimized[0].action).toBe('accept')
      expect(optimized[0].sources).toEqual(['CUSTOM'])
    })

    it('should handle empty arrays', () => {
      const rules: SimplifiedRule[] = []

      const optimized = (service as any).optimizeCustomRules(rules)

      expect(optimized).toEqual([])
    })

    it('should handle single rules', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' }
      ]

      const optimized = (service as any).optimizeCustomRules(rules)

      expect(optimized).toHaveLength(1)
      expect(optimized[0].port).toBe('80')
    })

    it('should convert full range (1-65535) back to "all"', () => {
      const rules: SimplifiedRule[] = [
        { port: 'all', protocol: 'tcp', direction: 'in', action: 'accept', description: 'All ports' }
      ]

      const optimized = (service as any).optimizeCustomRules(rules)

      expect(optimized).toHaveLength(1)
      expect(optimized[0].port).toBe('all') // Should remain 'all', not become '1-65535'
    })

    it('should combine overlapping port ranges', () => {
      const rules: SimplifiedRule[] = [
        { port: '80-90', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '85-95', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      const optimized = (service as any).optimizeCustomRules(rules)

      expect(optimized).toHaveLength(1)
      expect(optimized[0].port).toBe('80-95')
    })
  })

  describe('groupRulesByKey', () => {
    it('should group rules by protocol, direction, action, and description', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', description: 'SSH' }
      ]

      const groups = (service as any).groupRulesByKey(rules)

      expect(groups.size).toBe(2) // HTTP group and SSH group
      expect(groups.get('tcp-in-accept-HTTP')).toHaveLength(2)
      expect(groups.get('tcp-in-accept-SSH')).toHaveLength(1)
    })

    it('should handle rules without descriptions', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      const groups = (service as any).groupRulesByKey(rules)

      expect(groups.size).toBe(1)
      expect(groups.get('tcp-in-accept-')).toHaveLength(2)
    })

    it('should differentiate by protocol', () => {
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '80', protocol: 'udp', direction: 'in', action: 'accept' }
      ]

      const groups = (service as any).groupRulesByKey(rules)

      expect(groups.size).toBe(2)
      expect(groups.get('tcp-in-accept-')).toHaveLength(1)
      expect(groups.get('udp-in-accept-')).toHaveLength(1)
    })
  })

  describe('Integration Tests', () => {
    it('should handle end-to-end workflow with multiple rules', async () => {
      const vmId = 'vm-123'
      const rules: SimplifiedRule[] = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '81', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', description: 'SSH' }
      ]

      const mockMachine = createMockMachine({
        id: vmId,
        name: 'test-vm',
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.addMultipleCustomRules(vmId, rules)

      // Should be optimized: 80-81 (HTTP), 443 (HTTPS), 22 (SSH)
      expect(result.customRules).toHaveLength(3)

      const httpRule = result.customRules.find(rule => rule.description?.includes('HTTP') && rule.port === '80-81')
      const httpsRule = result.customRules.find(rule => rule.description?.includes('HTTPS'))
      const sshRule = result.customRules.find(rule => rule.description?.includes('SSH'))

      expect(httpRule).toBeDefined()
      expect(httpsRule).toBeDefined()
      expect(sshRule).toBeDefined()
    })

    it('should handle performance with large rule sets', async () => {
      const vmId = 'vm-123'
      const rules: SimplifiedRule[] = []

      // Generate 100 rules with adjacent ports
      for (let i = 1000; i < 1100; i++) {
        rules.push({
          port: i.toString(),
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Load test'
        })
      }

      const mockMachine = createMockMachine({
        id: vmId,
        name: 'test-vm',
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const start = Date.now()
      const result = await service.addMultipleCustomRules(vmId, rules)
      const duration = Date.now() - start

      // Should be optimized into a single rule covering 1000-1099
      expect(result.customRules).toHaveLength(1)
      expect(result.customRules[0].port).toBe('1000-1099')
      expect(duration).toBeLessThan(1000) // Should complete within 1 second
    })

    it('should be compatible with existing addCustomRule method', async () => {
      const vmId = 'vm-123'
      const singleRule: SimplifiedRule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        description: 'HTTP'
      }

      const mockMachine = createMockMachine({
        id: vmId,
        name: 'test-vm',
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      // Add rule using single method
      const singleResult = await service.addCustomRule(vmId, singleRule)

      // Add rules using multiple method
      const multipleResult = await service.addMultipleCustomRules(vmId, [singleRule])

      // Both methods should produce compatible results
      expect(singleResult.customRules).toHaveLength(1)
      expect(multipleResult.customRules).toHaveLength(1)
    })
  })
})
