import { PrismaClient } from '@prisma/client'
import {
    Arg,
    Authorized,
    FieldResolver,
    Int,
    Mutation,
    Query,
    Resolver,
    Root,
  } from "type-graphql"
import { UserInputError, AuthenticationError } from 'apollo-server-errors'
import { MachineTemplate, MachineTemplateOrderBy } from './type'
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
    @Query()
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
        @Arg('name', { nullable: false }) name: string,
        @Arg('cores', { nullable: false }) cores: number,
        @Arg('ram', { nullable: false }) ram: number,
        @Arg('storage', { nullable: false }) storage: number,
    ): Promise<MachineTemplate> {
        const prisma = new PrismaClient()
        // Check if the machine template already exists
        const machineTemplate = await prisma.machineTemplate.findFirst({
            where: {
                name
            }
        })
        if (machineTemplate) {
            throw new UserInputError('Machine template already exists')
        }
        if (cores < 1 || cores > 64) {
            throw new UserInputError('Cores must be between 1 and 64')
        }
        if (ram < 1 || ram > 512) {
            throw new UserInputError('RAM must be between 1 and 512')
        }
        if (storage < 1 || storage > 1024) {
            throw new UserInputError('Storage must be between 1 and 1024')
        }
        const createdMachineTemplate = await prisma.machineTemplate.create({
            data: {
                name,
                cores,
                ram,
                storage
            }
        })
        return createdMachineTemplate
    }
}

