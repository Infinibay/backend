import fs from 'fs';

import { MachineConfiguration, PrismaClient } from '@prisma/client';
import { Connection, Machine as VirtualMachine, StoragePool, StorageVol, Error as LibvirtError, ErrorNumber } from 'libvirt-node';
import { Machine, MachineTemplate, Application } from '@prisma/client';

import { XMLGenerator } from './xmlGenerator';
import { UnattendedManagerBase } from '@services/unattendedManagerBase';
import { UnattendedWindowsManager } from '@services/unattendedWindowsManager'
import { UnattendedUbuntuManager } from '@services/unattendedUbuntuManager';
import { UnattendedRedHatManager } from '@services/unattendedRedHatManager';
import { Debugger } from '@utils/debug';

export class CreateMachineService {

    private prisma: PrismaClient | null = null;
    private libvirt: Connection | null = null
    private debug: Debugger = new Debugger('virt-manager');

    constructor(uri: string = 'qemu:///system', prisma: PrismaClient | null = null) {
        this.debug.log('Creating VirtManager instance with URI', uri);
        this.libvirt = Connection.open(uri);
        this.prisma = prisma;
    }

    async create(machine: Machine, username: string, password: string, productKey: string | undefined): Promise<boolean> {
        this.debug.log('Creating machine', machine.name);
        let newIsoPath: string | null = null;

        try {
            await this.validatePreconditions(machine);
            const template = await this.fetchMachineTemplate(machine);
            const configuration = await this.fetchMachineConfiguration(machine);
            const applications = await this.fetchMachineApplications(machine);

            const unattendedManager = this.createUnattendedManager(machine, username, password, productKey, applications);
            newIsoPath = await unattendedManager.generateNewImage();

            const xmlGenerator = await this.generateXML(machine, template, configuration, newIsoPath);

            await this.executeTransaction(async (tx: any) => {
                await this.updateMachineStatus(tx, machine.id, 'building');
                const storagePool = await this.ensureStoragePool();
                const storageVolume = await this.createStorageVolume(storagePool, machine, template.storage);
                const vm = await this.defineAndStartVM(xmlGenerator, machine);
                await this.updateMachineStatus(tx, machine.id, 'running');
            });
            return true;
        } catch (error) {
            console.error(`Error creating machine: ${error}`);
            await this.rollback(machine, newIsoPath);
            throw new Error('Error creating machine');
        }
    }

    private async validatePreconditions(machine: Machine): Promise<void> {
        if (!this.prisma) {
            throw new Error('Prisma client not set');
        }
    }

    private async fetchMachineTemplate(machine: Machine): Promise<MachineTemplate> {
        const template = await this.prisma!.machineTemplate.findUnique({ where: { id: machine.templateId } });
        if (!template) {
            throw new Error(`Template not found for machine ${machine.name}`);
        }
        return template;
    }

    private async fetchMachineConfiguration(machine: Machine): Promise<MachineConfiguration> {
        const configuration = await this.prisma!.machineConfiguration.findUnique({ where: { machineId: machine.id } });
        if (!configuration) {
            throw new Error(`Configuration not found for machine ${machine.name}`);
        }
        return configuration;
    }

    private async fetchMachineApplications(machine: Machine): Promise<Application[]> {
        const applications = await this.prisma!.machineApplication.findMany({
            where: { machineId: machine.id },
            include: { application: true },
        });
        this.debug.log('Fetched applications for machine', machine.name);
        return applications.map((ma) => ma.application);
    }

    private createUnattendedManager(machine: Machine, username: string, password: string, productKey: string | undefined, applications: Application[]): UnattendedManagerBase {
        const osManagers = {
            'windows10': () => new UnattendedWindowsManager(10, username, password, productKey, applications),
            'windows11': () => new UnattendedWindowsManager(11, username, password, productKey, applications),
            'ubuntu': () => new UnattendedUbuntuManager(username, password, applications),
            'fedora': () => new UnattendedRedHatManager(username, password, applications),
            'redhat': () => new UnattendedRedHatManager(username, password, applications),
        };

        const managerCreator = osManagers[machine.os as keyof typeof osManagers];
        if (!managerCreator) {
            throw new Error(`Unsupported OS: ${machine.os}`);
        }

        return managerCreator();
    }

