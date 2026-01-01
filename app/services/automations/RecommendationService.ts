import { PrismaClient, AutomationRecommendation, AutomationRecommendationStatus, RecommendationSeverity, Prisma } from '@prisma/client';
import { ScriptScheduler } from '../scripts/ScriptScheduler';
import { EventManager } from '../EventManager';

const debug = require('debug')('infinibay:automation:recommendation');

export interface CreateRecommendationInput {
  automationId: string;
  machineId: string;
  executionId?: string;
  title: string;
  description?: string;
  severity?: RecommendationSeverity;
  scriptId?: string;
  systemScriptId?: string;
}

export type SnoozeDuration = 'PT1H' | 'PT4H' | 'PT24H' | 'P7D';

export interface SnoozeOptions {
  duration: SnoozeDuration;
}

export class RecommendationService {
  constructor(
    private prisma: PrismaClient,
    private userId: string | null,
    private scriptScheduler?: ScriptScheduler,
    private eventManager?: EventManager
  ) {}

  // ═══════════════════════════════════════════════════════════════
  // QUERIES
  // ═══════════════════════════════════════════════════════════════

  /**
   * Get pending recommendations for a specific machine
   */
  async getPendingForMachine(machineId: string): Promise<AutomationRecommendation[]> {
    return this.prisma.automationRecommendation.findMany({
      where: {
        machineId,
        status: 'PENDING',
      },
      orderBy: [
        { severity: 'desc' },
        { createdAt: 'asc' },
      ],
      include: {
        automation: { select: { id: true, name: true } },
        script: { select: { id: true, name: true } },
        systemScript: { select: { id: true, name: true, displayName: true } },
      },
    });
  }

  /**
   * Get all pending recommendations (global)
   */
  async getAllPending(): Promise<AutomationRecommendation[]> {
    return this.prisma.automationRecommendation.findMany({
      where: { status: 'PENDING' },
      orderBy: [
        { severity: 'desc' },
        { createdAt: 'asc' },
      ],
      include: {
        automation: { select: { id: true, name: true } },
        machine: { select: { id: true, name: true } },
        script: { select: { id: true, name: true } },
        systemScript: { select: { id: true, name: true, displayName: true } },
      },
    });
  }

  /**
   * Get count of pending recommendations
   */
  async getPendingCount(machineId?: string): Promise<number> {
    return this.prisma.automationRecommendation.count({
      where: {
        ...(machineId && { machineId }),
        status: 'PENDING',
      },
    });
  }

