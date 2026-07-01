import logger from '@main/logger'
import { Arg, Ctx, Mutation, Query, Resolver } from 'type-graphql'
import { ApplicationType, CreateApplicationInputType } from './type'
import { InfinibayContext } from '@main/utils/context'
import { Application, Prisma } from '@prisma/client'
import { getEventManager } from '../../../services/EventManager'
import { Can } from '@main/permissions'

@Resolver()
export class ApplicationQueries {
  @Query(() => [ApplicationType])
  @Can('application:view')
  async applications (
    @Ctx() context: InfinibayContext
  ): Promise<Application[]> {
    const { prisma } = context
    return prisma.application.findMany()
  }

  @Query(() => ApplicationType, { nullable: true })
  @Can('application:view', { id: (a) => a.id })
  async application (
    @Arg('id') id: string,
    @Ctx() context: InfinibayContext
  ): Promise<Application | null> {
    const { prisma } = context
    return prisma.application.findUnique({
      where: { id }
    })
  }
}

@Resolver()
export class ApplicationMutations {
  @Mutation(() => ApplicationType)
  @Can('application:create')
  async createApplication (
    @Arg('input') input: CreateApplicationInputType,
    @Ctx() context: InfinibayContext
  ): Promise<Application> {
    const { prisma, user } = context
    const application = await prisma.application.create({
      data: {
        name: input.name,
        description: input.description,
        os: input.os,
        installCommand: input.installCommand,
        // `parameters` is a required (non-nullable) Json column; Prisma rejects a
        // plain JS `null`, so coalesce an omitted value to the DB null sentinel.
        parameters: (input.parameters ?? Prisma.JsonNull) as Prisma.InputJsonValue
      }
    })

    // Trigger real-time event for application creation
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('applications', 'create', { id: application.id }, user?.id)
      logger.info(`🎯 Triggered real-time event: applications:create for application ${application.id}`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return application
  }

  @Mutation(() => ApplicationType)
  @Can('application:edit', { id: (a) => a.id })
  async updateApplication (
    @Arg('id') id: string,
    @Arg('input') input: CreateApplicationInputType,
    @Ctx() context: InfinibayContext
  ): Promise<Application> {
    const { prisma, user } = context
    const application = await prisma.application.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        os: input.os,
        installCommand: input.installCommand,
        // `parameters` is a required (non-nullable) Json column; Prisma rejects a
        // plain JS `null`, so coalesce an omitted value to the DB null sentinel.
        parameters: (input.parameters ?? Prisma.JsonNull) as Prisma.InputJsonValue
      }
    })

    // Trigger real-time event for application update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('applications', 'update', { id }, user?.id)
      logger.info(`🎯 Triggered real-time event: applications:update for application ${id}`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return application
  }

  @Mutation(() => Boolean)
  @Can('application:delete', { id: (a) => a.id })
  async deleteApplication (
    @Arg('id') id: string,
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const { prisma, user } = context
    try {
      await prisma.application.delete({
        where: { id }
      })

      // Trigger real-time event for application deletion
      try {
        const eventManager = getEventManager()
        await eventManager.dispatchEvent('applications', 'delete', { id }, user?.id)
        logger.info(`🎯 Triggered real-time event: applications:delete for application ${id}`)
      } catch (eventError) {
        logger.error('Failed to trigger real-time event:', eventError)
        // Don't fail the main operation if event triggering fails
      }

      return true
    } catch (error) {
      logger.error(error)
      return false
    }
  }
}
