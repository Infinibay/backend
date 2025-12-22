/**
 * InfinizationService - Singleton service for VM operations via infinization library.
 *
 * This service replaces direct libvirt-node usage with the infinization library,
 * providing a unified API for VM lifecycle management, health monitoring,
 * and state synchronization.
 *
 * @example
 * ```typescript
 * const infinization = await getInfinization()
 * const result = await infinization.createVM(config)
 * ```
 */

import fs from 'fs'
import path from 'path'
import { Infinization, VMEventData } from '@infinibay/infinization'
import prisma from '../utils/database'
import { getEventManager, EventAction } from './EventManager'
import { Debugger } from '../utils/debug'

const debug = new Debugger('infinization-service')

// Configuration from environment variables
const INFINIZATION_CONFIG = {
  diskDir: process.env.INFINIZATION_DISK_DIR || '/var/lib/infinization/disks',
  qmpSocketDir: process.env.INFINIZATION_SOCKET_DIR || '/opt/infinibay/sockets',
  pidfileDir: process.env.INFINIZATION_PID_DIR || '/opt/infinibay/pids',
  healthMonitorInterval: parseInt(process.env.INFINIZATION_HEALTH_INTERVAL || '30000', 10),
  autoStartHealthMonitor: process.env.INFINIZATION_AUTO_HEALTH !== 'false'
}

// Singleton instance
let infinizationInstance: Infinization | null = null
let initializationPromise: Promise<Infinization> | null = null

/**
 * Gets or creates the Infinization singleton instance.
 *
 * This function is safe to call multiple times - it will return the same
 * instance and handle concurrent initialization properly.
 *
 * @returns Promise resolving to the initialized Infinization instance
 * @throws Error if initialization fails
 */
export async function getInfinization (): Promise<Infinization> {
  // Return existing instance if available
  if (infinizationInstance) {
    return infinizationInstance
  }

  // Return pending initialization if in progress
  if (initializationPromise) {
    return initializationPromise
  }

  // Start initialization
  initializationPromise = initializeInfinization()

  try {
    infinizationInstance = await initializationPromise
    return infinizationInstance
  } finally {
    initializationPromise = null
  }
}

/**
 * Internal initialization function.
 */
async function initializeInfinization (): Promise<Infinization> {
  // Check if running as root (required for nftables)
  if (process.getuid && process.getuid() !== 0) {
    console.error('')
    console.error('╔══════════════════════════════════════════════════════════════╗')
    console.error('║  ERROR: Backend must run as root to use infinization         ║')
    console.error('║                                                              ║')
    console.error('║  Infinization requires root permissions for:                 ║')
    console.error('║    - nftables firewall management                            ║')
    console.error('║    - TAP network device creation                             ║')
    console.error('║    - QEMU process management                                 ║')
    console.error('║                                                              ║')
    console.error('║  Run with: sudo npm run dev                                  ║')
    console.error('╚══════════════════════════════════════════════════════════════╝')
    console.error('')
    process.exit(1)
  }

  // Ensure all required directories exist before creating Infinization instance.
  // These directories are used by VMLifecycle for:
  // - diskDir: VM disk images (qcow2 files)
  // - qmpSocketDir: QMP sockets, InfiniService virtio-serial channels, and guest-agent sockets
  // - pidfileDir: QEMU process PID files
  const fs = await import('fs')

  const requiredDirs = [
    { path: INFINIZATION_CONFIG.diskDir, name: 'disk' },
    { path: INFINIZATION_CONFIG.qmpSocketDir, name: 'socket' },
    { path: INFINIZATION_CONFIG.pidfileDir, name: 'pidfile' }
  ]

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir.path)) {
      fs.mkdirSync(dir.path, { recursive: true, mode: 0o755 })
      console.log(`📁 Created ${dir.name} directory: ${dir.path}`)
    }
  }

  console.log('🚀 Initializing Infinization service...')

  const eventManager = getEventManager()

  const infinization = new Infinization({
    prismaClient: prisma,
    eventManager,
    diskDir: INFINIZATION_CONFIG.diskDir,
    qmpSocketDir: INFINIZATION_CONFIG.qmpSocketDir,
    pidfileDir: INFINIZATION_CONFIG.pidfileDir,
    healthMonitorInterval: INFINIZATION_CONFIG.healthMonitorInterval,
    autoStartHealthMonitor: INFINIZATION_CONFIG.autoStartHealthMonitor
  })

  await infinization.initialize()

  console.log('✅ Infinization service initialized successfully')
  console.log(`   - Disk directory: ${INFINIZATION_CONFIG.diskDir}`)
  console.log(`   - QMP socket directory: ${INFINIZATION_CONFIG.qmpSocketDir}`)
  console.log(`   - Health monitor: ${INFINIZATION_CONFIG.autoStartHealthMonitor ? 'enabled' : 'disabled'}`)

  // Subscribe to QMP events for real-time status updates
  subscribeToVMEvents(infinization)

  // Re-attach to running VMs (e.g., after backend restart)
  await attachToRunningVMs(infinization)

  return infinization
}

/**
 * Subscribes to infinization EventHandler events and forwards them to the backend EventManager.
 *
 * This enables real-time VM status updates via WebSocket instead of relying on polling.
 */
