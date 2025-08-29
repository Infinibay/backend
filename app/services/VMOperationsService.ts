import { PrismaClient, Machine } from '@prisma/client'
import { Connection, Machine as VirtualMachine, Error as LibvirtError } from 'libvirt-node'
import { Debugger } from '@utils/debug'
import { getEventManager } from './EventManager'

export interface VMOperationResult {
  success: boolean
  message?: string
  error?: string
}

export class VMOperationsService {
  private prisma: PrismaClient
  private debug: Debugger
  private connection: Connection | null = null

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = new Debugger('vm-operations')
  }

  /**
   * Connect to libvirt
   */
  private async connect (): Promise<Connection> {
    if (!this.connection) {
      this.connection = await Connection.open('qemu:///system')
      if (!this.connection) {
        throw new Error('Failed to connect to hypervisor')
      }
    }
    return this.connection
  }

  /**
   * Close libvirt connection
   */
  async close (): Promise<void> {
    if (this.connection) {
      await this.connection.close()
      this.connection = null
    }
  }

  /**
   * Get domain by machine ID
   */
  private async getDomain (machineId: string): Promise<{ machine: Machine; domain: VirtualMachine }> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId }
    })

    if (!machine) {
      throw new Error(`Machine ${machineId} not found`)
    }

    const conn = await this.connect()
    const domain = VirtualMachine.lookupByName(conn, machine.internalName)

    if (!domain) {
      throw new Error(`Domain ${machine.internalName} not found in libvirt`)
    }

    return { machine, domain }
  }

  /**
   * Restart a virtual machine (graceful shutdown then start)
   */
  async restartMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Restarting machine ${machineId}`)

    try {
      const { machine, domain } = await this.getDomain(machineId)

      // Check if machine is running
      const isActive = domain.isActive()
      if (!isActive) {
        this.debug.log(`Machine ${machine.name} is not running, starting it instead`)
        return this.startMachine(machineId)
      }

      // Perform graceful shutdown
      this.debug.log(`Performing graceful shutdown for ${machine.name}`)
      const shutdownResult = await this.performGracefulShutdown(domain, machine.internalName)

      if (!shutdownResult.success) {
        return shutdownResult
      }

      // Wait for machine to fully stop
      await this.waitForMachineState(domain, 'off', 60000) // 60 seconds timeout

      // Start the machine again
      this.debug.log(`Starting machine ${machine.name} after shutdown`)
      return this.startMachine(machineId)
    } catch (error: any) {
      this.debug.log(`Error restarting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Force power off a virtual machine (immediate destroy)
   */
  async forcePowerOff (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Force powering off machine ${machineId}`)

    try {
      const { machine, domain } = await this.getDomain(machineId)

      // Check if machine is running
      const isActive = domain.isActive()
      if (!isActive) {
        this.debug.log(`Machine ${machine.name} is already powered off`)
        return {
          success: true,
          message: 'Machine is already powered off'
        }
      }

      // Force destroy without any timeout
      this.debug.log(`Force destroying domain ${machine.internalName}`)
      const result = domain.destroy()

      if (!result || result === 0) {
        // Update machine status in database
        await this.prisma.machine.update({
          where: { id: machineId },
          data: { status: 'off' }
        })

        // Emit event
        const eventManager = getEventManager()
        await eventManager.dispatchEvent('vms', 'power_off', { id: machineId, forced: true })

        return {
          success: true,
          message: 'Machine forcefully powered off'
        }
      } else {
        return {
          success: false,
          error: `Failed to destroy domain, error code: ${result}`
        }
      }
    } catch (error: any) {
      this.debug.log(`Error force powering off machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Reset a virtual machine (hardware reset)
   */
  async resetMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Resetting machine ${machineId}`)

    try {
      const { machine, domain } = await this.getDomain(machineId)

      // Check if machine is running
      const isActive = domain.isActive()
      if (!isActive) {
        this.debug.log(`Machine ${machine.name} is not running, cannot reset`)
        return {
          success: false,
          error: 'Machine must be running to perform a reset'
        }
      }

      // Perform hardware reset
      this.debug.log(`Performing hardware reset for ${machine.internalName}`)
      const result = domain.reset()

      if (!result || result === 0) {
        // Emit event
        const eventManager = getEventManager()
        await eventManager.dispatchEvent('vms', 'update', { id: machineId, type: 'hardware' })

        return {
          success: true,
          message: 'Machine reset successfully'
        }
      } else {
        return {
          success: false,
          error: `Failed to reset domain, error code: ${result}`
        }
      }
    } catch (error: any) {
      this.debug.log(`Error resetting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Start a virtual machine
   */
  private async startMachine (machineId: string): Promise<VMOperationResult> {
    try {
      const { machine, domain } = await this.getDomain(machineId)

      // Check if already running
      const isActive = domain.isActive()
      if (isActive) {
        return {
          success: true,
          message: 'Machine is already running'
        }
      }

      // Start the domain
      const result = domain.create()

      if (!result || result === 0) {
        // Update machine status
        await this.prisma.machine.update({
          where: { id: machineId },
          data: { status: 'running' }
        })

        // Emit event
        const eventManager = getEventManager()
        await eventManager.dispatchEvent('vms', 'power_on', { id: machineId })

        return {
          success: true,
          message: 'Machine started successfully'
        }
      } else {
        return {
          success: false,
          error: `Failed to start domain, error code: ${result}`
        }
      }
    } catch (error: any) {
      this.debug.log(`Error starting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Perform a graceful shutdown with timeout
   */
  private async performGracefulShutdown (
    domain: VirtualMachine,
    machineName: string
  ): Promise<VMOperationResult> {
    const SHUTDOWN_TIMEOUT = 30000 // 30 seconds timeout

    try {
      // Try graceful shutdown
      const shutdownPromise = new Promise<number>((resolve, reject) => {
        setImmediate(() => {
          try {
            const result = domain.shutdown()
            if (result !== null && result !== undefined) {
              resolve(0)
            } else {
              reject(new Error('Shutdown returned null/undefined'))
            }
          } catch (err) {
            reject(err)
          }
        })
      })

      // Timeout promise
      const timeoutPromise = new Promise<number>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Shutdown timeout after ${SHUTDOWN_TIMEOUT}ms`))
        }, SHUTDOWN_TIMEOUT)
      })

      await Promise.race([shutdownPromise, timeoutPromise])

      this.debug.log(`Graceful shutdown successful for machine ${machineName}`)
      return {
        success: true,
        message: 'Machine shutdown gracefully'
      }
    } catch (error: any) {
      this.debug.log(`Graceful shutdown failed for ${machineName}: ${error.message}`)

      // If graceful shutdown fails, try force destroy
      try {
        this.debug.log(`Attempting force destroy for ${machineName}`)
        const result = domain.destroy()

        if (!result || result === 0) {
          return {
            success: true,
            message: 'Machine shutdown forcefully after graceful shutdown failed'
          }
        } else {
          return {
            success: false,
            error: 'Failed to shutdown machine gracefully and forcefully'
          }
        }
      } catch (destroyError: any) {
        return {
          success: false,
          error: `Failed to shutdown machine: ${destroyError.message}`
        }
      }
    }
  }

  /**
   * Wait for a machine to reach a specific state
   */
  private async waitForMachineState (
    domain: VirtualMachine,
    targetState: 'running' | 'off',
    timeoutMs: number
  ): Promise<void> {
    const startTime = Date.now()
    const checkInterval = 1000 // Check every second

    while (Date.now() - startTime < timeoutMs) {
      const isActive = domain.isActive()

      if (targetState === 'running' && isActive) {
        return
      }

      if (targetState === 'off' && !isActive) {
        return
      }

      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    throw new Error(`Timeout waiting for machine to reach state: ${targetState}`)
  }

  /**
   * Perform a graceful restart with retries
   */
  async performGracefulRestart (
    machineId: string,
    maxRetries: number = 3
  ): Promise<VMOperationResult> {
    let retries = 0

    while (retries < maxRetries) {
      const result = await this.restartMachine(machineId)

      if (result.success) {
        return result
      }

      retries++
      this.debug.log(`Restart attempt ${retries} failed, retrying...`)

      // Wait a bit before retrying
      await new Promise(resolve => setTimeout(resolve, 2000))
    }

    // If all retries failed, try force power off and start
    this.debug.log('All restart attempts failed, trying force power off and start')

    const forceOffResult = await this.forcePowerOff(machineId)
    if (!forceOffResult.success) {
      return forceOffResult
    }

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Try to start
    return this.startMachine(machineId)
  }
}
