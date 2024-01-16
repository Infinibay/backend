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
    // deleteMachineTemplate(id: string): Promise<MachineTemplateType>
}

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
            where: {
                id
            }
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
        const order = orderBy ? {
            [orderBy.fieldName as keyof MachineTemplateType]: orderBy.direction
        } : undefined
        const skip = pagination ? pagination.skip : 0
        const take = pagination ? pagination.take : 20
        const machineTemplates = await prisma.machineTemplate.findMany({
            orderBy: order,
            skip,
            take
        })
        return machineTemplates
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
        const  { prisma } = ctx
        // Check if the machine template already exists
        const machineTemplate = await prisma.machineTemplate.findFirst({
            where: {
                name: input.name
            }
        })
        if (machineTemplate) {
            throw new UserInputError('Machine template already exists')
        }
        if (input.cores < 1 || input.cores > 64) {
            throw new UserInputError('Cores must be between 1 and 64')
        }
        if (input.ram < 1 || input.ram > 512) {
            throw new UserInputError('RAM must be between 1 and 512')
        }
        if (input.storage < 1 || input.storage > 1024) {
            throw new UserInputError('Storage must be between 1 and 1024')
        }
        const createdMachineTemplate = await prisma.machineTemplate.create({
            data: {
                name: input.name,
                cores: input.cores,
                ram: input.ram,
                storage: input.storage
            }
        })
        return  {
            id: createdMachineTemplate.id,
            name: createdMachineTemplate.name,
            cores: createdMachineTemplate.cores,
            ram: createdMachineTemplate.ram,
            storage: createdMachineTemplate.storage,
            description: createdMachineTemplate.description,
            createdAt: createdMachineTemplate.createdAt,
        } as MachineTemplateType
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
        const machineTemplate = await prisma.machineTemplate.findUnique({
            where: {
                id
            }
        })
        if (!machineTemplate) {
            throw new UserInputError('Machine template not found')
        }
        if (input.name) {
            machineTemplate.name = input.name
        }
        if (input.cores) {
            machineTemplate.cores = input.cores
        }
        if (input.ram) {
            machineTemplate.ram = input.ram
        }
        if (input.storage) {
            machineTemplate.storage = input.storage
        }
        const updatedMachineTemplate = await prisma.machineTemplate.update({
            where: {
                id
            },
            data: {
                name: machineTemplate.name,
                cores: machineTemplate.cores,
                ram: machineTemplate.ram,
                storage: machineTemplate.storage
            }
        })
        return updatedMachineTemplate
    }
}

