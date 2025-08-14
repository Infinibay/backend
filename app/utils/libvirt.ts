import { Connection } from '../../lib/libvirt-node'
import { Debugger } from './debug'

const debug = new Debugger('libvirt')

let libvirtConnection: Connection | null = null

/**
 * Get or create a libvirt connection
 */
export async function getLibvirtConnection(): Promise<Connection> {
  if (!libvirtConnection) {
    try {
      const libvirt = await import('../../lib/libvirt-node')
      libvirtConnection = libvirt.Connection.open('qemu:///system')
      if (!libvirtConnection) {
        throw new Error('Failed to open libvirt connection')
      }
      debug.log('info', 'Libvirt connection established')
    } catch (error) {
      debug.log('error', `Failed to connect to libvirt: ${error}`)
      throw error
    }
  }
  return libvirtConnection
}

/**
 * Close the libvirt connection
 */
export async function closeLibvirtConnection(): Promise<void> {
  if (libvirtConnection) {
    try {
      libvirtConnection.close()
      libvirtConnection = null
      debug.log('info', 'Libvirt connection closed')
    } catch (error) {
      debug.log('error', `Failed to close libvirt connection: ${error}`)
    }
  }
}