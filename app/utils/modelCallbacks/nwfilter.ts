import { PrismaClient } from '@prisma/client';

import { NetworkFilterService } from '../../services/networkFilterService';

export async function afterCreateNWfilter(prisma: PrismaClient, params: any, filter: any) {
  process.nextTick(async () => {
    try {
      const service = new NetworkFilterService(prisma);
      await service.flushNWFilter(filter.id, true);
    } catch (error) {
      console.error('Error flushing NWFilter:', error);
    }
  });
}