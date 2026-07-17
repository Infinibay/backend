/**
 * GpuBrokerService — the host-side admission "brain" for infinigpu virtual GPUs.
 *
 * WHY: infinigpu lets many VMs share one physical GPU, but only within capacity.
 * Before a GPU VM is allowed to start we must decide, fail-closed, whether the
 * host can admit it: is the department GPU-enabled, is it under its concurrency
 * cap, and is there un-reserved VRAM left? This singleton owns that host-level
 * ledger and maps a `Department`'s 7 policy fields (ADR-0007 §Infinibay mapping)
 * onto a resolved per-VM config the device server is launched with.
 *
 * This is a faithful TypeScript mirror of the Rust `infinigpu-sched` admission
 * (same deny reasons: GpuDisabled / AlreadyAdmitted / ExceedsVmCap /
 * AtConcurrencyCap / InsufficientVram). It does the coarse host-level gate; the
 * per-VM device server's own `GpuBroker` still enforces fine-grained weighted
 * fair-share once running. A single shared host broker (docs/INTEGRATION.md
 * rung 4) is a later step — this service is the seam it will grow into.
 *
 * Fail-closed everywhere: any policy violation throws GpuAdmissionError and the
 * VM is NOT started with a GPU.
 */
import logger from '@main/logger'

const debug = logger.child({ module: 'gpu-broker' })

/** The 7 `Department` Prisma policy fields, extracted (ADR-0007 §Infinibay mapping). */
export interface DepartmentGpuPolicy {
  /** Master switch — no VM in this department gets a GPU unless true. */
  gpuEnabled: boolean
  /** VRAM held back for driver/host, never admitted (BrokerConfig.vram_reserve_mb). */
  vramReserveMB: number
  /** Hard per-VM VRAM ceiling (VmConfig.vram_cap_mb). */
  vramCapMB: number
  /** Priority tier 0=RealTime..3=Batch (VmConfig.priority). */
  priorityTier: number
  /** Hard cap on concurrently-admitted GPU VMs in this department. */
  maxConcurrentGpuVMs: number
  /** GPU-time share weight, ≥1 (VmConfig.weight). */
  gpuTimeWeight: number
  /** Token-bucket burst hint in µs (bucket_burst_us). */
  submissionRateTokens: number
}

/** Extract the policy sub-object from a Prisma Department row (structural). */
export function extractGpuPolicy (dept: DepartmentGpuPolicy): DepartmentGpuPolicy {
  return {
    gpuEnabled: dept.gpuEnabled,
    vramReserveMB: dept.vramReserveMB,
    vramCapMB: dept.vramCapMB,
    priorityTier: dept.priorityTier,
    maxConcurrentGpuVMs: dept.maxConcurrentGpuVMs,
    gpuTimeWeight: dept.gpuTimeWeight,
    submissionRateTokens: dept.submissionRateTokens
  }
}

/** Host-wide broker capacity (env-driven; measured NVML capacity is a later step). */
export interface GpuBrokerConfig {
  /** Total device VRAM in MB available to admit against (per host). */
  totalVramMB: number
  /** VRAM held back for driver/host, never admitted. */
  hostReserveMB: number
  /** Inclusive port range the infiniPixel remote-display streams are allocated from. */
  pixelPortMin: number
  pixelPortMax: number
}

/** The resolved per-VM config an admitted VM's device server is launched with. */
export interface ResolvedVmGpuConfig {
  vmId: string
  /** Effective GPU-time weight (≥1). */
  weight: number
  /** Hard per-VM VRAM ceiling. */
  vramCapMB: number
  /** Priority tier 0..3. */
  priorityTier: number
  /** VRAM reserved in the host ledger for this VM. */
  vramReservedMB: number
  /** Token-bucket burst hint (µs). */
  burstUs: number
  /** Host port this VM's infiniPixel remote-display stream is served on. */
  pixelPort: number
}

