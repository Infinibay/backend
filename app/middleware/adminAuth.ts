import logger from '@main/logger'
import { Request, Response, NextFunction } from 'express'
import { verifyRequestAuth } from '@utils/jwtAuth'

const debug = logger.child({ module: 'adminAuth' })

export const adminAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  // Use the DB-backed shared auth path (same as the GraphQL API) instead of trusting
  // the raw JWT claim. This re-loads the user and enforces user.deleted, current DB role
  // (defeating demotion), tokenInvalidatedAt (defeating logout/revocation) and provider-disabled,
  // so a still-unexpired token minted while the user was admin cannot outlive those changes.
  const { user } = await verifyRequestAuth(req, { method: 'fallback' })

  if (!user) {
    debug.debug('No valid user for token.')
    return res.status(401).json({ error: 'Invalid or revoked token' })
  }

  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    debug.debug('Access denied for non-admin user.')
    return res.status(403).json({ error: 'Unauthorized: Admin access required' })
  }

  debug.debug('Admin access granted.')
  ;(req as any).user = user
  next()
}
