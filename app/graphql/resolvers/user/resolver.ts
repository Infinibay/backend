import logger from '@main/logger'
import { Prisma } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import {
  Arg,
  Ctx,
  Mutation,
  Query,
  Resolver
} from 'type-graphql'
import { UserInputError, AuthenticationError } from '@utils/errors'
import { UserType, LoginResponse, RefreshAuthResponse, UserOrderByInputType, CreateUserInputType, UpdateUserInputType, UserRole } from './type'
import { PaginationInputType, MAX_TAKE } from '@utils/pagination'
import { InfinibayContext } from '@utils/context'
import { getEventManager } from '../../../services/EventManager'
import { Can } from '@main/permissions'
import { IdentityProviderService } from '../../../services/identity/IdentityProviderService'
import { getJWTSecret } from '@utils/jwtAuth'
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from '@utils/loginRateLimiter'
import {
  ACCESS_TOKEN_TTL_SECONDS,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllForUser
} from '@services/auth/RefreshTokenService'

// Constant bcrypt hash used to perform a dummy comparison for unknown users so
// login timing does not reveal whether an account exists (user-enumeration fix).
const DUMMY_PASSWORD_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DiZ8oP0K1g5sQ9qXp3Z5Z5Z5Z5Z5'

export interface UserResolverInterface {
  currentUser(context: InfinibayContext): Promise<UserType | null>;
  user(id: string, context: InfinibayContext): Promise<UserType | null>;
  users(
    orderBy: UserOrderByInputType,
    pagination: PaginationInputType,
    context: InfinibayContext
  ): Promise<UserType[]>;
  login(email: string, password: string, context: InfinibayContext): Promise<LoginResponse | null>;
  refreshToken(refreshToken: string, context: InfinibayContext): Promise<RefreshAuthResponse>;
  logout(context: InfinibayContext): Promise<boolean>;
  createUser(
    input: CreateUserInputType,
    context: InfinibayContext
  ): Promise<UserType>
  updateUser(
    id: string,
    input: UpdateUserInputType,
    context: InfinibayContext
  ): Promise<UserType>
  destroyUser(id: string, context: InfinibayContext): Promise<boolean>
}

@Resolver(() => UserType)
export class UserResolver implements UserResolverInterface {
  @Query(() => UserType, { nullable: true })
  @Can('user:view')
  async currentUser (@Ctx() context: InfinibayContext): Promise<UserType | null> {
    if (!context.user) {
      // This shouldn't happen if @Authorized decorator works correctly
      // But returning null is better than throwing an error
      return null
    }

    // Generate namespace for the user (same format as SocketService)
    const namespace = `user_${context.user.id.substring(0, 8)}`

    // Return the user with namespace
    return {
      ...context.user,
      namespace
    } as unknown as UserType
  }

  /*
  user Query
  @Args:
    id: ID
  Require auth('ADMIN')
  */
  @Query(() => UserType)
  @Can('user:view', { id: (a) => a.id })
  async user (
    @Arg('id') id: string,
    @Ctx() context: InfinibayContext
  ): Promise<UserType | null> {
    const prisma = context.prisma
    const user = await prisma.user.findUnique({ where: { id } })
    // Treat a soft-deleted user (deleted: true) as not found, so a destroyed
    // account never resurfaces through this lookup.
    if (!user || user.deleted) {
      return null
    }
    return user as unknown as UserType
  }

