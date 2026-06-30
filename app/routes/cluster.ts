import express, { Request, Response, NextFunction } from 'express'
import logger from '@main/logger'
import prisma from '../utils/database'
import { NodeHeartbeatService } from '../services/node/NodeHeartbeatService'
import { PrismaClient } from '@prisma/client'

const router = express.Router()
const service = new NodeHeartbeatService(prisma as unknown as PrismaClient)

/**
 * Bootstrap auth for the pre-mTLS cluster channel: a shared bearer token
 * (INFINIBAY_CLUSTER_TOKEN) every node agent presents. Fail-closed: if the token
 * is not configured the endpoint refuses all requests rather than running open.
 * Phase 2 replaces this with mTLS + the SAS onboarding flow.
 */
function requireClusterToken (req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INFINIBAY_CLUSTER_TOKEN
  if (!expected) {
    res.status(503).json({ error: 'cluster token not configured (set INFINIBAY_CLUSTER_TOKEN)' })
    return
  }
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (token.length === 0 || token !== expected) {
    res.status(401).json({ error: 'invalid cluster token' })
    return
  }
  next()
}

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

export default router
