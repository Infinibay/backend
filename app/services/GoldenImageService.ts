/**
 * GoldenImageService — orchestrates the creation and lifecycle of sealed
 * base disk images (GoldenImage rows + qcow2 files in disks/base/).
 *
 * Two creation flows are supported:
 *   - buildAutomated: spawn a temporary VM from a blueprint, let it
 *     install unattended, run hardening scripts, send PrepareGoldenImage,
 *     wait for shutdown, promote the disk to base/.
 *   - captureFromMachine: seal an existing VM's disk. By default the disk
 *     is cloned to a staging file and the clone is sealed, preserving the
 *     source. With destroySource=true, the source VM's disk is sealed
 *     in-place and the VM is archived.
 *
 * Lifecycle mutations (publish / deprecate / delete / createNewVersion)
 * operate on existing GoldenImage rows.
 *
 * Progress is tracked in DB (GoldenImage.status, progressPercent via
 * event payloads). Real-time updates are dispatched via EventManager.
 * The long-running orchestration runs as a detached async task — the
 * caller gets the DB row immediately and subscribes to events.
 */

import fs from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { Logger } from 'winston'
import { PrismaClient, Prisma, GoldenImage, Machine } from '@prisma/client'
import logger from '@main/logger'
import { getInfinization } from '@services/InfinizationService'
import { getEventManager } from './EventManager'
import { VirtioSocketWatcherService } from './VirtioSocketWatcherService'
import type { SafeCommandType } from './VirtioSocketWatcherService'
import { CreateMachineServiceV2 } from './CreateMachineServiceV2'
import { MachineCleanupServiceV2 } from './cleanup/machineCleanupServiceV2'
import { VMOperationsService } from './VMOperationsService'
import {
  OFF_STATUS,
  ERROR_STATUS,
  CAPTURING_STATUS
} from '../constants/machine-status'

const BASE_IMAGE_DIR =
  process.env.INFINIZATION_GOLDEN_IMAGE_DIR ??
  '/var/lib/infinization/disks/base'

const SEAL_COMMAND_TIMEOUT_MS = 10 * 60 * 1000 // 10 min
const SHUTDOWN_WAIT_TIMEOUT_MS = 15 * 60 * 1000 // 15 min
const SETUP_WAIT_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour (Windows unattended can be slow)
const POLL_INTERVAL_MS = 5 * 1000

export interface BuildAutomatedInput {
  templateId: string
  name: string
  notes?: string
  hardeningOptions?: Record<string, boolean>
  parentImageId?: string
  createdById?: string
}

export interface CaptureFromMachineInput {
  machineId: string
  name: string
  notes?: string
  hardeningOptions?: Record<string, boolean>
  sanitizeUserData?: boolean
  destroySource?: boolean
  parentImageId?: string
  createdById?: string
}

export class GoldenImageService {
  private prisma: PrismaClient
  private debug: Logger
  private virtioWatcher: VirtioSocketWatcherService

