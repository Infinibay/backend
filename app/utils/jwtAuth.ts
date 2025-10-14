import { Request } from 'express'
import { User } from '@prisma/client'
import jwt from 'jsonwebtoken'
import prisma from './database'
import { AuthenticationMetadata, createAuthenticationMetadata, SafeUser } from './context'

export interface DecodedToken {
  userId: string
  userRole: string
  role?: string
  iat?: number
  exp?: number
}

export interface VerifyAuthResult {
  user: SafeUser | null
  decoded: DecodedToken | null
  meta: AuthenticationMetadata
}

export interface VerifyAuthOptions {
  method: 'context' | 'fallback'
  debugAuth?: boolean
}

/**
 * Categorized JWT authentication errors for better error handling
 */
export class JWTAuthError extends Error {
  constructor (
    public category: string,
    message: string,
    public originalError?: Error
  ) {
    super(message)
    this.name = 'JWTAuthError'
  }
}

/**
 * Extracts and normalizes the Authorization header token
 * Handles Bearer prefix in a case-insensitive manner with proper trimming
 */
function extractToken (req: Request): { token: string | null; hasBearer: boolean } {
  const raw = req.headers.authorization || ''
  const m = raw.match(/^\s*Bearer\s+(.+)$/i)
  const tokenForVerify = (m ? m[1] : raw).trim()
  const hasBearer = !!m

  if (!tokenForVerify) {
    return { token: null, hasBearer }
  }

  return { token: tokenForVerify, hasBearer }
}

/**
 * Gets the JWT secret with production-safe fallback handling
 */
function getJWTSecret (): string {
  const secret = process.env.TOKENKEY

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      const error = new JWTAuthError(
        'missing_secret_production',
        'TOKENKEY environment variable is required in production'
      )
      console.error('🚨 JWT Critical Error - Missing TOKENKEY in production')
      throw error
    }

    // Non-production: only allow fallback if explicitly enabled
    if (process.env.ALLOW_INSECURE_JWT_FALLBACK !== '1') {
      const error = new JWTAuthError(
        'missing_secret_non_production',
        'TOKENKEY environment variable is required. Set ALLOW_INSECURE_JWT_FALLBACK=1 to use fallback secret in development'
      )
      console.error('🚨 JWT Critical Error - Missing TOKENKEY and fallback not allowed')
      throw error
    }

    console.warn('⚠️ JWT Warning - Using insecure fallback secret in development')
    return 'development-fallback-secret'
  }

  if (secret.length < 8) {
    console.warn('⚠️ JWT Warning - TOKENKEY is too short, consider using a longer secret')
  }

  return secret
}

/**
 * Validates decoded JWT token payload
 */
function validateTokenPayload (decoded: any): DecodedToken {
  if (!decoded || typeof decoded !== 'object') {
    throw new JWTAuthError('invalid_payload_format', 'Invalid token payload: not an object')
  }

  if (!decoded.userId || typeof decoded.userId !== 'string' || decoded.userId.trim() === '') {
    throw new JWTAuthError('invalid_payload_userid', 'Invalid token payload: missing or invalid userId')
  }

  const roleField = decoded.userRole || decoded.role
  if (!roleField || typeof roleField !== 'string' || roleField.trim() === '') {
    throw new JWTAuthError('invalid_payload_role', 'Invalid token payload: missing or invalid userRole/role')
  }

  // Token expiration validation
  if (decoded.exp && Date.now() >= decoded.exp * 1000) {
    throw new JWTAuthError('token_expired', 'Token has expired')
  }

  return {
    userId: decoded.userId,
    userRole: roleField,
    role: decoded.role,
    iat: decoded.iat,
    exp: decoded.exp
  }
}

/**
 * Fetches and validates user from database, returning safe user without sensitive fields
 */
