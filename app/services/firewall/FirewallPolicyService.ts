import { FirewallPolicy, PrismaClient, RuleAction, RuleDirection, RuleSetType } from '@prisma/client'

import { Debugger } from '@utils/debug'

import { CreateRuleData, FirewallRuleService } from './FirewallRuleService'

const debug = new Debugger('infinibay:service:firewall:policy')

/**
 * Extended CreateRuleData that includes the isSystemGenerated flag.
 */
export interface SystemRuleData extends CreateRuleData {
  isSystemGenerated: boolean
}

/**
 * Service responsible for translating firewall policies into concrete rules.
 *
 * This service converts high-level policy presets (like "BLOCK_ALL with allow_internet")
 * into specific firewall rules that can be applied via nftables.
 *
 * Policy Types:
 * - BLOCK_ALL: Default deny, whitelist specific traffic
 *   - allow_internet: HTTP(80), HTTPS(443), DNS(53) outbound
 *   - allow_outbound: All outbound traffic allowed
 *   - block_all: Complete isolation (no auto-generated rules)
 *
 * - ALLOW_ALL: Default allow, blacklist specific traffic
 *   - block_ssh: Block SSH(22) and SFTP(21)
 *   - block_smb: Block SMB(445)
 *   - block_databases: Block common database ports
 *   - none: No restrictions (no auto-generated rules)
 */
export class FirewallPolicyService {
  constructor (
    private prisma: PrismaClient,
    private ruleService: FirewallRuleService
  ) {}

  /**
   * Generates default firewall rules based on policy and configuration.
   *
   * @param policy - The firewall policy (ALLOW_ALL or BLOCK_ALL)
   * @param defaultConfig - The preset configuration string
   * @returns Array of rules to be created
   */
  generateDefaultRules (policy: FirewallPolicy, defaultConfig: string): SystemRuleData[] {
    const rules: SystemRuleData[] = []

    // Always add established/related connection rule (priority 50)
    // This allows response traffic for connections initiated from the VM
    rules.push({
      name: 'Allow Established Connections (System)',
      description: 'Allow traffic for established and related connections',
      action: RuleAction.ACCEPT,
      direction: RuleDirection.INOUT,
      protocol: 'all',
      priority: 50,
      connectionState: { states: ['ESTABLISHED', 'RELATED'] },
      isSystemGenerated: true
    })

    if (policy === FirewallPolicy.BLOCK_ALL) {
      rules.push(...this.generateBlockAllRules(defaultConfig))
    } else if (policy === FirewallPolicy.ALLOW_ALL) {
      rules.push(...this.generateAllowAllRules(defaultConfig))
    }

    return rules
  }

  /**
   * Generates rules for BLOCK_ALL policy based on the preset.
   */
  private generateBlockAllRules (defaultConfig: string): SystemRuleData[] {
    const rules: SystemRuleData[] = []

    switch (defaultConfig) {
      case 'allow_internet':
        // Allow DNS (UDP 53) - Required for name resolution
        rules.push({
          name: 'Allow DNS (System)',
          description: 'Allow outbound DNS queries for name resolution',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'udp',
          dstPortStart: 53,
          dstPortEnd: 53,
          priority: 100,
          isSystemGenerated: true
        })

        // Allow DNS over TCP (TCP 53) - For large DNS responses
        rules.push({
          name: 'Allow DNS TCP (System)',
          description: 'Allow outbound DNS over TCP for large responses',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'tcp',
          dstPortStart: 53,
          dstPortEnd: 53,
          priority: 100,
          isSystemGenerated: true
        })

        // Allow HTTP (TCP 80) - Required for package managers, updates
        rules.push({
          name: 'Allow HTTP (System)',
          description: 'Allow outbound HTTP traffic',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          priority: 100,
          isSystemGenerated: true
        })

        // Allow HTTPS (TCP 443) - Required for secure web traffic
        rules.push({
          name: 'Allow HTTPS (System)',
          description: 'Allow outbound HTTPS traffic',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'tcp',
          dstPortStart: 443,
          dstPortEnd: 443,
          priority: 100,
          isSystemGenerated: true
        })

        // Allow NTP (UDP 123) - Required for time synchronization
        rules.push({
          name: 'Allow NTP (System)',
          description: 'Allow outbound NTP for time synchronization',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'udp',
          dstPortStart: 123,
          dstPortEnd: 123,
          priority: 100,
          isSystemGenerated: true
        })
        break

      case 'allow_outbound':
        // Allow all outbound traffic
        rules.push({
          name: 'Allow All Outbound (System)',
          description: 'Allow all outbound connections',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'all',
          priority: 100,
          isSystemGenerated: true
        })
        break

      case 'block_all':
        // No auto-generated rules - complete isolation
        // User must manually configure any allowed traffic
        debug.log('info', 'BLOCK_ALL with block_all preset: No auto-generated rules (complete isolation)')
        break

      default:
        debug.log('warn', `Unknown BLOCK_ALL config: ${defaultConfig}, defaulting to allow_outbound`)
        rules.push({
          name: 'Allow All Outbound (System)',
          description: 'Allow all outbound connections',
          action: RuleAction.ACCEPT,
          direction: RuleDirection.OUT,
          protocol: 'all',
          priority: 100,
          isSystemGenerated: true
        })
    }

    return rules
  }

