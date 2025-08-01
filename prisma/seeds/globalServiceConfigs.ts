import { PrismaClient, Prisma } from '@prisma/client'
import { KNOWN_SERVICES } from '../../app/config/knownServices'

/**
 * Seeds the GlobalServiceConfig table with default service configurations
 * for all known services defined in knownServices.ts
 *
 * By default, all services are enabled for 'use' (outbound) but disabled
 * for 'provide' (inbound) for security reasons.
 */
const seedGlobalServiceConfigs = async (prisma: any) => {
  console.log('Seeding global service configurations...')

  // We need to wait until Prisma client is ready with the updated models
  // which might not be available until the migration is applied
  if (!('globalServiceConfig' in prisma)) {
    console.log('GlobalServiceConfig model not available yet, skipping seed')
    return
  }

  // Track success and failures
  let createdCount = 0
  let skippedCount = 0

  for (const service of KNOWN_SERVICES) {
    try {
      await prisma.globalServiceConfig.upsert({
        where: { serviceId: service.id },
        update: {}, // No update if exists
        create: {
          serviceId: service.id,
          useEnabled: false, // By default, no service can be used
          provideEnabled: false // By default, no services can be provided
        }
      })
      createdCount++
    } catch (error) {
      console.error(`Error seeding global config for service ${service.id}:`, error)
      skippedCount++
    }
  }

  console.log(`Global service configurations seeded: ${createdCount} created, ${skippedCount} skipped`)
}

export default seedGlobalServiceConfigs
