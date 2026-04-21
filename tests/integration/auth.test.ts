import 'reflect-metadata'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import type { PrismaClient, User } from '@prisma/client'
import { generateTestToken } from '../setup/test-helpers'
import { testPrisma } from '../setup/jest.setup'
import { createUser, createAdmin } from '../setup/db-factories'

interface AuthContext {
  req: { headers: { authorization?: string } }
  user: User | null
  setupMode: boolean
}

interface DecodedToken {
  id: string
  role: string
  userId?: string
  userRole?: string
  iat?: number
  exp?: number
}

/**
 * Auth checker used across tests. Mirrors the production authChecker closely
 * enough to exercise the important branches (setup mode, token presence,
 * JWT verification, user lookup, deletion flag, role).
 */
async function testAuthChecker (
  prisma: PrismaClient,
  context: AuthContext,
  roles: string[]
): Promise<boolean> {
  if (context.setupMode && roles.includes('SETUP_MODE')) return true

  const token = context.req.headers.authorization
  if (!token) return false

  try {
    const decoded = jwt.verify(token, process.env.TOKENKEY || 'test-secret-key') as DecodedToken
    const tokenUserId = decoded.userId || decoded.id

    const user = await prisma.user.findUnique({ where: { id: tokenUserId } })
    if (!user || user.deleted) return false

    context.user = user

    if (roles.includes('ADMIN') && user.role !== 'ADMIN') return false
    return true
  } catch {
    return false
  }
}

