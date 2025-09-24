import { PrismaClient, NWFilter, Prisma, FWRule } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'
import { Connection, NwFilter } from 'libvirt-node'
import { Builder, Parser } from 'xml2js'
import { randomBytes } from 'crypto'

export class NetworkFilterService {
  private connection: Connection | null = null
  private xmlBuilder: Builder
  private xmlParser: Parser

  constructor (private prisma: PrismaClient) {
    this.xmlBuilder = new Builder()
    this.xmlParser = new Parser()
  }

  private generateIbayName (): string {
    return `ibay-${randomBytes(8).toString('hex')}`
  }

  private cleanUndefined (obj: any): any {
    return Object.fromEntries(
      Object.entries(obj).filter(([_, v]) => v != null)
    )
  }

  async connect (): Promise<Connection> {
    if (!this.connection) {
      this.connection = await Connection.open('qemu:///system')
      if (!this.connection) {
        throw new Error('Failed to connect to hypervisor')
      }
    }
    return this.connection
  }

  async close (): Promise<void> {
    if (this.connection) {
      await this.connection.close()
      this.connection = null
    }
  }

  async createFilter (
    name: string,
    description: string,
    chain: string | null,
    type: 'generic' | 'department' | 'vm' = 'generic'
  ): Promise<NWFilter> {
    // Check if a filter with the same name already exists
    const existingFilter = await this.prisma.nWFilter.findUnique({
      where: { name }
    })

    if (existingFilter) {
      // Return the existing filter instead of creating a duplicate
      return existingFilter
    }

    const nwFilter = await this.prisma.nWFilter.create({
      data: {
        name,
        internalName: this.generateIbayName(),
        uuid: uuidv4(),
        description,
        chain,
        type
      }
    })
    return nwFilter
  }

  async updateFilter (
    id: string,
    data: {
      name?: string;
      description?: string;
      chain?: string;
      type?: 'generic' | 'department' | 'vm';
    }
  ): Promise<NWFilter> {
    return await this.prisma.nWFilter.update({
      where: { id },
      data
    })
  }

  async deleteFilter (id: string): Promise<NWFilter> {
    return await this.prisma.nWFilter.delete({
      where: { id }
    })
  }

  async createRule (
    filterId: string,
    action: string,
    direction: string,
    priority: number,
    protocol: string = 'all',
    port?: number,
    options: {
      srcPortStart?: number;
      srcPortEnd?: number;
      dstPortStart?: number;
      dstPortEnd?: number;
      comment?: string;
      ipVersion?: string;
      srcIpAddr?: string;
      dstIpAddr?: string;
      state?: any;
    } = {}
  ): Promise<FWRule> {
    // Check if an identical rule already exists
    const existingRule = await this.prisma.fWRule.findFirst({
      where: {
        nwFilterId: filterId,
        action,
        direction,
        protocol,
        dstPortStart: port !== undefined ? port : options.dstPortStart,
        dstPortEnd: port !== undefined ? port : options.dstPortEnd,
        srcPortStart: options.srcPortStart,
        srcPortEnd: options.srcPortEnd,
        comment: options.comment,
        ipVersion: options.ipVersion,
        srcIpAddr: options.srcIpAddr,
        dstIpAddr: options.dstIpAddr
        // Note: We don't check 'state' because it's a JSON object and more complex to compare
      }
    })

    // If an identical rule exists, return it
    if (existingRule) {
      return existingRule
    }

    // Otherwise create a new rule
    return await this.prisma.fWRule.create({
      data: {
        nwFilterId: filterId,
        action,
        direction,
        priority,
        protocol,
        dstPortStart: port !== undefined ? port : options.dstPortStart,
        dstPortEnd: port !== undefined ? port : options.dstPortEnd,
        srcPortStart: options.srcPortStart,
        srcPortEnd: options.srcPortEnd,
        state: options.state,
        comment: options.comment,
        ipVersion: options.ipVersion,
        srcIpAddr: options.srcIpAddr,
        dstIpAddr: options.dstIpAddr
      }
    })
  }

  async deleteRule (id: string): Promise<FWRule> {
    return await this.prisma.fWRule.delete({
      where: { id }
    })
  }

