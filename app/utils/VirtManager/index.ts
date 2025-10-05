import { PrismaClient, Machine } from '@prisma/client'
import { Connection, Machine as VirtualMachine, StoragePool, StorageVol, Error as LibvirtError, ErrorNumber } from '@infinibay/libvirt-node'
import { CreateMachineService } from '@utils/VirtManager/createMachineService'

import { Debugger } from '@utils/debug'

export class VirtManager {
  private libvirt: Connection | null = null
  private uri: string = ''
  private prisma: PrismaClient | null = null
  private debug: Debugger = new Debugger('virt-manager')

  constructor (uri: string = 'qemu:///system') {
    this.debug.log('Creating VirtManager instance with URI', uri)
    this.uri = uri
    this.connect()
  }

  setPrisma (prisma: PrismaClient): void {
    this.prisma = prisma
  }

  connect (uri?: string): void {
    this.debug.log('Connecting to hypervisor with URI', uri ?? '')
    // If a new URI is provided, update the current URI
    if (uri) {
      this.uri = uri
    }

    // If already connected, disconnect first
    if (this.libvirt !== null) {
      this.libvirt.close()
    }

    // Connect to the hypervisor
    this.libvirt = Connection.open(this.uri)

    if (!this.libvirt) {
      throw new Error('Failed to connect to hypervisor')
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
  async createMachine (machine: Machine, username: string, password: string, productKey: string | undefined, pciBus: string | null): Promise<void> {
    this.debug.log('Creating machine', machine.name)
    const service: CreateMachineService = new CreateMachineService(this.uri, this.prisma)
    await service.create(machine, username, password, productKey, pciBus)
  }

  /**
   * This method powers on a virtual machine.
   *
   * @param domainName - The name of the domain.
   * @returns A promise that resolves to void.
   */
  async powerOn (domainName: string): Promise<void> {
    if (!this.libvirt) {
      throw new Error('Libvirt connection is not established')
    }
    const domain = VirtualMachine.lookupByName(this.libvirt, domainName)
    if (!domain) {
      throw new Error(`Domain ${domainName} not found`)
    }
    domain.resume()
  }
}

export default VirtManager
