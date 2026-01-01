import { PrismaClient, Automation, Machine, VMHealthSnapshot, AutomationExecutionStatus, Prisma } from '@prisma/client';
import { AutomationExecutor, ExecutionResult } from './AutomationExecutor';
import { RecommendationService } from './RecommendationService';
import { ScriptScheduler } from '../scripts/ScriptScheduler';
import { EventManager } from '../EventManager';

const debug = require('debug')('infinibay:automation:trigger');

type AutomationWithScripts = Automation & {
  automationScripts: Array<{
    id: string;
    scriptId: string | null;
    systemScriptId: string | null;
    os: string;
    executionOrder: number;
    isEnabled: boolean;
    script?: { id: string; name: string } | null;
    systemScript?: { id: string; name: string; displayName: string } | null;
  }>;
};

export class AutomationTriggerService {
  private static instance: AutomationTriggerService | null = null;
  private executor: AutomationExecutor;

  private constructor(
    private prisma: PrismaClient,
    private scriptScheduler: ScriptScheduler,
    private eventManager?: EventManager
  ) {
    this.executor = new AutomationExecutor(prisma);
  }

  /**
   * Get singleton instance
   */
  static getInstance(
    prisma: PrismaClient,
    scriptScheduler: ScriptScheduler,
    eventManager?: EventManager
  ): AutomationTriggerService {
    if (!AutomationTriggerService.instance) {
      AutomationTriggerService.instance = new AutomationTriggerService(
        prisma, scriptScheduler, eventManager
      );
    }
    return AutomationTriggerService.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    AutomationTriggerService.instance = null;
  }

  // ═══════════════════════════════════════════════════════════════
  // MAIN ENTRY POINT - Called when new health snapshot is created
  // ═══════════════════════════════════════════════════════════════

  /**
   * Process a new health snapshot and evaluate all applicable automations
   */
  async onHealthSnapshotCreated(snapshot: VMHealthSnapshot): Promise<void> {
    debug('Processing health snapshot %s for machine %s', snapshot.id, snapshot.machineId);

    const machine = await this.prisma.machine.findUnique({
      where: { id: snapshot.machineId },
      include: { department: true },
    });

    if (!machine) {
      debug('Machine not found: %s', snapshot.machineId);
      return;
    }

    // Get applicable automations
    const automations = await this.getApplicableAutomations(machine);
    debug('Found %d applicable automations', automations.length);

    if (automations.length === 0) {
      return;
    }

    // Get latest metrics
    const metrics = await this.prisma.systemMetrics.findFirst({
      where: { machineId: machine.id },
      orderBy: { timestamp: 'desc' },
    });

    if (!metrics) {
      debug('No metrics found for machine %s', machine.id);
      return;
    }

    // Process each automation
    for (const automation of automations) {
      try {
        await this.processAutomation(automation, machine, snapshot, metrics);
      } catch (error) {
        debug('Error processing automation %s: %s', automation.name, error);
      }
    }
  }

  /**
   * Get automations applicable to a machine based on scope
   */
  private async getApplicableAutomations(
    machine: Machine & { department: { id: string; name: string } | null }
  ): Promise<AutomationWithScripts[]> {
    return this.prisma.automation.findMany({
      where: {
        isEnabled: true,
        status: 'APPROVED',
        isCompiled: true,
        OR: [
          // ALL_VMS scope
          { targetScope: 'ALL_VMS' },
          // DEPARTMENT scope matching machine's department
          {
            targetScope: 'DEPARTMENT',
            departmentId: machine.departmentId,
          },
          // SPECIFIC_VMS scope with this machine as target
          {
            targetScope: 'SPECIFIC_VMS',
            targets: {
              some: { machineId: machine.id },
            },
          },
          // EXCLUDE_VMS scope without this machine
          {
            targetScope: 'EXCLUDE_VMS',
            targets: {
              none: { machineId: machine.id },
            },
          },
        ],
      },
      include: {
        automationScripts: {
          where: { isEnabled: true },
          include: {
            script: { select: { id: true, name: true } },
            systemScript: { select: { id: true, name: true, displayName: true } },
          },
          orderBy: { executionOrder: 'asc' },
        },
      },
      orderBy: { priority: 'asc' },
    }) as Promise<AutomationWithScripts[]>;
  }

  /**
   * Process a single automation for a machine
   */
  private async processAutomation(
    automation: AutomationWithScripts,
    machine: Machine,
    snapshot: VMHealthSnapshot,
    metrics: any
  ): Promise<void> {
    debug('Processing automation %s for machine %s', automation.name, machine.name);

    // Check cooldown
    const inCooldown = await this.isInCooldown(automation.id, machine.id, automation.cooldownMinutes);

    if (inCooldown) {
      debug('Automation %s in cooldown for machine %s', automation.name, machine.name);

      // Log as skipped
      await this.prisma.automationExecution.create({
        data: {
          automationId: automation.id,
          machineId: machine.id,
          snapshotId: snapshot.id,
          triggerReason: 'Skipped: cooldown active',
          evaluationResult: false,
          status: 'SKIPPED',
        },
      });
      return;
    }

    // Execute automation
    const result = await this.executor.execute(automation, machine, snapshot, metrics);

    // Log execution
    const execution = await this.prisma.automationExecution.create({
      data: {
        automationId: automation.id,
        machineId: machine.id,
        snapshotId: snapshot.id,
        triggerReason: result.triggered ? 'Condition met' : 'Condition not met',
        evaluationResult: result.triggered,
        status: this.mapResultToStatus(result),
        evaluationTimeMs: result.evaluationTimeMs,
        contextSnapshot: result.contextSnapshot as unknown as Prisma.InputJsonValue,
        error: result.error,
        evaluatedAt: new Date(),
      },
    });

    // If triggered, create recommendation and optionally execute scripts
    if (result.triggered) {
      await this.handleTriggeredAutomation(automation, machine, execution.id);
    } else {
      // Check if we should auto-resolve existing recommendation
      const recommendationService = new RecommendationService(this.prisma, null, this.scriptScheduler, this.eventManager);
      await recommendationService.checkAndAutoResolve(automation.id, machine.id, result.triggered);
    }

    // Emit event
    this.eventManager?.emitCRUD('automations', 'update', automation.id, {
      action: 'executed',
      automation,
      machine,
      execution,
      result,
    });
  }

