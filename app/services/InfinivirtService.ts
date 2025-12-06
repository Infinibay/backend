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

import { Infinivirt } from '@infinibay/infinivirt'
import prisma from '../utils/database'
import { getEventManager } from './EventManager'

// Configuration from environment variables
const INFINIVIRT_CONFIG = {
  diskDir: process.env.INFINIVIRT_DISK_DIR || '/var/lib/infinivirt/disks',
  qmpSocketDir: process.env.INFINIVIRT_SOCKET_DIR || '/var/run/infinivirt',
  pidfileDir: process.env.INFINIVIRT_PID_DIR || '/var/run/infinivirt/pids',
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

  return infinivirt
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
