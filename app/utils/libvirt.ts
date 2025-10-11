import { Connection } from '@infinibay/libvirt-node'
import { Debugger } from './debug'

const debug = new Debugger('libvirt')

let libvirtConnection: Connection | null = null

/**
 * Get or create a libvirt connection (singleton pattern).
 *
 * This function is safe to call from multiple contexts including:
 * - GraphQL resolvers
 * - Services
 * - Prisma client extension callbacks
 *
 * The connection is lazily initialized on first use and reused for
 * all subsequent calls. This ensures we maintain a single connection
 * to libvirt throughout the application lifecycle.
 *
 * Thread-safety: Node.js is single-threaded, so this singleton pattern
 * is safe without additional locking mechanisms.
 *
 * @returns Promise resolving to the libvirt Connection instance
 * @throws Error if the connection cannot be established
 */
export async function getLibvirtConnection (): Promise<Connection> {
  if (!libvirtConnection) {
    try {
      const libvirt = await import('@infinibay/libvirt-node')
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
export async function closeLibvirtConnection (): Promise<void> {
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
