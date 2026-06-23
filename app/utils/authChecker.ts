import logger from '@main/logger'
import { AuthChecker } from 'type-graphql'
import { InfinibayContext, createUserValidationHelpers } from './context'
import { verifyRequestAuth, DecodedToken } from './jwtAuth'
import { Request } from 'express'

const debug = logger.child({ module: 'auth' })

export const authChecker: AuthChecker<InfinibayContext> = async (
  resolverData,
  roles
) => {
  // Handle both test and production contexts
  const context = resolverData && typeof resolverData === 'object' && 'context' in resolverData
    ? (resolverData as { context: InfinibayContext }).context
    : resolverData as InfinibayContext
  const debugAuth = process.env.DEBUG_AUTH === '1' || process.env.NODE_ENV !== 'production'

  // Check if user is already populated in context (from index.ts)
  if (context.user) {
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - User already in context')
      logger.info('🔐 AuthChecker Debug - Context user details:', {
        userId: '[REDACTED]',
        userRole: context.user.role,
        userEmail: context.user.email,
        userDeleted: context.user.deleted
      })
    }
    debug.debug('User already in context, checking access...')
    const decoded: DecodedToken = {
      userId: context.user.id,
      userRole: context.user.role
    }
    const accessResult = checkAccess(decoded, roles, context, debugAuth)
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - Access check result for existing user:', accessResult)
    }
    return accessResult
  }

  // Fallback: Try to verify token if user not in context
  if (debugAuth) {
    logger.info('🔐 AuthChecker Debug - No user in context, trying fallback token verification')
  }

  try {
    // Use shared JWT verification utility
    const authResult = await verifyRequestAuth(context.req as Request, {
      method: 'fallback',
      debugAuth
    })

    if (!authResult.user || !authResult.decoded) {
      if (debugAuth) {
        logger.info('🔐 AuthChecker Debug - Fallback authentication failed')
      }
      debug.debug('Fallback authentication failed.')
      return false
    }

    // Update context with authenticated user and metadata
    context.user = authResult.user
    if (!context.auth) {
      context.auth = authResult.meta
    }
    if (!context.userHelpers) {
      context.userHelpers = createUserValidationHelpers(authResult.user, authResult.meta)
    }

    debug.debug('Fallback authentication successful.')

    const accessResult = checkAccess(authResult.decoded, roles, context, debugAuth)
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - Final fallback access result:', accessResult)
    }
    return accessResult
  } catch (error) {
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - Fallback authentication error:', error instanceof Error ? error.message : String(error))
    }
    debug.error(`Fallback authentication error: ${error}`)
    return false
  }
}

function checkAccess (decoded: DecodedToken, roles: string[], context: InfinibayContext, debugAuth?: boolean): boolean {
  if (debugAuth) {
    logger.info('🔐 AuthChecker Debug - checkAccess called with:', {
      decodedUserId: '[REDACTED]',
      decodedUserRole: decoded.userRole,
      requiredRoles: roles,
      setupMode: context.setupMode,
      hasContextUser: !!context.user,
      contextUserRole: context.user?.role
    })
  }

  // Additional validation: ensure decoded token properties match context user when available
  if (context.user) {
    if (decoded.userId !== context.user.id) {
      if (debugAuth) {
        logger.info('🔐 AuthChecker Debug - Token userId does not match context user ID')
      }
      logger.warn('⚠️ JWT Security Warning - Token userId does not match context user:', {
        tokenUserId: '[REDACTED]',
        contextUserId: '[REDACTED]'
      })
      return false
    }

    const roleField = decoded.userRole || decoded.role
    if (roleField !== context.user.role) {
      if (debugAuth) {
        logger.info('🔐 AuthChecker Debug - Token role does not match context user role')
      }
      logger.warn('⚠️ JWT Security Warning - Token role does not match context user role:', {
        tokenRole: '[REDACTED]',
        contextUserRole: '[REDACTED]'
      })
      return false
    }
  }

  if (roles.includes('ADMIN')) {
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - Checking ADMIN access')
    }
    const adminResult = checkAdminAccess(decoded)
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - ADMIN access result:', adminResult)
    }
    return adminResult
  }

  if (roles.includes('USER')) {
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - Checking USER access')
    }
    const userResult = checkUserAccess(decoded)
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - USER access result:', userResult)
    }
    return userResult
  }

  if (roles.includes('SETUP_MODE')) {
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - Checking SETUP_MODE access')
    }
    const setupResult = checkSetupModeAccess(context)
    if (debugAuth) {
      logger.info('🔐 AuthChecker Debug - SETUP_MODE access result:', setupResult)
    }
    return setupResult
  }

  if (debugAuth) {
    logger.info('🔐 AuthChecker Debug - No valid role found, access denied')
  }
  debug.debug('No valid role found, access denied.')
  return false
}

function checkAdminAccess (decoded: DecodedToken): boolean {
  const roleField = decoded.userRole || decoded.role
  if (roleField === 'ADMIN' || roleField === 'SUPER_ADMIN') {
    debug.debug('Access granted for ADMIN/SUPER_ADMIN.')
    return true
  }
  debug.debug('Access denied for ADMIN.')
  return false
}

function checkUserAccess (decoded: DecodedToken): boolean {
  if (decoded.userId) {
    debug.debug('Access granted for USER.')
    return true
  }
  debug.debug('Access denied for USER.')
  return false
}

function checkSetupModeAccess (context: InfinibayContext): boolean {
  if (context.setupMode) {
    debug.debug('Access granted for SETUP_MODE.')
    return true
  }
  debug.debug('Access denied for SETUP_MODE.')
  return false
}

/**
 * Department-scoped authorization utilities
 * These functions provide consistent department access validation across resolvers
 */

/**
 * Get department IDs that a user can access based on their VMs
 * Uses the same pattern as UserEventManager for consistency
 */
export async function getUserAccessibleDepartments (prisma: any, userId: string): Promise<string[]> {
  // A user can reach a department two ways: they own a VM in it, or they hold
  // an explicit DepartmentMembership (the department-scoped roles feature).
  const [userVMs, memberships] = await Promise.all([
    prisma.machine.findMany({
      where: { userId },
      select: { departmentId: true }
    }),
    // Only MANAGER memberships grant access to a department's resources.
    // A plain MEMBER is just a recorded participant and must NOT widen the
    // user's resource scope.
    prisma.departmentMembership.findMany({
      where: { userId, role: 'MANAGER' },
      select: { departmentId: true }
    })
  ])

  const departmentIds = [
    ...userVMs.map((vm: any) => vm.departmentId),
    ...memberships.map((m: any) => m.departmentId)
  ].filter(Boolean) as string[]

  // Remove duplicates and return
  return [...new Set(departmentIds)]
}
