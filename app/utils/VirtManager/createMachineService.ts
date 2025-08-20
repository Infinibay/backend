import fs from 'fs'
import path from 'path'
import si from 'systeminformation'

import { MachineConfiguration, PrismaClient, Machine, MachineTemplate, Application } from '@prisma/client'
import { Connection, Machine as VirtualMachine, StoragePool, StorageVol, Error as LibvirtError, ErrorNumber } from 'libvirt-node'

import { XMLGenerator } from './xmlGenerator'
import { UnattendedManagerBase } from '@services/unattendedManagerBase'
import { UnattendedWindowsManager } from '@services/unattendedWindowsManager'
import { UnattendedUbuntuManager } from '@services/unattendedUbuntuManager'
import { UnattendedRedHatManager } from '@services/unattendedRedHatManager'
import { Debugger } from '@utils/debug'
import { MachineCleanupService } from '../../services/cleanup/machineCleanupService'

const ALLOWED_GPU_VENDORS = [
  'NVIDIA Corporationß',
  'Advanced Micro Devices, Inc. [AMD/ATI]'
]

export class CreateMachineService {
  private prisma: PrismaClient | null = null
  public libvirt: Connection | null = null
  private debug: Debugger = new Debugger('virt-manager')

  constructor (uri: string = 'qemu:///system', prisma: PrismaClient | null = null) {
    this.debug.log('Creating VirtManager instance with URI', uri)
    this.libvirt = Connection.open(uri)
    this.prisma = prisma
  }

  async create (machine: Machine, username: string, password: string, productKey: string | undefined, pciBus: string | null): Promise<boolean> {
    this.debug.log('Creating machine', machine.name)
    let newIsoPath: string | null = null

    try {
      await this.validatePreconditions(machine)
      const template = await this.fetchMachineTemplate(machine)
      const configuration = await this.fetchMachineConfiguration(machine)
      const applications = await this.fetchMachineApplications(machine)

      const unattendedManager = this.createUnattendedManager(machine, username, password, productKey, applications)
      newIsoPath = await unattendedManager.generateNewImage()

      const xmlGenerator = await this.generateXML(machine, template, configuration, newIsoPath, pciBus)

      await this.executeTransaction(async (tx: any) => {
        await this.updateMachineStatus(tx, machine.id, 'building')
        const storagePool = await this.ensureStoragePool()
        // Use machine's diskSizeGB if no template, otherwise use template's storage
        const storageSize = template ? template.storage : machine.diskSizeGB
        const storageVolume = await this.createStorageVolume(storagePool, machine, storageSize)
        const vm = await this.defineAndStartVM(xmlGenerator, machine)
        await this.updateMachineStatus(tx, machine.id, 'running')
      })
      return true
    } catch (error: any) {
      console.error(`Error creating machine: ${error}`)
      // print the stack trace
      console.error(error.stack)
      await this.rollback(machine, newIsoPath)
      throw new Error('Error creating machine')
    }
  }

  private async validatePreconditions (machine: Machine): Promise<void> {
    if (!this.prisma) {
      throw new Error('Prisma client not set')
    }
  }

  private async fetchMachineTemplate (machine: Machine): Promise<MachineTemplate | null> {
    if (!machine.templateId) {
      return null
    }
    const template = await this.prisma!.machineTemplate.findUnique({ where: { id: machine.templateId } })
    if (!template) {
      throw new Error(`Template not found for machine ${machine.name}`)
    }
    return template
  }

  private async fetchMachineConfiguration (machine: Machine): Promise<MachineConfiguration> {
    const configuration = await this.prisma!.machineConfiguration.findUnique({ where: { machineId: machine.id } })
    if (!configuration) {
      throw new Error(`Configuration not found for machine ${machine.name}`)
    }
    return configuration
  }

  private async fetchMachineApplications (machine: Machine): Promise<any[]> {
    const applications = await this.prisma!.machineApplication.findMany({
      where: { machineId: machine.id },
      include: { application: true }
    })
    this.debug.log('Fetched applications for machine', machine.name)
    return applications.map((ma) => ma.application)
  }

  private createUnattendedManager (machine: Machine, username: string, password: string, productKey: string | undefined, applications: any[]): UnattendedManagerBase {
    const osManagers = {
      windows10: () => new UnattendedWindowsManager(10, username, password, productKey, applications, machine.id),
      windows11: () => new UnattendedWindowsManager(11, username, password, productKey, applications, machine.id),
      ubuntu: () => new UnattendedUbuntuManager(username, password, applications, machine.id),
      fedora: () => new UnattendedRedHatManager(username, password, applications, machine.id),
      redhat: () => new UnattendedRedHatManager(username, password, applications, machine.id)
    }

    const managerCreator = osManagers[machine.os as keyof typeof osManagers]
    if (!managerCreator) {
      throw new Error(`Unsupported OS: ${machine.os}`)
    }

    return managerCreator()
  }

