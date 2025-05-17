import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from "type-graphql";
import { UserInputError } from "apollo-server-core";
import {
    Machine,
    MachineOrderBy,
    CreateMachineInputType,
    GraphicConfigurationType,
    SuccessType,
    MachineStatus,
    CommandExecutionResponseType,
    UpdateMachineHardwareInput,
} from './type';
import { UserType } from '../user/type';
import { MachineTemplateType } from '../machine_template/type';
import { PaginationInputType } from '@utils/pagination';
import { InfinibayContext } from '@main/utils/context';
import { GraphicPortService } from '@utils/VirtManager/graphicPortService';
import { Connection, Machine as VirtualMachine, Error, NwFilter } from 'libvirt-node';
import { Debugger } from '@utils/debug';
import { MachineLifecycleService } from '../../../services/machineLifecycleService';

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
        const lifecycleService = new MachineLifecycleService(prisma, user);
        return await lifecycleService.createMachine(input);
    }

    @Mutation(() => Machine) 
    @Authorized('ADMIN') 
    async updateMachineHardware(
        @Arg('input') input: UpdateMachineHardwareInput,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<Machine> {
        const lifecycleService = new MachineLifecycleService(prisma, user);
        const updatedMachine = await lifecycleService.updateMachineHardware(input);
        return transformMachine(updatedMachine, prisma); 
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
        const lifecycleService = new MachineLifecycleService(prisma, user);
        return await lifecycleService.destroyMachine(id);
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