  constructor (prisma: PrismaClient, virtioWatcher: VirtioSocketWatcherService) {
    this.prisma = prisma
    this.debug = logger.child({ module: 'golden-image-service' })
    this.virtioWatcher = virtioWatcher
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  async list (): Promise<GoldenImage[]> {
    return await this.prisma.goldenImage.findMany({
      orderBy: [{ createdAt: 'desc' }]
    })
  }

  async byId (id: string): Promise<GoldenImage | null> {
    return await this.prisma.goldenImage.findUnique({ where: { id } })
  }

  // ---------------------------------------------------------------------
  // Creation — from blueprint (automated unattended install)
  // ---------------------------------------------------------------------

  async buildAutomated (input: BuildAutomatedInput): Promise<GoldenImage> {
    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: input.templateId }
    })
    if (!template) {
      throw new Error(`Template not found: ${input.templateId}`)
    }

    const osType = inferGoldenImageOsType(template.description ?? template.name ?? '')
    if (!osType) {
      throw new Error(
        'Could not infer OS from template — buildAutomated requires an OS hint in the template name or description'
      )
    }

    const parentVersion = input.parentImageId
      ? await this.prisma.goldenImage.findUnique({ where: { id: input.parentImageId } })
      : null

    const image = await this.prisma.goldenImage.create({
      data: {
        name: input.name,
        osType,
        baseDiskPath: '', // filled in after sealing
        status: 'building',
        version: parentVersion ? parentVersion.version + 1 : 1,
        parentImageId: parentVersion?.id,
        sourceType: 'automated',
        sourceTemplateId: template.id,
        hardeningApplied: input.hardeningOptions as Prisma.InputJsonValue ?? Prisma.JsonNull,
        notes: input.notes,
        createdById: input.createdById
      }
    })

    // Fire-and-forget orchestration. Errors are surfaced by flipping the
    // GoldenImage status to 'failed' (via a notes field) — we don't want
    // to crash the GraphQL mutation on a 30-minute workflow.
    void this.runBuildAutomated(image.id, template.id, input).catch((err) => {
      this.debug.error(`buildAutomated orchestration failed for image=${image.id}: ${err?.message}`)
    })

    return image
  }

  private async runBuildAutomated (
    imageId: string,
    templateId: string,
    input: BuildAutomatedInput
  ): Promise<void> {
    this.emitProgress(imageId, 0, 'queued')

    // Load the template with its scripts and applications.
    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: templateId },
      include: {
        scripts: { orderBy: { order: 'asc' } },
        applications: true
      }
    })
    if (!template) {
      throw new Error(`Template ${templateId} not found during build orchestration`)
    }

    const os = (template.osType ?? '').toLowerCase()
    const isWindows = os.includes('windows')

    // Pick a department — any department with a bridge will do for the
    // temporary build VM. The VM is destroyed after sealing.
    const department = await this.prisma.department.findFirst({
      where: { bridgeName: { not: null } }
    })
    if (!department) {
      throw new Error(
        'No department with a configured network bridge found. ' +
        'Create at least one department before building golden images.'
      )
    }

    // ------------------------------------------------------------------
    // 1. Create a temporary Machine row + configuration
    // ------------------------------------------------------------------
    this.emitProgress(imageId, 5, 'creating_temp_vm')

    const internalName = `gi-${uuidv4().slice(0, 8)}`
    const tempMachine = await this.prisma.machine.create({
      data: {
        name: `[golden-image-build] ${input.name}`,
        internalName,
        status: 'building',
        os: template.osType ?? 'windows10',
        templateId: template.id,
        departmentId: department.id,
        cpuCores: template.cores,
        ramGB: template.ram,
        diskSizeGB: template.storage,
        configuration: {
          create: {
            graphicProtocol: 'spice',
            graphicHost: process.env.GRAPHIC_HOST || 'localhost',
            graphicPassword: null,
            bridge: department.bridgeName
          }
        }
      },
      include: { configuration: true }
    })

    try {
      // ------------------------------------------------------------------
      // 2. Seed ScriptExecution rows from the template's scripts so
      //    CreateMachineServiceV2 picks them up.
      // ------------------------------------------------------------------
      for (const link of template.scripts) {
        await this.prisma.scriptExecution.create({
          data: {
            scriptId: link.scriptId,
            machineId: tempMachine.id,
            executionType: 'FIRST_BOOT',
            triggeredById: input.createdById,
            inputValues: (link.inputValues ?? {}) as Prisma.InputJsonValue,
            status: 'PENDING',
            scheduledFor: new Date(),
            repeatIntervalMinutes: null,
            lastExecutedAt: null,
            executionCount: 0,
            maxExecutions: null
          }
        })
      }

      // Seed MachineApplication rows from the template's applications.
      for (const link of template.applications) {
        await this.prisma.machineApplication.create({
          data: {
            machineId: tempMachine.id,
            applicationId: link.applicationId,
            parameters: (link.parameters ?? {}) as Prisma.InputJsonValue
          }
        })
      }

      // ------------------------------------------------------------------
      // 3. Spawn QEMU via CreateMachineServiceV2
      // ------------------------------------------------------------------
      this.emitProgress(imageId, 10, 'spawning_vm')

      const createService = new CreateMachineServiceV2(this.prisma)
      await createService.create(
        tempMachine,
        'administrator', // default username for build VM
        uuidv4(),        // random password — the image gets sealed anyway
        undefined,       // no product key
        null,            // no GPU passthrough for build VM
        'en_US.UTF-8',
        'us',
        'UTC'
      )

      // ------------------------------------------------------------------
      // 4. Wait for InfiniService to report setupComplete
      // ------------------------------------------------------------------
      this.emitProgress(imageId, 30, 'waiting_for_agent')
      await this.waitForSetupComplete(tempMachine.id, SETUP_WAIT_TIMEOUT_MS)

      // ------------------------------------------------------------------
      // 5. Seal the image (PrepareGoldenImage + auto-shutdown)
      // ------------------------------------------------------------------
      this.emitProgress(imageId, 55, 'sealing')
      await this.sendPrepareGoldenImage(tempMachine.id, {
        sanitizeUserData: true,
        shutdownAfter: true
      })

      // ------------------------------------------------------------------
      // 6. Wait for the VM to shut down after sealing
      // ------------------------------------------------------------------
      this.emitProgress(imageId, 75, 'waiting_for_shutdown')
      await this.waitForShutdown(tempMachine.id, SHUTDOWN_WAIT_TIMEOUT_MS)

      // ------------------------------------------------------------------
      // 7. Promote the sealed disk to the base-image directory
      // ------------------------------------------------------------------
      this.emitProgress(imageId, 85, 'promoting_disk')

      await fs.mkdir(BASE_IMAGE_DIR, { recursive: true })
      const finalPath = path.join(BASE_IMAGE_DIR, `${imageId}.qcow2`)

      const diskPaths =
        (tempMachine.configuration?.diskPaths as string[] | null) ?? []
      const sourceDisk = diskPaths[0]
      if (!sourceDisk) {
        throw new Error(
          `Build VM ${tempMachine.id} has no known disk path after sealing`
        )
      }

      await this.convertDisk(sourceDisk, finalPath)

      // ------------------------------------------------------------------
      // 8. Update the GoldenImage row
      // ------------------------------------------------------------------
      const stat = await fs.stat(finalPath)
      await this.prisma.goldenImage.update({
        where: { id: imageId },
        data: {
          baseDiskPath: finalPath,
          sizeBytes: BigInt(stat.size),
          status: 'draft',
          sealedAt: new Date(),
          sourceMachineId: tempMachine.id
        }
      })
      this.emitProgress(imageId, 100, 'draft')
    } catch (buildErr) {
      const reason = (buildErr as Error).message
      this.debug.error(`Build failed for image=${imageId}: ${reason}`)
      await this.markFailed(imageId, reason)
      throw buildErr
    } finally {
      // ------------------------------------------------------------------
      // 9. Clean up the temporary VM (disks, network, DB rows)
      // ------------------------------------------------------------------
      this.debug.info(`Cleaning up temporary build VM ${tempMachine.id}`)
      try {
        const cleanup = new MachineCleanupServiceV2(this.prisma)
        await cleanup.cleanupVM(tempMachine.id)
      } catch (cleanupErr) {
        // Best-effort — don't fail the build if cleanup partially fails.
        this.debug.warn(
          `Temp VM cleanup failed for ${tempMachine.id}: ` +
          `${(cleanupErr as Error).message}`
        )
      }
    }
  }
  // Creation — capture from an existing VM
  // ---------------------------------------------------------------------

  async captureFromMachine (input: CaptureFromMachineInput): Promise<GoldenImage> {
    const machine = await this.prisma.machine.findUnique({
      where: { id: input.machineId },
      include: { configuration: true }
    })
    if (!machine) {
      throw new Error(`Machine not found: ${input.machineId}`)
    }

    const osType = inferGoldenImageOsType(machine.os)
    if (!osType) {
      throw new Error(`Could not infer golden-image OS type from machine.os='${machine.os}'`)
    }

    const parentVersion = input.parentImageId
      ? await this.prisma.goldenImage.findUnique({ where: { id: input.parentImageId } })
      : null

    const image = await this.prisma.goldenImage.create({
      data: {
        name: input.name,
        osType,
        baseDiskPath: '',
        status: 'building',
        version: parentVersion ? parentVersion.version + 1 : 1,
        parentImageId: parentVersion?.id,
        sourceType: 'manual-capture',
        sourceMachineId: machine.id,
        sourceTemplateId: machine.templateId ?? undefined,
        hardeningApplied: input.hardeningOptions as Prisma.InputJsonValue ?? Prisma.JsonNull,
        notes: input.notes,
        createdById: input.createdById
      }
    })

    void this.runCaptureFromMachine(image.id, machine, input).catch((err) => {
      this.debug.error(`captureFromMachine failed for image=${image.id}: ${err?.message}`)
      void this.markFailed(image.id, err?.message ?? 'unknown error')
    })

    return image
  }

  private async runCaptureFromMachine (
    imageId: string,
    machine: Machine & { configuration: { diskPaths: Prisma.JsonValue | null } | null },
    input: CaptureFromMachineInput
  ): Promise<void> {
    this.emitProgress(imageId, 5, 'preparing')

    const diskPaths = (machine.configuration?.diskPaths as string[] | null) ?? []
    const sourceDisk = diskPaths[0]
    if (!sourceDisk) {
      throw new Error(`Machine ${machine.id} has no known disk path`)
    }

    const destroySource = Boolean(input.destroySource)
    const sanitizeUserData = input.sanitizeUserData ?? true

    const infinization = await getInfinization()

    // ── Stop the source, then atomically claim it as CAPTURING (SF-2) ─────────
    // Stop first so the row is genuinely OFF/ERROR for the claim. The claim is
    // the cross-service gate: it refuses if the VM already carries a disk-op
    // marker (a concurrent backup/snapshot owns it) and, once held, blocks any
    // power-on or other qemu-img op for the exclusive convert/copy window that
    // reads the source disk. Without it, a concurrent claim could tear the disk
    // mid-convert and a direct startVM would bypass isDiskOperationInProgress.
    this.emitProgress(imageId, 10, 'stopping_source')
    try {
      const status = await infinization.getVMStatus(machine.id)
      if (status.processAlive) {
        await infinization.stopVM(machine.id, { force: false, timeout: 60000 })
      }
    } catch (err) {
      this.debug.warn(`stopVM before capture: ${(err as Error).message}`)
    }

    if (!await this.claimCapturing(machine.id)) {
      throw new Error(
        `Cannot capture machine ${machine.id}: it is not stopped or a ` +
        'backup/restore/snapshot/capture is already in progress. ' +
        'Ensure the VM is OFF and no other disk operation is running, then retry.'
      )
    }

    // Determine target base path and staging path.
    await fs.mkdir(BASE_IMAGE_DIR, { recursive: true })
    const stagingPath = path.join(BASE_IMAGE_DIR, `building-${imageId}.qcow2`)
    const finalPath = path.join(BASE_IMAGE_DIR, `${imageId}.qcow2`)

    // The CAPTURING marker MUST be released on every exit path so a failed
    // capture never strands the VM un-startable. The variants release it
    // themselves BEFORE restarting the source (the hardened start() refuses a
    // disk-op marker); this finally is the catch-all backstop for the convert
    // window and any error before the variant's own release. It only flips a row
    // still on CAPTURING, so a clean release inside the variant is a no-op here.
    try {
      if (destroySource) {
        await this.runCaptureDestroySource(
          imageId, machine.id, sanitizeUserData, sourceDisk, finalPath
        )
      } else {
        await this.runCapturePreserveSource(
          imageId, machine.id, sanitizeUserData,
          sourceDisk, stagingPath, finalPath
        )
      }
    } finally {
      await this.releaseCapturing(machine.id)
    }

    const stat = await fs.stat(finalPath)
    await this.prisma.goldenImage.update({
      where: { id: imageId },
      data: {
        baseDiskPath: finalPath,
        sizeBytes: BigInt(stat.size),
        status: 'draft',
        sealedAt: new Date()
      }
    })
    this.emitProgress(imageId, 100, 'draft')
  }

  /**
   * In-place capture: boot source VM, seal, shut down, copy disk to base/.
   * The source machine is archived — its disk is now a golden image.
   */
  private async runCaptureDestroySource (
    imageId: string,
    machineId: string,
    sanitizeUserData: boolean,
    sourceDisk: string,
    finalPath: string
  ): Promise<void> {
    // Release CAPTURING BEFORE booting: the hardened library start() (and the
    // VMOperationsService guard) refuses to start a VM whose status is a disk-op
    // marker. Power-on through the GUARDED path, not infinization.startVM direct.
    this.emitProgress(imageId, 20, 'starting_for_seal')
    await this.releaseCapturing(machineId)
    await this.startSourceGuarded(machineId)

    this.emitProgress(imageId, 35, 'waiting_for_agent')
    await this.waitForAgentConnection(machineId, SETUP_WAIT_TIMEOUT_MS)

    this.emitProgress(imageId, 55, 'sealing')
    await this.sendPrepareGoldenImage(machineId, {
      sanitizeUserData,
      shutdownAfter: true
    })

    this.emitProgress(imageId, 75, 'waiting_for_shutdown')
    await this.waitForShutdown(machineId, SHUTDOWN_WAIT_TIMEOUT_MS)

    // Re-claim CAPTURING for the post-shutdown copy so nothing boots the source
    // over the disk we are reading. Best-effort: if the row isn't OFF/ERROR after
    // the seal we log and proceed (the VM is shut down). The final 'archived'
    // status below supersedes the marker; the parent finally's release then no-ops.
    if (!await this.claimCapturing(machineId)) {
      this.debug.warn(
        `Could not re-claim CAPTURING on ${machineId} for the promote copy ` +
        '(row not OFF/ERROR after seal); proceeding — source is shut down.'
      )
    }

    this.emitProgress(imageId, 85, 'promoting_disk')
    await fs.copyFile(sourceDisk, finalPath)

    await this.prisma.machine.update({
      where: { id: machineId },
      data: { status: 'archived' }
    })
  }

  /**
   * Safe capture: clone source disk to staging, boot+seal source VM,
   * convert sealed disk → finalPath, then restore original disk from
   * the staging clone. The source machine is left untouched.
   */
  private async runCapturePreserveSource (
    imageId: string,
    machineId: string,
    sanitizeUserData: boolean,
    sourceDisk: string,
    stagingPath: string,
    finalPath: string
  ): Promise<void> {
    // 1. Snapshot the source disk before any modifications. This runs while we
    //    still hold CAPTURING (claimed by the caller) — exclusive read of the
    //    source disk, no concurrent power-on or qemu-img op possible.
    this.emitProgress(imageId, 20, 'cloning_disk')
    await this.convertDisk(sourceDisk, stagingPath)

    try {
      // 2. Boot the source VM, seal, shut down. Release CAPTURING BEFORE the boot
      //    — the hardened library start() refuses a disk-op-marker row — and go
      //    through the GUARDED power-on path (not infinization.startVM direct).
      this.emitProgress(imageId, 25, 'starting_for_seal')
      await this.releaseCapturing(machineId)
      await this.startSourceGuarded(machineId)

      this.emitProgress(imageId, 35, 'waiting_for_agent')
      await this.waitForAgentConnection(machineId, SETUP_WAIT_TIMEOUT_MS)

      this.emitProgress(imageId, 55, 'sealing')
      await this.sendPrepareGoldenImage(machineId, {
        sanitizeUserData,
        shutdownAfter: true
      })

      this.emitProgress(imageId, 75, 'waiting_for_shutdown')
      await this.waitForShutdown(machineId, SHUTDOWN_WAIT_TIMEOUT_MS)

      // 3. Re-claim CAPTURING for the post-shutdown convert + restore window so
      //    nothing boots the source over the disk we are reading/rewriting. The
      //    re-claim only succeeds if the row came back to OFF/ERROR after the
      //    seal-shutdown; if it can't be re-claimed (e.g. something else grabbed
      //    it) we still proceed — the source is shut down and assertVmStopped is
      //    not in this path — but log it. The finally below releases whatever we
      //    hold.
      if (!await this.claimCapturing(machineId)) {
        this.debug.warn(
          `Could not re-claim CAPTURING on ${machineId} for the promote/restore ` +
          'window (row not OFF/ERROR after seal); proceeding — source is shut down.'
        )
      }

      // 4. Convert the sealed disk → golden image.
      this.emitProgress(imageId, 85, 'promoting_disk')
      await this.convertDisk(sourceDisk, finalPath)
    } finally {
      // 5. Always restore the source disk from the pre-seal snapshot so
      //    the machine is left in its original (unsealed) state. This
      //    runs even if an earlier step threw — the admin's VM must not
      //    be left with a sealed disk. We may still hold CAPTURING here
      //    (re-claimed at step 3, or never released if the boot itself threw),
      //    which is exactly what we want: an exclusive lock for this overwrite of
      //    the source disk. The parent runCaptureFromMachine finally releases it.
      this.emitProgress(imageId, 92, 'restoring_source')
      try {
        await this.convertDisk(stagingPath, sourceDisk)
      } catch (restoreErr) {
        this.debug.error(
          `Failed to restore source disk for machine=${machineId}: ` +
          `${(restoreErr as Error).message}. The VM disk may be in a sealed state.`
        )
      }

      // 6. Clean up the staging file.
      await fs.unlink(stagingPath).catch(() => {})
    }
  }

  // ---------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------

  async publish (id: string, autoDeprecatePrevious = true): Promise<GoldenImage> {
    const img = await this.prisma.goldenImage.findUnique({ where: { id } })
    if (!img) throw new Error(`Golden image not found: ${id}`)
    if (img.status !== 'draft') {
      throw new Error(`Only draft images can be published (current status: ${img.status})`)
    }
    // Compute the family before opening the transaction (read-only walk over
    // the table; publishing doesn't change parent links).
    const familyIds = autoDeprecatePrevious ? await this.familyMemberIds(img) : []

    // Publish and supersede older published versions atomically: a family should
    // have at most one published image at a time. Doing these as separate
    // statements risks a crash leaving two `published` images — the exact
    // ambiguous state this auto-deprecation exists to prevent.
    const now = new Date()
    const { updated, deprecated } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.goldenImage.update({
        where: { id },
        data: { status: 'published' }
      })
      let deprecated: GoldenImage[] = []
      if (familyIds.length > 0) {
        const previouslyPublished = await tx.goldenImage.findMany({
          where: {
            id: { in: familyIds, not: updated.id },
            status: 'published'
          }
        })
        deprecated = await Promise.all(previouslyPublished.map((old) =>
          tx.goldenImage.update({
            where: { id: old.id },
            data: { status: 'deprecated', deprecatedAt: now }
          })
        ))
      }
      return { updated, deprecated }
    })

    this.emitUpdate(updated)
    for (const dep of deprecated) {
      this.emitUpdate(dep)
      this.debug.info(
        `Auto-deprecated golden image ${dep.id} (v${dep.version}) superseded by ${updated.id} (v${updated.version})`
      )
    }

    return updated
  }

  /**
   * Returns the ids of every image in `img`'s version family: walk up to the
   * root via parentImageId, then collect all descendants. Used to decide which
   * older published versions a freshly-published image supersedes.
   */
  private async familyMemberIds (img: GoldenImage): Promise<string[]> {
    const all = await this.prisma.goldenImage.findMany({
      select: { id: true, parentImageId: true }
    })
    const byId = new Map(all.map((i) => [i.id, i]))

    // Walk up to the family root.
    let rootId = img.id
    let cursor = byId.get(img.id)
    const visited = new Set<string>([img.id])
    while (cursor?.parentImageId && byId.has(cursor.parentImageId) && !visited.has(cursor.parentImageId)) {
      visited.add(cursor.parentImageId)
      rootId = cursor.parentImageId
      cursor = byId.get(cursor.parentImageId)
    }

    // BFS down from the root to gather every descendant.
    const members = new Set<string>([rootId])
    const queue = [rootId]
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const candidate of all) {
        if (candidate.parentImageId === current && !members.has(candidate.id)) {
          members.add(candidate.id)
          queue.push(candidate.id)
        }
      }
    }

    return [...members]
  }

  async deprecate (id: string): Promise<GoldenImage> {
    const img = await this.prisma.goldenImage.findUnique({ where: { id } })
    if (!img) throw new Error(`Golden image not found: ${id}`)
    if (img.status === 'deprecated') return img
    const updated = await this.prisma.goldenImage.update({
      where: { id },
      data: { status: 'deprecated', deprecatedAt: new Date() }
    })
    this.emitUpdate(updated)
    return updated
  }

  async delete (id: string): Promise<boolean> {
    const img = await this.prisma.goldenImage.findUnique({ where: { id } })
    if (!img) return false

    // Block delete when any template references this image — a live
    // template with a dangling goldenImageId would break new-VM creation.
    const refs = await this.prisma.machineTemplate.count({
      where: { goldenImageId: id }
    })
    if (refs > 0) {
      throw new Error(
        `Cannot delete golden image ${id}: referenced by ${refs} template(s). ` +
        'Re-point or delete those templates first.'
      )
    }

    if (img.baseDiskPath) {
      await fs.unlink(img.baseDiskPath).catch((err) => {
        this.debug.warn(`delete: could not unlink ${img.baseDiskPath}: ${err.message}`)
      })
    }

    await this.prisma.goldenImage.delete({ where: { id } })
    const eventManager = getEventManager()
    await eventManager.dispatchEvent?.('golden_images', 'delete', { id })
    return true
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async sendPrepareGoldenImage (
    machineId: string,
    opts: { sanitizeUserData: boolean; shutdownAfter: boolean }
  ): Promise<void> {
    const command: SafeCommandType = {
      action: 'PrepareGoldenImage',
      cleanup_level: 'standard',
      sanitize_user_data: opts.sanitizeUserData,
      shutdown_after: opts.shutdownAfter
    }
    const response = await this.virtioWatcher.sendSafeCommand(
      machineId,
      command,
      SEAL_COMMAND_TIMEOUT_MS
    )
    if (!response.success) {
      throw new Error(`PrepareGoldenImage failed: ${response.error ?? 'unknown'}`)
    }
  }

  private async waitForSetupComplete (machineId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const cfg = await this.prisma.machineConfiguration.findUnique({
        where: { machineId }
      })
      if (cfg?.setupComplete) return
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error(`Timed out waiting for setupComplete on machine ${machineId}`)
  }

  /**
   * Wait for the in-guest agent's virtio-serial connection to come up before we
   * send a command to the guest (e.g. PrepareGoldenImage).
   *
   * The SEAL paths must NOT gate on waitForSetupComplete: setupComplete is a
   * persistent provisioning flag that is ALREADY true for an existing VM, so it
   * returns instantly after the reboot-for-seal — and PrepareGoldenImage then
   * fires before the rebooted guest has finished booting and reconnected its
   * agent, so sendSafeCommand throws "No connection to VM" (observed capture
   * failure). Gate on a live agent connection instead. A timeout here is the
   * actionable failure to surface: the guest never brought its agent up
   * (infiniservice not installed / not running).
   */
  private async waitForAgentConnection (machineId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.virtioWatcher.isVmConnected(machineId)) return
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error(
      `Timed out waiting for the in-guest agent to connect on machine ${machineId}. ` +
      'Golden-image capture reboots the VM and seals it through the Infinibay ' +
      'agent (infiniservice) over virtio-serial — ensure the agent is installed ' +
      'and running in the guest, then retry.'
    )
  }

  private async waitForShutdown (machineId: string, timeoutMs: number): Promise<void> {
    const infinization = await getInfinization()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const status = await infinization.getVMStatus(machineId)
        if (!status.processAlive) return
      } catch (err) {
        // Treat "not found" as shutdown.
        const msg = (err as Error).message ?? ''
        if (msg.toLowerCase().includes('not found')) return
        this.debug.warn(`waitForShutdown poll error: ${msg}`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error(`Timed out waiting for machine ${machineId} to shut down`)
  }

  /**
   * Atomically claim a STOPPED source VM row (OFF/ERROR) as CAPTURING for the
   * exclusive `qemu-img convert`/`copyFile` window of a golden-image capture
   * (SF-2). CAPTURING is a disk-op marker: while it is held, every power-on path
   * refuses the VM (isDiskOperationInProgress) and a concurrent backup/snapshot's
   * own claim (OFF/ERROR → marker) sees count !== 1 and bails — so nothing can
   * boot QEMU or start another qemu-img op over the disk we are converting.
   * Returns true when THIS caller won the claim.
   */
  private async claimCapturing (machineId: string): Promise<boolean> {
    const claimed = await this.prisma.machine.updateMany({
      where: { id: machineId, status: { in: [OFF_STATUS, ERROR_STATUS] } },
      data: { status: CAPTURING_STATUS }
    })
    return claimed.count === 1
  }

  /**
   * Release a CAPTURING claim, flipping the row back to OFF — but only if it is
   * still on the CAPTURING marker WE set (so we never clobber a status another
   * flow legitimately moved on to). Never throws: a failed release is logged,
   * because it runs in `finally` paths that must not mask the real error. The
   * startup `reconcileOrphanedDiskOpMarkers` (which iterates DISK_OP_STATUSES,
   * now including CAPTURING) is the backstop if a hard crash skips this.
   *
   * IMPORTANT: the capture flow must release CAPTURING BEFORE any internal
   * restart of the source — the hardened library VMLifecycle.start() refuses to
   * start a VM whose DB status is a disk-op marker, so a CAPTURING row cannot be
   * booted to be sealed.
   */
  private async releaseCapturing (machineId: string): Promise<void> {
    try {
      await this.prisma.machine.updateMany({
        where: { id: machineId, status: CAPTURING_STATUS },
        data: { status: OFF_STATUS }
      })
    } catch (err) {
      this.debug.error(
        `Failed to release CAPTURING marker on VM ${machineId}: ` +
        `${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  /**
   * Start the source VM for sealing through the GUARDED power-on path
   * (VMOperationsService.startMachine), NOT infinization.startVM directly, so the
   * disk-op-marker guard is honoured. The caller MUST have released CAPTURING
   * first (see releaseCapturing) — otherwise the guard (and the hardened library
   * start()) would refuse the boot. Throws on failure so the capture flow aborts
   * and its finally re-releases / restores the source.
   */
  private async startSourceGuarded (machineId: string): Promise<void> {
    const result = await new VMOperationsService(this.prisma).startMachine(machineId)
    if (!result.success) {
      throw new Error(
        `Failed to start source VM ${machineId} for sealing: ${result.error ?? 'unknown error'}`
      )
    }
  }

  private async convertDisk (sourcePath: string, destPath: string): Promise<void> {
    // Prefer infinization's QemuImgService.convertImage for consistency,
    // but it's not currently exposed through getInfinization(). Shelling
    // out to qemu-img directly is acceptable for this service and
    // matches how BackupService does it.
    const { execFile } = await import('child_process')
    await new Promise<void>((resolve, reject) => {
      execFile(
        'qemu-img',
        ['convert', '-O', 'qcow2', sourcePath, destPath],
        { maxBuffer: 10 * 1024 * 1024 },
        (err) => (err ? reject(err) : resolve())
      )
    })
  }

  private emitProgress (imageId: string, percent: number, step: string): void {
    const eventManager = getEventManager()
    void eventManager.dispatchEvent?.('golden_images', 'progress', {
      id: imageId,
      progressPercent: percent,
      step
    })
  }

  private emitUpdate (image: GoldenImage): void {
    const eventManager = getEventManager()
    void eventManager.dispatchEvent?.('golden_images', 'update', image)
  }

  // -------------------------------------------------------------------
  // Retry — re-runs the build for a failed image
  // -------------------------------------------------------------------

  async retryBuild (imageId: string): Promise<GoldenImage> {
    const image = await this.prisma.goldenImage.findUnique({ where: { id: imageId } })
    if (!image) throw new Error(`Golden image not found: ${imageId}`)
    if (image.status !== 'failed') throw new Error('Only failed images can be retried')

    // Reset the image row back to building state
    await this.prisma.goldenImage.update({
      where: { id: imageId },
      data: {
        status: 'building',
        notes: image.notes?.replace(/\[build failed\].*\n?/, '') ?? null,
        updatedAt: new Date()
      }
    })

    if (image.sourceType === 'automated' && image.sourceTemplateId) {
      // Re-run the automated build orchestration using the stored template ID
      void this.runBuildAutomated(image.id, image.sourceTemplateId, {
        templateId: image.sourceTemplateId,
        name: image.name,
        notes: image.notes ?? undefined,
        hardeningOptions: (image.hardeningApplied as Record<string, boolean>) ?? undefined,
        parentImageId: image.parentImageId ?? undefined
      }).catch((err) => {
        this.debug.error(`retryBuild orchestration failed for image=${image.id}: ${err?.message}`)
      })
    } else {
      throw new Error(
        'Cannot retry this image — only automated (template-based) builds are supported for retry'
      )
    }

    return (await this.prisma.goldenImage.findUnique({ where: { id: imageId } }))!
  }

  private async markFailed (imageId: string, reason: string): Promise<void> {
    try {
      await this.prisma.goldenImage.update({
        where: { id: imageId },
        data: {
          status: 'failed',
          notes: `[build failed] ${reason}`
        }
      })
    } catch (err) {
      this.debug.error(`markFailed could not update image=${imageId}: ${(err as Error).message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep (ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function inferGoldenImageOsType (hint: string): string | null {
  const s = hint.toLowerCase()
  if (s.includes('windows11') || s.includes('windows 11') || s.includes('win11')) return 'windows-11'
  if (s.includes('windows10') || s.includes('windows 10') || s.includes('win10')) return 'windows-10'
  if (s.includes('ubuntu')) return 'ubuntu'
  if (s.includes('fedora')) return 'fedora'
  return null
}
