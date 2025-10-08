import { Request, Response } from 'express'
import { PrismaClient, User } from '@prisma/client'
import { EventManager } from '../services/EventManager'
import { VirtioSocketWatcherService } from '../services/VirtioSocketWatcherService'

/**
 * Safe user type that excludes sensitive fields (password, token) from context
 * This ensures sensitive data never leaks into GraphQL resolvers
 */
export type SafeUser = Omit<User, 'password' | 'token'>

/**
 * Authentication metadata for debugging and validation purposes
 */
export interface AuthenticationMetadata {
  /** Whether authentication was performed via context (index.ts) or fallback (authChecker.ts) */
  method: 'context' | 'fallback' | 'none'
  /** Token validation status - indicates specific authentication result */
  status: 'authenticated' | 'unauthenticated' | 'token_expired' | 'token_invalid' | 'user_not_found' | 'user_deleted' | 'role_mismatch'
  /** Authentication warnings (e.g., missing TOKENKEY, role mismatches) */
  warnings?: string[]
  /** Timestamp when authentication was performed */
  timestamp: Date
  /** Token expiration time if available */
  tokenExpiration?: Date
  /** User role from token (may differ from database role in case of tampering) */
  tokenRole?: string
}

/**
 * User validation helpers for consistent authentication state checking
 */
export interface UserValidationHelpers {
  /** Check if user is authenticated and not deleted */
  isAuthenticated(): boolean
  /** Check if user has specific role */
  hasRole(role: string): boolean
  /** Check if user is admin */
  isAdmin(): boolean
  /** Get user display name (firstName + lastName or email) */
  getDisplayName(): string
  /** Check if authentication is fresh (not expired) */
  isAuthenticationFresh(): boolean
}

/**
 * Enhanced Infinibay GraphQL context with comprehensive authentication support.
 *
 * Authentication Flow:
 * 1. Primary authentication happens in index.ts during Apollo Server context setup
 * 2. Fallback authentication occurs in authChecker.ts for protected resolvers
 * 3. Both flows use identical JWT verification logic and validation rules
 * 4. Authentication metadata tracks the flow and provides debugging information
 *
 * Security Features:
 * - Consistent token verification between context and authChecker
 * - User existence and deletion status validation
 * - Role consistency checks between token and database
 * - Comprehensive error categorization and logging
 * - Token expiration validation
 */
export interface InfinibayContext {
  /** Express request object */
  req: Request
  /** Express response object */
  res: Response
  /** Authenticated user from database or null if unauthenticated (excludes sensitive fields) */
  user: SafeUser | null
  /** Prisma database client */
  prisma: PrismaClient
  /** Whether the system is in setup mode (allows unauthenticated access) */
  setupMode: boolean
  /** Event manager for real-time updates */
  eventManager?: EventManager
  /** VirtioSocket watcher service for VM communication */
  virtioSocketWatcher?: VirtioSocketWatcherService
  /** Authentication metadata for debugging and validation */
  auth?: AuthenticationMetadata
  /** User validation helper methods */
  userHelpers?: UserValidationHelpers
}

/**
 * Creates user validation helpers for the given user and authentication metadata
 */
export function createUserValidationHelpers (
  user: SafeUser | null,
  auth?: AuthenticationMetadata
): UserValidationHelpers {
  return {
    isAuthenticated (): boolean {
      return !!(user && !user.deleted && auth?.status === 'authenticated')
    },

    hasRole (role: string): boolean {
      return !!(user && user.role === role && this.isAuthenticated())
    },

    isAdmin (): boolean {
      return this.hasRole('ADMIN') || this.hasRole('SUPER_ADMIN')
    },

    getDisplayName (): string {
      if (!user) return 'Anonymous'
      if (user.firstName && user.lastName) {
        return `${user.firstName} ${user.lastName}`
      }
      return user.email || 'Unknown User'
    },

    isAuthenticationFresh (): boolean {
      if (!auth?.tokenExpiration) return true // No expiration means fresh
      return new Date() < auth.tokenExpiration
    }
  }
}

/**
 * Creates authentication metadata for tracking authentication state
 */
export function createAuthenticationMetadata (
  method: 'context' | 'fallback' | 'none',
  status: AuthenticationMetadata['status'],
  options: {
    warnings?: string[]
    tokenExpiration?: Date
    tokenRole?: string
  } = {}
): AuthenticationMetadata {
  return {
    method,
    status,
    warnings: options.warnings,
    timestamp: new Date(),
    tokenExpiration: options.tokenExpiration,
    tokenRole: options.tokenRole
  }
}
