import { Connection, Network } from 'libvirt-node';
import { parseStringPromise } from 'xml2js';
import { XMLNetworkGenerator } from '@utils/VirtManager/xmlNetworkGenerator';
import { CreateNetworkInput } from '@graphql/resolvers/networks/types';

export class NetworkService {
  private connection: Connection | null = null;

  constructor() {
    this.connection = Connection.open("qemu:///system");
    if (!this.connection) {
      throw new Error("Failed to connect to libvirt");
    }
  }

  private ensureConnection(): Connection {
    if (!this.connection) {
      throw new Error("No active connection to libvirt");
    }
    return this.connection;
  }

  private async findNetworkByName(conn: Connection, name: string): Promise<Network | null> {
    const networks = await conn.listAllNetworks(0);
    if (!networks) {
      throw new Error("Failed to list networks");
    }

    for (const network of networks) {
      const networkName = network.getName();
      if (!networkName) {
        continue;
      }
      if (networkName === name) {
        return network;
      }
    }
    return null;
  }

  async validateNetworkName(name: string): Promise<void> {
    const conn = this.ensureConnection();
    const existingNetwork = await this.findNetworkByName(conn, name);
    if (existingNetwork) {
      throw new Error(`Network with name ${name} already exists`);
    }
  }

  async validateDhcpRange(ipConfig: { address: string; netmask: string; dhcp?: { start: string; end: string } }): Promise<void> {
    if (!ipConfig.dhcp) return;

    const conn = this.ensureConnection();
    const networks = await conn.listAllNetworks(0);
    if (!networks) {
      throw new Error("Failed to list networks");
    }

    const dhcpStart = ipConfig.dhcp.start;
    const dhcpEnd = ipConfig.dhcp.end;

    for (const network of networks) {
      const xml = await network.getXmlDesc(0);
      if (!xml) continue;

      const parsed = await parseStringPromise(xml);
      const networkIp = parsed.network?.ip?.[0];
      if (!networkIp?.dhcp?.[0]?.range?.[0]?.$) continue;

      const range = networkIp.dhcp[0].range[0].$;
      if (this.isIpInRange(dhcpStart, range.start, range.end) ||
          this.isIpInRange(dhcpEnd, range.start, range.end)) {
        throw new Error(`DHCP range overlaps with existing network ${network.getName()}`);
      }
    }
  }

  private isIpInRange(ip: string, start: string, end: string): boolean {
    const ipNum = this.ipToNumber(ip);
    const startNum = this.ipToNumber(start);
    const endNum = this.ipToNumber(end);
    return ipNum >= startNum && ipNum <= endNum;
  }

  private ipToNumber(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }

  async createNetwork(input: CreateNetworkInput): Promise<void> {
    const conn = this.ensureConnection();

    // Validate network name
    await this.validateNetworkName(input.name);

    // Validate DHCP range if provided
    if (input.ipConfig) {
      await this.validateDhcpRange(input.ipConfig);
    }

    // Create network configuration
    const generator = new XMLNetworkGenerator(input.name, input.bridgeName, input.description);

    // Set forward mode to NAT by default
    generator.setForwardMode('nat');

    // Configure IP and DHCP if provided
    if (input.ipConfig) {
      generator.setIPConfiguration(input.ipConfig);
    }

    // Enable intra-network communication if requested
    if (input.enableIntraNetworkCommunication) {
      generator.enableIntraNetworkCommunication();
    }

    // Enable requested services
    if (input.enabledServices) {
      for (const service of input.enabledServices) {
        generator.enableService(service);
      }
    }

    // Generate XML
    const xml = await generator.generateXML();

    // Create and start the network
    console.log("Defining network...", xml);
    const network = await Network.defineXml(conn, xml);
    if (!network) {
      throw new Error("Failed to define network");
    }

    // Start the network
    const result = await network.create();
    if (result === null) {
      throw new Error("Failed to start network");
    }
  }

  async getAllNetworks(): Promise<any[]> {
    const conn = this.ensureConnection();
    const networks = await conn.listAllNetworks(0);
    if (!networks) {
      throw new Error("Failed to list networks");
    }

    const result = await Promise.all(networks.map(async (network) => {
      const name = network.getName();
      if (!name) {
        throw new Error("Failed to get network name");
      }

      const xml = await network.getXmlDesc(0);
      if (!xml) {
        throw new Error(`Failed to get XML description for network ${name}`);
      }

      const parsed = await parseStringPromise(xml);
      return {
        name,
        xml: parsed.network
      };
    }));

    return result;
  }

  async getNetwork(name: string): Promise<any> {
    const conn = this.ensureConnection();
    const network = await this.findNetworkByName(conn, name);
    if (!network) {
      throw new Error(`Network ${name} not found`);
    }
    
    const xml = await network.getXmlDesc(0);
    if (!xml) {
      throw new Error(`Failed to get XML description for network ${name}`);
    }

    const parsed = await parseStringPromise(xml);
    return {
      name: network.getName(),
      xml: parsed.network
    };
  }

