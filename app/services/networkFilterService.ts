import { PrismaClient, NWFilter, Prisma, FWRule } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { Connection, NwFilter } from 'libvirt-node';
import { Builder, Parser } from 'xml2js';
import { randomBytes } from 'crypto';

export class NetworkFilterService {
  private connection: Connection | null = null;
  private xmlBuilder: Builder;
  private xmlParser: Parser;

  constructor(private prisma: PrismaClient) {
    this.xmlBuilder = new Builder();
    this.xmlParser = new Parser();
  }

  private generateIbayName(): string {
    return `ibay-${randomBytes(8).toString('hex')}`;
  }

  private cleanUndefined(obj: any): any {
    return Object.fromEntries(
      Object.entries(obj).filter(([_, v]) => v != null)
    );
  }

  async connect(): Promise<Connection> {
    if (!this.connection) {
      this.connection = await Connection.open('qemu:///system');
      if (!this.connection) {
        throw new Error('Failed to connect to hypervisor');
      }
    }
    return this.connection;
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }

  async createFilter(
    name: string,
    description: string,
    chain: string | null,
    type: 'generic' | 'department' | 'vm' = 'generic'
  ): Promise<NWFilter> {
    const nwFilter = await this.prisma.nWFilter.create({
      data: {
        name,
        internalName: this.generateIbayName(),
        uuid: uuidv4(),
        description,
        chain,
        type,
      },
    });
    return nwFilter;
  }

  async updateFilter(
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
      data,
    });
  }

  async deleteFilter(id: string): Promise<NWFilter> {
    return await this.prisma.nWFilter.delete({
      where: { id },
    });
  }

  async createRule(
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
    return await this.prisma.fWRule.create({
      data: {
        nwFilterId: filterId,
        action,
        direction,
        priority,
        protocol,
        dstPortStart: port,
        dstPortEnd: port,
        srcPortStart: options.srcPortStart,
        srcPortEnd: options.srcPortEnd,
        state: options.state,
        comment: options.comment,
        ipVersion: options.ipVersion,
        srcIpAddr: options.srcIpAddr,
        dstIpAddr: options.dstIpAddr,
      },
    });
  }

  async deleteRule(id: string): Promise<FWRule> {
    return await this.prisma.fWRule.delete({
      where: { id },
    });
  }

  async flushNWFilter(id: string, redefine: boolean = false): Promise<boolean> {
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
      });

      if (!filter) return false;

      const conn = await this.connect();
      const existingFilter = await NwFilter.lookupByName(conn, filter.internalName);
      if (existingFilter) {
        if (!redefine) return true;
        await existingFilter.undefine();
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
            };

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
            };

            // Add protocol-specific elements
            switch (rule.protocol) {
              case 'tcp':
              case 'udp':
                ruleObj[rule.protocol] = protocolConfig;
                break;
              case 'icmp':
                ruleObj.icmp = {
                  $: {
                    ...protocolConfig.$,
                    // Using srcIpAddr and dstIpAddr instead of removed icmpType/Code
                    srcipaddr: rule.srcIpAddr,
                    dstipaddr: rule.dstIpAddr
                  }
                };
                break;
              case 'mac':
                ruleObj.mac = {
                  $: {
                    ...protocolConfig.$,
                    srcmacaddr: rule.srcMacAddr // Using the correct field from schema
                  }
                };
                break;
              case 'all':
                ruleObj.all = protocolConfig;
                break;
              default:
                ruleObj[rule.protocol] = protocolConfig;
            }

            return ruleObj;
          })
        }
      };

      if (filter.referencedBy.length > 0) {
        xmlObj.filter.filterref = filter.referencedBy.map(ref => ({
          $: {
            filter: ref.targetFilter.internalName,
            priority: (ref.targetFilter.priority || 500).toString()
          }
        }));
      }

      const xml = this.xmlBuilder.buildObject(xmlObj);

      const result = await NwFilter.defineXml(conn, xml);
      await this.prisma.nWFilter.update({
        where: { id: filter.id },
        data: { flushedAt: new Date() }
      });

      return result !== null;
    } catch (error) {
      console.error('Error in flushNWFilter:', error);
      return false;
    }
  }
}
