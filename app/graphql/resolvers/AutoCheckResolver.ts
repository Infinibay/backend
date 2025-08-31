import { Resolver, Query, Mutation, Arg, ID, Authorized, Ctx } from 'type-graphql';
import { GraphQLJSONObject } from 'graphql-type-json';
import { getVirtioSocketWatcherService, VirtioSocketWatcherService } from '@services/VirtioSocketWatcherService';
import { InfinibayContext } from '@utils/context';

// Constants for command timeouts
const LONG_RUNNING_COMMAND_TIMEOUT = 300000; // 5 minutes for WMI-heavy operations

// Define specific response types instead of using 'any'
interface HealthCheckResponse {
  success: boolean;
  vmId: string;
  healthStatus?: unknown;
  result?: unknown;
  checkName?: string;
  diskStatus?: unknown;
  optimizationStatus?: unknown;
  updateStatus?: unknown;
  updateHistory?: unknown;
  defenderStatus?: unknown;
  applicationInventory?: unknown;
  availableUpdates?: unknown;
  scanResult?: unknown;
  cleanupResult?: unknown;
  error?: string;
  timestamp: string;
}

@Resolver()
export class AutoCheckResolver {
  private getVirtioSocketService(): VirtioSocketWatcherService {
    return getVirtioSocketWatcherService();
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Get comprehensive health check status for a VM' 
  })
  @Authorized('USER')
  async getVMHealthStatus(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'RunAllHealthChecks' },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        healthStatus: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Run a specific health check on a VM' 
  })
  @Authorized('USER')
  async runHealthCheck(
    @Arg('vmId', () => ID) vmId: string,
    @Arg('checkName', () => String) checkName: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'RunHealthCheck', params: { check_name: checkName } },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        checkName,
        result: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        checkName,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Check disk space status for a VM' 
  })
  @Authorized('USER')
  async checkVMDiskSpace(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('warningThreshold', () => Number, { nullable: true }) warningThreshold?: number,
    @Arg('criticalThreshold', () => Number, { nullable: true }) criticalThreshold?: number
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const params: Record<string, unknown> = {};
      if (warningThreshold !== undefined) {
        params.warning_threshold = warningThreshold;
      }
      if (criticalThreshold !== undefined) {
        params.critical_threshold = criticalThreshold;
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId, 
        { action: 'CheckDiskSpace', params }
      );

      return {
        success: true,
        vmId,
        diskStatus: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Check resource optimization opportunities for a VM' 
  })
  @Authorized('USER')
  async checkResourceOptimization(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('evaluationWindowDays', () => Number, { nullable: true }) evaluationWindowDays?: number
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const params: Record<string, unknown> = {};
      if (evaluationWindowDays !== undefined) {
        params.evaluation_window_days = evaluationWindowDays;
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId, 
        { action: 'CheckResourceOptimization', params }
      );

      return {
        success: true,
        vmId,
        optimizationStatus: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Check Windows Updates status for a VM' 
  })
  @Authorized('USER')
  async checkWindowsUpdates(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckWindowsUpdates' },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        updateStatus: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Get Windows Update history for a VM' 
  })
  @Authorized('USER')
  async getWindowsUpdateHistory(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('days', () => Number, { nullable: true }) days?: number
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const params: Record<string, unknown> = {};
      if (days !== undefined) {
        params.days = days;
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId, 
        { action: 'GetUpdateHistory', params },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        updateHistory: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Check Windows Defender status for a VM' 
  })
  @Authorized('USER')
  async checkWindowsDefender(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckWindowsDefender' },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        defenderStatus: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Get installed applications inventory for a VM' 
  })
  @Authorized('USER')
  async getVMApplicationInventory(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'GetInstalledApplicationsWMI' },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        applicationInventory: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Query(() => GraphQLJSONObject, { 
    description: 'Check for application updates on a VM' 
  })
  @Authorized('USER')
  async checkApplicationUpdates(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'CheckApplicationUpdates' },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        availableUpdates: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Mutation(() => GraphQLJSONObject, { 
    description: 'Run Windows Defender quick scan on a VM' 
  })
  @Authorized('USER')
  async runDefenderQuickScan(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { action: 'RunDefenderQuickScan' },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        scanResult: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }

  @Mutation(() => GraphQLJSONObject, { 
    description: 'Perform disk cleanup on a VM' 
  })
  @Authorized('USER')
  async performDiskCleanup(
    @Arg('vmId', () => ID) vmId: string,
    @Arg('drive', () => String) drive: string,
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('targets', () => [String], { nullable: true }) targets?: string[]
  ): Promise<HealthCheckResponse> {
    try {
      // Check user access to machine
      const machine = await prisma.machine.findUnique({
        where: { id: vmId }
      });

      if (!machine) {
        throw new Error('Machine not found');
      }

      const isAdmin = user?.role === 'ADMIN';
      const isOwner = machine.userId === user?.id;

      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine');
      }

      const result = await this.getVirtioSocketService().sendSafeCommand(
        vmId,
        { 
          action: 'DiskCleanup', 
          params: {
            drive,
            targets: targets || ['temp_files', 'browser_cache', 'system_cache', 'recycle_bin']
          }
        },
        LONG_RUNNING_COMMAND_TIMEOUT
      );

      return {
        success: true,
        vmId,
        cleanupResult: result.data,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        vmId,
        error: errorMessage,
        timestamp: new Date().toISOString()
      };
    }
  }
}