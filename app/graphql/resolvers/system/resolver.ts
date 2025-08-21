import { Resolver, Query, Ctx } from 'type-graphql';
import * as si from 'systeminformation';
import { SystemResources, GPU } from './type';
import { InfinibayContext } from '../../../utils/context';

@Resolver(() => SystemResources)
export class SystemResolver {
  @Query(() => SystemResources)
  async getSystemResources(): Promise<SystemResources> {
    try {
      // Get CPU information
      const cpuData = await si.cpu();
      
      // Get memory information
      const memData = await si.mem();
      
      // Get disk information for Infinibay storage directory
      const infinibayDir = process.env.INFINIBAY_BASE_DIR || '/opt/infinibay';
      const diskData = await si.fsSize();
      
      // Find the disk that contains the Infinibay directory
      let targetDisk = null;
      for (const disk of diskData) {
        if (infinibayDir.startsWith(disk.mount)) {
          if (!targetDisk || disk.mount.length > targetDisk.mount.length) {
            targetDisk = disk;
          }
        }
      }
      
      // If no disk found, use the root disk
      if (!targetDisk) {
        targetDisk = diskData.find(d => d.mount === '/') || diskData[0];
      }
      
      // Calculate available cores (total cores minus some reserve for system)
      const totalCores = cpuData.cores;
      const availableCores = Math.max(1, totalCores - 1); // Reserve 1 core for system
      
      // Calculate available memory (in GB)
      const totalMemoryGB = memData.total / (1024 * 1024 * 1024);
      const availableMemoryGB = memData.available / (1024 * 1024 * 1024);
      
      // Calculate disk space (in GB)
      const totalDiskGB = targetDisk.size / (1024 * 1024 * 1024);
      const usedDiskGB = targetDisk.used / (1024 * 1024 * 1024);
      const availableDiskGB = targetDisk.available / (1024 * 1024 * 1024);
      
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
      };
    } catch (error) {
      console.error('Error getting system resources:', error);
      
      // Return default values if there's an error
      return {
        cpu: {
          total: 8,
          available: 7
        },
        memory: {
          total: 16,
          available: 8
        },
        disk: {
          total: 500,
          used: 100,
          available: 400
        }
      };
    }
  }

  @Query(() => [GPU])
  async getGraphics(@Ctx() { prisma }: InfinibayContext): Promise<GPU[]> {
    try {
      // Fetch already assigned GPU buses
      const assignments = await prisma.machineConfiguration.findMany({
        where: { assignedGpuBus: { not: null } },
        select: { assignedGpuBus: true }
      });
      const usedBuses = assignments.map(a => a.assignedGpuBus!).filter(Boolean);
      
      // Get all GPU controllers
      const controllers = (await si.graphics()).controllers;
      
      // Filter out GPUs in use
      const available = controllers.filter(ctrl => {
        const bus = ctrl.pciBus || `00000000:${ctrl.busAddress}` || '';
        return !usedBuses.includes(bus);
      });
      
      // Map to GraphQL type
      return available.map(controller => ({
        pciBus: controller.pciBus || `00000000:${controller.busAddress}` || '',
        vendor: controller.vendor,
        model: controller.name || controller.model,
        memory: (controller.vram || 0) / 1024 // Convert MB to GB
      }));
    } catch (error) {
      console.error('Error getting graphics cards:', error);
      return [];
    }
  }
}