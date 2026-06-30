/**
 * CreateMachineServiceV2 - VM creation using infinization.
 *
 * This service replaces the libvirt-based CreateMachineService with
 * infinization, providing direct QEMU management via QMP protocol.
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
import crypto from 'crypto'
import si from 'systeminformation'
import portfinder from 'portfinder'

import { PrismaClient, Machine, MachineTemplate, MachineConfiguration, GoldenImage } from '@prisma/client'

type TemplateWithGoldenImage = MachineTemplate & { goldenImage: GoldenImage | null }
import {
  VMCreateConfig,
  DiskConfig
} from '@infinibay/infinization'

import { Logger } from 'winston'
import logger from '@main/logger'
import { getInfinizationConfig } from '@services/InfinizationService'
import { NodeDispatcher } from '@services/node/NodeDispatcher'
import { validateUsernameStrict } from '@services/shellEscape'
import { DepartmentNetworkService } from '@services/network/DepartmentNetworkService'
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
  private debug: Logger
  private departmentNetworkService: DepartmentNetworkService
  // Path of the unattended ISO generated for this create (if any). Captured in
  // buildVMConfig so rollback can delete it by exact path on failure — the random
  // generated filenames have no vmId prefix to scan for.
  private generatedIsoPath?: string

  private dispatcher: NodeDispatcher

  constructor (prisma: PrismaClient, dispatcher?: NodeDispatcher) {
    this.debug = logger.child({ module: 'create-machine-v2' })
    this.prisma = prisma
    this.departmentNetworkService = new DepartmentNetworkService(prisma)
    // Multi-node routing: createVM (and rollback stop) run on the node that OWNS
    // the VM (Machine.nodeId). On a single-node cluster this resolves to the
    // local infinization, unchanged.
    this.dispatcher = dispatcher ?? new NodeDispatcher(prisma)
  }

  /**
   * Creates and starts a new VM using infinization.
   *
   * @param machine - Machine record from database
   * @param username - Username for unattended installation
   * @param password - Password for unattended installation
   * @param productKey - Windows product key (optional)
   * @param pciBus - GPU PCI address for passthrough (optional)
   * @param locale - Locale for unattended installation (e.g., 'en_US.UTF-8')
   * @param keyboard - Keyboard layout for unattended installation (e.g., 'us')
   * @param timezone - Timezone for unattended installation (e.g., 'America/New_York')
   * @returns Promise<boolean> indicating success
   */
  async create (
    machine: Machine,
    username: string,
    password: string,
    productKey: string | undefined,
    pciBus: string | null,
    locale: string,
    keyboard: string,
    timezone: string
  ): Promise<boolean> {
    this.debug.debug(`Creating machine ${machine.name} using infinization`)

    // Deterministic disk path (infinization names disk0 `${internalName}.qcow2`
    // in diskDir). Computed up front — and in scope for the catch — because
    // infinization deliberately does NOT delete the qcow2 on failure and the
    // backend only persists diskPaths to the DB on success, so rollback must
    // unlink this known path itself.
    const expectedDiskPath = path.join(getInfinizationConfig().diskDir, `${machine.internalName}.qcow2`)

    try {
      // Validate preconditions
      this.validatePreconditions(machine)
      this.validateGpuPassthrough(pciBus)

      // Fetch related data
      const template = await this.fetchMachineTemplate(machine)
      const configuration = await this.fetchMachineConfiguration(machine)
      const applications = await this.fetchMachineApplications(machine)
      const scripts = await this.fetchMachineScripts(machine)

      // Resolve the executor for the node that OWNS this VM (local or remote).
      const executor = await this.dispatcher.executorFor(machine.id)

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
        pciBus,
        locale,
        keyboard,
        timezone
      )

      // Create and start VM via infinization (on the owning node)
      this.debug.debug('Creating VM via infinization')
      const result = await executor.createVM(vmConfig)

      if (!result.success) {
        throw new Error(`Failed to create VM: ${result.vmId}`)
      }

      this.debug.debug(`VM created successfully: ${result.vmId}`)
      this.debug.debug(`  - Display port: ${result.displayPort}`)
      this.debug.debug(`  - Disk paths: ${result.diskPaths.join(', ')}`)
      this.debug.debug(`  - TAP device: ${result.tapDevice}`)
      this.debug.debug(`  - PID: ${result.pid}`)

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
          assignedGpuBus: pciBus,
          diskPaths: result.diskPaths,
          bridge: vmConfig.bridge,
          infiniServiceSocketPath: vmConfig.infiniServiceSocketPath,
          // Anchor the install clock at first boot so the stuck-install detector
          // can fail a hung unattended install past getInstallationTimeout(os).
          installStartedAt: new Date()
        }
      })

      // Machine.status will transition 'off' → 'starting' → 'running' via
      // QMP events handled by infinization. The orthogonal setupComplete
      // flag is set by VirtioSocketWatcherService when infiniservice
      // connects for the first time (signaling that OS install and the
      // initial agent handshake are done).
      this.debug.info(`VM ${machine.name} started - waiting for infiniservice connection`)

      return true
    } catch (error: any) {
      this.debug.error(`Error creating machine: ${error.message}`)
      this.debug.error(error.stack)

      // Rollback
      await this.rollback(machine, expectedDiskPath)

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

  /**
   * Pre-flight check for GPU passthrough. QEMU's `-device vfio-pci,host=...`
   * fails with a cryptic "Could not open /dev/vfio/N" if the device isn't bound
   * to vfio-pci. Catch that here with an actionable message instead.
   *
   * Verifies:
   *  - IOMMU is enabled (the device has an iommu_group symlink)
   *  - The host kernel exposes /dev/vfio/<group>
   *  - The device's current driver is vfio-pci (not nvidia, amdgpu, etc.)
   */
  private validateGpuPassthrough (pciBus: string | null): void {
    if (!pciBus) return

    // Normalize to the sysfs form: lower-case, with 0000: domain prefix.
    const addr = pciBus.toLowerCase().includes(':')
      ? pciBus.toLowerCase()
      : `0000:${pciBus.toLowerCase()}`
    const sysDevice = `/sys/bus/pci/devices/${addr}`

    if (!fs.existsSync(sysDevice)) {
      throw new Error(
        `GPU ${pciBus} not found on host (no ${sysDevice}). ` +
        'The PCI address may be stale; refresh the GPU list and pick again.'
      )
    }

    // iommu_group is a symlink → /sys/kernel/iommu_groups/<N>
    const iommuLink = path.join(sysDevice, 'iommu_group')
    if (!fs.existsSync(iommuLink)) {
      throw new Error(
        `IOMMU is not enabled for GPU ${pciBus}. ` +
        'Enable VT-d/AMD-Vi in BIOS and add intel_iommu=on (or amd_iommu=on) to the kernel cmdline.'
      )
    }
    const groupId = path.basename(fs.readlinkSync(iommuLink))
    const vfioGroupNode = `/dev/vfio/${groupId}`
    if (!fs.existsSync(vfioGroupNode)) {
      throw new Error(
        `GPU ${pciBus} is in IOMMU group ${groupId} but ${vfioGroupNode} doesn't exist. ` +
        'Bind the device (and every other device in the same IOMMU group) to vfio-pci before retrying.'
      )
    }

    // Confirm the device itself is bound to vfio-pci (not nvidia/amdgpu/etc).
    const driverLink = path.join(sysDevice, 'driver')
    let currentDriver: string | null = null
    if (fs.existsSync(driverLink)) {
      currentDriver = path.basename(fs.readlinkSync(driverLink))
    }
    if (currentDriver !== 'vfio-pci') {
      throw new Error(
        `GPU ${pciBus} is bound to "${currentDriver ?? 'no driver'}", not vfio-pci. ` +
        'Unbind the host driver and bind to vfio-pci, or pick "No GPU" in the create wizard.'
      )
    }
  }

  private async fetchMachineTemplate (machine: Machine): Promise<TemplateWithGoldenImage | null> {
    if (!machine.templateId) {
      return null
    }
    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: machine.templateId },
      include: { goldenImage: true }
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
   * Builds the VMCreateConfig for infinization.
   *
   * For unattended installation, this method:
   * 1. Creates the appropriate unattended manager
   * 2. Generates a customized ISO with autoinstall config
   * 3. Uses the generated ISO as the boot source
   */
  private async buildVMConfig (
    machine: Machine,
    template: TemplateWithGoldenImage | null,
    configuration: MachineConfiguration,
    username: string,
    password: string,
    productKey: string | undefined,
    applications: any[],
    scripts: any[],
    pciBus: string | null,
    locale: string,
    keyboard: string,
    timezone: string
  ): Promise<VMCreateConfig> {
    // Get hardware specs (template takes precedence)
    const ramGB = template ? template.ram : machine.ramGB
    const cpuCores = template ? template.cores : machine.cpuCores
    const diskSizeGB = template ? template.storage : machine.diskSizeGB
    // Blueprint-level OS wins when set — blueprints created from the
    // new UI have osType required. For back-compat, legacy blueprints
    // without osType fall through to the per-VM value.
    const effectiveOs = template?.osType ?? machine.os

    // Linked-clone fast path: when the template references a sealed golden
    // image, new VMs are thin clones backed by that image. Skip the
    // unattended-install ISO pipeline entirely — the OS is already inside
    // the base disk.
    const goldenImage = template?.goldenImage ?? null
    const useLinkedClone = Boolean(goldenImage)

    // Get network bridge from the department
    // Each department has its own isolated bridge with DHCP and NAT
    // validatePreconditions() already ensures machine.departmentId is valid
    const departmentBridge = await this.departmentNetworkService.getBridgeForDepartment(machine.departmentId!)

    if (!departmentBridge) {
      throw new Error(
        `Department ${machine.departmentId} has no Linux bridge configured. ` +
        'Run DepartmentNetworkService.configureNetwork() for it before creating VMs.'
      )
    }
    const bridge = departmentBridge
    this.debug.info(`Using bridge '${bridge}' (dept: ${machine.departmentId})`)

    // Find available SPICE port
    const displayPort = await this.findAvailablePort(5900)

    // Build disk configuration. With a golden image, disk0 is a thin
    // qcow2 clone that inherits its virtual size from the backing file;
    // sizeGB is ignored by qemu-img create for backing chains.
    const disks: DiskConfig[] = [
      {
        sizeGB: diskSizeGB,
        format: 'qcow2',
        discard: true,
        backingFile: goldenImage?.baseDiskPath
      }
    ]

    // ISO + unattended pipeline — skipped when linked-clone fast path is
    // active (the OS is already inside the base disk).
    let isoPath: string | undefined
    let virtioDriversIso: string | undefined

    if (useLinkedClone) {
      this.debug.info(
        `Linked-clone fast path: backing=${goldenImage!.baseDiskPath} (golden image ${goldenImage!.id})`
      )
    } else {
      // Get base ISO path for OS installation
      const baseIsoPath = await this.getOSIsoPath(effectiveOs)

      // Generate unattended installation ISO using legacy managers
      isoPath = baseIsoPath
      const unattendedManager = await this.createUnattendedManager(
        machine,
        username,
        password,
        productKey,
        applications,
        scripts,
        locale,
        keyboard,
        timezone,
        effectiveOs
      )

      if (unattendedManager && baseIsoPath) {
        this.debug.debug(`Generating unattended ISO for ${effectiveOs}`)
        unattendedManager.isoPath = baseIsoPath
        try {
          isoPath = await unattendedManager.generateNewImage()
          this.debug.debug(`Generated unattended ISO: ${isoPath}`)
          // Only a freshly-generated temp ISO (distinct from the base) should be
          // deleted on rollback; the base ISO is shared and must be preserved.
          if (isoPath && isoPath !== baseIsoPath) {
            this.generatedIsoPath = isoPath
          }
        } catch (error: any) {
          this.debug.warn(`Failed to generate unattended ISO: ${error.message}`)
          this.debug.warn('Falling back to base ISO (manual installation required)')
          isoPath = baseIsoPath
        }
      }

      // Determine if Windows (for VirtIO drivers ISO)
      const isWindows = effectiveOs.toLowerCase().includes('windows')
      virtioDriversIso = isWindows ? this.getVirtioDriversIsoPath() : undefined
    }

    // Build base directories
    const socketDir = process.env.INFINIZATION_SOCKET_DIR ?? '/opt/infinibay/sockets'

    // Per-VM display secret. infinization delivers this to QEMU over QMP
    // `set_password` (never on the cmdline), so it authenticates the SPICE
    // console regardless of QEMU version. It is the single source of truth for
    // the console ticket: it is persisted as graphicPassword (see :157) and the
    // console-connect resolver presents it to the proxy. Without it, the
    // library's fail-closed guard throws INVALID_CONFIG when displayAddr is
    // non-loopback (and would otherwise ship an unauthenticated console).
    const displayPassword = this.generatePassword()

    // Build the VMCreateConfig
    const config: VMCreateConfig = {
      vmId: machine.id,
      name: machine.name,
      internalName: machine.internalName,
      os: effectiveOs,
      cpuCores,
      ramGB,
      disks,
      bridge,
      displayType: 'spice',
      displayPort,
      // Delivered to QEMU over QMP set_password by infinization (never on the
      // cmdline); supplied so the console is authenticated.
      displayPassword,
      // Default to loopback — pairing a routable bind (APP_HOST) with the
      // generated displayPassword above is the only safe way to expose the
      // console off-host; otherwise keep QEMU's SPICE port on 127.0.0.1.
      displayAddr: process.env.APP_HOST ?? '127.0.0.1',

      // Drop QEMU's privileges to an unprivileged account (-runas) so a guest
      // escape lands as that uid rather than root. Opt-in via env: left
      // undefined when unset, preserving current behavior (and avoiding a
      // launch failure if the account doesn't exist on this install).
      runAsUser: process.env.INFINIZATION_QEMU_USER,

      // The QEMU seccomp sandbox stays ON by default (defense-in-depth). It can
      // be opted out ONLY for environments where the host kernel/seccomp policy
      // is incompatible with it — e.g. some nested/rootless-container CI runners
      // where a sandboxed device-init syscall is killed with SIGSYS. Production
      // (bare metal / privileged hypervisor nodes) must leave this unset.
      disableSandbox: process.env.INFINIZATION_DISABLE_SANDBOX === '1' ? true : undefined,

      // Optional hardware configuration
      gpuPciAddress: pciBus ?? undefined,

      // Force single-queue networking until TapDeviceManager supports multi-queue
      // Multi-queue requires TAP created with IFF_MULTI_QUEUE flag
      networkQueues: 1,

      // UEFI for modern OS
      uefiFirmware: this.getUefiFirmwarePath(effectiveOs),

      // ISO for installation (either base ISO or generated unattended ISO)
      isoPath,

      // VirtIO drivers for Windows
      virtioDriversIso: virtioDriversIso && fs.existsSync(virtioDriversIso)
        ? virtioDriversIso
        : undefined,

      // Advanced devices
      enableAudio: true,
      enableUsbTablet: true,

      // TPM for Windows 11
      tpmSocketPath: effectiveOs.toLowerCase().includes('windows11')
        ? path.join(socketDir, `${machine.internalName}-tpm.sock`)
        : undefined,

      // Guest agent and InfiniService channels
      guestAgentSocketPath: path.join(socketDir, `${machine.internalName}-ga.sock`),
      infiniServiceSocketPath: path.join(socketDir, `${machine.id}.socket`),

      // UUID for QEMU - must match internalName for consistent socket/PID paths
      uuid: machine.internalName
    }

    return config
  }

  /**
   * Creates an unattended manager and generates the installation ISO.
   * Uses the legacy unattended managers for ISO generation.
   */
  private async createUnattendedManager (
    machine: Machine,
    username: string,
    password: string,
    productKey: string | undefined,
    applications: any[],
    scripts: any[],
    locale: string,
    keyboard: string,
    timezone: string,
    effectiveOs: string
  ): Promise<UnattendedManagerBase | null> {
    // Validate the username once, here, before constructing any manager. It
    // becomes a guest OS account AND is interpolated into install command lines,
    // so a bad value must fail the create cleanly rather than produce a broken or
    // injected autounattend. machine.id is a system-generated UUID (low risk) and
    // is additionally escaped at its injection site.
    const safeUsername = validateUsernameStrict(username)

    const osManagers: Record<string, () => UnattendedWindowsManager | UnattendedUbuntuManager | UnattendedRedHatManager> = {
      windows10: () => new UnattendedWindowsManager(10, safeUsername, password, productKey, applications, machine.id, scripts),
      windows11: () => new UnattendedWindowsManager(11, safeUsername, password, productKey, applications, machine.id, scripts),
      ubuntu: () => new UnattendedUbuntuManager(safeUsername, password, applications, machine.id, scripts),
      fedora: () => new UnattendedRedHatManager(safeUsername, password, applications, machine.id, locale, keyboard, timezone),
      redhat: () => new UnattendedRedHatManager(safeUsername, password, applications, machine.id, locale, keyboard, timezone)
    }

    const managerCreator = osManagers[effectiveOs as keyof typeof osManagers]
    if (!managerCreator) {
      this.debug.warn(`No unattended manager for OS: ${effectiveOs}`)
      return null
    }

    const manager = managerCreator()
    // Async init for language detection (Windows only)
    if (manager instanceof UnattendedWindowsManager) {
      await manager.init()
    }

    return manager
  }

  private getUefiFirmwarePath (os: string): string | undefined {
    // Most modern OS need UEFI
    const needsUefi = os.toLowerCase().includes('windows') ||
                      os.toLowerCase().includes('ubuntu') ||
                      os.toLowerCase().includes('fedora')

    if (!needsUefi) return undefined

    // Common UEFI firmware paths (including 4M variants for modern systems)
    const firmwarePaths = [
      '/usr/share/OVMF/OVMF_CODE_4M.fd',
      '/usr/share/OVMF/OVMF_CODE.fd',
      '/usr/share/edk2/ovmf/OVMF_CODE_4M.fd',
      '/usr/share/edk2/ovmf/OVMF_CODE.fd',
      '/usr/share/qemu/OVMF_CODE.fd'
    ]

    for (const p of firmwarePaths) {
      if (fs.existsSync(p)) return p
    }

    return undefined
  }

  private getVirtioDriversIsoPath (): string | undefined {
    // Check environment variable first
    const envPath = process.env.VIRTIO_WIN_ISO
    if (envPath && fs.existsSync(envPath)) {
      return envPath
    }

    // Common paths for VirtIO drivers ISO
    const baseDir = process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay'
    const searchPaths = [
      path.join(baseDir, 'iso', 'permanent', 'virtio-win.iso'),
      path.join(baseDir, 'iso', 'virtio-win.iso'),
      '/usr/share/virtio-win/virtio-win.iso',
      '/var/lib/libvirt/images/virtio-win.iso'
    ]

    for (const p of searchPaths) {
      if (fs.existsSync(p)) {
        this.debug.debug(`Found VirtIO drivers ISO at: ${p}`)
        return p
      }
    }

    this.debug.warn('VirtIO drivers ISO not found in any standard location')
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
    const randomBytes = crypto.randomBytes(length)
    let password = ''
    for (let i = 0; i < length; i++) {
      password += chars.charAt(randomBytes[i] % chars.length)
    }
    return password
  }

  private async updateMachineStatus (machineId: string, status: string): Promise<void> {
    await this.prisma.machine.update({
      where: { id: machineId },
      data: { status }
    })
    this.debug.debug(`Machine status updated to ${status}`)
  }

  private async rollback (machine: Machine, expectedDiskPath?: string): Promise<void> {
    this.debug.debug(`Rolling back machine ${machine.id}`)

    try {
      // Stop the VM if running — on the node that owns it.
      const executor = await this.dispatcher.executorFor(machine.id)
      const status = await executor.getVMStatus(machine.id)

      if (status.processAlive) {
        this.debug.debug('Stopping VM during rollback')
        await executor.stopVM(machine.id, { force: true })
      }
    } catch (error: any) {
      this.debug.warn(`Error during rollback stop: ${error.message}`)
    }

    // Update status to error
    try {
      await this.updateMachineStatus(machine.id, 'error')
    } catch {
      // Ignore status update errors during rollback
    }

    // Clean up disk files from the filesystem
    try {
      const config = await this.prisma.machineConfiguration.findUnique({
        where: { machineId: machine.id }
      })
      const diskPaths = (config?.diskPaths as string[] | null) ?? []
      // Also try the deterministic path infinization would have created, since on
      // a failure that path is never persisted to the DB (so it's not in diskPaths
      // above) yet the qcow2 may exist on disk — the actual orphan-leak fix.
      if (expectedDiskPath && !diskPaths.includes(expectedDiskPath)) {
        diskPaths.push(expectedDiskPath)
      }
      for (const diskPath of diskPaths) {
        try {
          await fs.promises.unlink(diskPath)
          this.debug.debug(`Rollback: deleted disk file ${diskPath}`)
        } catch (err: any) {
          if (err.code !== 'ENOENT') {
            this.debug.warn(`Rollback: failed to delete disk file ${diskPath}: ${err.message}`)
          }
        }
      }
    } catch (err: any) {
      this.debug.warn(`Rollback: failed to clean up disk files: ${err.message}`)
    }

    // Clean up the unattended ISO generated for this VM (if any). We delete it by
    // the exact path captured in buildVMConfig — the old directory scan matched
    // `unattended_<id>_*.iso`, which never matched the random generated filenames.
    if (this.generatedIsoPath) {
      try {
        await fs.promises.unlink(this.generatedIsoPath)
        this.debug.debug(`Rollback: deleted temporary ISO ${this.generatedIsoPath}`)
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          this.debug.warn(`Rollback: failed to delete ISO file ${this.generatedIsoPath}: ${err.message}`)
        }
      }
    }

    this.debug.debug('Rollback completed')
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
