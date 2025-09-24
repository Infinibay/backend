import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { FirewallSimplifierService } from '../../../app/services/FirewallSimplifierService'
import { NetworkFilterService } from '../../../app/services/networkFilterService'
import { PortValidationService } from '../../../app/services/PortValidationService'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockMachine, createMockFWRule } from '../../setup/mock-factories'
import { AppError, ErrorCode } from '../../../app/utils/errors/ErrorHandler'

// Mock dependencies
jest.mock('../../../app/services/networkFilterService')
jest.mock('../../../app/services/PortValidationService')

describe('FirewallSimplifierService - Comprehensive Error Handling', () => {
  let service: FirewallSimplifierService
  let mockNetworkFilterService: jest.Mocked<NetworkFilterService>
  let mockPortValidationService: jest.Mocked<PortValidationService>

  beforeEach(() => {
    jest.clearAllMocks()
    service = new FirewallSimplifierService(mockPrisma)
    mockNetworkFilterService = jest.mocked(NetworkFilterService.prototype)
    mockPortValidationService = jest.mocked(PortValidationService.prototype)

    // Setup default successful behaviors
    mockPortValidationService.validatePortString.mockReturnValue({
      isValid: true,
      errors: []
    })
    mockPortValidationService.parsePortString.mockImplementation((portString: string) => {
      if (portString === 'all') return [{ start: 1, end: 65535 }]
      if (portString.includes('-')) {
        const [start, end] = portString.split('-').map(Number)
        return [{ start, end }]
      }
      const port = Number(portString)
      return [{ start: port, end: port }]
    })
  })

  describe('Comprehensive Port Validation Failures', () => {
    it('should handle all methods with various invalid port string formats', async () => {
      const vmId = 'vm-123'
      const invalidPortFormats = [
        'port-70000',     // Port > 65535
        '-1',             // Negative port
        '0',              // Zero port
        '80-79',          // Invalid range (start > end)
        '80,',            // Trailing comma
        ',80',            // Leading comma
        '80,,443',        // Double comma
        'abc',            // Non-numeric
        '80-abc',         // Partial non-numeric
        '80.5',           // Decimal
        '80/tcp',         // Mixed format
        '80 443',         // Space instead of comma
        '80:443',         // Colon instead of dash
        '',               // Empty string
        '   ',            // Whitespace only
        '80-',            // Incomplete range
        '-80',            // Incomplete range start
        '80--443',        // Double dash
        '999999999999',   // Extremely large number
        'NaN',            // Literal NaN
        'undefined',      // Literal undefined
        'null'            // Literal null
      ]

      for (const invalidPort of invalidPortFormats) {
        mockPortValidationService.validatePortString.mockReturnValue({
          isValid: false,
          errors: [`Invalid port format: ${invalidPort}`]
        })

        const rule = {
          port: invalidPort,
          protocol: 'tcp',
          direction: 'in' as const,
          action: 'accept' as const
        }

        await expect(
          service.addCustomRule(vmId, rule)
        ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
      }
    })

    it('should handle port range validation edge cases', async () => {
      const vmId = 'vm-123'
      const edgeCases = [
        { port: '65536', description: 'Port exactly at limit + 1' },
        { port: '0-80', description: 'Range starting at 0' },
        { port: '80-65536', description: 'Range ending beyond limit' },
        { port: '1-65535', description: 'Full valid range' },
        { port: '80-80', description: 'Single port as range' },
        { port: '443-80', description: 'Reverse range' }
      ]

      for (const edgeCase of edgeCases) {
        mockPortValidationService.validatePortString.mockReturnValue({
          isValid: false,
          errors: [edgeCase.description]
        })

        const rule = {
          port: edgeCase.port,
          protocol: 'tcp',
          direction: 'in' as const,
          action: 'accept' as const
        }

        await expect(
          service.addCustomRule(vmId, rule)
        ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
      }
    })

    it('should handle protocol-port combination validation failures', async () => {
      const vmId = 'vm-123'
      const invalidCombinations = [
        { port: 'all', protocol: 'icmp', error: 'ICMP does not use ports' },
        { port: '80', protocol: 'invalid-protocol', error: 'Unsupported protocol' },
        { port: '1-65535', protocol: 'esp', error: 'ESP protocol incompatible with port ranges' }
      ]

      for (const combo of invalidCombinations) {
        mockPortValidationService.validatePortString.mockReturnValue({
          isValid: false,
          errors: [combo.error]
        })

        const rule = {
          port: combo.port,
          protocol: combo.protocol,
          direction: 'in' as const,
          action: 'accept' as const
        }

        await expect(
          service.addCustomRule(vmId, rule)
        ).rejects.toMatchObject({ name: 'AppError', code: ErrorCode.VALIDATION_ERROR })
      }
    })

    it('should handle PortValidationService integration failures', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      // Service throws exception instead of returning validation result
      mockPortValidationService.validatePortString.mockImplementation(() => {
        throw new Error('PortValidationService internal error')
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('PortValidationService internal error')
    })
  })

  describe('Machine State and Data Corruption', () => {
    it('should handle all methods consistently throwing "Machine not found" errors', async () => {
      const vmId = 'nonexistent-vm'
      const rule = { port: '80', protocol: 'tcp', direction: 'in' as const, action: 'accept' as const }
      const template = 'WEB_SERVER' as any

      mockPrisma.machine.findUnique.mockResolvedValue(null)

      // Test all public methods that should throw consistent errors
      const methodTests = [
        () => service.getVMFirewallState(vmId),
        () => service.applyFirewallTemplate(vmId, template),
        () => service.removeFirewallTemplate(vmId, template),
        () => service.toggleFirewallTemplate(vmId, template),
        () => service.getSimplifiedRules(vmId),
        () => service.addCustomRule(vmId, rule),
        () => service.addMultipleCustomRules(vmId, [rule])
      ]

      for (const methodTest of methodTests) {
        await expect(methodTest()).rejects.toThrow(`Machine ${vmId} not found`)
      }
    })

    it('should handle extreme firewallTemplates JSON corruption scenarios', async () => {
      const vmId = 'vm-123'
      const corruptionScenarios = [
        'completely-invalid-json{[',
        '{"appliedTemplates":corrupted}',
        '{"customRules":[null,undefined,{}]}',
        '{"lastSync":"not-a-date","appliedTemplates":123}',
        '{appliedTemplates":["unclosed"]}',
        'null',
        'undefined',
        '{"recursive":{"reference":{"to":"self"}}}',
        'true',
        '123',
        '"just a string"',
        '[]',
        '{"appliedTemplates":null,"customRules":"should-be-array"}',
        '{"appliedTemplates":["template1",123,null,"template2"]}',
        '{"customRules":[{"port":null,"protocol":undefined}]}'
      ]

      for (const corruptedJson of corruptionScenarios) {
        const mockMachine = createMockMachine({
          id: vmId,
          firewallTemplates: corruptedJson as any
        })

        mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

        const result = await service.getVMFirewallState(vmId)

        // Should always return default state for corrupted data
        expect(result.appliedTemplates).toEqual([])
        expect(result.customRules).toEqual([])
        expect(result.lastSync).toBeNull()
      }
    })

    it('should handle machine state inconsistencies across different scenarios', async () => {
      const vmId = 'vm-123'
      const inconsistentStates = [
        { nwFilters: null, description: 'Null nwFilters array' },
        { nwFilters: undefined, description: 'Undefined nwFilters array' },
        { nwFilters: 'not-an-array', description: 'nwFilters as string' },
        { nwFilters: [{ nwFilter: null }], description: 'Null nwFilter object' },
        { nwFilters: [{ nwFilter: { rules: null } }], description: 'Null rules array' },
        { nwFilters: [{ invalid: 'structure' }], description: 'Invalid nwFilter structure' }
      ]

      for (const state of inconsistentStates) {
        const mockMachine = {
          ...createMockMachine({ id: vmId }),
          ...state
        } as any

        mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

        await expect(
          service.getSimplifiedRules(vmId)
        ).rejects.toThrow()
      }
    })

    it('should handle concurrent modifications during state updates', async () => {
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

      // Simulate concurrent modification during update
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(
        new Error('Concurrent modification: machine state changed during update')
      )

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Concurrent modification: machine state changed during update')
    })

    it('should handle machine deletion during active operations', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      // Machine exists initially
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

      // Machine gets deleted during operation
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(
        new Error('Machine deleted during operation')
      )

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Machine deleted during operation')
    })
  })

  describe('Template Processing Failures', () => {
    it('should handle template application with completely invalid template definitions', async () => {
      const vmId = 'vm-123'
      const invalidTemplates = [
        'NONEXISTENT_TEMPLATE' as any,
        'CORRUPTED_TEMPLATE' as any,
        null as any,
        undefined as any,
        '' as any,
        123 as any,
        {} as any
      ]

      for (const template of invalidTemplates) {
        await expect(
          service.applyFirewallTemplate(vmId, template)
        ).rejects.toThrow()
      }
    })

    it('should handle calculateEffectiveRules with corrupted template rule definitions', async () => {
      const corruptedTemplates = ['CORRUPTED_TEMPLATE', 'INVALID_TEMPLATE']
      const customRules: any[] = []

      // Mock scenario where template rules are corrupted
      await expect(
        (service as any).calculateEffectiveRules(corruptedTemplates, customRules)
      ).rejects.toThrow()
    })

    it('should handle rule optimization failures with extremely corrupted data', async () => {
      const extremelyCorruptedRules = [
        null,
        undefined,
        { port: Symbol('invalid'), protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '80', protocol: new Date(), direction: 'in', action: 'accept' },
        { port: '80', protocol: 'tcp', direction: ['invalid'], action: 'accept' },
        { port: '80', protocol: 'tcp', direction: 'in', action: { invalid: 'object' } },
        { port: () => '80', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', sources: 'should-be-array' }
      ]

      for (const corruptedRule of extremelyCorruptedRules) {
        expect(() => {
          (service as any).optimizeCustomRules([corruptedRule])
        }).toThrow()
      }
    })

    it('should handle convertToSimplifiedRule with all possible FWRule corruption types', async () => {
      const corruptedFWRules = [
        null,
        undefined,
        {},
        { protocol: null, direction: 'in', action: 'accept' },
        { protocol: 'tcp', direction: null, action: 'accept' },
        { protocol: 'tcp', direction: 'in', action: null },
        { protocol: 'tcp', direction: 'invalid', action: 'accept' },
        { protocol: 'tcp', direction: 'in', action: 'invalid' },
        { protocol: 'tcp', direction: 'in', action: 'accept', dstPortStart: 'not-a-number' },
        { protocol: 'tcp', direction: 'in', action: 'accept', dstPortEnd: 'not-a-number' },
        { protocol: 'tcp', direction: 'in', action: 'accept', dstPortStart: -1 },
        { protocol: 'tcp', direction: 'in', action: 'accept', dstPortEnd: 70000 },
        { protocol: 'tcp', direction: 'in', action: 'accept', dstPortStart: 80, dstPortEnd: 79 }
      ]

      for (const corruptedRule of corruptedFWRules) {
        expect(() => {
          (service as any).convertToSimplifiedRule(corruptedRule)
        }).toThrow()
      }
    })

    it('should handle template removal when template state is completely corrupted', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any
      const mockMachine = {
        ...createMockMachine({
          id: vmId,
          firewallTemplates: 'corrupted-state-beyond-recovery' as any
        }),
        nwFilters: null
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      // Should handle gracefully despite complete corruption
      const result = await service.removeFirewallTemplate(vmId, template)
      expect(result).toBeDefined()
    })
  })

  describe('NetworkFilterService Operation Failures', () => {
    it('should handle syncFirewallRules with complete NetworkFilterService failure', async () => {
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

      // Complete NetworkFilterService failure
      jest.spyOn(service as any, 'syncFirewallRules').mockImplementation(() => {
        throw new Error('NetworkFilterService completely unavailable')
      })

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow('NetworkFilterService completely unavailable')
    })

    it('should handle createNWFilterRule with cascading NetworkFilterService failures', async () => {
      const vmId = 'vm-123'
      const rules = Array.from({ length: 10 }, (_, i) => ({
        port: (80 + i).toString(),
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

      // NetworkFilterService fails after processing some rules
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(
        new Error('NetworkFilterService cascade failure after partial success')
      )

      await expect(
        service.addMultipleCustomRules(vmId, rules)
      ).rejects.toThrow('NetworkFilterService cascade failure after partial success')
    })

    it('should handle filter creation success but rule creation catastrophic failure', async () => {
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

      // Filter created but all rule creation fails catastrophically
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(
        new Error('Catastrophic failure: all rule operations failed after filter creation')
      )

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Catastrophic failure: all rule operations failed after filter creation')
    })

    it('should handle NetworkFilterService timeout during critical operations', async () => {
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

      // Critical operation timeout
      jest.spyOn(service as any, 'syncFirewallRules').mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Critical operation timeout: system unresponsive')), 1)
        })
      })

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow('Critical operation timeout: system unresponsive')
    })
  })

  describe('Database and Prisma Catastrophic Failures', () => {
    it('should handle complete database unavailability', async () => {
      const vmId = 'vm-123'

      mockPrisma.machine.findUnique.mockRejectedValue(
        new Error('Database completely unavailable: all connections failed')
      )

      await expect(
        service.getVMFirewallState(vmId)
      ).rejects.toThrow('Database completely unavailable: all connections failed')
    })

    it('should handle database corruption during critical updates', async () => {
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

      // Database corruption during update
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(
        new Error('Database corruption detected: data integrity check failed')
      )

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Database corruption detected: data integrity check failed')
    })

    it('should handle Prisma client crashes during operations', async () => {
      const vmId = 'vm-123'

      mockPrisma.machine.findUnique.mockImplementation(() => {
        throw new Error('Prisma client crashed: segmentation fault')
      })

      await expect(
        service.getVMFirewallState(vmId)
      ).rejects.toThrow('Prisma client crashed: segmentation fault')
    })

    it('should handle database deadlock during complex multi-table operations', async () => {
      const vmId = 'vm-123'
      const template = 'WEB_SERVER' as any

      mockPrisma.machine.findUnique.mockRejectedValue(
        new Error('Deadlock detected: complex multi-table operation failed')
      )

      await expect(
        service.applyFirewallTemplate(vmId, template)
      ).rejects.toThrow('Deadlock detected: complex multi-table operation failed')
    })

    it('should handle database transaction isolation failures', async () => {
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

      // Transaction isolation failure
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(
        new Error('Transaction isolation failure: read uncommitted data detected')
      )

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Transaction isolation failure: read uncommitted data detected')
    })
  })

  describe('Complex Rule Processing Catastrophic Errors', () => {
    it('should handle memory exhaustion during massive rule processing', async () => {
      const vmId = 'vm-123'
      const massiveRuleSet = Array.from({ length: 1000 }, (_, i) => ({
        port: i.toString(),
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }))

      // Mock memory exhaustion during processing
      mockPortValidationService.parsePortString.mockImplementation(() => {
        throw new Error('Out of memory during port parsing')
      })

      expect(() => {
        (service as any).extractPortRanges(massiveRuleSet)
      }).toThrow('Out of memory during port parsing')
    })

    it('should handle infinite loop scenarios in rule optimization', async () => {
      const problematicRules = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Rule A' },
        { port: '81', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Rule B' }
      ]

      // Mock infinite loop scenario
      jest.spyOn(service as any, 'mergeAdjacentRanges').mockImplementation(() => {
        throw new Error('Infinite loop detected in rule merging algorithm')
      })

      expect(() => {
        (service as any).optimizeCustomRules(problematicRules)
      }).toThrow('Infinite loop detected in rule merging algorithm')
    })

    it('should handle stack overflow during deep rule recursion', async () => {
      const deeplyNestedRules = Array.from({ length: 10000 }, (_, i) => ({
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const,
        description: `Nested rule ${i}`
      }))

      // Stack overflow during processing
      mockPortValidationService.parsePortString.mockImplementation(() => {
        throw new Error('Maximum call stack size exceeded')
      })

      expect(() => {
        (service as any).extractPortRanges(deeplyNestedRules)
      }).toThrow('Maximum call stack size exceeded')
    })

    it('should handle rule grouping catastrophic failures', async () => {
      const corruptedRules = [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept' }
      ]

      // Catastrophic failure in grouping logic
      jest.spyOn(service as any, 'groupRulesByKey').mockImplementation(() => {
        throw new Error('Catastrophic failure in rule grouping: algorithm corrupted')
      })

      expect(() => {
        (service as any).optimizeCustomRules(corruptedRules)
      }).toThrow('Catastrophic failure in rule grouping: algorithm corrupted')
    })

    it('should handle rule conversion failures with complex IP configurations', async () => {
      const vmId = 'vm-123'
      const extremelyComplexRule = createMockFWRule({
        id: 'rule-1',
        protocol: 'tcp',
        direction: 'in',
        action: 'accept',
        dstPortStart: 80,
        dstPortEnd: 80,
        srcIpAddr: '192.168.1.0/24',
        srcIpMask: '255.255.255.0',
        dstIpAddr: '10.0.0.0/8',
        dstIpMask: '255.0.0.0'
      })

      const mockMachine = {
        ...createMockMachine({ id: vmId }),
        nwFilters: [{
          nwFilter: {
            id: 'filter-1',
            rules: [extremelyComplexRule]
          }
        }]
      } as any

      mockPrisma.machine.findUnique.mockResolvedValue(mockMachine)

      const result = await service.getSimplifiedRules(vmId)

      // Extremely complex rules should be filtered out
      expect(result).toEqual([])
    })
  })

  describe('Service Integration Catastrophic Failures', () => {
    it('should handle complete PortValidationService unavailability', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      // Complete service unavailability
      mockPortValidationService.validatePortString.mockImplementation(() => {
        throw new Error('PortValidationService completely unavailable: service crashed')
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('PortValidationService completely unavailable: service crashed')
    })

    it('should handle service dependency version mismatches', async () => {
      const vmId = 'vm-123'
      const rule = {
        port: '80',
        protocol: 'tcp',
        direction: 'in' as const,
        action: 'accept' as const
      }

      mockPortValidationService.validatePortString.mockImplementation(() => {
        throw new Error('Service version mismatch: incompatible API version')
      })

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Service version mismatch: incompatible API version')
    })

    it('should handle circular dependency failures between services', async () => {
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

      // Circular dependency between services
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(
        new Error('Circular dependency detected between FirewallSimplifierService and NetworkFilterService')
      )

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('Circular dependency detected between FirewallSimplifierService and NetworkFilterService')
    })

    it('should handle service resource exhaustion during peak load', async () => {
      const vmId = 'vm-123'
      const manyRules = Array.from({ length: 1000 }, (_, i) => ({
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
      jest.spyOn(service as any, 'calculateEffectiveRules').mockResolvedValue(manyRules)

      // Service resource exhaustion
      jest.spyOn(service as any, 'syncFirewallRules').mockRejectedValue(
        new Error('Service resource exhaustion: too many concurrent operations')
      )

      await expect(
        service.addMultipleCustomRules(vmId, manyRules)
      ).rejects.toThrow('Service resource exhaustion: too many concurrent operations')
    })
  })

  describe('System-Level Catastrophic Failures', () => {
    it('should handle complete system memory exhaustion', async () => {
      const vmId = 'vm-123'

      mockPrisma.machine.findUnique.mockImplementation(() => {
        throw new Error('System memory exhausted: cannot allocate memory')
      })

      await expect(
        service.getVMFirewallState(vmId)
      ).rejects.toThrow('System memory exhausted: cannot allocate memory')
    })

    it('should handle file system corruption affecting operations', async () => {
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

      // File system corruption
      jest.spyOn(service as any, 'updateFirewallState').mockRejectedValue(
        new Error('File system corruption: cannot write to database')
      )

      await expect(
        service.addCustomRule(vmId, rule)
      ).rejects.toThrow('File system corruption: cannot write to database')
    })

    it('should handle network infrastructure complete failure', async () => {
      const vmId = 'vm-123'

      mockPrisma.machine.findUnique.mockRejectedValue(
        new Error('Network infrastructure failure: all network connections lost')
      )

      await expect(
        service.getVMFirewallState(vmId)
      ).rejects.toThrow('Network infrastructure failure: all network connections lost')
    })

    it('should handle operating system kernel panic scenarios', async () => {
      const vmId = 'vm-123'

      mockPrisma.machine.findUnique.mockImplementation(() => {
        throw new Error('Kernel panic: system halted')
      })

      await expect(
        service.getVMFirewallState(vmId)
      ).rejects.toThrow('Kernel panic: system halted')
    })
  })
})