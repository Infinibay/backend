import { PrismaClient, ExecutionType, ExecutionStatus, Prisma } from '@prisma/client';
import { ScriptManager, ScriptWithContent } from './ScriptManager';
import { TemplateEngine } from './TemplateEngine';
import { ScriptParser } from './ScriptParser';
import { getEventManager } from '../EventManager';
import { getVirtioSocketWatcherService } from '../VirtioSocketWatcherService';

const debug = require('debug')('infinibay:service:script-scheduler');

// Configuration interfaces
export interface ScheduleScriptConfig {
  scriptId: string;
  machineIds?: string[]; // For specific VMs
  departmentId?: string; // For department-wide scheduling
  inputValues: Record<string, any>;
  scheduleType: 'immediate' | 'one-time' | 'periodic';
  scheduledFor?: Date; // Required for one-time
  repeatIntervalMinutes?: number; // Required for periodic
  maxExecutions?: number; // Optional, for periodic
  userId: string; // Who created the schedule
  runAs?: string; // Optional, execution user
}

export interface ScheduleScriptResult {
  success: boolean;
  executionIds: string[];
  error?: string;
  errorCode?: string;
  warnings?: string[];
}

export class ScriptScheduler {
  private prisma: PrismaClient;
  private scriptManager: ScriptManager;
  private templateEngine: TemplateEngine;
  private scriptParser: ScriptParser;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.scriptManager = new ScriptManager(prisma);
    this.templateEngine = new TemplateEngine();
    this.scriptParser = new ScriptParser();
  }

  /**
   * Schedule a script for execution (immediate, one-time, or periodic)
   */
  async scheduleScript(config: ScheduleScriptConfig): Promise<ScheduleScriptResult> {
    try {
      debug('Scheduling script: %s, type: %s', config.scriptId, config.scheduleType);

      // 1. Validate script exists
      const script: ScriptWithContent = await this.scriptManager.getScript(config.scriptId);
      if (!script) {
        throw new Error(`Script with ID ${config.scriptId} not found`);
      }

      // 2. Determine target machines
      let targetMachineIds: string[] = [];
      if (config.departmentId) {
        targetMachineIds = await this.expandDepartmentToVMs(config.departmentId);
      } else if (config.machineIds && config.machineIds.length > 0) {
        targetMachineIds = config.machineIds;
      } else {
        throw new Error('Either machineIds or departmentId must be provided');
      }

      if (targetMachineIds.length === 0) {
        throw new Error('No target machines found');
      }

      debug('Target machines: %O', targetMachineIds);

      // 3. Validate script OS compatibility
      await this.validateScriptOSCompatibility(config.scriptId, targetMachineIds);

      // 3.5. Check VM status and collect warnings
      const warnings: string[] = [];
      const machines = await this.prisma.machine.findMany({
        where: { id: { in: targetMachineIds } },
        select: { id: true, name: true, status: true }
      });

      const offlineVMs = machines.filter(m => m.status !== 'running');
      if (offlineVMs.length > 0) {
        offlineVMs.forEach(vm => {
          warnings.push(`VM "${vm.name}" is currently offline. Schedule will execute when VM starts.`);
        });
        debug('Warning: %d VMs are offline', offlineVMs.length);
      }

      // 4. Validate input values
      this.templateEngine.validateRequiredInputs(script.parsedInputs, config.inputValues);

      // Validate each input value
      for (const input of script.parsedInputs) {
        if (config.inputValues[input.name] !== undefined) {
          this.scriptParser.validateInputValue(input, config.inputValues[input.name]);
        }
      }

      // 5. Determine execution parameters based on schedule type
      let scheduledFor: Date;
      let repeatIntervalMinutes: number | null = null;
      let maxExecutions: number | null = null;

      switch (config.scheduleType) {
        case 'immediate':
          scheduledFor = new Date();
          break;
        case 'one-time':
          if (!config.scheduledFor) {
            throw new Error('scheduledFor is required for one-time schedules');
          }
          scheduledFor = config.scheduledFor;
          maxExecutions = 1;
          break;
        case 'periodic':
          if (!config.repeatIntervalMinutes || config.repeatIntervalMinutes <= 0) {
            throw new Error('repeatIntervalMinutes must be greater than 0 for periodic schedules');
          }
          scheduledFor = new Date();
          repeatIntervalMinutes = config.repeatIntervalMinutes;
          maxExecutions = config.maxExecutions || null;
          break;
        default:
          throw new Error(`Invalid schedule type: ${config.scheduleType}`);
      }

      // 6. Create ScriptExecution records for each target machine
      const executionIds: string[] = [];

      for (const machineId of targetMachineIds) {
        const execution = await this.prisma.scriptExecution.create({
          data: {
            scriptId: config.scriptId,
            machineId,
            executionType: ExecutionType.SCHEDULED,
            status: ExecutionStatus.PENDING,
            triggeredById: config.userId,
            inputValues: config.inputValues as Prisma.InputJsonValue,
            scheduledFor,
            repeatIntervalMinutes,
            lastExecutedAt: null,
            executionCount: 0,
            maxExecutions,
            executedAs: config.runAs || null,
          },
        });

        executionIds.push(execution.id);
        debug('Created ScriptExecution: %s for machine: %s', execution.id, machineId);

        // Create audit log
        await this.createScheduleAuditLog(
          config.scriptId,
          config.userId,
          execution.id,
          machineId,
          config.scheduleType,
          config.inputValues,
          repeatIntervalMinutes,
          maxExecutions
        );
      }

      // 6.5. Push Scripts to Online VMs
      try {
        // Only push for immediate schedules or due one-time/periodic schedules
        const shouldPush = config.scheduleType === 'immediate' ||
          (config.scheduleType === 'one-time' && scheduledFor <= new Date()) ||
          (config.scheduleType === 'periodic' && scheduledFor <= new Date());

        if (shouldPush) {
          const virtioService = getVirtioSocketWatcherService();

          // Group executions by machine ID
          const machineExecutions = new Map<string, string[]>();
          for (let i = 0; i < targetMachineIds.length; i++) {
            const machineId = targetMachineIds[i];
            if (!machineExecutions.has(machineId)) {
              machineExecutions.set(machineId, []);
            }
            machineExecutions.get(machineId)!.push(executionIds[i]);
          }

          // Push to each machine with bounded concurrency (10 VMs at a time)
          const CONCURRENCY_LIMIT = 10;
          const machineEntries = Array.from(machineExecutions.entries());

          // Helper function to push to a single machine
          const pushToMachine = async ([machineId, execIds]: [string, string[]]) => {
            try {
              // Check if machine is online
              const machine = machines.find(m => m.id === machineId);

              if (machine && machine.status === 'running') {
                // Push scripts to online VM
                const result = await virtioService.pushPendingScriptsToVM(machineId);
                debug('Pushed scripts to online VM %s: success=%s, count=%d', machineId, result.success, result.scriptCount);

                if (!result.success) {
                  debug('Failed to push scripts to VM %s: %s (will be picked up on next poll)', machineId, result.error);
                  warnings.push(`Failed to immediately push script to VM "${machine.name}". Script will execute on next VM poll.`);
                }
              } else {
                debug('VM %s is offline (status: %s), scripts will be picked up on next boot/poll', machineId, machine?.status || 'unknown');
              }
            } catch (error) {
              debug('Error pushing scripts to VM %s: %s (will be picked up on next poll)', machineId, (error as Error).message);
              // Don't add to warnings - the offline warning already covers this case
            }
          };

          // Process in chunks with bounded concurrency
          for (let i = 0; i < machineEntries.length; i += CONCURRENCY_LIMIT) {
            const chunk = machineEntries.slice(i, i + CONCURRENCY_LIMIT);
            await Promise.allSettled(chunk.map(pushToMachine));
          }

          debug('Script push completed. Online VMs notified, offline VMs will receive scripts on next poll.');
        }
      } catch (error) {
        debug('Error during script push phase: %s', (error as Error).message);
        // Don't fail the operation - polling mechanism serves as fallback
      }

      // 7. Emit event with standardized payload
      try {
        const eventManager = getEventManager();
        await eventManager.dispatchEvent(
          'scripts',
          'create',
          {
            id: config.scriptId,
            action: 'schedule_created', // Event type for routing
            eventType: 'schedule_created',
            scriptId: config.scriptId,
            executionIds,
            scheduleType: config.scheduleType,
            machineIds: targetMachineIds,
            triggeredBy: config.userId,
            timestamp: new Date().toISOString()
          },
          config.userId
        );
      } catch (error) {
        debug('Failed to emit schedule_created event: %s', (error as Error).message);
        // Don't fail the operation if event emission fails
      }

      debug('Successfully scheduled script with %d executions', executionIds.length);

      return {
        success: true,
        executionIds,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error) {
      debug('Error scheduling script: %s', (error as Error).message);

      // Provide user-friendly error messages
      let userFriendlyError = (error as Error).message;
      let errorCode = 'UNKNOWN_ERROR';

      if (userFriendlyError.includes('not found')) {
        if (userFriendlyError.includes('Script')) {
          userFriendlyError = 'The selected script no longer exists or has been deleted';
          errorCode = 'SCRIPT_NOT_FOUND';
        } else if (userFriendlyError.includes('Machine')) {
          userFriendlyError = 'One or more selected VMs no longer exist';
          errorCode = 'MACHINE_NOT_FOUND';
        }
      } else if (userFriendlyError.includes('Either machineIds or departmentId')) {
        userFriendlyError = 'Please select at least one VM or choose "All VMs in department"';
        errorCode = 'INVALID_TARGET';
      } else if (userFriendlyError.includes('not compatible') || userFriendlyError.includes('unsupported OS')) {
        errorCode = 'OS_INCOMPATIBLE';
      } else if (userFriendlyError.includes('scheduledFor is required')) {
        userFriendlyError = 'Please select a date and time for one-time schedules';
        errorCode = 'MISSING_SCHEDULE_TIME';
      }

      return {
        success: false,
        executionIds: [],
        error: userFriendlyError,
        errorCode
      };
    }
  }

  /**
   * Update a scheduled script execution
   */
  async updateScheduledScript(
    executionId: string,
    updates: Partial<ScheduleScriptConfig>,
    userId: string
  ): Promise<ScheduleScriptResult> {
    try {
      debug('Updating scheduled script execution: %s', executionId);

      // Find existing execution
      const execution = await this.prisma.scriptExecution.findUnique({
        where: { id: executionId },
        include: { script: true, machine: true },
      });

      if (!execution) {
        throw new Error(`ScriptExecution with ID ${executionId} not found`);
      }

      // Verify status is PENDING
      if (execution.status !== ExecutionStatus.PENDING) {
        throw new Error(`Cannot update execution with status ${execution.status}. Only PENDING executions can be updated.`);
      }

      // Build update data
      const updateData: Prisma.ScriptExecutionUpdateInput = {};

      if (updates.scheduledFor !== undefined) {
        updateData.scheduledFor = updates.scheduledFor;
      }

      if (updates.repeatIntervalMinutes !== undefined) {
        updateData.repeatIntervalMinutes = updates.repeatIntervalMinutes;
      }

      if (updates.maxExecutions !== undefined) {
        updateData.maxExecutions = updates.maxExecutions;
      }

      if (updates.runAs !== undefined) {
        updateData.executedAs = updates.runAs;
      }

      if (updates.inputValues !== undefined) {
        // Re-validate input values
        const script: ScriptWithContent = await this.scriptManager.getScript(execution.scriptId);
        this.templateEngine.validateRequiredInputs(script.parsedInputs, updates.inputValues);

        for (const input of script.parsedInputs) {
          if (updates.inputValues[input.name] !== undefined) {
            this.scriptParser.validateInputValue(input, updates.inputValues[input.name]);
          }
        }

        updateData.inputValues = updates.inputValues as Prisma.InputJsonValue;
      }

      // Update the execution
      await this.prisma.scriptExecution.update({
        where: { id: executionId },
        data: updateData,
      });

      debug('Successfully updated scheduled script execution: %s', executionId);

      // Emit event with standardized payload
      try {
        const eventManager = getEventManager();
        await eventManager.dispatchEvent(
          'scripts',
          'update',
          {
            id: execution.scriptId,
            action: 'schedule_updated',
            eventType: 'schedule_updated',
            scriptId: execution.scriptId,
            executionId,
            triggeredBy: userId,
            timestamp: new Date().toISOString()
          },
          userId
        );
      } catch (error) {
        debug('Failed to emit schedule_updated event: %s', (error as Error).message);
      }

      return {
        success: true,
        executionIds: [executionId],
      };
    } catch (error) {
      debug('Error updating scheduled script: %s', (error as Error).message);
      return {
        success: false,
        executionIds: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Cancel a scheduled script execution
   */
  async cancelScheduledScript(executionId: string, userId: string): Promise<boolean> {
    try {
      debug('Cancelling scheduled script execution: %s', executionId);

      const execution = await this.prisma.scriptExecution.findUnique({
        where: { id: executionId },
      });

      if (!execution) {
        throw new Error(`ScriptExecution with ID ${executionId} not found`);
      }

      if (execution.status !== ExecutionStatus.PENDING && execution.status !== ExecutionStatus.RUNNING) {
        throw new Error(`Cannot cancel execution with status ${execution.status}`);
      }

      await this.prisma.scriptExecution.update({
        where: { id: executionId },
        data: {
          status: ExecutionStatus.CANCELLED,
          completedAt: new Date(),
          error: 'Cancelled by user',
        },
      });

      debug('Successfully cancelled scheduled script execution: %s', executionId);

      // Emit event with standardized payload
      try {
        const eventManager = getEventManager();
        await eventManager.dispatchEvent(
          'scripts',
          'delete',
          {
            id: execution.scriptId,
            action: 'schedule_cancelled',
            eventType: 'schedule_cancelled',
            scriptId: execution.scriptId,
            executionId,
            triggeredBy: userId,
            timestamp: new Date().toISOString()
          },
          userId
        );
      } catch (error) {
        debug('Failed to emit schedule_cancelled event: %s', (error as Error).message);
      }

      return true;
    } catch (error) {
      debug('Error cancelling scheduled script: %s', (error as Error).message);
      throw error;
    }
  }

  /**
   * Get scheduled scripts with filters
   */
  async getScheduledScripts(filters: {
    machineId?: string;
    departmentId?: string;
    scriptId?: string;
    status?: ExecutionStatus | ExecutionStatus[];
    scheduleType?: 'one-time' | 'periodic';
    limit?: number;
  }): Promise<any[]> {
    const where: Prisma.ScriptExecutionWhereInput = {
      executionType: ExecutionType.SCHEDULED,
    };

    if (filters.machineId) {
      where.machineId = filters.machineId;
    }

    if (filters.departmentId) {
      where.machine = {
        departmentId: filters.departmentId,
      };
    }

    if (filters.scriptId) {
      where.scriptId = filters.scriptId;
    }

    if (filters.status) {
      where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status;
    }

    if (filters.scheduleType) {
      if (filters.scheduleType === 'one-time') {
        where.repeatIntervalMinutes = null;
      } else {
        where.repeatIntervalMinutes = { not: null };
      }
    }

    const executions = await this.prisma.scriptExecution.findMany({
      where,
      include: {
        script: true,
        machine: true,
        triggeredBy: true,
      },
      orderBy: {
        scheduledFor: 'asc',
      },
      take: filters.limit ?? 50,
    });

    return executions;
  }

  /**
   * Get due periodic schedules (for cron job processing)
   */
  async getDuePeriodicSchedules(): Promise<any[]> {
    const now = new Date();

    const executions = await this.prisma.scriptExecution.findMany({
      where: {
        executionType: ExecutionType.SCHEDULED,
        status: ExecutionStatus.SUCCESS,
        repeatIntervalMinutes: { not: null },
      },
      include: {
        script: true,
        machine: true,
      },
    });

    // Filter for due schedules (lastExecutedAt + repeatIntervalMinutes <= now)
    const dueSchedules = executions.filter((execution) => {
      if (!execution.lastExecutedAt || !execution.repeatIntervalMinutes) {
        return false;
      }

      const nextRunTime = new Date(execution.lastExecutedAt);
      nextRunTime.setMinutes(nextRunTime.getMinutes() + execution.repeatIntervalMinutes);

      return nextRunTime <= now && (!execution.maxExecutions || execution.executionCount < execution.maxExecutions);
    });

    return dueSchedules;
  }

  /**
   * Helper: Expand department ID to list of all VM IDs
   */
  private async expandDepartmentToVMs(departmentId: string): Promise<string[]> {
    const machines = await this.prisma.machine.findMany({
      where: {
        departmentId,
      },
      select: {
        id: true,
      },
    });

    return machines.map((m) => m.id);
  }

  /**
   * Helper: Validate script OS compatibility with target machines
   */
  private async validateScriptOSCompatibility(scriptId: string, machineIds: string[]): Promise<void> {
    const script = await this.prisma.script.findUnique({
      where: { id: scriptId },
      select: { os: true, name: true },
    });

    if (!script) {
      throw new Error(`Script with ID ${scriptId} not found`);
    }

    // If script has no OS restriction, it's compatible with all
    if (!script.os || script.os.length === 0) {
      return;
    }

    // Batch fetch all machines to reduce DB round-trips
    const machines = await this.prisma.machine.findMany({
      where: { id: { in: machineIds } },
      select: { id: true, os: true, name: true },
    });

    // Create a map for quick lookup
    const machineMap = new Map(machines.map(m => [m.id, m]));

    // Check each machine's OS
    for (const machineId of machineIds) {
      const machine = machineMap.get(machineId);

      if (!machine) {
        throw new Error(`Machine with ID ${machineId} not found`);
      }

      const genericMachineOS = this.normalizeOSToGenericType(machine.os);

      if (genericMachineOS === null) {
        throw new Error(
          `Machine "${machine.name}" has an unsupported OS type: ${machine.os}`
        );
      }

      if (!script.os.includes(genericMachineOS as any)) {
        throw new Error(
          `Script "${script.name}" is not compatible with machine "${machine.name}" (OS: ${machine.os}). Compatible OS: ${script.os.join(', ')}`
        );
      }
    }
  }

  /**
   * Helper: Map specific machine OS strings to generic OS enum values
   * This allows scripts with generic OS types (WINDOWS, LINUX) to match machines
   * with specific OS versions (windows11, ubuntu, etc.)
   */
  private normalizeOSToGenericType(machineOS: string): 'WINDOWS' | 'LINUX' | null {
    const osLower = machineOS.toLowerCase();

    // Check for Windows variants (e.g., "windows11", "win10", "Microsoft Windows 11")
    if (osLower.startsWith('windows') || osLower.startsWith('win') || osLower.includes('windows')) {
      return 'WINDOWS';
    }

    // Check for Linux variants
    const linuxDistros = [
      'ubuntu', 'fedora', 'debian', 'centos', 'rhel', 'arch', 'manjaro',
      'suse', 'opensuse', 'alpine', 'rocky', 'alma', 'oracle', 'mint', 'pop', 'gentoo'
    ];
    if (linuxDistros.some(distro => osLower.includes(distro)) || osLower.includes('linux')) {
      return 'LINUX';
    }

    // Unknown OS
    return null;
  }

  /**
   * Check if script has active schedules (for deletion prevention)
   */
  async hasActiveSchedules(scriptId: string): Promise<{ count: number; affectedVMs: Array<{ id: string; name: string }> }> {
    const activeExecutions = await this.prisma.scriptExecution.findMany({
      where: {
        scriptId,
        status: {
          in: [ExecutionStatus.PENDING, ExecutionStatus.RUNNING]
        },
        executionType: ExecutionType.SCHEDULED
      },
      include: {
        machine: {
          select: {
            id: true,
            name: true
          }
        }
      },
      take: 10 // Limit to first 10 for display
    });

    const uniqueVMs = new Map<string, { id: string; name: string }>();
    activeExecutions.forEach(exec => {
      if (exec.machine) {
        uniqueVMs.set(exec.machine.id, { id: exec.machine.id, name: exec.machine.name });
      }
    });

    return {
      count: activeExecutions.length,
      affectedVMs: Array.from(uniqueVMs.values())
    };
  }

  /**
   * Helper: Create audit log for schedule creation
   *
   * Uses 'SCHEDULED' action to distinguish planning (creating schedules) from
   * execution (running scripts). The actual execution will log a separate
   * 'EXECUTED' audit entry when the script runs.
   */
  private async createScheduleAuditLog(
    scriptId: string,
    userId: string,
    executionId: string,
    machineId: string,
    scheduleType: string,
    inputValues: Record<string, any>,
    repeatIntervalMinutes?: number | null,
    maxExecutions?: number | null
  ): Promise<void> {
    try {
      // Sanitize input values (remove passwords)
      const sanitizedInputs = { ...inputValues };
      Object.keys(sanitizedInputs).forEach((key) => {
        if (key.toLowerCase().includes('password')) {
          sanitizedInputs[key] = '***REDACTED***';
        }
      });

      const details: Record<string, any> = {
        executionId,
        machineId,
        scheduleType,
        inputValues: sanitizedInputs,
        executionType: ExecutionType.SCHEDULED,
        isPeriodic: repeatIntervalMinutes !== null && repeatIntervalMinutes !== undefined,
        executionCount: 0, // Initial execution count
      };

      // Add scheduling metadata
      if (repeatIntervalMinutes !== null && repeatIntervalMinutes !== undefined) {
        details.repeatIntervalMinutes = repeatIntervalMinutes;
      }
      if (maxExecutions !== null && maxExecutions !== undefined) {
        details.maxExecutions = maxExecutions;
      }

      await this.prisma.scriptAuditLog.create({
        data: {
          scriptId,
          userId,
          action: 'SCHEDULED', // SCHEDULED for planning, EXECUTED for running
          details: details as Prisma.InputJsonValue,
          ipAddress: null,
          userAgent: null,
        },
      });
    } catch (error) {
      console.error('Failed to create schedule audit log:', error);
    }
  }
}