  private async ensureStoragePool (): Promise<StoragePool> {
    let storagePool = await this.getDefaultStoragePool()
    if (!storagePool) {
      this.debug.log('Storage pool not found, creating it')
      storagePool = await this.createDefaultStoragePool()
    }
    if (!storagePool.isActive()) {
      this.debug.log('Storage pool is inactive, starting it')
      storagePool.create(0)
    }
    return storagePool
  }

  private async createStorageVolume (storagePool: StoragePool, machine: Machine, storageSize: number): Promise<StorageVol> {
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
  `

    this.debug.log(`Creating storage volume for machine ${machine.name} volXml: ${volXml}`)
    const vol = StorageVol.createXml(storagePool, volXml, 0)
    if (!vol) {
      throw new Error('Failed to create storage volume')
    }

    // Ensure the volume is created and log its details
    const createdVol = StorageVol.lookupByName(storagePool, `${machine.internalName}-main.qcow2`)
    if (!createdVol) {
      throw new Error('Storage volume not found after creation')
    }
    this.debug.log(`Storage volume created successfully: ${createdVol.getName()}`)

    return createdVol
  }

  private async defineAndStartVM (xmlGenerator: XMLGenerator, machine: Machine): Promise<VirtualMachine> {
    if (!this.libvirt) {
      throw new Error('Libvirt connection not established')
    }
    const xml = xmlGenerator.generate()
    const vm = VirtualMachine.defineXml(this.libvirt, xml)
    if (!vm) {
      const error = LibvirtError.lastError()
      this.debug.log('error', error.message)
      throw new Error('Failed to define VM')
    }
    this.debug.log('VM defined successfully', machine.name)

    const result = vm.create()
    if (result == null) {
      const error = LibvirtError.lastError()
      this.debug.log('error', error.message)
      throw new Error('Failed to start VM')
    }
    this.debug.log('VM started successfully', machine.name)

    return vm
  }

  private async updateMachineStatus (tx: any, machineId: string, status: string): Promise<void> {
    await tx.machine.update({
      where: { id: machineId },
      data: { status }
    })
    this.debug.log(`Machine status updated to ${status}`)
  }

  private async executeTransaction (transactionBody: (tx: any) => Promise<void>): Promise<void> {
    if (!this.prisma!.$transaction) {
      await transactionBody(this.prisma)
    } else {
      await this.prisma!.$transaction(transactionBody, { timeout: 20000 })
    }
  }

  private async createDefaultStoragePool (): Promise<StoragePool> {
    if (!this.libvirt) {
      throw new Error('Libvirt connection not established')
    }
    const poolName = process.env.INFINIBAY_STORAGE_POOL_NAME ?? 'default'
    const poolXml = `
          <pool type='dir'>
            <name>${poolName}</name>
            <target>
              <path>${process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'}/disks</path>
            </target>
          </pool>
        `
    // VIR_STORAGE_POOL_CREATE_WITH_BUILD_OVERWRITE	=	2 (0x2; 1 << 1)
    // Create the pool and perform pool build using the VIR_STORAGE_POOL_BUILD_OVERWRITE flag.
    const storagePool = StoragePool.defineXml(this.libvirt, poolXml)

    if (storagePool == null) {
      this.debug.log('error', 'Failed to define storage pool')
      throw new Error('Failed to define storage pool')
    }

    storagePool.build(0)
    storagePool.create(0)
    storagePool.setAutostart(true)
    return storagePool
  }

  private async getDefaultStoragePool (): Promise<StoragePool | null> {
    if (!this.libvirt) {
      throw new Error('Libvirt connection not established')
    }
    const poolName = process.env.INFINIBAY_STORAGE_POOL_NAME ?? 'default'
    let storagePool: StoragePool | null = null
    this.debug.log('Looking up storage pool', poolName)
    storagePool = StoragePool.lookupByName(this.libvirt, poolName)
    return storagePool
  }

  private async rollback (machine: Machine, newIsoPath: string | null) {
    // Delete the temporary ISO (only if it's in the temp directory)
    if (newIsoPath) {
      const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
      const tempIsoDir = process.env.INFINIBAY_ISO_TEMP_DIR ?? path.join(baseDir, 'iso', 'temp')

      // Only delete if the ISO is in the temp directory
      if (newIsoPath.includes(tempIsoDir)) {
        try {
          fs.unlinkSync(newIsoPath)
          this.debug.log(`Deleted temporary ISO: ${newIsoPath}`)
        } catch (e) {
          this.debug.log(`Error deleting temporary ISO: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }

    // Delete the storage volume
    const pool = await this.getDefaultStoragePool()
    if (!pool) {
      this.debug.log('Storage pool not found during rollback')
    } else {
      const vol = StorageVol.lookupByName(pool, `${machine.internalName}-main.qcow2`)
      if (vol) {
        try {
          if (vol.delete(0) !== 0) {
            const err = LibvirtError.lastError()
            this.debug.log('Error deleting storage volume', err.message)
          }
        } catch (e) {
          this.debug.log('Error deleting storage volume', e instanceof Error ? e.message : String(e))
        }
      }
    }

    // Delegate cleanup to MachineCleanupService
    if (this.prisma) {
      const cleanup = new MachineCleanupService(this.prisma)
      await cleanup.cleanupVM(machine.id)
    }
    this.debug.log('Rollback completed for machine', machine.id)
  }

