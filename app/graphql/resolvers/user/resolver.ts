import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import {
  Arg,
  Authorized,
  Ctx,
  Mutation,
  Query,
  Resolver
} from 'type-graphql'
import { UserInputError, AuthenticationError } from 'apollo-server-errors'
import { UserType, UserToken, LoginResponse, UserOrderByInputType, CreateUserInputType, UpdateUserInputType, UserRole } from './type'
import { PaginationInputType } from '@utils/pagination'
import { InfinibayContext } from '@utils/context'
import { getEventManager } from '../../../services/EventManager'
import { validateAvatarPath, avatarExists, normalizeAvatarPath, DEFAULT_AVATAR_PATH } from '../../../utils/avatarValidation'

export interface UserResolverInterface {
  currentUser(context: InfinibayContext): Promise<UserType | null>;
  user(id: string): Promise<UserType | null>;
  users(
    orderBy: UserOrderByInputType,
    pagination: PaginationInputType
  ): Promise<UserType[]>;
  login(email: string, password: string): Promise<LoginResponse | null>;
  createUser(
    input: CreateUserInputType,
    context: InfinibayContext
  ): Promise<UserType>
  updateUser(
    id: string,
    input: UpdateUserInputType,
    context: InfinibayContext
  ): Promise<UserType>
}

