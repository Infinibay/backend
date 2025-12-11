import { type Connection, NwFilter } from '@infinibay/libvirt-node'

import { Debugger } from '@utils/debug'

const debug = new Debugger('infinibay:service:firewall:libvirt')

/**
 * @deprecated Este servicio es parte de la arquitectura legacy basada en libvirt nwfilter.
 * La nueva arquitectura utiliza nftables a través de InfinivirtFirewallService.
 * Este servicio se mantiene solo para compatibilidad con código legacy y será eliminado en futuras versiones.
 *
 * Para nuevas implementaciones, usar:
 * - InfinivirtFirewallService para operaciones de firewall
 * - FirewallOrchestrationService para orquestación de alto nivel
 *
 * Service responsible for interacting with libvirt nwfilter subsystem.
 * Handles defining and undefining network filters.
 * NOTE: Does NOT modify VM XML - that's XMLGenerator's responsibility.
 */
export class LibvirtNWFilterService {
  constructor (private conn: Connection) { }

  /**
   * @deprecated Use InfinivirtFirewallService.applyVMFirewall() instead
   * Defines a new nwfilter in libvirt from XML
   * @returns UUID of the created filter
   */
  async defineFilter (xml: string): Promise<string> {
    if (this.conn.isAlive() === false) {
      throw new Error('Libvirt connection is not alive')
    }

    const filter = NwFilter.defineXml(this.conn, xml)

    if (!filter) {
      throw new Error('Failed to define nwfilter in libvirt')
    }

    const uuid = filter.getUuidString()
    if (!uuid) {
      throw new Error('Failed to get UUID from defined nwfilter')
    }

    debug.log('info', `Defined nwfilter with UUID: ${uuid}`)
    return uuid
  }

  /**
   * @deprecated Use InfinivirtFirewallService.removeVMFirewall() instead
   * Removes a filter from libvirt
   */
  async undefineFilter (name: string): Promise<void> {
    const filter = NwFilter.lookupByName(this.conn, name)

    if (filter) {
      filter.undefine()
      debug.log('info', `Undefined nwfilter: ${name}`)
    } else {
      debug.log('warn', `Filter not found: ${name}`)
    }
  }

  /**
   * @deprecated Use InfinivirtFirewallService.listVMChains() instead
   * Lists all nwfilters with 'ibay-' prefix
   */
  async listAllInfinibayFilters (): Promise<string[]> {
    const allFilters = await this.conn.listAllNwFilters(0)

    if (!allFilters) {
      return []
    }

    return allFilters
      .map(f => f.getName())
      .filter((name): name is string => name !== null && name !== undefined && name.startsWith('ibay-'))
  }

  /**
   * @deprecated Use InfinivirtFirewallService to remove individual VM firewalls
   * Removes all Infinibay nwfilters (for cleanup/uninstall)
   * @returns List of removed filter names
   */
  async cleanupAllInfinibayFilters (): Promise<{ removed: string[] }> {
    const filters = await this.listAllInfinibayFilters()
    const removed: string[] = []

    for (const filterName of filters) {
      try {
        await this.undefineFilter(filterName)
        removed.push(filterName)
      } catch (err) {
        debug.log('error', `Failed to remove filter ${filterName}:`, String(err))
      }
    }

    debug.log('info', `Cleanup complete: removed ${removed.length} filters`)
    return { removed }
  }

  /**
   * @deprecated nftables architecture does not use XML descriptions
   * Gets filter XML description
   */
  async getFilterXML (filterName: string): Promise<string | null> {
    const filter = NwFilter.lookupByName(this.conn, filterName)

    if (!filter) {
      return null
    }

    return filter.getXmlDesc(0) || null
  }

  /**
   * @deprecated Use InfinivirtFirewallService.listVMChains() to check for existing chains
   * Checks if a filter exists in libvirt.
   *
   * This method safely handles exceptions from lookupByName and returns
   * false for not-found errors instead of throwing.
   *
   * @param filterName - The name of the filter to check
   * @returns true if filter exists, false if not found or on lookup errors
   */
  async filterExists (filterName: string): Promise<boolean> {
    try {
      const filter = NwFilter.lookupByName(this.conn, filterName)
      return filter !== null
    } catch (error) {
      // lookupByName may throw if filter doesn't exist or on connection errors
      debug.log('debug', `Filter lookup failed for ${filterName}: ${(error as Error).message}`)
      return false
    }
  }

  /**
   * @deprecated nftables architecture does not use UUIDs for chain identification
   * Gets the UUID of an existing filter by name.
   *
   * @param filterName - The name of the filter
   * @returns The UUID string if filter exists, null otherwise
   */
  async getFilterUuid (filterName: string): Promise<string | null> {
    try {
      const filter = NwFilter.lookupByName(this.conn, filterName)

      if (!filter) {
        return null
      }

      const uuid = filter.getUuidString()
      if (uuid) {
        debug.log('debug', `Retrieved UUID for filter ${filterName}: ${uuid}`)
      }

      return uuid
    } catch (error) {
      debug.log('debug', `Failed to get UUID for filter ${filterName}: ${(error as Error).message}`)
      return null
    }
  }
}
