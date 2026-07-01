import logger from '@main/logger'
import { Resolver, Query, Ctx } from 'type-graphql'
import * as si from 'systeminformation'
import * as fs from 'fs'
import * as path from 'path'
import { SystemResources, GPU } from './type'
import { InfinibayContext } from '../../../utils/context'
import { Can } from '@main/permissions'
import { ApolloError } from '@utils/errors'
import { sanitizeErrorForUser } from '@utils/sanitizeError'

/**
 * Mirrors CreateMachineServiceV2.validateGpuPassthrough. Returns a non-null
 * `reason` whenever passthrough cannot work for this PCI address right now —
 * the wizard surfaces it in the disabled card's tooltip.
 */
function checkGpuPassthrough (pciBus: string): { ready: boolean, reason: string | null } {
  if (!pciBus) return { ready: false, reason: 'No PCI address detected for this GPU.' }

  const addr = pciBus.toLowerCase().includes(':')
    ? pciBus.toLowerCase()
    : `0000:${pciBus.toLowerCase()}`
  const sysDevice = `/sys/bus/pci/devices/${addr}`

  if (!fs.existsSync(sysDevice)) {
    return { ready: false, reason: `${pciBus} not found in sysfs (stale PCI address).` }
  }
  const iommuLink = path.join(sysDevice, 'iommu_group')
  if (!fs.existsSync(iommuLink)) {
    return { ready: false, reason: 'IOMMU not enabled in BIOS or kernel cmdline.' }
  }
  let groupId: string
  try {
    groupId = path.basename(fs.readlinkSync(iommuLink))
  } catch {
    return { ready: false, reason: 'IOMMU group symlink unreadable.' }
  }
  if (!fs.existsSync(`/dev/vfio/${groupId}`)) {
    return { ready: false, reason: `IOMMU group ${groupId} not exposed via /dev/vfio (vfio-pci kernel module not loaded or device unbound).` }
  }
  const driverLink = path.join(sysDevice, 'driver')
  let driver: string | null = null
  if (fs.existsSync(driverLink)) {
    try { driver = path.basename(fs.readlinkSync(driverLink)) } catch { /* ignore */ }
  }
  if (driver !== 'vfio-pci') {
    return {
      ready: false,
      reason: `Bound to "${driver ?? 'no driver'}", not vfio-pci. Unbind and bind to vfio-pci to enable passthrough.`
    }
  }
  return { ready: true, reason: null }
}

@Resolver(() => SystemResources)
export class SystemResolver {
  @Query(() => SystemResources)
  @Can('system:view')
  async getSystemResources (
    @Ctx() context: InfinibayContext
  ): Promise<SystemResources> {
    try {
      // Get CPU information
      const cpuData = await si.cpu()

      // Get memory information
      const memData = await si.mem()

      // Get disk information for Infinibay storage directory
      const infinibayDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay'
      const diskData = await si.fsSize()

      // Find the disk that contains the Infinibay directory
      let targetDisk = null
      for (const disk of diskData) {
        if (infinibayDir.startsWith(disk.mount)) {
          if (!targetDisk || disk.mount.length > targetDisk.mount.length) {
            targetDisk = disk
          }
        }
      }

      // If no disk found, use the root disk
      if (!targetDisk) {
        targetDisk = diskData.find(d => d.mount === '/') || diskData[0]
      }

      // If the probe returned no filesystems at all, surface a real error
      // instead of dereferencing undefined and masking it with fabricated
      // capacity numbers (see catch block rationale below).
      if (!targetDisk) {
        throw new ApolloError('No filesystem information available', 'SYSTEM_RESOURCES_UNAVAILABLE')
      }

      // Calculate available cores (total cores minus some reserve for system)
      const totalCores = cpuData.cores
      const availableCores = Math.max(1, totalCores - 1) // Reserve 1 core for system

      // Calculate available memory (in GB)
      const totalMemoryGB = memData.total / (1024 * 1024 * 1024)
      const availableMemoryGB = memData.available / (1024 * 1024 * 1024)

      // Calculate disk space (in GB)
      const totalDiskGB = targetDisk.size / (1024 * 1024 * 1024)
      const usedDiskGB = targetDisk.used / (1024 * 1024 * 1024)
      const availableDiskGB = targetDisk.available / (1024 * 1024 * 1024)

      return {
        cpu: {
          total: totalCores,
          available: availableCores
        },
        memory: {
          total: Math.round(totalMemoryGB),
          available: Math.round(availableMemoryGB)
        },
        disk: {
          total: Math.round(totalDiskGB),
          used: Math.round(usedDiskGB),
          available: Math.round(availableDiskGB)
        }
      }
    } catch (error) {
      logger.error('Error getting system resources:', error)

      // Do NOT fabricate capacity on failure: hard-coded defaults (16 GB RAM,
      // 500 GB disk, …) can exceed the real host and let the create-VM wizard
      // over-commit into OOM. Surface a real error so the client renders a
      // capacity-unavailable state instead of masked, invented numbers.
      if (error instanceof ApolloError) throw error
      throw new ApolloError(
        sanitizeErrorForUser(error instanceof Error ? error.message : String(error)) ?? 'System resources unavailable',
        'SYSTEM_RESOURCES_UNAVAILABLE'
      )
    }
  }

  @Query(() => [GPU])
  @Can('system:view')
  async getGraphics (@Ctx() context: InfinibayContext): Promise<GPU[]> {
    try {
      // Fetch already assigned GPU buses
      const assignments = await context.prisma.machineConfiguration.findMany({
        where: { assignedGpuBus: { not: null } },
        select: { assignedGpuBus: true }
      })
      const usedBuses = assignments
        .map(a => a.assignedGpuBus)
        .filter((bus): bus is string => Boolean(bus))

      // Get all GPU controllers
      const controllers = (await si.graphics()).controllers

      // Filter out GPUs in use
      const available = controllers.filter(ctrl => {
        const bus = ctrl.pciBus || `0000:${ctrl.busAddress}` || ''
        return !usedBuses.includes(bus)
      })

      // Map to GraphQL type, including VFIO passthrough readiness so the
      // wizard can grey out GPUs that would fail the create-time pre-flight
      // (CreateMachineServiceV2.validateGpuPassthrough). Same checks here.
      return available.map(controller => {
        const pciBus = controller.pciBus || `0000:${controller.busAddress}` || ''
        const { ready, reason } = checkGpuPassthrough(pciBus)
        return {
          pciBus,
          vendor: controller.vendor,
          model: controller.name || controller.model,
          memory: (controller.vram || 0) / 1024, // Convert MB to GB
          passthroughReady: ready,
          passthroughBlockedReason: reason
        }
      })
    } catch (error) {
      logger.error('Error getting graphics cards:', error)
      return []
    }
  }
}
