import fs from 'fs';
import portfinder from 'portfinder';
import { MachineConfiguration, PrismaClient } from '@prisma/client';
import { Libvirt, VirDomainState } from '@utils/libvirt';
import { Machine, MachineTemplate } from '@prisma/client';

import { XMLGenerator } from './xmlGenerator';
import { UnattendedWindowsManager } from '@services/unattendedWindowsManager'
import { UnattendedUbuntuManager } from '@services/unattendedUbuntuManager';
import { UnattendedRedHatManager } from '@services/unattendedRedHatManager';
import { Debugger } from '@utils/debug';

export class VirtManager {
  private libvirt: Libvirt;
  private uri: string;
  private prisma: PrismaClient | null = null;
  private debug: Debugger = new Debugger('virt-manager');

  constructor(uri: string='qemu:///system') {
    this.debug.log('Creating VirtManager instance with URI', uri);
    this.libvirt = new Libvirt();
    this.uri = uri;
    this.connect();
  }

  setPrisma(prisma: PrismaClient): void {
    this.prisma = prisma;
  }

  connect(uri?: string): void {
    this.debug.log('Connecting to hypervisor with URI', uri ?? '');
    // If a new URI is provided, update the current URI
    if (uri) {
      this.uri = uri;
    }

    // If already connected, disconnect first
    if (this.libvirt.isConnected()) {
      this.libvirt.disconnect();
    }

    // Connect to the hypervisor
    this.libvirt.connect(this.uri);
  }

  async listMachines(): Promise<string[]> {
    try {

      // Get the list of all domains
      const domains = await this.libvirt.listAllDomains();

      // Disconnect from the hypervisor
      this.libvirt.disconnect();

      return domains;
    } catch (error) {
      console.error(`Error listing machines: ${error}`);
      return [];
    }
  }

  /**
   * This method is used to create a new virtual machine.
   * It takes in a machine object, username, password, and a product key.
   * It first checks if the Prisma client is set, then fetches the machine template.
   * It then fetches the applications related to the machine and extracts the application data.
   * It determines the OS and uses the corresponding unattended manager.
   * It generates a new ISO with the auto-install script and the XML string for the VM.
   * Finally, it starts a Prisma transaction.
   *
   * @param machine - The machine object containing the details of the machine to be created.
   * @param username - The username for the new machine.
   * @param password - The password for the new machine.
   * @param productKey - The product key for the new machine.
   * @returns A promise that resolves when the machine is created.
   */
  async createMachine(machine: Machine, username: string, password: string, productKey: string|null): Promise<void> {
    this.debug.log('Creating machine', machine.name);

    // Check if Prisma client is set
    if (!this.prisma) {
      throw new Error('Prisma client not set');
    }

    // Fetch the machine template
    const template = await this.prisma.machineTemplate.findUnique({ where: { id: machine.templateId } });
    let configuration: MachineConfiguration | null = await this.prisma.machineConfiguration.findUnique({ where: { machineId: machine.id } });
    if (!template) {
      throw new Error('Template not found for machine ' + machine.name);
    }
    if (!configuration) {
      throw new Error('Configuration not found for machine ' + machine.name);
    }

    let xml: string | null = null
    let newIsoPath: string | null = null
    try {
      // Fetch the applications related to the machine
      const applications = await this.prisma.machineApplication.findMany({
        where: {
          machineId: machine.id,
        },
        include: {
          application: true,
        },
      });
      this.debug.log('Fetched applications for machine', machine.name);

      // Extract the application data from the query result
      const applicationData = applications.map((ma) => ma.application);

      // Determine the OS and use the corresponding unattended manager
      let unattendedManager;
      switch (machine.os) {
        case 'windows':
          unattendedManager = new UnattendedWindowsManager(username, password, productKey, applicationData);
          break;
        case 'ubuntu':
          unattendedManager = new UnattendedUbuntuManager(username, password, applicationData);
          break;
        case 'fedora': // fedora or redhat
          unattendedManager = new UnattendedRedHatManager(username, password, applicationData);
          break;
        case 'redhat':
          unattendedManager = new UnattendedRedHatManager(username, password, applicationData);
          break;
        // ...add more cases as needed...
        default:
          throw new Error(`Unsupported OS: ${machine.os}`);
      }
      this.debug.log('Unattended manager set for machine', machine.name);

      // Generate the new ISO with the auto-install script
      const newIsoPath = await unattendedManager.generateNewImage();

      // Generate the XML string for the VM
      const xmlPromise = this.generateXML(machine, template, configuration, newIsoPath);



      // Start a Prisma transaction
      let transaction = async (tx: any) => {
        // Set the status of the machine to 'building'
        await tx.machine.update({
          where: { id: machine.id },
          data: { status: 'building' },
        });
        this.debug.log('Machine status set to building', machine.name);

        // Define the VM using the generated XML
        const xmlGenerator = await xmlPromise
        xml = xmlGenerator.generate()

              // create storage file
        const storagePath = xmlGenerator.getStoragePath();
        const storageSize = template.storage;
        await this.libvirt.createStorage(storageSize, storagePath);
        this.debug.log('Storage file created for machine', machine.name, storagePath);

        this.debug.log('Generated XML for machine', machine.name, xml);
        await this.libvirt.domainDefineXML(xml);
        this.debug.log('VM defined with XML for machine', machine.name);

      };

      // check if this.prisma define $transaction
      if (this.prisma.$transaction) {
        await this.prisma.$transaction(transaction, { timeout: 20000 });
      } else {
        await transaction(this.prisma);
      }
    } catch (error) {
      console.error(`Error creating machine: ${error}`);
      // print stack trace
      if (error instanceof Error) {
        console.log(error.stack); // This will log the stack trace
      }

      console.log('Rolling back')

      // Delete the ISO
      if (newIsoPath) {
        console.log('Deleting ISO')
        fs.unlinkSync(newIsoPath);
      }

      // Delete the XML
      if (xml) {
        console.log('Deleting XML')
        // fs.unlinkSync(xml);
      }
      throw new Error('Error creating machine');
    }
  }

