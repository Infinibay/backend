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
      // Get the filter and its rules from the database
      const filter = await this.prisma.nWFilter.findUnique({
        where: { id },
        include: {
          rules: true,
          references: {
            include: {
              targetFilter: true
            }
          }
        }
      });

      if (!filter) {
        return false;
      }

      // Ensure connection
      const conn = await this.connect();

      // Check if filter exists in libvirt
      const existingFilter = await NwFilter.lookupByName(conn, filter.internalName);
      if (existingFilter) {
        if (!redefine) {
          return true;
        }
        // Undefine existing filter if redefine is true
        await existingFilter.undefine();
      }

      // Build XML structure for the filter
      const xmlObj: any = {
        filter: {
          $: {
            name: filter.internalName,
            chain: filter.chain || 'root'
          },
          uuid: filter.uuid,
          rule: filter.rules.map(rule => ({
            $: {
              action: rule.action,
              direction: rule.direction,
              priority: rule.priority,
              statematch: rule.state || undefined
            },
            [rule.protocol]: {
              $: {
                srcipaddr: rule.srcIpAddr || undefined,
                dstipaddr: rule.dstIpAddr || undefined,
                srcportstart: rule.srcPortStart || undefined,
                srcportend: rule.srcPortEnd || undefined,
                dstportstart: rule.dstPortStart || undefined,
                dstportend: rule.dstPortEnd || undefined,
                comment: rule.comment || undefined
              }
            }
          }))
        }
      };

      // Add filter references if any
      if (filter.references.length > 0) {
        xmlObj.filter.filterref = filter.references.map(ref => ({
          $: {
            filter: ref.targetFilter.internalName
          }
        }));
      }

      // Convert to XML string
      const xml = this.xmlBuilder.buildObject(xmlObj);

      // Define the filter in libvirt
      const result = await NwFilter.defineXml(conn, xml);
      return result !== null;

    } catch (error) {
      return false;
    }
  }

  private generateIbayName() {
    return `ibay-${randomBytes(8).toString('hex')}`;
  }
}
