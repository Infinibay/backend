import { PrismaClient, Department } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import {
  Connection,
  Machine,
  VirDomainXMLFlags,
  Error as LibvirtNodeError,
  VirDomainDestroyFlags,
} from 'libvirt-node';
import { XMLGenerator } from '../utils/VirtManager/xmlGenerator';
import { Debugger } from '../utils/debug';
import VirtManager from '../utils/VirtManager'; 
import { ApolloError, UserInputError } from 'apollo-server-express';
import si from 'systeminformation';
import { parseStringPromise as xmlParse, Builder as XmlBuilder } from 'xml2js';
import { MachineCleanupService } from './cleanup/machineCleanupService';

// Temporary local definitions for libvirt constants and enums
const VIR_DOMAIN_NOSTATE = 0;
const VIR_DOMAIN_RUNNING = 1;
const VIR_DOMAIN_BLOCKED = 2;
const VIR_DOMAIN_PAUSED = 3;
const VIR_DOMAIN_SHUTDOWN = 4; // State during shutdown process
const VIR_DOMAIN_SHUTOFF = 5; // State when fully off
const VIR_DOMAIN_CRASHED = 6;
const VIR_DOMAIN_PMSUSPENDED = 7;

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
          cpuCores: template.cores,
          ramGB: template.ram,
          diskSizeGB: template.storage,
          gpuPciAddress: input.pciBus,
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
        throw new ApolloError('Machine not created');
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

  async updateMachineHardware(input: any): Promise<any> {
    const { id, cpuCores, ramGB, gpuPciAddress } = input;

    const machine = await this.prisma.machine.findUnique({
      where: { id },
      include: { configuration: true },
    });

    if (!machine) {
      throw new ApolloError(`Machine with ID ${id} not found`);
    }

    const updateData: any = {};
    if (cpuCores !== undefined) {
      if (cpuCores <= 0) throw new ApolloError('CPU cores must be positive.');
      updateData.cpuCores = cpuCores;
    }
    if (ramGB !== undefined) {
      if (ramGB <= 0) throw new ApolloError('RAM must be positive.');
      updateData.ramGB = ramGB;
    }

    if (gpuPciAddress !== undefined) {
      if (gpuPciAddress === null) {
        updateData.gpuPciAddress = null;
      } else {
        try {
          const graphicsInfo = await si.graphics();
          const isValidGpu = graphicsInfo.controllers.some(
            (gpu) => gpu.pciBus === gpuPciAddress
          );

          if (!isValidGpu) {
            throw new ApolloError(
              `Invalid GPU PCI address: ${gpuPciAddress}. Not found or not a GPU.`
            );
          }
          updateData.gpuPciAddress = gpuPciAddress;
        } catch (error) {
          this.debug.log(`Error validating GPU PCI address ${gpuPciAddress}: ${String(error)}`);
          throw new Error(`Failed to validate GPU PCI address: ${gpuPciAddress}.`);
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      this.debug.log(`No hardware changes provided for machine ${id}.`);
      return machine;
    }

    const updatedMachine = await this.prisma.machine.update({
      where: { id },
      data: updateData,
      include: {
        configuration: true,
        department: true,
        template: true,
        user: true,
      },
    });

    this.debug.log(
      `Machine ${id} hardware updated in DB: ${JSON.stringify(updateData)}. Libvirt update required.`,
    );

    this.backgroundUpdateHardware(updatedMachine.id).catch(err => {
      this.debug.log(`Error in backgroundUpdateHardware for machine ${updatedMachine.id}: ${String(err)}`);
    });

    return updatedMachine;
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

  private async backgroundUpdateHardware(machineId: string): Promise<void> {
    this.debug.log(`Starting background hardware update for machine ${machineId}`);
    // TODO: Ensure Prisma client is generated (npx prisma generate) if schema changes for Machine model are not reflected in types.
    let machine: any; 
    let conn: Connection | null = null;
    let domain: Machine | null = null; 

    try {
      machine = await this.prisma.machine.findUnique({
        where: { id: machineId },
        select: { 
          id: true, 
          internalName: true, 
          status: true, 
          name: true, 
          os: true, 
          cpuCores: true, 
          ramGB: true,    
          gpuPciAddress: true 
        }
      });

      if (!machine || !machine.internalName) {
        this.debug.log(`Machine ${machineId} not found or has no internalName. Cannot proceed.`);
        await this.prisma.machine.update({
          where: { id: machineId }, data: { status: 'error_hardware_update' }
        });
        return;
      }

      await this.prisma.machine.update({
        where: { id: machineId }, data: { status: 'updating_hardware' }
      });

      conn = await Connection.open('qemu:///system');
      if (!conn) {
        throw new Error('Failed to open libvirt connection.');
      }

      domain = await Machine.lookupByName(conn, machine.internalName); 
      if (!domain) {
        throw new Error(`Libvirt domain ${machine.internalName} not found.`);
      }

      let stateResult = await domain.getState();
      if (!stateResult) {
        throw new Error(`Failed to get state for domain ${machine.internalName}. getState() returned null.`);
      }
      let currentState = stateResult.result;
      this.debug.log(`Machine ${machine.internalName} current state value: ${currentState}`);

      if (currentState === VIR_DOMAIN_RUNNING || currentState === VIR_DOMAIN_PAUSED) {
        this.debug.log(`Machine ${machine.internalName} is running/paused. Attempting graceful shutdown.`);
        await this.prisma.machine.update({ where: { id: machineId }, data: { status: 'powering_off_update' }});
        
        try {
            this.debug.log(`Attempting domain.shutdown() for ${machine.internalName}`);
            await domain.shutdown();
        } catch (shutdownError) {
            this.debug.log(`domain.shutdown() failed for ${machine.internalName}: ${shutdownError instanceof LibvirtNodeError ? shutdownError.message : String(shutdownError)}. Attempting destroyFlags(GRACEFUL).`);
            try {
                await domain.destroyFlags(VirDomainDestroyFlags.VirDomainDestroyGraceful);
            } catch (destroyFlagsError) {
                this.debug.log(`domain.destroyFlags(GRACEFUL) failed for ${machine.internalName}: ${destroyFlagsError instanceof LibvirtNodeError ? destroyFlagsError.message : String(destroyFlagsError)}. Attempting hard destroy.`);
                await domain.destroy();
            }
        }

        let attempts = 0;
        const maxAttempts = 24; 
        while (currentState !== VIR_DOMAIN_SHUTOFF && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 5000)); 
          stateResult = await domain.getState();
          if (!stateResult) {
            this.debug.log(`Failed to get state during shutdown poll for ${machine.internalName}. Loop attempt ${attempts +1}.`);
            attempts++; 
            continue; 
          }
          currentState = stateResult.result;
          this.debug.log(`Machine ${machine.internalName} state after shutdown attempt ${attempts + 1}: ${currentState}`);
          attempts++;
        }

        if (currentState !== VIR_DOMAIN_SHUTOFF) {
          this.debug.log(`Machine ${machine.internalName} did not shut down after ${maxAttempts} attempts. Forcing destroy.`);
          await domain.destroy(); 
          stateResult = await domain.getState(); 
          if (!stateResult) { 
            throw new Error(`Failed to get state for domain ${machine.internalName} after forced destroy. getState() returned null.`);
          }
          currentState = stateResult.result;
          if (currentState !== VIR_DOMAIN_SHUTOFF) {
             await new Promise(resolve => setTimeout(resolve, 2000));
             stateResult = await domain.getState();
             if (!stateResult) { 
                throw new Error(`Failed to get state for domain ${machine.internalName} after post-destroy delay. getState() returned null.`);
             }
             currentState = stateResult.result;
             if (currentState !== VIR_DOMAIN_SHUTOFF) {
                throw new Error(`Machine ${machine.internalName} could not be shut down or destroyed. Current state: ${currentState}`);
             }
          }
        }
        this.debug.log(`Machine ${machine.internalName} is now shut off.`);
      }

      this.debug.log(`Fetching XML for ${machine.internalName}`);
      const currentXmlString = await domain.getXmlDesc(VirDomainXMLFlags.VirDomainXMLInactive | VirDomainXMLFlags.VirDomainXMLSecure);
      if (!currentXmlString) {
        throw new Error(`Could not retrieve XML for domain ${machine.internalName}`);
      }

      const currentXmlObj = await xmlParse(currentXmlString, { explicitArray: false, explicitRoot: false });

      const xmlGen = new XMLGenerator(machine.name, machine.id, machine.os);
      xmlGen.load(currentXmlObj); 

      if (machine.cpuCores) {
        this.debug.log(`Setting VCPUs to ${machine.cpuCores} for ${machine.internalName}`);
        xmlGen.setVCPUs(machine.cpuCores);
      }
      if (machine.ramGB) {
        this.debug.log(`Setting RAM to ${machine.ramGB}GB for ${machine.internalName}`);
        xmlGen.setMemory(machine.ramGB);
      }

      if (xmlGen.getXmlObject().devices && xmlGen.getXmlObject().devices.hostdev) {
        this.debug.log(`Removing existing PCI hostdevs for ${machine.internalName}`);
        xmlGen.getXmlObject().devices.hostdev = xmlGen.getXmlObject().devices.hostdev.filter(
          (dev: any) => !(dev.$ && dev.$.type === 'pci' && dev.source && dev.source.address)
        );
        if (xmlGen.getXmlObject().devices.hostdev.length === 0) {
          delete xmlGen.getXmlObject().devices.hostdev;
        }
      }

      if (machine.gpuPciAddress) {
        this.debug.log(`Adding GPU passthrough ${machine.gpuPciAddress} for ${machine.internalName}`);
        xmlGen.addGPUPassthrough(machine.gpuPciAddress);
      } else {
        this.debug.log(`No GPU PCI address specified, ensuring no GPU passthrough for ${machine.internalName}`);
        if (xmlGen.getXmlObject().devices && xmlGen.getXmlObject().devices.hostdev) {
            xmlGen.getXmlObject().devices.hostdev = xmlGen.getXmlObject().devices.hostdev.filter(
                (dev: any) => !(dev.$ && dev.$.type === 'pci' && dev.source && dev.source.address)
            );
            if (xmlGen.getXmlObject().devices.hostdev.length === 0) {
                delete xmlGen.getXmlObject().devices.hostdev;
            }
        }
      }

      const newXmlString = xmlGen.generate();
      this.debug.log(`New XML for ${machine.internalName}:\n${newXmlString}`);

      this.debug.log(`Defining VM ${machine.internalName} with new XML.`);
      await Machine.defineXml(conn, newXmlString);

      await this.prisma.machine.update({
        where: { id: machineId }, data: { status: 'off' }
      });
      this.debug.log(`Machine ${machine.internalName} hardware updated successfully, status set to OFF.`);

    } catch (error) {
      const errorMessage = error instanceof LibvirtNodeError ? error.message : (error instanceof Error ? error.message : String(error));
      this.debug.log(`Error during background hardware update for machine ${machineId}: ${errorMessage}`);
      try {
        await this.prisma.machine.update({
          where: { id: machineId },
          data: { status: 'error_hardware_update' }
        });
      } catch (dbError) {
        const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        this.debug.log(`Failed to set error status after libvirt error for machine ${machineId}: ${dbErrorMessage}`);
      }
    } finally {
      if (domain) {
        try { await domain.free(); } catch (e) { this.debug.log(`Error freeing domain: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (conn) {
        try { await conn.close(); } catch (e) { this.debug.log(`Error closing libvirt connection: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
  }
}
