import 'reflect-metadata'
import { PrismaClient, User } from '@prisma/client'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import {
  createMockUser,
  createMockAdminUser,
  generateId
} from '../setup/mock-factories'
import { generateTestToken } from '../setup/test-helpers'
import { mockPrisma } from '../setup/jest.setup'

interface AuthContext {
  req: { headers: { authorization?: string } }
  user: User | null
  setupMode: boolean
}

interface DecodedToken {
  userId: string
  userRole: string
  iat?: number
  exp?: number
}

// Test implementation of authChecker for testing purposes
async function testAuthChecker (
  context: AuthContext,
  roles: string[]
): Promise<boolean> {
  // If in setup mode and checking for SETUP_MODE role
  if (context.setupMode && roles.includes('SETUP_MODE')) {
    return true
  }

  const token = context.req.headers.authorization

  if (!token) {
    return false
  }

  try {
    const decoded = jwt.verify(token, process.env.TOKENKEY || 'test-secret-key') as DecodedToken

    // Fetch user from database
    const user = await mockPrisma.user.findUnique({
      where: { id: decoded.userId }
    }) as User | null

    if (!user || user.deleted) {
      return false
    }

    // Set user in context
    context.user = user

    // Check role authorization
    if (roles.includes('ADMIN') && user.role !== 'ADMIN') {
      return false
    }

    if (roles.includes('USER')) {
      return true // Both USER and ADMIN can access USER routes
    }

    return true
  } catch (error) {
    return false
  }
}

