import ivm from 'isolated-vm';
import { PrismaClient, Automation, Machine, VMHealthSnapshot, SystemMetrics } from '@prisma/client';

const debug = require('debug')('infinibay:automation:executor');

export interface AutomationContext {
  vmId: string;
  vmName: string;

  // System Metrics
  metrics: {
    cpuUsagePercent: number;
    cpuCoresUsage: number[];
    cpuTemperature: number | null;
    totalMemoryKB: number;
    usedMemoryKB: number;
    availableMemoryKB: number;
    swapTotalKB: number;
    swapUsedKB: number;
    uptime: number;
  };

  // Disk info
  disks: Array<{
    drive: string;
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
  }>;

  // Processes
  processes: Array<{
    name: string;
    pid: number;
    cpuPercent: number;
    memoryKB: number;
  }>;

  // Windows Defender
  defender: {
    isEnabled: boolean;
    realTimeProtection: boolean;
    threatCount: number;
    lastScanDate: Date | null;
  };

  // Windows Updates
  updates: {
    pendingCount: number;
    criticalCount: number;
    daysSinceLastUpdate: number;
  };
}

export interface ExecutionResult {
  triggered: boolean;
  evaluationTimeMs: number;
  error?: string;
  contextSnapshot?: AutomationContext;
}

export class AutomationExecutor {
  private static readonly MEMORY_LIMIT_MB = 128;
  private static readonly TIMEOUT_MS = 5000;

  constructor(private prisma: PrismaClient) {}