export type AdmitDenyReason =
  | { code: 'GpuDisabled' }
  | { code: 'AlreadyAdmitted' }
  | { code: 'ExceedsVmCap', requestedMB: number, capMB: number }
  | { code: 'AtConcurrencyCap', cap: number }
  | { code: 'InsufficientVram', requestedMB: number, availableMB: number }
  | { code: 'NoPixelPort', min: number, max: number }

function formatReason (r: AdmitDenyReason): string {
  switch (r.code) {
    case 'GpuDisabled': return 'GPU is not enabled for this department'
    case 'AlreadyAdmitted': return 'VM is already admitted to the GPU broker'
    case 'ExceedsVmCap': return `requested ${r.requestedMB} MB exceeds the per-VM VRAM cap ${r.capMB} MB`
    case 'AtConcurrencyCap': return `at the department's concurrent-GPU-VM cap (${r.cap})`
    case 'InsufficientVram': return `insufficient VRAM: requested ${r.requestedMB} MB, ${r.availableMB} MB free`
    case 'NoPixelPort': return `no free infiniPixel port in range ${r.min}-${r.max}`
  }
}

/** Thrown (fail-closed) when a VM cannot be admitted for a GPU. */
export class GpuAdmissionError extends Error {
  readonly reason: AdmitDenyReason
  constructor (reason: AdmitDenyReason) {
    super(formatReason(reason))
    this.name = 'GpuAdmissionError'
    this.reason = reason
  }
}

interface AdmittedTicket {
  vmId: string
  departmentId: string
  vramReservedMB: number
  config: ResolvedVmGpuConfig
  admittedAt: number
}

function envInt (name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : fallback
}

export function defaultBrokerConfig (): GpuBrokerConfig {
  return {
    // Default: one RTX A5000 worth of VRAM. Override per host once a shared
    // broker (or NVML probe) provides measured capacity.
    totalVramMB: envInt('INFINIGPU_HOST_VRAM_MB', 24 * 1024),
    hostReserveMB: envInt('INFINIGPU_HOST_VRAM_RESERVE_MB', 1024),
    pixelPortMin: envInt('INFINIGPU_PIXEL_PORT_MIN', 7000),
    pixelPortMax: envInt('INFINIGPU_PIXEL_PORT_MAX', 7099)
  }
}

export class GpuBrokerService {
  private readonly cfg: GpuBrokerConfig
  private readonly tickets = new Map<string, AdmittedTicket>() // key: vmId

  constructor (cfg: Partial<GpuBrokerConfig> = {}) {
    this.cfg = { ...defaultBrokerConfig(), ...cfg }
    if (this.cfg.hostReserveMB > this.cfg.totalVramMB) {
      throw new Error(`GpuBroker: hostReserveMB (${this.cfg.hostReserveMB}) exceeds totalVramMB (${this.cfg.totalVramMB})`)
    }
    if (this.cfg.pixelPortMin > this.cfg.pixelPortMax) {
      throw new Error(`GpuBroker: invalid infiniPixel port range ${this.cfg.pixelPortMin}-${this.cfg.pixelPortMax}`)
    }
  }