async function fetchAndValidateUser (decoded: DecodedToken, debugAuth?: boolean): Promise<SafeUser> {
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    select: {
      id: true,
      email: true,
      deleted: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
      updatedAt: true
      // Explicitly exclude 'password' and 'token' fields for security
    }
  })

  if (!user) {
    throw new JWTAuthError('user_not_found', 'User not found in database')
  }

  if (user.deleted) {
    throw new JWTAuthError('user_deleted', 'User account is deleted')
  }

  // Role validation - ensure token role matches database role
  if (user.role !== decoded.userRole) {
    console.warn('⚠️ JWT Security Warning - Role mismatch detected:', {
      tokenRole: '[REDACTED]',
      databaseRole: '[REDACTED]',
      userId: '[REDACTED]'
    })
    throw new JWTAuthError('role_mismatch', 'Token role does not match user role')
  }

  // Return user as SafeUser type (password and token fields are already excluded by Prisma select)
  return user as SafeUser
}

/**
 * Categorizes JWT verification errors
 */
function categorizeJWTError (error: any): JWTAuthError {
  let category = 'unknown'
  let message = error instanceof Error ? error.message : String(error)

  if (error instanceof JWTAuthError) {
    return error
  }

  if (error instanceof jwt.TokenExpiredError) {
    category = 'token_expired'
    message = 'Token has expired'
  } else if (error instanceof jwt.JsonWebTokenError) {
    category = 'invalid_signature'
    message = 'Invalid token signature or format'
  } else if (error instanceof jwt.NotBeforeError) {
    category = 'not_active'
    message = 'Token is not active yet'
  }

  return new JWTAuthError(category, message, error)
}

/**
 * Verifies JWT authentication from request
 * @param req Express request object
 * @param options Verification options
 * @returns Verification result with user, decoded token, and metadata
 */
export async function verifyRequestAuth (
  req: Request,
  options: VerifyAuthOptions
): Promise<VerifyAuthResult> {
  const { method, debugAuth = false } = options

  // Extract token from Authorization header
  const { token, hasBearer } = extractToken(req)

  if (!token) {
    if (debugAuth) {
      console.log('🔑 JWT Debug - No authorization token provided')
    }

    return {
      user: null,
      decoded: null,
      meta: createAuthenticationMetadata(method, 'unauthenticated')
    }
  }

  try {
    // Get JWT secret with production-safe fallback handling
    const secret = getJWTSecret()

    // Verify JWT token
    const rawDecoded = jwt.verify(token, secret)

    // Validate token payload
    const decoded = validateTokenPayload(rawDecoded)

    // Fetch and validate user
    const user = await fetchAndValidateUser(decoded, debugAuth)

    // Create success metadata
    const meta = createAuthenticationMetadata(method, 'authenticated', {
      tokenExpiration: decoded.exp ? new Date(decoded.exp * 1000) : undefined,
      tokenRole: decoded.userRole
    })

    return {
      user,
      decoded,
      meta
    }
  } catch (error) {
    // Categorize and log specific error types
    const jwtError = categorizeJWTError(error)

    // Log categorized error
    console.error(`${method} token verification failed [${jwtError.category}]:`, jwtError.message)

    // Determine status from error category
    let status: AuthenticationMetadata['status']
    switch (jwtError.category) {
    case 'token_expired':
      status = 'token_expired'
      break
    case 'invalid_signature':
    case 'invalid_payload_format':
    case 'invalid_payload_userid':
    case 'invalid_payload_role':
    case 'not_active':
      status = 'token_invalid'
      break
    case 'user_not_found':
      status = 'user_not_found'
      break
    case 'user_deleted':
      status = 'user_deleted'
      break
    case 'role_mismatch':
      status = 'role_mismatch'
      break
    default:
      status = 'unauthenticated'
    }

    // Create failure metadata
    const meta = createAuthenticationMetadata(method, status, {
      warnings: [jwtError.message]
    })

    return {
      user: null,
      decoded: null,
      meta
    }
  }
}
