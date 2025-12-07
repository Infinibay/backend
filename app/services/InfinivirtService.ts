/**
 * InfinivirtService - Singleton service for VM operations via infinivirt library.
 *
 * This service replaces direct libvirt-node usage with the infinivirt library,
 * providing a unified API for VM lifecycle management, health monitoring,
 * and state synchronization.
 *
 * @example
 * ```typescript
 * const infinivirt = await getInfinivirt()
 * const result = await infinivirt.createVM(config)
 * ```
 */

import { Infinivirt, VMEventData } from '@infinibay/infinivirt'
import prisma from '../utils/database'
import { getEventManager, EventAction } from './EventManager'
import { Debugger } from '../utils/debug'

const debug = new Debugger('infinivirt-service')

// Configuration from environment variables
const INFINIVIRT_CONFIG = {
  diskDir: process.env.INFINIVIRT_DISK_DIR || '/var/lib/infinivirt/disks',
  qmpSocketDir: process.env.INFINIVIRT_SOCKET_DIR || '/opt/infinibay/infinivirt',
  pidfileDir: process.env.INFINIVIRT_PID_DIR || '/opt/infinibay/infinivirt/pids',
  healthMonitorInterval: parseInt(process.env.INFINIVIRT_HEALTH_INTERVAL || '30000', 10),
  autoStartHealthMonitor: process.env.INFINIVIRT_AUTO_HEALTH !== 'false'
}

// Singleton instance
let infinivirtInstance: Infinivirt | null = null
let initializationPromise: Promise<Infinivirt> | null = null

/**
 * Gets or creates the Infinivirt singleton instance.
 *
 * This function is safe to call multiple times - it will return the same
 * instance and handle concurrent initialization properly.
 *
 * @returns Promise resolving to the initialized Infinivirt instance
 * @throws Error if initialization fails
 */
export async function getInfinivirt (): Promise<Infinivirt> {
  // Return existing instance if available
  if (infinivirtInstance) {
    return infinivirtInstance
  }

  // Return pending initialization if in progress
  if (initializationPromise) {
    return initializationPromise
  }

  // Start initialization
  initializationPromise = initializeInfinivirt()

  try {
    infinivirtInstance = await initializationPromise
    return infinivirtInstance
  } finally {
    initializationPromise = null
  }
}

/**
 * Internal initialization function.
 */
async function initializeInfinivirt (): Promise<Infinivirt> {
  // Check if running as root (required for nftables)
  if (process.getuid && process.getuid() !== 0) {
    console.error('')
    console.error('╔══════════════════════════════════════════════════════════════╗')
    console.error('║  ERROR: Backend must run as root to use infinivirt           ║')
    console.error('║                                                              ║')
    console.error('║  Infinivirt requires root permissions for:                   ║')
    console.error('║    - nftables firewall management                            ║')
    console.error('║    - TAP network device creation                             ║')
    console.error('║    - QEMU process management                                 ║')
    console.error('║                                                              ║')
    console.error('║  Run with: sudo npm run dev                                  ║')
    console.error('╚══════════════════════════════════════════════════════════════╝')
    console.error('')
    process.exit(1)
  }

  console.log('🚀 Initializing Infinivirt service...')

  const eventManager = getEventManager()

  const infinivirt = new Infinivirt({
    prismaClient: prisma,
    eventManager,
    diskDir: INFINIVIRT_CONFIG.diskDir,
    qmpSocketDir: INFINIVIRT_CONFIG.qmpSocketDir,
    pidfileDir: INFINIVIRT_CONFIG.pidfileDir,
    healthMonitorInterval: INFINIVIRT_CONFIG.healthMonitorInterval,
    autoStartHealthMonitor: INFINIVIRT_CONFIG.autoStartHealthMonitor
  })

  await infinivirt.initialize()

  console.log('✅ Infinivirt service initialized successfully')
  console.log(`   - Disk directory: ${INFINIVIRT_CONFIG.diskDir}`)
  console.log(`   - QMP socket directory: ${INFINIVIRT_CONFIG.qmpSocketDir}`)
  console.log(`   - Health monitor: ${INFINIVIRT_CONFIG.autoStartHealthMonitor ? 'enabled' : 'disabled'}`)

  // Subscribe to QMP events for real-time status updates
  subscribeToVMEvents(infinivirt)

  // Re-attach to running VMs (e.g., after backend restart)
  await attachToRunningVMs(infinivirt)

  return infinivirt
}

/**
 * Subscribes to infinivirt EventHandler events and forwards them to the backend EventManager.
 *
 * This enables real-time VM status updates via WebSocket instead of relying on polling.
 */
function subscribeToVMEvents (infinivirt: Infinivirt): void {
  const eventHandler = infinivirt.getEventHandler()
  const eventManager = getEventManager()

  // Map infinivirt status to backend event actions
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
async function attachToRunningVMs (infinivirt: Infinivirt): Promise<void> {
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
        await infinivirt.attachToRunningVM(vm.id, qmpSocketPath)
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
 * Shuts down the Infinivirt service gracefully.
 *
 * Should be called during application shutdown to clean up resources.
 */
export async function shutdownInfinivirt (): Promise<void> {
  if (!infinivirtInstance) {
    return
  }

  console.log('🛑 Shutting down Infinivirt service...')

  try {
    await infinivirtInstance.shutdown()
    console.log('✅ Infinivirt service shut down successfully')
  } catch (error) {
    console.error('❌ Error shutting down Infinivirt:', error)
    throw error
  } finally {
    infinivirtInstance = null
    initializationPromise = null
  }
}

/**
 * Checks if Infinivirt is initialized.
 */
export function isInfinivirtInitialized (): boolean {
  return infinivirtInstance !== null && infinivirtInstance.isInitialized()
}

/**
 * Gets the current configuration (for debugging/logging).
 */
export function getInfinivirtConfig (): typeof INFINIVIRT_CONFIG {
  return { ...INFINIVIRT_CONFIG }
}
