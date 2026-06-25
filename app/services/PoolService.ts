/**
 * PoolService — lifecycle of VDI desktop pools.
 *
 * A pool groups N desktops backed by a single blueprint + golden image.
 * This service owns provisioning (spawn linked clones up to sizeMin),
 * scaling (reach an operator-set target), draining (freeze new
 * connections), and deletion (archive every member then drop the row).
 *
 * Provisioning reuses the existing MachineLifecycleService pipeline —
 * pool machines are normal Machine rows with `poolId` set. Because the
 * blueprint carries a goldenImageId, CreateMachineServiceV2 takes the
 * fast-path linked-clone route (5.A): no unattended ISO, thin qcow2
 * clone of the sealed base, boot-time <30s.
 *
 * Refill is exposed as `runRefillTick()` — invoke it from a cron/queue
 * at your desired cadence (typ. every minute). We deliberately don't
 * ship a setInterval singleton here; the caller composes scheduling.
 */

import { Logger } from 'winston'
import { PrismaClient, Pool, Machine, Prisma } from '@prisma/client'
import logger from '@main/logger'
import { SafeUser } from '../utils/context'
import { MachineLifecycleService } from './machineLifecycleService'
import { MachineCleanupServiceV2 } from './cleanup/machineCleanupServiceV2'
import { VMOperationsService } from './VMOperationsService'
import { getEventManager, type EventAction } from './EventManager'
import { OsEnum } from '../graphql/resolvers/machine/type'

export interface CreatePoolInput {
  name: string
  templateId: string
  goldenImageId?: string | null
  departmentId: string
  type?: 'persistent' | 'non-persistent'
  sizeMin?: number
  sizeMax?: number
  idleTimeoutMinutes?: number | null
  resetOnLogoff?: boolean
}

export interface UpdatePoolInput {
  name?: string
  sizeMin?: number
  sizeMax?: number
  idleTimeoutMinutes?: number | null
  resetOnLogoff?: boolean
  draining?: boolean
}

export class PoolService {
  private prisma: PrismaClient
  private user: SafeUser | null
  private debug: Logger

  constructor (prisma: PrismaClient, user: SafeUser | null = null) {
    this.prisma = prisma
    this.user = user
    this.debug = logger.child({ module: 'pool-service' })
  }

  // -------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------

  async list (): Promise<Array<Pool & { currentSize: number }>> {
    const pools = await this.prisma.pool.findMany({
      orderBy: [{ departmentId: 'asc' }, { name: 'asc' }]
    })
    return await Promise.all(
      pools.map(async (pool) => ({
        ...pool,
        currentSize: await this.prisma.machine.count({
          where: { poolId: pool.id, status: { not: 'archived' } }
        })
      }))
    )
  }

  async byId (id: string): Promise<(Pool & { currentSize: number }) | null> {
    const pool = await this.prisma.pool.findUnique({ where: { id } })
    if (!pool) return null
    const currentSize = await this.prisma.machine.count({
      where: { poolId: pool.id, status: { not: 'archived' } }
    })
    return { ...pool, currentSize }
  }

  // -------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------

