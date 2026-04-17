import { HealthCheckType } from '@prisma/client'

/**
 * Concurrency limits for health-check execution.
 * All values can be overridden via constructor options for testability.
 */
export interface ConcurrencyLimits {
  maxConcurrentPerVm: number
  maxHeavyChecksPerVm: number
  maxSystemWide: number
  heavyCheckTypes: HealthCheckType[]
}

const DEFAULT_LIMITS: ConcurrencyLimits = {
  maxConcurrentPerVm: 2,
  maxHeavyChecksPerVm: 1,
  maxSystemWide: 50,
  heavyCheckTypes: ['OVERALL_STATUS', 'RESOURCE_OPTIMIZATION', 'WINDOWS_DEFENDER', 'WINDOWS_UPDATES', 'LINUX_UPDATES'],
}

export interface ConcurrencyCheck {
  allowed: boolean
  reason?: string
}

/**
 * Tracks running checks and enforces per-VM, per-type, and system-wide concurrency limits.
 * Stateless w.r.t. the queue; only tracks active (in-flight) task IDs and their check types.
 */
export class HealthCheckConcurrencyManager {
  /** Active task key `${machineId}_${taskId}` → checkType */
  private readonly activeChecks = new Map<string, HealthCheckType>()

  private readonly limits: ConcurrencyLimits

  constructor (overrides?: Partial<ConcurrencyLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...overrides }
  }

  canExecute (machineId: string, checkType: HealthCheckType): ConcurrencyCheck {
    if (this.activeChecks.size >= this.limits.maxSystemWide) {
      return {
        allowed: false,
        reason: `System-wide concurrent limit reached (${this.activeChecks.size}/${this.limits.maxSystemWide})`,
      }
    }

    const vmActive = this.vmActiveKeys(machineId)
    if (vmActive.length >= this.limits.maxConcurrentPerVm) {
      return {
        allowed: false,
        reason: `VM ${machineId} concurrent limit reached (${vmActive.length}/${this.limits.maxConcurrentPerVm})`,
      }
    }

    if (this.isHeavyCheck(checkType)) {
      const vmHeavy = vmActive.filter(key => this.isHeavyCheck(this.activeChecks.get(key)!))
      if (vmHeavy.length >= this.limits.maxHeavyChecksPerVm) {
        return {
          allowed: false,
          reason: `VM ${machineId} heavy-check limit reached (${vmHeavy.length}/${this.limits.maxHeavyChecksPerVm})`,
        }
      }
    }

    return { allowed: true }
  }

  markRunning (taskId: string, machineId: string, checkType: HealthCheckType): void {
    this.activeChecks.set(this.buildKey(machineId, taskId), checkType)
  }

  markDone (taskId: string, machineId: string): void {
    this.activeChecks.delete(this.buildKey(machineId, taskId))
  }

  getActiveCount (): number {
    return this.activeChecks.size
  }

  getVmActiveCount (machineId: string): number {
    return this.vmActiveKeys(machineId).length
  }

  getActiveTaskIds (): string[] {
    return Array.from(this.activeChecks.keys())
  }

  private buildKey (machineId: string, taskId: string): string {
    return `${machineId}_${taskId}`
  }

  private isHeavyCheck (checkType: HealthCheckType): boolean {
    return this.limits.heavyCheckTypes.includes(checkType)
  }

  private vmActiveKeys (machineId: string): string[] {
    const prefix = `${machineId}_`
    return Array.from(this.activeChecks.keys()).filter(key => key.startsWith(prefix))
  }
}
