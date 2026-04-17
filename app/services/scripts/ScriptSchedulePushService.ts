import { PrismaClient } from '@prisma/client';
import { getVirtioSocketWatcherService } from '../VirtioSocketWatcherService';
import logger from '@main/logger';

const log = logger.child({ module: 'infinibay:service:script-schedule-push' });

/**
 * ScriptSchedulePushService
 *
 * Periodically checks for due scheduled scripts and proactively pushes them to online VMs.
 * Runs every 60 seconds to ensure timely execution of scheduled scripts.
 *
 * This complements the on-demand push in ScriptScheduler.scheduleScript() by handling:
 * - Future one-time schedules that become due after creation
 * - Periodic schedules whose next interval has arrived
 * - Scripts scheduled while VM was offline that become executable when VM comes online
 */
export class ScriptSchedulePushService {
  private intervalTimer?: NodeJS.Timeout;
  private isRunning = false;
  private readonly CHECK_INTERVAL_MS = 60000; // 60 seconds

  constructor(private prisma: PrismaClient) {}

  /**
   * Start the periodic push service
   */
  public start(): void {
    if (this.intervalTimer) {
      log.debug('ScriptSchedulePushService is already running');
      return;
    }

    log.debug('Starting ScriptSchedulePushService (check interval: %dms)', this.CHECK_INTERVAL_MS);

    // Run immediately on start
    this.checkAndPushDueScripts().catch(error => {
      log.debug('Error in initial script push check: %s', error.message);
    });

    // Schedule periodic checks
    this.intervalTimer = setInterval(() => {
      this.checkAndPushDueScripts().catch(error => {
        log.debug('Error in periodic script push check: %s', error.message);
      });
    }, this.CHECK_INTERVAL_MS);

    log.debug('✅ ScriptSchedulePushService started');
  }

  /**
   * Stop the periodic push service
   */
  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
      log.debug('ScriptSchedulePushService stopped');
    }
  }

  /**
   * Check for due scheduled scripts and push them to online VMs
   */
  private async checkAndPushDueScripts(): Promise<void> {
    if (this.isRunning) {
      log.debug('Script push check already in progress, skipping');
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();

      // Query for all PENDING executions that are due
      const dueExecutions = await this.prisma.scriptExecution.findMany({
        where: {
          status: 'PENDING',
          OR: [
            // Immediate scripts (scheduledFor is null or in the past)
            { scheduledFor: null },
            { scheduledFor: { lte: now } }
          ]
        },
        include: {
          machine: {
            select: {
              id: true,
              name: true,
              status: true
            }
          },
          script: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: {
          scheduledFor: 'asc'
        }
      });

      if (dueExecutions.length === 0) {
        log.debug('No due scheduled scripts found');
        return;
      }

      log.debug('Found %d due scheduled script executions', dueExecutions.length);

      // Group executions by machine ID
      const executionsByMachine = new Map<string, typeof dueExecutions>();
      for (const execution of dueExecutions) {
        const machineId = execution.machineId;
        if (!executionsByMachine.has(machineId)) {
          executionsByMachine.set(machineId, []);
        }
        executionsByMachine.get(machineId)!.push(execution);
      }

      log.debug('Grouped executions across %d VMs', executionsByMachine.size);

      // Get VirtioSocketWatcherService instance
      const virtioService = getVirtioSocketWatcherService();

      // Process each machine
      let successCount = 0;
      let failureCount = 0;
      let offlineCount = 0;

      for (const [machineId, executions] of executionsByMachine) {
        try {
          // Check if machine is online
          const machine = executions[0].machine;

          if (machine.status !== 'running') {
            log.debug('VM %s (%s) is offline (status: %s), skipping %d executions',
              machine.name, machineId, machine.status, executions.length);
            offlineCount++;
            continue;
          }

          // Push pending scripts to online VM
          const result = await virtioService.pushPendingScriptsToVM(machineId);

          if (result.success) {
            log.debug('✅ Pushed %d scripts to VM %s (%s)',
              result.scriptCount, machine.name, machineId);
            successCount++;
          } else {
            log.debug('⚠️ Failed to push scripts to VM %s (%s): %s',
              machine.name, machineId, result.error);
            failureCount++;
          }
        } catch (error) {
          log.debug('Error pushing scripts to VM %s: %s', machineId, (error as Error).message);
          failureCount++;
        }
      }

      log.debug('Script push cycle complete: %d successful, %d failed, %d offline',
        successCount, failureCount, offlineCount);
    } catch (error) {
      log.debug('Error in checkAndPushDueScripts: %s', (error as Error).message);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manually trigger a check and push cycle (useful for testing or on-demand triggers)
   */
  public async triggerPush(): Promise<void> {
    log.debug('Manual push trigger requested');
    await this.checkAndPushDueScripts();
  }
}

// Singleton instance
let instance: ScriptSchedulePushService | null = null;

/**
 * Create and start the ScriptSchedulePushService singleton
 */
export function createScriptSchedulePushService(prisma: PrismaClient): ScriptSchedulePushService {
  if (instance) {
    log.debug('ScriptSchedulePushService instance already exists');
    return instance;
  }

  instance = new ScriptSchedulePushService(prisma);
  instance.start();
  return instance;
}

/**
 * Get the ScriptSchedulePushService singleton instance
 */
export function getScriptSchedulePushService(): ScriptSchedulePushService {
  if (!instance) {
    throw new Error('ScriptSchedulePushService has not been initialized. Call createScriptSchedulePushService() first.');
  }
  return instance;
}