  /**
   * This method generates an XML string that represents a virtual machine configuration.
   * It uses the XMLGenerator class to set the various properties of the virtual machine.
   * 
   * @param machine - The machine object containing the details of the machine.
   * @param template - The template object containing the configuration of the machine.
   * @param configuration - The machine configuration object.
   * @returns A promise that resolves to a string representing the XML configuration of the machine.
   */
  async generateXML(
    machine: Machine,
    template: MachineTemplate,
    configuration: MachineConfiguration,
    newIsoPath?: string
  ): Promise<XMLGenerator> {
    // Log the start of the XML generation
    this.debug.log('Starting to generate XML for machine', machine.name);

    // Check if the Prisma client is set
    if (!this.prisma) {
      throw new Error('Prisma client not set');
    }

    // Get the machine's internal name and operating system
    const machineName = machine.internalName;
    const osName = machine.os;

    // Log the creation of a new XMLGenerator instance
    this.debug.log('Creating new XMLGenerator instance for machine', machine.name);

    // Create a new XMLGenerator instance
    const xmlGenerator = new XMLGenerator(machineName, machine.id);

    // Set the machine's properties
    xmlGenerator.setMemory(template.ram);
    xmlGenerator.setVCPUs(template.cores);
    xmlGenerator.enableTPM('2.0');
    xmlGenerator.setStorage(template.storage);
    xmlGenerator.setBootDevice(['cdrom', 'hd']);
    if (newIsoPath) {
      xmlGenerator.addCDROM(newIsoPath, 'sata');
    }

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

  /**
   * This method powers on a virtual machine.
   * 
   * @param domainName - The name of the domain.
   * @returns A promise that resolves to void.
   */
  async powerOn(domainName: string): Promise<void> {
    await this.libvirt.resume(domainName);
  }

  // Alias method
  public resume = this.powerOn;

  /**
   * This method powers off a virtual machine.
   * 
   * @param domainName - The name of the domain.
   * @returns A promise that resolves to void.
   */
  async powerOff(domainName: string): Promise<void> {
    const domain = this.libvirt.lookupDomainByName(domainName);
    if (!domain) {
      throw new Error(`Domain ${domainName} not found`);
    }
    await this.libvirt.powerOff(domain);
  }

  async suspend(domainName: string): Promise<void> {
    const domain = this.libvirt.lookupDomainByName(domainName);
    if (!domain) {
      throw new Error(`Domain ${domainName} not found`);
    }
    await this.libvirt.suspend(domain);
  }

  async getDomainStatus(domainName: string): Promise<string> {
    const domain = this.libvirt.lookupDomainByName(domainName);
    if (!domain) {
      throw new Error(`Domain ${domainName} not found`);
    }

    const info = await this.libvirt.domainGetInfo(domain);
    const state = info.state;

    switch (state) {
      case VirDomainState.VIR_DOMAIN_RUNNING:
        return 'running';
      case VirDomainState.VIR_DOMAIN_PAUSED:
        return 'paused';
      case VirDomainState.VIR_DOMAIN_SHUTDOWN:
        return 'shutdown';
      case VirDomainState.VIR_DOMAIN_CRASHED:
        return 'crashed';
      case VirDomainState.VIR_DOMAIN_PMSUSPENDED:
        return 'suspended';
      default:
        return 'unknown';
    }
  }
}

export default VirtManager;