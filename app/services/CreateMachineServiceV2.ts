/**
 * CreateMachineServiceV2 - VM creation using infinivirt.
 *
 * This service replaces the libvirt-based CreateMachineService with
 * infinivirt, providing direct QEMU management via QMP protocol.
 *
 * Key differences from V1:
 * - Uses QemuImgService instead of libvirt StoragePool/StorageVol
 * - Uses QemuCommandBuilder instead of XMLGenerator
 * - Uses NftablesService instead of libvirt nwfilters
 * - Uses QemuProcess for direct QEMU process management
 *
 * @example
 * ```typescript
 * const service = new CreateMachineServiceV2(prisma)
 * const result = await service.create(machine, username, password, productKey, pciBus)
 * ```
 */

import fs from 'fs'
import path from 'path'
import si from 'systeminformation'
import portfinder from 'portfinder'

import { PrismaClient, Machine, MachineTemplate, MachineConfiguration } from '@prisma/client'
import {
  Infinivirt,
  VMCreateConfig,
  DiskConfig,
  UnattendedInstallConfig,
  UnattendedApplication,
  UnattendedScript
} from '@infinibay/infinivirt'

import { Debugger } from '@utils/debug'
import { getInfinivirt } from '@services/InfinivirtService'
import { UnattendedManagerBase } from '@services/unattendedManagerBase'
import { UnattendedRedHatManager } from '@services/unattendedRedHatManager'
import { UnattendedUbuntuManager } from '@services/unattendedUbuntuManager'
import { UnattendedWindowsManager } from '@services/unattendedWindowsManager'

const ALLOWED_GPU_VENDORS = [
  'NVIDIA Corporation',
  'Advanced Micro Devices, Inc. [AMD/ATI]'
]

/**
 * Result of VM creation
 */
export interface CreateMachineResult {
  success: boolean
  vmId: string
  displayPort: number
  displayPassword?: string
  error?: string
}

export class CreateMachineServiceV2 {
  private prisma: PrismaClient
  private debug: Debugger

  constructor (prisma: PrismaClient) {
    this.debug = new Debugger('create-machine-v2')
    this.prisma = prisma
  }

  /**
   * Creates and starts a new VM using infinivirt.
   *
   * @param machine - Machine record from database
   * @param username - Username for unattended installation
   * @param password - Password for unattended installation
   * @param productKey - Windows product key (optional)
   * @param pciBus - GPU PCI address for passthrough (optional)
   * @returns Promise<boolean> indicating success
   */
  async create (
    machine: Machine,
    username: string,
    password: string,
    productKey: string | undefined,
    pciBus: string | null
  ): Promise<boolean> {
    this.debug.log(`Creating machine ${machine.name} using infinivirt`)

    try {
      // Validate preconditions
      this.validatePreconditions(machine)

      // Fetch related data
      const template = await this.fetchMachineTemplate(machine)
      const configuration = await this.fetchMachineConfiguration(machine)
      const applications = await this.fetchMachineApplications(machine)
      const scripts = await this.fetchMachineScripts(machine)

      // Update status to 'building'
      await this.updateMachineStatus(machine.id, 'building')

      // Get infinivirt instance
      const infinivirt = await getInfinivirt()

      // Prepare VM configuration
      const vmConfig = await this.buildVMConfig(
        machine,
        template,
        configuration,
        username,
        password,
        productKey,
        applications,
        scripts,
        pciBus
      )

      // Create and start VM via infinivirt
      this.debug.log('Creating VM via infinivirt')
      const result = await infinivirt.createVM(vmConfig)

      if (!result.success) {
        throw new Error(`Failed to create VM: ${result.vmId}`)
      }

      this.debug.log(`VM created successfully: ${result.vmId}`)
      this.debug.log(`  - Display port: ${result.displayPort}`)
      this.debug.log(`  - Disk paths: ${result.diskPaths.join(', ')}`)
      this.debug.log(`  - TAP device: ${result.tapDevice}`)
      this.debug.log(`  - PID: ${result.pid}`)

      // Update machine configuration with runtime values
      await this.prisma.machineConfiguration.update({
        where: { machineId: machine.id },
        data: {
          graphicProtocol: vmConfig.displayType,
          graphicPort: result.displayPort,
          graphicPassword: vmConfig.displayPassword ?? null,
          graphicHost: vmConfig.displayAddr ?? '0.0.0.0',
          qmpSocketPath: result.qmpSocketPath,
          qemuPid: result.pid,
          tapDeviceName: result.tapDevice,
          assignedGpuBus: pciBus
        }
      })

      // Status is already set to 'running' by infinivirt
      // Update anyway to ensure consistency
      await this.updateMachineStatus(machine.id, 'running')

      return true
    } catch (error: any) {
      this.debug.log('error', `Error creating machine: ${error.message}`)
      this.debug.log('error', error.stack)

      // Rollback
      await this.rollback(machine)

      throw new Error(`Error creating machine: ${error.message}`)
    }
  }

  // ===========================================================================
  // Private Helper Methods
  // ===========================================================================

  private validatePreconditions (machine: Machine): void {
    if (!machine.departmentId) {
      throw new Error(`Machine ${machine.id} has no department assigned`)
    }
  }

