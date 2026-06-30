import { Request, Response, NextFunction } from 'express'

/**
 * Bootstrap auth for the pre-mTLS cluster channel: a shared bearer token
 * (INFINIBAY_CLUSTER_TOKEN) presented on both directions of the master↔agent
 * link (agent→master heartbeat/DB-RPC, and master→agent VM verbs).
 *
 * Fail-closed: if the token is not configured the endpoint refuses ALL requests
 * rather than running open. Phase 2 replaces this with mTLS + the SAS onboarding
 * flow (verified per-node identity).
 */
export function requireClusterToken (req: Request, res: Response, next: NextFunction): void {
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
