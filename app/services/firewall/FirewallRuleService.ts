import { FirewallRule, FirewallRuleSet, Prisma, PrismaClient, RuleSetType, RuleAction, RuleDirection } from '@prisma/client'

import { Debugger } from '@utils/debug'

// Type for FirewallRuleSet with rules included
export type FirewallRuleSetWithRules = Prisma.FirewallRuleSetGetPayload<{
  include: { rules: true }
}>

const debug = new Debugger('infinibay:service:firewall:rule')

export interface CreateRuleData {
  action: RuleAction;
  connectionState?: any;
  description?: string;
  direction: RuleDirection;
  dstIpAddr?: string;
  dstIpMask?: string;
  dstPortEnd?: number;
  dstPortStart?: number;
  name: string;
  overridesDept?: boolean;
  priority: number;
  protocol?: string;
  srcIpAddr?: string;
  srcIpMask?: string;
  srcPortEnd?: number;
  srcPortStart?: number;
}

export interface UpdateRuleData {
  action?: RuleAction;
  connectionState?: any;
  description?: string;
  direction?: RuleDirection;
  dstIpAddr?: string;
  dstIpMask?: string;
  dstPortEnd?: number;
  dstPortStart?: number;
  name?: string;
  overridesDept?: boolean;
  priority?: number;
  protocol?: string;
  srcIpAddr?: string;
  srcIpMask?: string;
  srcPortEnd?: number;
  srcPortStart?: number;
}

/**
 * Service responsible for CRUD operations on firewall rules and rule sets.
 * This is the data access layer for firewall configuration.
 */
export class FirewallRuleService {
  constructor (private prisma: PrismaClient) {}

  /**
   * Creates a new firewall rule set for a department or VM
   */
  async createRuleSet (
    entityType: RuleSetType,
    entityId: string,
    name: string,
    internalName: string,
    priority: number = 500
  ): Promise<FirewallRuleSet> {
    const ruleSet = await this.prisma.firewallRuleSet.create({
      data: {
        name,
        internalName,
        entityType,
        entityId,
        priority,
        isActive: true
      },
      include: {
        rules: true
      }
    })

    debug.log('info', `Created rule set: ${ruleSet.id} for ${entityType} ${entityId}`)
    return ruleSet
  }

  /**
   * Creates a new firewall rule within a rule set
   */
  async createRule (ruleSetId: string, ruleData: CreateRuleData): Promise<FirewallRule> {
    const rule = await this.prisma.firewallRule.create({
      data: {
        ruleSetId,
        ...ruleData
      }
    })

    debug.log('info', `Created rule: ${rule.id} in rule set ${ruleSetId}`)
    return rule
  }

  /**
   * Updates an existing firewall rule
   */
  async updateRule (ruleId: string, ruleData: UpdateRuleData): Promise<FirewallRule> {
    const rule = await this.prisma.firewallRule.update({
      where: { id: ruleId },
      data: ruleData
    })

    debug.log('info', `Updated rule: ${ruleId}`)
    return rule
  }

  /**
   * Deletes a firewall rule
   */
  async deleteRule (ruleId: string): Promise<void> {
    await this.prisma.firewallRule.delete({
      where: { id: ruleId }
    })

    debug.log('info', `Deleted rule: ${ruleId}`)
  }

  /**
   * Gets all rules for a specific entity (department or VM)
   */
  async getRulesByEntity (entityType: RuleSetType, entityId: string): Promise<FirewallRule[]> {
    const ruleSets = await this.prisma.firewallRuleSet.findMany({
      where: {
        entityType,
        entityId
      },
      include: {
        rules: true
      }
    })

    return ruleSets.flatMap(rs => rs.rules)
  }

  /**
   * Gets the rule set for a specific entity
   */
  async getRuleSetByEntity (
    entityType: RuleSetType,
    entityId: string
  ): Promise<FirewallRuleSet | null> {
    const ruleSets = await this.prisma.firewallRuleSet.findMany({
      where: {
        entityType,
        entityId
      },
      include: {
        rules: true
      }
    })

    return ruleSets.length > 0 ? ruleSets[0] : null
  }

  /**
   * Gets a rule set by ID with all its rules
   */
  async getRuleSetById (ruleSetId: string): Promise<FirewallRuleSet | null> {
    return this.prisma.firewallRuleSet.findUnique({
      where: { id: ruleSetId },
      include: {
        rules: true
      }
    })
  }

  /**
   * Updates rule set sync status after applying to libvirt
   */
  async updateRuleSetSyncStatus (
    ruleSetId: string,
    libvirtUuid: string,
    xmlContent: string
  ): Promise<void> {
    await this.prisma.firewallRuleSet.update({
      where: { id: ruleSetId },
      data: {
        libvirtUuid,
        xmlContent,
        lastSyncedAt: new Date()
      }
    })

    debug.log('info', `Updated sync status for rule set: ${ruleSetId}`)
  }

  /**
   * Deletes a rule set and all its rules
   */
  async deleteRuleSet (ruleSetId: string): Promise<void> {
    await this.prisma.firewallRuleSet.delete({
      where: { id: ruleSetId }
    })

    debug.log('info', `Deleted rule set: ${ruleSetId}`)
  }

  /**
   * Gets all active rule sets with their rules
   */
  async getAllActiveRuleSets (): Promise<FirewallRuleSetWithRules[]> {
    return this.prisma.firewallRuleSet.findMany({
      where: {
        isActive: true
      },
      include: {
        rules: true
      }
    })
  }
}
