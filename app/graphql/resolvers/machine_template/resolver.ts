import { PrismaClient } from '@prisma/client'
import {
    Arg,
    Authorized,
    Mutation,
    Query,
    Resolver,
  } from "type-graphql"
import { UserInputError } from 'apollo-server-errors'
import { MachineTemplate, MachineTemplateOrderBy, CreateMachineTemplateInputType } from './type'
import { PaginationInputType } from '@utils/pagination'

export interface MachineTemplateResolver {
    machineTemplates(pagination: PaginationInputType, orderBy: MachineTemplateOrderBy): Promise<MachineTemplate[]>
}

@Resolver(MachineTemplate)
export class MachineTemplateResolver implements MachineTemplateResolver {
    /*
    machineTemplate
        @args
        id: ID!
    ): Promise<MachineTemplate | null>
    */
    @Query(() => MachineTemplate, { nullable: true })
    @Authorized('ADMIN')
    async machineTemplate(
        @Arg('id', { nullable: false }) id: string
    ): Promise<MachineTemplate | null> {
        const prisma = new PrismaClient()
        const machineTemplate = await prisma.machineTemplate.findUnique({
            where: {
                id
            }
        })
        return machineTemplate
    }

    /*
    machineTemplate query
    Args:
        Pagination args
        OrderBy args
    Return all the machine templates
    */
    @Query(() => [MachineTemplate])
    @Authorized('ADMIN')
    async machineTemplates(
        @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
        @Arg('orderBy', { nullable: true }) orderBy: MachineTemplateOrderBy,
    ): Promise<MachineTemplate[]> {
        const prisma = new PrismaClient()
        const order = orderBy ? {
            [orderBy.fieldName as keyof MachineTemplate]: orderBy.direction
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

    /*
    createMachineTemplate Mutation
    Args:
        name: String!
        cores: Int!
        ram: Int!
        storage: Int!
    Return the created machine template 
    */
    @Mutation(() => MachineTemplate)
    @Authorized('ADMIN')
    async createMachineTemplate(
        @Arg('input', { nullable: false }) input: CreateMachineTemplateInputType,
    ): Promise<MachineTemplate> {
        const prisma = new PrismaClient()
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
        return createdMachineTemplate
    }

    /*
    updateMachineTemplate
    @Args
        id: ID!
        name: String
        cores: Int
        ram: Int
        storage: Int
    Return the updated machine template
    */
    @Mutation(() => MachineTemplate)
    @Authorized('ADMIN')
    async updateMachineTemplate(
        @Arg('id', { nullable: false }) id: string,
        @Arg('input', { nullable: false }) input: CreateMachineTemplateInputType
    ): Promise<MachineTemplate> {
        const prisma = new PrismaClient()
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