  /**
   * Execute an automation's code against a VM's health data
   */
  async execute(
    automation: Automation,
    machine: Machine,
    snapshot: VMHealthSnapshot,
    metrics: SystemMetrics
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    debug('Executing automation %s for machine %s', automation.name, machine.name);

    if (!automation.compiledCode) {
      throw new Error('Automation code not compiled');
    }

    try {
      // 1. Build context from health data
      const context = await this.buildContext(machine, snapshot, metrics);

      // 2. Execute in sandbox
      const triggered = await this.executeInSandbox(automation.compiledCode, context);

      const evaluationTimeMs = Date.now() - startTime;
      debug('Automation %s evaluation complete in %dms, triggered: %s',
        automation.name, evaluationTimeMs, triggered);

      return {
        triggered,
        evaluationTimeMs,
        contextSnapshot: context,
      };
    } catch (error) {
      const evaluationTimeMs = Date.now() - startTime;
      debug('Automation %s execution failed: %s', automation.name, error);

      return {
        triggered: false,
        evaluationTimeMs,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build the automation context from VM health data
   */
  private async buildContext(
    machine: Machine,
    snapshot: VMHealthSnapshot,
    metrics: SystemMetrics
  ): Promise<AutomationContext> {
    // Parse JSON fields from snapshot
    const diskInfo = (snapshot.diskSpaceInfo as Record<string, unknown>) || {};
    const defenderStatus = (snapshot.defenderStatus as Record<string, unknown>) || {};
    const updateInfo = (snapshot.windowsUpdateInfo as Record<string, unknown>) || {};

    // Get recent process snapshots
    const processes = await this.prisma.processSnapshot.findMany({
      where: { machineId: machine.id },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    // Transform disk info to array format
    const disks = Object.entries(diskInfo).map(([drive, info]: [string, unknown]) => {
      const diskData = info as Record<string, number>;
      return {
        drive,
        totalGB: diskData.totalGB || 0,
        usedGB: diskData.usedGB || 0,
        freeGB: diskData.freeGB || 0,
        usagePercent: diskData.usagePercent || 0,
      };
    });

    return {
      vmId: machine.id,
      vmName: machine.name,

      metrics: {
        cpuUsagePercent: metrics.cpuUsagePercent ?? 0,
        cpuCoresUsage: (metrics.cpuCoresUsage as number[]) || [],
        cpuTemperature: metrics.cpuTemperature,
        totalMemoryKB: Number(metrics.totalMemoryKB ?? 0),
        usedMemoryKB: Number(metrics.usedMemoryKB ?? 0),
        availableMemoryKB: Number(metrics.availableMemoryKB ?? 0),
        swapTotalKB: Number(metrics.swapTotalKB ?? 0),
        swapUsedKB: Number(metrics.swapUsedKB ?? 0),
        uptime: Number(metrics.uptime) || 0,
      },

      disks,

      processes: processes.map(p => ({
        name: p.name,
        pid: p.processId,
        cpuPercent: p.cpuUsagePercent ?? 0,
        memoryKB: Number(p.memoryUsageKB ?? 0),
      })),

      defender: {
        isEnabled: Boolean(defenderStatus.isEnabled),
        realTimeProtection: Boolean(defenderStatus.realTimeProtection),
        threatCount: Number(defenderStatus.threatCount) || 0,
        lastScanDate: defenderStatus.lastScanDate ? new Date(defenderStatus.lastScanDate as string) : null,
      },

      updates: {
        pendingCount: Number(updateInfo.pendingCount) || 0,
        criticalCount: Number(updateInfo.criticalCount) || 0,
        daysSinceLastUpdate: Number(updateInfo.daysSinceLastUpdate) || 0,
      },
    };
  }

  /**
   * Execute the automation code in an isolated sandbox
   */
  private async executeInSandbox(code: string, context: AutomationContext): Promise<boolean> {
    // Create isolate with memory limit
    const isolate = new ivm.Isolate({ memoryLimit: AutomationExecutor.MEMORY_LIMIT_MB });

    try {
      const vmContext = await isolate.createContext();

      // Create safe context (no functions, no prototypes)
      const safeContext = this.sanitizeContext(context);

      // Get global reference
      const jail = vmContext.global;
      await jail.set('global', jail.derefInto());

      // Set context in VM
      await jail.set('context', new ivm.ExternalCopy(safeContext).copyInto());

      // Inject helper functions
      await this.injectHelpers(jail, context);

      // Wrap code in async function that returns boolean
      const wrappedCode = `
        (function() {
          ${code}
          return false;
        })()
      `;

      // Compile and run with timeout
      const script = await isolate.compileScript(wrappedCode);
      const result = await script.run(vmContext, { timeout: AutomationExecutor.TIMEOUT_MS });

      return Boolean(result);
    } finally {
      isolate.dispose();
    }
  }

  /**
   * Sanitize context to remove functions and create plain object
   */
  private sanitizeContext(context: AutomationContext): Record<string, unknown> {
    return JSON.parse(JSON.stringify({
      vmId: context.vmId,
      vmName: context.vmName,
      metrics: context.metrics,
      disks: context.disks,
      processes: context.processes,
      defender: context.defender,
      updates: context.updates,
    }));
  }

  /**
   * Inject helper functions into the sandbox
   */
  private async injectHelpers(
    jail: ivm.Reference<Record<string | number | symbol, unknown>>,
    context: AutomationContext
  ): Promise<void> {
    // getDiskUsagePercent
    await jail.set('getDiskUsagePercent', new ivm.Callback((drive: string) => {
      const disk = context.disks.find(d => d.drive.toLowerCase() === drive.toLowerCase());
      return disk?.usagePercent ?? 0;
    }));

    // getDiskFreeGB
    await jail.set('getDiskFreeGB', new ivm.Callback((drive: string) => {
      const disk = context.disks.find(d => d.drive.toLowerCase() === drive.toLowerCase());
      return disk?.freeGB ?? 0;
    }));

    // getProcessCPU
    await jail.set('getProcessCPU', new ivm.Callback((processName: string) => {
      const proc = context.processes.find(p =>
        p.name.toLowerCase().includes(processName.toLowerCase())
      );
      return proc?.cpuPercent ?? 0;
    }));

    // isProcessRunning
    await jail.set('isProcessRunning', new ivm.Callback((processName: string) => {
      return context.processes.some(p =>
        p.name.toLowerCase().includes(processName.toLowerCase())
      );
    }));

    // getHighCPUProcesses
    await jail.set('getHighCPUProcesses', new ivm.Callback((threshold: number) => {
      return context.processes
        .filter(p => p.cpuPercent > threshold)
        .map(p => p.name);
    }));

    // Also add these functions to context object for dot notation access
    const contextExtensions = `
      context.getDiskUsagePercent = getDiskUsagePercent;
      context.getDiskFreeGB = getDiskFreeGB;
      context.getProcessCPU = getProcessCPU;
      context.isProcessRunning = isProcessRunning;
      context.getHighCPUProcesses = getHighCPUProcesses;
    `;

    // We can't directly modify context in the jail, so these remain as global functions
    debug('Helper functions injected into sandbox');
  }
}
