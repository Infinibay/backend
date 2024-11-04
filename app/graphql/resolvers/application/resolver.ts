import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from 'type-graphql';
import { ApplicationType, CreateApplicationInputType } from './type';
import { InfinibayContext } from '@main/utils/context';
import { Application } from '@prisma/client';

@Resolver()
export class ApplicationQueries {
  @Query(() => [ApplicationType])
  @Authorized('USER')
  async applications(
    @Ctx() { prisma }: InfinibayContext
  ): Promise<Application[]> {
    return prisma.application.findMany();
  }

  @Query(() => ApplicationType, { nullable: true })
  @Authorized('USER')
  async application(
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<Application | null> {
    return prisma.application.findUnique({
      where: { id }
    });
  }
}

@Resolver()
export class ApplicationMutations {
  @Mutation(() => ApplicationType)
  @Authorized('ADMIN')
  async createApplication(
    @Arg('input') input: CreateApplicationInputType,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<Application> {
    return prisma.application.create({
      data: {
        name: input.name,
        description: input.description,
        os: input.os,
        installCommand: input.installCommand,
        parameters: input.parameters
      }
    });
  }

  @Mutation(() => ApplicationType)
  @Authorized('ADMIN')
  async updateApplication(
    @Arg('id') id: string,
    @Arg('input') input: CreateApplicationInputType,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<Application> {
    return prisma.application.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        os: input.os,
        installCommand: input.installCommand,
        parameters: input.parameters
      }
    });
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteApplication(
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    try {
      await prisma.application.delete({
        where: { id }
      });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}