  /**
   * Check if automation is in cooldown for a machine
   */
  private async isInCooldown(
    automationId: string,
    machineId: string,
    cooldownMinutes: number
  ): Promise<boolean> {
    const cooldownThreshold = new Date(Date.now() - cooldownMinutes * 60 * 1000);

    // Check for recent triggered execution
    const recentExecution = await this.prisma.automationExecution.findFirst({
      where: {
        automationId,
        machineId,
        evaluationResult: true,
        triggeredAt: { gte: cooldownThreshold },
      },
    });

    if (recentExecution) {
      return true;
    }

    // Also check for pending recommendation (user hasn't acted yet)
    const pendingRecommendation = await this.prisma.automationRecommendation.findFirst({
      where: {
        automationId,
        machineId,
        status: 'PENDING',
      },
    });

    return !!pendingRecommendation;
  }

  /**
   * Handle a triggered automation - create recommendation and/or execute scripts
   */
  private async handleTriggeredAutomation(
    automation: AutomationWithScripts,
    machine: Machine,
    executionId: string
  ): Promise<void> {
    debug('Handling triggered automation %s for machine %s', automation.name, machine.name);

    // Determine OS
    const osType = (machine as any).os?.toUpperCase().includes('WINDOWS') ? 'WINDOWS' : 'LINUX';

    // Get scripts for this OS
    const scripts = automation.automationScripts.filter(
      (as) => as.os === osType && as.isEnabled
    );

    // Create recommendation
    const recommendationService = new RecommendationService(
      this.prisma,
      null,
      this.scriptScheduler,
      this.eventManager
    );

    // Determine which script to link to recommendation
    const primaryScript = scripts[0];

    await recommendationService.createRecommendation({
      automationId: automation.id,
      machineId: machine.id,
      executionId,
      title: automation.recommendationText || automation.name,
      description: automation.recommendationActionText || automation.description || undefined,
      severity: this.mapPriorityToSeverity(automation.priority),
      scriptId: primaryScript?.scriptId || undefined,
      systemScriptId: primaryScript?.systemScriptId || undefined,
    });

    // Update execution with status
    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: 'TRIGGERED',
        triggeredAt: new Date(),
      },
    });
  }

  /**
   * Map execution result to status enum
   */
  private mapResultToStatus(result: ExecutionResult): AutomationExecutionStatus {
    if (result.error) {
      return 'FAILED';
    }
    if (result.triggered) {
      return 'TRIGGERED';
    }
    return 'COMPLETED';
  }

  /**
   * Map automation priority to recommendation severity
   */
  private mapPriorityToSeverity(priority: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (priority <= 25) return 'CRITICAL';
    if (priority <= 50) return 'HIGH';
    if (priority <= 75) return 'MEDIUM';
    return 'LOW';
  }

  // ═══════════════════════════════════════════════════════════════
  // MANUAL TRIGGER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Manually trigger evaluation of an automation for a machine
   */
  async triggerManual(automationId: string, machineId: string): Promise<ExecutionResult> {
    const automation = await this.prisma.automation.findUnique({
      where: { id: automationId },
      include: {
        automationScripts: {
          where: { isEnabled: true },
          include: {
            script: { select: { id: true, name: true } },
            systemScript: { select: { id: true, name: true, displayName: true } },
          },
        },
      },
    });

    if (!automation) {
      throw new Error('Automation not found');
    }

    if (!automation.isCompiled || !automation.compiledCode) {
      throw new Error('Automation not compiled');
    }

    const machine = await this.prisma.machine.findUnique({
      where: { id: machineId },
    });

    if (!machine) {
      throw new Error('Machine not found');
    }

    const snapshot = await this.prisma.vMHealthSnapshot.findFirst({
      where: { machineId },
      orderBy: { createdAt: 'desc' },
    });

    if (!snapshot) {
      throw new Error('No health snapshot available');
    }

    const metrics = await this.prisma.systemMetrics.findFirst({
      where: { machineId },
      orderBy: { timestamp: 'desc' },
    });

    if (!metrics) {
      throw new Error('No metrics available');
    }

    return this.executor.execute(automation, machine, snapshot, metrics);
  }

  // ═══════════════════════════════════════════════════════════════
  // MAINTENANCE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Reactivate snoozed recommendations that have expired
   */
  async reactivateSnoozedRecommendations(): Promise<number> {
    const recommendationService = new RecommendationService(
      this.prisma,
      null,
      this.scriptScheduler,
      this.eventManager
    );
    return recommendationService.reactivateSnoozedRecommendations();
  }

  /**
   * Expire old pending recommendations
   */
  async expireOldRecommendations(olderThanDays: number = 30): Promise<number> {
    const recommendationService = new RecommendationService(
      this.prisma,
      null,
      this.scriptScheduler,
      this.eventManager
    );
    return recommendationService.expireOldRecommendations(olderThanDays);
  }
}
