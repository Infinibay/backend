import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from "type-graphql";
import { UserInputError } from "apollo-server-core";
import { unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import {
    Machine,
    MachineOrderBy,
    CreateMachineInputType,
    GraphicConfigurationType,
    SuccessType,
    MachineStatus,
    MachineConfigurationType,
    CommandExecutionResponseType,
} from './type';
import { UserType } from '../user/type';
import { MachineTemplateType } from '../machine_template/type';
import { PaginationInputType } from '@utils/pagination';
import { InfinibayContext } from '@main/utils/context';
import { VirtManager } from '@utils/VirtManager';
import { GraphicPortService } from '@utils/VirtManager/graphicPortService';
import { Connection, Machine as VirtualMachine, Error, NwFilter } from 'libvirt-node';
import { Debugger } from '@utils/debug';
import { XMLGenerator } from '@utils/VirtManager/xmlGenerator';
import { existsSync } from 'fs';
import { execute } from "graphql";

async function transformMachine(prismaMachine: any, prisma: any): Promise<Machine> {
    // TODO: fix n+1 problem
    const user = prismaMachine.userId ? await prisma.user.findUnique({ where: { id: prismaMachine.userId } }) : null;
    const template = prismaMachine.templateId ? await prisma.machineTemplate.findUnique({ where: { id: prismaMachine.templateId } }) : null;
    const department = prismaMachine.departmentId ? await prisma.department.findUnique({ where: { id: prismaMachine.departmentId } }) : null;
    const graphicHost = prismaMachine.configuration.graphicHost || process.env.GRAPHIC_HOST || 'localhost';
    let graphicPort;
    try {
        graphicPort = await new GraphicPortService().getGraphicPort(prismaMachine.internalName, prismaMachine.configuration.graphicProtocol);
    } catch (e) {
        console.log(e);
    }

    return {
        ...prismaMachine,
        userId: prismaMachine.userId || -1, // Add this line to include userId
        user: user ? {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt
        } as UserType : undefined,
        template: template ? {
            id: template.id,
            name: template.name,
            description: template.description,
            cores: template.cores,
            ram: template.ram,
            storage: template.storage,
            createdAt: template.createdAt
        } as MachineTemplateType : undefined,
        department: department ? {
            id: department.id,
            name: department.name,
            description: department.description,
            createdAt: department.createdAt
        } : undefined,
        config: prismaMachine.configuration ? {
            graphic: prismaMachine.configuration.graphicProtocol + "://" + prismaMachine.configuration.graphicPassword + "@" + graphicHost + ":" + graphicPort,
        } : null,
        status: prismaMachine.status as MachineStatus,
    };
}

@Resolver()
export class MachineQueries {
    private debug = new Debugger('machine-queries');

    @Query(() => Machine, { nullable: true })
    @Authorized('USER')
    async machine(
        @Arg('id') id: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<Machine | null> {
        const isAdmin = user?.role === 'ADMIN';
        const whereClause = isAdmin ? { id } : { id, userId: user?.id };
        const prismaMachine = await prisma.machine.findFirst({
            where: whereClause,
            include: { configuration: true, department: true, template: true, user: true }
        });
        return prismaMachine ? await transformMachine(prismaMachine, prisma) : null;
    }

    @Query(() => [Machine])
    @Authorized('USER')
    async machines(
        @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
        @Arg('orderBy', { nullable: true }) orderBy: MachineOrderBy,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<Machine[]> {
        const isAdmin = user?.role === 'ADMIN';
        const whereClause = isAdmin ? {} : { userId: user?.id };
        const order = { [(orderBy?.fieldName ?? 'createdAt')]: orderBy?.direction ?? 'desc' };

        const prismaMachines = await prisma.machine.findMany({
            ...pagination,
            orderBy: [order],
            where: whereClause,
            include: { configuration: true, department: true, template: true, user: true }
        });

        return Promise.all(prismaMachines.map(m => transformMachine(m, prisma)));
    }

    @Query(() => GraphicConfigurationType, { nullable: true })
    @Authorized('USER')
    async graphicConnection(
        @Arg('id') id: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<GraphicConfigurationType | null> {
        const isAdmin = user?.role === 'ADMIN';
        const whereClause = isAdmin ? { id } : { id, userId: user?.id };
        const machine = await prisma.machine.findFirst({
            where: whereClause,
            include: { configuration: true, department: true, template: true, user: true }
        });

        if (!machine || !machine.configuration) return null;

        const port = await new GraphicPortService().getGraphicPort(machine.internalName, machine.configuration.graphicProtocol || 'vnc');
        return {
            link: `${machine.configuration.graphicProtocol}://${machine.configuration.graphicHost || process.env.GRAPHIC_HOST || 'localhost'}:${port}`,
            password: machine.configuration.graphicPassword || '',
            protocol: machine.configuration.graphicProtocol || 'vnc'
        };
    }
}

@Resolver()
export class MachineMutations {
    private debug = new Debugger('machine-mutations');

    @Mutation(() => Machine)
    @Authorized('ADMIN')
    async createMachine(
        @Arg('input') input: CreateMachineInputType,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<Machine> {
        // First verify the template exists
        const template = await prisma.machineTemplate.findUnique({
            where: { id: input.templateId }
        });

        if (!template) {
            throw new UserInputError("Machine template not found");
        }

        const internalName = uuidv4();
        const machine = await prisma.$transaction(async (tx: any) => {
            ;
            // Find the Default department
            let department = null;
            if (input.departmentId) {
                department = await tx.department.findUnique({
                    where: { id: input.departmentId }
                });
            } else {
                // get the first department
                department = await tx.department.first()
            }

            if (!department) {
                throw new UserInputError("Department not found");
            }

            const createdMachine = await tx.machine.create({
                data: {
                    name: input.name,
                    userId: user?.id,
                    status: 'building',
                    os: input.os,
                    templateId: input.templateId,
                    internalName,
                    departmentId: department.id,
                    configuration: {
                        create: {
                            graphicPort: 0,
                            graphicProtocol: 'spice',
                            graphicHost: process.env.GRAPHIC_HOST || 'localhost',
                            graphicPassword: null,
                        }
                    }
                },
                include: {
                    configuration: true,
                    department: true,
                    template: true,
                    user: true
                }
            });

            if (!createdMachine) {
                throw new UserInputError("Machine not created");
            }

            // Create application associations
            // TODO: Missing parameters validation!!!!
            for (const application of input.applications) {
                await tx.machineApplication.create({
                    data: {
                        machineId: createdMachine.id,
                        applicationId: application.applicationId,
                        parameters: application.parameters
                    }
                });
            }

            return createdMachine;
        });

        setImmediate(() => {
            this.backgroundCode(machine.id, prisma, user, input.username, input.password, input.productKey, input.pciBus);
        });

        return machine;
    }

    private backgroundCode = async (id: string, prisma: any, user: any, username: string, password: string, productKey: string | undefined, pciBus: string | null) => {
        try {
            const machine = await prisma.machine.findUnique({
                where: {
                    id
                }
            });
            const virtManager = new VirtManager();
            virtManager.setPrisma(prisma);
            await virtManager.createMachine(machine as any, username, password, productKey, pciBus);
            await virtManager.powerOn(machine?.internalName as string);
            await prisma.machine.update({
                where: {
                    id
                },
                data: {
                    status: 'running'
                }
            });
        } catch (error) {
            console.log(error);
        }
    }

    @Mutation(() => SuccessType)
    @Authorized('USER')
    async powerOn(
        @Arg('id') id: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<SuccessType> {
        return this.changeMachineState(id, prisma, user, 'powerOn', 'running');
    }

    @Mutation(() => SuccessType)
    @Authorized('USER')
    async powerOff(
        @Arg('id') id: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<SuccessType> {
        return this.changeMachineState(id, prisma, user, 'shutdown', 'off');
    }

    @Mutation(() => SuccessType)
    @Authorized('USER')
    async suspend(
        @Arg('id') id: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<SuccessType> {
        return this.changeMachineState(id, prisma, user, 'suspend', 'suspended');
    }

    /**
     * Destroys a virtual machine and cleans up associated resources.
     * 
     * @param id - The ID of the machine to destroy.
     * @param prisma - The Prisma client for database operations.
     * @param user - The current user context.
     * @returns A SuccessType indicating the result of the operation.
     */
    @Mutation(() => SuccessType)
    @Authorized('USER')
    async destroyMachine(
        @Arg('id') id: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<SuccessType> {
        // Check if the user has permission to destroy this machine
        const isAdmin = user?.role === 'ADMIN';
        const whereClause = isAdmin ? { id } : { id, userId: user?.id };
        const machine = await prisma.machine.findFirst({
            where: whereClause,
            include: {
                configuration: true,
                nwFilters: {
                    include: {
                        nwFilter: true
                    }
                }
            }
        });

        if (!machine) {
            return { success: false, message: "Machine not found" };
        }

        let libvirtConnection: Connection | null = null;
        try {
            // Connect to libvirt
            libvirtConnection = Connection.open('qemu:///system');
            if (!libvirtConnection) {
                return { success: false, message: "Libvirt not connected" };
            }

            // Look up the domain (VM) by name
            const domain = VirtualMachine.lookupByName(libvirtConnection, machine.internalName);
            if (!domain) {
                return { success: false, message: "Error destroying machine. Machine not found in libvirt" };
            }

            // Attempt to forcefully stop the VM first
            try {
                await domain.destroy();
            } catch (error) {
                console.log("VM was already stopped or error stopping VM:", error);
            }

            // Load XML configuration
            const xmlGenerator = new XMLGenerator('', '', '');
            if (machine.configuration?.xml) {
                xmlGenerator.load(machine.configuration.xml);
            }

            // Prepare list of files to delete
            const filesToDelete = [
                xmlGenerator.getUefiVarFile(),
                ...xmlGenerator.getDisks()
            ].filter(file => {
                if (file && file.includes('virtio')) return false;
                return file && existsSync(file);
            });

            // Undefine network filters first
            for (const vmFilter of machine.nwFilters) {
                try {
                    const filter = await NwFilter.lookupByName(libvirtConnection, vmFilter.nwFilter.internalName);
                    if (filter) {
                        await filter.undefine();
                    }
                } catch (error) {
                    console.log(`Error undefining filter ${vmFilter.nwFilter.internalName}:`, error);
                }
            }

            // Undefine the domain
            await domain.undefine();

            // Close libvirt connection before database operations
            await libvirtConnection.close();
            libvirtConnection = null;

            // Perform database operations in a transaction
            await prisma.$transaction(async (tx) => {
                // Delete in correct order
                if (machine.configuration) {
                    await tx.machineConfiguration.delete({
                        where: { machineId: machine.id }
                    });
                }

                await tx.machineApplication.deleteMany({
                    where: { machineId: machine.id }
                });

                await tx.vMNWFilter.deleteMany({
                    where: { vmId: machine.id }
                });

                await tx.machine.delete({
                    where: { id: machine.id }
                });
            });

            // Delete files after successful database operations
            for (const file of filesToDelete) {
                try {
                    await unlink(file);
                } catch (error) {
                    console.log(`Error deleting file ${file}:`, error);
                }
            }

            return { success: true, message: "Machine destroyed" };
        } catch (error) {
            console.error("Error in destroyMachine:", error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            return { success: false, message: `Error destroying machine: ${errorMessage}` };
        } finally {
            if (libvirtConnection) {
                try {
                    await libvirtConnection.close();
                } catch (error) {
                    console.error("Error closing libvirt connection:", error);
                }
            }
        }
    }

    /**
     * Executes a command inside a virtual machine.
     * 
     * @param id - The ID of the machine to execute the command.
     * @param command - The command to execute inside the VM.
     * @param prisma - The Prisma client for database operations.
     * @param user - The current user context.
     * @returns A CommandExecutionResponseType indicating the result of the operation along with the command response.
     */
    @Mutation(() => CommandExecutionResponseType)
    @Authorized('ADMIN')
    async executeCommand(
        @Arg('id') id: string,
        @Arg('command') command: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<CommandExecutionResponseType> {
        let libvirtConnection: Connection | null = null;
        try {
            // Retrieve the machine from the database
            const machine = await prisma.machine.findFirst({ where: { id } });
            if (!machine) {
                return { success: false, message: "Machine not found" };
            }

            // Establish connection to libvirt
            libvirtConnection = Connection.open('qemu:///system');
            if (!libvirtConnection) {
                throw new UserInputError("Libvirt not connected");
            }

            // Look up the virtual machine (domain) in libvirt
            const domain = VirtualMachine.lookupByName(libvirtConnection, machine.internalName);
            if (!domain) {
                throw new UserInputError(`Machine ${machine.internalName} not found in libvirt`);
            }
            const jsonCommand = {
                execute: command
            }

            // Execute the command inside the VM
            const result = await domain.qemuAgentCommand(JSON.stringify(jsonCommand), 0, 0);
            if (!result) {
                throw new UserInputError(`Error executing command: ${command}`);
            }

            return { success: true, message: `Command executed successfully`, response: result };
        } catch (error) {
            // Log the error and return a failure response
            this.debug.log(`Error executing command: ${error}`);
            return { success: false, message: (error as Error).message || `Error executing command` };
        } finally {
            // Ensure the libvirt connection is closed, even if an error occurred
            if (libvirtConnection) {
                libvirtConnection.close();
            }
        }
    }

    /**
     * Changes the state of a virtual machine.
     * 
     * @param id - The ID of the machine to change state.
     * @param prisma - The Prisma client for database operations.
     * @param user - The user requesting the state change.
     * @param action - The action to perform: 'powerOn', 'destroy', or 'suspend'.
     * @param newStatus - The new status to set: 'running', 'off', or 'suspended'.
     * @returns A SuccessType object indicating the result of the operation.
     */
    private async changeMachineState(
        id: string,
        prisma: any,
        user: any,
        action: 'powerOn' | 'destroy' | 'shutdown' | 'suspend',
        newStatus: 'running' | 'off' | 'suspended'
    ): Promise<SuccessType> {
        let libvirtConnection: Connection | null = null;
        try {
            // Check if the user is an admin or the owner of the machine
            const isAdmin = user?.role === 'ADMIN';
            const whereClause = isAdmin ? { id } : { id, userId: user?.id };

            // Retrieve the machine from the database
            const machine = await prisma.machine.findFirst({ where: whereClause });
            if (!machine) {
                return { success: false, message: "Machine not found" };
            }

            // Establish connection to libvirt
            libvirtConnection = Connection.open('qemu:///system');
            if (!libvirtConnection) {
                throw new UserInputError("Libvirt not connected");
            }

            // Look up the virtual machine (domain) in libvirt
            const domain = VirtualMachine.lookupByName(libvirtConnection, machine.internalName);
            if (!domain) {
                throw new UserInputError(`Machine ${machine.internalName} not found in libvirt`);
            }

            // Perform the requested action on the domain
            let result;
            switch (action) {
                case 'powerOn':
                    result = await domain.create() || 0;
                    break;
                case 'destroy':
                    try {
                        result = await domain.destroy() || 0;
                    } catch (error) {
                        console.log(error);
                        result = 0;
                        // result = await domain.destroy(libvirt.VIR_DOMAIN_DESTROY_GRACEFUL);
                    }
                    break;
                case 'shutdown':
                    result = await domain.shutdown() || 0;
                    break;
                case 'suspend':
                    result = await domain.suspend() || 0;
                    break;
                default:
                    throw new UserInputError(`Invalid action: ${action}`);
            }

            // Check if the action was successful
            if (result !== 0) {
                throw new UserInputError(`Error performing ${action} on machine ${result}`);
            }

            // Update the machine's status in the database
            await prisma.machine.update({
                where: { id },
                data: { status: newStatus }
            });

            return { success: true, message: `Machine ${newStatus}` };
        } catch (error) {
            // Log the error and return a failure response
            this.debug.log(`Error changing machine state: ${error}`);
            return { success: false, message: (error as Error).message || `Error changing machine state` };
        } finally {
            // Ensure the libvirt connection is closed, even if an error occurred
            if (libvirtConnection) {
                libvirtConnection.close();
            }
        }
    }

    @Mutation(() => Machine)
    @Authorized('ADMIN')
    async moveMachine(
        @Arg('id') id: string,
        @Arg('departmentId') departmentId: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<Machine> {

        // Check if machine exists
        const machine = await prisma.machine.findUnique({
            where: { id }
        });

        if (!machine) {
            throw new UserInputError('Machine not found');
        }

        // Check if department exists
        const department = await prisma.department.findUnique({
            where: { id: departmentId }
        });

        if (!department) {
            throw new UserInputError('Department not found');
        }

        // Update machine's department
        const updatedMachine = await prisma.machine.update({
            where: { id },
            data: {
                departmentId
            }
        });

        return transformMachine(updatedMachine, prisma);
    }
}