  async create (input: CreatePoolInput): Promise<Pool> {
    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: input.templateId }
    })
    if (!template) throw new Error(`Template not found: ${input.templateId}`)

    // If no explicit goldenImageId, inherit the template's — that's the
    // usual path and what makes the fast-path linked clone possible.
    const goldenImageId =
      input.goldenImageId ?? template.goldenImageId ?? null
    if (!goldenImageId) {
      throw new Error(
        'Pool requires a goldenImageId either on the input or on the blueprint. ' +
        'Pools without a sealed base would pay the full install cost per VM.'
      )
    }

    const image = await this.prisma.goldenImage.findUnique({
      where: { id: goldenImageId }
    })
    if (!image) throw new Error(`Golden image not found: ${goldenImageId}`)

    const sizeMin = input.sizeMin ?? 0
    const sizeMax = input.sizeMax ?? 10
    if (sizeMin > sizeMax) {
      throw new Error('sizeMin cannot exceed sizeMax')
    }

    const pool = await this.prisma.pool.create({
      data: {
        name: input.name,
        templateId: template.id,
        goldenImageId,
        departmentId: input.departmentId,
        type: input.type ?? 'non-persistent',
        sizeMin,
        sizeMax,
        idleTimeoutMinutes: input.idleTimeoutMinutes ?? null,
        resetOnLogoff: input.resetOnLogoff ?? true
      }
    })

    // Kick off the initial fill. Errors here are surfaced by the refill
    // job later — we don't want to block the mutation on slow QEMU spawns.
    void this.runRefillForPool(pool.id).catch((err) => {
      this.debug.error(`initial refill for pool=${pool.id} failed: ${err?.message}`)
    })

    this.emit('create', pool)
    return pool
  }

  // -------------------------------------------------------------------
  // Scale / drain / update
  // -------------------------------------------------------------------

  async scale (id: string, targetSize: number): Promise<Pool> {
    const pool = await this.prisma.pool.findUnique({ where: { id } })
    if (!pool) throw new Error(`Pool not found: ${id}`)
    if (targetSize < 0) throw new Error('targetSize cannot be negative')
    if (targetSize > pool.sizeMax) {
      throw new Error(`targetSize ${targetSize} exceeds pool.sizeMax ${pool.sizeMax}`)
    }

    const current = await this.prisma.machine.count({
      where: { poolId: pool.id, status: { not: 'archived' } }
    })

    if (targetSize > current) {
      const toAdd = targetSize - current
      this.debug.info(`pool=${pool.id} scale up: +${toAdd} (current=${current} target=${targetSize})`)
      for (let i = 0; i < toAdd; i++) {
        await this.provisionOne(pool)
      }
    } else if (targetSize < current) {
      const toRemove = current - targetSize
      this.debug.info(`pool=${pool.id} scale down: -${toRemove} (current=${current} target=${targetSize})`)
      const victims = await this.prisma.machine.findMany({
        where: {
          poolId: pool.id,
          status: { notIn: ['archived', 'running'] }
        },
        orderBy: { createdAt: 'desc' },
        take: toRemove
      })
      // Fallback to running machines if off/stopped pool is empty — scale
      // down must succeed even if it means taking a running one down.
      const ids = victims.map((v) => v.id)
      if (ids.length < toRemove) {
        const extra = await this.prisma.machine.findMany({
          where: {
            poolId: pool.id,
            status: 'running',
            id: { notIn: ids }
          },
          orderBy: { createdAt: 'desc' },
          take: toRemove - ids.length
        })
        ids.push(...extra.map((v) => v.id))
      }
      for (const mid of ids) {
        await this.archiveMachine(mid)
      }
    }

    this.emit('scale', pool, { targetSize })
    return pool
  }

  async update (id: string, input: UpdatePoolInput): Promise<Pool> {
    const pool = await this.prisma.pool.update({
      where: { id },
      data: {
        name: input.name,
        sizeMin: input.sizeMin,
        sizeMax: input.sizeMax,
        idleTimeoutMinutes: input.idleTimeoutMinutes,
        resetOnLogoff: input.resetOnLogoff,
        draining: input.draining
      }
    })
    this.emit('update', pool)
    return pool
  }

  async drain (id: string): Promise<Pool> {
    return await this.update(id, { draining: true })
  }

  async undrain (id: string): Promise<Pool> {
    return await this.update(id, { draining: false })
  }

  async delete (id: string): Promise<boolean> {
    // Stop refill (filters draining:false) and checkout (throws on draining) from
    // racing the teardown before we archive the members below.
    await this.prisma.pool.update({ where: { id }, data: { draining: true } }).catch(() => {})
    const machines = await this.prisma.machine.findMany({
      where: { poolId: id, status: { not: 'archived' } }
    })
    for (const m of machines) {
      await this.archiveMachine(m.id)
    }
    await this.prisma.pool.delete({ where: { id } })
    const em = getEventManager()
    await em.dispatchEvent?.('pools', 'delete', { id })
    return true
  }

  // -------------------------------------------------------------------
  // Refill job — caller composes scheduling
  // -------------------------------------------------------------------

  /**
   * Iterate every non-draining pool and ensure `current >= sizeMin`.
   * Caps per-pool spawns per tick so a single cron tick can't thunder-
   * herd infinization with dozens of QEMU boots.
   */
  async runRefillTick (opts: { maxPerPoolPerTick?: number } = {}): Promise<void> {
    const cap = opts.maxPerPoolPerTick ?? 3
    const pools = await this.prisma.pool.findMany({ where: { draining: false } })
    for (const pool of pools) {
      try {
        const current = await this.prisma.machine.count({
          where: { poolId: pool.id, status: { not: 'archived' } }
        })
        if (current >= pool.sizeMin) continue
        // Never exceed sizeMax, even if sizeMin was misconfigured > sizeMax or an
        // in-flight checkout already spawned a desktop on-demand.
        const ceiling = Math.max(0, pool.sizeMax - current)
        const toAdd = Math.min(pool.sizeMin - current, cap, ceiling)
        if (toAdd <= 0) continue
        for (let i = 0; i < toAdd; i++) {
          await this.provisionOne(pool)
        }
      } catch (err) {
        this.debug.warn(`refill tick for pool=${pool.id} failed: ${(err as Error).message}`)
      }
    }
  }

  async runRefillForPool (poolId: string): Promise<void> {
    const pool = await this.prisma.pool.findUnique({ where: { id: poolId } })
    if (!pool || pool.draining) return
    const current = await this.prisma.machine.count({
      where: { poolId: pool.id, status: { not: 'archived' } }
    })
    const toAdd = Math.max(0, Math.min(pool.sizeMin, pool.sizeMax) - current)
    for (let i = 0; i < toAdd; i++) {
      await this.provisionOne(pool)
    }
  }

  // -------------------------------------------------------------------
  // Connection routing (stub for 6.F; placed here so tests can exercise)
  // -------------------------------------------------------------------

  /**
   * Check out a desktop for the user and ensure it is powered on. For
   * persistent pools: the user's assigned machine if any, else a freshly
   * claimed idle one. For non-persistent: any idle machine. Spawns on-demand
   * up to sizeMax when nothing idle is available.
   */
  async checkOutDesktopForUser (poolId: string, userId: string): Promise<Machine> {
    const pool = await this.prisma.pool.findUnique({ where: { id: poolId } })
    if (!pool) throw new Error(`Pool not found: ${poolId}`)
    if (pool.draining) throw new Error('Pool is draining — no new connections')

    const { machine, outcome } = await this.acquireDesktop(pool, userId)
    return await this.ensureBooted(machine, outcome)
  }

  /**
   * Resolve a desktop for the user WITHOUT booting it. Returns the machine and
   * how it was obtained so the caller knows whether it still needs powering on
   * and whether a freshly-taken reservation must be released on failure.
   *
   * Claims an idle desktop atomically: findFirst + hand-out is a read-modify-
   * write, so two users racing for the same idle machine could both get it.
   * The bounded retry picks a candidate and claims it with a conditional
   * updateMany that only lands if the row is STILL idle (and, for persistent
   * pools, still unassigned). Winner gets count 1; the loser gets count 0 and
   * retries a different candidate. Flipping to 'starting' removes the machine
   * from the idle set so it can't be double-handed-out.
   */
  private async acquireDesktop (
    pool: Pool,
    userId: string
  ): Promise<{ machine: Machine, outcome: 'assigned' | 'claimed' | 'spawned' }> {
    const idleWhere: Prisma.MachineWhereInput = {
      poolId: pool.id,
      status: { in: ['off', 'stopped', 'paused'] },
      ...(pool.type === 'persistent' ? { userId: null } : {})
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      // Re-check inside the loop: a concurrent checkout for THIS user on a
      // persistent pool may have just assigned them one.
      if (pool.type === 'persistent') {
        const assigned = await this.prisma.machine.findFirst({
          where: { poolId: pool.id, userId, status: { not: 'archived' } }
        })
        if (assigned) return { machine: assigned, outcome: 'assigned' }
      }

      const candidate = await this.prisma.machine.findFirst({
        where: idleWhere,
        orderBy: { createdAt: 'asc' }
      })
      if (!candidate) break // nothing idle → fall through to on-demand spawn

      const claim = await this.prisma.machine.updateMany({
        where: { id: candidate.id, ...idleWhere },
        data: {
          status: 'starting',
          ...(pool.type === 'persistent' ? { userId } : {})
        }
      })
      if (claim.count === 1) {
        const machine = await this.prisma.machine.findUnique({ where: { id: candidate.id } })
        if (machine) return { machine, outcome: 'claimed' }
      }
      // Lost to a concurrent checkout — loop and try another candidate.
    }

    // Spawn on-demand. The plain count->provision has a TOCTOU gap: N concurrent
    // checkouts can each pass the pre-check and overshoot sizeMax. We keep the
    // cheap pre-check for the common fast-reject, then re-check AFTER creating and
    // compensate (archive our just-created machine) if a concurrent spawn pushed
    // us over capacity — bounding overshoot to a single transient extra.
    const before = await this.prisma.machine.count({
      where: { poolId: pool.id, status: { not: 'archived' } }
    })
    if (before >= pool.sizeMax) {
      throw new Error('Pool at capacity — try again later or ask the operator to scale up')
    }
    const machine = await this.provisionOne(pool, pool.type === 'persistent' ? userId : undefined)
    const after = await this.prisma.machine.count({
      where: { poolId: pool.id, status: { not: 'archived' } }
    })
    if (after > pool.sizeMax) {
      await this.archiveMachine(machine.id).catch((err) =>
        this.debug.warn(`failed to roll back overshoot machine=${machine.id}: ${(err as Error).message}`)
      )
      throw new Error('Pool at capacity — try again later or ask the operator to scale up')
    }
    return { machine, outcome: 'spawned' }
  }

  /**
   * Power on the checked-out desktop so the user gets a running machine —
   * completing the reservation taken in acquireDesktop. Skips machines that are
   * already running (persistent reconnect) or were just spawned (the create
   * pipeline launches QEMU itself). If the boot fails and we had freshly
   * claimed an idle desktop, release it back to 'off' so it rejoins the pool
   * instead of leaking in 'starting'.
   */
  private async ensureBooted (
    machine: Machine,
    outcome: 'assigned' | 'claimed' | 'spawned'
  ): Promise<Machine> {
    if (outcome === 'spawned') return machine
    if (machine.status === 'running') return machine

    // A crash between the acquireDesktop claim ('starting') and a successful start
    // strands the desktop in 'starting'. That is recovered at the next boot by
    // reconcilePoolStatusesOnStartup (stale 'starting' past STARTING_TTL -> 'off').
    const result = await new VMOperationsService(this.prisma).startMachine(machine.id)
    if (!result.success) {
      if (outcome === 'claimed') {
        await this.prisma.machine
          .update({ where: { id: machine.id }, data: { status: 'off' } })
          .catch((err) => {
            this.debug.warn(`failed to release machine=${machine.id} after boot failure: ${(err as Error).message}`)
          })
      }
      throw new Error(`Failed to start pooled desktop ${machine.id}: ${result.error ?? 'unknown error'}`)
    }
    // The successful start emits its own vms:power_on event via infinization's
    // QMP handler, so there's nothing to broadcast here.
    return machine
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private async provisionOne (pool: Pool, assignedUserId?: string): Promise<Machine> {
    const seq = await this.nextSeqFor(pool)
    const name = `${pool.name}-${String(seq).padStart(3, '0')}`

    const template = await this.prisma.machineTemplate.findUnique({
      where: { id: pool.templateId }
    })
    if (!template) throw new Error(`Pool ${pool.id} references missing template`)

    const lifecycleService = new MachineLifecycleService(this.prisma, this.user)

    // Linked-clone fast path: the golden image has the OS + apps baked.
    // username/password are unused by CreateMachineServiceV2 when
    // `template.goldenImageId` is set (see 5.A). We pass placeholders.
    const machine = await lifecycleService.createMachine({
      name,
      templateId: pool.templateId,
      departmentId: pool.departmentId,
      os: inferOsEnumFromTemplate(template) ?? OsEnum.UBUNTU,
      username: 'infinibay',
      password: generatePlaceholderPassword(),
      applications: [],
      firstBootScripts: [],
      customCores: null,
      customRam: null,
      customStorage: null,
      productKey: undefined,
      pciBus: null,
      locale: null,
      keyboard: null,
      timezone: null
    } as any)

    // Bind the new Machine to the pool + optional user.
    await this.prisma.machine.update({
      where: { id: machine.id },
      data: {
        poolId: pool.id,
        userId: assignedUserId ?? machine.userId ?? null
      }
    })

    this.emit('machine_provisioned', pool, { machineId: machine.id })
    return machine
  }

  private async nextSeqFor (pool: Pool): Promise<number> {
    // Sequential numbering by creation order. Race-tolerant enough
    // because name collisions just produce a suffix-like duplicate,
    // which Prisma will reject (no unique constraint on Machine.name
    // today — worst case two VMs share a name, cosmetic not blocking).
    return await this.prisma.machine.count({ where: { poolId: pool.id } }) + 1
  }

  private async archiveMachine (machineId: string): Promise<void> {
    try {
      const cleanup = new MachineCleanupServiceV2(this.prisma)
      await cleanup.cleanupVM(machineId)
    } catch (err) {
      this.debug.warn(`archive machine=${machineId} cleanup failed: ${(err as Error).message}`)
      // Fall back to a marker so the row doesn't keep the pool's
      // accounting inflated.
      try {
        await this.prisma.machine.update({
          where: { id: machineId },
          data: { status: 'archived', poolId: null }
        })
      } catch { /* best effort */ }
    }
  }

  private emit (action: string, pool: Pool, extra?: Record<string, unknown>): void {
    const em = getEventManager()
    // EventAction is a closed string union; pool-specific verbs (scale,
    // machine_provisioned) map to the generic 'update' so we stay
    // type-safe while still carrying intent in the payload.
    const mapped: EventAction =
      action === 'create' || action === 'update' || action === 'delete'
        ? action
        : 'update'
    void em.dispatchEvent?.('pools', mapped, { ...pool, detail: action, ...extra })
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function generatePlaceholderPassword (): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 16; i++) out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}

function inferOsEnumFromTemplate (t: { name: string | null; description: string | null }): OsEnum | null {
  const s = `${t.name ?? ''} ${t.description ?? ''}`.toLowerCase()
  if (s.includes('windows 11') || s.includes('windows11') || s.includes('win11')) return OsEnum.WINDOWS11
  if (s.includes('windows 10') || s.includes('windows10') || s.includes('win10')) return OsEnum.WINDOWS10
  if (s.includes('ubuntu')) return OsEnum.UBUNTU
  if (s.includes('fedora')) return OsEnum.FEDORA
  return null
}
