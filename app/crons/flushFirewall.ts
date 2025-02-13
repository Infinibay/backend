import { CronJob } from 'cron';
import { PrismaClient, Machine as PrismaMachine } from '@prisma/client';
import { Connection, Machine as LibvirtMachine, VirDomainXMLFlags } from 'libvirt-node';
import { DOMParser } from 'xmldom';
import { networkInterfaces } from 'systeminformation';

import { NetworkFilterService } from '../services/networkFilterService';

const FlushFirewallJob = new CronJob('*/1 * * * *', async () => {
    const prisma = new PrismaClient();
    // all filters where updatedAt > flushedAt
    const filters:any[] = await prisma.$queryRaw`
        SELECT * FROM public.nWFilter WHERE updatedAt > flushedAt or flushedAt is null
    `;
    let service = new NetworkFilterService(prisma);
    for (const filter of filters) {
        service.flushNWFilter(filter.id, true);
    }
});