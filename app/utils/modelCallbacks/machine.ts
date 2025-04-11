import { PrismaClient } from '@prisma/client';

import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

import { NetworkFilterService } from '../../services/networkFilterService';
import { Debugger } from '../debug';

const debug = new Debugger('model-callbacks:machine');

export async function beforeCreateMachine(prisma: PrismaClient, params: any) {
    // No pre-creation actions needed
}

/**
 * Creates a network filter for a VM
 * This function should be called after the VM creation transaction is fully committed
 */
export async function createMachineFilter(prisma: PrismaClient, machine: any) {
    try {
        const departmentId = machine.departmentId;
        if (!departmentId) {
            debug.log("No department ID found for machine, skipping filter creation");
            return null;
        }

        const department = await prisma.department.findUnique({ where: { id: departmentId } });
        if (!department) {
            debug.log('error', `Department with ID ${departmentId} not found, skipping filter creation`);
            return null;
        }

        // Create the network filter service
        const networkFilterService = new NetworkFilterService(prisma);

        // Create the filter
        const filter = await prisma.nWFilter.create({
            data: {
                name: `Filter for VM ${machine.name}`,
                description: `Filter for VM ${machine.name}`,
                internalName: `ibay-${randomBytes(8).toString('hex')}`,
                uuid: uuidv4(),
                type: 'vm',
                chain: 'root'
            },
        });

        // Create the VM filter association
        const vmFilter = await prisma.vMNWFilter.create({
            data: {
                vmId: machine.id,
                nwFilterId: filter.id
            }
        });

        // Add filterref of the department to the vm filter
        const deptoFilter = await prisma.departmentNWFilter.findFirst({ where: { departmentId: departmentId } });
        if (deptoFilter) {
            await prisma.filterReference.create({
                data: {
                    sourceFilterId: filter.id,
                    targetFilterId: deptoFilter.nwFilterId
                }
            });
        }

        // Apply the filter to libvirt
        try {
          await networkFilterService.connect();
          await networkFilterService.flushNWFilter(filter.id, true);
        } catch (error) {
          debug.log('error', `Error applying network filter: ${error}`);
          throw error;
        } finally {
          await networkFilterService.close();
        }

        debug.log(`Successfully created filter for VM ${machine.name} (${machine.id})`);
        return vmFilter;
    } catch (error) {
        debug.log('error', `Error creating machine filter: ${error}`);
        return null;
    }
}

/**
 * This callback runs after a machine is created, but before the transaction is committed.
 * We need to defer the filter creation until after the transaction is committed.
 */
export async function afterCreateMachine(prisma: PrismaClient, params: any, result: any) {
    // We need to defer the filter creation until after the transaction is committed
    // Using process.nextTick ensures this runs after the current event loop iteration
    // which should be after the transaction is committed
    process.nextTick(async () => {
        try {
            // Create a new Prisma client instance to ensure we're not in the same transaction
            const newPrisma = new PrismaClient();

            // Fetch the machine again to ensure we're seeing the committed data
            const machine = await newPrisma.machine.findUnique({
                where: { id: result.id },
                include: { department: true }
            });

            if (machine) {
                await createMachineFilter(newPrisma, machine);
            } else {
                debug.log('error', `Machine with ID ${result.id} not found after creation, cannot create filter`);
            }

            // Close the new Prisma client
            await newPrisma.$disconnect();
        } catch (error) {
            debug.log('error', `Error in deferred filter creation: ${error}`);
        }
    });
}