  async setIpRange(networkName: string, start: string, end: string): Promise<void> {
    const conn = this.ensureConnection();
    const network = await this.findNetworkByName(conn, networkName);
    if (!network) {
      throw new Error(`Network ${networkName} not found`);
    }
    
    const xml = await network.getXmlDesc(0);
    if (!xml) {
      throw new Error(`Failed to get XML description for network ${networkName}`);
    }

    const parsed = await parseStringPromise(xml);
    if (!parsed.network.ip?.[0]?.dhcp?.[0]?.range?.[0]) {
      throw new Error("Network does not have DHCP range configuration");
    }

    parsed.network.ip[0].dhcp[0].range[0].$.start = start;
    parsed.network.ip[0].dhcp[0].range[0].$.end = end;
    
    const builder = require('xmlbuilder');
    const newXml = builder.create(parsed).end({ pretty: true});

    const undefineResult = await network.undefine();
    if (undefineResult === null) {
      throw new Error("Failed to undefine network");
    }

    const newNetwork = await Network.defineXml(conn, newXml);
    if (!newNetwork) {
      throw new Error("Failed to define network with new configuration");
    }

    const createResult = await newNetwork.create();
    if (createResult === null) {
      throw new Error("Failed to create network with new configuration");
    }
  }

  async setNetworkIp(networkName: string, address: string, netmask: string): Promise<void> {
    const conn = this.ensureConnection();
    const network = await this.findNetworkByName(conn, networkName);
    if (!network) {
      throw new Error(`Network ${networkName} not found`);
    }
    
    const xml = await network.getXmlDesc(0);
    if (!xml) {
      throw new Error(`Failed to get XML description for network ${networkName}`);
    }

    const parsed = await parseStringPromise(xml);
    if (!parsed.network.ip?.[0]) {
      throw new Error("Network does not have IP configuration");
    }

    parsed.network.ip[0].$.address = address;
    parsed.network.ip[0].$.netmask = netmask;
    
    const builder = require('xmlbuilder');
    const newXml = builder.create(parsed).end({ pretty: true});

    const undefineResult = await network.undefine();
    if (undefineResult === null) {
      throw new Error("Failed to undefine network");
    }

    const newNetwork = await Network.defineXml(conn, newXml);
    if (!newNetwork) {
      throw new Error("Failed to define network with new configuration");
    }

    const createResult = await newNetwork.create();
    if (createResult === null) {
      throw new Error("Failed to create network with new configuration");
    }
  }

  async setBridgeName(networkName: string, bridgeName: string): Promise<void> {
    const conn = this.ensureConnection();
    const network = await this.findNetworkByName(conn, networkName);
    if (!network) {
      throw new Error(`Network ${networkName} not found`);
    }
    
    const xml = await network.getXmlDesc(0);
    if (!xml) {
      throw new Error(`Failed to get XML description for network ${networkName}`);
    }

    const parsed = await parseStringPromise(xml);
    if (!parsed.network.bridge?.[0]) {
      throw new Error("Network does not have bridge configuration");
    }

    parsed.network.bridge[0].$.name = bridgeName;
    
    const builder = require('xmlbuilder');
    const newXml = builder.create(parsed).end({ pretty: true});

    const undefineResult = await network.undefine();
    if (undefineResult === null) {
      throw new Error("Failed to undefine network");
    }

    const newNetwork = await Network.defineXml(conn, newXml);
    if (!newNetwork) {
      throw new Error("Failed to define network with new configuration");
    }

    const createResult = await newNetwork.create();
    if (createResult === null) {
      throw new Error("Failed to create network with new configuration");
    }
  }

  async deleteNetwork(networkName: string): Promise<void> {
    const conn = this.ensureConnection();
    
    // Find the network
    const network = await this.findNetworkByName(conn, networkName);
    if (!network) {
      throw new Error(`Network ${networkName} not found`);
    }

    // Get network info including bridge name
    const networkXML = await network.getXmlDesc(0);
    if (!networkXML) {
      throw new Error(`Failed to get XML description for network ${networkName}`);
    }
    const networkInfo = await parseStringPromise(networkXML);
    const bridgeName = networkInfo?.network?.bridge?.[0]?.$?.name;

    if (!bridgeName) {
      throw new Error(`Could not determine bridge name for network ${networkName}`);
    }

    // Get all domains (VMs)
    const domains = await conn.listAllDomains(0);

    if (!domains) {
      throw new Error(`Failed to list domains`);
    }
    
    // Check each domain for network usage
    for (const domain of domains) {
      const domainXML = await domain.getXmlDesc(0);
      if (!domainXML) {
        throw new Error(`Failed to get XML description for domain ${domain.getName()}`);
      }
      const domainInfo = await parseStringPromise(domainXML);
      
      // Check interfaces for network or bridge usage
      const interfaces = domainInfo?.domain?.devices?.[0]?.interface || [];
      console.log("Interfaces:", interfaces);
      for (const iface of interfaces) {
        console.log("Iface:", iface?.$?.type === 'network' && iface?.source?.[0]?.$?.network);
        console.log(iface?.$?.type === 'bridge' && iface?.source?.[0]?.$?.bridge);
        if (
          (iface?.$?.type === 'network' && iface?.source?.[0]?.$?.network === networkName) ||
          (iface?.$?.type === 'bridge' && iface?.source?.[0]?.$?.bridge === bridgeName)
        ) {
          const domainName = domainInfo?.domain?.name?.[0] || 'unknown';
          throw new Error(
            `Cannot delete network ${networkName}: it is in use by VM "${domainName}"`
          );
        }
      }
    }

    // If we get here, it's safe to delete the network
    try {
      // First try to stop the network if it's active
      if (await network.isActive()) {
        await network.destroy();
      }
      // Then undefine it
      await network.undefine();
    } catch (error: any) {
      throw new Error(`Failed to delete network ${networkName}: ${error?.message}`);
    }
  }
}
