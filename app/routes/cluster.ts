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