  /*
  users query
  @Args:
      orderBy: OrderByInputType
      pagination: PaginationInputType
  Require auth('ADMIN')
  */
  @Query(() => [UserType])
  // Admin directory listing (doc: "Require auth('ADMIN')"). The body does not
  // narrow rows per-caller, so require the verb at ANY scope: an OWN/DEPARTMENT
  // holder (e.g. the default USER preset's user:view@OWN) must not enumerate
  // every account across departments/tenants via possession alone.
  @Can('user:view', { minScope: 'ANY' })
  async users (
    @Arg('orderBy', { nullable: true }) orderBy: UserOrderByInputType,
    @Arg('pagination', { nullable: true }) pagination: PaginationInputType,
    @Ctx() context: InfinibayContext
  ): Promise<UserType[]> {
    const prisma = context.prisma
    // `pagination` is nullable, so a client may omit it entirely (undefined).
    // Resolve defaults with optional chaining before validating, otherwise
    // `pagination.take` dereferences undefined and throws a TypeError.
    const rawTake = pagination?.take ?? 20
    const skip = pagination?.skip ?? 0
    // Check if pagination is valid
    if (rawTake < 0 || skip < 0) {
      throw new UserInputError('Invalid pagination')
    }
    // Cap the page size so `take: 2e9` can't drive an unbounded user fetch (DoS).
    const take = Math.min(rawTake, MAX_TAKE)
    let order: Record<string, string> = {}
    if (orderBy && orderBy.fieldName && orderBy.direction) {
      order = {
        [orderBy.fieldName]: orderBy.direction
      }
    }
    const users = await prisma.user.findMany({
      // Exclude soft-deleted users so a destroyed account does not reappear in
      // the admin list on the next refetch.
      where: { deleted: false },
      orderBy: order,
      take,
      skip,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        roleId: true,
        createdAt: true
      }
    })
    return (users || []) as unknown as UserType[]
  }

  // Login mutation, requires email and password, returns { user, token, refreshToken, expiresIn }
  @Mutation(() => LoginResponse, { nullable: true })
  async login (
    @Arg('email') email: string,
    @Arg('password') password: string,
    @Ctx() context: InfinibayContext
  ): Promise<LoginResponse | null> {
    // Use the pooled prisma singleton from context (avoids per-request PrismaClient leak, #4)
    const { prisma } = context

    // Rate-limit by email + client IP so brute force against one account (or from
    // one source) is throttled without locking out everyone.
    const ip = context.req?.ip || context.req?.socket?.remoteAddress || 'unknown'
    const key = `${email}|${ip}`
    if (!checkLoginAllowed(key).allowed) {
      throw new AuthenticationError('Too many login attempts, try again later')
    }

    const user = await prisma.user.findFirst({ where: { email, deleted: false } })
    if (!user) {
      // Perform a dummy compare so an unknown account is indistinguishable from a
      // wrong password by timing (user-enumeration fix). Keep the message identical.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH)
      recordLoginFailure(key)
      throw new AuthenticationError('Invalid credentials')
    }

    let passwordMatch = false
    if (user.identityProviderId && user.externalDn) {
      // Directory (bind-authoritative) user: authenticate ONLY against the provider,
      // never against the local password hash.
      passwordMatch = await new IdentityProviderService(prisma).authenticateUser(
        user.identityProviderId,
        user.externalDn,
        password
      )
      if (passwordMatch) {
        await prisma.user.update({
          where: { id: user.id },
          data: { lastDirectorySyncAt: new Date() }
        })
      }
    } else {
      // Local-only user: verify against the bcrypt hash.
      passwordMatch = await bcrypt.compare(password, user.password)
    }

    if (!passwordMatch) {
      recordLoginFailure(key)
      throw new AuthenticationError('Invalid credentials')
    }

    // Credentials are valid: clear failure counters and mint tokens.
    recordLoginSuccess(key)

    // Sign the access JWT with the canonical secret + bounded lifetime.
    const token = jwt.sign({ userId: user.id, userRole: user.role }, getJWTSecret(), { expiresIn: ACCESS_TOKEN_TTL_SECONDS })

    // Issue a refresh token for obtaining future access tokens without re-login.
    const refresh = await issueRefreshToken(prisma, user.id)

    return {
      user: user as unknown as UserType,
      token,
      refreshToken: refresh.token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS
    }
  }

  // refreshToken mutation: exchange a valid refresh token for a fresh access token.
  // Public (no @Can), like login — the refresh token itself is the credential.
  @Mutation(() => RefreshAuthResponse)
  async refreshToken (
    @Arg('refreshToken') refreshToken: string,
    @Ctx() context: InfinibayContext
  ): Promise<RefreshAuthResponse> {
    const { prisma } = context

    // Rotate atomically: the old token is revoked and a new one returned, or null
    // when the supplied token is invalid/expired/revoked.
    const rotated = await rotateRefreshToken(prisma, refreshToken)
    if (!rotated) {
      throw new AuthenticationError('Invalid refresh token')
    }

    // Load the user so the new access token carries the current role.
    const user = await prisma.user.findFirst({ where: { id: rotated.userId, deleted: false } })
    if (!user) {
      throw new AuthenticationError('Invalid refresh token')
    }

    const token = jwt.sign({ userId: user.id, userRole: user.role }, getJWTSecret(), { expiresIn: ACCESS_TOKEN_TTL_SECONDS })

    return {
      token,
      refreshToken: rotated.token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS
    }
  }

  // logout mutation: invalidate the current user's outstanding access + refresh tokens.
  @Mutation(() => Boolean)
  @Can('user:view')
  async logout (
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    // Requires an authenticated user; unauthenticated callers get a no-op false.
    if (!context.user) {
      return false
    }

    const { prisma } = context

    // Set the access-token revocation cutoff and revoke every refresh token.
    await prisma.user.update({
      where: { id: context.user.id },
      data: { tokenInvalidatedAt: new Date() }
    })
    await revokeAllForUser(prisma, context.user.id)

    return true
  }

  /*
  creatUserMutation
  @Args:
      email: string
      password: string
      passwordConfirmation: string
      firstName: string
      lastName: string
      role: 'USER' | 'ADMIN'
  Require auth('ADMIN)
  */
  @Mutation(() => UserType)
  @Can('user:create')
  async createUser (
    @Arg('input', { nullable: false }) input: CreateUserInputType,
    @Ctx() context: InfinibayContext
  ): Promise<UserType> {
    const prisma = context.prisma

    // Protection: Only SUPER_ADMIN can create SUPER_ADMIN users
    if (input.role === UserRole.SUPER_ADMIN && context.user?.role !== 'SUPER_ADMIN') {
      throw new UserInputError('Only SUPER_ADMIN users can create other SUPER_ADMIN users.')
    }

    // Check if password and password confirmation match
    if (input.password !== input.passwordConfirmation) {
      throw new UserInputError('Password and password confirmation do not match')
    }

    // Check if the user email already does not exist in db
    const userExists = await prisma.user.findUnique({ where: { email: input.email } })
    if (userExists) {
      throw new UserInputError('User already exists')
    }

    // Encrypt the password with bcrypt
    const hashedPassword = await bcrypt.hash(input.password, parseInt(process.env.BCRYPT_ROUNDS || '10'))

    // Link the user to the system role matching their enum so authorization
    // (roleId → grants) is consistent from creation (fix for #1).
    const sysRole = await prisma.role.findUnique({ where: { key: input.role }, select: { id: true } })

    // Create the user with the hashed password
    const user = await prisma.user.create({
      data: {
        email: input.email,
        password: hashedPassword,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        roleId: sysRole?.id,
        deleted: false
      }
    })

    // Trigger real-time event for user creation
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('users', 'create', { id: user.id }, user.id)
      logger.info(`🎯 Triggered real-time event: users:create for user ${user.id}`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return Promise.resolve(user as unknown as UserType)
  }

  /*
  udpateUser Mutation
  @Args
      id: ID!
      email: String
      password: String
      passwordConfirmation: String
      currentPassword: String
      firstName: String
      lastName: String
      role: 'USER' | 'ADMIN'
  Require auth('USER' | 'ADMIN')
  - Users can update their own profile (except role)
  - Admins can update any user profile
  - Current password required for self-updates when changing password
  */
  @Mutation(() => UserType)
  @Can('user:edit', { id: (a) => a.id })
  async updateUser (
    @Arg('id') id: string,
    @Arg('input', { nullable: false }) input: UpdateUserInputType,
    @Ctx() context: InfinibayContext
  ): Promise<UserType> {
    const safeInput = {
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      avatar: input.avatar
    }
    logger.info('🔧 Backend updateUser called:', {
      id,
      inputKeys: Object.keys(safeInput),
      hasRole: 'role' in safeInput,
      roleValue: safeInput.role,
      willUpdateFields: Object.keys(safeInput).filter(key => safeInput[key as keyof typeof safeInput] !== undefined)
    })

    const prisma = context.prisma
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      throw new UserInputError('User not found')
    }

    // Check if this is a self-update
    const isSelfUpdate = context.user?.id === id

    // Self-update restrictions
    if (isSelfUpdate && input.role !== undefined) {
      throw new UserInputError('You cannot change your own role')
    }

    // Protection: Prevent changing SUPER_ADMIN role
    if (user.role === 'SUPER_ADMIN' && input.role && input.role !== UserRole.SUPER_ADMIN) {
      throw new UserInputError('Cannot modify SUPER_ADMIN role. SUPER_ADMIN users cannot be demoted.')
    }

    // Protection: Only SUPER_ADMIN can create other SUPER_ADMIN users
    if (input.role === UserRole.SUPER_ADMIN && context.user?.role !== 'SUPER_ADMIN') {
      throw new UserInputError('Only SUPER_ADMIN users can assign SUPER_ADMIN role to other users.')
    }

    // Current password validation for password updates
    if (input.password) {
      if (!input.passwordConfirmation) {
        throw new UserInputError('Password confirmation is required')
      }
      if (input.password !== input.passwordConfirmation) {
        throw new UserInputError('Password and password confirmation do not match')
      }

      if (isSelfUpdate && !input.currentPassword) {
        throw new UserInputError('Current password is required when updating your own password')
      }

      if (input.currentPassword) {
        const currentPasswordMatch = await bcrypt.compare(input.currentPassword, user.password)
        if (!currentPasswordMatch) {
          throw new AuthenticationError('Current password is incorrect')
        }
      }
    }

    // Build update data object with only the fields that were provided
    const updateData: Prisma.UserUpdateInput = {}

    // Only update password if provided
    if (input.password) {
      updateData.password = await bcrypt.hash(input.password, parseInt(process.env.BCRYPT_ROUNDS || '10'))
    }

    // Only update fields that are explicitly provided (not undefined)
    if (input.firstName !== undefined) {
      updateData.firstName = input.firstName
    }
    if (input.lastName !== undefined) {
      updateData.lastName = input.lastName
    }
    if (input.role !== undefined) {
      updateData.role = input.role
      // Keep authorization (roleId → grants) in sync with the identity enum, so a
      // role change here actually changes permissions (fix for #1). Only re-point
      // roleId when the role ACTUALLY changes, so editing an unrelated profile
      // field never silently resets a user's (possibly custom) role to a system
      // preset. Finer/custom assignment uses assignUserRole.
      if (input.role !== user.role) {
        const sysRole = await prisma.role.findUnique({ where: { key: input.role }, select: { id: true } })
        updateData.customRole = sysRole ? { connect: { id: sysRole.id } } : { disconnect: true }
      }
    }

    logger.info('📦 Final update data to be sent to database:', updateData)

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData
    })

    logger.info('✅ User updated successfully:', {
      userId: updatedUser.id,
      updatedFields: Object.keys(updateData)
    })

    // Trigger real-time event for user update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('users', 'update', { id }, updatedUser.id)
      logger.info(`🎯 Triggered real-time event: users:update for user ${id}`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return updatedUser as unknown as UserType
  }

  /*
  destroyUser Mutation
  @Args
      id: ID!
  Require user:delete @ ANY (an admin managing other people's accounts).

  SOFT delete (sets `deleted: true`) — NOT a row delete. A hard delete is blocked
  by required (Restrict) foreign keys (MaintenanceTask.createdByUserId,
  RecommendationResolution.triggeredByUserId, DepartmentScript.assignedById) and
  would orphan owned VMs (Machine.userId → null) and blank audit attribution.
  Soft delete preserves history; `login`/`refreshToken`/`user`/`users` already
  filter `deleted: false`, so the account disappears everywhere.

  Guards (mirroring updateUser): cannot delete your own account, cannot delete a
  SUPER_ADMIN unless you are one, and cannot delete the last administrator.
  */
  @Mutation(() => Boolean)
  @Can('user:delete', { id: (a) => a.id, minScope: 'ANY' })
  async destroyUser (
    @Arg('id') id: string,
    @Ctx() context: InfinibayContext
  ): Promise<boolean> {
    const prisma = context.prisma

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user || user.deleted) {
      throw new UserInputError('User not found')
    }

    // Cannot delete your own account: avoids an admin locking themselves out and
    // tearing down the session performing the request. Belt-and-braces with the
    // authz layer (minScope: 'ANY'), which already rejects an OWN-scoped grant
    // that would otherwise resolve "self".
    if (context.user?.id === id) {
      throw new UserInputError('You cannot delete your own account')
    }

    // Only a SUPER_ADMIN may delete a SUPER_ADMIN (mirrors updateUser's
    // SUPER_ADMIN protection).
    if (user.role === 'SUPER_ADMIN' && context.user?.role !== 'SUPER_ADMIN') {
      throw new UserInputError('Only SUPER_ADMIN users can delete a SUPER_ADMIN user.')
    }

    // Never delete the last remaining administrator — that would lock everyone
    // out of user/role governance.
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      const otherAdmins = await prisma.user.count({
        where: { deleted: false, id: { not: id }, role: { in: ['ADMIN', 'SUPER_ADMIN'] } }
      })
      if (otherAdmins === 0) {
        throw new UserInputError('Cannot delete the last administrator account')
      }
    }

    // Soft delete + kill the deleted user's sessions immediately (same pattern as
    // logout): set the access-token revocation cutoff and revoke refresh tokens.
    await prisma.user.update({
      where: { id },
      data: { deleted: true, tokenInvalidatedAt: new Date() }
    })
    await revokeAllForUser(prisma, id)

    // Trigger real-time event for user deletion (best-effort).
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('users', 'delete', { id }, context.user?.id)
      logger.info(`🎯 Triggered real-time event: users:delete for user ${id}`)
    } catch (eventError) {
      logger.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return true
  }
}