function subscribeToVMEvents (infinization: Infinization): void {
  const eventHandler = infinization.getEventHandler()
  const eventManager = getEventManager()

  // Map infinization status to backend event actions
  const statusToAction: Record<string, EventAction> = {
    'off': 'power_off',
    'running': 'power_on',
    'suspended': 'suspend'
  }

  // Listen for all VM events
  eventHandler.on('vm:event', async (eventData: VMEventData) => {
    const action: EventAction = statusToAction[eventData.newStatus] || 'update'

    debug.log(`QMP event: ${eventData.event} for VM ${eventData.vmId} (${eventData.previousStatus} -> ${eventData.newStatus})`)

    try {
      // Fetch full VM data for the event payload
      const vm = await prisma.machine.findUnique({
        where: { id: eventData.vmId },
        include: {
          user: true,
          template: true,
          department: true,
          configuration: true
        }
      })

      if (vm) {
        await eventManager.dispatchEvent('vms', action, vm)
        debug.log(`Dispatched vms:${action} event for VM ${vm.name}`)
      }
    } catch (error) {
      debug.log('error', `Failed to dispatch event for VM ${eventData.vmId}: ${error}`)
    }
  })

  // Listen for disconnect events (QMP socket closed unexpectedly)
  eventHandler.on('vm:disconnect', async (data: { vmId: string; timestamp: Date }) => {
    debug.log(`QMP disconnect for VM ${data.vmId}`)
    // HealthMonitor will handle crash detection; just log here
  })

  console.log('📡 Subscribed to QMP events for real-time status updates')
}

/**
 * Re-attaches to VMs that were running before the backend was restarted.
 *
 * This ensures we receive QMP events for VMs that are still running.
 */
async function attachToRunningVMs (infinization: Infinization): Promise<void> {
  try {
    const runningVMs = await prisma.machine.findMany({
      where: { status: 'running' },
      include: { configuration: true }
    })

    if (runningVMs.length === 0) {
      console.log('📋 No running VMs to attach to')
      return
    }

    console.log(`📋 Attaching to ${runningVMs.length} running VM(s)...`)

    for (const vm of runningVMs) {
      const qmpSocketPath = vm.configuration?.qmpSocketPath

      if (!qmpSocketPath) {
        debug.log(`VM ${vm.name} (${vm.id}) has no QMP socket path, skipping`)
        continue
      }

      try {
        await infinization.attachToRunningVM(vm.id, qmpSocketPath)
        debug.log(`Attached to VM ${vm.name} (${vm.id})`)
      } catch (error) {
        // VM might have crashed between DB query and attach attempt
        debug.log('warn', `Failed to attach to VM ${vm.name} (${vm.id}): ${error}`)
      }
    }

    console.log('✅ Finished attaching to running VMs')
  } catch (error) {
    console.error('❌ Error attaching to running VMs:', error)
    // Don't fail initialization - health monitor will catch crashed VMs
  }
}

/**
 * Shuts down the Infinization service gracefully.
 *
 * Should be called during application shutdown to clean up resources.
 */
export async function shutdownInfinization (): Promise<void> {
  if (!infinizationInstance) {
    return
  }

  console.log('🛑 Shutting down Infinization service...')

  try {
    await infinizationInstance.shutdown()
    console.log('✅ Infinization service shut down successfully')
  } catch (error) {
    console.error('❌ Error shutting down Infinization:', error)
    throw error
  } finally {
    infinizationInstance = null
    initializationPromise = null
  }
}

/**
 * Checks if Infinization is initialized.
 */
export function isInfinizationInitialized (): boolean {
  return infinizationInstance !== null && infinizationInstance.isInitialized()
}

/**
 * Gets the current configuration (for debugging/logging).
 */
export function getInfinizationConfig (): typeof INFINIZATION_CONFIG {
  return { ...INFINIZATION_CONFIG }
}

/**
 * Ejects all CD-ROM devices from a VM after installation completes.
 *
 * This removes Windows ISO, VirtIO drivers ISO, and autounattend ISO.
 * After ejection, temporary ISOs in the temp directory are deleted.
 * The operation is non-blocking and tolerant to failures.
 *
 * @param vmId - The VM identifier
 */
export async function ejectAllCdroms (vmId: string): Promise<void> {
  const infinization = await getInfinization()
  const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
  const tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR ?? path.join(baseDir, 'iso', 'temp')

  try {
    // Query block devices to find CD-ROMs
    const blocks = await infinization.queryBlockDevices(vmId)
    const tempIsosToDelete: string[] = []

    // Find and eject all CD-ROM devices
    for (const block of blocks) {
      if (block.removable) {
        // Capture ISO path before ejecting if it's in the temp directory
        if (block.inserted?.file) {
          const isoPath = block.inserted.file
          if (isoPath.startsWith(tempIsoDir)) {
            tempIsosToDelete.push(isoPath)
          }
        }

        debug.log(`Ejecting CD-ROM device: ${block.device} from VM ${vmId}`)
        try {
          await infinization.ejectCdrom(vmId, block.device)
          debug.log(`CD-ROM device ${block.device} ejected successfully`)
        } catch (ejectError: any) {
          // Individual eject failures shouldn't stop the process
          debug.log('warn', `Failed to eject ${block.device}: ${ejectError.message}`)
        }
      }
    }

    debug.log(`All CD-ROMs ejected from VM ${vmId}`)

    // Delete temporary ISOs after successful ejection
    for (const isoPath of tempIsosToDelete) {
      try {
        await fs.promises.unlink(isoPath)
        debug.log(`Deleted temp ISO: ${isoPath}`)
      } catch (unlinkError: any) {
        // Non-fatal: log warning but don't fail the operation
        debug.log('warn', `Failed to delete temp ISO ${isoPath}: ${unlinkError.message}`)
      }
    }

    if (tempIsosToDelete.length > 0) {
      debug.log(`Cleaned up ${tempIsosToDelete.length} temporary ISO(s) for VM ${vmId}`)
    }
  } catch (error: any) {
    debug.log('warn', `Failed to eject CD-ROMs from VM ${vmId}: ${error.message}`)
    // Non-fatal: VM can continue running with ISOs mounted
  }
}

