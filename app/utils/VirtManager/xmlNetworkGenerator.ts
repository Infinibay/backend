import xml2js from 'xml2js'
import { v4 as uuidv4 } from 'uuid'
import { NetworkFirewallRules, FirewallRule } from './networkFirewallRules'
import { NetworkBandwidth, NetworkDNSHost, NetworkIPConfig } from './types/network'
import * as fs from 'fs'

/**
 * XMLNetworkGenerator generates libvirt network XML configurations for creating and managing virtual networks.
 */
export class XMLNetworkGenerator {
  private xml: any

  constructor (name: string, bridgeName: string, description?: string) {
    this.xml = {
      network: {
        $: { ipv6: 'yes', trustGuestRxFilters: 'no' },
        name,
        uuid: uuidv4(),
        forward: null, // Will be populated in setForwardMode
        bridge: {
          $: {
            name: bridgeName,
            stp: 'on',
            delay: '0',
            macTableManager: 'libvirt'
          }
        }
      }
    }

    if (description) {
      this.xml.network.description = description
    }
  }

  /**
   * Sets the forward mode for the network.
   * @param mode - The forward mode ('nat', 'route', 'bridge', 'private', 'vepa', 'passthrough', 'hostdev')
   * @param dev - Optional device name for forwarding
   */
  setForwardMode (mode: string, dev?: string): this {
    this.xml.network.forward = { $: { mode, ...(dev && { dev }) } }
    // Move forward element before bridge
    const networkConfig = this.xml.network
    this.xml.network = {
      $: networkConfig.$,
      name: networkConfig.name,
      uuid: networkConfig.uuid,
      forward: networkConfig.forward,
      bridge: networkConfig.bridge,
      ...(networkConfig.description && { description: networkConfig.description }),
      ...(networkConfig.ip && { ip: networkConfig.ip })
    }
    return this
  }

  /**
   * Sets IP configuration for the network.
   */
  setIPConfiguration (config: NetworkIPConfig): this {
    const ip: any = {
      $: {
        address: config.address,
        netmask: config.netmask
      }
    }

    if (config.dhcp) {
      ip.dhcp = [{
        range: [{
          $: {
            start: config.dhcp.start,
            end: config.dhcp.end
          }
        }]
      }]
    }

    this.xml.network.ip = [ip]
    return this
  }

  /**
   * Enables common network services by setting up the appropriate NAT/routing rules
   */
  enableService (serviceName: string): this {
    // If no forward mode is set, default to NAT
    if (!this.xml.network.forward) {
      this.setForwardMode('nat')
    }
    return this
  }

  /**
   * Enables communication between VMs within the same network
   */
  enableIntraNetworkCommunication (): this {
    // For intra-network communication, we need either NAT or ROUTE mode
    if (!this.xml.network.forward) {
      this.setForwardMode('nat')
    }
    return this
  }

  /**
   * Generates the XML string representation of the network configuration.
   */
  async generateXML (): Promise<string> {
    const builder = new xml2js.Builder()
    return builder.buildObject(this.xml)
  }

  /**
   * Saves the network configuration to an XML file.
   */
  async saveToFile (filePath: string): Promise<void> {
    const xml = await this.generateXML()
    await fs.promises.writeFile(filePath, xml, 'utf8')
  }
}
