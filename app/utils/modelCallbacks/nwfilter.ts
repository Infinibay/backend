import { PrismaClient } from '@prisma/client'
import dbSingleton from '../database'

import { NetworkFilterService } from '../../services/networkFilterService'
import { Debugger } from '../debug'

const debug = new Debugger('model-callbacks:nwfilter')

/**
 * This callback runs after a network filter is created, but before the transaction is committed.
 * We need to defer the filter application until after the transaction is committed.
 */
export async function afterCreateNWfilter (prisma: PrismaClient, params: any, filter: any) {
  // We need to defer the filter application until after the transaction is committed
  // Using process.nextTick ensures this runs after the current event loop iteration
  // which should be after the transaction is committed
  process.nextTick(async () => {
    try {
      // Use the singleton Prisma client
      // The transaction should be committed by now, so we can safely query
      const nwFilter = await dbSingleton.nWFilter.findUnique({
        where: { id: filter.id }
      })

      if (nwFilter) {
        // Apply the filter to libvirt
        const service = new NetworkFilterService(dbSingleton)
        await service.connect()
        await service.flushNWFilter(nwFilter.id, true)
        await service.close()

        debug.log(`Successfully applied network filter ${nwFilter.name} (${nwFilter.id}) to libvirt`)
      } else {
        debug.log('error', `Network filter with ID ${filter.id} not found after creation, cannot apply to libvirt`)
      }
    } catch (error) {
      debug.log('error', `Error in deferred filter application: ${error}`)
    }
  })
}
