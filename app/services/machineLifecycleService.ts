import { PrismaClient, Department } from '@prisma/client';
import { UserInputError } from 'apollo-server-core';
import { v4 as uuidv4 } from 'uuid';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { Connection, Machine as VirtualMachine, NwFilter } from 'libvirt-node';
import { XMLGenerator } from '../utils/VirtManager/xmlGenerator';
import { Debugger } from '../utils/debug';
import VirtManager from '../utils/VirtManager';
import { MachineCleanupService } from './cleanup/machineCleanupService';

export class MachineLifecycleService {
  private prisma: PrismaClient;
  private user: any;
  private debug: Debugger;

  constructor(prisma: PrismaClient, user: any) {
    this.prisma = prisma;
    this.user = user;
    this.debug = new Debugger('machine-lifecycle-service');
  }

  async createMachine(input: any): Promise<any> {
    // First verify the template exists
    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: input.templateId }
    });

    if (!template) {
      throw new UserInputError('Machine template not found');
    }

    const internalName = uuidv4();
    const machine = await this.prisma.$transaction(async (tx: any) => {
      let department: Department | null = null;
      if (input.departmentId) {
        department = await tx.department.findUnique({
          where: { id: input.departmentId }
        });
      } else {
        department = await tx.department.findFirst();
      }

      if (!department) {
        throw new UserInputError('Department not found');
      }

      const createdMachine = await tx.machine.create({
        data: {
          name: input.name,
          userId: this.user?.id,
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
        throw new UserInputError('Machine not created');
      }

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
      this.backgroundCode(machine.id, input.username, input.password, input.productKey, input.pciBus);
    });

    return machine;
  }

  async destroyMachine(id: string): Promise<any> {
    const isAdmin = this.user?.role === 'ADMIN';
    const whereClause = isAdmin ? { id } : { id, userId: this.user?.id };
    const machine = await this.prisma.machine.findFirst({
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
      return { success: false, message: 'Machine not found' };
    }

    try {
      const cleanup = new MachineCleanupService(this.prisma);
      await cleanup.cleanupVM(machine.id);
      return { success: true, message: 'Machine destroyed' };
    } catch (error: any) {
      this.debug.log(`Error destroying machine: ${String(error)}`);
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `Error destroying machine: ${message}` };
    }
  }

  private async backgroundCode(id: string, username: string, password: string, productKey: string | undefined, pciBus: string | null) {
    try {
      const machine = await this.prisma.machine.findUnique({
        where: {
          id
        }
      });
      const virtManager = new VirtManager();
      virtManager.setPrisma(this.prisma);
      await virtManager.createMachine(machine as any, username, password, productKey, pciBus);
      await virtManager.powerOn(machine?.internalName as string);
      await this.prisma.machine.update({
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
}
