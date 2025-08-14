import { AuthChecker } from 'type-graphql'
import { User } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { Debugger } from './debug'
import prisma from './database'

const debug = new Debugger('auth')

interface DecodedToken {
  userId: string;
  userRole: string;
}

export const authChecker: AuthChecker<{ req: any; user: User; setupMode: boolean }> = async (
  { context },
  roles
) => {
  // Check if user is already populated in context (from index.ts)
  if (context.user) {
    debug.log('User already in context, checking access...')
    const decoded: DecodedToken = {
      userId: context.user.id,
      userRole: context.user.role
    }
    return checkAccess(decoded, roles, context)
  }

  // Fallback: Try to verify token if user not in context
  const token = context.req.headers.authorization

  if (!token) {
    debug.log('No token found.')
    return false
  }

  try {
    const decoded = jwt.verify(token, process.env.TOKENKEY || 'secret') as DecodedToken

    // If we have a userId but no user in context, try to fetch it
    if (decoded.userId && !context.user) {
      debug.log('Token verified, fetching user...')
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          password: true,
          deleted: true,
          token: true,
          firstName: true,
          lastName: true,
          userImage: true,
          role: true,
          createdAt: true
        }
      })

      if (user) {
        context.user = user
        debug.log('User fetched successfully.')
      }
    }

    return checkAccess(decoded, roles, context)
  } catch (error) {
    debug.log('error', `Error verifying token: ${error}`)
    return false
  }
}

function checkAccess(decoded: DecodedToken, roles: string[], context: { setupMode: boolean }): boolean {
  if (roles.includes('ADMIN')) {
    return checkAdminAccess(decoded)
  }

  if (roles.includes('USER')) {
    return checkUserAccess(decoded)
  }

  if (roles.includes('SETUP_MODE')) {
    return checkSetupModeAccess(context)
  }

  debug.log('No valid role found, access denied.')
  return false
}

function checkAdminAccess(decoded: DecodedToken): boolean {
  if (decoded.userRole === 'ADMIN') {
    debug.log('Access granted for ADMIN.')
    return true
  }
  debug.log('Access denied for ADMIN.')
  return false
}

function checkUserAccess(decoded: DecodedToken): boolean {
  if (decoded.userId) {
    debug.log('Access granted for USER.')
    return true
  }
  debug.log('Access denied for USER.')
  return false
}

function checkSetupModeAccess(context: { setupMode: boolean }): boolean {
  if (context.setupMode) {
    debug.log('Access granted for SETUP_MODE.')
    return true
  }
  debug.log('Access denied for SETUP_MODE.')
  return false
}
