import { CreateNetworkInput } from '@graphql/resolvers/networks/types'

// TODO: This service used libvirt-node for managing libvirt networks.
// The system now uses DepartmentNetworkService with native Linux bridges.
// This service is kept for API compatibility but all operations are disabled.

/**
 * @deprecated Libvirt network management has been replaced by DepartmentNetworkService.
 * Use department networks (infinibr-*) instead of libvirt networks.
 */
export class NetworkService {
  constructor () {
    // No-op - libvirt connection not needed
  }

  async validateNetworkName (_name: string): Promise<void> {
    throw new Error('Libvirt networks are deprecated. Use department networks instead.')
  }

  async validateDhcpRange (_ipConfig: { address: string; netmask: string; dhcp?: { start: string; end: string } }): Promise<void> {
    throw new Error('Libvirt networks are deprecated. Use department networks instead.')
  }

  async createNetwork (_input: CreateNetworkInput): Promise<void> {
    throw new Error('Libvirt networks are deprecated. Use department networks instead.')
  }

  async getAllNetworks (): Promise<any[]> {
    // Return empty array instead of throwing to not break the UI
    return []
  }

  async getNetwork (name: string): Promise<any> {
    throw new Error(`Libvirt network ${name} not found. Libvirt networks are deprecated.`)
  }

  async setIpRange (_networkName: string, _start: string, _end: string): Promise<void> {
    throw new Error('Libvirt networks are deprecated. Use department networks instead.')
  }

  async setNetworkIp (_networkName: string, _address: string, _netmask: string): Promise<void> {
    throw new Error('Libvirt networks are deprecated. Use department networks instead.')
  }

  async setBridgeName (_networkName: string, _bridgeName: string): Promise<void> {
    throw new Error('Libvirt networks are deprecated. Use department networks instead.')
  }

  async deleteNetwork (_networkName: string): Promise<void> {
    throw new Error('Libvirt networks are deprecated. Use department networks instead.')
  }
}
