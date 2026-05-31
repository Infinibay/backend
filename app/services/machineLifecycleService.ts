import { Logger } from 'winston'
import logger from '@main/logger'
import { PrismaClient, Department, Machine, User, Prisma } from '@prisma/client'
import { SafeUser } from '../utils/context'
import { v4 as uuidv4 } from 'uuid'
import { ApolloError, UserInputError } from '../utils/errors'
import si from 'systeminformation'
import { MachineCleanupServiceV2 } from './cleanup/machineCleanupServiceV2'
import { HardwareUpdateService } from './vm/hardwareUpdateService'
import { getEventManager } from '../services/EventManager'
import { CreateMachineServiceV2 } from './CreateMachineServiceV2'
import { NodePlacementService } from './node/NodePlacementService'
import { CreateMachineInputType, UpdateMachineHardwareInput, UpdateMachineNameInput, UpdateMachineUserInput, SuccessType, FirstBootScriptInputType } from '../graphql/resolvers/machine/type'

/**
 * Normalize PCI address to standard format.
 * Fixes legacy bug where addresses were generated with 8-digit domain (00000000:)
 * instead of the standard 4-digit domain (0000:).
 */
function normalizePciAddress (address: string | null): string | null {
  if (!address) return null
  // Fix 8-digit domain to 4-digit domain
  if (address.startsWith('00000000:')) {
    return '0000:' + address.slice(9)
  }
  return address
}

export class MachineLifecycleService {
  private prisma: PrismaClient
  private user: SafeUser | null
  private debug: Logger

  constructor (prisma: PrismaClient, user: SafeUser | null) {
    this.prisma = prisma
    this.user = user
    this.debug = logger.child({ module: 'machine-lifecycle-service' })
  }

