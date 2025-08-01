import { PrismaClient } from '@prisma/client'
import { unlink } from 'fs/promises'
import { existsSync } from 'fs'
import {
  Connection,
  Machine,
  VirDomainXMLFlags,
  Error as LibvirtNodeError,
  VirDomainDestroyFlags
} from 'libvirt-node'
import { XMLGenerator } from '../../utils/VirtManager/xmlGenerator'
import { Debugger } from '../../utils/debug'
import { parseStringPromise as xmlParse } from 'xml2js'

// Libvirt domain state constants
const VIR_DOMAIN_RUNNING = 1
const VIR_DOMAIN_PAUSED = 3
const VIR_DOMAIN_SHUTOFF = 5

/**
 * Service responsible for updating VM hardware configurations
 */
export class HardwareUpdateService {
  private prisma: PrismaClient
  private debug: Debugger
  private machineId: string
  private conn: Connection | null = null
  private domain: Machine | null = null
  private machine: any
  private currentXmlObj: any

  constructor (prisma: PrismaClient, machineId: string) {
    this.prisma = prisma
    this.machineId = machineId
    this.debug = new Debugger('hardware-update-service')
  }

  /**
   * Main method to update VM hardware
   */
  async updateHardware (): Promise<void> {
    try {
      // Step 1: Load machine data and prepare for update
      await this.loadMachineData()

      // Step 2: Connect to libvirt
      await this.connectToLibvirt()

      // Step 3: Ensure VM is shut off
      await this.ensureVmIsShutOff()

      // Step 4: Get and parse current XML
      await this.getCurrentXml()

      // Step 5: Generate new XML with updated hardware
      const newXmlString = await this.generateNewXml()

      // Step 6: Update the VM with new XML
      await this.updateVmWithNewXml(newXmlString)

      // Step 7: Update machine status in database
      await this.updateMachineStatus('off')

      this.debug.log(`Machine ${this.machine.internalName} hardware updated successfully`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.debug.log(`Error updating hardware for machine ${this.machineId}: ${errorMessage}`)

      // Update machine status to error
      await this.updateMachineStatus('error_hardware_update').catch(err => {
        this.debug.log(`Failed to update machine status: ${err instanceof Error ? err.message : String(err)}`)
      })

      throw error
    } finally {
      // Clean up resources
      await this.cleanupResources()
    }
  }

  /**
   * Step 1: Load machine data from database
   */
  private async loadMachineData (): Promise<void> {
    this.debug.log(`Loading machine data for ${this.machineId}`)

    this.machine = await this.prisma.machine.findUnique({
      where: { id: this.machineId },
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
    })

    if (!this.machine || !this.machine.internalName) {
      throw new Error(`Machine ${this.machineId} not found or has no internalName`)
    }

    await this.updateMachineStatus('updating_hardware')
  }

  /**
   * Step 2: Connect to libvirt
   */
  private async connectToLibvirt (): Promise<void> {
    this.debug.log(`Connecting to libvirt for machine ${this.machine.internalName}`)

    this.conn = await Connection.open('qemu:///system')
    if (!this.conn) {
      throw new Error('Failed to open libvirt connection')
    }

    this.domain = await Machine.lookupByName(this.conn, this.machine.internalName)
    if (!this.domain) {
      throw new Error(`Libvirt domain ${this.machine.internalName} not found`)
    }
  }

  /**
   * Step 3: Ensure VM is shut off
   */
  private async ensureVmIsShutOff (): Promise<void> {
    this.debug.log(`Checking state for ${this.machine.internalName}`)

    const stateResult = await this.domain!.getState()
    if (!stateResult) {
      throw new Error(`Failed to get state for domain ${this.machine.internalName}`)
    }

    const currentState = stateResult.result
    this.debug.log(`Machine ${this.machine.internalName} current state: ${currentState}`)

    if (currentState === VIR_DOMAIN_SHUTOFF) {
      this.debug.log(`Machine ${this.machine.internalName} is already shut off`)
      return
    }

    // If VM is running or paused, shut it down
    if (currentState === VIR_DOMAIN_RUNNING || currentState === VIR_DOMAIN_PAUSED) {
      await this.shutDownVm()
    }
  }

  /**
   * Helper method to shut down a running VM
   */
  private async shutDownVm (): Promise<void> {
    this.debug.log(`Shutting down machine ${this.machine.internalName}`)
    await this.updateMachineStatus('powering_off_update')

    // Try graceful shutdown first
    try {
      this.debug.log(`Attempting graceful shutdown for ${this.machine.internalName}`)
      await this.domain!.shutdown()
    } catch (shutdownError) {
      this.debug.log(`Graceful shutdown failed: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}`)

      // Try graceful destroy
      try {
        this.debug.log(`Attempting graceful destroy for ${this.machine.internalName}`)
        await this.domain!.destroyFlags(VirDomainDestroyFlags.VirDomainDestroyGraceful)
      } catch (destroyFlagsError) {
        this.debug.log(`Graceful destroy failed: ${destroyFlagsError instanceof Error ? destroyFlagsError.message : String(destroyFlagsError)}`)

        // Force destroy as last resort
        this.debug.log(`Forcing destroy for ${this.machine.internalName}`)
        await this.domain!.destroy()
      }
    }

    // Wait for VM to be fully shut off
    await this.waitForVmShutdown()
  }

  /**
   * Helper method to wait for VM to be fully shut off
   */
  private async waitForVmShutdown (): Promise<void> {
    this.debug.log(`Waiting for ${this.machine.internalName} to shut down`)

    let attempts = 0
    const maxAttempts = 24 // 2 minutes (5 seconds * 24)
    let currentState

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000))

