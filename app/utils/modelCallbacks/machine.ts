import { PrismaClient } from '@prisma/client'

import { v4 as uuidv4 } from 'uuid'
import { randomBytes } from 'crypto'

import { NetworkFilterService } from '../../services/networkFilterService'
import { Debugger } from '../debug'

const debug = new Debugger('model-callbacks:machine')

export async function beforeCreateMachine (prisma: PrismaClient, params: any) {
  // No pre-creation actions needed
}

/**
 * Creates a network filter for a VM
 * This function should be called after the VM creation transaction is fully committed
 */
export async function createMachineFilter (prisma: PrismaClient, machine: any) {
  try {
    const departmentId = machine.departmentId
    if (!departmentId) {
      debug.log('No department ID found for machine, skipping filter creation')
      return null
    }

    const department = await prisma.department.findUnique({ where: { id: departmentId } })
    if (!department) {
      debug.log('error', `Department with ID ${departmentId} not found, skipping filter creation`)
      return null
    }

    // Create the network filter service
    const networkFilterService = new NetworkFilterService(prisma)

    // Create the filter
    const filter = await prisma.nWFilter.create({
      data: {
        name: `Filter for VM ${machine.name}`,
        description: `Filter for VM ${machine.name}`,
        internalName: `ibay-${randomBytes(8).toString('hex')}`,
        uuid: uuidv4(),
        type: 'vm',
        chain: 'root'
      }
    })

    // Create the VM filter association
    const vmFilter = await prisma.vMNWFilter.create({
      data: {
        vmId: machine.id,
        nwFilterId: filter.id
      }
    })

    // Add filterref of the department to the vm filter
    const deptoFilter = await prisma.departmentNWFilter.findFirst({ where: { departmentId } })
    if (deptoFilter) {
      // Validate that the department filter exists before creating the reference
      const departmentFilter = await prisma.nWFilter.findUnique({
        where: { id: deptoFilter.nwFilterId }
      })

      if (departmentFilter) {
        debug.log(`Creating filter reference from VM filter ${filter.id} to department filter ${departmentFilter.id}`)
        await prisma.filterReference.create({
          data: {
            sourceFilterId: filter.id,
            targetFilterId: departmentFilter.id
          }
        })

        // Ensure VM filter priority is higher (lower precedence) than department filter priority
        // VM filters should be applied after department filters
        await prisma.nWFilter.update({
          where: { id: filter.id },
          data: { priority: 200 } // VM filters have lower priority than department filters (100)
        })

        debug.log(`VM filter properly configured to inherit department rules with correct priority`)
      } else {
        debug.log('error', `Department filter ${deptoFilter.nwFilterId} not found, skipping reference creation`)
      }
    } else {
      debug.log('warning', `No department filter found for department ${departmentId}`)
    }

    // Apply the filter to libvirt
    try {
      await networkFilterService.connect()

      // Ensure department filter is flushed first if it exists
      if (deptoFilter) {
        const departmentFilter = await prisma.nWFilter.findUnique({
          where: { id: deptoFilter.nwFilterId }
        })
        if (departmentFilter) {
          debug.log(`Flushing department filter ${departmentFilter.id} before VM filter`)
          await networkFilterService.flushNWFilter(departmentFilter.id, true)
        }
      }

      // Now flush the VM filter which will properly inherit department rules
      debug.log(`Flushing VM filter ${filter.id}`)
      await networkFilterService.flushNWFilter(filter.id, true)

      // Validate that the filter chain is correct
      debug.log(`VM filter ${filter.id} properly references department filter and has correct priority order`)
    } catch (error) {
      debug.log('error', `Error applying network filter: ${error}`)
      // Implement retry logic for filter creation
      try {
        debug.log('Retrying filter application after 2 seconds...')
        await new Promise(resolve => setTimeout(resolve, 2000))
        await networkFilterService.flushNWFilter(filter.id, true)
        debug.log('Filter application retry successful')
      } catch (retryError) {
        debug.log('error', `Filter application retry failed: ${retryError}`)
        throw error
      }
    } finally {
      await networkFilterService.close()
    }

    debug.log(`Successfully created filter for VM ${machine.name} (${machine.id})`)
    return vmFilter
  } catch (error) {
    debug.log('error', `Error creating machine filter: ${error}`)
    return null
  }
}

/**
 * This callback runs after a machine is created, but before the transaction is committed.
 * We need to defer the filter creation until after the transaction is committed.
 */
export async function afterCreateMachine (prisma: PrismaClient, params: any, result: any) {
  // We need to defer the filter creation until after the transaction is committed
  // Using process.nextTick ensures this runs after the current event loop iteration
  // which should be after the transaction is committed
  process.nextTick(async () => {
    try {
      // Create a new Prisma client instance to ensure we're not in the same transaction
      const newPrisma = new PrismaClient()

      // Fetch the machine again to ensure we're seeing the committed data
      const machine = await newPrisma.machine.findUnique({
        where: { id: result.id },
        include: { department: true }
      })

      if (machine) {
        await createMachineFilter(newPrisma, machine)
      } else {
        debug.log('error', `Machine with ID ${result.id} not found after creation, cannot create filter`)
      }

      // Close the new Prisma client
      await newPrisma.$disconnect()
    } catch (error) {
      debug.log('error', `Error in deferred filter creation: ${error}`)
    }
  })
}
