import { Arg, Authorized, Ctx, Mutation, Query, Resolver } from "type-graphql";
import { UserInputError } from "apollo-server-core";
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import {
    Machine,
    MachineOrderBy,
    CreateMachineInputType,
    VncConfigurationType,
    SuccessType,
    MachineStatus,
    MachineConfigurationType,
} from './type';
import { UserType } from '../user/type';
import { MachineTemplateType } from '../machine_template/type';
import { PaginationInputType } from '@utils/pagination';
import { InfinibayContext } from '@main/utils/context';
import { VirtManager } from '@utils/VirtManager';
import { VncPortService } from '@utils/VirtManager/vncPortService';
import { Connection, Machine as VirtualMachine } from 'libvirt-node';
import { Debugger } from '@utils/debug';
import { XMLGenerator } from '@utils/VirtManager/xmlGenerator';
import { existsSync } from 'fs';

async function transformMachine(prismaMachine: any, prisma: any): Promise<Machine> {
    // TODO: fix n+1 problem
    const user = prismaMachine.userId ? await prisma.user.findUnique({ where: { id: prismaMachine.userId } }) : null;
    const template = prismaMachine.templateId ? await prisma.machineTemplate.findUnique({ where: { id: prismaMachine.templateId } }) : null;
    const department = prismaMachine.departmentId ? await prisma.department.findUnique({ where: { id: prismaMachine.departmentId } }) : null;
    const vncHost = prismaMachine.configuration.vncHost || process.env.VNC_HOST || 'localhost';
    let vncPort;
    try {
        vncPort = await new VncPortService().getVncPort(prismaMachine.internalName)
    } catch (e) {
        console.log(e);
    }

    return {
        ...prismaMachine,
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
            vnc: "vnc://" + prismaMachine.configuration.vncPassword + "@" + vncHost + ":" + vncPort,
            vncListen: prismaMachine.configuration.vncListen || '0.0.0.0',
            vncAutoport: prismaMachine.configuration.vncAutoport || false,
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

    @Query(() => VncConfigurationType, { nullable: true })
    @Authorized('USER')
    async vncConnection(
        @Arg('id') id: string,
        @Ctx() { prisma, user }: InfinibayContext
    ): Promise<VncConfigurationType | null> {
        const isAdmin = user?.role === 'ADMIN';
        const whereClause = isAdmin ? { id } : { id, userId: user?.id };
        const machine = await prisma.machine.findFirst({
            where: whereClause,
            include: { configuration: true, department: true, template: true, user: true }
        });

        if (!machine || !machine.configuration) return null;

        const port = await new VncPortService().getVncPort(machine.internalName);
        return {
            link: `vnc://${machine.configuration.vncHost || process.env.VNC_HOST || 'localhost'}:${port}`,
            password: machine.configuration.vncPassword || ''
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
            // Find the Default department
            const defaultDepartment = await tx.department.findFirst({
                where: { name: "Default" }
            });

            if (!defaultDepartment) {
                throw new UserInputError("Default department not found");
            }

            const createdMachine = await tx.machine.create({
                data: {
                    name: input.name,
                    userId: user?.id,
                    status: 'building',
                    os: input.os,
                    templateId: input.templateId,
                    internalName,
                    departmentId: defaultDepartment.id,
                    configuration: {
                        create: {
                            vncPort: 0,
                            vncListen: '0.0.0.0',
                            vncHost: process.env.VNC_HOST || 'localhost',
                            vncPassword: null,
                            vncAutoport: false,
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
            this.backgroundCode(machine.id, prisma, user, input.username, input.password, input.productKey);
        });

        return machine;
    }

    private backgroundCode = async (id: string, prisma: any, user: any, username: string, password: string, productKey: string | undefined) => {
        try {
            const machine = await prisma.machine.findUnique({
                where: {
                    id
                }
            });
            const virtManager = new VirtManager();
            virtManager.setPrisma(prisma);
            await virtManager.createMachine(machine as any, username, password, productKey);
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
        return this.changeMachineState(id, prisma, user, 'destroy', 'off');
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
        const machine = await prisma.machine.findFirst({ where: whereClause });

        if (!machine) {
            return { success: false, message: "Machine not found" };
        }

        // Connect to libvirt
        const libvirtConnection = Connection.open('qemu:///system');
        if (!libvirtConnection) {
            return { success: false, message: "Libvirt not connected" };
        }

        // Look up the domain (VM) by name
        const domain = VirtualMachine.lookupByName(libvirtConnection, machine.internalName);
        if (domain === null) {
            return { success: false, message: "Error destroying machine. Machine not found" };
        }

        // Perform destruction process within a transaction
        return prisma.$transaction(async (tx) => {
            try {
                // Retrieve machine configuration
                const configuration = await tx.machineConfiguration.findUnique({
                    where: { machineId: machine.id }
                });
                if (!configuration) throw new UserInputError("MachineConfiguration not found");

                // Load XML configuration
                const xmlGenerator = new XMLGenerator('', '', '');
                xmlGenerator.load(configuration.xml);

                // Attempt to forcefully stop the VM (ignore errors if already stopped)
                // We ignore the error because domain object can not be null at this point.
                // The mutation has an early return if the domain is not found.
                //@ts-ignore
                await domain.destroy();

                // Undefine the domain from libvirt
                console.log("Undefining domain");
                domain.undefine();


                // Prepare list of files to delete (UEFI var file and disk files)
                const filesToDelete = [
                    xmlGenerator.getUefiVarFile(),
                    ...xmlGenerator.getDisks()
                ].filter(file => {
                    // return false if the file is virtio.iso
                    if (file && file.includes('virtio.iso')) {
                        return false;
                    }
                    return file && existsSync(file);
                });
                console.log("Removing files", filesToDelete);

                // Delete associated files
                await Promise.all(filesToDelete.map(file =>
                    fs.unlink(file).catch(e => this.debug.log(`Error deleting ${file}: ${e}`))
                ));

                // Remove database records
                await tx.machineConfiguration.delete({ where: { machineId: machine.id } });
                await tx.machine.delete({ where: { id: machine.id } });

                return { success: true, message: "Machine destroyed" };
            } catch (error) {
                this.debug.log(`Error destroying machine: ${error}`);
                throw error; // Propagate error to rollback transaction
            }
        });
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
        action: 'powerOn' | 'destroy' | 'suspend',
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
                throw new Error("Libvirt not connected");
            }

            // Look up the virtual machine (domain) in libvirt
            const domain = VirtualMachine.lookupByName(libvirtConnection, machine.internalName);
            if (!domain) {
                throw new Error(`Machine ${machine.internalName} not found in libvirt`);
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
}
