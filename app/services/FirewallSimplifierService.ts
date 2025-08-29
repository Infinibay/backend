import { PrismaClient, Machine, NWFilter, FWRule } from '@prisma/client'
import { NetworkFilterService } from './networkFilterService'
import { Debugger } from '@utils/debug'

export enum FirewallTemplate {
  WEB_SERVER = 'WEB_SERVER',
  DATABASE = 'DATABASE',
  DESKTOP = 'DESKTOP',
  DEVELOPMENT = 'DEVELOPMENT'
}

export interface SimplifiedRule {
  id?: string
  port: string // Always string to be compatible with GraphQL types
  protocol: string
  direction: 'in' | 'out' | 'inout'
  action: 'accept' | 'drop' | 'reject'
  description?: string
  sources?: string[] // Track which templates or custom rules created this
}

export interface VMFirewallState {
  appliedTemplates: string[]
  customRules: SimplifiedRule[]
  effectiveRules: SimplifiedRule[]
  lastSync: Date | null
}

interface TemplateDefinition {
  name: string
  description: string
  rules: SimplifiedRule[]
}

export class FirewallSimplifierService {
  private prisma: PrismaClient
  private networkFilterService: NetworkFilterService
  private debug: Debugger

  // Template definitions
  private readonly templates: Map<FirewallTemplate, TemplateDefinition> = new Map([
    [FirewallTemplate.WEB_SERVER, {
      name: 'Web Server',
      description: 'Allow HTTP, HTTPS and SSH access',
      rules: [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', description: 'SSH' }
      ]
    }],
    [FirewallTemplate.DATABASE, {
      name: 'Database Server',
      description: 'Allow database connections and SSH',
      rules: [
        { port: '3306', protocol: 'tcp', direction: 'in', action: 'accept', description: 'MySQL' },
        { port: '5432', protocol: 'tcp', direction: 'in', action: 'accept', description: 'PostgreSQL' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', description: 'SSH' }
      ]
    }],
    [FirewallTemplate.DESKTOP, {
      name: 'Desktop',
      description: 'Allow RDP and all outbound traffic',
      rules: [
        { port: '3389', protocol: 'tcp', direction: 'in', action: 'accept', description: 'RDP' },
        { port: 'all', protocol: 'all', direction: 'out', action: 'accept', description: 'All outbound' }
      ]
    }],
    [FirewallTemplate.DEVELOPMENT, {
      name: 'Development',
      description: 'Allow common development ports',
      rules: [
        { port: '3000', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Dev Server' },
        { port: '8080', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Alt HTTP' },
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', description: 'SSH' },
        { port: 'all', protocol: 'all', direction: 'out', action: 'accept', description: 'All outbound' }
      ]
    }]
  ])

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.networkFilterService = new NetworkFilterService(prisma)
    this.debug = new Debugger('firewall-simplifier')
  }

  /**
   * Get the current firewall state for a VM
   */
  async getVMFirewallState (vmId: string): Promise<VMFirewallState> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId }
    })

    if (!machine) {
      throw new Error(`Machine ${vmId} not found`)
    }

    const state = this.parseFirewallState(machine.firewallTemplates)
    const effectiveRules = await this.calculateEffectiveRules(state.appliedTemplates, state.customRules)

    return {
      ...state,
      effectiveRules
    }
  }

  /**
   * Apply a firewall template to a VM
   */
  async applyFirewallTemplate (vmId: string, template: FirewallTemplate): Promise<VMFirewallState> {
    this.debug.log(`Applying template ${template} to VM ${vmId}`)

    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: { nwFilters: true }
    })

    if (!machine) {
      throw new Error(`Machine ${vmId} not found`)
    }

    const currentState = this.parseFirewallState(machine.firewallTemplates)

    // Check if template is already applied
    if (currentState.appliedTemplates.includes(template)) {
      this.debug.log(`Template ${template} already applied to VM ${vmId}`)
      return this.getVMFirewallState(vmId)
    }

    // Add template to the list
    currentState.appliedTemplates.push(template)

    // Calculate all required rules
    const effectiveRules = await this.calculateEffectiveRules(
      currentState.appliedTemplates,
      currentState.customRules
    )

    // Sync with NWFilter
    await this.syncFirewallRules(vmId, machine, effectiveRules)

    // Update machine state
    await this.updateFirewallState(vmId, currentState)

    return {
      ...currentState,
      effectiveRules
    }
  }

  /**
   * Remove a firewall template from a VM
   */
  async removeFirewallTemplate (vmId: string, template: FirewallTemplate): Promise<VMFirewallState> {
    this.debug.log(`Removing template ${template} from VM ${vmId}`)

    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: { nwFilters: true }
    })

    if (!machine) {
      throw new Error(`Machine ${vmId} not found`)
    }

    const currentState = this.parseFirewallState(machine.firewallTemplates)

    // Remove template from the list
    currentState.appliedTemplates = currentState.appliedTemplates.filter(t => t !== template)

    // Calculate remaining required rules
    const effectiveRules = await this.calculateEffectiveRules(
      currentState.appliedTemplates,
      currentState.customRules
    )

    // Get current NWFilter rules
    const currentRules = await this.getCurrentNWFilterRules(machine)

    // Identify rules to remove (those not in effective rules)
    const rulesToRemove = this.identifyRulesToRemove(currentRules, effectiveRules)

    // Remove unnecessary rules from NWFilter
    await this.removeNWFilterRules(machine, rulesToRemove)

    // Update machine state
    await this.updateFirewallState(vmId, currentState)

    return {
      ...currentState,
      effectiveRules
    }
  }

  /**
   * Toggle a firewall template (apply if not applied, remove if applied)
   */
  async toggleFirewallTemplate (vmId: string, template: FirewallTemplate): Promise<VMFirewallState> {
    const state = await this.getVMFirewallState(vmId)

    if (state.appliedTemplates.includes(template)) {
      return this.removeFirewallTemplate(vmId, template)
    } else {
      return this.applyFirewallTemplate(vmId, template)
    }
  }

  /**
   * Get simplified firewall rules for a VM
   */
  async getSimplifiedRules (vmId: string): Promise<SimplifiedRule[]> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        nwFilters: {
          include: {
            nwFilter: {
              include: {
                rules: true
              }
            }
          }
        }
      }
    })

    if (!machine) {
      throw new Error(`Machine ${vmId} not found`)
    }

    const simplifiedRules: SimplifiedRule[] = []

    // Convert NWFilter rules to simplified format
    for (const vmFilter of machine.nwFilters) {
      for (const rule of vmFilter.nwFilter.rules) {
        const simplified = this.convertToSimplifiedRule(rule)
        if (simplified) {
          simplifiedRules.push(simplified)
        }
      }
    }

    return this.deduplicateRules(simplifiedRules)
  }

  /**
   * Add a custom firewall rule
   */
  async addCustomRule (vmId: string, rule: SimplifiedRule): Promise<VMFirewallState> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: { nwFilters: true }
    })

    if (!machine) {
      throw new Error(`Machine ${vmId} not found`)
    }

    const currentState = this.parseFirewallState(machine.firewallTemplates)

    // Add custom rule
    rule.sources = ['CUSTOM']
    currentState.customRules.push(rule)

    // Calculate effective rules
    const effectiveRules = await this.calculateEffectiveRules(
      currentState.appliedTemplates,
      currentState.customRules
    )

    // Sync with NWFilter
    await this.syncFirewallRules(vmId, machine, effectiveRules)

    // Update machine state
    await this.updateFirewallState(vmId, currentState)

    return {
      ...currentState,
      effectiveRules
    }
  }

  /**
   * Get available firewall templates
   */
  getAvailableTemplates (): TemplateDefinition[] {
    return Array.from(this.templates.values())
  }

  /**
   * Get template information
   */
  getTemplateInfo (template: FirewallTemplate): TemplateDefinition | undefined {
    return this.templates.get(template)
  }

  // Private helper methods

  private parseFirewallState (data: any): Omit<VMFirewallState, 'effectiveRules'> {
    if (!data) {
      return {
        appliedTemplates: [],
        customRules: [],
        lastSync: null
      }
    }

    try {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data
      return {
        appliedTemplates: parsed.appliedTemplates || [],
        customRules: parsed.customRules || [],
        lastSync: parsed.lastSync ? new Date(parsed.lastSync) : null
      }
    } catch (error) {
      this.debug.log('Error parsing firewall state:', String(error))
      return {
        appliedTemplates: [],
        customRules: [],
        lastSync: null
      }
    }
  }

  private async calculateEffectiveRules (
    templates: string[],
    customRules: SimplifiedRule[]
  ): Promise<SimplifiedRule[]> {
    const rulesMap = new Map<string, SimplifiedRule>()

    // Add rules from templates
    for (const templateName of templates) {
      // templateName is already a string enum value like 'WEB_SERVER'
      const template = templateName as unknown as FirewallTemplate
      const templateDef = this.templates.get(template)

      if (templateDef) {
        for (const rule of templateDef.rules) {
          const key = this.getRuleKey(rule)
          const existing = rulesMap.get(key)

          if (existing) {
            // Add source to existing rule
            if (!existing.sources) existing.sources = []
            if (!existing.sources.includes(templateName)) {
              existing.sources.push(templateName)
            }
          } else {
            // Add new rule with source
            rulesMap.set(key, {
              ...rule,
              sources: [templateName]
            })
          }
        }
      }
    }

    // Add custom rules
    for (const rule of customRules) {
      const key = this.getRuleKey(rule)
      const existing = rulesMap.get(key)

      if (existing) {
        if (!existing.sources) existing.sources = []
        if (!existing.sources.includes('CUSTOM')) {
          existing.sources.push('CUSTOM')
        }
      } else {
        rulesMap.set(key, {
          ...rule,
          sources: ['CUSTOM']
        })
      }
    }

    return Array.from(rulesMap.values())
  }

  private getRuleKey (rule: SimplifiedRule): string {
    return `${rule.port}-${rule.protocol}-${rule.direction}-${rule.action}`
  }

  private async syncFirewallRules (
    vmId: string,
    machine: any,
    effectiveRules: SimplifiedRule[]
  ): Promise<void> {
    // Get or create NWFilter for this VM
    let vmFilter = machine.nwFilters?.[0]?.nwFilter

    if (!vmFilter) {
      // Create a new filter for this VM
      vmFilter = await this.networkFilterService.createFilter(
        `vm-${machine.internalName}-simplified`,
        `Simplified firewall rules for ${machine.name}`,
        'root',
        'vm'
      )

      // Associate filter with VM
      await this.prisma.vMNWFilter.create({
        data: {
          vmId: machine.id,
          nwFilterId: vmFilter.id
        }
      })
    }

    // Convert simplified rules to NWFilter rules
    let priority = 100
    for (const rule of effectiveRules) {
      await this.createNWFilterRule(vmFilter.id, rule, priority)
      priority += 10
    }

    // Flush the filter to apply changes
    await this.networkFilterService.flushNWFilter(vmFilter.id, true)
  }

  private async createNWFilterRule (
    filterId: string,
    rule: SimplifiedRule,
    priority: number
  ): Promise<void> {
    const port = rule.port === 'all' ? undefined : Number(rule.port)

    await this.networkFilterService.createRule(
      filterId,
      rule.action,
      rule.direction,
      priority,
      rule.protocol,
      port,
      {
        comment: rule.description || `Rule from ${rule.sources?.join(', ')}`,
        ipVersion: 'ipv4'
      }
    )
  }

  private async getCurrentNWFilterRules (machine: any): Promise<FWRule[]> {
    const vmFilter = machine.nwFilters?.[0]?.nwFilter
    if (!vmFilter) return []

    const filter = await this.prisma.nWFilter.findUnique({
      where: { id: vmFilter.id },
      include: { rules: true }
    })

    return filter?.rules || []
  }

  private identifyRulesToRemove (
    currentRules: FWRule[],
    effectiveRules: SimplifiedRule[]
  ): FWRule[] {
    const effectiveKeys = new Set(effectiveRules.map(r => this.getRuleKey(r)))

    return currentRules.filter(rule => {
      const simplified = this.convertToSimplifiedRule(rule)
      if (!simplified) return false

      const key = this.getRuleKey(simplified)
      return !effectiveKeys.has(key)
    })
  }

  private async removeNWFilterRules (machine: any, rulesToRemove: FWRule[]): Promise<void> {
    for (const rule of rulesToRemove) {
      await this.networkFilterService.deleteRule(rule.id)
    }

    // Flush the filter to apply changes
    const vmFilter = machine.nwFilters?.[0]?.nwFilter
    if (vmFilter) {
      await this.networkFilterService.flushNWFilter(vmFilter.id, true)
    }
  }

  private convertToSimplifiedRule (rule: FWRule): SimplifiedRule | null {
    // Skip complex rules that can't be simplified
    if (rule.srcIpAddr || rule.dstIpAddr || rule.srcIpMask || rule.dstIpMask) {
      return null
    }

    const port = rule.dstPortStart || rule.srcPortStart

    return {
      id: rule.id,
      port: port ? port.toString() : 'all',
      protocol: rule.protocol,
      direction: rule.direction as 'in' | 'out' | 'inout',
      action: rule.action as 'accept' | 'drop' | 'reject',
      description: rule.comment || undefined
    }
  }

  private deduplicateRules (rules: SimplifiedRule[]): SimplifiedRule[] {
    const seen = new Map<string, SimplifiedRule>()

    for (const rule of rules) {
      const key = this.getRuleKey(rule)
      if (!seen.has(key)) {
        seen.set(key, rule)
      }
    }

    return Array.from(seen.values())
  }

  private async updateFirewallState (vmId: string, state: Omit<VMFirewallState, 'effectiveRules'>): Promise<void> {
    const stateWithSync = {
      appliedTemplates: state.appliedTemplates,
      customRules: state.customRules as any, // Cast to any to satisfy Prisma Json type
      lastSync: new Date().toISOString()
    }

    await this.prisma.machine.update({
      where: { id: vmId },
      data: {
        firewallTemplates: stateWithSync
      }
    })
  }
}