      const stateResult = await this.domain!.getState()
      if (!stateResult) {
        this.debug.log(`Failed to get state during shutdown poll, attempt ${attempts + 1}`)
        attempts++
        continue
      }

      currentState = stateResult.result
      this.debug.log(`Machine state after shutdown attempt ${attempts + 1}: ${currentState}`)

      if (currentState === VIR_DOMAIN_SHUTOFF) {
        this.debug.log(`Machine ${this.machine.internalName} is now shut off`)
        return
      }

      attempts++
    }

    // If VM is still not shut off after max attempts, force destroy
    if (currentState !== VIR_DOMAIN_SHUTOFF) {
      this.debug.log(`VM did not shut down after ${maxAttempts} attempts, forcing destroy`)
      await this.domain!.destroy()

      // Verify VM is now shut off
      const finalStateResult = await this.domain!.getState()
      if (!finalStateResult || finalStateResult.result !== VIR_DOMAIN_SHUTOFF) {
        throw new Error(`Failed to shut down VM ${this.machine.internalName}`)
      }
    }
  }

  /**
   * Step 4: Get and parse current XML
   */
  private async getCurrentXml (): Promise<void> {
    this.debug.log(`Fetching XML for ${this.machine.internalName}`)

    const currentXmlString = await this.domain!.getXmlDesc(
      VirDomainXMLFlags.VirDomainXMLInactive | VirDomainXMLFlags.VirDomainXMLSecure
    )

    if (!currentXmlString) {
      throw new Error(`Could not retrieve XML for domain ${this.machine.internalName}`)
    }

    this.currentXmlObj = await xmlParse(currentXmlString, { explicitArray: false, explicitRoot: false })
  }

  /**
   * Step 5: Generate new XML with updated hardware
   */
  private async generateNewXml (): Promise<string> {
    this.debug.log(`Generating new XML for ${this.machine.internalName}`)

    const xmlGen = new XMLGenerator(this.machine.name, this.machine.id, this.machine.os)
    xmlGen.load(this.currentXmlObj)

    // Update CPU cores if specified
    if (this.machine.cpuCores) {
      this.debug.log(`Setting VCPUs to ${this.machine.cpuCores}`)
      xmlGen.setVCPUs(this.machine.cpuCores)
      xmlGen.setCpuPinningOptimization()
    }

    // Update RAM if specified
    if (this.machine.ramGB) {
      this.debug.log(`Setting RAM to ${this.machine.ramGB}GB`)
      xmlGen.setMemory(this.machine.ramGB)
    }

    // Handle GPU passthrough
    await this.handleGpuPassthrough(xmlGen)

    // Generate the final XML string
    return xmlGen.generate()
  }

  /**
   * Helper method to handle GPU passthrough configuration
   */
  private async handleGpuPassthrough (xmlGen: XMLGenerator): Promise<void> {
    // First, clean up any existing PCI hostdev entries
    if (xmlGen.getXmlObject().domain && xmlGen.getXmlObject().domain.devices) {
      const devices = Array.isArray(xmlGen.getXmlObject().domain.devices)
        ? xmlGen.getXmlObject().domain.devices[0]
        : xmlGen.getXmlObject().domain.devices

      if (devices.hostdev) {
        this.debug.log('Removing existing PCI hostdevs')

        // Ensure hostdev is an array
        const hostdevs = Array.isArray(devices.hostdev) ? devices.hostdev : [devices.hostdev]

        // Filter out PCI devices
        const filteredHostdevs = hostdevs.filter(
          (dev: any) => !(dev.$ && dev.$.type === 'pci' && dev.source)
        )

        if (filteredHostdevs.length === 0) {
          delete devices.hostdev
        } else {
          devices.hostdev = filteredHostdevs
        }
      }
    }

    // Add GPU passthrough if specified
    if (this.machine.gpuPciAddress) {
      this.debug.log(`Adding GPU passthrough ${this.machine.gpuPciAddress}`)
      xmlGen.addGPUPassthrough(this.machine.gpuPciAddress)
    }
  }

  /**
   * Step 6: Update the VM with new XML
   */
  private async updateVmWithNewXml (newXmlString: string): Promise<void> {
    this.debug.log(`Updating VM ${this.machine.internalName} with new XML`)

    // Check if VM has NVRAM
    const nvramPath = this.getNvramPath()

    if (nvramPath) {
      await this.updateVmWithNvram(newXmlString, nvramPath)
    } else {
      await this.updateVmWithoutNvram(newXmlString)
    }
  }

  /**
   * Helper method to get NVRAM path from XML
   */
  private getNvramPath (): string | null {
    if (this.currentXmlObj.os && this.currentXmlObj.os[0].nvram) {
      if (typeof this.currentXmlObj.os[0].nvram === 'string') {
        return this.currentXmlObj.os[0].nvram
      } else if (Array.isArray(this.currentXmlObj.os[0].nvram)) {
        return this.currentXmlObj.os[0].nvram[0]._
      } else if (typeof this.currentXmlObj.os[0].nvram === 'object') {
        return this.currentXmlObj.os[0].nvram._ || null
      }
    }
    return null
  }

  /**
   * Helper method to update VM with NVRAM
   */
  private async updateVmWithNvram (newXmlString: string, nvramPath: string): Promise<void> {
    this.debug.log(`VM has NVRAM at path: ${nvramPath}`)

    // Free the domain object to release resources
    if (this.domain) {
      await this.domain.free()
      this.domain = null
    }
    // Try to undefine with NVRAM removal flag
    try {
      this.debug.log('Undefining domain with NVRAM removal flag')
      const tempDomain = await Machine.lookupByName(this.conn!, this.machine.internalName)

      if (tempDomain) {
        // Use flag 2 to remove NVRAM file (VIR_DOMAIN_UNDEFINE_NVRAM)
        await tempDomain.undefineFlags(4)
        await tempDomain.free()
      }
    } catch (undefineError) {
      this.debug.log(`Error undefining domain with flags: ${undefineError instanceof Error ? undefineError.message : String(undefineError)}`)

      // If undefineFlags fails, try manual NVRAM removal
      await this.manuallyRemoveNvram(nvramPath)
    }

    // Define the VM with new XML
    this.debug.log('Defining VM with new XML after NVRAM handling')
    console.log('defining vm with new xml')
    console.log(newXmlString)
    await Machine.defineXml(this.conn!, newXmlString)
  }

  /**
   * Helper method to manually remove NVRAM file
   */
  private async manuallyRemoveNvram (nvramPath: string): Promise<void> {
    try {
      this.debug.log(`Attempting to manually remove NVRAM file: ${nvramPath}`)

      if (existsSync(nvramPath)) {
        await unlink(nvramPath)
        this.debug.log(`Successfully removed NVRAM file: ${nvramPath}`)
      }

      // Try to undefine the domain without the NVRAM file
      const tempDomain = await Machine.lookupByName(this.conn!, this.machine.internalName)
      if (tempDomain) {
        await tempDomain.undefine()
        await tempDomain.free()
      }
    } catch (manualRemoveError) {
      this.debug.log(`Error manually removing NVRAM: ${manualRemoveError instanceof Error ? manualRemoveError.message : String(manualRemoveError)}`)
      // Continue anyway, we'll try to define the new XML
    }
  }

  /**
   * Helper method to update VM without NVRAM
   */
  private async updateVmWithoutNvram (newXmlString: string): Promise<void> {
    this.debug.log('VM has no NVRAM, using standard undefine')

    if (this.domain) {
      try {
        await this.domain.undefine()
      } catch (undefineError) {
        this.debug.log(`Error undefining domain: ${undefineError instanceof Error ? undefineError.message : String(undefineError)}`)
      }

      await this.domain.free()
      this.domain = null
    }

    // Define the VM with new XML
    this.debug.log('Defining VM with new XML')
    await Machine.defineXml(this.conn!, newXmlString)
  }

  /**
   * Step 7: Update machine status in database
   */
  private async updateMachineStatus (status: string): Promise<void> {
    this.debug.log(`Updating machine ${this.machineId} status to ${status}`)

    await this.prisma.machine.update({
      where: { id: this.machineId },
      data: { status }
    })
  }

  /**
   * Clean up resources
   */
  private async cleanupResources (): Promise<void> {
    this.debug.log(`Cleaning up resources for ${this.machineId}`)

    if (this.domain) {
      try {
        await this.domain.free()
      } catch (e) {
        this.debug.log(`Error freeing domain: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    if (this.conn) {
      try {
        await this.conn.close()
      } catch (e) {
        this.debug.log(`Error closing libvirt connection: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
}
