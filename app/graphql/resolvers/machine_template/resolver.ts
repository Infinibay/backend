import { PrismaClient } from '@prisma/client'
import {
  Arg,
  Authorized,
  Mutation,
  Query,
  Resolver,
} from "type-graphql"
import { Ctx } from 'type-graphql';
import { InfinibayContext } from "@utils/context";
import { UserInputError } from 'apollo-server-errors'
import { MachineTemplateType, MachineTemplateOrderBy, MachineTemplateInputType } from './type'
import { PaginationInputType } from '@utils/pagination'

export interface MachineTemplateResolverInterface {
  machineTemplates(pagination: PaginationInputType, orderBy: MachineTemplateOrderBy, ctx: InfinibayContext): Promise<MachineTemplateType[]>
  createMachineTemplate(input: MachineTemplateInputType, ctx: InfinibayContext): Promise<MachineTemplateType>
  updateMachineTemplate(id: string, input: MachineTemplateInputType, ctx: InfinibayContext): Promise<MachineTemplateType>
}

const MAX_CORES = 64;
const MIN_CORES = 1;
const MAX_RAM = 512;
const MIN_RAM = 1;
const MAX_STORAGE = 1024;
const MIN_STORAGE = 1;

@Resolver(_of => MachineTemplateType)
export class MachineTemplateResolver implements MachineTemplateResolverInterface {
  /**
   * Retrieves a machine template by id.
   *
   * @param {string} id - The id of the machine template.
   * @param {InfinibayContext} ctx - The Infinibay context.
   *
   * @returns {Promise<MachineTemplateType | null>} The machine template object or null if not found.
   */
  @Query(() => MachineTemplateType, { nullable: true })
  @Authorized('ADMIN')
  async machineTemplate(
    @Arg('id', { nullable: false }) id: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType | null> {
    const machineTemplate = await ctx.prisma.machineTemplate.findUnique({
      where: { id },
      include: { category: true }
    })
    return machineTemplate;
  }

  /**
   * Retrieves the machine templates with pagination and order by options.
   *
   * @param {PaginationInputType} pagination - The pagination input options.
   * @param {MachineTemplateOrderBy} orderBy - The ordering options for machine templates.
   * @param {InfinibayContext} ctx - The context object containing the Prisma instance.
   * @returns {Promise<MachineTemplateType[]>} - An array of machine template objects.
   */
  @Query(() => [MachineTemplateType])
  @Authorized('ADMIN')
  async machineTemplates(
    @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
    @Arg('orderBy', { nullable: true }) orderBy: MachineTemplateOrderBy,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType[]> {
    const { prisma } = ctx
    const order = this.resolveOrder(orderBy)
    const skip = this.resolveSkip(pagination)
    const take = this.resolveTake(pagination)

    const machineTemplates = await prisma.machineTemplate.findMany({
      orderBy: order,
      skip,
      take,
      include: { category: true }
    });

    return machineTemplates;
  }

  private resolveOrder(orderBy: MachineTemplateOrderBy) {
    if (orderBy && orderBy.fieldName && orderBy.direction) {
      return {
        [orderBy.fieldName as keyof MachineTemplateType]: orderBy.direction
      };
    }
    return undefined;
  }

  private resolveSkip(pagination: PaginationInputType) {
    return pagination && pagination.skip ? pagination.skip : 0;
  }

  private resolveTake(pagination: PaginationInputType) {
    return pagination && pagination.take ? pagination.take : 20;
  }

  /**
   * Create a machine template
   *
   * @param {MachineTemplateInputType} input - The input object for creating a machine template
   * @param {InfinibayContext} ctx - The context object for the session
   *
   * @throws {UserInputError} - If the machine template already exists, or if the cores, RAM, or storage is out of range
   *
   * @returns {Promise<MachineTemplateType>} - The created machine template
   */
  @Mutation(() => MachineTemplateType)
  @Authorized('ADMIN')
  async createMachineTemplate(
    @Arg('input', { nullable: false }) input: MachineTemplateInputType,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType> {
    const { prisma } = ctx

    await this.checkMachineTemplateExistence(input.name, prisma);

    this.checkConstraintValidity(input.cores, MIN_CORES, MAX_CORES, "Cores must be between 1 and 64");
    this.checkConstraintValidity(input.ram, MIN_RAM, MAX_RAM, "RAM must be between 1 and 512")
    this.checkConstraintValidity(input.storage, MIN_STORAGE, MAX_STORAGE, 'Storage must be between 1 and 1024');

    const createdMachineTemplate = await prisma.machineTemplate.create({
      data: {
        name: input.name,
        description: input.description,
        cores: input.cores,
        ram: input.ram,
        storage: input.storage,
        categoryId: input.categoryId
      },
      include: { category: true }
    })

    return createdMachineTemplate as MachineTemplateType;
  }

  // Method for checking if machine template exists
  checkMachineTemplateExistence = async (name: string, prisma: PrismaClient) => {
    const existingTemplate = await prisma.machineTemplate.findFirst({
      where: { name }
    })
    if (existingTemplate) {
      throw new UserInputError('Machine template already exists')
    }
  }

  // Method for verifying the constraints on cores, RAM, and storage
  checkConstraintValidity(value: number, min: number, max: number, errorMsg: string) {
    if (value < min || value > max) {
      throw new UserInputError(errorMsg);
    }
  }

  /**
   * Updates a machine template with the specified ID.
   *
   * @param {string} id - The ID of the machine template to update. (Required)
   * @param {MachineTemplateInputType} input - The updated information of the machine template. (Required)
   * @param {InfinibayContext} ctx - The context object containing the Prisma client. (Required)
   * @returns {Promise<MachineTemplateType>} - The updated machine template.
   * @throws {UserInputError} - If the machine template with the specified ID is not found.
   */
  @Mutation(() => MachineTemplateType)
  @Authorized('ADMIN')
  async updateMachineTemplate(
    @Arg('id', { nullable: false }) id: string,
    @Arg('input', { nullable: false }) input: MachineTemplateInputType,
    @Ctx() ctx: InfinibayContext
  ): Promise<MachineTemplateType> {
    const { prisma } = ctx

    // Ensure the machine template exists before updating
    const exists = await this.machineTemplateExists(prisma, id)
    if (!exists) {
      throw new UserInputError('Machine template not found')
    }

    // Check for constraints
    this.checkConstraintValidity(input.cores, MIN_CORES, MAX_CORES, "Cores must be between 1 and 64")
    this.checkConstraintValidity(input.ram, MIN_RAM, MAX_RAM, "RAM must be between 1 and 512")
    this.checkConstraintValidity(input.storage, MIN_STORAGE, MAX_STORAGE, 'Storage must be between 1 and 1024')

    // Use a single call to update the machineTemplate, no need to update properties one-by-one
    return await this.updateMachineTemplateInDb(prisma, id, input)
  }

  machineTemplateExists = async (prisma: PrismaClient, id: string): Promise<boolean> => {
    return !!(await prisma.machineTemplate.findUnique({ where: { id } }))
  }

  updateMachineTemplateInDb = async (prisma: PrismaClient, id: string, input: MachineTemplateInputType): Promise<MachineTemplateType> => {
    return await prisma.machineTemplate.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        cores: input.cores,
        ram: input.ram,
        storage: input.storage,
        categoryId: input.categoryId
      },
      include: { category: true }
    })
  }
}
