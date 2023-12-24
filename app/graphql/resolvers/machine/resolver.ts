import {
    Arg,
    Authorized,
    Mutation,
    ObjectType,
    Query,
    Resolver,
    Ctx,
  } from "type-graphql"
import { UserInputError } from 'apollo-server-errors'
import { Machine, MachineOrderBy, CreateMachineInputType } from './type'
import { PaginationInputType } from '@utils/pagination'
import { InfinibayContext } from '@main/utils/context'

export interface MachineResolverI {
    machine: (id: string, ctx: InfinibayContext) => Promise<Machine | null>
    machines: (pagination: PaginationInputType, orderBy: MachineOrderBy, ctx: InfinibayContext) => Promise<Machine[]>
    createMachine: (input: CreateMachineInputType, ctx: InfinibayContext) => Promise<Machine>
}

@Resolver(Machine)
export class MachineResolver implements MachineResolverI {
    @Query(() => Machine, { nullable: true })
    @Authorized('USER')
    async machine(
        @Arg('id') id: string,
        @Ctx() context: InfinibayContext
    ): Promise<Machine | null> {
        const prisma = context.prisma
        /*
        If the user has the user role, only has access to his own vm. If it's an admin, can access al the vms.
        */
        const role = context.user?.role
        if (role == 'ADMIN') {
            return await prisma.machine.findUnique({
                where: {
                    id
                }
            }) as Machine | null
        } else {
            const machine = await prisma.machine.findFirst({
                where: {
                    id,
                    userId: context.user?.id
                }
            }) as Machine | null

            if (machine && machine.userId == context.user?.id) {
                return machine
            } else {
                return null
            }
        }
    }

    @Query(() => [Machine])
    @Authorized('USER')
    async machines(
        @Arg('pagination') pagination: PaginationInputType,
        @Arg('orderBy') orderBy: MachineOrderBy,
        @Ctx() context: InfinibayContext
    ): Promise<Machine[]> {
        const prisma = context.prisma
        const role = context.user?.role
        const order = { [(orderBy.fieldName as string)]: orderBy.direction }
        if (role == 'ADMIN') {
            return await prisma.machine.findMany({
                ...pagination,
                orderBy: [{...order}]
            }) as Machine[] | []
        } else {
            return await prisma.machine.findMany({
                ...pagination,
                orderBy: [{...order}],
                where: {
                    userId: context.user?.id
                }
            }) as Machine[] | []
        }
    }

    @Mutation(() => Machine)
    @Authorized('USER')
    async createMachine(
        @Arg('input') input: CreateMachineInputType,
        @Ctx() context: InfinibayContext
    ): Promise<Machine> {
        const prisma = context.prisma
        const user = context.user

        return {} as Machine
    }
}

