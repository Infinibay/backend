import { Resolver, Query } from 'type-graphql';
import * as si from 'systeminformation';
import { SystemResources } from './type';

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
}