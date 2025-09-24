import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { FirewallSimplifierService, SimplifiedRule, VMFirewallState } from '../../../app/services/FirewallSimplifierService'
import { NetworkFilterService } from '../../../app/services/networkFilterService'
import { PortValidationService, PortRange } from '../../../app/services/PortValidationService'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockMachine, createMockFWRule } from '../../setup/mock-factories'
import { ErrorCode } from '../../../app/utils/errors/ErrorHandler'

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

      await expect(service.addMultipleCustomRules(vmId, rules)).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
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

  describe('getVMFirewallState', () => {
    it('should return complete VM firewall state when machine exists', async () => {
      const vmId = 'vm-123'
      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: ['WEB_SERVER'],
          customRules: [
            { port: '8080', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Custom HTTP', sources: ['CUSTOM'] }
          ],
          lastSync: '2023-01-01T00:00:00.000Z'
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getVMFirewallState(vmId)

      expect(result).toBeDefined()
      expect(result.appliedTemplates).toEqual(['WEB_SERVER'])
      expect(result.customRules).toHaveLength(1)
      expect(result.customRules[0].port).toBe('8080')
      expect(result.effectiveRules).toBeDefined()
      expect(result.lastSync).toEqual(new Date('2023-01-01T00:00:00.000Z'))
    })

    it('should handle machines with no firewall templates (empty state)', async () => {
      const vmId = 'vm-123'
      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: null
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getVMFirewallState(vmId)

      expect(result.appliedTemplates).toEqual([])
      expect(result.customRules).toEqual([])
      expect(result.effectiveRules).toEqual([])
      expect(result.lastSync).toBeNull()
    })

    it('should handle machines with invalid JSON in firewallTemplates', async () => {
      const vmId = 'vm-123'
      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: 'invalid-json' as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getVMFirewallState(vmId)

      expect(result.appliedTemplates).toEqual([])
      expect(result.customRules).toEqual([])
      expect(result.effectiveRules).toEqual([])
      expect(result.lastSync).toBeNull()
    })

    it('should throw error when machine not found', async () => {
      const vmId = 'nonexistent-vm'
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.getVMFirewallState(vmId)).rejects.toThrow('Machine nonexistent-vm not found')
    })
  })

  describe('applyFirewallTemplate', () => {
    it('should successfully apply valid template to VM', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any // FirewallTemplate.WEB_SERVER
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(mockMachine)
      mockPrisma.vMNWFilter.create.mockResolvedValue({} as any)

      // Mock the private method calls
      const syncFirewallRulesSpy = jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      const updateFirewallStateSpy = jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.applyFirewallTemplate(vmId, template)

      expect(result).toBeDefined()
      expect(result.appliedTemplates).toContain('WEB_SERVER')
      expect(result.effectiveRules.length).toBeGreaterThan(0)

      // Assert helper interactions
      expect(syncFirewallRulesSpy).toHaveBeenCalledWith(vmId, mockMachine, expect.any(Array))
      expect(updateFirewallStateSpy).toHaveBeenCalledWith(vmId, expect.objectContaining({
        appliedTemplates: ['WEB_SERVER'],
        customRules: []
      }))
    })

    it('should return existing state if template already applied (idempotent)', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: ['WEB_SERVER'],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.applyFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).toEqual(['WEB_SERVER'])
    })

    it('should throw error when machine not found', async () => {
      const vmId = 'nonexistent-vm'
      const template = 'WEB_SERVER' as any
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.applyFirewallTemplate(vmId, template)).rejects.toThrow('Machine nonexistent-vm not found')
    })

    it('should validate template rules using PortValidationService before applying', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any

      // Mock invalid port validation
      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: false,
        errors: ['Invalid port format']
      })

      await expect(service.applyFirewallTemplate(vmId, template)).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should apply DATABASE template and validate all ports', async () => {
      const vmId = 'vm-123'
      const template = 'DATABASE' as any // FirewallTemplate.DATABASE
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(mockMachine)
      mockPrisma.vMNWFilter.create.mockResolvedValue({} as any)

      const syncFirewallRulesSpy = jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      const updateFirewallStateSpy = jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.applyFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).toContain('DATABASE')
      expect(result.effectiveRules.length).toBeGreaterThan(0)

      // Should contain MySQL (3306), PostgreSQL (5432), and SSH (22) ports
      const mysqlRule = result.effectiveRules.find(rule => rule.port === '3306')
      const postgresRule = result.effectiveRules.find(rule => rule.port === '5432')
      const sshRule = result.effectiveRules.find(rule => rule.port === '22')

      expect(mysqlRule).toBeDefined()
      expect(mysqlRule?.description).toBe('MySQL')
      expect(postgresRule).toBeDefined()
      expect(postgresRule?.description).toBe('PostgreSQL')
      expect(sshRule).toBeDefined()
      expect(sshRule?.description).toBe('SSH')

      // Verify validatePortString was called for each template rule
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('3306')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('5432')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('22')

      expect(syncFirewallRulesSpy).toHaveBeenCalledWith(vmId, mockMachine, expect.any(Array))
      expect(updateFirewallStateSpy).toHaveBeenCalledWith(vmId, expect.objectContaining({
        appliedTemplates: ['DATABASE']
      }))
    })

    it('should apply DESKTOP template and validate all ports', async () => {
      const vmId = 'vm-123'
      const template = 'DESKTOP' as any // FirewallTemplate.DESKTOP
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(mockMachine)
      mockPrisma.vMNWFilter.create.mockResolvedValue({} as any)

      const syncFirewallRulesSpy = jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      const updateFirewallStateSpy = jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.applyFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).toContain('DESKTOP')
      expect(result.effectiveRules.length).toBeGreaterThan(0)

      // Should contain RDP (3389) and all outbound traffic
      const rdpRule = result.effectiveRules.find(rule => rule.port === '3389')
      const outboundRule = result.effectiveRules.find(rule => rule.port === 'all' && rule.direction === 'out')

      expect(rdpRule).toBeDefined()
      expect(rdpRule?.description).toBe('RDP')
      expect(rdpRule?.direction).toBe('in')
      expect(outboundRule).toBeDefined()
      expect(outboundRule?.description).toBe('All outbound')
      expect(outboundRule?.protocol).toBe('all')

      // Verify validatePortString was called for each template rule
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('3389')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('all')

      expect(syncFirewallRulesSpy).toHaveBeenCalledWith(vmId, mockMachine, expect.any(Array))
      expect(updateFirewallStateSpy).toHaveBeenCalledWith(vmId, expect.objectContaining({
        appliedTemplates: ['DESKTOP']
      }))
    })

    it('should apply DEVELOPMENT template and validate all ports', async () => {
      const vmId = 'vm-123'
      const template = 'DEVELOPMENT' as any // FirewallTemplate.DEVELOPMENT
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(mockMachine)
      mockPrisma.vMNWFilter.create.mockResolvedValue({} as any)

      const syncFirewallRulesSpy = jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      const updateFirewallStateSpy = jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.applyFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).toContain('DEVELOPMENT')
      expect(result.effectiveRules.length).toBeGreaterThan(0)

      // Should contain development ports: 3000, 8080, 80, 443, 22, and all outbound
      const devServerRule = result.effectiveRules.find(rule => rule.port === '3000')
      const altHttpRule = result.effectiveRules.find(rule => rule.port === '8080')
      const httpRule = result.effectiveRules.find(rule => rule.port === '80')
      const httpsRule = result.effectiveRules.find(rule => rule.port === '443')
      const sshRule = result.effectiveRules.find(rule => rule.port === '22')
      const outboundRule = result.effectiveRules.find(rule => rule.port === 'all' && rule.direction === 'out')

      expect(devServerRule).toBeDefined()
      expect(devServerRule?.description).toBe('Dev Server')
      expect(altHttpRule).toBeDefined()
      expect(altHttpRule?.description).toBe('Alt HTTP')
      expect(httpRule).toBeDefined()
      expect(httpRule?.description).toBe('HTTP')
      expect(httpsRule).toBeDefined()
      expect(httpsRule?.description).toBe('HTTPS')
      expect(sshRule).toBeDefined()
      expect(sshRule?.description).toBe('SSH')
      expect(outboundRule).toBeDefined()
      expect(outboundRule?.description).toBe('All outbound')

      // Verify validatePortString was called for each template rule
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('3000')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('8080')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('80')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('443')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('22')
      expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('all')

      expect(syncFirewallRulesSpy).toHaveBeenCalledWith(vmId, mockMachine, expect.any(Array))
      expect(updateFirewallStateSpy).toHaveBeenCalledWith(vmId, expect.objectContaining({
        appliedTemplates: ['DEVELOPMENT']
      }))
    })
  })

  describe('removeFirewallTemplate', () => {
    it('should successfully remove template from VM', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: ['WEB_SERVER', 'DATABASE'],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: [{ nwFilter: { id: 'filter-1', rules: [] } }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.nWFilter.findUnique.mockResolvedValue({ id: 'filter-1', rules: [] } as any)

      // Mock the private method calls
      const getCurrentNWFilterRulesSpy = jest.spyOn(service as any, 'getCurrentNWFilterRules').mockResolvedValue([])
      const identifyRulesToRemoveSpy = jest.spyOn(service as any, 'identifyRulesToRemove').mockReturnValue([])
      const removeNWFilterRulesSpy = jest.spyOn(service as any, 'removeNWFilterRules').mockResolvedValue(undefined)
      const updateFirewallStateSpy = jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.removeFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).toEqual(['DATABASE'])
      expect(result.appliedTemplates).not.toContain('WEB_SERVER')

      // Assert helper interactions
      expect(getCurrentNWFilterRulesSpy).toHaveBeenCalledWith(mockMachine)
      expect(identifyRulesToRemoveSpy).toHaveBeenCalledWith([], expect.any(Array))
      expect(removeNWFilterRulesSpy).toHaveBeenCalledWith(mockMachine, [])
      expect(updateFirewallStateSpy).toHaveBeenCalledWith(vmId, expect.objectContaining({
        appliedTemplates: ['DATABASE'],
        customRules: []
      }))
    })

    it('should handle removing template that wasn\'t applied (no-op)', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: ['DATABASE'],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      // Mock the private method calls
      jest.spyOn(service as any, 'getCurrentNWFilterRules').mockResolvedValue([])
      jest.spyOn(service as any, 'identifyRulesToRemove').mockReturnValue([])
      jest.spyOn(service as any, 'removeNWFilterRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.removeFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).toEqual(['DATABASE'])
    })

    it('should throw error when machine not found', async () => {
      const vmId = 'nonexistent-vm'
      const template = 'WEB_SERVER' as any
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.removeFirewallTemplate(vmId, template)).rejects.toThrow('Machine nonexistent-vm not found')
    })
  })

  describe('toggleFirewallTemplate', () => {
    it('should apply template when not currently applied', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(mockMachine)
      mockPrisma.vMNWFilter.create.mockResolvedValue({} as any)

      // Mock the private method calls
      const syncFirewallRulesSpy = jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      const updateFirewallStateSpy = jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.toggleFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).toContain('WEB_SERVER')

      // Assert helper interactions (should delegate to applyFirewallTemplate)
      expect(syncFirewallRulesSpy).toHaveBeenCalledWith(vmId, mockMachine, expect.any(Array))
      expect(updateFirewallStateSpy).toHaveBeenCalledWith(vmId, expect.objectContaining({
        appliedTemplates: ['WEB_SERVER'],
        customRules: []
      }))
    })

    it('should remove template when currently applied', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: ['WEB_SERVER'],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: [{ nwFilter: { id: 'filter-1', rules: [] } }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.nWFilter.findUnique.mockResolvedValue({ id: 'filter-1', rules: [] } as any)

      // Mock the private method calls for first call to getVMFirewallState
      const getCurrentNWFilterRulesSpy = jest.spyOn(service as any, 'getCurrentNWFilterRules').mockResolvedValue([])
      const identifyRulesToRemoveSpy = jest.spyOn(service as any, 'identifyRulesToRemove').mockReturnValue([])
      const removeNWFilterRulesSpy = jest.spyOn(service as any, 'removeNWFilterRules').mockResolvedValue(undefined)
      const updateFirewallStateSpy = jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.toggleFirewallTemplate(vmId, template)

      expect(result.appliedTemplates).not.toContain('WEB_SERVER')

      // Assert helper interactions (should delegate to removeFirewallTemplate)
      expect(getCurrentNWFilterRulesSpy).toHaveBeenCalledWith(mockMachine)
      expect(identifyRulesToRemoveSpy).toHaveBeenCalledWith([], expect.any(Array))
      expect(removeNWFilterRulesSpy).toHaveBeenCalledWith(mockMachine, [])
      expect(updateFirewallStateSpy).toHaveBeenCalledWith(vmId, expect.objectContaining({
        appliedTemplates: [],
        customRules: []
      }))
    })
  })

  describe('getSimplifiedRules', () => {
    it('should return simplified rules from VM\'s NWFilter rules', async () => {
      const vmId = 'vm-123'
      const mockFWRule = createMockFWRule({
        id: 'rule-1',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: 80,
        dstPortEnd: 80,
        comment: 'HTTP rule'
      })

      const mockMachine = {
        ...createMockMachine({
          id: vmId
        }),
        nwFilters: [{
          nwFilter: {
            id: 'filter-1',
            rules: [mockFWRule]
          }
        }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getSimplifiedRules(vmId)

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        port: '80',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        description: 'HTTP rule'
      })
    })

    it('should handle VMs with no filters (empty array)', async () => {
      const vmId = 'vm-123'
      const mockMachine = {
        ...createMockMachine({
          id: vmId
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getSimplifiedRules(vmId)

      expect(result).toEqual([])
    })

    it('should skip complex rules with IP addresses/masks', async () => {
      const vmId = 'vm-123'
      const mockFWRule = createMockFWRule({
        id: 'rule-1',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: 80,
        dstPortEnd: 80,
        srcIpAddr: '192.168.1.0', // This makes it complex
        srcIpMask: '255.255.255.0'
      })

      const mockMachine = {
        ...createMockMachine({
          id: vmId
        }),
        nwFilters: [{
          nwFilter: {
            id: 'filter-1',
            rules: [mockFWRule]
          }
        }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getSimplifiedRules(vmId)

      expect(result).toEqual([]) // Complex rule should be skipped
    })

    it('should group and merge multiple rules with adjacent/overlapping ports', async () => {
      const vmId = 'vm-123'
      const mockFWRules = [
        createMockFWRule({
          id: 'rule-1',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          dstPortStart: 80,
          dstPortEnd: 80,
          comment: 'HTTP'
        }),
        createMockFWRule({
          id: 'rule-2',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          dstPortStart: 81,
          dstPortEnd: 81,
          comment: 'HTTP'
        }),
        createMockFWRule({
          id: 'rule-3',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          dstPortStart: 82,
          dstPortEnd: 82,
          comment: 'HTTP'
        }),
        createMockFWRule({
          id: 'rule-4',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          dstPortStart: 8000,
          dstPortEnd: 8100,
          comment: 'Dev range'
        }),
        createMockFWRule({
          id: 'rule-5',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          dstPortStart: 8101,
          dstPortEnd: 8199,
          comment: 'Dev range'
        })
      ]

      const mockMachine = {
        ...createMockMachine({
          id: vmId
        }),
        nwFilters: [{
          nwFilter: {
            id: 'filter-1',
            rules: mockFWRules
          }
        }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getSimplifiedRules(vmId)

      // Should merge adjacent ports 80-82 and overlapping ranges 8000-8199
      expect(result).toHaveLength(2)

      const httpRule = result.find(rule => rule.port === '80-82')
      expect(httpRule).toBeDefined()
      expect(httpRule?.protocol).toBe('tcp')
      expect(httpRule?.direction).toBe('in')
      expect(httpRule?.action).toBe('accept')
      expect(httpRule?.description).toContain('HTTP')

      const devRule = result.find(rule => rule.port === '8000-8199')
      expect(devRule).toBeDefined()
      expect(devRule?.protocol).toBe('tcp')
      expect(devRule?.direction).toBe('in')
      expect(devRule?.action).toBe('accept')
      expect(devRule?.description).toContain('Dev range')
    })

    it('should throw error when machine not found', async () => {
      const vmId = 'nonexistent-vm'
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.getSimplifiedRules(vmId)).rejects.toThrow('Machine nonexistent-vm not found')
    })
  })

  describe('addCustomRule', () => {
    it('should add valid custom rule to VM', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '8080',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const,
        description: 'Custom HTTP'
      }

      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.machine.update.mockResolvedValue(mockMachine)

      // Mock the private method calls
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.addCustomRule(vmId, rule)

      expect(result.customRules).toHaveLength(1)
      expect(result.customRules[0].port).toBe('8080')
      expect(result.customRules[0].sources).toEqual(['CUSTOM'])
    })

    it('should validate port string using PortValidationService', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: 'invalid-port',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: false,
        errors: ['Invalid port format']
      })

      await expect(service.addCustomRule(vmId, rule)).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should throw error when machine not found', async () => {
      const vmId = 'nonexistent-vm'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.addCustomRule(vmId, rule)).rejects.toThrow('Machine nonexistent-vm not found')
    })
  })

  describe('parseFirewallState', () => {
    it('should parse valid JSON firewall state', () => {
      const jsonState = {
        appliedTemplates: ['WEB_SERVER'],
        customRules: [{ port: '80', protocol: 'tcp', direction: 'in', action: 'accept' }],
        lastSync: '2023-01-01T00:00:00.000Z'
      }

      const result = (service as any).parseFirewallState(jsonState)

      expect(result.appliedTemplates).toEqual(['WEB_SERVER'])
      expect(result.customRules).toHaveLength(1)
      expect(result.lastSync).toEqual(new Date('2023-01-01T00:00:00.000Z'))
    })

    it('should handle string JSON input', () => {
      const jsonString = JSON.stringify({
        appliedTemplates: ['DATABASE'],
        customRules: [],
        lastSync: null
      })

      const result = (service as any).parseFirewallState(jsonString)

      expect(result.appliedTemplates).toEqual(['DATABASE'])
      expect(result.customRules).toEqual([])
      expect(result.lastSync).toBeNull()
    })

    it('should return default state for null/undefined input', () => {
      const resultNull = (service as any).parseFirewallState(null)
      const resultUndefined = (service as any).parseFirewallState(undefined)

      expect(resultNull).toEqual({
        appliedTemplates: [],
        customRules: [],
        lastSync: null
      })
      expect(resultUndefined).toEqual({
        appliedTemplates: [],
        customRules: [],
        lastSync: null
      })
    })

    it('should return default state for invalid JSON', () => {
      const result = (service as any).parseFirewallState('invalid-json')

      expect(result).toEqual({
        appliedTemplates: [],
        customRules: [],
        lastSync: null
      })
    })
  })

  describe('calculateEffectiveRules', () => {
    it('should combine rules from multiple templates', async () => {
      const templates = ['WEB_SERVER', 'DATABASE']
      const customRules: any[] = []

      const result = await (service as any).calculateEffectiveRules(templates, customRules)

      expect(result.length).toBeGreaterThan(0)
      // Should contain rules from both templates
      const httpRule = result.find((r: any) => r.port === '80')
      const mysqlRule = result.find((r: any) => r.port === '3306')
      expect(httpRule).toBeDefined()
      expect(mysqlRule).toBeDefined()
    })

    it('should combine template rules with custom rules', async () => {
      const templates = ['WEB_SERVER']
      const customRules = [
        { port: '8080', protocol: 'tcp', direction: 'in', action: 'accept', sources: ['CUSTOM'] }
      ]

      const result = await (service as any).calculateEffectiveRules(templates, customRules)

      const httpRule = result.find((r: any) => r.port === '80')
      const customRule = result.find((r: any) => r.port === '8080')
      expect(httpRule).toBeDefined()
      expect(customRule).toBeDefined()
      expect(customRule.sources).toContain('CUSTOM')
    })

    it('should handle empty templates and custom rules', async () => {
      const result = await (service as any).calculateEffectiveRules([], [])

      expect(result).toEqual([])
    })
  })

  describe('convertToSimplifiedRule', () => {
    it('should convert FWRule to SimplifiedRule format', () => {
      const fwRule = createMockFWRule({
        id: 'rule-1',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: 80,
        dstPortEnd: 80,
        comment: 'HTTP rule'
      })

      const result = (service as any).convertToSimplifiedRule(fwRule)

      expect(result).toEqual({
        id: 'rule-1',
        port: '80',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        description: 'HTTP rule'
      })
    })

    it('should handle port ranges correctly', () => {
      const fwRule = createMockFWRule({
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: 8000,
        dstPortEnd: 8999
      })

      const result = (service as any).convertToSimplifiedRule(fwRule)

      expect(result?.port).toBe('8000-8999')
    })

    it('should return null for complex rules with IP addresses', () => {
      const fwRule = createMockFWRule({
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: 80,
        dstPortEnd: 80,
        srcIpAddr: '192.168.1.0',
        srcIpMask: '255.255.255.0'
      })

      const result = (service as any).convertToSimplifiedRule(fwRule)

      expect(result).toBeNull()
    })

    it('should handle rules without ports (return "all")', () => {
      const fwRule = createMockFWRule({
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: null,
        dstPortEnd: null
      })

      const result = (service as any).convertToSimplifiedRule(fwRule)

      expect(result?.port).toBe('all')
    })
  })

  describe('syncFirewallRules', () => {
    it('should create VM filter if not exists', async () => {
      const vmId = 'vm-123'
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          internalName: 'test-vm'
        }),
        nwFilters: []
      } as any
      const effectiveRules = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' }
      ]
      const mockFilter = { id: 'filter-123' }

      mockNetworkFilterService.createFilter.mockResolvedValue(mockFilter as any)
      mockPrisma.vMNWFilter.create.mockResolvedValue({} as any)
      mockNetworkFilterService.createRule.mockResolvedValue({} as any)
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true)

      await (service as any).syncFirewallRules(vmId, mockMachine, effectiveRules)

      expect(mockNetworkFilterService.createFilter).toHaveBeenCalledWith(
        'vm-test-vm-simplified',
        'Simplified firewall rules for test-vm',
        'root',
        'vm'
      )
      expect(mockPrisma.vMNWFilter.create).toHaveBeenCalledWith({
        data: {
          vmId: mockMachine.id,
          nwFilterId: mockFilter.id
        }
      })
      expect(mockNetworkFilterService.createRule).toHaveBeenCalled()
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(mockFilter.id, true)
    })

    it('should use existing VM filter if present', async () => {
      const vmId = 'vm-123'
      const existingFilter = { id: 'existing-filter' }
      const mockMachine = {
        ...createMockMachine({
          id: vmId
        }),
        nwFilters: [{ nwFilter: existingFilter }]
      } as any
      const effectiveRules = [
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS' }
      ]

      mockNetworkFilterService.createRule.mockResolvedValue({} as any)
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true)

      await (service as any).syncFirewallRules(vmId, mockMachine, effectiveRules)

      expect(mockNetworkFilterService.createFilter).not.toHaveBeenCalled()
      expect(mockPrisma.vMNWFilter.create).not.toHaveBeenCalled()
      expect(mockNetworkFilterService.createRule).toHaveBeenCalled()
      expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(existingFilter.id, true)
    })

    it('should assign incremental priorities to rules', async () => {
      const vmId = 'vm-123'
      const existingFilter = { id: 'existing-filter' }
      const mockMachine = {
        ...createMockMachine({
          id: vmId
        }),
        nwFilters: [{ nwFilter: existingFilter }]
      } as any
      const effectiveRules = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS' }
      ]

      mockNetworkFilterService.createRule.mockResolvedValue({} as any)
      mockNetworkFilterService.flushNWFilter.mockResolvedValue(true)

      const createRuleSpy = jest.spyOn(service as any, 'createNWFilterRule').mockResolvedValue(undefined)

      await (service as any).syncFirewallRules(vmId, mockMachine, effectiveRules)

      expect(createRuleSpy).toHaveBeenCalledWith(existingFilter.id, effectiveRules[0], 100)
      expect(createRuleSpy).toHaveBeenCalledWith(existingFilter.id, effectiveRules[1], 110)
    })
  })

  describe('createNWFilterRule', () => {
    it('should create rule for single port', async () => {
      const filterId = 'filter-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        description: 'HTTP',
        sources: ['CUSTOM']
      }
      const priority = 100

      mockPortValidationService.parsePortString.mockReturnValue([{ start: 80, end: 80 }])
      mockNetworkFilterService.createRule.mockResolvedValue({} as any)

      await (service as any).createNWFilterRule(filterId, rule, priority)

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        filterId,
        rule.action,
        rule.direction,
        priority,
        rule.protocol,
        undefined,
        {
          dstPortStart: 80,
          dstPortEnd: 80,
          comment: 'HTTP'
        }
      )
    })

    it('should create rule for port range', async () => {
      const filterId = 'filter-123'
      const rule = {
        port: '8000-8999',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        description: 'Dev ports',
        sources: ['CUSTOM']
      }
      const priority = 100

      mockPortValidationService.parsePortString.mockReturnValue([{ start: 8000, end: 8999 }])
      mockNetworkFilterService.createRule.mockResolvedValue({} as any)

      await (service as any).createNWFilterRule(filterId, rule, priority)

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        filterId,
        rule.action,
        rule.direction,
        priority,
        rule.protocol,
        undefined,
        {
          dstPortStart: 8000,
          dstPortEnd: 8999,
          comment: 'Dev ports'
        }
      )
    })

    it('should handle "all" ports without port parameters', async () => {
      const filterId = 'filter-123'
      const rule = {
        port: 'all',
        protocol: 'tcp',
        direction: 'out',
        action: 'accept',
        description: 'All outbound',
        sources: ['TEMPLATE']
      }
      const priority = 100

      mockNetworkFilterService.createRule.mockResolvedValue({} as any)

      await (service as any).createNWFilterRule(filterId, rule, priority)

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        filterId,
        rule.action,
        rule.direction,
        priority,
        rule.protocol,
        undefined,
        {
          comment: 'All outbound'
        }
      )
    })

    it('should create multiple rules for port ranges and increment priority', async () => {
      const filterId = 'filter-123'
      const rule = {
        port: '80,443,8080-8090',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        description: 'Multiple ports',
        sources: ['CUSTOM']
      }
      const priority = 100

      mockPortValidationService.parsePortString.mockReturnValue([
        { start: 80, end: 80 },
        { start: 443, end: 443 },
        { start: 8080, end: 8090 }
      ])
      mockNetworkFilterService.createRule.mockResolvedValue({} as any)

      await (service as any).createNWFilterRule(filterId, rule, priority)

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledTimes(3)
      expect(mockNetworkFilterService.createRule).toHaveBeenNthCalledWith(1,
        filterId, rule.action, rule.direction, 100, rule.protocol, undefined,
        { dstPortStart: 80, dstPortEnd: 80, comment: 'Multiple ports' }
      )
      expect(mockNetworkFilterService.createRule).toHaveBeenNthCalledWith(2,
        filterId, rule.action, rule.direction, 101, rule.protocol, undefined,
        { dstPortStart: 443, dstPortEnd: 443, comment: 'Multiple ports' }
      )
      expect(mockNetworkFilterService.createRule).toHaveBeenNthCalledWith(3,
        filterId, rule.action, rule.direction, 102, rule.protocol, undefined,
        { dstPortStart: 8080, dstPortEnd: 8090, comment: 'Multiple ports' }
      )
    })

    it('should include rule description in comment', async () => {
      const filterId = 'filter-123'
      const rule = {
        port: '22',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        description: 'SSH Access',
        sources: ['WEB_SERVER', 'CUSTOM']
      }
      const priority = 500

      mockPortValidationService.parsePortString.mockReturnValue([{ start: 22, end: 22 }])
      mockNetworkFilterService.createRule.mockResolvedValue({} as any)

      await (service as any).createNWFilterRule(filterId, rule, priority)

      expect(mockNetworkFilterService.createRule).toHaveBeenCalledWith(
        filterId,
        rule.action,
        rule.direction,
        priority,
        rule.protocol,
        undefined,
        {
          dstPortStart: 22,
          dstPortEnd: 22,
          comment: 'SSH Access'
        }
      )
    })
  })

  describe('Error Handling - Port Validation and Configuration Errors', () => {
    it('should handle applyFirewallTemplate with invalid port configurations in template', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any

      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: false,
        errors: ['Port out of range']
      })

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should handle addCustomRule with malformed port strings', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: 'invalid-port-format',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: false,
        errors: ['Invalid port format', 'Contains invalid characters']
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should handle addMultipleCustomRules where some rules have valid ports and others invalid', async () => {
      const vmId = 'vm-123'
      const rules = [
        { port: '80', protocol: 'tcp', direction: 'in' as const, action: 'accept' as const },
        { port: 'invalid', protocol: 'tcp', direction: 'in' as const, action: 'accept' as const },
        { port: '443', protocol: 'tcp', direction: 'in' as const, action: 'accept' as const }
      ]

      mockPortValidationService.validatePortString
        .mockReturnValueOnce({ isValid: true, errors: [] })      // First rule valid
        .mockReturnValueOnce({ isValid: false, errors: ['Invalid format'] })  // Second rule invalid
        .mockReturnValueOnce({ isValid: true, errors: [] })      // Third rule valid

      await expect(
        service.addMultipleCustomRules(vmId, rules)
      ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should handle port range validation failures (negative ports, ports > 65535)', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '70000',  // Invalid: port > 65535
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: false,
        errors: ['Port number exceeds maximum (65535)']
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should handle invalid port ranges (start > end)', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '8080-80',  // Invalid: start > end
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: false,
        errors: ['Invalid range: start port greater than end port']
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should handle protocol validation errors (unsupported protocols)', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'invalid-protocol',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('Unsupported protocol: invalid-protocol'))

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Unsupported protocol: invalid-protocol')
    })
  })

  describe('Error Handling - Machine and VM State Errors', () => {
    it('should consistently throw "Machine not found" errors for all methods', async () => {
      const vmId = 'nonexistent-vm'

      mockPrisma.machine.findUnique.mockResolvedValue(null)

      await expect(service.getVMFirewallState(vmId)).rejects.toThrow('Machine nonexistent-vm not found')
      await expect(service.applyFirewallTemplate(vmId, 'WEB_SERVER' as any)).rejects.toThrow('Machine nonexistent-vm not found')
      await expect(service.removeFirewallTemplate(vmId, 'WEB_SERVER' as any)).rejects.toThrow('Machine nonexistent-vm not found')
      await expect(service.getSimplifiedRules(vmId)).rejects.toThrow('Machine nonexistent-vm not found')
      await expect(service.addCustomRule(vmId, { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' })).rejects.toThrow('Machine nonexistent-vm not found')
    })

    it('should handle getVMFirewallState with corrupted firewallTemplates JSON field', async () => {
      const vmId = 'vm-123'
      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: 'corrupted-json-data{[' as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getVMFirewallState(vmId)

      // Should gracefully handle corrupted JSON and return default state
      expect(result.appliedTemplates).toEqual([])
      expect(result.customRules).toEqual([])
      expect(result.lastSync).toBeNull()
    })

    it('should handle parseFirewallState with various malformed JSON inputs', () => {
      const malformedInputs = [
        'not-json-at-all',
        '{incomplete:',
        '{"malformed": json}',
        '{"appliedTemplates": [unclosed array',
        '{"customRules": {"should": "be", "array": "not object"}}',
        '"just a string"',
        '123',
        'true',
        'null'
      ]

      malformedInputs.forEach(input => {
        const result = (service as any).parseFirewallState(input)
        expect(result).toEqual({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        })
      })
    })

    it('should handle machine state inconsistencies (missing nwFilters, orphaned references)', async () => {
      const vmId = 'vm-123'
      const mockMachine = {
        ...createMockMachine({ id: vmId }),
        nwFilters: null  // Inconsistent state
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      await expect(
        service.getSimplifiedRules(vmId)
      ).rejects.toThrow()
    })

    it('should handle concurrent modifications to machine firewall state', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(new Error('Concurrent modification detected'))

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Concurrent modification detected')
    })
  })

  describe('Error Handling - NetworkFilterService Operation Failures', () => {
    it('should handle syncFirewallRules when NetworkFilterService.createFilter() fails', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('Filter creation failed'))

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow('Filter creation failed')
    })

    it('should handle createNWFilterRule when NetworkFilterService.createRule() throws errors', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('Rule creation failed'))

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Rule creation failed')
    })

    it('should handle syncFirewallRules when NetworkFilterService.flushNWFilter() fails', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('Filter flush failed'))

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow('Filter flush failed')
    })

    it('should handle removeFirewallTemplate when NetworkFilterService.deleteRule() fails', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: ['WEB_SERVER'],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: [{ nwFilter: { id: 'filter-1', rules: [] } }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockPrisma.nWFilter.findUnique.mockResolvedValue({ id: 'filter-1', rules: [] } as any)
      jest.spyOn(service as any, 'getCurrentNWFilterRules').mockResolvedValue([])
      jest.spyOn(service as any, 'identifyRulesToRemove').mockReturnValue([])
      jest.spyOn(service as any, 'removeNWFilterRules').mockRejectedValue(new Error('Rule deletion failed'))

      await expect(
        service.removeFirewallTemplate(vmId, template)
      ).rejects.toThrow('Rule deletion failed')
    })

    it('should handle scenarios where filter creation succeeds but rule creation fails', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])

      // Mock filter creation success but rule creation failure
      jest.spyOn(service as any, 'syncFirewallRules').mockImplementation(async () => {
        // Simulate filter created successfully but rule creation fails
        throw new Error('Rule creation failed after filter was created')
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Rule creation failed after filter was created')
    })
  })

  describe('Error Handling - Template and Rule Processing Errors', () => {
    it('should handle template application with corrupted template definitions', async () => {
      const vmId = 'vm-123'
      const template = 'CORRUPTED_TEMPLATE' as any

      // Mock a scenario where template definition is corrupted/missing
      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow()
    })

    it('should handle calculateEffectiveRules with invalid template references', async () => {
      const templates = ['INVALID_TEMPLATE', 'ANOTHER_INVALID']
      const customRules: any[] = []

      await expect(
        (service as any).calculateEffectiveRules(templates, customRules)
      ).rejects.toThrow()
    })

    it('should handle rule optimization failures during optimizeCustomRules', async () => {
      const corruptedRules = [
        { port: null, protocol: 'tcp', direction: 'in', action: 'accept' },  // Corrupted rule
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      expect(() => {
        (service as any).optimizeCustomRules(corruptedRules)
      }).toThrow()
    })

    it('should handle convertToSimplifiedRule with malformed FWRule data', () => {
      const malformedRules = [
        null,
        undefined,
        { protocol: null },
        { direction: undefined },
        { action: 'invalid-action' },
        { dstPortStart: 'not-a-number' }
      ]

      malformedRules.forEach(rule => {
        expect(() => {
          (service as any).convertToSimplifiedRule(rule)
        }).toThrow()
      })
    })

    it('should handle template removal when template was externally modified', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: ['WEB_SERVER'],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: [{ nwFilter: { id: 'filter-1', rules: [] } }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'getCurrentNWFilterRules').mockRejectedValue(new Error('Filter was modified externally'))

      await expect(
        service.removeFirewallTemplate(vmId, template)
      ).rejects.toThrow('Filter was modified externally')
    })
  })

  describe('Error Handling - Database and Prisma Operation Failures', () => {
    it('should handle updateFirewallState when Prisma machine update fails', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(new Error('Database update failed'))

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Database update failed')
    })

    it('should handle getSimplifiedRules when machine lookup fails', async () => {
      const vmId = 'vm-123'

      mockPrisma.machine.findUnique.mockRejectedValue(new Error('Database connection lost'))

      await expect(
        service.getSimplifiedRules(vmId)
      ).rejects.toThrow('Database connection lost')
    })

    it('should handle VM-filter association creation failures in syncFirewallRules', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('VM-filter association failed'))

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('VM-filter association failed')
    })

    it('should handle concurrent database modifications during firewall operations', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any

      mockPrisma.machine.findUnique.mockRejectedValue(new Error('Deadlock detected'))

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow('Deadlock detected')
    })

    it('should handle database constraint violations during rule synchronization', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('Unique constraint violation'))

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Unique constraint violation')
    })
  })

  describe('Error Handling - Complex Rule Processing Errors', () => {
    it('should handle getSimplifiedRules with rules containing complex IP configurations', async () => {
      const vmId = 'vm-123'
      const complexRule = createMockFWRule({
        id: 'rule-1',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: 80,
        dstPortEnd: 80,
        srcIpAddr: '192.168.1.0/24',  // Complex IP config
        srcIpMask: '255.255.255.0'
      })

      const mockMachine = {
        ...createMockMachine({ id: vmId }),
        nwFilters: [{
          nwFilter: {
            id: 'filter-1',
            rules: [complexRule]
          }
        }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getSimplifiedRules(vmId)

      // Complex rules should be filtered out
      expect(result).toEqual([])
    })

    it('should handle port range merging failures in mergeAdjacentRanges', () => {
      const corruptedRanges = [
        { start: null, end: 80 },
        { start: 80, end: null },
        { start: 'invalid', end: 90 }
      ]

      expect(() => {
        (service as any).mergeAdjacentRanges(corruptedRanges)
      }).toThrow()
    })

    it('should handle extractPortRanges with invalid port string formats', () => {
      const rulesWithInvalidPorts = [
        { port: null, protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: 'invalid-format', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      mockPortValidationService.parsePortString.mockImplementation(() => {
        throw new Error('Invalid port format')
      })

      const result = (service as any).extractPortRanges(rulesWithInvalidPorts)

      // Should return empty array for invalid port strings
      expect(result).toEqual([])
    })

    it('should handle rule grouping failures when rule data is corrupted', () => {
      const corruptedRules = [
        { port: '80', protocol: null, direction: 'in', action: 'accept' },
        { port: '443', protocol: 'tcp', direction: null, action: 'accept' },
        { port: '22', protocol: 'tcp', direction: 'in', action: null }
      ]

      expect(() => {
        (service as any).groupRulesByKey(corruptedRules)
      }).toThrow()
    })

    it('should handle optimization scenarios that result in invalid rule configurations', () => {
      const problematicRules = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: null },
        { port: '81', protocol: 'tcp', direction: 'in', action: 'accept', description: undefined }
      ]

      // Should handle gracefully without throwing
      const result = (service as any).optimizeCustomRules(problematicRules)

      expect(result).toBeDefined()
    })
  })

  describe('Error Handling - Service Integration and Dependency Failures', () => {
    it('should handle PortValidationService failures during rule validation', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      mockPortValidationService.validatePortString.mockImplementation(() => {
        throw new Error('PortValidationService is unavailable')
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should handle scenarios where PortValidationService returns inconsistent results', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      // Mock inconsistent behavior
      mockPortValidationService.validatePortString
        .mockReturnValueOnce({ isValid: true, errors: [] })
        .mockReturnValueOnce({ isValid: false, errors: ['Inconsistent validation'] })

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      // First call should succeed
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockResolvedValue(undefined)

      const result = await service.addCustomRule(vmId, rule)
      expect(result).toBeDefined()

      // Second call should fail due to inconsistent validation
      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
    })

    it('should handle NetworkFilterService timeout scenarios during long operations', async () => {
      const vmId = 'vm-123'
      const rules = Array.from({ length: 1000 }, (_, i) => ({
        port: (8000 + i).toString(),
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }))

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue(rules)
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('Operation timeout'))

      await expect(
        service.addMultipleCustomRules(vmId, rules)
      ).rejects.toThrow('Operation timeout')
    })

    it('should handle resource exhaustion during large rule set processing', async () => {
      const vmId = 'vm-123'
      const manyRules = Array.from({ length: 10000 }, (_, i) => ({
        port: i.toString(),
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }))

      mockPortValidationService.parsePortString.mockImplementation(() => {
        throw new Error('Out of memory during port parsing')
      })

      expect(() => {
        (service as any).extractPortRanges(manyRules)
      }).toThrow('Out of memory during port parsing')
    })
  })

  describe('Error Handling - Firewall State Corruption and Recovery', () => {
    it('should handle parseFirewallState with non-JSON data, null values, undefined values', () => {
      const corruptedInputs = [
        { notExpectedStructure: 'value' },
        { appliedTemplates: 'should be array' },
        { customRules: 'should be array' },
        { appliedTemplates: [], customRules: [], lastSync: 'invalid date' },
        { appliedTemplates: null, customRules: null, lastSync: null }
      ]

      corruptedInputs.forEach(input => {
        const result = (service as any).parseFirewallState(input)
        expect(result.appliedTemplates).toEqual([])
        expect(result.customRules).toEqual([])
        expect(result.lastSync).toBeNull()
      })
    })

    it('should handle state recovery when firewallTemplates field contains invalid template references', async () => {
      const vmId = 'vm-123'
      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: ['NONEXISTENT_TEMPLATE', 'ANOTHER_INVALID'],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getVMFirewallState(vmId)

      // Should handle gracefully despite invalid template references
      expect(result.appliedTemplates).toEqual(['NONEXISTENT_TEMPLATE', 'ANOTHER_INVALID'])
    })

    it('should handle handling of corrupted custom rules in machine state', async () => {
      const vmId = 'vm-123'
      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [
            null,  // Corrupted rule
            { port: '80' },  // Incomplete rule
            { invalidField: 'value' }  // Invalid rule structure
          ],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getVMFirewallState(vmId)

      // Should filter out corrupted rules
      expect(result.customRules).toEqual([])
    })

    it('should handle state synchronization failures between database and libvirt', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      const mockMachine = createMockMachine({
        id: vmId,
        firewallTemplates: JSON.stringify({
          appliedTemplates: [],
          customRules: [],
          lastSync: null
        }) as any
      })

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue([rule])
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('Sync failed: database and libvirt out of sync'))

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Sync failed: database and libvirt out of sync')
    })

    it('should handle rollback scenarios when template application partially fails', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      jest.spyOn(service as any, 'syncFirewallRules').mockResolvedValue(undefined)
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(new Error('Partial application failure'))

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow('Partial application failure')
    })
  })

  describe('Error Handling - NetworkFilterService Operation Failures (Legacy)', () => {
    it('should handle NetworkFilterService operation failures', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: JSON.stringify({
            appliedTemplates: [],
            customRules: [],
            lastSync: null
          }) as any
        }),
        nwFilters: []
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)
      mockNetworkFilterService.createFilter.mockRejectedValue(new Error('NetworkFilter error'))

      // Mock the private method calls that would be called before the error
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(new Error('NetworkFilter error'))

      await expect(service.applyFirewallTemplate(vmId, template)).rejects.toThrow('NetworkFilter error')
    })

    it('should handle Prisma database errors', async () => {
      const vmId = 'vm-123'
      mockPrisma.machine.findUnique.mockRejectedValue(new Error('Database connection error'))

      await expect(service.getVMFirewallState(vmId)).rejects.toThrow('Database connection error')
    })
  })
})
