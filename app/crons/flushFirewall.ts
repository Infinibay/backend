import { CronJob } from 'cron'
import { NWFilter } from '@prisma/client'
import { NetworkFilterService } from '../services/networkFilterService'
import prisma from '../utils/database'

const service = new NetworkFilterService(prisma)

const FlushFirewallJob = new CronJob('*/1 * * * *', async () => {
  try {
    // all filters where updatedAt > flushedAt or flushedAt is null
    const filters = await prisma.$queryRaw<NWFilter[]>`
            SELECT * FROM "NWFilter" 
            WHERE "flushedAt" IS NULL 
            OR "updatedAt" > "flushedAt"
        `

    await Promise.all(filters.map(filter =>
      service.flushNWFilter(filter.id, true)
        .catch(error => console.error(`Failed to flush filter ${filter.id}:`, error))
    ))
  } catch (error) {
    console.error('Error in FlushFirewallJob:', error)
  }
})

export default FlushFirewallJob