  /**
   * Get a recommendation by ID
   */
  async getById(id: string): Promise<AutomationRecommendation | null> {
    return this.prisma.automationRecommendation.findUnique({
      where: { id },
      include: {
        automation: true,
        machine: true,
        script: true,
        systemScript: true,
        scriptExecution: true,
        actionTakenBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // CREATE (called by AutomationTriggerService)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Create a new recommendation
   */
  async createRecommendation(input: CreateRecommendationInput): Promise<AutomationRecommendation> {
    debug('Creating recommendation for automation %s, machine %s', input.automationId, input.machineId);

    // Check if there's already a pending recommendation for this automation+machine
    const existing = await this.prisma.automationRecommendation.findFirst({
      where: {
        automationId: input.automationId,
        machineId: input.machineId,
        status: 'PENDING',
      },
    });

    if (existing) {
      debug('Pending recommendation already exists: %s', existing.id);
      return existing;
    }

    // Check if snoozed and not yet expired
    const snoozed = await this.prisma.automationRecommendation.findFirst({
      where: {
        automationId: input.automationId,
        machineId: input.machineId,
        status: 'SNOOZED',
        snoozeUntil: { gt: new Date() },
      },
    });

    if (snoozed) {
      debug('Recommendation snoozed until %s', snoozed.snoozeUntil);
      return snoozed;
    }

    const recommendation = await this.prisma.automationRecommendation.create({
      data: {
        automationId: input.automationId,
        machineId: input.machineId,
        executionId: input.executionId,
        title: input.title,
        description: input.description,
        severity: input.severity ?? 'MEDIUM',
        scriptId: input.scriptId,
        systemScriptId: input.systemScriptId,
        status: 'PENDING',
      },
      include: {
        automation: true,
        machine: true,
      },
    });

    this.eventManager?.emitCRUD('recommendations', 'create', recommendation.id, { recommendation });

    return recommendation;
  }

  // ═══════════════════════════════════════════════════════════════
  // USER ACTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Execute the recommended action (run script)
   */
  async executeAction(id: string): Promise<AutomationRecommendation> {
    debug('User executing recommendation: %s', id);

    const recommendation = await this.getById(id);
    if (!recommendation) throw new Error('Recommendation not found');
    if (recommendation.status !== 'PENDING') {
      throw new Error('Recommendation is not pending');
    }

    // Execute the script
    let scriptExecutionId: string | undefined;

    if ((recommendation.scriptId || recommendation.systemScriptId) && this.scriptScheduler) {
      try {
        const result = await this.scriptScheduler.scheduleScript({
          scriptId: recommendation.scriptId ?? '',
          machineIds: [recommendation.machineId],
          inputValues: {},
          scheduleType: 'immediate',
          userId: this.userId ?? 'system',
        });

        if (result.success && result.executionIds.length > 0) {
          scriptExecutionId = result.executionIds[0];
        }
      } catch (error) {
        debug('Failed to execute script: %s', error);
      }
    }

    const updated = await this.prisma.automationRecommendation.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        userAction: 'EXECUTE',
        actionTakenById: this.userId,
        actionTakenAt: new Date(),
        scriptExecutionId,
      },
      include: {
        automation: true,
        machine: true,
        scriptExecution: true,
      },
    });

    this.eventManager?.emitCRUD('recommendations', 'update', id, {
      recommendation: updated,
      action: 'executed',
    });

    return updated;
  }

  /**
   * Dismiss a recommendation
   */
  async dismissAction(id: string, reason?: string): Promise<AutomationRecommendation> {
    debug('User dismissing recommendation: %s', id);

    const recommendation = await this.getById(id);
    if (!recommendation) throw new Error('Recommendation not found');
    if (recommendation.status !== 'PENDING') {
      throw new Error('Recommendation is not pending');
    }

    const updated = await this.prisma.automationRecommendation.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        userAction: 'DISMISS',
        actionTakenById: this.userId,
        actionTakenAt: new Date(),
        dismissReason: reason,
      },
      include: { automation: true, machine: true },
    });

    this.eventManager?.emitCRUD('recommendations', 'update', id, {
      recommendation: updated,
      action: 'dismissed',
    });

    return updated;
  }

  /**
   * Snooze a recommendation
   */
  async snoozeAction(id: string, options: SnoozeOptions): Promise<AutomationRecommendation> {
    debug('User snoozing recommendation: %s for %s', id, options.duration);

    const recommendation = await this.getById(id);
    if (!recommendation) throw new Error('Recommendation not found');
    if (recommendation.status !== 'PENDING') {
      throw new Error('Recommendation is not pending');
    }

    // Parse ISO 8601 duration
    const durationMs = this.parseDuration(options.duration);
    const snoozeUntil = new Date(Date.now() + durationMs);

    const updated = await this.prisma.automationRecommendation.update({
      where: { id },
      data: {
        status: 'SNOOZED',
        userAction: 'SNOOZE',
        actionTakenById: this.userId,
        actionTakenAt: new Date(),
        snoozeUntil,
      },
      include: { automation: true, machine: true },
    });

    this.eventManager?.emitCRUD('recommendations', 'update', id, {
      recommendation: updated,
      action: 'snoozed',
      snoozeUntil,
    });

    return updated;
  }

  // ═══════════════════════════════════════════════════════════════
  // BATCH ACTIONS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Dismiss all pending recommendations
   */
  async dismissAll(machineId?: string): Promise<number> {
    const result = await this.prisma.automationRecommendation.updateMany({
      where: {
        status: 'PENDING',
        ...(machineId && { machineId }),
      },
      data: {
        status: 'DISMISSED',
        userAction: 'DISMISS',
        actionTakenById: this.userId,
        actionTakenAt: new Date(),
        dismissReason: 'Batch dismiss',
      },
    });

    debug('Dismissed %d recommendations', result.count);
    return result.count;
  }

  /**
   * Snooze all pending recommendations
   */
  async snoozeAll(duration: SnoozeDuration, machineId?: string): Promise<number> {
    const durationMs = this.parseDuration(duration);
    const snoozeUntil = new Date(Date.now() + durationMs);

    const result = await this.prisma.automationRecommendation.updateMany({
      where: {
        status: 'PENDING',
        ...(machineId && { machineId }),
      },
      data: {
        status: 'SNOOZED',
        userAction: 'SNOOZE',
        actionTakenById: this.userId,
        actionTakenAt: new Date(),
        snoozeUntil,
      },
    });

    debug('Snoozed %d recommendations until %s', result.count, snoozeUntil);
    return result.count;
  }

  // ═══════════════════════════════════════════════════════════════
  // AUTO-RESOLUTION
  // ═══════════════════════════════════════════════════════════════

  /**
   * Auto-resolve a recommendation when condition no longer met
   */
  async autoResolve(id: string, reason: string): Promise<AutomationRecommendation> {
    debug('Auto-resolving recommendation: %s, reason: %s', id, reason);

    const updated = await this.prisma.automationRecommendation.update({
      where: { id },
      data: {
        status: 'AUTO_RESOLVED',
        autoResolvedAt: new Date(),
        autoResolveReason: reason,
      },
      include: { automation: true, machine: true },
    });

    this.eventManager?.emitCRUD('recommendations', 'update', id, {
      recommendation: updated,
      action: 'auto_resolved',
    });

    return updated;
  }

  /**
   * Check and auto-resolve recommendations for an automation+machine
   */
  async checkAndAutoResolve(
    automationId: string,
    machineId: string,
    conditionStillMet: boolean
  ): Promise<void> {
    if (conditionStillMet) return;

    // Find pending recommendation for this automation+machine
    const pending = await this.prisma.automationRecommendation.findFirst({
      where: {
        automationId,
        machineId,
        status: 'PENDING',
      },
    });

    if (pending) {
      await this.autoResolve(pending.id, 'Condition no longer met');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════

  /**
   * Expire old pending recommendations
   */
  async expireOldRecommendations(olderThanDays: number = 30): Promise<number> {
    const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await this.prisma.automationRecommendation.updateMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: threshold },
      },
      data: {
        status: 'EXPIRED',
      },
    });

    debug('Expired %d old recommendations', result.count);
    return result.count;
  }

  /**
   * Reactivate snoozed recommendations that have expired
   */
  async reactivateSnoozedRecommendations(): Promise<number> {
    const result = await this.prisma.automationRecommendation.updateMany({
      where: {
        status: 'SNOOZED',
        snoozeUntil: { lt: new Date() },
      },
      data: {
        status: 'PENDING',
        snoozeUntil: null,
      },
    });

    debug('Reactivated %d snoozed recommendations', result.count);
    return result.count;
  }

  /**
   * Get recommendation statistics
   */
  async getStats(): Promise<{
    pending: number;
    executed: number;
    dismissed: number;
    snoozed: number;
    autoResolved: number;
    expired: number;
  }> {
    const counts = await this.prisma.automationRecommendation.groupBy({
      by: ['status'],
      _count: true,
    });

    const stats = {
      pending: 0,
      executed: 0,
      dismissed: 0,
      snoozed: 0,
      autoResolved: 0,
      expired: 0,
    };

    for (const count of counts) {
      switch (count.status) {
        case 'PENDING': stats.pending = count._count; break;
        case 'EXECUTED': stats.executed = count._count; break;
        case 'DISMISSED': stats.dismissed = count._count; break;
        case 'SNOOZED': stats.snoozed = count._count; break;
        case 'AUTO_RESOLVED': stats.autoResolved = count._count; break;
        case 'EXPIRED': stats.expired = count._count; break;
      }
    }

    return stats;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private parseDuration(duration: SnoozeDuration): number {
    const durations: Record<SnoozeDuration, number> = {
      'PT1H': 1 * 60 * 60 * 1000,
      'PT4H': 4 * 60 * 60 * 1000,
      'PT24H': 24 * 60 * 60 * 1000,
      'P7D': 7 * 24 * 60 * 60 * 1000,
    };
    return durations[duration] ?? durations['PT1H'];
  }
}