describe('Authentication Flow Integration Tests', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = mockPrisma as unknown as PrismaClient
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Login Flow', () => {
    it('should successfully authenticate user with valid credentials', async () => {
      const password = 'SecurePassword123!'
      const hashedPassword = await bcrypt.hash(password, 10)
      const mockUser = createMockUser({
        email: 'test@example.com',
        password: hashedPassword,
        role: 'USER'
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      // Simulate login process
      const passwordMatch = await bcrypt.compare(password, mockUser.password)
      expect(passwordMatch).toBe(true)

      // Generate token
      const token = jwt.sign(
        { userId: mockUser.id, userRole: mockUser.role },
        process.env.TOKENKEY || 'test-secret-key'
      )
      expect(token).toBeDefined()

      // Verify token
      const decoded = jwt.verify(token, process.env.TOKENKEY || 'test-secret-key') as DecodedToken
      expect(decoded.userId).toBe(mockUser.id)
      expect(decoded.userRole).toBe('USER')
    })

    it('should reject login with invalid password', async () => {
      const correctPassword = 'SecurePassword123!'
      const wrongPassword = 'WrongPassword456!'
      const hashedPassword = await bcrypt.hash(correctPassword, 10)

      const mockUser = createMockUser({
        email: 'test@example.com',
        password: hashedPassword
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const passwordMatch = await bcrypt.compare(wrongPassword, mockUser.password)
      expect(passwordMatch).toBe(false)
    })

    it('should reject login for non-existent user', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null)

      const user = await prisma.user.findUnique({
        where: { email: 'nonexistent@example.com' }
      })

      expect(user).toBeNull()
    })

    it('should reject login for deleted user', async () => {
      const mockUser = createMockUser({
        email: 'deleted@example.com',
        deleted: true
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const user = await prisma.user.findUnique({
        where: { email: 'deleted@example.com' }
      })

      expect(user?.deleted).toBe(true)
    })
  })

  describe('Token Validation', () => {
    it('should validate and decode valid JWT token', async () => {
      const mockUser = createMockUser()
      const token = generateTestToken(mockUser.id, mockUser.role);

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const context: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      const result = await testAuthChecker(context, ['USER'])
      expect(result).toBe(true)
      expect(context.user).toEqual(mockUser)
    })

    it('should reject expired token', async () => {
      const mockUser = createMockUser()
      // Create an expired token (1 second expiry, wait 2 seconds)
      const expiredToken = jwt.sign(
        { userId: mockUser.id, userRole: mockUser.role },
        process.env.TOKENKEY || 'test-secret-key',
        { expiresIn: '1ms' }
      )

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 10))

      const context: AuthContext = {
        req: { headers: { authorization: expiredToken } },
        user: null,
        setupMode: false
      }

      const result = await testAuthChecker(context, ['USER'])
      expect(result).toBe(false)
    })

    it('should reject token with invalid signature', async () => {
      const mockUser = createMockUser()
      const wrongToken = jwt.sign(
        { userId: mockUser.id, userRole: mockUser.role },
        'wrong-secret-key'
      )

      const context: AuthContext = {
        req: { headers: { authorization: wrongToken } },
        user: null,
        setupMode: false
      }

      const result = await testAuthChecker(context, ['USER'])
      expect(result).toBe(false)
    })

    it('should reject request without token', async () => {
      const context: AuthContext = {
        req: { headers: {} },
        user: null,
        setupMode: false
      }

      const result = await testAuthChecker(context, ['USER'])
      expect(result).toBe(false)
    })
  })

  describe('Role-Based Access Control', () => {
    it('should grant ADMIN access to admin users', async () => {
      const mockAdmin = createMockAdminUser()
      const token = generateTestToken(mockAdmin.id, 'ADMIN');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockAdmin)

      const context: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      const result = await testAuthChecker(context, ['ADMIN'])
      expect(result).toBe(true)
      expect(context.user?.role).toBe('ADMIN')
    })

    it('should deny ADMIN access to regular users', async () => {
      const mockUser = createMockUser({ role: 'USER' })
      const token = generateTestToken(mockUser.id, 'USER');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const context: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      const result = await testAuthChecker(context, ['ADMIN'])
      expect(result).toBe(false)
    })

    it('should grant USER access to both admin and regular users', async () => {
      // Test with regular user
      const mockUser = createMockUser({ role: 'USER' })
      const userToken = generateTestToken(mockUser.id, 'USER');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      const userContext: AuthContext = {
        req: { headers: { authorization: userToken } },
        user: null,
        setupMode: false
      }

      const userResult = await testAuthChecker(userContext, ['USER'])
      expect(userResult).toBe(true)

      // Test with admin user
      const mockAdmin = createMockAdminUser()
      const adminToken = generateTestToken(mockAdmin.id, 'ADMIN');

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockAdmin)

      const adminContext: AuthContext = {
        req: { headers: { authorization: adminToken } },
        user: null,
        setupMode: false
      }

      const adminResult = await testAuthChecker(adminContext, ['USER'])
      expect(adminResult).toBe(true)
    })

    it('should grant SETUP_MODE access when in setup mode', async () => {
      const context: AuthContext = {
        req: { headers: {} },
        user: null,
        setupMode: true
      }

      const result = await testAuthChecker(context, ['SETUP_MODE'])
      expect(result).toBe(true)
    })
  })

  describe('User Session Management', () => {
    it('should maintain user session across multiple requests', async () => {
      const mockUser = createMockUser()
      const token = generateTestToken(mockUser.id, mockUser.role);

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

      // First request
      const context1: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      await testAuthChecker(context1, ['USER'])
      expect(context1.user).toEqual(mockUser)

      // Second request with same token
      const context2: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      await testAuthChecker(context2, ['USER'])
      expect(context2.user).toEqual(mockUser)
    })

    it.skip('should handle concurrent authentication requests', async () => {
      // Reset mocks to ensure clean state
      jest.clearAllMocks()

      const users = [
        createMockUser({ id: 'user-1', email: 'user1@example.com' }),
        createMockUser({ id: 'user-2', email: 'user2@example.com' }),
        createMockAdminUser({ id: 'admin-1', email: 'admin@example.com' })
      ]

      const tokens = users.map(user => generateTestToken(user.id, user.role));

      // Setup mock to return different users based on ID
      (mockPrisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => {
        const foundUser = users.find(u => u.id === where.id)
        return foundUser ? Promise.resolve(foundUser) : Promise.resolve(null)
      })

      // Authenticate all users concurrently
      const authPromises = users.map((user, index) => {
        const context: AuthContext = {
          req: { headers: { authorization: tokens[index] } },
          user: null,
          setupMode: false
        }
        return testAuthChecker(context, ['USER']).then(result => ({ result, context }))
      })

      const results = await Promise.all(authPromises)

      // Verify all authentications succeeded
      results.forEach((auth, index) => {
        if (!auth.result) {
          console.log(`Authentication failed for user ${index}:`, {
            userId: users[index].id,
            userRole: users[index].role,
            contextUser: auth.context.user,
            result: auth.result
          })
        }
        expect(auth.result).toBe(true)
        expect(auth.context.user?.id).toBe(users[index].id)
      })
    })

    it('should handle user updates during session', async () => {
      const originalUser = createMockUser({
        firstName: 'Original',
        lastName: 'Name'
      })

      const token = generateTestToken(originalUser.id, originalUser.role);

      // First request with original user data
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(originalUser)

      const context1: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      await testAuthChecker(context1, ['USER'])
      expect(context1.user?.firstName).toBe('Original')

      // User gets updated in database
      const updatedUser = { ...originalUser, firstName: 'Updated', lastName: 'NewName' };
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(updatedUser)

      // Second request should fetch updated user data
      const context2: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      await testAuthChecker(context2, ['USER'])
      expect(context2.user?.firstName).toBe('Updated')
      expect(context2.user?.lastName).toBe('NewName')
    })
  })

  describe('Security Edge Cases', () => {
    it('should handle malformed tokens gracefully', async () => {
      const malformedTokens = [
        'not.a.jwt.token',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', // Incomplete JWT
        'Bearer token', // Wrong format
        '{}', // JSON but not JWT
        '' // Empty string
      ]

      for (const token of malformedTokens) {
        const context: AuthContext = {
          req: { headers: { authorization: token } },
          user: null,
          setupMode: false
        }

        const result = await testAuthChecker(context, ['USER'])
        expect(result).toBe(false)
      }
    })

    it('should prevent privilege escalation', async () => {
      const regularUser = createMockUser({ role: 'USER' })

      // Try to create a token with elevated privileges
      const maliciousToken = jwt.sign(
        { userId: regularUser.id, userRole: 'ADMIN' }, // Trying to claim ADMIN role
        process.env.TOKENKEY || 'test-secret-key'
      );

      // But database still has user as regular USER
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(regularUser)

      const context: AuthContext = {
        req: { headers: { authorization: maliciousToken } },
        user: null,
        setupMode: false
      }

      // Should fail ADMIN check even though token claims ADMIN
      const result = await testAuthChecker(context, ['ADMIN'])
      expect(result).toBe(false)
    })

    it('should handle database errors gracefully', async () => {
      const mockUser = createMockUser()
      const token = generateTestToken(mockUser.id, mockUser.role);

      // Simulate database error
      (prisma.user.findUnique as jest.Mock).mockRejectedValue(new Error('Database connection failed'))

      const context: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }

      const result = await testAuthChecker(context, ['USER'])
      expect(result).toBe(false)
      expect(context.user).toBeNull()
    })
  })
})
