import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { Request } from 'express'
import jwt from 'jsonwebtoken'
import { SafeUser } from '@utils/context'

// Mock the database module
const mockPrisma = {
  user: {
    findUnique: jest.fn() as jest.MockedFunction<any>
  }
}

jest.mock('@utils/database', () => mockPrisma)

// Import after mocking
const { verifyRequestAuth } = jest.requireActual('@utils/jwtAuth') as typeof import('@utils/jwtAuth')

describe('JWT Authentication Security Tests', () => {
  // SafeUser object - simulates what Prisma returns with select clause excluding password/token
  const mockSafeUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'ADMIN',
    deleted: false,
    userImage: null,
    createdAt: new Date('2024-01-01')
    // Note: password and token fields are intentionally excluded to simulate Prisma select behavior
  }
  const testSecret = 'test-secret-key'
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.TOKENKEY = testSecret

    // Mock Prisma to return only safe user fields (simulating the select clause)
    mockPrisma.user.findUnique.mockResolvedValue(mockSafeUser)
  })

  afterEach(() => {
    process.env = originalEnv
  })

  describe('verifyRequestAuth', () => {
    it('should return SafeUser without password and token fields', async () => {
      // Arrange
      const token = jwt.sign(
        { userId: mockSafeUser.id, userRole: mockSafeUser.role },
        testSecret
      )

      const mockRequest = {
        headers: {
          authorization: `Bearer ${token}`
        }
      } as Request

      // Act
      const result = await verifyRequestAuth(mockRequest, {
        method: 'context',
        debugAuth: false
      })

      // Assert
      expect(result.user).toBeDefined()
      expect(result.user).not.toHaveProperty('password')
      expect(result.user).not.toHaveProperty('token')

      // Verify SafeUser has all the expected fields except password and token
      expect(result.user).toMatchObject({
        id: mockSafeUser.id,
        email: mockSafeUser.email,
        firstName: mockSafeUser.firstName,
        lastName: mockSafeUser.lastName,
        role: mockSafeUser.role,
        deleted: mockSafeUser.deleted,
        userImage: mockSafeUser.userImage,
        createdAt: mockSafeUser.createdAt
      })

      expect(result.meta.status).toBe('authenticated')
      expect(result.meta.method).toBe('context')
    })

    it('should return unauthenticated status when no token provided', async () => {
      // Arrange
      const mockRequest = {
        headers: {}
      } as Request

      // Act
      const result = await verifyRequestAuth(mockRequest, {
        method: 'context',
        debugAuth: false
      })

      // Assert
      expect(result.user).toBeNull()
      expect(result.decoded).toBeNull()
      expect(result.meta.status).toBe('unauthenticated')
      expect(result.meta.method).toBe('context')
    })
  })

  describe('Security Requirements', () => {
    it('should never return password field in context user', async () => {
      // Arrange
      const token = jwt.sign(
        { userId: mockSafeUser.id, userRole: mockSafeUser.role },
        testSecret
      )

      const mockRequest = {
        headers: {
          authorization: `Bearer ${token}`
        }
      } as Request

      // Act
      const result = await verifyRequestAuth(mockRequest, {
        method: 'context',
        debugAuth: false
      })

      // Assert - Verify at runtime that sensitive fields are excluded
      expect(result.user).toBeDefined()

      if (result.user) {
        expect(Object.prototype.hasOwnProperty.call(result.user, 'password')).toBe(false)
        expect(Object.prototype.hasOwnProperty.call(result.user, 'token')).toBe(false)

        // Verify that safe fields are still present
        expect(result.user.id).toBe(mockSafeUser.id)
        expect(result.user.email).toBe(mockSafeUser.email)
        expect(result.user.role).toBe(mockSafeUser.role)
      }
    })

    it('should maintain type safety with SafeUser', () => {
      // This is a compile-time test to ensure SafeUser type excludes sensitive fields
      const safeUser: SafeUser = {
        id: 'test-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'USER',
        deleted: false,
        userImage: null,
        createdAt: new Date()
        // password and token should not be assignable to SafeUser
      }

      expect(safeUser).toBeDefined()
      expect(safeUser.id).toBe('test-id')

      // These should cause TypeScript errors if uncommented:
      // safeUser.password = 'should-not-work'
      // safeUser.token = 'should-not-work'
    })
  })
})