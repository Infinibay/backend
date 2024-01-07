import {
    Arg,
    Authorized,
    Mutation,
    ObjectType,
    Query,
    Resolver,
    Ctx,
  } from "type-graphql"
import { v4 as uuidv4 } from 'uuid';
import { UserInputError } from 'apollo-server-errors'
import { Machine, MachineConfigurationType, VncConfigurationType, MachineOrderBy, CreateMachineInputType } from './type'
import { PaginationInputType } from '@utils/pagination'
import { InfinibayContext } from '@main/utils/context'
import { VirtManager } from '@utils/VirtManager'
import { Machine as PrismaMachine } from '@prisma/client'
import { Libvirt } from '@utils/libvirt'

export interface MachineResolverInterface {
    machine: (id: string, ctx: InfinibayContext) => Promise<Machine | null>
    machines: (pagination: PaginationInputType, orderBy: MachineOrderBy, ctx: InfinibayContext) => Promise<Machine[]>
    vncConnection: (id: string, ctx: InfinibayContext) => Promise<VncConfigurationType | null>
    createMachine: (input: CreateMachineInputType, ctx: InfinibayContext) => Promise<Machine>
}

@Resolver(Machine)
export class MachineResolver implements MachineResolverInterface {
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
        @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
        @Arg('orderBy', { nullable: true }) orderBy: MachineOrderBy,
        @Ctx() context: InfinibayContext
    ): Promise<Machine[]> {
        const prisma = context.prisma
        const role = context.user?.role
        const order = { [(orderBy?.fieldName ?? 'createdAt') as string]: orderBy?.direction ?? 'desc' }
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
    @Authorized('ADMIN')
    async createMachine(
        @Arg('input') input: CreateMachineInputType,
        @Ctx() context: InfinibayContext
    ): Promise<Machine> {
        const prisma = context.prisma
        const user = context.user
        let machine: PrismaMachine = {} as PrismaMachine
        // Validate everything
        // TODO: Validate the input

        await prisma.$transaction(async (tx: any) => {

            const internalName = uuidv4()
        
            // Create the machine
            machine = await tx.machine.create({
                data: {
                    name: input.name,
                    userId: user?.id,
                    status: 'building',
                    os: input.os,
                    templateId: input.templateId,
                    internalName: internalName,
                }
            })
            if (!machine) {
                throw new Error("Machine not created")
            }

            // Create Machine-Application relationship
            for (const application of input.applications) {
                let app = await tx.machineApplication.create({
                    data: {
                        machineId: machine.id,
                        applicationId: application.applicationId
                    }
                })
                if (!app) {
                    throw new Error("Machine-Application relationship not created")
                }
            }

            // Create MachineConfiguration
            const configuration = await tx.machineConfiguration.create({
                data: {
                    machineId: machine.id,
                    vncPort: 0,
                    vncListen: '0.0.0.0',
                    vncPassword: null,
                    vncAutoport: false,
                }
            })

            if (!configuration) {
                throw new Error("MachineConfiguration not created")
            }

        }, { timeout: 20000 });

        if (!machine) {
            throw new Error("Machine not created")
        }

        setImmediate(() => {
            this.backgroundCode(machine.id, context, input.username, input.password, input.productKey);
        });

        return {
            ...machine
        } as unknown as Machine // WARNING!! typescript type-check bypassed
    }

    @Query(() => VncConfigurationType, { nullable: true })
    @Authorized('USER')
    async vncConnection(
        @Arg('id') id: string,
        @Ctx() context: InfinibayContext
    ): Promise<VncConfigurationType | null> {
        const prisma = context.prisma
        const role = context.user?.role
        const libvirt = new Libvirt()
        let machine: PrismaMachine | null = null

        if (role == 'ADMIN') {
             machine = await prisma.machine.findUnique({
                where: { id },
                include: { configuration: true },
            });
        } else {
            const machine = await prisma.machine.findFirst({
                where: {
                    id,
                    userId: context.user?.id
                },
                include: { configuration: true },
            });
        }

        if (!machine) {
            return null
        }

        const configuration = await prisma.machineConfiguration.findUnique({
            where: {
                machineId: id
            }
        })

        if (!configuration) {
            return null
        }
        libvirt.connect('qemu:///system')
        const port = await libvirt.getVncPort(machine.internalName)

        if (machine && machine.userId == context.user?.id) {
            return {
                link: `vnc://${configuration?.vncHost}:${port}`,
                password: configuration?.vncPassword || ''
            } || null;
        } else {
            return null;
        }
    }

    backgroundCode = async (id: string, context: InfinibayContext, username: string, password: string, productKey: string) => {
        try {
            const machine = await context.prisma.machine.findUnique({
                where: {
                    id
                }
            })
            // User VirtManager and create the machine
            const virtManager = new VirtManager()
            virtManager.setPrisma(context.prisma)
            await virtManager.createMachine(machine as any, username, password, productKey)
        
            // VirtManager to power on the machine
            await virtManager.powerOn(machine?.internalName as string)
        } catch (error) {
            console.log("Error creating machine in background job")
            console.log(error)
        }
    }

    
}