    private async ensureStoragePool(): Promise<StoragePool> {
        let storagePool = await this.getDefaultStoragePool();
        if (!storagePool) {
            this.debug.log('Storage pool not found, creating it');
            storagePool = await this.createDefaultStoragePool();
        }
        if (!storagePool.isActive()) {
            this.debug.log('Storage pool is inactive, starting it');
            storagePool.create(0);
        }
        return storagePool;
    }

    private async createStorageVolume(storagePool: StoragePool, machine: Machine, storageSize: number): Promise<StorageVol> {
        const volXml = `
    <volume>
        <name>${machine.internalName}-main.qcow2</name>
         <allocation>0</allocation>
         <capacity unit="G">${storageSize}</capacity>
         <target>
            <format type='qcow2'/>
            <compat>1.1</compat>
            <nocow/>
            <features>
              <lazy_refcounts/>
              <extended_l2/>
          </features>
      </target>
    </volume>
  `;

        this.debug.log(`Creating storage volume for machine ${machine.name} volXml: ${volXml}`);
        const vol = StorageVol.createXml(storagePool, volXml, 0);
        if (!vol) {
            throw new Error('Failed to create storage volume');
        }
        return vol;
    }

    private async defineAndStartVM(xmlGenerator: XMLGenerator, machine: Machine): Promise<VirtualMachine> {
        if (!this.libvirt) {
            throw new Error('Libvirt connection not established');
        }
        const xml = xmlGenerator.generate();
        const vm = VirtualMachine.defineXml(this.libvirt, xml);
        if (!vm) {
            let error = LibvirtError.lastError();
            this.debug.log('error', error.message);
            throw new Error('Failed to define VM');
        }
        this.debug.log('VM defined successfully', machine.name);

        const result = vm.create();
        if (result == null) {
            let error = LibvirtError.lastError();
            this.debug.log('error', error.message);
            throw new Error('Failed to start VM');
        }
        this.debug.log('VM started successfully', machine.name);

        return vm;
    }

    private async updateMachineStatus(tx: any, machineId: string, status: string): Promise<void> {
        await tx.machine.update({
            where: { id: machineId },
            data: { status },
        });
        this.debug.log(`Machine status updated to ${status}`);
    }

    private async executeTransaction(transactionBody: (tx: any) => Promise<void>): Promise<void> {
        if (!this.prisma!.$transaction) {
            await transactionBody(this.prisma);
        } else {
            await this.prisma!.$transaction(transactionBody, { timeout: 20000 });
        }
    }

    private async createDefaultStoragePool(): Promise<StoragePool> {
        if (!this.libvirt) {
            throw new Error('Libvirt connection not established');
        }
        let poolName = process.env.INFINIBAY_STORAGE_POOL_NAME ?? 'default';
        const poolXml = `
          <pool type='dir'>
            <name>${poolName}</name>
            <target>
              <path>${process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'}/disks</path>
            </target>
          </pool>
        `;
        // VIR_STORAGE_POOL_CREATE_WITH_BUILD_OVERWRITE	=	2 (0x2; 1 << 1)
        // Create the pool and perform pool build using the VIR_STORAGE_POOL_BUILD_OVERWRITE flag.
        let storagePool = StoragePool.defineXml(this.libvirt, poolXml);

        if (storagePool == null) {
            this.debug.log('error', 'Failed to define storage pool');
            throw new Error('Failed to define storage pool');
        }

        storagePool.build(0);
        storagePool.create(0);
        storagePool.setAutostart(true);
        return storagePool;;
    }