describe('Authentication Flow — real database', () => {
  const prisma = testPrisma.prisma

  describe('Login Flow', () => {
    it('authenticates a user with a valid password', async () => {
      const plain = 'SecurePassword123!'
      const user = await createUser(prisma, {
        password: bcrypt.hashSync(plain, 4)
      })

      const found = await prisma.user.findUnique({ where: { email: user.email } })
      expect(found).not.toBeNull()
      expect(await bcrypt.compare(plain, found!.password)).toBe(true)

      const token = jwt.sign(
        { userId: user.id, userRole: user.role },
        process.env.TOKENKEY || 'test-secret-key'
      )
      const decoded = jwt.verify(token, process.env.TOKENKEY || 'test-secret-key') as DecodedToken
      expect(decoded.userId).toBe(user.id)
      expect(decoded.userRole).toBe(user.role)
    })

    it('rejects an incorrect password', async () => {
      const user = await createUser(prisma, {
        password: bcrypt.hashSync('CorrectPassword!', 4)
      })

      const found = await prisma.user.findUnique({ where: { email: user.email } })
      expect(await bcrypt.compare('WrongPassword!', found!.password)).toBe(false)
    })

    it('returns null for non-existent emails', async () => {
      expect(
        await prisma.user.findUnique({ where: { email: 'nobody@test.infinibay' } })
      ).toBeNull()
    })

    it('treats deleted users as absent from lookup', async () => {
      const user = await createUser(prisma, { deleted: true })
      const ctx: AuthContext = {
        req: { headers: { authorization: generateTestToken(user.id, user.role) } },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(false)
    })
  })

  describe('Token validation', () => {
    it('accepts a freshly-signed token and loads the user', async () => {
      const user = await createUser(prisma)
      const ctx: AuthContext = {
        req: { headers: { authorization: generateTestToken(user.id, user.role) } },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(true)
      expect(ctx.user?.id).toBe(user.id)
    })

    it('rejects an expired token', async () => {
      const user = await createUser(prisma)
      const expired = jwt.sign(
        { userId: user.id, userRole: user.role },
        process.env.TOKENKEY || 'test-secret-key',
        { expiresIn: '1ms' }
      )
      await new Promise(r => setTimeout(r, 10))

      const ctx: AuthContext = {
        req: { headers: { authorization: expired } },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(false)
    })

    it('rejects a token signed with a different secret', async () => {
      const user = await createUser(prisma)
      const wrong = jwt.sign({ userId: user.id, userRole: user.role }, 'wrong-secret-key')
      const ctx: AuthContext = {
        req: { headers: { authorization: wrong } },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(false)
    })

    it('rejects a request with no Authorization header', async () => {
      const ctx: AuthContext = {
        req: { headers: {} },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(false)
    })
  })

  describe('Role-based access', () => {
    it('grants ADMIN routes to admins', async () => {
      const admin = await createAdmin(prisma)
      const ctx: AuthContext = {
        req: { headers: { authorization: generateTestToken(admin.id, 'ADMIN') } },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['ADMIN'])).toBe(true)
      expect(ctx.user?.role).toBe('ADMIN')
    })

    it('denies ADMIN routes to regular users', async () => {
      const user = await createUser(prisma)
      const ctx: AuthContext = {
        req: { headers: { authorization: generateTestToken(user.id, 'USER') } },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['ADMIN'])).toBe(false)
    })

    it('grants USER routes to both roles', async () => {
      const user = await createUser(prisma)
      const admin = await createAdmin(prisma)

      for (const u of [user, admin]) {
        const ctx: AuthContext = {
          req: { headers: { authorization: generateTestToken(u.id, u.role) } },
          user: null,
          setupMode: false
        }
        expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(true)
      }
    })

    it('grants SETUP_MODE access even without a token when setupMode is on', async () => {
      const ctx: AuthContext = {
        req: { headers: {} },
        user: null,
        setupMode: true
      }
      expect(await testAuthChecker(prisma, ctx, ['SETUP_MODE'])).toBe(true)
    })
  })

  describe('Session behaviour', () => {
    it('reuses the same token across requests', async () => {
      const user = await createUser(prisma)
      const token = generateTestToken(user.id, user.role)

      for (let i = 0; i < 2; i++) {
        const ctx: AuthContext = {
          req: { headers: { authorization: token } },
          user: null,
          setupMode: false
        }
        expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(true)
        expect(ctx.user?.id).toBe(user.id)
      }
    })

    it('reflects a user update on the next request', async () => {
      const user = await createUser(prisma, { firstName: 'Original' })
      const token = generateTestToken(user.id, user.role)

      const ctx1: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }
      await testAuthChecker(prisma, ctx1, ['USER'])
      expect(ctx1.user?.firstName).toBe('Original')

      await prisma.user.update({
        where: { id: user.id },
        data: { firstName: 'Updated' }
      })

      const ctx2: AuthContext = {
        req: { headers: { authorization: token } },
        user: null,
        setupMode: false
      }
      await testAuthChecker(prisma, ctx2, ['USER'])
      expect(ctx2.user?.firstName).toBe('Updated')
    })

    it('handles concurrent requests from different users', async () => {
      const users = await Promise.all([
        createUser(prisma),
        createUser(prisma),
        createAdmin(prisma)
      ])

      const results = await Promise.all(users.map(u => {
        const ctx: AuthContext = {
          req: { headers: { authorization: generateTestToken(u.id, u.role) } },
          user: null,
          setupMode: false
        }
        return testAuthChecker(prisma, ctx, ['USER']).then(ok => ({ ok, ctx, u }))
      }))

      for (const { ok, ctx, u } of results) {
        expect(ok).toBe(true)
        expect(ctx.user?.id).toBe(u.id)
      }
    })
  })

  describe('Security edge cases', () => {
    it('rejects malformed authorization headers', async () => {
      const malformed = ['not.a.jwt.token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'Bearer token', '{}', '']
      for (const token of malformed) {
        const ctx: AuthContext = {
          req: { headers: { authorization: token } },
          user: null,
          setupMode: false
        }
        expect(await testAuthChecker(prisma, ctx, ['USER'])).toBe(false)
      }
    })

    it('prevents privilege escalation via forged role in token', async () => {
      const user = await createUser(prisma, { role: 'USER' })
      // A client that forges userRole=ADMIN in their JWT payload — the auth
      // checker must look up the real role from the DB, not trust the token.
      const forged = jwt.sign(
        { userId: user.id, userRole: 'ADMIN' },
        process.env.TOKENKEY || 'test-secret-key'
      )
      const ctx: AuthContext = {
        req: { headers: { authorization: forged } },
        user: null,
        setupMode: false
      }
      expect(await testAuthChecker(prisma, ctx, ['ADMIN'])).toBe(false)
    })
  })
})
