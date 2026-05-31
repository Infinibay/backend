import logger from '@main/logger'
import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from 'type-graphql'
import { ApplicationType, CreateApplicationInputType } from './type'
import { InfinibayContext } from '@main/utils/context'
import { Application } from '@prisma/client'
import { getEventManager } from '../../../services/EventManager'
import { assertCanAccessResource } from '../../utils/auth'

@Resolver()
export class ApplicationQueries {
  @Query(() => [ApplicationType])
  @Authorized('USER')
  async applications (
    @Ctx() context: InfinibayContext
  ): Promise<Application[]> {
    await assertCanAccessResource(context, 'applications')
    const { prisma } = context
    return prisma.application.findMany()
  }

  @Query(() => ApplicationType, { nullable: true })
  @Authorized('USER')
  async application (
    @Arg('id') id: string,
    @Ctx() context: InfinibayContext
  ): Promise<Application | null> {
    await assertCanAccessResource(context, 'applications')
    const { prisma } = context
    return prisma.application.findUnique({
      where: { id }
    })
  }
}

@Resolver()
export class ApplicationMutations {
  @Mutation(() => ApplicationType)
  @Authorized('ADMIN')
  async createApplication (
    @Arg('input') input: CreateApplicationInputType,
    @Ctx() context: InfinibayContext
  ): Promise<Application> {
    await assertCanAccessResource(context, 'applications')
    const { prisma, user } = context
    const application = await prisma.application.create({
      data: {
        name: input.name,
        description: input.description,
        os: input.os,
        installCommand: input.installCommand,
        parameters: input.parameters
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
  @Authorized('ADMIN')
  async updateApplication (
    @Arg('id') id: string,
    @Arg('input') input: CreateApplicationInputType,
    @Ctx() context: InfinibayContext
  ): Promise<Application> {
    await assertCanAccessResource(context, 'applications')
    const { prisma, user } = context
    const application = await prisma.application.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        os: input.os,
        installCommand: input.installCommand,
        parameters: input.parameters
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
  @Authorized('ADMIN')
  async deleteApplication (
    @Arg('id') id: string,
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    await assertCanAccessResource(context, 'applications')
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
