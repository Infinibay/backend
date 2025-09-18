import { PrismaClient, Machine, NWFilter, FWRule } from '@prisma/client'
import { NetworkFilterService } from './networkFilterService'
import { PortValidationService, PortRange } from './PortValidationService'
import { AppError, ErrorCode } from '@utils/errors/ErrorHandler'
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
  template: string
  name: string
  description: string
  rules: SimplifiedRule[]
}

export class FirewallSimplifierService {
  private prisma: PrismaClient
  private networkFilterService: NetworkFilterService
  private portValidationService: PortValidationService
  private debug: Debugger

  // Template definitions
  private readonly templates: Map<FirewallTemplate, TemplateDefinition> = new Map([
    [FirewallTemplate.WEB_SERVER, {
      template: 'WEB_SERVER',
      name: 'Web Server',
      description: 'Allow HTTP, HTTPS and SSH access',
      rules: [
        { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTP' },
        { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'HTTPS' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', description: 'SSH' }
      ]
    }],
    [FirewallTemplate.DATABASE, {
      template: 'DATABASE',
      name: 'Database Server',
      description: 'Allow database connections and SSH',
      rules: [
        { port: '3306', protocol: 'tcp', direction: 'in', action: 'accept', description: 'MySQL' },
        { port: '5432', protocol: 'tcp', direction: 'in', action: 'accept', description: 'PostgreSQL' },
        { port: '22', protocol: 'tcp', direction: 'in', action: 'accept', description: 'SSH' }
      ]
    }],
    [FirewallTemplate.DESKTOP, {
      template: 'DESKTOP',
      name: 'Desktop',
      description: 'Allow RDP and all outbound traffic',
      rules: [
        { port: '3389', protocol: 'tcp', direction: 'in', action: 'accept', description: 'RDP' },
        { port: 'all', protocol: 'all', direction: 'out', action: 'accept', description: 'All outbound' }
      ]
    }],
    [FirewallTemplate.DEVELOPMENT, {
      template: 'DEVELOPMENT',
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
    this.portValidationService = new PortValidationService()
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

    // Validate template rules before applying
    const templateDef = this.templates.get(template)
    if (templateDef) {
      for (const rule of templateDef.rules) {
        const validation = this.portValidationService.validatePortString(rule.port)
        if (!validation.isValid) {
          throw new AppError(`Invalid port configuration in template ${template}: ${validation.errors.join(', ')}`, ErrorCode.VALIDATION_ERROR, 400)
        }
      }
    }

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
   * Groups FWRule rows by (protocol, direction, action, comment) and merges their port ranges
   */
  async getSimplifiedRules (vmId: string): Promise<SimplifiedRule[]> {
    this.debug.log(`Getting simplified rules for VM ${vmId}`)

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

    // Convert NWFilter rules to SimplifiedRule format
    const allRules: SimplifiedRule[] = []
    let totalRulesCount = 0

    for (const vmFilter of machine.nwFilters) {
      for (const rule of vmFilter.nwFilter.rules) {
        totalRulesCount++
        const simplified = this.convertToSimplifiedRule(rule)
        if (simplified) {
          allRules.push(simplified)
        }
      }
    }

    // Group rules using the same pattern as optimizeCustomRules for consistency
    const groups = this.groupRulesByKey(allRules)
    const aggregatedRules: SimplifiedRule[] = []

    // Optimize each group
    groups.forEach((groupRules, groupKey) => {
      // Extract port ranges from all rules in this group
      const portRanges = this.extractPortRanges(groupRules)

      // Merge adjacent and overlapping ranges
      const mergedRanges = this.mergeAdjacentRanges(portRanges)

      // Convert back to SimplifiedRule format
      mergedRanges.forEach(range => {
        const portString = range.start === range.end
          ? range.start.toString()
          : range.start === 1 && range.end === 65535
            ? 'all'
            : `${range.start}-${range.end}`

        aggregatedRules.push({
          ...groupRules[0], // Use properties from first rule in group
          port: portString,
          description: range.description || groupRules[0].description
        })
      })
    })

    this.debug.log(`Simplified ${totalRulesCount} NWFilter rules into ${aggregatedRules.length} simplified rules`)

    return aggregatedRules
  }

  /**
   * Add a custom firewall rule
   */
  async addCustomRule (vmId: string, rule: SimplifiedRule): Promise<VMFirewallState> {
    // Validate the port string before processing
    const validation = this.portValidationService.validatePortString(rule.port)
    if (!validation.isValid) {
      throw new AppError(`Invalid port configuration: ${validation.errors.join(', ')}`, ErrorCode.VALIDATION_ERROR, 400)
    }

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
    this.debug.log(`Added custom rule: ${rule.port}/${rule.protocol}/${rule.direction}/${rule.action} to VM ${vmId}`)

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

  /**
   * Add multiple custom firewall rules at once with optimization
   */
  async addMultipleCustomRules(vmId: string, rules: SimplifiedRule[]): Promise<VMFirewallState> {
    this.debug.log(`Adding ${rules.length} custom rules to VM ${vmId}`)

    // Validate all rules before processing
    for (const rule of rules) {
      const validation = this.portValidationService.validatePortString(rule.port)
      if (!validation.isValid) {
        throw new AppError(`Invalid port configuration in rule: ${validation.errors.join(', ')}`, ErrorCode.VALIDATION_ERROR, 400)
      }
    }

    const machine = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: { nwFilters: true }
    })

    if (!machine) {
      throw new Error(`Machine ${vmId} not found`)
    }

    const currentState = this.parseFirewallState(machine.firewallTemplates)

    // Add all custom rules with CUSTOM source
    const newRules = rules.map(rule => ({
      ...rule,
      sources: ['CUSTOM']
    }))

    currentState.customRules.push(...newRules)

    // Optimize custom rules to merge adjacent ranges and eliminate duplicates
    const optimizedCustomRules = this.optimizeCustomRules(currentState.customRules)
    currentState.customRules = optimizedCustomRules

    this.debug.log(`Optimized ${rules.length} new rules into ${optimizedCustomRules.length - (currentState.customRules.length - rules.length)} effective rules`)

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
   * Optimize custom rules by merging adjacent ranges and eliminating duplicates
   */
  private optimizeCustomRules(rules: SimplifiedRule[]): SimplifiedRule[] {
    this.debug.log(`Optimizing ${rules.length} custom rules`)

    // Group rules by protocol, direction, and action
    const groups = new Map<string, SimplifiedRule[]>()

    rules.forEach(rule => {
      const key = `${rule.protocol}-${rule.direction}-${rule.action}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(rule)
    })

    const optimizedRules: SimplifiedRule[] = []
    let totalOptimizations = 0

    // Optimize each group
    groups.forEach((groupRules, groupKey) => {
      const originalCount = groupRules.length

      // Extract port ranges from all rules in this group
      const portRanges = this.extractPortRanges(groupRules)

      // Merge adjacent and overlapping ranges
      const mergedRanges = this.mergeAdjacentRanges(portRanges)

      // Convert back to SimplifiedRule format
      mergedRanges.forEach(range => {
        const portString = range.start === range.end
          ? range.start.toString()
          : range.start === 1 && range.end === 65535
            ? 'all'
            : `${range.start}-${range.end}`

        optimizedRules.push({
          ...groupRules[0], // Use properties from first rule in group
          port: portString,
          description: range.description || `Optimized rule for ports ${portString}`,
          sources: ['CUSTOM']
        })
      })

      const optimizedCount = mergedRanges.length
      const saved = originalCount - optimizedCount
      if (saved > 0) {
        totalOptimizations += saved
        this.debug.log(`Optimized group ${groupKey}: ${originalCount} rules → ${optimizedCount} rules (saved ${saved})`)
      }
    })

    this.debug.log(`Total optimization: ${rules.length} rules → ${optimizedRules.length} rules (saved ${totalOptimizations})`)

    return optimizedRules
  }

  /**
   * Extract port ranges from simplified rules
   */
  private extractPortRanges(rules: SimplifiedRule[]): PortRange[] {
    const ranges: PortRange[] = []

    rules.forEach(rule => {
      if (rule.port === 'all') {
        ranges.push({ start: 1, end: 65535, description: rule.description })
      } else {
        try {
          const parsedRanges = this.portValidationService.parsePortString(rule.port)
          ranges.push(...parsedRanges.map(range => ({
            ...range,
            description: rule.description
          })))
        } catch (error) {
          this.debug.log(`Warning: Could not parse port string '${rule.port}': ${error}`)
          // Skip invalid port strings rather than failing
        }
      }
    })

    return ranges
  }

  /**
   * Merge adjacent and overlapping port ranges
   */
  private mergeAdjacentRanges(ranges: PortRange[]): PortRange[] {
    if (ranges.length === 0) return []

    // Sort ranges by start port
    const sortedRanges = [...ranges].sort((a, b) => a.start - b.start)

    const merged: PortRange[] = [sortedRanges[0]]

    for (let i = 1; i < sortedRanges.length; i++) {
      const current = sortedRanges[i]
      const last = merged[merged.length - 1]

      // Check if current range overlaps or is adjacent to the last merged range
      if (current.start <= last.end + 1) {
        // Merge ranges
        last.end = Math.max(last.end, current.end)

        // Combine descriptions if different, de-duplicating values
        if (current.description && current.description !== last.description) {
          const existingDescriptions = last.description ? last.description.split(', ') : []
          const newDescriptions = current.description.split(', ')
          const uniqueDescriptions = Array.from(new Set([...existingDescriptions, ...newDescriptions]))
          last.description = uniqueDescriptions.join(', ')
        }
      } else {
        // No overlap, add as new range
        merged.push(current)
      }
    }

    this.debug.log(`Merged ${ranges.length} ranges into ${merged.length} ranges`)

    return merged
  }

  // Private helper methods

  private groupRulesByKey(rules: SimplifiedRule[]): Map<string, SimplifiedRule[]> {
    const groups = new Map<string, SimplifiedRule[]>()

    rules.forEach(rule => {
      const key = `${rule.protocol}-${rule.direction}-${rule.action}-${rule.description || ''}`
      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(rule)
    })

    return groups
  }

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

    const effectiveRules = Array.from(rulesMap.values())
    this.debug.log(`Calculated ${effectiveRules.length} effective rules from ${templates.length} templates and ${customRules.length} custom rules`)
    return effectiveRules
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
    // Handle special case 'all' ports
    if (rule.port === 'all') {
      await this.networkFilterService.createRule(
        filterId,
        rule.action,
        rule.direction,
        priority,
        rule.protocol,
        undefined,
        {
          comment: rule.description || `Rule from ${rule.sources?.join(', ')}`
        }
      )
      return
    }

    // Parse port ranges and create rules for each range
    const portRanges = this.portValidationService.parsePortString(rule.port)

    for (const range of portRanges) {
      await this.networkFilterService.createRule(
        filterId,
        rule.action,
        rule.direction,
        priority,
        rule.protocol,
        undefined, // Don't use the legacy port parameter
        {
          dstPortStart: range.start,
          dstPortEnd: range.end,
          comment: rule.description || `Rule from ${rule.sources?.join(', ')}`
        }
      )
      priority += 1 // Increment priority for each sub-rule to avoid conflicts
    }
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
    // Create a set of normalized per-range keys from effective rules
    const effectiveRangeKeys = new Set<string>()

    for (const rule of effectiveRules) {
      const ranges = this.portValidationService.parsePortString(rule.port)
      for (const range of ranges) {
        const rangeKey = this.getRangeRuleKey(rule, range)
        effectiveRangeKeys.add(rangeKey)
      }
    }

    return currentRules.filter(rule => {
      const simplified = this.convertToSimplifiedRule(rule)
      if (!simplified) return false

      // For current rules, build the same per-range key from its single port/range
      const ranges = this.portValidationService.parsePortString(simplified.port)
      for (const range of ranges) {
        const rangeKey = this.getRangeRuleKey(simplified, range)
        if (effectiveRangeKeys.has(rangeKey)) {
          return false // Rule should be kept
        }
      }

      return true // Rule should be removed
    })
  }

  /**
   * Helper to create consistent range-based rule keys
   */
  private getRangeRuleKey (rule: SimplifiedRule, range: PortRange): string {
    return `${range.start}-${range.end}-${rule.protocol}-${rule.direction}-${rule.action}`
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

    // Handle port ranges properly
    let portString = 'all'

    if (rule.dstPortStart || rule.srcPortStart) {
      const portStart = rule.dstPortStart || rule.srcPortStart
      const portEnd = rule.dstPortEnd || rule.srcPortEnd

      if (portStart && portEnd && portStart !== portEnd) {
        // Port range
        portString = `${portStart}-${portEnd}`
      } else if (portStart) {
        // Single port
        portString = portStart.toString()
      }
    }

    return {
      id: rule.id,
      port: portString,
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
