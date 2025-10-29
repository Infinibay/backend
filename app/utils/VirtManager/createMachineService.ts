import fs from 'fs'
import path from 'path'
import si from 'systeminformation'

import { MachineConfiguration, PrismaClient, Machine, MachineTemplate } from '@prisma/client'
import { Connection, Machine as VirtualMachine, StoragePool, StorageVol, Error as LibvirtError } from '@infinibay/libvirt-node'

import { Debugger } from '@utils/debug'
import { XMLGenerator } from '@utils/VirtManager/xmlGenerator'
import { FirewallManager } from '@services/firewall/FirewallManager'
import { MachineCleanupService } from '@services/cleanup/machineCleanupService'
import { UnattendedManagerBase } from '@services/unattendedManagerBase'
import { UnattendedRedHatManager } from '@services/unattendedRedHatManager'
import { UnattendedUbuntuManager } from '@services/unattendedUbuntuManager'
import { UnattendedWindowsManager } from '@services/unattendedWindowsManager'
import { getLibvirtConnection } from '@utils/libvirt'

const ALLOWED_GPU_VENDORS = [
  'NVIDIA Corporationß',
  'Advanced Micro Devices, Inc. [AMD/ATI]'
]

export class CreateMachineService {
  private prisma: PrismaClient | null = null
  public libvirt: Connection | null = null
  private debug: Debugger = new Debugger('virt-manager')
  private firewallManager: FirewallManager | null = null

  /**
   * Creates a new CreateMachineService instance.
   *
   * IMPORTANT: This constructor now uses the singleton libvirt connection from
   * getLibvirtConnection() to ensure the same connection is used across the
   * application (including Prisma callbacks). The uri parameter is deprecated
   * and ignored.
   *
   * @param uri - Deprecated, ignored (kept for backward compatibility)
   * @param prisma - Prisma client instance
   */
  constructor (uri: string = 'qemu:///system', prisma: PrismaClient | null = null) {
    this.debug.log('Creating VirtManager instance (using singleton connection)')
    this.prisma = prisma

    // Use singleton connection instead of opening a new one
    // This is initialized asynchronously in the create method
  }

  /**
   * Initializes the libvirt connection and FirewallManager.
   * Called at the start of the create() method.
   */
  private async initializeConnection (): Promise<void> {
    if (!this.libvirt) {
      try {
        this.libvirt = await getLibvirtConnection()
        this.debug.log('info', 'Libvirt connection initialized via singleton')

        // Initialize FirewallManager with the singleton connection
        if (this.prisma && this.libvirt) {
          this.firewallManager = new FirewallManager(this.prisma, this.libvirt)
        }
      } catch (error) {
        this.debug.log('error', `Failed to initialize libvirt connection: ${(error as Error).message}`)
        throw new Error(`Failed to initialize libvirt connection: ${(error as Error).message}`)
      }
    }
  }

  async create (machine: Machine, username: string, password: string, productKey: string | undefined, pciBus: string | null): Promise<boolean> {
    this.debug.log('Creating machine', machine.name)
    let newIsoPath: string | null = null
    let diskPath: string | null = null

    try {
      // Initialize the singleton libvirt connection
      await this.initializeConnection()

      await this.validatePreconditions()
      const template = await this.fetchMachineTemplate(machine)
      const configuration = await this.fetchMachineConfiguration(machine)
      const applications = await this.fetchMachineApplications(machine)
      const scripts = await this.fetchMachineScripts(machine)

      const unattendedManager = this.createUnattendedManager(machine, username, password, productKey, applications, scripts)
      newIsoPath = await unattendedManager.generateNewImage()

      // Update status to 'building' in a quick transaction
      await this.executeTransaction(async (tx: any) => {
        await this.updateMachineStatus(tx, machine.id, 'building')
      })

      // Perform long-running operations outside transaction
      const storagePool = await this.ensureStoragePool()
      // Use machine's diskSizeGB if no template, otherwise use template's storage
      const storageSize = template ? template.storage : machine.diskSizeGB
      const storageVolume = await this.createStorageVolume(storagePool, machine, storageSize)
      // Get the actual disk path from the created volume
      diskPath = storageVolume.getPath()
      if (!diskPath) {
        throw new Error('Failed to get disk path from storage volume')
      }

      /**
       * Verifies firewall infrastructure created by Prisma callbacks.
       *
       * The afterCreateMachine callback (in utils/modelCallbacks/machine.ts) should have
       * already created the FirewallRuleSet and nwfilters in libvirt when the machine
       * record was inserted into the database.
       *
       * This call primarily serves as:
       * - Verification that the callback succeeded
       * - Fallback creation for legacy VMs/departments (created before callbacks)
       * - Final check before VM definition in libvirt
       */
      this.debug.log('info', `Verifying firewall infrastructure for VM ${machine.id} (should exist from afterCreateMachine callback)`)

      if (!this.firewallManager) {
        throw new Error('FirewallManager not initialized')
      }
      if (!machine.departmentId) {
        throw new Error(`Machine ${machine.id} has no department assigned`)
      }

      const firewallResult = await this.firewallManager.ensureFirewallForVM(machine.id, machine.departmentId)
      this.debug.log('info', `Firewall verification: dept=${firewallResult.departmentRulesApplied} rules, vm=${firewallResult.vmRulesApplied} rules (infrastructure created by callbacks)`)

      // Generate XML with the actual disk path (now includes nwfilter refs)
      const xmlGenerator = await this.generateXML(machine, template, configuration, newIsoPath, pciBus, diskPath)
      await this.defineAndStartVM(xmlGenerator, machine)

      // Update status to 'running' in a quick transaction
      await this.executeTransaction(async (tx: any) => {
        await this.updateMachineStatus(tx, machine.id, 'running')
      })

      return true
    } catch (error: any) {
      this.debug.log('error', `Error creating machine: ${error}`)
      this.debug.log('error', error.stack)
      await this.rollback(machine, newIsoPath)
      throw new Error(`Error creating machine ${error}: ${error.stack}`)
    }
  }

