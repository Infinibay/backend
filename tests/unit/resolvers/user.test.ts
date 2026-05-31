import 'reflect-metadata'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { UserResolver } from '@graphql/resolvers/user/resolver'
import { InfinibayContext } from '@utils/context'
import { UserInputError } from '@utils/errors'
import { OrderByDirection } from '@utils/pagination'
import { UserOrderByField, UserRole } from '@graphql/resolvers/user/type'
import type { CreateUserInputType, UpdateUserInputType } from '@graphql/resolvers/user/type'
import { testPrisma } from '../../setup/jest.setup'
import { createUser, createAdmin } from '../../setup/db-factories'

/**
 * UserResolver tests — real database.
 *
 * UserResolver instantiates `new PrismaClient()` directly per call, which
 * connects to DATABASE_URL from the env. Under `.env.test` that resolves to
 * the test DB — the same one `testPrisma.prisma` is talking to. We seed
 * through testPrisma and read results back through the resolver.
 */
describe('UserResolver — real database', () => {
  const prisma = testPrisma.prisma
  let resolver: UserResolver
  let adminContext: InfinibayContext

  beforeEach(async () => {
    resolver = new UserResolver()
    const admin = await createAdmin(prisma)
    adminContext = {
      prisma,
      user: admin,
      req: {} as any,
      res: {} as any,
      setupMode: false,
    } as unknown as InfinibayContext
  })

  describe('currentUser', () => {
    it('returns the user from context with a namespace', async () => {
      const contextUser = await createUser(prisma)
      const ctx = { ...adminContext, user: contextUser } as InfinibayContext

      const result = await resolver.currentUser(ctx)

      expect(result).toBeTruthy()
      expect(result?.id).toBe(contextUser.id)
      expect(result?.namespace).toBe(`user_${contextUser.id.substring(0, 8)}`)
    })

    it('returns null when the context has no user', async () => {
      const ctx = { ...adminContext, user: null } as InfinibayContext
      expect(await resolver.currentUser(ctx)).toBeNull()
    })
  })

  describe('user(id)', () => {
    it('returns a user by id', async () => {
      const target = await createUser(prisma)
      const result = await resolver.user(target.id, adminContext)
      expect(result).not.toBeNull()
      expect(result?.id).toBe(target.id)
      expect(result?.email).toBe(target.email)
    })

    it('returns null when the id is unknown', async () => {
      expect(await resolver.user('non-existent-id', adminContext)).toBeNull()
    })
  })

  describe('users(orderBy, pagination)', () => {
    it('returns users ordered by createdAt desc with pagination', async () => {
      const users = [] as Array<Awaited<ReturnType<typeof createUser>>>
      for (let i = 0; i < 6; i++) {
        users.push(await createUser(prisma, { email: `paginate-${i}-${Date.now()}@test.infinibay` }))
      }

      const result = await resolver.users(
        { fieldName: UserOrderByField.CREATED_AT, direction: OrderByDirection.DESC },
        { take: 3, skip: 0 },
        adminContext
      )

      expect(result).toHaveLength(3)
      // Most-recently created first — the 6 seeded users + 1 admin from beforeEach.
      // Just verify the ordering is respected (descending createdAt).
      for (let i = 0; i < result.length - 1; i++) {
        expect(result[i].createdAt.getTime())
          .toBeGreaterThanOrEqual(result[i + 1].createdAt.getTime())
      }
    })

    it('returns an empty array when pagination skips past all rows', async () => {
      const result = await resolver.users(
        { fieldName: UserOrderByField.EMAIL, direction: OrderByDirection.ASC },
        { take: 10, skip: 10_000 },
        adminContext
      )
      expect(result).toEqual([])
    })

    it('orders by email ascending when requested', async () => {
      await createUser(prisma, { email: 'aaa@test.infinibay' })
      await createUser(prisma, { email: 'zzz@test.infinibay' })

      const result = await resolver.users(
        { fieldName: UserOrderByField.EMAIL, direction: OrderByDirection.ASC },
        { take: 100, skip: 0 },
        adminContext
      )

      const emails = result.map(u => u.email)
      const sorted = [...emails].sort()
      expect(emails).toEqual(sorted)
    })
  })

  describe('login', () => {
    it('returns a JWT token on correct credentials', async () => {
      const password = 'password123'
      const user = await createUser(prisma, { password: bcrypt.hashSync(password, 4) })

      const result = await resolver.login(user.email, password)
      expect(result).not.toBeNull()
      expect(result?.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)

      const decoded = jwt.verify(result!.token, process.env.TOKENKEY ?? 'secret') as any
      expect(decoded.userId).toBe(user.id)
    })

    it('throws for an unknown email', async () => {
      await expect(resolver.login('no-such-user@test.infinibay', 'password'))
        .rejects.toThrow('Invalid credentials')
    })

    it('throws for an incorrect password', async () => {
      const user = await createUser(prisma, { password: bcrypt.hashSync('correct', 4) })
      await expect(resolver.login(user.email, 'wrong-password'))
        .rejects.toThrow('Invalid credentials')
    })

    it('rejects soft-deleted users', async () => {
      const password = 'password'
      const user = await createUser(prisma, {
        deleted: true,
        password: bcrypt.hashSync(password, 4)
      })

      await expect(resolver.login(user.email, password))
        .rejects.toThrow('Invalid credentials')
    })
  })

  describe('createUser', () => {
    it('creates a new user with a hashed password', async () => {
      const input: CreateUserInputType = {
        email: `new-${Date.now()}@test.infinibay`,
        password: 'plainpw123',
        passwordConfirmation: 'plainpw123',
        firstName: 'New',
        lastName: 'User',
        role: UserRole.USER,
      }

      const result = await resolver.createUser(input, adminContext)

      expect(result.email).toBe(input.email)
      expect(result.firstName).toBe('New')

      const stored = await prisma.user.findUnique({ where: { email: input.email } })
      expect(stored).not.toBeNull()
      expect(stored!.password).not.toBe('plainpw123')
      expect(await bcrypt.compare('plainpw123', stored!.password)).toBe(true)
    })

    it('throws UserInputError if the email is already taken', async () => {
      const existing = await createUser(prisma)
      const input: CreateUserInputType = {
        email: existing.email,
        password: 'x1x2x3x4',
        passwordConfirmation: 'x1x2x3x4',
        firstName: 'Dup',
        lastName: 'User',
        role: UserRole.USER,
      }
      await expect(resolver.createUser(input, adminContext)).rejects.toThrow(UserInputError)
    })

    it('does not validate email format (by design)', async () => {
      const input: CreateUserInputType = {
        email: `garbage-${Date.now()}`,
        password: 'plainpw123',
        passwordConfirmation: 'plainpw123',
        firstName: 'Weird',
        lastName: 'Email',
        role: UserRole.USER,
      }
      const result = await resolver.createUser(input, adminContext)
      expect(result.email).toBe(input.email)
    })

    it('rejects mismatched password confirmation', async () => {
      const input: CreateUserInputType = {
        email: `mismatch-${Date.now()}@test.infinibay`,
        password: '123',
        passwordConfirmation: '456',
        firstName: 'Mis',
        lastName: 'Match',
        role: UserRole.USER,
      }
      await expect(resolver.createUser(input, adminContext)).rejects.toThrow(UserInputError)
    })

    it('creates an admin user when role=ADMIN', async () => {
      const input: CreateUserInputType = {
        email: `admin-new-${Date.now()}@test.infinibay`,
        password: 'plainpw123',
        passwordConfirmation: 'plainpw123',
        firstName: 'Admin',
        lastName: 'New',
        role: UserRole.ADMIN,
      }
      const result = await resolver.createUser(input, adminContext)
      expect(result.role).toBe('ADMIN')
    })
  })

  describe('updateUser', () => {
    it('updates first/last name', async () => {
      const target = await createUser(prisma, { firstName: 'Old', lastName: 'Name' })

      await resolver.updateUser(
        target.id,
        { firstName: 'Updated', lastName: 'Name', password: undefined, passwordConfirmation: undefined, role: undefined },
        adminContext
      )

      const reloaded = await prisma.user.findUnique({ where: { id: target.id } })
      expect(reloaded?.firstName).toBe('Updated')
    })

    it('hashes the new password when provided', async () => {
      const target = await createUser(prisma)
      const newPassword = 'NewSecurePass123!'

      await resolver.updateUser(
        target.id,
        { firstName: undefined, lastName: undefined, password: newPassword, passwordConfirmation: newPassword, role: undefined },
        adminContext
      )

      const reloaded = await prisma.user.findUnique({ where: { id: target.id } })
      expect(reloaded?.password).not.toBe(newPassword)
      expect(await bcrypt.compare(newPassword, reloaded!.password)).toBe(true)
    })

    it('throws if the user does not exist', async () => {
      await expect(
        resolver.updateUser(
          'non-existent',
          { firstName: 'X', lastName: undefined, password: undefined, passwordConfirmation: undefined, role: undefined },
          adminContext
        )
      ).rejects.toThrow(UserInputError)
    })

    it('rejects mismatched password confirmation', async () => {
      const target = await createUser(prisma)
      await expect(
        resolver.updateUser(
          target.id,
          { firstName: undefined, lastName: undefined, password: 'A', passwordConfirmation: 'B', role: undefined },
          adminContext
        )
      ).rejects.toThrow(UserInputError)
    })

    it('allows an admin to promote a user to ADMIN', async () => {
      const target = await createUser(prisma, { role: 'USER' })

      const result = await resolver.updateUser(
        target.id,
        { firstName: undefined, lastName: undefined, password: undefined, passwordConfirmation: undefined, role: UserRole.ADMIN },
        adminContext
      )

      expect(result.role).toBe('ADMIN')
    })
  })
})
