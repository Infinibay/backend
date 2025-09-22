import { CronJob } from 'cron'
import { NWFilter } from '@prisma/client'
import { NetworkFilterService } from '../services/networkFilterService'
import { DepartmentFirewallService } from '../services/departmentFirewallService'
import prisma from '../utils/database'
import Debug from 'debug'

const debug = Debug('infinibay:flush-firewall-cron')
const service = new NetworkFilterService(prisma)
const departmentFirewallService = new DepartmentFirewallService(prisma, service)

const FlushFirewallJob = new CronJob('*/1 * * * *', async () => {
  try {
    // all filters where updatedAt > flushedAt or flushedAt is null
    // Order by type to ensure department filters are processed before VM filters
    const filters = await prisma.$queryRaw<NWFilter[]>`
            SELECT * FROM "NWFilter"
            WHERE "flushedAt" IS NULL
            OR "updatedAt" > "flushedAt"
            ORDER BY CASE
                WHEN type = 'department' THEN 1
                WHEN type = 'vm' THEN 2
                ELSE 3
            END, "updatedAt" ASC
        `

    debug(`Processing ${filters.length} filters for flush`)

    // Process filters in order to ensure proper dependency resolution
    for (const filter of filters) {
      try {
        debug(`Flushing filter ${filter.id} (type: ${filter.type})`)
        await service.flushNWFilter(filter.id, true)

        // If this is a department filter, also refresh all related VM filters
        if (filter.type === 'department') {
          const department = await prisma.department.findFirst({
            where: {
              nwFilters: {
                some: { id: filter.id }
              }
            }
          })

          if (department) {
            debug(`Refreshing VM filters for department ${department.id}`)
            await departmentFirewallService.refreshAllVMFilters(department.id)
          }
        }
      } catch (error) {
        console.error(`Failed to flush filter ${filter.id}:`, error)
      }
    }

    debug('Firewall flush cron job completed')
  } catch (error) {
    console.error('Error in FlushFirewallJob:', error)
  }
})

export default FlushFirewallJob
