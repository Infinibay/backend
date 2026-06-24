import logger from '@main/logger'
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getJWTSecret } from '@utils/jwtAuth'

const debug = logger.child({ module: 'adminAuth' })

interface DecodedToken {
    userId: string;
    userRole: string;
}

export const adminAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const raw = req.headers.authorization || ''
  const m = raw.match(/^\s*Bearer\s+(.+)$/i)
  const token = (m ? m[1] : raw).trim()

  if (!token) {
    debug.debug('No token found.')
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, getJWTSecret()) as DecodedToken

    if (decoded.userRole !== 'ADMIN' && decoded.userRole !== 'SUPER_ADMIN') {
      debug.debug('Access denied for non-admin user.')
      return res.status(403).json({ error: 'Unauthorized: Admin access required' })
    }

    debug.debug('Admin access granted.')
    next()
  } catch (error) {
    debug.error(`Error verifying token: ${error}`)
    return res.status(401).json({ error: 'Invalid token' })
  }
}
