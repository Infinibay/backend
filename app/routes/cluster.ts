import express, { Request, Response } from 'express'
import { PrismaAdapter, type InfinizationConfig } from '@infinibay/infinization'
import logger from '@main/logger'
import prisma from '../utils/database'
import { NodeHeartbeatService } from '../services/node/NodeHeartbeatService'
import { DB_FACADE_METHODS } from '../services/node/RpcDatabaseAdapter'
import { requireClusterToken } from '../services/node/clusterAuth'
import { PrismaClient } from '@prisma/client'

const router = express.Router()
const service = new NodeHeartbeatService(prisma as unknown as PrismaClient)

// Allowlist of DB-facade methods a node may invoke over /cluster/db. Anything
// else is rejected — the wire surface is exactly the 16 methods infinization
// needs, nothing more (no arbitrary Prisma access).
const DB_METHOD_ALLOWLIST = new Set<string>(DB_FACADE_METHODS as readonly string[])

// Facade methods whose FIRST argument is a Machine.id (the VM the call targets).
// These are gated by a node-ownership check below: the caller may only touch a
// machine assigned to ITS OWN node. Everything not listed here is either an
// enumeration read already node-scoped inside PrismaAdapter (findRunningVMs,
// findMachinesByStatuses, findMachineByInternalName) and therefore needs no
// arg-level gate.
const MACHINE_ID_KEYED_METHODS = new Set<string>([
  'findMachine',
  'findMachineWithConfig',
  'updateMachineStatus',
  'updateMachineConfiguration',
  'transitionVMStatus',
  'clearMachineConfiguration',
  'clearVolatileMachineConfiguration',
  'getMachineInternalName',
  'getMachineDiskPath',
  'getFirewallRules',
  'getFirewallRulesSplit',
  'getDepartmentFirewallPolicy',
  'getFirewallRuleSetId'
])

/**
 * POST /cluster/heartbeat — a node agent reports it is alive + its capacity.
 * Upserts the Node and stamps lastHeartbeat (drives online/stale in the UI).
 */
router.post('/heartbeat', express.json({ limit: '64kb' }), requireClusterToken, async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {}
    if (typeof body.name !== 'string' || body.name.length === 0 || typeof body.hardware !== 'object' || body.hardware === null) {
      res.status(400).json({ error: 'name (string) and hardware (object) are required' })
      return
    }
    const result = await service.recordHeartbeat(body)
    res.json({ ok: true, nodeId: result.nodeId, created: result.created })
  } catch (error) {
    logger.error('cluster heartbeat failed', error)
    res.status(500).json({ error: 'heartbeat failed' })
  }
})

/**
 * POST /cluster/db — the master side of the node DB facade (Phase 1 increment 3).
 *
 * A node agent's RpcDatabaseAdapter forwards each of the 16 InfinizationDatabase
 * methods here. The master executes the method on a PrismaAdapter SCOPED TO THE
 * CALLING NODE (reusing the G0 node-scoping), so a node can only read/write its
 * own VMs. The method must be in the allowlist (no arbitrary Prisma access).
 *
 * SECURITY (pre-mTLS): with a SHARED cluster token the `nodeName` is
 * agent-asserted, so a token holder could currently claim another node's name.
 * Phase 2 replaces the token with a per-node client certificate and derives the
 * nodeId from the verified cert identity (ADR-CP5), closing this gap.
 */
router.post('/db', express.json({ limit: '256kb' }), requireClusterToken, async (req: Request, res: Response) => {
  try {
    const { nodeName, method, args } = (req.body ?? {}) as { nodeName?: unknown, method?: unknown, args?: unknown }
    if (typeof nodeName !== 'string' || nodeName.length === 0) {
      res.status(400).json({ error: 'nodeName (string) is required' })
      return
    }
    if (typeof method !== 'string' || !DB_METHOD_ALLOWLIST.has(method)) {
      res.status(400).json({ error: `method not allowed: ${String(method)}` })
      return
    }
    const callArgs = Array.isArray(args) ? args : []

    const node = await prisma.node.findFirst({ where: { name: nodeName }, select: { id: true } })
    if (!node) {
      res.status(404).json({ error: `node not registered: ${nodeName}` })
      return
    }

    // Node-ownership enforcement (G0) — the authoritative trust-boundary check.
    // For a machine-id-keyed method, the first argument MUST be a non-empty
    // string AND name a machine assigned to the CALLING node. This closes three
    // holes that the PrismaAdapter's enumeration-only scoping leaves open:
    //   - mass wipe: clearMachineConfiguration([]) would otherwise hit
    //     updateMany({ where: { machineId: undefined } }) → Prisma elides the
    //     undefined filter → every VM's config nulled cluster-wide.
    //   - cross-node write: transitionVMStatus(<other node's vmId>, …) mutates a
    //     VM that lives on another host.
    //   - cross-node read: findMachineWithConfig(<other node's vmId>) discloses
    //     another VM's graphic password / disk paths / firewall rules.
    // (mTLS in Phase 2 only de-spoofs nodeName; it does NOT scope these methods,
    // so this gate is required regardless.)
    if (MACHINE_ID_KEYED_METHODS.has(method)) {
      const vmId = callArgs[0]
      if (typeof vmId !== 'string' || vmId.length === 0) {
        res.status(400).json({ error: `method ${method} requires a machine id as the first argument` })
        return
      }
      const owned = await prisma.machine.findFirst({ where: { id: vmId, nodeId: node.id }, select: { id: true } })
      if (!owned) {
        res.status(403).json({ error: `node ${nodeName} does not own machine ${vmId}` })
        return
      }
    }

    // Node-scoped adapter (G0): every enumeration read is filtered to this node's
    // VMs. The cast bridges the ExtendedPrismaClient/PrismaClientLike structural
    // gap (runtime-compatible; see InfinizationService for the same cast).
    const adapter = new PrismaAdapter(
      prisma as unknown as NonNullable<InfinizationConfig['prismaClient']>,
      node.id
    )
    const fn = (adapter as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]
    const result = await fn.apply(adapter, callArgs)
    res.json({ ok: true, result })
  } catch (error) {
    logger.error('cluster db rpc failed', error)
    res.status(500).json({ error: 'db rpc failed' })
  }
})

export default router