  /**
   * Generates rules for ALLOW_ALL policy based on the preset.
   */
  private generateAllowAllRules (defaultConfig: string): SystemRuleData[] {
    const rules: SystemRuleData[] = []

    switch (defaultConfig) {
      case 'block_ssh':
        // Block SSH (TCP 22)
        rules.push({
          name: 'Block SSH (System)',
          description: 'Block inbound SSH connections',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 22,
          dstPortEnd: 22,
          priority: 100,
          isSystemGenerated: true
        })

        // Block SFTP (usually runs over SSH, but also block port 21 for classic FTP)
        rules.push({
          name: 'Block FTP (System)',
          description: 'Block inbound FTP connections',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 21,
          dstPortEnd: 21,
          priority: 100,
          isSystemGenerated: true
        })
        break

      case 'block_smb':
        // Block SMB (TCP 445)
        rules.push({
          name: 'Block SMB (System)',
          description: 'Block inbound SMB file sharing',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 445,
          dstPortEnd: 445,
          priority: 100,
          isSystemGenerated: true
        })

        // Block NetBIOS (TCP/UDP 137-139)
        rules.push({
          name: 'Block NetBIOS TCP (System)',
          description: 'Block inbound NetBIOS traffic',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 137,
          dstPortEnd: 139,
          priority: 100,
          isSystemGenerated: true
        })

        rules.push({
          name: 'Block NetBIOS UDP (System)',
          description: 'Block inbound NetBIOS traffic',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'udp',
          dstPortStart: 137,
          dstPortEnd: 139,
          priority: 100,
          isSystemGenerated: true
        })
        break

      case 'block_databases':
        // Block MySQL (TCP 3306)
        rules.push({
          name: 'Block MySQL (System)',
          description: 'Block inbound MySQL connections',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 3306,
          dstPortEnd: 3306,
          priority: 100,
          isSystemGenerated: true
        })

        // Block PostgreSQL (TCP 5432)
        rules.push({
          name: 'Block PostgreSQL (System)',
          description: 'Block inbound PostgreSQL connections',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 5432,
          dstPortEnd: 5432,
          priority: 100,
          isSystemGenerated: true
        })

        // Block MongoDB (TCP 27017)
        rules.push({
          name: 'Block MongoDB (System)',
          description: 'Block inbound MongoDB connections',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 27017,
          dstPortEnd: 27017,
          priority: 100,
          isSystemGenerated: true
        })

        // Block Redis (TCP 6379)
        rules.push({
          name: 'Block Redis (System)',
          description: 'Block inbound Redis connections',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 6379,
          dstPortEnd: 6379,
          priority: 100,
          isSystemGenerated: true
        })

        // Block Elasticsearch (TCP 9200, 9300)
        rules.push({
          name: 'Block Elasticsearch (System)',
          description: 'Block inbound Elasticsearch connections',
          action: RuleAction.DROP,
          direction: RuleDirection.IN,
          protocol: 'tcp',
          dstPortStart: 9200,
          dstPortEnd: 9300,
          priority: 100,
          isSystemGenerated: true
        })
        break

      case 'none':
        // No restrictions - full open access
        debug.log('info', 'ALLOW_ALL with none preset: No auto-generated blocking rules')
        break

      default:
        debug.log('warn', `Unknown ALLOW_ALL config: ${defaultConfig}, defaulting to none`)
    }

    return rules
  }

