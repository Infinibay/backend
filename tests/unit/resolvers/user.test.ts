import 'reflect-metadata'
import { UserResolver } from '@resolvers/user/resolver'
import { mockPrisma } from '../../setup/jest.setup'
import {
  createMockUser,
  createMockAdminUser,
  createMockUsers,
  createMockUserInput
} from '../../setup/mock-factories'
import {
  createMockContext,
  createAdminContext,
  generateTestToken
} from '../../setup/test-helpers'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { UserInputError, AuthenticationError } from 'apollo-server-errors'

describe('UserResolver', () => {
  let resolver: UserResolver

  beforeEach(() => {
    resolver = new UserResolver()
    jest.clearAllMocks()
  })

  describe('currentUser', () => {
    it('should return current user from context', async () => {
      const mockUser = createMockUser()
      const context = createMockContext({ user: mockUser, prisma: mockPrisma })

      // Mock the prisma call for namespace generation
      mockPrisma.user.update.mockResolvedValue(mockUser)

      const result = await resolver.currentUser(context)

      expect(result).toEqual(mockUser)
    })

    it('should generate namespace for user if not exists', async () => {
      const mockUser = createMockUser()
      const userWithoutNamespace = { ...mockUser, namespace: undefined }
      const context = createMockContext({ user: userWithoutNamespace, prisma: mockPrisma })

      const updatedUser = { ...mockUser, namespace: 'user_12345_abcd' }
      mockPrisma.user.update.mockResolvedValue(updatedUser)

      const result = await resolver.currentUser(context)

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: expect.objectContaining({ namespace: expect.stringMatching(/^user_.*/) })
      })
      expect(result).toEqual(updatedUser)
    })

    it('should return null if no user in context', async () => {
      const context = createMockContext({ user: undefined, prisma: mockPrisma })

      const result = await resolver.currentUser(context)

      expect(result).toBeNull()
    })
  })

  describe('user', () => {
    it('should return user by id for admin', async () => {
      const mockUser = createMockUser()
      mockPrisma.user.findUnique.mockResolvedValue(mockUser)

      const result = await resolver.user(mockUser.id)

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: mockUser.id }
      })
      expect(result).toEqual(mockUser)
    })

    it('should return null if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      const result = await resolver.user('non-existent-id')

      expect(result).toBeNull()
    })
  })

  describe('users', () => {
    it('should return paginated users list', async () => {
      const mockUsers = createMockUsers(5)
      const total = 10

      mockPrisma.user.findMany.mockResolvedValue(mockUsers)
      mockPrisma.user.count.mockResolvedValue(total)

      const result = await resolver.users(
        { field: 'createdAt', direction: 'desc' },
        { take: 5, skip: 0 }
      )

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { deleted: false },
        orderBy: { createdAt: 'desc' },
        take: 5,
        skip: 0
      })
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: { deleted: false }
      })
      expect(result).toEqual({
        users: mockUsers,
        total
      })
    })

    it('should handle empty results', async () => {
      mockPrisma.user.findMany.mockResolvedValue([])
      mockPrisma.user.count.mockResolvedValue(0)

      const result = await resolver.users(
        { field: 'email', direction: 'asc' },
        { take: 10, skip: 0 }
      )

      expect(result).toEqual({
        users: [],
        total: 0
      })
    })

    it('should apply correct ordering', async () => {
      const mockUsers = createMockUsers(3)
      mockPrisma.user.findMany.mockResolvedValue(mockUsers)
      mockPrisma.user.count.mockResolvedValue(3)

      await resolver.users(
        { field: 'email', direction: 'asc' },
        { take: 10, skip: 0 }
      )

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { deleted: false },
        orderBy: { email: 'asc' },
        take: 10,
        skip: 0
      })
    })
  })

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      const password = 'password123'
      const hashedPassword = await bcrypt.hash(password, 10)
      const mockUser = createMockUser({ password: hashedPassword })

      mockPrisma.user.findUnique.mockResolvedValue(mockUser)
      mockPrisma.user.update.mockResolvedValue({
        ...mockUser,
        token: 'new-token'
      })

      const result = await resolver.login(mockUser.email, password)

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: mockUser.email }
      })
      expect(result).toMatchObject({
        id: mockUser.id,
        email: mockUser.email,
        firstName: mockUser.firstName,
        lastName: mockUser.lastName,
        role: mockUser.role,
        token: expect.any(String)
      })
    })

    it('should fail login with invalid email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      await expect(
        resolver.login('invalid@example.com', 'password')
      ).rejects.toThrow(UserInputError)
    })

    it('should fail login with invalid password', async () => {
      const mockUser = createMockUser({ password: await bcrypt.hash('correct', 10) })
      mockPrisma.user.findUnique.mockResolvedValue(mockUser)

      await expect(
        resolver.login(mockUser.email, 'wrong-password')
      ).rejects.toThrow(UserInputError)
    })

    it('should fail login for deleted user', async () => {
      const mockUser = createMockUser({
        deleted: true,
        password: await bcrypt.hash('password', 10)
      })
      mockPrisma.user.findUnique.mockResolvedValue(mockUser)

      await expect(
        resolver.login(mockUser.email, 'password')
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('createUser', () => {
    it('should create new user with valid input', async () => {
      const input = createMockUserInput()
      const hashedPassword = await bcrypt.hash(input.password, 10)
      const createdUser = createMockUser({
        ...input,
        password: hashedPassword
      })

      mockPrisma.user.findUnique.mockResolvedValue(null) // Email doesn't exist
      mockPrisma.user.create.mockResolvedValue(createdUser)

      const result = await resolver.createUser(input)

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          password: expect.any(String), // Hashed password
          deleted: false
        })
      })
      expect(result).toEqual(createdUser)
    })

    it('should throw error if email already exists', async () => {
      const input = createMockUserInput()
      const existingUser = createMockUser({ email: input.email })

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)

      await expect(resolver.createUser(input)).rejects.toThrow(UserInputError)
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('should validate email format', async () => {
      const input = createMockUserInput({ email: 'invalid-email' })

      await expect(resolver.createUser(input)).rejects.toThrow(UserInputError)
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('should validate password requirements', async () => {
      const input = createMockUserInput({ password: '123' }) // Too short

      await expect(resolver.createUser(input)).rejects.toThrow(UserInputError)
      expect(mockPrisma.user.create).not.toHaveBeenCalled()
    })

    it('should validate role values', async () => {
      const input = createMockUserInput({ role: 'INVALID_ROLE' })
      mockPrisma.user.findUnique.mockResolvedValue(null)

      await expect(resolver.createUser(input)).rejects.toThrow()
    })
  })

  describe('updateUser', () => {
    it('should update user with valid input', async () => {
      const existingUser = createMockUser()
      const updateInput = {
        firstName: 'Updated',
        lastName: 'Name'
      }
      const updatedUser = { ...existingUser, ...updateInput }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.user.update.mockResolvedValue(updatedUser)

      const result = await resolver.updateUser(existingUser.id, updateInput)

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: existingUser.id },
        data: updateInput
      })
      expect(result).toEqual(updatedUser)
    })

    it('should update password with hashing', async () => {
      const existingUser = createMockUser()
      const newPassword = 'NewSecurePass123!'
      const updateInput = { password: newPassword }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.user.update.mockResolvedValue({
        ...existingUser,
        password: await bcrypt.hash(newPassword, 10)
      })

      await resolver.updateUser(existingUser.id, updateInput)

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: existingUser.id },
        data: expect.objectContaining({
          password: expect.any(String) // Should be hashed
        })
      })
    })

    it('should throw error if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      await expect(
        resolver.updateUser('non-existent', { firstName: 'Test' })
      ).rejects.toThrow(UserInputError)
    })

    it('should prevent email update to existing email', async () => {
      const user1 = createMockUser()
      const user2 = createMockUser()

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(user1) // User to update exists
        .mockResolvedValueOnce(user2) // Email already taken

      await expect(
        resolver.updateUser(user1.id, { email: user2.email })
      ).rejects.toThrow(UserInputError)
    })

    it('should allow updating role for admin users', async () => {
      const existingUser = createMockUser({ role: 'USER' })
      const updateInput = { role: 'ADMIN' }
      const updatedUser = { ...existingUser, role: 'ADMIN' }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.user.update.mockResolvedValue(updatedUser)

      const result = await resolver.updateUser(existingUser.id, updateInput)

      expect(result.role).toBe('ADMIN')
    })
  })

  describe('deleteUser', () => {
    it('should soft delete user', async () => {
      const existingUser = createMockUser({ deleted: false })
      const deletedUser = { ...existingUser, deleted: true }

      mockPrisma.user.findUnique.mockResolvedValue(existingUser)
      mockPrisma.user.update.mockResolvedValue(deletedUser)

      const result = await resolver.deleteUser(existingUser.id)

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: existingUser.id },
        data: { deleted: true }
      })
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('deleted')
      })
    })

    it('should throw error if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null)

      await expect(
        resolver.deleteUser('non-existent')
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error if user already deleted', async () => {
      const deletedUser = createMockUser({ deleted: true })
      mockPrisma.user.findUnique.mockResolvedValue(deletedUser)

      await expect(
        resolver.deleteUser(deletedUser.id)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('restoreUser', () => {
    it('should restore soft deleted user', async () => {
      const deletedUser = createMockUser({ deleted: true })
      const restoredUser = { ...deletedUser, deleted: false }

      mockPrisma.user.findUnique.mockResolvedValue(deletedUser)
      mockPrisma.user.update.mockResolvedValue(restoredUser)

      const result = await resolver.restoreUser(deletedUser.id)

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: deletedUser.id },
        data: { deleted: false }
      })
      expect(result).toEqual(restoredUser)
    })

    it('should throw error if user not deleted', async () => {
      const activeUser = createMockUser({ deleted: false })
      mockPrisma.user.findUnique.mockResolvedValue(activeUser)

      await expect(
        resolver.restoreUser(activeUser.id)
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('changePassword', () => {
    it('should change password with valid old password', async () => {
      const oldPassword = 'OldPass123!'
      const newPassword = 'NewPass123!'
      const user = createMockUser({
        password: await bcrypt.hash(oldPassword, 10)
      })
      const context = createMockContext({ user, prisma: mockPrisma })

      mockPrisma.user.update.mockResolvedValue({
        ...user,
        password: await bcrypt.hash(newPassword, 10)
      })

      const result = await resolver.changePassword(context, oldPassword, newPassword)

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { password: expect.any(String) }
      })
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('changed')
      })
    })

    it('should throw error with invalid old password', async () => {
      const user = createMockUser({
        password: await bcrypt.hash('correct', 10)
      })
      const context = createMockContext({ user, prisma: mockPrisma })

      await expect(
        resolver.changePassword(context, 'wrong', 'NewPass123!')
      ).rejects.toThrow(UserInputError)
    })

    it('should validate new password requirements', async () => {
      const oldPassword = 'OldPass123!'
      const user = createMockUser({
        password: await bcrypt.hash(oldPassword, 10)
      })
      const context = createMockContext({ user, prisma: mockPrisma })

      await expect(
        resolver.changePassword(context, oldPassword, '123') // Too short
      ).rejects.toThrow(UserInputError)
    })
  })

  describe('Authorization Tests', () => {
    it('should require ADMIN role for users query', async () => {
      const userContext = createMockContext() // Regular user

      // This would be handled by GraphQL authorization decorator
      // In actual test with full GraphQL schema, this would throw
      // For unit test, we just verify the decorator exists
      const metadata = Reflect.getMetadata('custom:authorized', UserResolver.prototype, 'users')
      expect(metadata).toBe('ADMIN')
    })

    it('should require ADMIN role for user query', async () => {
      const metadata = Reflect.getMetadata('custom:authorized', UserResolver.prototype, 'user')
      expect(metadata).toBe('ADMIN')
    })

    it('should require USER role for currentUser query', async () => {
      const metadata = Reflect.getMetadata('custom:authorized', UserResolver.prototype, 'currentUser')
      expect(metadata).toBe('USER')
    })

    it('should require ADMIN role for createUser mutation', async () => {
      const metadata = Reflect.getMetadata('custom:authorized', UserResolver.prototype, 'createUser')
      expect(metadata).toBe('ADMIN')
    })

    it('should require ADMIN role for updateUser mutation', async () => {
      const metadata = Reflect.getMetadata('custom:authorized', UserResolver.prototype, 'updateUser')
      expect(metadata).toBe('ADMIN')
    })
  })
})
