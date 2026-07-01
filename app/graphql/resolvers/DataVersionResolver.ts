import logger from '@main/logger'
import { Resolver, Query, Ctx, ObjectType, Field, GraphQLISODateTime, Int } from 'type-graphql'
import { InfinibayContext } from '../../utils/context'
import { Can } from '@main/permissions'

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
  @Can('system:view')
  async dataVersions (
    @Ctx() ctx: InfinibayContext
  ): Promise<DataVersions> {
    const { prisma } = ctx
    try {
      // The USER preset holds system:view@ANY, so any end user can poll this
      // fingerprint. But USER is narrowed to vm:view@OWN and user:view@OWN
      // everywhere else, so bare instance-wide aggregates would leak the global
      // VM/user counts (and a lastUpdated polling side-channel) to own-scoped
      // callers. Scope the two narrowed entities to the caller's visible rows so
      // the fingerprint tracks exactly what they can otherwise see. ANY-scope
      // holders (admins) get {} → global counts, unchanged. department/
      // application/appSettings stay global because USER already holds :view@ANY.
      const [vmWhere, userWhere] = await Promise.all([
        ctx.scopedWhere!('vm:view'),
        // Users are non-department resources (see LOADERS.user, departmentId=null):
        // a user "owns" its own row via `id`, and DEPARTMENT scope falls back to
        // own-row, so map both owner and dept fields to `id`.
        ctx.scopedWhere!('user:view', {}, { ownerField: 'id', deptField: 'id' })
      ])

      // Get both count and maximum updatedAt for each entity type
      // This creates a comprehensive version fingerprint that detects all changes
      const [vmStats, departmentStats, applicationStats, userStats, appSettingsStats] = await Promise.all([
        // Machine - count and max updatedAt (scoped to the caller's visible VMs)
        prisma.machine.aggregate({
          where: vmWhere,
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
        // User - count and max updatedAt (scoped to the caller's visible users)
        prisma.user.aggregate({
          where: userWhere,
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
      logger.error('Error fetching data versions:', error)

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