  private async fetchMachineTemplate (machine: Machine): Promise<MachineTemplate | null> {
    if (!machine.templateId) {
      return null
    }
    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: machine.templateId }
    })
    if (!template) {
      throw new Error(`Template not found for machine ${machine.name}`)
    }
    return template
  }

  private async fetchMachineConfiguration (machine: Machine): Promise<MachineConfiguration> {
    const configuration = await this.prisma.machineConfiguration.findUnique({
      where: { machineId: machine.id }
    })
    if (!configuration) {
      throw new Error(`Configuration not found for machine ${machine.name}`)
    }
    return configuration
  }

  private async fetchMachineApplications (machine: Machine): Promise<any[]> {
    const applications = await this.prisma.machineApplication.findMany({
      where: { machineId: machine.id },
      include: { application: true }
    })
    return applications.map((ma) => ma.application)
  }

  private async fetchMachineScripts (machine: Machine): Promise<any[]> {
    const scriptExecutions = await this.prisma.scriptExecution.findMany({
      where: {
        machineId: machine.id,
        executionType: 'FIRST_BOOT',
        status: 'PENDING'
      },
      include: { script: true }
    })

    return scriptExecutions.map(execution => ({
      script: execution.script,
      inputValues: execution.inputValues,
      executionId: execution.id
    }))
  }

  /**
   * Builds the VMCreateConfig for infinivirt.
   */
  private async buildVMConfig (
    machine: Machine,
    template: MachineTemplate | null,
    configuration: MachineConfiguration,
    username: string,
    password: string,
    productKey: string | undefined,
    applications: any[],
    scripts: any[],
    pciBus: string | null
  ): Promise<VMCreateConfig> {
    // Get hardware specs (template takes precedence)
    const ramGB = template ? template.ram : machine.ramGB
    const cpuCores = template ? template.cores : machine.cpuCores
    const diskSizeGB = template ? template.storage : machine.diskSizeGB

    // Get network bridge
    const bridge = process.env.LIBVIRT_BRIDGE_NAME ??
                   process.env.LIBVIRT_NETWORK_NAME ??
                   'virbr0'

    // Find available SPICE port
    const displayPort = await this.findAvailablePort(5900)

    // Generate display password
    const displayPassword = this.generatePassword()

    // Build disk configuration
    const disks: DiskConfig[] = [
      {
        sizeGB: diskSizeGB,
        format: 'qcow2',
        discard: true
      }
    ]

    // Get ISO path for OS installation
    const isoPath = await this.getOSIsoPath(machine.os)

    // Build unattended installation config
    const unattendedInstall = this.buildUnattendedConfig(
      machine,
      username,
      password,
      productKey,
      applications,
      scripts
    )

    // Determine if Windows (for VirtIO drivers ISO)
    const isWindows = machine.os.toLowerCase().includes('windows')
    const virtioDriversIso = isWindows
      ? process.env.VIRTIO_WIN_ISO ?? '/usr/share/virtio-win/virtio-win.iso'
      : undefined

    // Build base directories
    const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
    const socketDir = process.env.INFINIVIRT_SOCKET_DIR ?? '/var/run/infinivirt'

    // Build the VMCreateConfig
    const config: VMCreateConfig = {
      vmId: machine.id,
      name: machine.name,
      internalName: machine.internalName,
      os: machine.os,
      cpuCores,
      ramGB,
      disks,
      bridge,
      displayType: 'spice',
      displayPort,
      displayPassword,
      displayAddr: process.env.APP_HOST ?? '0.0.0.0',

      // Optional hardware configuration
      gpuPciAddress: pciBus ?? undefined,

      // UEFI for modern OS
      uefiFirmware: this.getUefiFirmwarePath(machine.os),

      // ISO for installation
      isoPath,

      // Unattended installation
      unattendedInstall,

      // VirtIO drivers for Windows
      virtioDriversIso: virtioDriversIso && fs.existsSync(virtioDriversIso)
        ? virtioDriversIso
        : undefined,

      // Advanced devices
      enableAudio: true,
      enableUsbTablet: true,

      // TPM for Windows 11
      tpmSocketPath: machine.os.toLowerCase().includes('windows11')
        ? path.join(socketDir, 'tpm', `${machine.internalName}.sock`)
        : undefined,

      // Guest agent and InfiniService channels
      guestAgentSocketPath: path.join(socketDir, 'ga', `${machine.internalName}.sock`),
      infiniServiceSocketPath: path.join(socketDir, 'infini', `${machine.internalName}.sock`)
    }

    return config
  }

  /**
   * Builds UnattendedInstallConfig from legacy unattended managers.
   */
  private buildUnattendedConfig (
    machine: Machine,
    username: string,
    password: string,
    productKey: string | undefined,
    applications: any[],
    scripts: any[]
  ): UnattendedInstallConfig | undefined {
    const os = machine.os.toLowerCase()

    // Map applications to infinivirt format
    const mappedApps: UnattendedApplication[] = applications.map(app => ({
      name: app.name,
      command: app.installCommand ?? `${app.downloadUrl}`,
      commandType: this.mapInstallCommandType(app),
      silent: app.silentInstall ?? true
    }))

    // Map scripts to infinivirt format
    const mappedScripts: UnattendedScript[] = scripts.map(s => ({
      name: s.script.name,
      content: s.script.content,
      shell: s.script.shell ?? 'bash',
      runAsAdmin: s.script.runAsAdmin ?? false,
      inputValues: s.inputValues
    }))

    // Determine OS type for unattended config
    let osType: 'ubuntu' | 'fedora' | 'windows10' | 'windows11'
    if (os.includes('ubuntu')) {
      osType = 'ubuntu'
    } else if (os.includes('fedora') || os.includes('redhat') || os.includes('rhel')) {
      osType = 'fedora'
    } else if (os.includes('windows11')) {
      osType = 'windows11'
    } else if (os.includes('windows')) {
      osType = 'windows10'
    } else {
      // No unattended installation for unsupported OS
      return undefined
    }

    return {
      vmId: machine.id,
      os: osType,
      username,
      password,
      productKey,
      applications: mappedApps,
      scripts: mappedScripts,
      locale: 'en_US.UTF-8',
      timezone: process.env.TIMEZONE ?? 'America/New_York'
    }
  }

  private mapInstallCommandType (app: any): 'exe' | 'msi' | 'powershell' | 'shell' | 'url' {
    if (app.installCommand?.endsWith('.msi')) return 'msi'
    if (app.installCommand?.endsWith('.exe')) return 'exe'
    if (app.installCommand?.startsWith('powershell')) return 'powershell'
    if (app.downloadUrl) return 'url'
    return 'shell'
  }

  private getUefiFirmwarePath (os: string): string | undefined {
    // Most modern OS need UEFI
    const needsUefi = os.toLowerCase().includes('windows') ||
                      os.toLowerCase().includes('ubuntu') ||
                      os.toLowerCase().includes('fedora')

    if (!needsUefi) return undefined

    // Common UEFI firmware paths
    const firmwarePaths = [
      '/usr/share/OVMF/OVMF_CODE.fd',
      '/usr/share/edk2/ovmf/OVMF_CODE.fd',
      '/usr/share/qemu/OVMF_CODE.fd'
    ]

    for (const p of firmwarePaths) {
      if (fs.existsSync(p)) return p
    }

    return undefined
  }

  private async getOSIsoPath (os: string): Promise<string | undefined> {
    const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
    const isoDir = process.env.INFINIBAY_ISO_DIR ?? path.join(baseDir, 'iso')

    // Map OS to expected ISO filename patterns
    const osLower = os.toLowerCase()
    let patterns: string[] = []

    if (osLower.includes('ubuntu')) {
      patterns = ['ubuntu-*.iso', 'ubuntu*.iso']
    } else if (osLower.includes('windows11')) {
      patterns = ['Win11*.iso', 'windows11*.iso']
    } else if (osLower.includes('windows10')) {
      patterns = ['Win10*.iso', 'windows10*.iso']
    } else if (osLower.includes('fedora')) {
      patterns = ['Fedora*.iso', 'fedora*.iso']
    }

    // Find first matching ISO
    if (fs.existsSync(isoDir)) {
      const files = fs.readdirSync(isoDir)
      for (const pattern of patterns) {
        const regex = new RegExp(pattern.replace('*', '.*'), 'i')
        const match = files.find(f => regex.test(f))
        if (match) {
          return path.join(isoDir, match)
        }
      }
    }

    return undefined
  }

  private async findAvailablePort (basePort: number): Promise<number> {
    try {
      portfinder.basePort = basePort
      return await portfinder.getPortPromise()
    } catch {
      // Fallback to random port in SPICE range
      return basePort + Math.floor(Math.random() * 100)
    }
  }

  private generatePassword (length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let password = ''
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return password
  }

  private async updateMachineStatus (machineId: string, status: string): Promise<void> {
    await this.prisma.machine.update({
      where: { id: machineId },
      data: { status }
    })
    this.debug.log(`Machine status updated to ${status}`)
  }

  private async rollback (machine: Machine): Promise<void> {
    this.debug.log(`Rolling back machine ${machine.id}`)

    try {
      // Get infinivirt and stop the VM if running
      const infinivirt = await getInfinivirt()
      const status = await infinivirt.getVMStatus(machine.id)

      if (status.processAlive) {
        this.debug.log('Stopping VM during rollback')
        await infinivirt.stopVM(machine.id, { force: true })
      }
    } catch (error: any) {
      this.debug.log('warn', `Error during rollback stop: ${error.message}`)
    }

    // Update status to error
    try {
      await this.updateMachineStatus(machine.id, 'error')
    } catch {
      // Ignore status update errors during rollback
    }

    this.debug.log('Rollback completed')
  }

  /**
   * Gets available GPU information.
   */
  async getGraphicsInfo (): Promise<Array<any>> {
    try {
      const data = (await si.graphics()).controllers
      return data.filter((controller: any) =>
        ALLOWED_GPU_VENDORS.includes(controller.vendor)
      )
    } catch {
      return []
    }
  }
}