@Resolver(_of => UserType)
export class UserResolver implements UserResolverInterface {
  @Query(() => UserType, { nullable: true })
  @Authorized('USER')
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
  @Query(_returns => UserType)
  @Authorized('ADMIN')
  async user (
    @Arg('id') id: string
  ): Promise<UserType | null> {
    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({ where: { id } })
    // thrwo exception if user not found
    if (!user) {
      // throw new UserInputError('User not found')
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
  @Authorized('ADMIN')
  async users (
    @Arg('orderBy', { nullable: true }) orderBy: UserOrderByInputType,
    @Arg('pagination', { nullable: true }) pagination: PaginationInputType
  ): Promise<UserType[]> {
    const prisma = new PrismaClient()
    // Check if pagination is valid
    if (pagination.take < 0 || pagination.skip < 0) {
      throw new UserInputError('Invalid pagination')
    }
    const take = pagination.take || 20
    const skip = pagination.skip || 0
    let order: Record<string, string> = {}
    if (orderBy && orderBy.fieldName && orderBy.direction) {
      order = {
        [orderBy.fieldName]: orderBy.direction
      }
    }
    const users = await prisma.user.findMany({
      orderBy: order,
      take,
      skip,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatar: true,
        createdAt: true
      }
    })
    return (users || []) as unknown as UserType[]
  }

  // Login mutation, requires email and password, returns { user, token }
  @Mutation(() => LoginResponse, { nullable: true })
  async login (
    @Arg('email') email: string,
    @Arg('password') password: string
  ): Promise<LoginResponse | null> {
    const prisma = new PrismaClient()
    const user = await prisma.user.findFirst({ where: { email } })
    if (!user) {
      throw new AuthenticationError('Invalid credentials')
    }
    const passwordMatch = await bcrypt.compare(password, user.password)
    if (!passwordMatch) {
      throw new AuthenticationError('Invalid credentials')
    }
    // Now that we know the user is valid, we can generate a token
    const token = jwt.sign({ userId: user.id, userRole: user.role }, process.env.TOKENKEY ?? 'secret')

    // Return both user data and token
    return {
      user: user as unknown as UserType,
      token
    }
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
  @Authorized('ADMIN')
  async createUser (
    @Arg('input', { nullable: false }) input: CreateUserInputType,
    @Ctx() context: InfinibayContext
  ): Promise<UserType> {
    const prisma = new PrismaClient()

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

    // Create the user with the hashed password
    const user = await prisma.user.create({
      data: {
        email: input.email,
        password: hashedPassword,
        firstName: input.firstName,
        lastName: input.lastName,
        role: input.role,
        avatar: DEFAULT_AVATAR_PATH, // Database stores relative path format, frontend converts to API URLs
        deleted: false
      }
    })

    // Trigger real-time event for user creation
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('users', 'create', { id: user.id }, user.id)
      console.log(`🎯 Triggered real-time event: users:create for user ${user.id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
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
  @Authorized('USER', 'ADMIN')
  async updateUser (
    @Arg('id') id: string,
    @Arg('input', { nullable: false }) input: UpdateUserInputType,
    @Ctx() context: InfinibayContext
  ): Promise<UserType> {
    // Temporarily bypass SUPER_ADMIN protection for avatar-only updates
    const isAvatarOnlyUpdate = Object.keys(input).length === 1 && 'avatar' in input;
    const { password, passwordConfirmation, currentPassword, ...safeInput } = input
    console.log('🔧 Backend updateUser called:', {
      id,
      inputKeys: Object.keys(safeInput),
      hasRole: 'role' in safeInput,
      roleValue: safeInput.role,
      hasAvatar: 'avatar' in safeInput,
      avatarValue: safeInput.avatar !== undefined,
      isAvatarOnlyUpdate,
      willUpdateFields: Object.keys(safeInput).filter(key => (safeInput as any)[key] !== undefined)
    })

    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) {
      throw new UserInputError('User not found')
    }

    // Check if this is a self-update
    const isSelfUpdate = context.user?.id === id
    const isPrivileged = context.user?.role === 'ADMIN' || context.user?.role === 'SUPER_ADMIN'
    if (!isSelfUpdate && !isPrivileged) {
      throw new AuthenticationError('Not authorized to update this user')
    }

    // Self-update restrictions
    if (isSelfUpdate && input.role !== undefined) {
      throw new UserInputError('You cannot change your own role')
    }

    // Only apply SUPER_ADMIN role protection if this is NOT an avatar-only update
    if (!isAvatarOnlyUpdate) {
      // Protection: Prevent changing SUPER_ADMIN role
      if (user.role === 'SUPER_ADMIN' && input.role && input.role !== UserRole.SUPER_ADMIN) {
        throw new UserInputError('Cannot modify SUPER_ADMIN role. SUPER_ADMIN users cannot be demoted.')
      }

      // Protection: Only SUPER_ADMIN can create other SUPER_ADMIN users
      if (input.role === UserRole.SUPER_ADMIN && context.user?.role !== 'SUPER_ADMIN') {
        throw new UserInputError('Only SUPER_ADMIN users can assign SUPER_ADMIN role to other users.')
      }
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

    // Normalize and validate avatar
    let normalizedAvatar: string | undefined
    if (input.avatar !== undefined) {
      // Handle null avatar by setting to default
      if (input.avatar === null) {
        normalizedAvatar = DEFAULT_AVATAR_PATH
      } else {
        // Normalize the avatar path
        normalizedAvatar = normalizeAvatarPath(input.avatar)

        // Validate normalized path
        if (!validateAvatarPath(normalizedAvatar)) {
          throw new UserInputError('Invalid avatar path format. Avatar path must start with "images/avatars/" and have a valid extension.')
        }

        // Check if avatar file exists
        const avatarFileExists = await avatarExists(normalizedAvatar)
        if (!avatarFileExists) {
          throw new UserInputError('Selected avatar does not exist. Please choose from available avatars.')
        }
      }
    }

    // Build update data object with only the fields that were provided
    const updateData: any = {}

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
    }
    if (normalizedAvatar !== undefined) {
      updateData.avatar = normalizedAvatar
    }

    console.log('📦 Final update data to be sent to database:', updateData)

    const updatedUser = await prisma.user.update({
      where: { id },
      data: updateData
    })

    console.log('✅ User updated successfully:', {
      userId: updatedUser.id,
      updatedFields: Object.keys(updateData),
      avatar: updatedUser.avatar
    })

    // Trigger real-time event for user update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('users', 'update', { id }, updatedUser.id)
      console.log(`🎯 Triggered real-time event: users:update for user ${id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return updatedUser as unknown as UserType
  }
}
