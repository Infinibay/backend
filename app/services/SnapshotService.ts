import { Debugger } from '../utils/debug'
import { getLibvirtConnection } from '../utils/libvirt'
import { Connection, Machine, Snapshot } from '@infinibay/libvirt-node'
import { Builder, Parser } from 'xml2js'

export interface SnapshotInfo {
  name: string
  description?: string
  createdAt: Date
  state: string
  isCurrent: boolean
  parentName?: string
}

/**
 * Service for managing VM snapshots using libvirt-node API
 */
export class SnapshotService {
  private debug: Debugger
  private libvirt: Connection | null = null
  private xmlBuilder: Builder
  private xmlParser: Parser

  constructor() {
    this.debug = new Debugger('snapshot-service')
    this.xmlBuilder = new Builder()
    this.xmlParser = new Parser()
  }

  async initialize(): Promise<void> {
    try {
      this.libvirt = await getLibvirtConnection()
      this.debug.log('info', 'Snapshot Service initialized')
    } catch (error) {
      this.debug.log('error', `Failed to initialize libvirt connection: ${error}`)
      throw error
    }
  }

  private async ensureConnection(): Promise<Connection> {
    if (!this.libvirt) {
      await this.initialize()
    }
    return this.libvirt!
  }

  async createSnapshot(
    vmId: string,
    name: string,
    description?: string
  ): Promise<{ success: boolean; message: string; snapshot?: SnapshotInfo }> {
    try {
      const conn = await this.ensureConnection()
      const domain = Machine.lookupByUuidString(conn, vmId)
      
      if (!domain) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      // Create snapshot XML using xml2js Builder for safe XML generation
      const snapshotObj: any = {
        domainsnapshot: {
          name: name,
          memory: {
            $: {
              snapshot: 'internal'
            }
          }
        }
      }

      // Add description if provided
      if (description) {
        snapshotObj.domainsnapshot.description = description
      }

      const xml = this.xmlBuilder.buildObject(snapshotObj)

      // Create snapshot using libvirt-node API
      const snapshot = domain.snapshotCreateXml(xml, 0)
      
      if (!snapshot) {
        throw new Error('Failed to create snapshot')
      }

      this.debug.log('info', `Snapshot '${name}' created for VM ${vmId}`)

      return {
        success: true,
        message: `Snapshot '${name}' created successfully`,
        snapshot: {
          name,
          description,
          createdAt: new Date(),
          state: 'active',
          isCurrent: true
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Failed to create snapshot: ${error}`)
      return { success: false, message: `Failed to create snapshot: ${error.message}` }
    }
  }

  async listSnapshots(vmId: string): Promise<{ success: boolean; snapshots: SnapshotInfo[] }> {
    try {
      const conn = await this.ensureConnection()
      const domain = Machine.lookupByUuidString(conn, vmId)
      
      if (!domain) {
        return { success: false, snapshots: [] }
      }

      // List snapshots using libvirt-node API
      const libvirtSnapshots = domain.listAllSnapshots(0)
      
      if (!libvirtSnapshots || libvirtSnapshots.length === 0) {
        return { success: true, snapshots: [] }
      }

      // Get current snapshot if exists
      const currentSnapshot = domain.snapshotCurrent(0)
      const currentName = currentSnapshot?.getName()

      const snapshots: SnapshotInfo[] = []
      
      for (const snapshot of libvirtSnapshots) {
        const snapshotName = snapshot.getName()
        const xmlDesc = snapshot.getXmlDesc(0)
        
        let info: SnapshotInfo = {
          name: snapshotName || 'unknown',
          createdAt: new Date(),
          state: 'unknown',
          isCurrent: snapshotName === currentName
        }

        // Parse XML to get more details
        if (xmlDesc) {
          try {
            const parsed = await this.xmlParser.parseStringPromise(xmlDesc)
            if (parsed.domainsnapshot) {
              if (parsed.domainsnapshot.description) {
                info.description = parsed.domainsnapshot.description[0]
              }
              if (parsed.domainsnapshot.creationTime) {
                info.createdAt = new Date(parseInt(parsed.domainsnapshot.creationTime[0]) * 1000)
              }
              if (parsed.domainsnapshot.state) {
                info.state = parsed.domainsnapshot.state[0]
              }
              if (parsed.domainsnapshot.parent && parsed.domainsnapshot.parent[0].name) {
                info.parentName = parsed.domainsnapshot.parent[0].name[0]
              }
            }
          } catch (parseErr) {
            this.debug.log('warning', `Failed to parse snapshot XML: ${parseErr}`)
          }
        }
        
        snapshots.push(info)
      }

      this.debug.log('info', `Found ${snapshots.length} snapshots for VM ${vmId}`)
      return { success: true, snapshots }
    } catch (error: any) {
      this.debug.log('error', `Failed to list snapshots: ${error}`)
      return { success: false, snapshots: [] }
    }
  }

  async restoreSnapshot(
    vmId: string,
    snapshotName: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const conn = await this.ensureConnection()
      const domain = Machine.lookupByUuidString(conn, vmId)
      
      if (!domain) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      // Lookup snapshot by name
      const snapshot = domain.snapshotLookupByName(snapshotName, 0)
      
      if (!snapshot) {
        return { success: false, message: `Snapshot '${snapshotName}' not found` }
      }

      // Restore snapshot using libvirt-node API
      const success = domain.revertToSnapshot(snapshot, 0)
      
      if (!success) {
        throw new Error('Failed to revert to snapshot')
      }

      this.debug.log('info', `VM ${vmId} restored to snapshot '${snapshotName}'`)
      return { success: true, message: `Restored to snapshot '${snapshotName}' successfully` }
    } catch (error: any) {
      this.debug.log('error', `Failed to restore snapshot: ${error}`)
      return { success: false, message: `Failed to restore snapshot: ${error.message}` }
    }
  }

  async deleteSnapshot(
    vmId: string,
    snapshotName: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const conn = await this.ensureConnection()
      const domain = Machine.lookupByUuidString(conn, vmId)
      
      if (!domain) {
        return { success: false, message: `VM ${vmId} not found` }
      }

      // Lookup snapshot by name
      const snapshot = domain.snapshotLookupByName(snapshotName, 0)
      
      if (!snapshot) {
        return { success: false, message: `Snapshot '${snapshotName}' not found` }
      }

      // Delete snapshot using libvirt-node API
      const success = snapshot.delete(0)
      
      if (!success) {
        throw new Error('Failed to delete snapshot')
      }

      this.debug.log('info', `Snapshot '${snapshotName}' deleted from VM ${vmId}`)
      return { success: true, message: `Snapshot '${snapshotName}' deleted successfully` }
    } catch (error: any) {
      this.debug.log('error', `Failed to delete snapshot: ${error}`)
      return { success: false, message: `Failed to delete snapshot: ${error.message}` }
    }
  }

  async getCurrentSnapshot(vmId: string): Promise<SnapshotInfo | null> {
    try {
      const conn = await this.ensureConnection()
      const domain = Machine.lookupByUuidString(conn, vmId)
      
      if (!domain) {
        return null
      }

      // Get current snapshot using libvirt-node API
      const currentSnapshot = domain.snapshotCurrent(0)
      
      if (!currentSnapshot) {
        return null
      }

      const name = currentSnapshot.getName() || 'unknown'
      const xmlDesc = currentSnapshot.getXmlDesc(0)
      
      let info: SnapshotInfo = {
        name,
        createdAt: new Date(),
        state: 'active',
        isCurrent: true
      }

      // Parse XML to get more details
      if (xmlDesc) {
        try {
          const parsed = await this.xmlParser.parseStringPromise(xmlDesc)
          if (parsed.domainsnapshot) {
            if (parsed.domainsnapshot.description) {
              info.description = parsed.domainsnapshot.description[0]
            }
            if (parsed.domainsnapshot.creationTime) {
              info.createdAt = new Date(parseInt(parsed.domainsnapshot.creationTime[0]) * 1000)
            }
            if (parsed.domainsnapshot.state) {
              info.state = parsed.domainsnapshot.state[0]
            }
            if (parsed.domainsnapshot.parent && parsed.domainsnapshot.parent[0].name) {
              info.parentName = parsed.domainsnapshot.parent[0].name[0]
            }
          }
        } catch (parseErr) {
          this.debug.log('warning', `Failed to parse snapshot XML: ${parseErr}`)
        }
      }
      
      return info
    } catch (error: any) {
      this.debug.log('error', `Failed to get current snapshot: ${error}`)
      return null
    }
  }
}

// Singleton instance
let snapshotService: SnapshotService | null = null

export const getSnapshotService = async (): Promise<SnapshotService> => {
  if (!snapshotService) {
    snapshotService = new SnapshotService()
    await snapshotService.initialize()
  }
  return snapshotService
}