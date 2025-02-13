import { PrismaClient } from '@prisma/client';

import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';

export async function afterCreateDepartment(prisma: PrismaClient, params:any, result:any) {
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
        console.error('Basic Security or Drop All not found');
        return;
    }
    // create a nwFilter
    let nwFilter = await prisma.nWFilter.create({
        data: {
            name: `Filter for department ${result.name}`,
            description: `Filter for department ${result.name}`,
            internalName: `ibay-${randomBytes(8).toString('hex')}`,
            uuid: uuidv4(),
            type: 'department',
            chain: 'root'
        },
    });
    await prisma.departmentNWFilter.create({
        data: {
            departmentId: result.id,
            nwFilterId: nwFilter.id
        }
    });
    await prisma.filterReference.create({
        data: {
            sourceFilterId: dropAll.id,
            targetFilterId: nwFilter.id
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
}