  async generateXML (
    machine: Machine,
    template: MachineTemplate | null,
    configuration: MachineConfiguration,
    newIsoPath: string | null,
    pciBus: string | null
  ): Promise<XMLGenerator> {
    // Log the start of the XML generation
    this.debug.log('Starting to generate XML for machine', machine.name)

    // Check if the Prisma client is set
    if (!this.prisma) {
      throw new Error('Prisma client not set')
    }

    // Get the machine's internal name and operating system
    const machineName = machine.internalName

    // Log the creation of a new XMLGenerator instance
    this.debug.log('Creating new XMLGenerator instance for machine', machine.name)

    // Create a new XMLGenerator instance
    const xmlGenerator = new XMLGenerator(machineName, machine.id, machine.os)

    // Set the machine's properties - use machine values when no template
    const ram = template ? template.ram : machine.ramGB
    const storage = template ? template.storage : machine.diskSizeGB
    const cores = template ? template.cores : machine.cpuCores
    
    xmlGenerator.setMemory(ram)
    xmlGenerator.enableTPM('2.0')
    xmlGenerator.setStorage(storage)
    xmlGenerator.setUEFI()
    xmlGenerator.addNetworkInterface(process.env.BRIDGE_NAME ?? 'default', 'virtio')
    const vmFilter = await this.prisma.vMNWFilter.findFirst({ where: { vmId: machine.id } })
    if (vmFilter) {
      const filter = await this.prisma.nWFilter.findFirst({ where: { id: vmFilter.nwFilterId } })
      if (!filter) {
        console.error('Filter not found')
      } else {
        // Ensure the filter exists in libvirt before using it
        try {
          const { NetworkFilterService } = await import('@services/networkFilterService')
          const networkFilterService = new NetworkFilterService(this.prisma)
          await networkFilterService.connect()
          await networkFilterService.flushNWFilter(filter.id, true)
          await networkFilterService.close()
          xmlGenerator.addNWFilter(filter.internalName)
        } catch (error) {
          console.error('Error ensuring network filter exists in libvirt:', error)
          // Continue without filter if it fails
        }
      }
    }
    xmlGenerator.setBootDevice(['hd', 'cdrom'])
    xmlGenerator.addAudioDevice()
    xmlGenerator.setVCPUs(cores)
    xmlGenerator.setCpuPinningOptimization()
    if (newIsoPath) {
      xmlGenerator.addCDROM(newIsoPath, 'sata')
      xmlGenerator.addVirtIODrivers()
    }

    // Enable high-resolution graphics for the VM
    xmlGenerator.enableHighResolutionGraphics()

    // Add USB tablet input device for better mouse synchronization
    xmlGenerator.enableInputTablet()

    // Add QEMU Guest Agent channel to the VM configuration
    xmlGenerator.addGuestAgentChannel()

    // Add InfiniService channel for metrics collection
    xmlGenerator.addInfiniServiceChannel()

    // Get a new port for the machine
    this.debug.log('Getting new port for machine', machine.name)

    // Add a VNC server to the machine
    // const vncPassword = xmlGenerator.addVNC(-1, true, '0.0.0.0');

    // add SPICE
    const spicePassword = xmlGenerator.addSPICE(true, false)

    // Add a gpu
    if (pciBus != null) {
      xmlGenerator.addGPUPassthrough(pciBus)
    }

    // Update the machine configuration with the new port
    // configuration.vncPort = -1;
    // configuration.vncListen = '0.0.0.0';
    // configuration.vncPassword = vncPassword;
    // configuration.vncAutoport = true;
    // configuration.vncHost = process.env.APP_HOST || '0.0.0.0';

    // Save the machine configuration
    this.debug.log('Updating machine configuration in database')
    await this.prisma.machineConfiguration.update({
      where: { id: configuration.id },
      data: {
        xml: xmlGenerator.getXmlObject(),
        graphicProtocol: 'spice',
        graphicPassword: spicePassword,
        graphicHost: process.env.APP_HOST || '0.0.0.0',
        graphicPort: -1,
        assignedGpuBus: pciBus
      }
    })

    // Log the completion of the XML generation
    this.debug.log('XML generation for machine completed', machine.name)

    // Return the generated XML
    return xmlGenerator
  }

  async getGraphicsInfo (): Promise<Array<any>> {
    try {
      const data = (await si.graphics()).controllers
      return data.filter((controller: any) => ALLOWED_GPU_VENDORS.includes(controller.vendor))
      // TODO: discard already used gpus
    } catch (error) {
      return []
    }
  }
}