  async createMachine (input: CreateMachineInputType): Promise<Machine> {
    let cpuCores: number
    let ramGB: number
    let diskSizeGB: number
    let template = null

    // Check if using custom hardware or template
    if (input.templateId === 'custom' || !input.templateId) {
      // Using custom hardware
      if (!input.customCores || !input.customRam || !input.customStorage) {
        throw new UserInputError('Custom hardware specifications are required when not using a template')
      }
      cpuCores = input.customCores
      ramGB = input.customRam
      diskSizeGB = input.customStorage
    } else {
      // Using template
      template = await this.prisma.machineTemplate.findUnique({
        where: { id: input.templateId }
      })

      if (!template) {
        throw new UserInputError('Machine template not found')
      }
      cpuCores = template.cores
      ramGB = template.ram
      diskSizeGB = template.storage
    }

    // Detect locale settings from host or input
    const localeSettings = this.detectLocaleFromHost(input)

    const internalName = uuidv4()
    const machine = await this.prisma.$transaction(async (tx) => {
      let department: Department | null = null
      if (input.departmentId) {
        department = await tx.department.findUnique({
          where: { id: input.departmentId }
        })
      } else {
        department = await tx.department.findFirst()
      }

      if (!department) {
        throw new UserInputError('Department not found')
      }

      if (!department.bridgeName) {
        throw new UserInputError(
          `Department "${department.name}" has no Linux bridge configured. ` +
          'Recreate it through the UI so its network gets provisioned.'
        )
      }

      const nodeId = await new NodePlacementService(tx).chooseNodeForMachine({
        cpuCores,
        ramGB,
        diskSizeGB
      })

      const createdMachine = await tx.machine.create({
        data: {
          name: input.name,
          userId: this.user?.id,
          status: 'off',
          os: input.os,
          templateId: template ? input.templateId : null,
          internalName,
          departmentId: department.id,
          nodeId,
          cpuCores,
          ramGB,
          diskSizeGB,
          gpuPciAddress: normalizePciAddress(input.pciBus),
          configuration: {
            create: {
              graphicProtocol: 'spice',
              graphicHost: process.env.GRAPHIC_HOST || 'localhost',
              graphicPassword: null,
              bridge: department.bridgeName
            }
          }
        },
        include: {
          configuration: true,
          department: true,
          template: true,
          user: true
        }
      })

      if (!createdMachine) {
        throw new ApolloError('Machine not created')
      }

      // ── Golden-image vs. blueprint mutual exclusion ──────────────
      // A template that references a GoldenImage creates linked-clone
      // VMs whose disk already contains the OS + apps.  Blueprint-
      // level apps are NOT applicable — they belong to the ISO-install path.
      //
      // Scripts, however, ARE allowed on golden-image VMs — they run via
      // infiniservice AFTER the VM boots, not during installation, so
      // they can customize any VM regardless of how it was provisioned.
      const isGoldenImage = Boolean(template?.goldenImageId)

      if (isGoldenImage) {
        // Reject user-supplied applications when the template is backed
        // by a golden image — apps are embedded in the ISO and executed
        // during installation, which is skipped for linked clones.
        if (input.applications.length > 0) {
          throw new UserInputError(
            'Cannot assign applications to a golden-image VM. ' +
            'The template is backed by a sealed golden image and does not support blueprint-level application installation. ' +
            'Scripts can still be assigned to golden-image VMs and will be executed via infiniservice after boot.'
          )
        }
      }

      // Merge blueprint-level apps/scripts with per-VM overrides.
      // For golden-image templates, only user-supplied scripts are allowed
      // (blueprint apps/scripts are skipped because they belong to ISO path).
      const blueprintApps = (!isGoldenImage && createdMachine.templateId)
        ? await tx.machineTemplateApplication.findMany({
            where: { templateId: createdMachine.templateId }
          })
        : []
      const blueprintScripts = (!isGoldenImage && createdMachine.templateId)
        ? await tx.machineTemplateScript.findMany({
            where: { templateId: createdMachine.templateId },
            orderBy: { order: 'asc' }
          })
        : []

      const appIds = new Set(input.applications.map((a) => a.applicationId))
      const scriptIds = new Set(input.firstBootScripts.map((s) => s.scriptId))

      for (const application of input.applications) {
        await tx.machineApplication.create({
          data: {
            machineId: createdMachine.id,
            applicationId: application.applicationId,
            parameters: (application.parameters ?? {}) as Prisma.InputJsonValue
          }
        })
      }
      for (const link of blueprintApps) {
        if (appIds.has(link.applicationId)) continue
        await tx.machineApplication.create({
          data: {
            machineId: createdMachine.id,
            applicationId: link.applicationId,
            parameters: (link.parameters ?? {}) as Prisma.InputJsonValue
          }
        })
      }

      // Create ScriptExecution records for first-boot scripts.
      // These will be executed by InfiniService via the protocol after the VM boots.
      // Scripts are scheduled for immediate execution (scheduledFor = now).
      // This applies to BOTH regular VMs and golden-image VMs.
      for (const scriptInput of input.firstBootScripts) {
        await tx.scriptExecution.create({
          data: {
            scriptId: scriptInput.scriptId,
            machineId: createdMachine.id,
            executionType: 'FIRST_BOOT',
            triggeredById: this.user?.id,
            inputValues: scriptInput.inputValues as Prisma.InputJsonValue,
            status: 'PENDING',
            scheduledFor: new Date(),
            repeatIntervalMinutes: null,
            lastExecutedAt: null,
            executionCount: 0,
            maxExecutions: null,
            order: (scriptInput as any).order ?? 0
          }
        })
      }
      for (const link of blueprintScripts) {
        if (scriptIds.has(link.scriptId)) continue
        await tx.scriptExecution.create({
          data: {
            scriptId: link.scriptId,
            machineId: createdMachine.id,
            executionType: 'FIRST_BOOT',
            triggeredById: this.user?.id,
            inputValues: (link.inputValues ?? {}) as Prisma.InputJsonValue,
            status: 'PENDING',
            scheduledFor: new Date(),
            repeatIntervalMinutes: null,
            lastExecutedAt: null,
            executionCount: 0,
            maxExecutions: null,
            order: link.order ?? 0
          }
        })
      }

      // Wallpaper + power plan: if the blueprint sets either, queue the
      // OS-specific applier script with the values as inputs.
      // ── Skipped for golden-image templates (apps/scripts belong to ISO path) ──
      if (!isGoldenImage && createdMachine.templateId) {
        const tpl = await tx.machineTemplate.findUnique({
          where: { id: createdMachine.templateId },
          select: { wallpaperUrl: true, powerPlan: true, encryptDisk: true, osType: true }
        })
        const os = String(tpl?.osType ?? createdMachine.os).toLowerCase()
        if (tpl && (tpl.wallpaperUrl || tpl.powerPlan)) {
          const isWindows = os.includes('windows')
          const applierFile = isWindows
            ? 'golden-image/windows-set-wallpaper-and-power.yaml'
            : 'golden-image/linux-set-wallpaper-and-power.yaml'
          const applier = await tx.script.findUnique({
            where: { fileName: applierFile }
          })
          if (applier) {
            await tx.scriptExecution.create({
              data: {
                scriptId: applier.id,
                machineId: createdMachine.id,
                executionType: 'FIRST_BOOT',
                triggeredById: this.user?.id,
                inputValues: {
                  WALLPAPER_URL: tpl.wallpaperUrl ?? '',
                  POWER_PLAN: tpl.powerPlan ?? ''
                } as Prisma.InputJsonValue,
                status: 'PENDING',
                scheduledFor: new Date(),
                repeatIntervalMinutes: null,
                lastExecutedAt: null,
                executionCount: 0,
                maxExecutions: null,
                order: 0
              }
            })
          } else {
            this.debug.warn(
              `wallpaper/powerPlan set on template ${createdMachine.templateId} ` +
              `but applier script ${applierFile} is not seeded. `
            )
          }
        }

        // Disk encryption — applied as a FIRST_BOOT script.
        if (tpl?.encryptDisk) {
          const isWindows = os.includes('windows')
          const encFile = isWindows
            ? 'golden-image/windows-enable-bitlocker.yaml'
            : 'golden-image/linux-disk-encryption-notice.yaml'
          const encScript = await tx.script.findUnique({ where: { fileName: encFile } })
          if (encScript) {
            await tx.scriptExecution.create({
              data: {
                scriptId: encScript.id,
                machineId: createdMachine.id,
                executionType: 'FIRST_BOOT',
                triggeredById: this.user?.id,
                inputValues: {} as Prisma.InputJsonValue,
                status: 'PENDING',
                scheduledFor: new Date(),
                repeatIntervalMinutes: null,
                lastExecutedAt: null,
                executionCount: 0,
                maxExecutions: null,
                order: 0
              }
            })
          } else {
            this.debug.warn(
              `encryptDisk set on template ${createdMachine.templateId} `
            )
          }
        }
      }

      return createdMachine
    })

    setImmediate(() => {
      this.backgroundCode(
        machine.id,
        input.username,
        input.password,
        input.productKey,
        input.pciBus,
        localeSettings.locale,
        localeSettings.keyboard,
        localeSettings.timezone
      ).catch(err => {
        logger.error(`[backgroundCode] Unhandled error for machine ${machine.id}:`, err)
      })
    })

    return machine
  }

