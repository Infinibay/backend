import { AuthChecker } from 'type-graphql'
import { Debugger } from './debug'
import { InfinibayContext, createUserValidationHelpers, SafeUser } from './context'
import { verifyRequestAuth, DecodedToken } from './jwtAuth'
import { Request } from 'express'

const debug = new Debugger('auth')

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
      console.log('🔐 AuthChecker Debug - User already in context')
      console.log('🔐 AuthChecker Debug - Context user details:', {
        userId: '[REDACTED]',
        userRole: context.user.role,
        userEmail: context.user.email,
        userDeleted: context.user.deleted
      })
    }
    debug.log('User already in context, checking access...')
    const decoded: DecodedToken = {
      userId: context.user.id,
      userRole: context.user.role
    }
    const accessResult = checkAccess(decoded, roles, context, debugAuth)
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - Access check result for existing user:', accessResult)
    }
    return accessResult
  }

  // Fallback: Try to verify token if user not in context
  if (debugAuth) {
    console.log('🔐 AuthChecker Debug - No user in context, trying fallback token verification')
  }

  try {
    // Use shared JWT verification utility
    const authResult = await verifyRequestAuth(context.req as Request, {
      method: 'fallback',
      debugAuth
    })

    if (!authResult.user || !authResult.decoded) {
      if (debugAuth) {
        console.log('🔐 AuthChecker Debug - Fallback authentication failed')
      }
      debug.log('Fallback authentication failed.')
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

    debug.log('Fallback authentication successful.')

    const accessResult = checkAccess(authResult.decoded, roles, context, debugAuth)
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - Final fallback access result:', accessResult)
    }
    return accessResult
  } catch (error) {
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - Fallback authentication error:', error instanceof Error ? error.message : String(error))
    }
    debug.log('error', `Fallback authentication error: ${error}`)
    return false
  }
}

function checkAccess (decoded: DecodedToken, roles: string[], context: InfinibayContext, debugAuth?: boolean): boolean {
  if (debugAuth) {
    console.log('🔐 AuthChecker Debug - checkAccess called with:', {
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
        console.log('🔐 AuthChecker Debug - Token userId does not match context user ID')
      }
      console.warn('⚠️ JWT Security Warning - Token userId does not match context user:', {
        tokenUserId: '[REDACTED]',
        contextUserId: '[REDACTED]'
      })
      return false
    }

    const roleField = decoded.userRole || decoded.role
    if (roleField !== context.user.role) {
      if (debugAuth) {
        console.log('🔐 AuthChecker Debug - Token role does not match context user role')
      }
      console.warn('⚠️ JWT Security Warning - Token role does not match context user role:', {
        tokenRole: '[REDACTED]',
        contextUserRole: '[REDACTED]'
      })
      return false
    }
  }

  if (roles.includes('ADMIN')) {
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - Checking ADMIN access')
    }
    const adminResult = checkAdminAccess(decoded)
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - ADMIN access result:', adminResult)
    }
    return adminResult
  }

  if (roles.includes('USER')) {
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - Checking USER access')
    }
    const userResult = checkUserAccess(decoded)
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - USER access result:', userResult)
    }
    return userResult
  }

  if (roles.includes('SETUP_MODE')) {
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - Checking SETUP_MODE access')
    }
    const setupResult = checkSetupModeAccess(context)
    if (debugAuth) {
      console.log('🔐 AuthChecker Debug - SETUP_MODE access result:', setupResult)
    }
    return setupResult
  }

  if (debugAuth) {
    console.log('🔐 AuthChecker Debug - No valid role found, access denied')
  }
  debug.log('No valid role found, access denied.')
  return false
}

function checkAdminAccess (decoded: DecodedToken): boolean {
  const roleField = decoded.userRole || decoded.role
  if (roleField === 'ADMIN' || roleField === 'SUPER_ADMIN') {
    debug.log('Access granted for ADMIN/SUPER_ADMIN.')
    return true
  }
  debug.log('Access denied for ADMIN.')
  return false
}

function checkUserAccess (decoded: DecodedToken): boolean {
  if (decoded.userId) {
    debug.log('Access granted for USER.')
    return true
  }
  debug.log('Access denied for USER.')
  return false
}

function checkSetupModeAccess (context: InfinibayContext): boolean {
  if (context.setupMode) {
    debug.log('Access granted for SETUP_MODE.')
    return true
  }
  debug.log('Access denied for SETUP_MODE.')
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
export async function getUserAccessibleDepartments(prisma: any, userId: string): Promise<string[]> {
  const userVMs = await prisma.machine.findMany({
    where: { userId },
    select: { departmentId: true }
  })

  const departmentIds = userVMs
    .map((vm: any) => vm.departmentId)
    .filter(Boolean) as string[]

  // Remove duplicates and return
  return [...new Set(departmentIds)]
}

/**
 * Validate if a user has access to a specific department
 * Returns true if user is ADMIN or has VMs in the department
 */
export async function validateDepartmentAccess(
  prisma: any,
  user: SafeUser | null,
  departmentId: string
): Promise<boolean> {
  if (!user) {
    debug.log('Department access denied: No user provided')
    return false
  }

  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    debug.log(`Department access granted: Admin/Super admin user ${user.id}`)
    return true
  }

  const userDepartmentIds = await getUserAccessibleDepartments(prisma, user.id)
  const hasAccess = userDepartmentIds.includes(departmentId)

  debug.log(`Department access ${hasAccess ? 'granted' : 'denied'}: User ${user.id} for department ${departmentId}`)
  return hasAccess
}

