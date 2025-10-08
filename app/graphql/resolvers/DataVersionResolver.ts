import { Resolver, Query, Ctx, ObjectType, Field, Authorized, GraphQLISODateTime, Int } from 'type-graphql'
import { InfinibayContext } from '../../utils/context'

@ObjectType()
export class EntityVersion {
  @Field(() => Int)
    count: number = 0

  @Field(() => GraphQLISODateTime)
    lastUpdated: Date = new Date()
}

@ObjectType()
export class DataVersions {
  @Field(() => EntityVersion)
    vms: EntityVersion = new EntityVersion()

  @Field(() => EntityVersion)
    departments: EntityVersion = new EntityVersion()

  @Field(() => EntityVersion)
    applications: EntityVersion = new EntityVersion()

  @Field(() => EntityVersion)
    users: EntityVersion = new EntityVersion()

  @Field(() => EntityVersion)
    appSettings: EntityVersion = new EntityVersion()
}

@Resolver()
export class DataVersionResolver {
  @Query(() => DataVersions)
  @Authorized('USER')
  async dataVersions (
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DataVersions> {
    try {
      // Get both count and maximum updatedAt for each entity type
      // This creates a comprehensive version fingerprint that detects all changes
      const [vmStats, departmentStats, applicationStats, userStats, appSettingsStats] = await Promise.all([
        // Machine - count and max updatedAt
        prisma.machine.aggregate({
          _count: { id: true },
          _max: { updatedAt: true }
        }),
        // Department - count and max updatedAt (now available)
        prisma.department.aggregate({
          _count: { id: true },
          _max: { updatedAt: true }
        }),
        // Application - count and max updatedAt (now available)
        prisma.application.aggregate({
          _count: { id: true },
          _max: { updatedAt: true }
        }),
        // User - count and max updatedAt (now available)
        prisma.user.aggregate({
          _count: { id: true },
          _max: { updatedAt: true }
        }),
        // AppSettings - count and max updatedAt
        prisma.appSettings.aggregate({
          _count: { id: true },
          _max: { updatedAt: true }
        })
      ])

      // Return default timestamp (epoch) if no records exist
      const defaultTimestamp = new Date(0)

      const createEntityVersion = (count: number, lastUpdated: Date | null): EntityVersion => {
        const version = new EntityVersion()
        version.count = count
        version.lastUpdated = lastUpdated || defaultTimestamp
        return version
      }

      return {
        vms: createEntityVersion(vmStats._count.id || 0, vmStats._max.updatedAt),
        departments: createEntityVersion(departmentStats._count.id || 0, departmentStats._max.updatedAt),
        applications: createEntityVersion(applicationStats._count.id || 0, applicationStats._max.updatedAt),
        users: createEntityVersion(userStats._count.id || 0, userStats._max.updatedAt),
        appSettings: createEntityVersion(appSettingsStats._count.id || 0, appSettingsStats._max.updatedAt)
      }
    } catch (error) {
      console.error('Error fetching data versions:', error)

      // Return default version data in case of error
      const makeDefault = () => {
        const v = new EntityVersion()
        v.count = 0
        v.lastUpdated = new Date(0)
        return v
      }

      return {
        vms: makeDefault(),
        departments: makeDefault(),
        applications: makeDefault(),
        users: makeDefault(),
        appSettings: makeDefault()
      }
    }
  }
}
