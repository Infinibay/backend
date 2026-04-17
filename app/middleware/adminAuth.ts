import logger from '@main/logger'
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const debug = logger.child({ module: 'adminAuth' })

interface DecodedToken {
    userId: string;
    userRole: string;
}

export const adminAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization

  if (!token) {
    debug.debug('No token found.')
    return res.status(401).json({ error: 'No token provided' })
  }

  try {
    const decoded = jwt.verify(token, process.env.TOKENKEY || 'secret') as DecodedToken

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
