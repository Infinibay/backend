import { PrismaClient } from '@prisma/client';

import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

import { NetworkFilterService } from '../../services/networkFilterService';
import { Debugger } from '../debug';

const debug = new Debugger('model-callbacks:department');

/**
 * Creates a network filter for a department
 * This function should be called after the department creation transaction is fully committed
 */
export async function createDepartmentFilter(prisma: PrismaClient, department: any) {
    try {
        let basicSecurity = await prisma.nWFilter.findFirst({
            where: {
                name: 'Basic Security'
            }
        });
        let dropAll = await prisma.nWFilter.findFirst({
            where: {
                name: 'Drop All'
            }
        });
        if (!basicSecurity || !dropAll) {
            debug.log('error', 'Basic Security is missing a basic security filter');
            return;
        }

        // Create the network filter service
        const networkFilterService = new NetworkFilterService(prisma);

        // create a nwFilter
        let nwFilter = await prisma.nWFilter.create({
            data: {
                name: `Filter for department ${department.name}`,
                description: `Filter for department ${department.name}`,
                internalName: `ibay-${randomBytes(8).toString('hex')}`,
                uuid: uuidv4(),
                type: 'department',
                chain: 'root'
            },
        });

        await prisma.departmentNWFilter.create({
            data: {
                departmentId: department.id,
                nwFilterId: nwFilter.id
            }
        });

        // Add the basic security filter
        await prisma.filterReference.create({
            data: {
                sourceFilterId: nwFilter.id,
                targetFilterId: basicSecurity.id
            }
        });

        // Add the drop all filter
        await prisma.filterReference.create({
            data: {
                sourceFilterId: nwFilter.id,
                targetFilterId: dropAll.id
            }
        });

        // Apply the filter to libvirt
        await networkFilterService.connect();
        await networkFilterService.flushNWFilter(nwFilter.id, true);
        await networkFilterService.close();

        debug.log(`Successfully created filter for department ${department.name} (${department.id})`);
    } catch (error) {
        debug.log('error', `Error creating department filter: ${error}`);
    }
}

/**
 * This callback runs after a department is created, but before the transaction is committed.
 * We need to defer the filter creation until after the transaction is committed.
 */
export async function afterCreateDepartment(prisma: PrismaClient, params: any, result: any) {
    process.nextTick(async () => {
        try {
            const basicSecurity = await prisma.nWFilter.findFirst({ where: { name: 'Basic Security' } });
            const dropAll = await prisma.nWFilter.findFirst({ where: { name: 'Drop All' } });
            if (!basicSecurity || !dropAll) {
                console.error('Basic Security is missing a basic security filter');
                return;
            }
            // create a nwFilter
            const nwFilter = await prisma.nWFilter.create({
                data: {
                    name: `Filter for department ${result.name}`,
                    description: `Filter for department ${result.name}`,
                    internalName: `ibay-${randomBytes(8).toString('hex')}`,
                    uuid: uuidv4(),
                    type: 'department',
                    chain: 'root'
                },
            });
            await prisma.departmentNWFilter.create({ data: { departmentId: result.id, nwFilterId: nwFilter.id } });
            // Add the basic security filter
            await prisma.filterReference.create({ data: { sourceFilterId: nwFilter.id, targetFilterId: basicSecurity.id } });
            // Add the drop all filter
            await prisma.filterReference.create({ data: { sourceFilterId: nwFilter.id, targetFilterId: dropAll.id } });
        } catch (error) {
            console.error('Error creating department filter:', error);
        }
    });
}
