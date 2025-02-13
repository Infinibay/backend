import { PrismaClient } from '@prisma/client';

import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

export async function beforeCreateMachine(prisma: PrismaClient, params:any) {
    
}


async function createMachineFilter(prisma: PrismaClient, machine: any) {
    const departmentId = machine.departmentId;
    const department = await prisma.department.findUnique({ where: { id: departmentId } });
    if (!department) {
        return null;
    }

    const filter = await prisma.nWFilter.create({
        data: {
            name: `Fiilter for VM ${machine.name}`,
            description: `Filter for VM ${machine.name}`,
            internalName: `ibay-${randomBytes(8).toString('hex')}`,
            uuid: uuidv4(),
            type: 'machine',
            chain: 'root'
        },
    });
    const vmFilter = await prisma.vMNWFilter.create({
        data: {
            vmId: machine.id,
            nwFilterId: filter.id
        }
    });
    return null;
}

export async function afterCreateMachine(prisma: PrismaClient, params:any, result:any) {
    console.log('afterCreateMachine');
    console.log(params);
    console.log(result);
}