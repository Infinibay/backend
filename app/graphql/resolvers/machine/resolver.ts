import {
    Arg,
    Authorized,
    Mutation,
    ObjectType,
    Query,
    Resolver,
    Ctx,
  } from "type-graphql"
import fs from 'fs'
import { v4 as uuidv4 } from 'uuid';
import { UserInputError } from 'apollo-server-errors'
import { Machine, VncConfigurationType, MachineOrderBy, CreateMachineInputType, SuccessType} from './type'
import { PaginationInputType } from '@utils/pagination'
import { InfinibayContext } from '@main/utils/context'
import { VirtManager } from '@utils/VirtManager'
import { Machine as PrismaMachine } from '@prisma/client'
import { Libvirt } from '@utils/libvirt'
// xmlGenerator
import { XMLGenerator } from '@utils/VirtManager/xmlGenerator'

export interface MachineResolverInterface {
    machine: (id: string, ctx: InfinibayContext) => Promise<Machine | null>
    machines: (pagination: PaginationInputType, orderBy: MachineOrderBy, ctx: InfinibayContext) => Promise<Machine[]>
    vncConnection: (id: string, ctx: InfinibayContext) => Promise<VncConfigurationType | null>
    createMachine: (input: CreateMachineInputType, ctx: InfinibayContext) => Promise<Machine>
    powerOn: (id: string, ctx: InfinibayContext) => Promise<SuccessType>
    powerOff: (id: string, ctx: InfinibayContext) => Promise<SuccessType>
    suspend: (id: string, ctx: InfinibayContext) => Promise<SuccessType>
    destroyMachine: (id: string, ctx: InfinibayContext) => Promise<SuccessType>
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

    @Mutation(() => SuccessType)
    @Authorized('USER')
    async powerOn(
        @Arg('id') id: string,
        @Ctx() context: InfinibayContext
    ): Promise<SuccessType> {
        const prisma = context.prisma
        const role = context.user?.role
        const libvirt = new Libvirt()
        libvirt.connect("qemu:///system")
        if (!libvirt.isConnected()) {
            return {
                success: false,
                message: "Libvirt not connected"
            }
        }
        let machine: PrismaMachine | null = null

        if (role == 'ADMIN') {
             machine = await prisma.machine.findUnique({
                where: { id },
                include: { configuration: true },
            });
        } else {
            machine = await prisma.machine.findFirst({
                where: {
                    id,
                    userId: context.user?.id
                },
                include: { configuration: true },
            });
        }
        if (!machine) {
            return {
                success: false,
                message: "Machine not found"
            }
        }
        try {
            libvirt.powerOn(machine.internalName)
        } catch (error) {
            return {
                success: false,
                message: "Error powering on machine"
            }
        }
        return {
            success: true,
            message: "Machine powered on"
        }   
    }

    @Mutation(() => SuccessType)
    @Authorized('USER')
    async powerOff(
        @Arg('id') id: string,
        @Ctx() context: InfinibayContext
    ): Promise<SuccessType> {
        const prisma = context.prisma
        const role = context.user?.role
        const libvirt = new Libvirt()
        libvirt.connect("qemu:///system")
        if (!libvirt.isConnected()) {
            return {
                success: false,
                message: "Libvirt not connected"
            }
        }
        let machine: PrismaMachine | null = null

        if (role == 'ADMIN') {
             machine = await prisma.machine.findUnique({
                where: { id },
                include: { configuration: true },
            });
        } else {
            machine = await prisma.machine.findFirst({
                where: {
                    id,
                    userId: context.user?.id
                },
                include: { configuration: true },
            });
        }
        if (!machine) {
            return {
                success: false,
                message: "Machine not found"
            }
        }
        try {
            libvirt.powerOff(machine.internalName)
        } catch (error) {
            return {
                success: false,
                message: "Error powering off machine"
            }
        }
        return {
            success: true,
            message: "Machine powered off"
        }
    }

    @Mutation(() => SuccessType)
    @Authorized('USER')
    async suspend(
        @Arg('id') id: string,
        @Ctx() context: InfinibayContext
    ): Promise<SuccessType> {
        const prisma = context.prisma
        const role = context.user?.role
        const libvirt = new Libvirt()
        libvirt.connect("qemu:///system")
        if (!libvirt.isConnected()) {
            return {
                success: false,
                message: "Libvirt not connected"
            }
        }
        let machine: PrismaMachine | null = null

        if (role == 'ADMIN') {
             machine = await prisma.machine.findUnique({
                where: { id },
                include: { configuration: true },
            });
        } else {
            machine = await prisma.machine.findFirst({
                where: {
                    id,
                    userId: context.user?.id
                },
                include: { configuration: true },
            });
        }
        if (!machine) {
            return {
                success: false,
                message: "Machine not found"
            }
        }
        return {
            success: true,
            message: "Machine suspended"
        }
    }

    @Mutation(() => SuccessType)
    @Authorized('USER')
    async destroyMachine(
        @Arg('id') id: string,
        @Ctx() context: InfinibayContext
    ): Promise<SuccessType> {
        const prisma = context.prisma
        const role = context.user?.role
        const libvirt = new Libvirt()
        libvirt.connect("qemu:///system")
        if (!libvirt.isConnected()) {
            return {
                success: false,
                message: "Libvirt not connected"
            }
        }
        let machine: PrismaMachine | null = null

        if (role == 'ADMIN') {
            machine = await prisma.machine.findUnique({
                where: { id },
                include: { configuration: true },
            });
        } else {
            machine = await prisma.machine.findFirst({
                where: {
                    id,
                    userId: context.user?.id
                },
                include: { configuration: true },
            });
        }
        if (!machine) {
            return {
                success: false,
                message: "Machine not found"
            }
        }
        try {
            // Get machine configuration
            const configuration = await prisma.machineConfiguration.findUnique({
                where: {
                    machineId: machine.id
                }
            })
            if (!configuration) {
                throw new Error("MachineConfiguration not found")
            }
            const xmlGenerator = new XMLGenerator('', '')
            xmlGenerator.load(configuration.xml as any)
            
            const uefiVarFile : any = xmlGenerator.getUefiVarFile()
            if (!uefiVarFile || uefiVarFile == '' || !fs.existsSync(uefiVarFile)) {
                throw new Error("UEFI VAR file not found in the xml configuration")
            }

            // Remove the uefi file
            // Assuming the uefi file path is stored in machine.uefiFilePath
            fs.unlinkSync(uefiVarFile as string)

            // Remove the disk file
            // Assuming the disk file path is stored in machine.diskFilePath
            const diskFiles = xmlGenerator.getDisks()
            for (const diskFile of diskFiles) {
                if (!fs.existsSync(diskFile)) {
                    console.log(`Disk file ${diskFile} not found`)
                    continue
                }
                fs.unlinkSync(diskFile)
            }

            // stop the vm
            libvirt.powerOff(machine.internalName)

            // Destroy the machine in the hypervisor
            libvirt.domainUndefine(machine.internalName)

            // Remove the machine from the database
            await prisma.machine.delete({
                where: { id: machine.id },
            });
        } catch (error) {
            return {
                success: false,
                message: "Error destroying machine"
            }
        }
        return {
            success: true,
            message: "Machine destroyed"
        }
    }

}
