import { NWFilterXMLGeneratorService } from '@services/firewall/NWFilterXMLGeneratorService'
import { FirewallRule, RuleAction, RuleDirection, RuleSetType } from '@prisma/client'
import xml2js from 'xml2js'

describe('NWFilterXMLGeneratorService', () => {
  let service: NWFilterXMLGeneratorService

  beforeEach(() => {
    service = new NWFilterXMLGeneratorService()
  })

  describe('generateFilterName', () => {
    it('should generate name with ibay- prefix for department', () => {
      const name = service.generateFilterName(RuleSetType.DEPARTMENT, 'dept-123')

      expect(name).toMatch(/^ibay-department-[a-f0-9]{8}$/)
    })

    it('should generate name with ibay- prefix for VM', () => {
      const name = service.generateFilterName(RuleSetType.VM, 'vm-456')

      expect(name).toMatch(/^ibay-vm-[a-f0-9]{8}$/)
    })

    it('should generate consistent names for same entity ID', () => {
      const name1 = service.generateFilterName(RuleSetType.VM, 'vm-789')
      const name2 = service.generateFilterName(RuleSetType.VM, 'vm-789')

      expect(name1).toBe(name2)
    })

    it('should generate different names for different entity IDs', () => {
      const name1 = service.generateFilterName(RuleSetType.VM, 'vm-111')
      const name2 = service.generateFilterName(RuleSetType.VM, 'vm-222')

      expect(name1).not.toBe(name2)
    })
  })

  describe('generateFilterXML', () => {
    it('should generate valid XML for simple ACCEPT rule', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow HTTP',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          priority: 100
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-test-filter',
        rules: rules as FirewallRule[]
      })

      expect(xml).toContain('ibay-test-filter')
      expect(xml).toContain('tcp')
      expect(xml).toContain('dstportstart="80"')
      expect(xml).toContain('action="accept"')
      expect(xml).toContain('direction="in"')
    })

    it('should generate valid XML for DROP rule with port range', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Block port range',
          action: RuleAction.DROP,
          direction: RuleDirection.OUT,
          protocol: 'tcp',
          dstPortStart: 8000,
          dstPortEnd: 9000,
          priority: 200
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-block-range',
        rules: rules as FirewallRule[]
      })

      expect(xml).toContain('action="drop"')
      expect(xml).toContain('direction="out"')
      expect(xml).toContain('dstportstart="8000"')
      expect(xml).toContain('dstportend="9000"')
    })

    it('should generate XML with IP address restrictions', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow from specific IP',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 22,
          dstPortEnd: 22,
          srcIpAddr: '192.168.1.100',
          srcIpMask: '255.255.255.255',
          priority: 100
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-ip-filter',
        rules: rules as FirewallRule[]
      })

      expect(xml).toContain('srcipaddr="192.168.1.100"')
      expect(xml).toContain('srcipmask="255.255.255.255"')
    })

    it('should generate XML with connection state tracking', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow established',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          connectionState: { established: true, related: true },
          priority: 100
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-stateful',
        rules: rules as FirewallRule[]
      })

      expect(xml).toContain('state="ESTABLISHED,RELATED"')
    })

    it('should generate valid XML for ICMP protocol without ports', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow ICMP',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.INOUT,
          protocol: 'icmp',
          dstPortStart: null,
          dstPortEnd: null,
          priority: 300
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-icmp',
        rules: rules as FirewallRule[]
      })

      expect(xml).toContain('icmp')
      expect(xml).toContain('action="accept"')
      expect(xml).not.toContain('dstportstart')
    })

    it('should generate XML for "all" protocol', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Allow all',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.INOUT,
          protocol: 'all',
          dstPortStart: null,
          dstPortEnd: null,
          priority: 1000
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-all',
        rules: rules as FirewallRule[]
      })

      expect(xml).toContain('action="accept"')
      expect(xml).toContain('direction="inout"')
    })

    it('should generate parseable XML structure', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'Test rule',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 443,
          dstPortEnd: 443,
          priority: 100
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-test',
        rules: rules as FirewallRule[]
      })

      // Parse XML to verify it's well-formed
      const parser = new xml2js.Parser()
      const parsed = await parser.parseStringPromise(xml)

      expect(parsed.filter).toBeDefined()
      expect(parsed.filter.$.name).toBe('ibay-test')
      expect(parsed.filter.$.chain).toBe('root')
      expect(parsed.filter.uuid).toBeDefined()
      expect(parsed.filter.rule).toHaveLength(1)
    })

    it('should generate XML with multiple rules in priority order', async () => {
      const rules: Partial<FirewallRule>[] = [
        {
          id: '1',
          name: 'High priority',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          priority: 50
        },
        {
          id: '2',
          name: 'Medium priority',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 443,
          dstPortEnd: 443,
          priority: 100
        },
        {
          id: '3',
          name: 'Low priority',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'all',
          dstPortStart: null,
          dstPortEnd: null,
          priority: 1000
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-multi',
        rules: rules as FirewallRule[]
      })

      const parser = new xml2js.Parser()
      const parsed = await parser.parseStringPromise(xml)

      expect(parsed.filter.rule).toHaveLength(3)
      expect(parsed.filter.rule[0].$.priority).toBe('50')
      expect(parsed.filter.rule[1].$.priority).toBe('100')
      expect(parsed.filter.rule[2].$.priority).toBe('1000')
    })
  })

  describe('addFilterReference', () => {
    it('should generate XML with filterref element', async () => {
      const xml = await service.addFilterReference('ibay-parent', 'ibay-child')

      expect(xml).toContain('filterref')
      expect(xml).toContain('ibay-child')

      const parser = new xml2js.Parser()
      const parsed = await parser.parseStringPromise(xml)

      expect(parsed.filter.filterref).toBeDefined()
    })
  })

  describe('generateFilterXML with inheritance', () => {
    it('should generate VM filter with department filter reference', async () => {
      const vmRules: Partial<FirewallRule>[] = [
        {
          id: 'vm-rule-1',
          name: 'VM Custom Port',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 8080,
          dstPortEnd: 8080,
          priority: 200
        }
      ]

      const xml = await service.generateFilterXML(
        {
          name: 'ibay-vm-test123',
          rules: vmRules as FirewallRule[]
        },
        'ibay-department-parent456' // Parent filter
      )

      const parser = new xml2js.Parser()
      const parsed = await parser.parseStringPromise(xml)

      // Should have filterref to inherit from department
      expect(parsed.filter.filterref).toBeDefined()
      expect(parsed.filter.filterref).toHaveLength(1)
      expect(parsed.filter.filterref[0].$.filter).toBe('ibay-department-parent456')

      // Should also have own rules
      expect(parsed.filter.rule).toBeDefined()
      expect(parsed.filter.rule).toHaveLength(1)
      expect(parsed.filter.rule[0].$.priority).toBe('200')
    })

    it('should generate VM filter with NO rules but WITH parent reference', async () => {
      const vmRules: Partial<FirewallRule>[] = []

      const xml = await service.generateFilterXML(
        {
          name: 'ibay-vm-noownrules',
          rules: vmRules as FirewallRule[]
        },
        'ibay-department-parent'
      )

      const parser = new xml2js.Parser()
      const parsed = await parser.parseStringPromise(xml)

      // Should have filterref even with no own rules
      expect(parsed.filter.filterref).toBeDefined()
      expect(parsed.filter.filterref[0].$.filter).toBe('ibay-department-parent')

      // Should NOT have rules array
      expect(parsed.filter.rule).toBeUndefined()
    })

    it('should generate department filter WITHOUT parent reference', async () => {
      const deptRules: Partial<FirewallRule>[] = [
        {
          id: 'dept-rule-1',
          name: 'Allow HTTPS',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 443,
          dstPortEnd: 443,
          priority: 100
        }
      ]

      const xml = await service.generateFilterXML({
        name: 'ibay-department-dept123',
        rules: deptRules as FirewallRule[]
      })

      const parser = new xml2js.Parser()
      const parsed = await parser.parseStringPromise(xml)

      // Should NOT have filterref (department is base)
      expect(parsed.filter.filterref).toBeUndefined()

      // Should have own rules
      expect(parsed.filter.rule).toBeDefined()
      expect(parsed.filter.rule).toHaveLength(1)
    })

    it('should position filterref before rules in XML', async () => {
      const vmRules: Partial<FirewallRule>[] = [
        {
          id: 'vm-rule-1',
          name: 'VM Rule',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 3000,
          dstPortEnd: 3000,
          priority: 300
        }
      ]

      const xml = await service.generateFilterXML(
        {
          name: 'ibay-vm-ordered',
          rules: vmRules as FirewallRule[]
        },
        'ibay-department-base'
      )

      // Verify filterref appears before rule elements in XML string
      const filterrefIndex = xml.indexOf('<filterref')
      const ruleIndex = xml.indexOf('<rule')

      expect(filterrefIndex).toBeGreaterThan(-1)
      expect(ruleIndex).toBeGreaterThan(-1)
      expect(filterrefIndex).toBeLessThan(ruleIndex)
    })

    it('should support multiple VM rules with inheritance', async () => {
      const vmRules: Partial<FirewallRule>[] = [
        {
          id: 'vm-rule-1',
          name: 'Custom Port 1',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 3000,
          dstPortEnd: 3000,
          priority: 200
        },
        {
          id: 'vm-rule-2',
          name: 'Custom Port 2',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 4000,
          dstPortEnd: 4000,
          priority: 250
        }
      ]

      const xml = await service.generateFilterXML(
        {
          name: 'ibay-vm-multi',
          rules: vmRules as FirewallRule[]
        },
        'ibay-department-dept'
      )

      const parser = new xml2js.Parser()
      const parsed = await parser.parseStringPromise(xml)

      // Should have filterref
      expect(parsed.filter.filterref).toBeDefined()
      expect(parsed.filter.filterref[0].$.filter).toBe('ibay-department-dept')

      // Should have both VM rules
      expect(parsed.filter.rule).toHaveLength(2)
      expect(parsed.filter.rule[0].$.priority).toBe('200')
      expect(parsed.filter.rule[1].$.priority).toBe('250')
    })
  })
})