    private async getDefaultStoragePool(): Promise<StoragePool | null> {
        if (!this.libvirt) {
            throw new Error('Libvirt connection not established');
        }
        const poolName = process.env.INFINIBAY_STORAGE_POOL_NAME ?? 'default';
        let storagePool: StoragePool | null = null;
        this.debug.log('Looking up storage pool', poolName);
        storagePool = StoragePool.lookupByName(this.libvirt, poolName);
        return storagePool;
    }

    private async rollback(machine: Machine, newIsoPath: string | null) {
        console.log('Rolling back')

        // Delete the ISO
        if (newIsoPath) {
            console.log('Deleting ISO')
            fs.unlinkSync(newIsoPath);
        }

        // We need to delete the volume if it exists
        let vol: StorageVol | null = null;
        if (!this.libvirt) {
            throw new Error('Libvirt connection not established');
        }
        let pool = await this.getDefaultStoragePool();

        if (pool == null) {
            throw new Error('Failed to get default storage pool');
        }

        vol = StorageVol.lookupByName(pool, `${machine.internalName}-main.qcow2`);
        if (vol !== null) {
            if (vol.delete(0) !== 0) {
                let error = LibvirtError.lastError();
                this.debug.log('error', error.message);
                throw new Error('Failed to delete storage volume');
            }
        }
    }

    async generateXML(
        machine: Machine,
        template: MachineTemplate,
        configuration: MachineConfiguration,
        newIsoPath: string | null
    ): Promise<XMLGenerator> {
        // Log the start of the XML generation
        this.debug.log('Starting to generate XML for machine', machine.name);

        // Check if the Prisma client is set
        if (!this.prisma) {
            throw new Error('Prisma client not set');
        }

        // Get the machine's internal name and operating system
        const machineName = machine.internalName;

        // Log the creation of a new XMLGenerator instance
        this.debug.log('Creating new XMLGenerator instance for machine', machine.name);

        // Create a new XMLGenerator instance
        const xmlGenerator = new XMLGenerator(machineName, machine.id, machine.os);

        // Set the machine's properties
        xmlGenerator.setMemory(template.ram);
        xmlGenerator.setVCPUs(template.cores);
        xmlGenerator.enableTPM('2.0');
        xmlGenerator.setStorage(template.storage);
        xmlGenerator.setUEFI();
        xmlGenerator.addNetworkInterface('default', 'virtio');
        xmlGenerator.setBootDevice(['hd', 'cdrom']);
        if (newIsoPath) {
            xmlGenerator.addCDROM(newIsoPath, 'sata');
            xmlGenerator.addVirtIODrivers();
        }

        // Enable high-resolution graphics for the VM
        xmlGenerator.enableHighResolutionGraphics();

        // Get a new port for the machine
        this.debug.log('Getting new port for machine', machine.name);

        // Add a VNC server to the machine
        const vncPassword = xmlGenerator.addVNC(-1, true, '0.0.0.0');

        // Update the machine configuration with the new port
        configuration.vncPort = -1;
        configuration.vncListen = '0.0.0.0';
        configuration.vncPassword = vncPassword;
        configuration.vncAutoport = true;
        configuration.vncHost = process.env.APP_HOST || '0.0.0.0';

        // Save the machine configuration
        this.debug.log('Updating machine configuration in database');
        await this.prisma.machineConfiguration.update({
            where: { id: configuration.id },
            data: {
                xml: xmlGenerator.getXmlObject(),
                vncPort: configuration.vncPort,
                vncListen: configuration.vncListen,
                vncPassword: configuration.vncPassword,
                vncAutoport: configuration.vncAutoport,
                vncType: configuration.vncType,
            },
        });

        // Log the completion of the XML generation
        this.debug.log('XML generation for machine completed', machine.name);

        // Return the generated XML
        return xmlGenerator;
    }
}