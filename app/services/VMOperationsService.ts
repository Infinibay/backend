/**
 * VMOperationsService - VM power operations using infinivirt.
 *
 * This service provides VM lifecycle operations (start, stop, restart, reset)
 * using the infinivirt library instead of direct libvirt calls.
 */

import { PrismaClient } from '@prisma/client'
import { Debugger } from '@utils/debug'
import { getInfinivirt } from './InfinivirtService'

export interface VMOperationResult {
  success: boolean
  message?: string
  error?: string
}

export class VMOperationsService {
  private prisma: PrismaClient
  private debug: Debugger

  constructor (prisma: PrismaClient) {
    this.prisma = prisma
    this.debug = new Debugger('vm-operations')
  }

  /**
   * Restart a virtual machine (graceful shutdown then start)
   */
  async restartMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Restarting machine ${machineId}`)

    try {
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.restartVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine restarted successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to restart machine'
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Error restarting machine: ${error.message}`)
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
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.stopVM(machineId, {
        graceful: false,
        force: true
      })

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine forcefully powered off'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to force power off machine'
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Error force powering off machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Graceful power off a virtual machine
   */
  async gracefulPowerOff (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Gracefully powering off machine ${machineId}`)

    try {
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.stopVM(machineId, {
        graceful: true,
        timeout: 120000, // 2 minutes
        force: true // Force kill if timeout
      })

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine powered off'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to power off machine'
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Error powering off machine: ${error.message}`)
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
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.resetVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine reset successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to reset machine'
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Error resetting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Start a virtual machine
   */
  async startMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Starting machine ${machineId}`)

    try {
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.startVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine started successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to start machine'
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Error starting machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Suspend a virtual machine
   */
  async suspendMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Suspending machine ${machineId}`)

    try {
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.suspendVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine suspended successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to suspend machine'
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Error suspending machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Resume a suspended virtual machine
   */
  async resumeMachine (machineId: string): Promise<VMOperationResult> {
    this.debug.log(`Resuming machine ${machineId}`)

    try {
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.resumeVM(machineId)

      if (result.success) {
        return {
          success: true,
          message: result.message || 'Machine resumed successfully'
        }
      } else {
        return {
          success: false,
          error: result.error || 'Failed to resume machine'
        }
      }
    } catch (error: any) {
      this.debug.log('error', `Error resuming machine: ${error.message}`)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * Get VM status
   */
  async getStatus (machineId: string): Promise<{
    status: string
    processAlive: boolean
    consistent: boolean
  } | null> {
    try {
      const infinivirt = await getInfinivirt()
      const result = await infinivirt.getVMStatus(machineId)

      return {
        status: result.status,
        processAlive: result.processAlive,
        consistent: result.consistent
      }
    } catch (error: any) {
      this.debug.log('error', `Error getting machine status: ${error.message}`)
      return null
    }
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

  /**
   * Close connection (no-op for infinivirt, kept for API compatibility)
   * @deprecated No longer needed with infinivirt
   */
  async close (): Promise<void> {
    // No-op: infinivirt manages its own connections
  }
}
