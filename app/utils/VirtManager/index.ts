import Libvirt from '@utils/libvirt';
import { Machine, MachineTemplate } from '@prisma/client';

import { XMLGenerator } from './xmlGenerator';

class VirtManager {
  private libvirt: Libvirt;
  private uri: string;

  constructor(uri: string='qemu:///system') {
    this.libvirt = new Libvirt();
    this.uri = uri;
    this.connect();
  }

  connect(uri?: string): void {
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
      console.error(`Error listing machines: ${error.message}`);
      return [];
    }
  }

  async createMachine(machine: Machine, template: MachineTemplate, name: string, osName: string): Promise<void> {
    // Generate the XML string
    const xml = this.generateXML(machine, template, name, osName);

    // Create the virtual machine
    await this.libvirt.domainDefineXML(xml);
  }

  async generateXML(machine: Machine, template: MachineTemplate, name: string, osName: string): Promise<string> {
    const xml = new XMLGenerator(name, machine.id);
    xml.setMemory(template.ram);
    xml.setVCPUs(template.cores);
    xml.setOS(osName);
    xml.setStorage(template.storage);
    // xml.setNetwork(template.network);
    return xml.generate();
  }
}

export default VirtManager;