  private async validatePreconditions (): Promise<void> {
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

  private async fetchMachineScripts (machine: Machine): Promise<any[]> {
    const scriptExecutions = await this.prisma!.scriptExecution.findMany({
      where: {
        machineId: machine.id,
        executionType: 'FIRST_BOOT',
        status: 'PENDING'
      },
      include: { script: true }
    })

    this.debug.log('Fetched first-boot scripts for machine', machine.name)

    return scriptExecutions.map(execution => ({
      script: execution.script,
      inputValues: execution.inputValues,
      executionId: execution.id
    }))
  }

  private createUnattendedManager (machine: Machine, username: string, password: string, productKey: string | undefined, applications: any[], scripts: any[]): UnattendedManagerBase {
    const osManagers = {
      windows10: () => new UnattendedWindowsManager(10, username, password, productKey, applications, machine.id, scripts),
      windows11: () => new UnattendedWindowsManager(11, username, password, productKey, applications, machine.id, scripts),
      ubuntu: () => new UnattendedUbuntuManager(username, password, applications, machine.id, scripts),
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
    const volumeName = `${machine.internalName}-main.qcow2`
    const volXml = `
    <volume>
        <name>${volumeName}</name>
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

    // Comment 5: Check for pre-existing volume name collision
    const existingVol = StorageVol.lookupByName(storagePool, volumeName)
    if (existingVol) {
      const error = new Error(
        `Storage volume with name '${volumeName}' already exists for machine ${machine.name}. ` +
        'This may indicate a previous failed creation. Please clean up the existing volume or use a different machine name.'
      )
      this.debug.log('error', error.message)
      throw error
    }

    this.debug.log(`Creating storage volume for machine ${machine.name} volXml: ${volXml}`)
    // Use VIR_STORAGE_VOL_CREATE_PREALLOC_METADATA (flag 1) to ensure metadata is written to disk
    const vol = StorageVol.createXml(storagePool, volXml, 1)
    if (!vol) {
      // Comment 2: Capture and log libvirt lastError when volume creation returns null
      const libvirtError = LibvirtError.lastError()
      const errorMessage = libvirtError?.message || 'Unknown libvirt error'
      this.debug.log('error', `Failed to create storage volume: ${errorMessage}`)
      throw new Error(`Failed to create storage volume for machine ${machine.name}: ${errorMessage}`)
    }

    // Refresh storage pool to synchronize libvirt's state with the filesystem
    this.debug.log(`Refreshing storage pool after volume creation for machine ${machine.name}`)
    // Comment 3: Check and log result of storagePool.refresh(0) to catch refresh failures
    const refreshResult = storagePool.refresh(0)
    if (refreshResult == null) {
      const libvirtError = LibvirtError.lastError()
      const errorMessage = libvirtError?.message || 'Unknown libvirt error'
      this.debug.log('error', `Failed to refresh storage pool: ${errorMessage}`)
      // Don't throw here - continue with verification as the volume might still be usable
    }

    // Comment 4: Use the returned vol object directly instead of redundant lookup
    const createdVol = vol

    // Verify the file actually exists on the filesystem
    const volPath = createdVol.getPath()
    // Comment 1: Guard against null/undefined from createdVol.getPath() before fs.existsSync()
    if (!volPath) {
      const libvirtError = LibvirtError.lastError()
      const errorMessage = libvirtError?.message || 'Unknown libvirt error'
      this.debug.log('error', `Failed to get volume path: ${errorMessage}`)
      throw new Error(`Failed to get volume path for machine ${machine.name}: ${errorMessage}`)
    }

    this.debug.log(`Verifying storage volume file exists at path: ${volPath}`)
    if (!fs.existsSync(volPath)) {
      throw new Error(`Storage volume file does not exist on filesystem at path: ${volPath} for machine ${machine.name}`)
    }

    this.debug.log(`Storage volume created and verified successfully: ${createdVol.getName()} at ${volPath}`)

    return createdVol
  }

  private async defineAndStartVM (xmlGenerator: XMLGenerator, machine: Machine): Promise<VirtualMachine> {
    if (!this.libvirt) {
      throw new Error('Libvirt connection not established')
    }
    const xml = xmlGenerator.generate()

    // Log the XML for debugging
    this.debug.log('VM XML to be defined:\n', xml)

    const vm = VirtualMachine.defineXml(this.libvirt, xml)
    if (!vm) {
      const error = LibvirtError.lastError()
      this.debug.log('error', `Failed to define VM. Libvirt error: ${error.message}`)
      this.debug.log('error', `VM XML that failed:\n${xml}`)
      throw new Error(`Failed to define VM: ${error.message}`)
    }
    this.debug.log('VM defined successfully', machine.name)

    const result = vm.create()
    if (result == null) {
      const error = LibvirtError.lastError()
      this.debug.log('error', `Failed to start VM. Libvirt error: ${error.message}`)
      throw new Error(`Failed to start VM: ${error.message}`)
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

  /**
   * Creates the default storage pool for VM disk images.
   *
   * Configuration:
   * - Pool name: INFINIBAY_STORAGE_POOL_NAME (default: 'default')
   * - Pool path: INFINIBAY_STORAGE_POOL_PATH (default: '${INFINIBAY_BASE_DIR}/disks' or '/opt/infinibay/disks')
   *
   * IMPORTANT: The pool path may differ across hosts depending on environment configuration.
   * Always use StorageVol.getPath() to get the actual file path rather than hardcoding paths.
   * This ensures VM domain XML references the correct location where volumes are created.
   *
   * Environment Variables:
   * - INFINIBAY_STORAGE_POOL_NAME: Custom pool name (optional)
   * - INFINIBAY_STORAGE_POOL_PATH: Custom pool directory path (optional, overrides default)
   * - INFINIBAY_BASE_DIR: Base directory for Infinibay data (optional, default: '/opt/infinibay')
   */
  private async createDefaultStoragePool (): Promise<StoragePool> {
    if (!this.libvirt) {
      throw new Error('Libvirt connection not established')
    }
    const poolName = process.env.INFINIBAY_STORAGE_POOL_NAME ?? 'default'

    // Allow explicit pool path override, otherwise use BASE_DIR/disks pattern
    const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
    const poolPath = process.env.INFINIBAY_STORAGE_POOL_PATH ?? `${baseDir}/disks`

    const poolXml = `
          <pool type='dir'>
            <name>${poolName}</name>
            <target>
              <path>${poolPath}</path>
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
    pciBus: string | null,
    diskPath: string
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
    // Use the actual disk path from the created volume instead of hardcoding
    xmlGenerator.addDisk(diskPath, 'virtio', storage)
    xmlGenerator.setUEFI()
    // Use libvirt virtual network name - XMLGenerator will automatically detect if it's a bridge or network type
    xmlGenerator.addNetworkInterface(process.env.LIBVIRT_NETWORK_NAME ?? 'default', 'virtio')

    // Apply firewall nwfilters to the VM XML (filters must exist in libvirt before this)
    // IMPORTANT: Only add the VM filter to the VM XML. The VM filter inherits from the
    // department filter via <filterref> in the filter definition itself (not in VM XML).
    // Libvirt does NOT support multiple <filterref> elements in a single interface.
    if (!this.firewallManager) {
      throw new Error('FirewallManager not initialized')
    }
    const filterNames = await this.firewallManager.getFilterNames(machine.id)
    const { vmFilterName } = filterNames
    // Only add VM filter - it inherits from department filter automatically
    xmlGenerator.addVMNWFilter(vmFilterName)

    xmlGenerator.setBootDevice(['hd', 'cdrom'])
    xmlGenerator.addAudioDevice()
    xmlGenerator.setVCPUs(cores)
    xmlGenerator.setCpuPinningOptimization()
    if (newIsoPath) {
      xmlGenerator.addCDROM(newIsoPath, 'sata')
      await xmlGenerator.addVirtIODrivers()
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
