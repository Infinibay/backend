import logger from '@main/logger'
import { Resolver, Query, Mutation, Arg, Ctx, ID } from 'type-graphql'
import { Can } from '@main/permissions'
import { InfinibayContext } from '../../../utils/context'
import { UserInputError } from '../../../utils/errors'
import { getEventManager } from '../../../services/EventManager'
import { getGpuBrokerService, extractGpuPolicy, GpuAdmissionError } from '../../../services/GpuBrokerService'
import { getGpuConsoleRelay } from '../../../services/console/GpuConsoleRelay'
import { getInfinization } from '../../../services/InfinizationService'
import { resolveConnectHost, hostFromHeader } from '@utils/resolveConnectHost'
import {
  DepartmentGpuPolicyType,
  UpdateDepartmentGpuPolicyInput,
  GpuAttachResultType,
  GpuConsoleStreamType,
  GpuFleetViewType
} from './type'

// The 7 GPU columns live on the Department row. We read them through this shape
// rather than the generated Prisma type because the generated client may lag the
// schema (the dev container regenerates on restart); `as unknown as` keeps the
// resolver compiling against either an old or a freshly-generated client.
type DepartmentGpuRow = {
  id: string
  gpuEnabled: boolean
  vramReserveMB: number
  vramCapMB: number
  priorityTier: number
  maxConcurrentGpuVMs: number
  gpuTimeWeight: number
  submissionRateTokens: number
}

function toPolicyType (d: DepartmentGpuRow): DepartmentGpuPolicyType {
  return {
    departmentId: d.id,
    gpuEnabled: d.gpuEnabled,
    vramReserveMB: d.vramReserveMB,
    vramCapMB: d.vramCapMB,
    priorityTier: d.priorityTier,
    maxConcurrentGpuVMs: d.maxConcurrentGpuVMs,
    gpuTimeWeight: d.gpuTimeWeight,
    submissionRateTokens: d.submissionRateTokens
  }
}

/**
 * GraphQL surface for infinigpu (docs/INTEGRATION.md §3/§5). All GPU policy and
 * admission is here rather than bolted onto DepartmentType, so it is a
 * self-contained, opt-in feature. Reads/writes are RBAC-gated with the existing
 * department/vm verbs (no new permission needs seeding).
 */