  async destroyMachine (id: string): Promise<SuccessType> {
    const isAdmin = this.user?.role === 'ADMIN' || this.user?.role === 'SUPER_ADMIN'
    const whereClause = isAdmin ? { id } : { id, userId: this.user?.id }
    const machine = await this.prisma.machine.findFirst({
      where: whereClause,
      include: {
        configuration: true
      }
    })

    if (!machine) {
      return { success: false, message: 'Machine not found' }
    }

    try {
      const cleanup = new MachineCleanupServiceV2(this.prisma)
      await cleanup.cleanupVM(machine.id)
      return { success: true, message: 'Machine destroyed' }
    } catch (error: unknown) {
      this.debug.debug(`Error destroying machine: ${String(error)}`)
      const message = error instanceof Error ? error.message : String(error)
      return { success: false, message: `Error destroying machine: ${message}` }
    }
  }

  async updateMachineHardware (input: UpdateMachineHardwareInput): Promise<Machine> {
    const { id, cpuCores, ramGB, gpuPciAddress } = input

    const machine = await this.prisma.machine.findUnique({
      where: { id },
      include: { configuration: true }
    })

    if (!machine) {
      throw new ApolloError(`Machine with ID ${id} not found`)
    }

    const updateData: Prisma.MachineUpdateInput = {}
    if (cpuCores !== undefined) {
      if (cpuCores <= 0) throw new ApolloError('CPU cores must be positive.')
      updateData.cpuCores = cpuCores
    }
    if (ramGB !== undefined) {
      if (ramGB <= 0) throw new ApolloError('RAM must be positive.')
      updateData.ramGB = ramGB
    }

    if (gpuPciAddress !== undefined) {
      if (gpuPciAddress === null) {
        updateData.gpuPciAddress = null
      } else {
        try {
          const graphicsInfo = await si.graphics()
          const isValidGpu = graphicsInfo.controllers.some(
            (gpu) => gpu.pciBus === gpuPciAddress
          )

          if (!isValidGpu) {
            throw new ApolloError(
              `Invalid GPU PCI address: ${gpuPciAddress}. Not found or not a GPU.`
            )
          }
          updateData.gpuPciAddress = gpuPciAddress
        } catch (error) {
          this.debug.debug(`Error validating GPU PCI address ${gpuPciAddress}: ${String(error)}`)
          throw new Error(`Failed to validate GPU PCI address: ${gpuPciAddress}.`)
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      this.debug.debug(`No hardware changes provided for machine ${id}.`)
      return machine
    }

    const updatedMachine = await this.prisma.machine.update({
      where: { id },
      data: updateData,
      include: {
        configuration: true,
        department: true,
        template: true,
        user: true
      }
    })

    this.debug.debug(
      `Machine ${id} hardware updated in DB: ${JSON.stringify(updateData)}. VM update required.`
    )

    // Use the new dedicated hardware update service
    this.backgroundUpdateHardware(updatedMachine.id).catch(err => {
      this.debug.debug(`Error in backgroundUpdateHardware for machine ${updatedMachine.id}: ${String(err)}`)
    })

    return updatedMachine
  }

  async updateMachineName (input: UpdateMachineNameInput): Promise<Machine> {
    const { id, name } = input

    const machine = await this.prisma.machine.findUnique({
      where: { id },
      include: { configuration: true }
    })

    if (!machine) {
      throw new ApolloError(`Machine with ID ${id} not found`)
    }

    // Validate name
    if (!name || name.trim() === '') {
      throw new ApolloError('Machine name cannot be empty')
    }

    // Check if name is already taken by another machine
    const existingMachine = await this.prisma.machine.findFirst({
      where: {
        name: name.trim(),
        id: { not: id } // Exclude the current machine
      }
    })

    if (existingMachine) {
      throw new ApolloError(`Machine name "${name.trim()}" is already taken`)
    }

    const updatedMachine = await this.prisma.machine.update({
      where: { id },
      data: { name: name.trim() },
      include: {
        configuration: true,
        department: true,
        template: true,
        user: true
      }
    })

    this.debug.debug(`Machine ${id} name updated to "${name.trim()}"`)

    return updatedMachine
  }

  async updateMachineUser (input: UpdateMachineUserInput): Promise<Machine> {
    const { id, userId } = input

    const machine = await this.prisma.machine.findUnique({
      where: { id },
      include: { configuration: true, user: true }
    })

    if (!machine) {
      throw new ApolloError(`Machine with ID ${id} not found`)
    }

    // If userId is provided, validate that the user exists
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      })

      if (!user) {
        throw new ApolloError(`User with ID ${userId} not found`)
      }
    }