/**
 * Check if a user has access to a specific resource based on department membership
 * Generic function that can be used for filters, VMs, or other department-scoped resources
 */
export async function validateResourceDepartmentAccess(
  prisma: any,
  user: SafeUser | null,
  resourceId: string,
  resourceType: 'filter' | 'vm' | 'department',
  options: { includeGeneric?: boolean } = {}
): Promise<boolean> {
  if (!user) {
    debug.log(`Resource access denied: No user provided for ${resourceType} ${resourceId}`)
    return false
  }

  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    debug.log(`Resource access granted: Admin/Super admin user ${user.id} for ${resourceType} ${resourceId}`)
    return true
  }

  const userDepartmentIds = await getUserAccessibleDepartments(prisma, user.id)
  if (userDepartmentIds.length === 0) {
    debug.log(`Resource access denied: User ${user.id} has no accessible departments`)
    return false
  }

  let hasAccess = false

  switch (resourceType) {
    case 'filter':
      const filter = await prisma.nWFilter.findUnique({
        where: { id: resourceId },
        include: { departments: true }
      })

      if (!filter) {
        debug.log(`Resource access denied: Filter ${resourceId} not found`)
        return false
      }

      // Check if filter is generic type and includeGeneric is true
      if (options.includeGeneric && filter.type === 'generic') {
        hasAccess = true
        break
      }

      // Check if filter is associated with any of the user's departments
      hasAccess = filter.departments.some((dept: any) =>
        userDepartmentIds.includes(dept.departmentId)
      )
      break

    case 'vm':
      const vm = await prisma.machine.findUnique({
        where: { id: resourceId },
        select: { departmentId: true, userId: true }
      })

      if (!vm) {
        debug.log(`Resource access denied: VM ${resourceId} not found`)
        return false
      }

      // User can access their own VMs or VMs in their departments
      hasAccess = vm.userId === user.id ||
        (vm.departmentId && userDepartmentIds.includes(vm.departmentId))
      break

    case 'department':
      hasAccess = userDepartmentIds.includes(resourceId)
      break

    default:
      debug.log(`Resource access denied: Unknown resource type ${resourceType}`)
      return false
  }

  debug.log(`Resource access ${hasAccess ? 'granted' : 'denied'}: User ${user.id} for ${resourceType} ${resourceId}`)
  return hasAccess
}

/**
 * Filter a list of department IDs to only include those accessible by the user
 * Useful for scoping queries to user-accessible departments
 */
export async function filterAccessibleDepartments(
  prisma: any,
  user: SafeUser | null,
  departmentIds: string[]
): Promise<string[]> {
  if (!user) {
    return []
  }

  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    return departmentIds // Admin/Super admin can access all departments
  }

  const userDepartmentIds = await getUserAccessibleDepartments(prisma, user.id)
  return departmentIds.filter(id => userDepartmentIds.includes(id))
}

/**
 * Get a WHERE clause for Prisma queries that filters resources by department access
 * This ensures consistent department scoping across all queries
 */
export async function getDepartmentScopedWhereClause(
  prisma: any,
  user: SafeUser | null,
  resourceType: 'filter' | 'vm' | 'department',
  baseWhere: any = {}
): Promise<any> {
  if (!user) {
    // No user, return impossible condition
    return { ...baseWhere, id: 'impossible' }
  }

  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
    // Admin/Super admin can access everything
    return baseWhere
  }

  const userDepartmentIds = await getUserAccessibleDepartments(prisma, user.id)

  switch (resourceType) {
    case 'filter':
      // Always include generic filters for filters, even if user has no departments
      const filterOrConditions: any[] = [{ type: 'generic' }]

      // Only add department condition if user has departments
      if (userDepartmentIds.length > 0) {
        filterOrConditions.push({
          departments: {
            some: {
              departmentId: {
                in: userDepartmentIds
              }
            }
          }
        })
      }

      return {
        ...baseWhere,
        OR: filterOrConditions
      }

    case 'vm':
      if (userDepartmentIds.length === 0) {
        // User has no departments, can only access their own VMs
        return {
          ...baseWhere,
          userId: user.id
        }
      }
      return {
        ...baseWhere,
        OR: [
          { userId: user.id }, // User's own VMs
          {
            departmentId: {
              in: userDepartmentIds
            }
          }
        ]
      }

    case 'department':
      if (userDepartmentIds.length === 0) {
        // User has no departments, return impossible condition
        return { ...baseWhere, id: 'impossible' }
      }
      return {
        ...baseWhere,
        id: {
          in: userDepartmentIds
        }
      }

    default:
      return { ...baseWhere, id: 'impossible' }
  }
}