  async flushNWFilter (id: string, redefine: boolean = false): Promise<boolean> {
    try {
      const filter = await this.prisma.nWFilter.findUnique({
        where: { id },
        include: {
          rules: true,
          referencedBy: {
            include: {
              targetFilter: true
            }
          }
        }
      })

      if (!filter) return false

      const conn = await this.connect()
      const existingFilter = await NwFilter.lookupByName(conn, filter.internalName)
      if (existingFilter) {
        if (!redefine) return true
        try {
          await existingFilter.undefine()
        } catch (undefErr: any) {
          // ignore in-use errors, rethrow others
          if (!undefErr.message.includes('nwfilter is in use')) {
            throw undefErr
          }
        }
      }

      const xmlObj: any = {
        filter: {
          $: {
            name: filter.internalName,
            chain: filter.chain || 'root',
            priority: filter.priority.toString(),
            statematch: filter.stateMatch ? '1' : '0'
          },
          uuid: filter.uuid,
          rule: filter.rules.map(rule => {
            const ruleObj: any = {
              $: {
                action: rule.action,
                direction: rule.direction,
                priority: rule.priority.toString(),
                statematch: rule.state ? '1' : '0'
              }
            }

            // Protocol-specific configuration
            const protocolConfig: any = {
              $: this.cleanUndefined({
                srcipaddr: rule.srcIpAddr,
                dstipaddr: rule.dstIpAddr,
                srcportstart: rule.srcPortStart?.toString(),
                srcportend: rule.srcPortEnd?.toString(),
                dstportstart: rule.dstPortStart?.toString(),
                dstportend: rule.dstPortEnd?.toString(),
                comment: rule.comment
              })
            }

            // Add protocol-specific elements
            switch (rule.protocol) {
            case 'tcp':
            case 'udp':
              ruleObj[rule.protocol] = protocolConfig
              break
            case 'icmp':
              ruleObj.icmp = {
                $: {
                  ...protocolConfig.$,
                  // Using srcIpAddr and dstIpAddr instead of removed icmpType/Code
                  srcipaddr: rule.srcIpAddr,
                  dstipaddr: rule.dstIpAddr
                }
              }
              break
            case 'mac':
              ruleObj.mac = {
                $: {
                  ...protocolConfig.$,
                  srcmacaddr: rule.srcMacAddr // Using the correct field from schema
                }
              }
              break
            case 'all':
              ruleObj.all = protocolConfig
              break
            default:
              ruleObj[rule.protocol] = protocolConfig
            }

            return ruleObj
          })
        }
      }

      if (filter.referencedBy.length > 0) {
        xmlObj.filter.filterref = filter.referencedBy.map(ref => ({
          $: {
            filter: ref.targetFilter.internalName,
            priority: (ref.targetFilter.priority || 500).toString()
          }
        }))
      }

      const xml = this.xmlBuilder.buildObject(xmlObj)

      let result: any
      try {
        result = await NwFilter.defineXml(conn, xml)
      } catch (defErr: any) {
        // skip missing dependency errors
        if (defErr.message.includes('referenced filter') && defErr.message.includes('is missing')) {
          console.warn(`Skipping flush for filter ${filter.internalName}: missing referenced filter.`)
          return false
        }
        throw defErr
      }

      await this.prisma.nWFilter.update({
        where: { id: filter.id },
        data: { flushedAt: new Date() }
      })

      return result !== null
    } catch (error) {
      console.error('Error in flushNWFilter:', error)
      return false
    }
  }

  /**
   * Removes duplicate rules from a filter
   * This is useful for cleaning up legacy data where identical rules might have been created
   * @param filterId The ID of the filter to deduplicate
   * @returns The number of duplicate rules removed
   */
  async deduplicateRules (filterId: string): Promise<number> {
    // Get all rules for this filter
    const rules = await this.prisma.fWRule.findMany({
      where: { nwFilterId: filterId },
      orderBy: { createdAt: 'asc' } // Order by creation date, keeping the oldest ones
    })

    // Group rules by their key attributes to find duplicates
    const ruleGroups = new Map<string, FWRule[]>()

    for (const rule of rules) {
      // Create a unique key based on rule properties
      const key = JSON.stringify({
        action: rule.action,
        direction: rule.direction,
        protocol: rule.protocol,
        dstPortStart: rule.dstPortStart,
        dstPortEnd: rule.dstPortEnd,
        srcPortStart: rule.srcPortStart,
        srcPortEnd: rule.srcPortEnd,
        comment: rule.comment,
        ipVersion: rule.ipVersion,
        srcIpAddr: rule.srcIpAddr,
        dstIpAddr: rule.dstIpAddr
        // Note: We don't compare 'state' because it's a JSON object
      })

      if (!ruleGroups.has(key)) {
        ruleGroups.set(key, [])
      }

      ruleGroups.get(key)!.push(rule)
    }

    // Delete duplicate rules (keeping the most recent one in each group)
    let deletedCount = 0
    for (const group of ruleGroups.values()) {
      if (group.length > 1) {
        // Keep the most recently created rule
        const sortedGroup = [...group].sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )

        // Delete all but the most recent rule
        for (let i = 1; i < sortedGroup.length; i++) {
          await this.prisma.fWRule.delete({
            where: { id: sortedGroup[i].id }
          })
          deletedCount++
        }
      }
    }

    // Update the filter's updatedAt timestamp to ensure it gets flushed
    if (deletedCount > 0) {
      await this.prisma.nWFilter.update({
        where: { id: filterId },
        data: { updatedAt: new Date() }
      })
    }

    return deletedCount
  }
}
