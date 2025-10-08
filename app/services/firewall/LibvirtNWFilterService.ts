import type { Connection } from '@infinibay/libvirt-node'
import * as libvirtNode from '@infinibay/libvirt-node'

import { Debugger } from '@utils/debug'

const debug = new Debugger('infinibay:service:firewall:libvirt')

// Access NWFilter from the imported module to work around TypeScript typing issues
const NWFilter = (libvirtNode as any).NWFilter

/**
 * Service responsible for interacting with libvirt nwfilter subsystem.
 * Handles defining, undefining, and applying network filters to VMs.
 */
export class LibvirtNWFilterService {
  constructor (private conn: Connection) {}

  /**
   * Defines a new nwfilter in libvirt from XML
   * @returns UUID of the created filter
   */
  async defineFilter (xml: string): Promise<string> {
    const filter = NWFilter.defineXml(this.conn, xml)

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
   * Removes a filter from libvirt
   */
  async undefineFilter (name: string): Promise<void> {
    const filter = NWFilter.lookupByName(this.conn, name)

    if (filter) {
      filter.undefine()
      debug.log('info', `Undefined nwfilter: ${name}`)
    } else {
      debug.log('warn', `Filter not found: ${name}`)
    }
  }

  /**
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
   * Applies a filter to a VM's network interface by updating the domain XML.
   * Note: This requires VM restart or interface update to take effect in libvirt < 6.0
   * In libvirt >= 6.0, nwfilter changes are applied dynamically to running VMs.
   *
   * @param vmInternalName - The libvirt domain name (e.g., "vm-abc123")
   * @param filterName - The nwfilter name to apply
   */
  async applyFilterToVM (vmInternalName: string, filterName: string): Promise<void> {
    // TODO: Implement actual domain XML manipulation
    // This is a placeholder for the integration point where we would:
    // 1. Look up the domain using the appropriate libvirt method
    // 2. Get its current XML
    // 3. Parse the XML to find network interfaces
    // 4. Add <filterref filter="filterName"/> to each interface
    // 5. Redefine the domain with updated XML

    debug.log('info', `Filter ${filterName} ready to apply to VM ${vmInternalName}`)
    debug.log(
      'warn',
      'Full XML manipulation not implemented - integration point for XMLGenerator service'
    )
  }

  /**
   * Gets filter XML description
   */
  async getFilterXML (filterName: string): Promise<string | null> {
    const filter = NWFilter.lookupByName(this.conn, filterName)

    if (!filter) {
      return null
    }

    return filter.getXmlDesc(0) || null
  }

  /**
   * Checks if a filter exists in libvirt
   */
  async filterExists (filterName: string): Promise<boolean> {
    const filter = NWFilter.lookupByName(this.conn, filterName)
    return filter !== null
  }
}