@Resolver()
export class GpuResolver {
  /** A department's GPU policy (the 7 fields). Null if the department is missing. */
  @Query(() => DepartmentGpuPolicyType, { nullable: true })
  @Can('department:view', { id: (a) => a.departmentId })
  async departmentGpuPolicy (
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentGpuPolicyType | null> {
    const d = await prisma.department.findUnique({ where: { id: departmentId } })
    if (!d) return null
    return toPolicyType(d as unknown as DepartmentGpuRow)
  }

  /** Update a department's GPU policy (partial). Validated + fail-closed defaults. */
  @Mutation(() => DepartmentGpuPolicyType)
  @Can('department:edit', { id: (a) => a.input.departmentId })
  async updateDepartmentGpuPolicy (
    @Arg('input') input: UpdateDepartmentGpuPolicyInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DepartmentGpuPolicyType> {
    const existing = await prisma.department.findUnique({ where: { id: input.departmentId } })
    if (!existing) throw new UserInputError('Department not found')

    const data: Record<string, number | boolean> = {}
    if (input.gpuEnabled !== undefined) data.gpuEnabled = input.gpuEnabled
    if (input.vramReserveMB !== undefined) data.vramReserveMB = requireNonNegInt('vramReserveMB', input.vramReserveMB)
    if (input.vramCapMB !== undefined) data.vramCapMB = requirePosInt('vramCapMB', input.vramCapMB)
    if (input.priorityTier !== undefined) data.priorityTier = requireRange('priorityTier', input.priorityTier, 0, 3)
    if (input.maxConcurrentGpuVMs !== undefined) data.maxConcurrentGpuVMs = requireNonNegInt('maxConcurrentGpuVMs', input.maxConcurrentGpuVMs)
    if (input.gpuTimeWeight !== undefined) data.gpuTimeWeight = requireRange('gpuTimeWeight', input.gpuTimeWeight, 1, 1_000_000)
    if (input.submissionRateTokens !== undefined) data.submissionRateTokens = requireNonNegInt('submissionRateTokens', input.submissionRateTokens)

    if (Object.keys(data).length === 0) {
      throw new UserInputError('No GPU policy fields provided to update')
    }

    const updated = await prisma.department.update({ where: { id: input.departmentId }, data })

    try {
      await getEventManager().dispatchEvent('departments', 'update', { id: updated.id }, user?.id)
    } catch (eventError) {
      logger.error('Failed to dispatch departments:update for GPU policy change:', eventError)
    }

    return toPolicyType(updated as unknown as DepartmentGpuRow)
  }

  /**
   * Admit a machine for a virtual GPU under its department's policy (fail-closed).
   * This is the host-level gate; the device server is what actually attaches the
   * device on VM start (rung 2). Exposed as a mutation for manual/testing use and
   * to surface the admission decision to the UI.
   */
  @Mutation(() => GpuAttachResultType)
  @Can('vm:edit', { id: (a) => a.machineId, scopeVia: 'vm' })
  async attachGpu (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<GpuAttachResultType> {
    const machine = await prisma.machine.findUnique({ where: { id: machineId } })
    if (!machine) throw new UserInputError('Machine not found')
    if (!machine.departmentId) throw new UserInputError('Machine has no department; cannot resolve GPU policy')

    const dept = await prisma.department.findUnique({ where: { id: machine.departmentId } })
    if (!dept) throw new UserInputError('Department not found')

    const policy = extractGpuPolicy(dept as unknown as DepartmentGpuRow)
    try {
      const cfg = getGpuBrokerService().admit({ vmId: machineId, departmentId: dept.id, policy })
      return {
        vmId: machineId,
        admitted: true,
        weight: cfg.weight,
        vramCapMB: cfg.vramCapMB,
        vramReservedMB: cfg.vramReservedMB,
        priorityTier: cfg.priorityTier
      }
    } catch (err) {
      if (err instanceof GpuAdmissionError) throw new UserInputError(`GPU attach denied: ${err.message}`)
      throw err
    }
  }

  /** Release a machine's GPU admission ticket (frees VRAM + concurrency slot). Idempotent. */
  @Mutation(() => Boolean)
  @Can('vm:edit', { id: (a) => a.machineId, scopeVia: 'vm' })
  async detachGpu (
    @Arg('machineId', () => ID) machineId: string
  ): Promise<boolean> {
    return getGpuBrokerService().release(machineId)
  }

  /** Host-wide GPU capacity snapshot (telemetry for the FleetView UI). */
  @Query(() => GpuFleetViewType)
  @Can('vmHealth:view', { minScope: 'ANY' })
  async gpuFleetView (): Promise<GpuFleetViewType> {
    return getGpuBrokerService().fleetView()
  }

  /**
   * How to reach a GPU VM's infiniPixel remote-display stream. Returns null when
   * the VM has no live GPU session (not admitted / not running with a GPU). The
   * `url` is a client-reachable WebSocket on the master relay — point the native
   * infinigpu viewer (or the browser WebCodecs client) at it.
   */
  @Query(() => GpuConsoleStreamType, { nullable: true })
  @Can('vm:console', { id: (a) => a.machineId })
  async gpuConsoleStream (
    @Arg('machineId', () => ID) machineId: string,
    @Ctx() { req }: InfinibayContext
  ): Promise<GpuConsoleStreamType | null> {
    const cfg = getGpuBrokerService().getConfig(machineId)
    if (!cfg) return null
    // Client always dials the master relay; the device server's WS is loopback-only
    // inside the backend host and is resolved server-side (never from client input).
    const ingressHost = resolveConnectHost({
      envHost: process.env.GRAPHIC_HOST,
      requestHost: hostFromHeader(req?.headers['x-forwarded-host'] ?? req?.headers.host)
    })
    // WS-aware relay: forwards the device's frames out AND injects the viewer's mouse/key
    // input back into the guest over QMP (a GPU VM has no other input path).
    const session = await getGpuConsoleRelay().ensureSession(machineId, '127.0.0.1', cfg.pixelPort)
    return { url: `ws://${ingressHost}:${session.listenPort}`, pixelPort: cfg.pixelPort }
  }

  /**
   * Inject guest input (mouse/keyboard) into a GPU VM via the master's existing QMP
   * connection — QEMU `input-send-event`. The GPU VM has no SPICE/VNC input path, so
   * the infiniPixel viewer forwards its winit events here (relayed low-latency over the
   * console WebSocket in the common case; this mutation is the direct primitive).
   * `eventsJson` is a JSON array of QMP input events, e.g.
   *   [{"type":"abs","data":{"axis":"x","value":16384}},
   *    {"type":"abs","data":{"axis":"y","value":16384}}]
   *   [{"type":"key","data":{"down":true,"key":{"type":"qcode","data":"a"}}}]
   */
  @Mutation(() => Boolean)
  @Can('vm:console', { id: (a) => a.machineId })
  async sendGpuConsoleInput (
    @Arg('machineId', () => ID) machineId: string,
    @Arg('eventsJson') eventsJson: string
  ): Promise<boolean> {
    let events: unknown
    try {
      events = JSON.parse(eventsJson)
    } catch {
      throw new UserInputError('eventsJson must be valid JSON')
    }
    if (!Array.isArray(events) || events.length === 0) {
      throw new UserInputError('eventsJson must be a non-empty JSON array of QMP input events')
    }
    const infinization = await getInfinization()
    const qmp = infinization.getQMPClient(machineId)
    if (!qmp) return false
    await qmp.execute('input-send-event', { events })
    return true
  }
}

function requireNonNegInt (field: string, v: number): number {
  if (!Number.isInteger(v) || v < 0) throw new UserInputError(`${field} must be a non-negative integer`)
  return v
}

function requirePosInt (field: string, v: number): number {
  if (!Number.isInteger(v) || v <= 0) throw new UserInputError(`${field} must be a positive integer`)
  return v
}

function requireRange (field: string, v: number, min: number, max: number): number {
  if (!Number.isInteger(v) || v < min || v > max) throw new UserInputError(`${field} must be an integer in [${min}, ${max}]`)
  return v
}
