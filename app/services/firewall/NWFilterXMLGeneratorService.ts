import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import xml2js from 'xml2js'

import { FirewallRule, RuleSetType } from '@prisma/client'

interface FilterConfig {
  name: string;
  rules: FirewallRule[];
}

/**
 * Service responsible for generating libvirt nwfilter XML from firewall rules.
 * Implements the naming convention with 'ibay-' prefix for easy cleanup.
 */
export class NWFilterXMLGeneratorService {
  /**
   * Generates a unique filter name with ibay- prefix
   * Format: ibay-{type}-{hash}
   * Where hash is MD5 of entityId (truncated to 8 chars)
   */
  generateFilterName (entityType: RuleSetType, entityId: string): string {
    const hash = crypto
      .createHash('md5')
      .update(entityId)
      .digest('hex')
      .substring(0, 8)

    const typeStr = entityType.toLowerCase()
    return `ibay-${typeStr}-${hash}`
  }

  /**
   * Generates complete nwfilter XML from a set of firewall rules
   */
  async generateFilterXML (config: FilterConfig): Promise<string> {
    // Sort rules by priority (lower number = higher priority)
    const sortedRules = [...config.rules].sort((a, b) => a.priority - b.priority)

    const filterObj = {
      filter: {
        $: {
          name: config.name,
          chain: 'root',
          priority: '0'
        },
        uuid: [uuidv4()],
        rule: sortedRules.map(rule => this.generateRuleElement(rule))
      }
    }

    const builder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: true, indent: '  ' }
    })

    return builder.buildObject(filterObj)
  }

  /**
   * Generates XML element for a single firewall rule
   */
  private generateRuleElement (rule: FirewallRule): any {
    const ruleElement: any = {
      $: {
        action: rule.action.toLowerCase(),
        direction: this.mapDirection(rule.direction),
        priority: rule.priority.toString()
      }
    }

    // Add connection state if specified
    if (rule.connectionState && typeof rule.connectionState === 'object') {
      const states = Object.keys(rule.connectionState)
        .filter(k => (rule.connectionState as any)[k])
        .map(s => s.toUpperCase())
        .join(',')

      if (states) {
        ruleElement.$.state = states
      }
    }

    // Handle protocol-specific attributes
    if (rule.protocol && rule.protocol !== 'all') {
      const protocolElement: any = {
        $: {}
      }

      // Add port specifications
      if (rule.srcPortStart !== null && rule.srcPortStart !== undefined) {
        protocolElement.$.srcportstart = rule.srcPortStart.toString()
      }
      if (rule.srcPortEnd !== null && rule.srcPortEnd !== undefined) {
        protocolElement.$.srcportend = rule.srcPortEnd.toString()
      }
      if (rule.dstPortStart !== null && rule.dstPortStart !== undefined) {
        protocolElement.$.dstportstart = rule.dstPortStart.toString()
      }
      if (rule.dstPortEnd !== null && rule.dstPortEnd !== undefined) {
        protocolElement.$.dstportend = rule.dstPortEnd.toString()
      }

      // Add IP address specifications
      if (rule.srcIpAddr) {
        protocolElement.$.srcipaddr = rule.srcIpAddr
      }
      if (rule.srcIpMask) {
        protocolElement.$.srcipmask = rule.srcIpMask
      }
      if (rule.dstIpAddr) {
        protocolElement.$.dstipaddr = rule.dstIpAddr
      }
      if (rule.dstIpMask) {
        protocolElement.$.dstipmask = rule.dstIpMask
      }

      ruleElement[rule.protocol] = [protocolElement]
    }

    return ruleElement
  }

  /**
   * Maps Prisma RuleDirection enum to libvirt nwfilter direction
   */
  private mapDirection (direction: string): string {
    switch (direction) {
    case 'IN':
      return 'in'
    case 'OUT':
      return 'out'
    case 'INOUT':
      return 'inout'
    default:
      return 'inout'
    }
  }

  /**
   * Generates XML for a filter that references another filter
   * Used for hierarchical filter structures
   */
  async addFilterReference (parentFilterName: string, childFilterName: string): Promise<string> {
    const filterObj = {
      filter: {
        $: {
          name: parentFilterName,
          chain: 'root'
        },
        uuid: [uuidv4()],
        filterref: [
          {
            $: {
              filter: childFilterName
            }
          }
        ]
      }
    }

    const builder = new xml2js.Builder({
      xmldec: { version: '1.0', encoding: 'UTF-8' },
      renderOpts: { pretty: true, indent: '  ' }
    })

    return builder.buildObject(filterObj)
  }
}
