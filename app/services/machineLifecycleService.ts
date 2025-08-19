import { PrismaClient, Department } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'
import { Debugger } from '../utils/debug'
import VirtManager from '../utils/VirtManager'
import { ApolloError, UserInputError } from 'apollo-server-express'
import si from 'systeminformation'
import { MachineCleanupService } from './cleanup/machineCleanupService'
import { HardwareUpdateService } from './vm/hardwareUpdateService'
import { getEventManager } from '../services/EventManager'

export class MachineLifecycleService {
  private prisma: PrismaClient
  private user: any
  private debug: Debugger

  constructor(prisma: PrismaClient, user: any) {
    this.prisma = prisma
    this.user = user
    this.debug = new Debugger('machine-lifecycle-service')
  }

  async createMachine(input: any): Promise<any> {
    // First verify the template exists
    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: input.templateId }
    })

    if (!template) {
      throw new UserInputError('Machine template not found')
    }

    const internalName = uuidv4()
    const machine = await this.prisma.$transaction(async (tx: any) => {
      let department: Department | null = null
      if (input.departmentId) {
        department = await tx.department.findUnique({
          where: { id: input.departmentId }
        })
      } else {
        department = await tx.department.findFirst()
      }

      if (!department) {
        throw new UserInputError('Department not found')
      }

      const createdMachine = await tx.machine.create({
        data: {
          name: input.name,
          userId: this.user?.id,
          status: 'building',
          os: input.os,
          templateId: input.templateId,
          internalName,
          departmentId: department.id,
          cpuCores: template.cores,
          ramGB: template.ram,
          diskSizeGB: template.storage,
          gpuPciAddress: input.pciBus,
          configuration: {
            create: {
              graphicPort: 0,
              graphicProtocol: 'spice',
              graphicHost: process.env.GRAPHIC_HOST || 'localhost',
              graphicPassword: null
            }
          }
        },
        include: {
          configuration: true,
          department: true,
          template: true,
          user: true
        }
      })

      if (!createdMachine) {
        throw new ApolloError('Machine not created')
      }

      for (const application of input.applications) {
        await tx.machineApplication.create({
          data: {
            machineId: createdMachine.id,
            applicationId: application.applicationId,
            parameters: application.parameters
          }
        })
      }

      return createdMachine
    })

    setImmediate(() => {
      this.backgroundCode(machine.id, input.username, input.password, input.productKey, input.pciBus)
    })

    return machine
  }

  async destroyMachine(id: string): Promise<any> {
    const isAdmin = this.user?.role === 'ADMIN'
    const whereClause = isAdmin ? { id } : { id, userId: this.user?.id }
    const machine = await this.prisma.machine.findFirst({
      where: whereClause,
      include: {
        configuration: true,
        nwFilters: {
          include: {
            nwFilter: true
          }
        }
      }
    })

    if (!machine) {
      return { success: false, message: 'Machine not found' }
    }

    try {
      const cleanup = new MachineCleanupService(this.prisma)
      await cleanup.cleanupVM(machine.id)
      return { success: true, message: 'Machine destroyed' }
    } catch (error: any) {
      this.debug.log(`Error destroying machine: ${String(error)}`)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, message: `Error destroying machine: ${message}` }
    }
  }

  async updateMachineHardware(input: any): Promise<any> {
    const { id, cpuCores, ramGB, gpuPciAddress } = input

    const machine = await this.prisma.machine.findUnique({
      where: { id },
      include: { configuration: true }
    })

    if (!machine) {
      throw new ApolloError(`Machine with ID ${id} not found`)
    }

    const updateData: any = {}
    if (cpuCores !== undefined) {
      if (cpuCores <= 0) throw new ApolloError('CPU cores must be positive.')
      updateData.cpuCores = cpuCores
    }
    if (ramGB !== undefined) {
      if (ramGB <= 0) throw new ApolloError('RAM must be positive.')
      updateData.ramGB = ramGB
    }

    if (gpuPciAddress !== undefined) {
      if (gpuPciAddress === null) {
        updateData.gpuPciAddress = null
      } else {
        try {
          const graphicsInfo = await si.graphics()
          const isValidGpu = graphicsInfo.controllers.some(
            (gpu) => gpu.pciBus === gpuPciAddress
          )

          if (!isValidGpu) {
            throw new ApolloError(
              `Invalid GPU PCI address: ${gpuPciAddress}. Not found or not a GPU.`
            )
          }
          updateData.gpuPciAddress = gpuPciAddress
        } catch (error) {
          this.debug.log(`Error validating GPU PCI address ${gpuPciAddress}: ${String(error)}`)
          throw new Error(`Failed to validate GPU PCI address: ${gpuPciAddress}.`)
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      this.debug.log(`No hardware changes provided for machine ${id}.`)
      return machine
    }

    const updatedMachine = await this.prisma.machine.update({
      where: { id },
      data: updateData,
      include: {
        configuration: true,
        department: true,
        template: true,
        user: true
      }
    })

    this.debug.log(
      `Machine ${id} hardware updated in DB: ${JSON.stringify(updateData)}. Libvirt update required.`
    )

    // Use the new dedicated hardware update service
    this.backgroundUpdateHardware(updatedMachine.id).catch(err => {
      this.debug.log(`Error in backgroundUpdateHardware for machine ${updatedMachine.id}: ${String(err)}`)
    })

    return updatedMachine
  }

  private async backgroundCode(id: string, username: string, password: string, productKey: string | undefined, pciBus: string | null) {
    try {
      const machine = await this.prisma.machine.findUnique({
        where: {
          id
        }
      })
      const virtManager = new VirtManager()
      virtManager.setPrisma(this.prisma)
      await virtManager.createMachine(machine as any, username, password, productKey, pciBus)
      
      // Update machine status to running
      const updatedMachine = await this.prisma.machine.update({
        where: {
          id
        },
        data: {
          status: 'running'
        },
        include: {
          user: true,
          template: true,
          department: true,
          configuration: true
        }
      })
      
      // Emit real-time event for VM status update
      try {
        const eventManager = getEventManager()
        await eventManager.dispatchEvent('vms', 'update', updatedMachine)
        console.log(`🎯 VM status updated to running: ${updatedMachine.name} (${id})`)
      } catch (eventError) {
        console.error(`Failed to emit update event for VM ${id}:`, eventError)
      }
    } catch (error) {
      console.log(error)
    }
  }

  /**
   * Delegate hardware update to the dedicated HardwareUpdateService
   */
  private async backgroundUpdateHardware(machineId: string): Promise<void> {
    this.debug.log(`Starting background hardware update for machine ${machineId}`)

    // We don't await this so it runs in the background
    new HardwareUpdateService(this.prisma, machineId)
      .updateHardware()
      .catch(error => {
        this.debug.log(`Background hardware update for machine ${machineId} failed: ${error.message}`)
      })
  }
}