  /**
   * Admit `vmId` for a GPU under its department's policy, fail-closed. Returns the
   * resolved per-VM config to launch the device server with, or throws
   * GpuAdmissionError. Idempotency is NOT assumed: admitting an already-admitted
   * vmId is a caller bug and is rejected (mirror of infinigpu-sched AlreadyAdmitted).
   */
  admit (params: { vmId: string, departmentId: string, policy: DepartmentGpuPolicy, requestedVramMB?: number }): ResolvedVmGpuConfig {
    const { vmId, departmentId, policy } = params

    if (!policy.gpuEnabled) throw new GpuAdmissionError({ code: 'GpuDisabled' })
    if (this.tickets.has(vmId)) throw new GpuAdmissionError({ code: 'AlreadyAdmitted' })

    const capMB = policy.vramCapMB
    // Default: reserve the full per-VM cap (conservative / fail-closed). A caller
    // that knows the real working set can request less.
    const requested = params.requestedVramMB ?? capMB
    if (requested > capMB) throw new GpuAdmissionError({ code: 'ExceedsVmCap', requestedMB: requested, capMB })

    const deptCount = this.countByDepartment(departmentId)
    if (deptCount >= policy.maxConcurrentGpuVMs) throw new GpuAdmissionError({ code: 'AtConcurrencyCap', cap: policy.maxConcurrentGpuVMs })

    const available = this.availableVramMB()
    if (requested > available) throw new GpuAdmissionError({ code: 'InsufficientVram', requestedMB: requested, availableMB: available })

    const pixelPort = this.allocatePixelPort()

    const config: ResolvedVmGpuConfig = {
      vmId,
      weight: Math.max(1, policy.gpuTimeWeight),
      vramCapMB: capMB,
      priorityTier: policy.priorityTier,
      vramReservedMB: requested,
      burstUs: Math.max(0, policy.submissionRateTokens),
      pixelPort
    }
    this.tickets.set(vmId, { vmId, departmentId, vramReservedMB: requested, config, admittedAt: Date.now() })
    debug.info(`admitted VM ${vmId} (dept ${departmentId}): ${requested} MB reserved, weight ${config.weight}, pixelPort ${pixelPort}, ${this.availableVramMB()} MB free after`)
    return config
  }

  /** Drop `vmId`'s ticket (frees its VRAM reservation + concurrency slot). Idempotent. */
  release (vmId: string): boolean {
    const had = this.tickets.delete(vmId)
    if (had) debug.info(`released VM ${vmId}; ${this.availableVramMB()} MB free`)
    return had
  }

  isAdmitted (vmId: string): boolean {
    return this.tickets.has(vmId)
  }

  getConfig (vmId: string): ResolvedVmGpuConfig | undefined {
    return this.tickets.get(vmId)?.config
  }

  private countByDepartment (departmentId: string): number {
    let n = 0
    for (const t of this.tickets.values()) if (t.departmentId === departmentId) n++
    return n
  }

  private reservedVramMB (): number {
    let sum = 0
    for (const t of this.tickets.values()) sum += t.vramReservedMB
    return sum
  }

  /** Lowest free infiniPixel port in the configured range, or throw (fail-closed). */
  private allocatePixelPort (): number {
    const inUse = new Set<number>()
    for (const t of this.tickets.values()) inUse.add(t.config.pixelPort)
    for (let p = this.cfg.pixelPortMin; p <= this.cfg.pixelPortMax; p++) {
      if (!inUse.has(p)) return p
    }
    throw new GpuAdmissionError({ code: 'NoPixelPort', min: this.cfg.pixelPortMin, max: this.cfg.pixelPortMax })
  }

  /** Un-reserved, admittable VRAM (never negative). */
  availableVramMB (): number {
    return Math.max(0, this.cfg.totalVramMB - this.cfg.hostReserveMB - this.reservedVramMB())
  }

  /** Host-wide capacity snapshot (ADR-0007 "FleetView"), for telemetry/UI. */
  fleetView (): {
    totalVramMB: number
    hostReserveMB: number
    vramReservedMB: number
    vramAvailableMB: number
    admittedVms: number
    byDepartment: Array<{ departmentId: string, admittedVms: number }>
  } {
    const byDept = new Map<string, number>()
    for (const t of this.tickets.values()) byDept.set(t.departmentId, (byDept.get(t.departmentId) ?? 0) + 1)
    return {
      totalVramMB: this.cfg.totalVramMB,
      hostReserveMB: this.cfg.hostReserveMB,
      vramReservedMB: this.reservedVramMB(),
      vramAvailableMB: this.availableVramMB(),
      admittedVms: this.tickets.size,
      byDepartment: Array.from(byDept.entries()).map(([departmentId, admittedVms]) => ({ departmentId, admittedVms }))
    }
  }

  /** Test-only: clear all tickets. */
  reset (): void {
    this.tickets.clear()
  }
}

let singleton: GpuBrokerService | null = null

export function getGpuBrokerService (): GpuBrokerService {
  if (singleton == null) singleton = new GpuBrokerService()
  return singleton
}