    const updatedMachine = await this.prisma.machine.update({
      where: { id },
      data: { userId },
      include: {
        configuration: true,
        department: true,
        template: true,
        user: true
      }
    })

    this.debug.debug(`Machine ${id} user assignment updated: ${userId ? `assigned to user ${userId}` : 'unassigned'}`)

    // Emit real-time event for machine update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('vms', 'update', updatedMachine)
      this.debug.debug(`🎯 VM user assignment updated: ${updatedMachine.name} (${id})`)
    } catch (eventError) {
      this.debug.debug(`Failed to emit update event for VM ${id}: ${String(eventError)}`)
    }

    return updatedMachine
  }

  private async backgroundCode (
    id: string,
    username: string,
    password: string,
    productKey: string | undefined,
    pciBus: string | null,
    locale: string,
    keyboard: string,
    timezone: string
  ) {
    logger.info(`[backgroundCode] Starting VM creation for ${id}`)
    try {
      const machine = await this.prisma.machine.findUnique({
        where: { id }
      })

      if (!machine) {
        logger.error(`[backgroundCode] Machine with ID ${id} not found in background process`)
        return
      }

      logger.info(`[backgroundCode] Found machine: ${machine.name}, using CreateMachineServiceV2 (infinization)`)

      // Use infinization-based CreateMachineServiceV2
      const createService = new CreateMachineServiceV2(this.prisma)
      await createService.create(
        machine,
        username,
        password,
        productKey,
        normalizePciAddress(pciBus),
        locale,
        keyboard,
        timezone
      )

      logger.info(`[backgroundCode] CreateMachineServiceV2.create() completed for ${machine.name}`)

      // Fetch updated machine for event emission
      const updatedMachine = await this.prisma.machine.findUnique({
        where: { id },
        include: {
          user: true,
          template: true,
          department: true,
          configuration: true
        }
      })

      // Emit real-time event for VM status update.
      // NOTE: At this point the QEMU process has been spawned by infinization
      // and Machine.status will transition 'off' → 'starting' → 'running' via
      // QMP events. The orthogonal MachineConfiguration.setupComplete remains
      // false until VirtioSocketWatcherService receives the first message
      // from infiniservice (which indicates the OS finished installing and
      // booted). The UI uses (status, setupComplete) together to render
      // "Installing…" vs "Running".
      if (updatedMachine) {
        try {
          const eventManager = getEventManager()
          await eventManager.dispatchEvent('vms', 'update', updatedMachine)
          this.debug.debug(`🎯 VM created (status: ${updatedMachine.status}): ${updatedMachine.name} (${id}) - awaiting InfiniService connection`)
        } catch (eventError) {
          this.debug.debug(`Failed to emit update event for VM ${id}: ${String(eventError)}`)
        }
      }
    } catch (error: any) {
      logger.error(`[backgroundCode] Error creating machine ${id}:`, error?.message || error)
      logger.error(`[backgroundCode] Stack:`, error?.stack)

      // Best-effort host cleanup. Without this, a failed creation leaves
      // QEMU/TAP/nftables/sockets behind and the user has no way to retry
      // because internalName collides on next attempt.
      // We don't delete the DB Machine row — keep status='error' so the user
      // can see what happened and click destroy from the UI.
      try {
        const { getInfinization } = await import('@services/InfinizationService')
        const infinization = await getInfinization()
        const destroyResult = await infinization.destroyVM(id)
        if (!destroyResult.success) {
          logger.warn(`[backgroundCode] destroyVM during rollback returned: ${destroyResult.error ?? destroyResult.message ?? 'unknown'}`)
        }
      } catch (cleanupError: any) {
        logger.warn(`[backgroundCode] Host cleanup failed for ${id}: ${cleanupError?.message ?? cleanupError}`)
      }

      // Persist a short error reason so the UI can show it instead of bare 'error'.
      const reason = (error?.message ?? String(error)).slice(0, 500)
      try {
        await this.prisma.machine.update({
          where: { id },
          data: {
            status: 'error',
            configuration: {
              update: {
                qemuPid: null,
                qmpSocketPath: null,
                tapDeviceName: null,
                lastError: reason
              }
            }
          }
        })
      } catch {
        // If the configuration update fails (e.g. lastError column missing on
        // an older schema), fall back to just flipping status.
        try {
          await this.prisma.machine.update({ where: { id }, data: { status: 'error' } })
        } catch {
          // give up
        }
      }
    }
  }

  /**
   * Delegate hardware update to the dedicated HardwareUpdateService
   */
  private async backgroundUpdateHardware (machineId: string): Promise<void> {
    this.debug.debug(`Starting background hardware update for machine ${machineId}`)

    // We don't await this so it runs in the background
    new HardwareUpdateService(this.prisma, machineId)
      .updateHardware()
      .catch(error => {
        this.debug.debug(`Background hardware update for machine ${machineId} failed: ${error.message}`)
      })
  }

  private detectLocaleFromHost (input: CreateMachineInputType): {
    locale: string
    keyboard: string
    timezone: string
  } {
    // Detect locale from environment variables
    const envLocale = process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8'
    const locale = input.locale || envLocale

    // Keyboard layout mapping for common locales where country code doesn't match keyboard layout
    const keyboardMapping: Record<string, string> = {
      US: 'us',
      GB: 'uk', // UK uses 'uk' layout, not 'gb'
      ES: 'es',
      BR: 'br',
      FR: 'fr',
      DE: 'de',
      IT: 'it',
      PT: 'pt',
      MX: 'latam', // Mexico uses Latin American layout
      AR: 'latam', // Argentina uses Latin American layout
      CH: 'ch', // Switzerland
      AT: 'at', // Austria
      BE: 'be', // Belgium
      NL: 'us', // Netherlands often uses US layout
      SE: 'se', // Sweden
      NO: 'no', // Norway
      DK: 'dk', // Denmark
      FI: 'fi', // Finland
      PL: 'pl', // Poland
      RU: 'ru', // Russia
      JP: 'jp', // Japan
      KR: 'kr', // South Korea
      CN: 'cn' // China
    }

    // Derive keyboard layout from locale if not provided
    let keyboard = input.keyboard
    if (!keyboard) {
      const localeMatch = locale.match(/^[a-z]+_([A-Z]+)/)
      if (localeMatch) {
        const countryCode = localeMatch[1]
        keyboard = keyboardMapping[countryCode] || countryCode.toLowerCase()
      } else {
        keyboard = 'us'
      }
    }

    // Detect timezone from environment variable
    const timezone = input.timezone || process.env.TZ || 'America/New_York'

    this.debug.debug(`Detected locale settings: locale=${locale}, keyboard=${keyboard}, timezone=${timezone}`)

    return { locale, keyboard, timezone }
  }
}
