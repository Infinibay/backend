import { PrismaClient, Prisma } from '@prisma/client'

import { v4 as uuidv4 } from 'uuid'
import { randomBytes } from 'crypto'

import { NetworkFilterService } from '../../services/networkFilterService'
import { Debugger } from '../debug'

const debug = new Debugger('model-callbacks:department')

/**
 * Creates a network filter for a department
 * This function should be called after the department creation transaction is fully committed
 */
export async function createDepartmentFilter (prisma: PrismaClient, department: any) {
  try {
    const basicSecurity = await prisma.nWFilter.findFirst({
      where: {
        name: 'Basic Security'
      }
    })
    const dropAll = await prisma.nWFilter.findFirst({
      where: {
        name: 'Drop All'
      }
    })
    if (!basicSecurity || !dropAll) {
      debug.log('error', 'Basic Security is missing a basic security filter')
      return
    }

    // Get common service filters
    const usePing = await prisma.nWFilter.findFirst({ where: { name: 'Use Ping' } })
    const useDns = await prisma.nWFilter.findFirst({ where: { name: 'Use DNS service' } })

    // Create the network filter service
    const networkFilterService = new NetworkFilterService(prisma)

    // create a nwFilter
    const nwFilter = await prisma.nWFilter.create({
      data: {
        name: `Filter for department ${department.name}`,
        description: `Filter for department ${department.name}`,
        internalName: `ibay-${randomBytes(8).toString('hex')}`,
        uuid: uuidv4(),
        type: 'department',
        chain: 'root',
        priority: 100
      }
    })

    await prisma.departmentNWFilter.create({
      data: {
        departmentId: department.id,
        nwFilterId: nwFilter.id
      }
    })

    // Add the basic security filter (includes DHCP, HTTP, HTTPS, anti-spoofing)
    await prisma.filterReference.create({
      data: {
        sourceFilterId: nwFilter.id,
        targetFilterId: basicSecurity.id
      }
    })

    // Add common service filters
    if (usePing) {
      await prisma.filterReference.create({
        data: {
          sourceFilterId: nwFilter.id,
          targetFilterId: usePing.id
        }
      })
      debug.log(`Added Ping service to department filter ${nwFilter.id}`)
    }

    if (useDns) {
      await prisma.filterReference.create({
        data: {
          sourceFilterId: nwFilter.id,
          targetFilterId: useDns.id
        }
      })
      debug.log(`Added DNS service to department filter ${nwFilter.id}`)
    }

    // Add the drop all filter (must be last to reject all other traffic)
    await prisma.filterReference.create({
      data: {
        sourceFilterId: nwFilter.id,
        targetFilterId: dropAll.id
      }
    })

    // Apply the filter to libvirt
    await networkFilterService.connect()
    await networkFilterService.flushNWFilter(nwFilter.id, true)
    await networkFilterService.close()

    debug.log(`Successfully created filter for department ${department.name} (${department.id})`)
  } catch (error) {
    debug.log('error', `Error creating department filter: ${error}`)
  }
}

/**
 * This callback runs after a department is created, but before the transaction is committed.
 * We need to defer the filter creation until after the transaction is committed.
 */
export async function afterCreateDepartment (
  prisma: PrismaClient,
  args: Prisma.DepartmentCreateArgs,
  result: any // Result from Client Extension has optional fields
): Promise<void> {
  process.nextTick(async () => {
    try {
      // Create a new Prisma client instance to ensure we're not in the same transaction
      const newPrisma = new PrismaClient()

      // Fetch the department again to ensure we're seeing the committed data
      const department = await newPrisma.department.findUnique({
        where: { id: result.id }
      })

      if (department) {
        await createDepartmentFilter(newPrisma, department)
      } else {
        debug.log('error', `Department with ID ${result.id} not found after creation, cannot create filter`)
      }

      // Close the new Prisma client
      await newPrisma.$disconnect()
    } catch (error) {
      debug.log('error', `Error in deferred filter creation: ${error}`)
    }
  })
}