  /**
   * Applies a firewall policy to a rule set.
   * This deletes existing system-generated rules and creates new ones based on the policy.
   *
   * @param ruleSetId - The rule set ID to apply the policy to
   * @param policy - The firewall policy
   * @param defaultConfig - The preset configuration string
   */
  async applyPolicyToRuleSet (
    ruleSetId: string,
    policy: FirewallPolicy,
    defaultConfig: string
  ): Promise<void> {
    debug.log('info', `Applying policy ${policy}/${defaultConfig} to rule set ${ruleSetId}`)

    // 1. Delete existing system-generated rules
    const deletedCount = await this.ruleService.deleteSystemGeneratedRules(ruleSetId)
    debug.log('info', `Deleted ${deletedCount} existing system-generated rules`)

    // 2. Generate new rules based on policy
    const newRules = this.generateDefaultRules(policy, defaultConfig)
    debug.log('info', `Generated ${newRules.length} new rules for policy ${policy}/${defaultConfig}`)

    // 3. Create the new rules
    for (const ruleData of newRules) {
      await this.ruleService.createRule(ruleSetId, ruleData)
    }

    debug.log('info', `Successfully applied ${newRules.length} rules to rule set ${ruleSetId}`)
  }

  /**
   * Ensures a department has a firewall rule set and applies the policy.
   * Creates a new rule set if one doesn't exist.
   *
   * @param departmentId - The department ID
   * @param policy - The firewall policy
   * @param defaultConfig - The preset configuration string
   * @returns The rule set ID
   */
  async ensureAndApplyDepartmentPolicy (
    departmentId: string,
    policy: FirewallPolicy,
    defaultConfig: string
  ): Promise<string> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: { firewallRuleSet: true }
    })

    if (!department) {
      throw new Error(`Department ${departmentId} not found`)
    }

    let ruleSetId = department.firewallRuleSetId

    // Create rule set if it doesn't exist
    if (!ruleSetId) {
      const ruleSet = await this.ruleService.createRuleSet(
        RuleSetType.DEPARTMENT,
        departmentId,
        `${department.name} Firewall`,
        `ibay-dept-${departmentId.substring(0, 8)}`
      )
      ruleSetId = ruleSet.id

      // Link rule set to department
      await this.prisma.department.update({
        where: { id: departmentId },
        data: { firewallRuleSetId: ruleSetId }
      })

      debug.log('info', `Created new rule set ${ruleSetId} for department ${departmentId}`)
    }

    // Apply the policy
    await this.applyPolicyToRuleSet(ruleSetId, policy, defaultConfig)

    return ruleSetId
  }

  /**
   * Gets a human-readable description of what a policy preset does.
   *
   * @param policy - The firewall policy
   * @param defaultConfig - The preset configuration string
   * @returns Description string
   */
  getPolicyPresetDescription (policy: FirewallPolicy, defaultConfig: string): string {
    if (policy === FirewallPolicy.BLOCK_ALL) {
      switch (defaultConfig) {
        case 'allow_internet':
          return 'Blocks all traffic by default, but allows outbound HTTP, HTTPS, DNS, and NTP. Ideal for VMs that need internet access for updates and web browsing.'
        case 'allow_outbound':
          return 'Blocks all inbound traffic, but allows all outbound connections. VMs can reach external services but cannot receive unsolicited connections.'
        case 'block_all':
          return 'Complete network isolation. No traffic is allowed unless explicitly configured. Warning: OS installation and updates will not work without manual rules.'
        default:
          return 'Unknown configuration'
      }
    } else {
      switch (defaultConfig) {
        case 'block_ssh':
          return 'Allows all traffic except SSH (22) and FTP (21). Prevents remote shell access while allowing other services.'
        case 'block_smb':
          return 'Allows all traffic except SMB file sharing (445) and NetBIOS (137-139). Prevents Windows file sharing exploits.'
        case 'block_databases':
          return 'Allows all traffic except common database ports (MySQL, PostgreSQL, MongoDB, Redis, Elasticsearch). Protects database services from external access.'
        case 'none':
          return 'Allows all traffic without restrictions. Use with caution - VMs are fully exposed to the network.'
        default:
          return 'Unknown configuration'
      }
    }
  }
}
