import { PrismaClient } from '@prisma/client';

import { NetworkFilterService } from '../../services/networkFilterService';

export async function afterCreateNWfilter(prisma: PrismaClient, params: any, filter: any) {
  const service = new NetworkFilterService(prisma);
  service.flushNWFilter(filter.id, true);
}