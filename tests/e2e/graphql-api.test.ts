import 'reflect-metadata'
import { ApolloServer } from 'apollo-server-express'
import { buildSchema } from 'type-graphql'
import { GraphQLSchema } from 'graphql'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { createServer, Server } from 'http'
import { authChecker } from '@utils/authChecker'
import { InfinibayContext } from '@utils/context'
import {
  createMockUser,
  createMockAdminUser,
  createMockMachine,
  createMockMachineTemplate,
  createMockDepartment,
  createMockApplication,
  generateId
} from '../setup/mock-factories'
import {
  createMockContext,
  createAdminContext,
  createUserContext,
  createUnauthenticatedContext,
  executeGraphQL,
  TestQueries,
  TestMutations
} from '../setup/test-helpers'
import { mockPrisma } from '../setup/jest.setup'

// Import resolvers
import { UserResolver } from '@graphql/resolvers/user/resolver'
import { MachineQueries, MachineMutations } from '@graphql/resolvers/machine/resolver'
import { DepartmentResolver } from '@graphql/resolvers/department/resolver'
import { MachineTemplateResolver } from '@graphql/resolvers/machine_template/resolver'

// Mock EventManager
jest.mock('@services/EventManager', () => ({
  getEventManager: jest.fn(() => ({
    dispatchEvent: jest.fn().mockResolvedValue(true),
    subscribe: jest.fn(),
    unsubscribe: jest.fn()
  }))
}))

// Mock MachineLifecycleService
jest.mock('@services/machineLifecycleService')

// Mock libvirt-node
jest.mock('libvirt-node')

// Mock authChecker to avoid database connection
jest.mock('@utils/authChecker', () => ({
  authChecker: jest.fn().mockImplementation(async ({ context }, roles) => {
    // Allow all operations in tests
    if (context.user) {
      return true
    }
    // Allow unauthenticated operations like login
    if (roles.length === 0) {
      return true
    }
    return false
  })
}))

// Mock database to prevent connection attempts
jest.mock('@utils/database', () => mockPrisma)

// Define partial context type for testing
interface TestContext {
  req?: Partial<express.Request> & { headers?: { authorization?: string } }
  prisma: typeof mockPrisma
  user: InfinibayContext['user'] | null
  setupMode: boolean
}

describe('E2E GraphQL API Tests', () => {
  let apolloServer: ApolloServer
  let schema: GraphQLSchema
  let prisma: typeof mockPrisma
  let app: express.Application
  let httpServer: Server

  beforeAll(async () => {
    prisma = mockPrisma

    // Build GraphQL schema
    schema = await buildSchema({
      resolvers: [
        UserResolver,
        MachineQueries,
        MachineMutations,
        DepartmentResolver,
        MachineTemplateResolver
      ],
      authChecker,
      validate: false
    })

    // Setup Express app
    app = express()
    app.use(express.json())

    // Create Apollo Server
    apolloServer = new ApolloServer({
      schema,
      context: ({ req }): InfinibayContext => ({
        req: req as express.Request,
        res: {} as express.Response,
        prisma,
        user: null,
        setupMode: false
      }),
      formatError: (error) => {
        console.error('GraphQL Error:', error)
        return error
      }
    })

    await apolloServer.start()
    apolloServer.applyMiddleware({ app: app as never, path: '/graphql' })

    // Create HTTP server
    httpServer = createServer(app)
  })

  afterAll(async () => {
    await apolloServer.stop()
    if (httpServer) {
      httpServer.close()
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Authentication', () => {
    describe('Login', () => {
      it('should successfully login with valid credentials', async () => {
        const password = 'validPassword123'
        const hashedPassword = await bcrypt.hash(password, 10)
        const mockUser = createMockUser({ password: hashedPassword })

        mockPrisma.user.findFirst.mockResolvedValue(mockUser)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.LOGIN,
          variables: { email: mockUser.email, password },
          context: createUnauthenticatedContext()
        })

        expect(result.errors).toBeUndefined()
        expect((result.data?.login as { token?: string })?.token).toBeDefined()

        const token = jwt.verify(
          (result.data?.login as { token: string }).token,
          process.env.TOKENKEY || 'test-secret'
        ) as { userId: string }

        expect(token.userId).toBe(mockUser.id)
      })

      it('should fail login with invalid credentials', async () => {
        const mockUser = createMockUser({ password: 'hashedPassword' })
        mockPrisma.user.findFirst.mockResolvedValue(mockUser)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.LOGIN,
          variables: { email: mockUser.email, password: 'wrongPassword' },
          context: createUnauthenticatedContext()
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Invalid credentials')
      })
    })

    describe('Protected Queries', () => {
      it('should access protected query with valid token', async () => {
        const mockUser = createMockUser()
        const token = `Bearer ${jwt.sign({ userId: mockUser.id }, process.env.TOKENKEY || 'test-secret')}`

        mockPrisma.user.findUnique.mockResolvedValue(mockUser)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.CURRENT_USER,
          variables: undefined,
          context: createMockContext(mockUser, token)
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.currentUser).toMatchObject({
          id: mockUser.id,
          email: mockUser.email
        })
      })

      it('should reject protected query without token', async () => {
        const result = await executeGraphQL({
          schema,
          query: TestQueries.CURRENT_USER,
          context: createMockContext()
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Access denied')
      })
    })
  })

  describe('User Operations', () => {
    describe('Queries', () => {
      it('should get current user', async () => {
        const mockUser = createMockUser()

        const result = await executeGraphQL({
          schema,
          query: TestQueries.CURRENT_USER,
          context: createMockContext(mockUser, 'admin-token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.currentUser).toMatchObject({
          id: mockUser.id,
          email: mockUser.email
        })
      })

      it('should list all users (admin only)', async () => {
        const adminUser = createMockAdminUser()
        const mockUsers = [
          createMockUser({ id: 'user-1' }),
          createMockUser({ id: 'user-2' }),
          createMockUser({ id: 'user-3' })
        ]

        mockPrisma.user.findMany.mockResolvedValue(mockUsers)
        mockPrisma.user.count.mockResolvedValue(mockUsers.length)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.USERS,
          variables: { pagination: { take: 10, skip: 0 } },
          context: createMockContext(adminUser, 'user-token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.users).toMatchObject({
          users: expect.arrayContaining(mockUsers.map(u => ({
            id: u.id,
            email: u.email
          }))),
          total: mockUsers.length
        })
      })
    })

    describe('Mutations', () => {
      it('should update user profile', async () => {
        const mockUser = createMockUser()
        const updates = {
          firstName: 'Updated',
          lastName: 'Name'
        }

        mockPrisma.user.update.mockResolvedValue({
          ...mockUser,
          ...updates
        })

        const result = await executeGraphQL({
          schema,
          query: TestMutations.UPDATE_USER,
          variables: { input: updates },
          context: createMockContext(mockUser, 'admin-token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.updateUser).toMatchObject(updates)
      })

      it('should delete user (admin only)', async () => {
        const adminUser = createMockAdminUser()
        const userToDelete = createMockUser({ id: 'user-to-delete' })

        mockPrisma.user.findUnique.mockResolvedValue(userToDelete)
        mockPrisma.user.update.mockResolvedValue({
          ...userToDelete,
          deleted: true
        })

        const result = await executeGraphQL({
          schema,
          query: TestMutations.DELETE_USER,
          variables: { id: userToDelete.id },
          context: createMockContext(adminUser, 'admin-token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.deleteUser).toMatchObject({
          success: true
        })
      })
    })
  })

  describe('Machine Operations', () => {
    describe('Queries', () => {
      it('should get machine by id', async () => {
        const mockMachine = createMockMachine()
        const mockTemplate = createMockMachineTemplate()
        const mockDepartment = createMockDepartment()
        const mockUser = createMockUser()

        mockPrisma.machine.findUnique.mockResolvedValue({
          ...mockMachine,
          templateId: mockTemplate.id,
          departmentId: mockDepartment.id,
          userId: mockUser.id
        })

        const result = await executeGraphQL({
          schema,
          query: TestQueries.MACHINE,
          variables: { id: mockMachine.id },
          context: createMockContext(mockUser, 'user-token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.machine).toMatchObject({
          id: mockMachine.id,
          name: mockMachine.name,
          status: mockMachine.status
        })
      })

      it('should list machines with filters', async () => {
        const mockMachines = [
          createMockMachine({ id: 'machine-1', status: 'running' }),
          createMockMachine({ id: 'machine-2', status: 'running' }),
          createMockMachine({ id: 'machine-3', status: 'stopped' })
        ]

        mockPrisma.machine.findMany.mockResolvedValue(mockMachines.filter(m => m.status === 'running'))
        mockPrisma.machine.count.mockResolvedValue(2)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.MACHINES,
          variables: {
            pagination: { take: 10, skip: 0 },
            filter: { status: 'running' }
          },
          context: createUserContext()
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.machines).toMatchObject({
          total: 2,
          machines: expect.arrayContaining([
            expect.objectContaining({ status: 'running' })
          ])
        })
        expect((result.data?.machines as { machines: { status: string }[] }).machines.every((m: { status: string }) =>
          m.status === 'running'
        )).toBe(true)
      })
    })

    describe('Mutations', () => {
      it('should create machine', async () => {
        const mockTemplate = createMockMachineTemplate()
        const mockDepartment = createMockDepartment()
        const mockUser = createMockUser()
        const mockMachine = createMockMachine({ templateId: mockTemplate.id })

        mockPrisma.machineTemplate.findUnique.mockResolvedValue(mockTemplate)
        mockPrisma.department.findFirst.mockResolvedValue(mockDepartment)
        mockPrisma.machine.create.mockResolvedValue(mockMachine)

        const result = await executeGraphQL({
          schema,
          query: TestMutations.CREATE_MACHINE,
          variables: {
            input: {
              name: 'Test Machine',
              templateId: mockTemplate.id,
              os: 'Ubuntu 20.04',
              applications: []
            }
          },
          context: createMockContext(mockUser, 'admin-token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createMachine).toMatchObject({
          id: mockMachine.id,
          name: mockMachine.name
        })
      })

      it('should destroy machine', async () => {
        const mockUser = createMockUser()
        const mockMachine = createMockMachine({ userId: mockUser.id })

        mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)

        const result = await executeGraphQL({
          schema,
          query: TestMutations.DESTROY_MACHINE,
          variables: { id: mockMachine.id },
          context: createUnauthenticatedContext()
        })

        // Should fail without authentication
        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Access denied')
      })
    })
  })

  describe('Department Operations', () => {
    describe('Queries', () => {
      it('should get department by id', async () => {
        const mockDepartment = createMockDepartment()
        const mockMachines = [
          createMockMachine({ departmentId: mockDepartment.id }),
          createMockMachine({ departmentId: mockDepartment.id })
        ]

        mockPrisma.department.findUnique.mockResolvedValue(mockDepartment)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.DEPARTMENT,
          variables: { id: mockDepartment.id },
          context: createAdminContext()
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.department).toMatchObject({
          id: mockDepartment.id,
          name: mockDepartment.name
        })
      })

      it('should list departments', async () => {
        const mockDepartments = [
          createMockDepartment({ id: 'dept-1', name: 'Engineering' }),
          createMockDepartment({ id: 'dept-2', name: 'Marketing' }),
          createMockDepartment({ id: 'dept-3', name: 'Sales' })
        ]

        mockPrisma.department.findMany.mockResolvedValue(mockDepartments)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.DEPARTMENTS,
          context: createUserContext()
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.departments).toHaveLength(mockDepartments.length)
        expect(result.data?.departments).toEqual(
          expect.arrayContaining(
            mockDepartments.map(d => ({
              id: d.id,
              name: d.name
            }))
          )
        )
      })
    })

    describe('Mutations', () => {
      it('should create department (admin only)', async () => {
        const adminUser = createMockAdminUser()
        const newDepartment = createMockDepartment({ name: 'New Department' })

        mockPrisma.department.create.mockResolvedValue(newDepartment)

        const result = await executeGraphQL({
          schema,
          query: TestMutations.CREATE_DEPARTMENT,
          variables: {
            input: {
              name: newDepartment.name,
              ipSubnet: '192.168.1.0/24'
            }
          },
          context: createMockContext(adminUser, 'token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createDepartment).toMatchObject({
          id: newDepartment.id,
          name: newDepartment.name
        })
      })

      it('should reject department creation for non-admin', async () => {
        const regularUser = createMockUser()

        const result = await executeGraphQL({
          schema,
          query: TestMutations.CREATE_DEPARTMENT,
          variables: {
            input: {
              name: 'Unauthorized Department',
              ipSubnet: '192.168.2.0/24'
            }
          },
          context: createUnauthenticatedContext()
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Access denied')
      })

      it('should delete department (admin only)', async () => {
        const adminUser = createMockAdminUser()
        const departmentToDelete = createMockDepartment()

        mockPrisma.department.findUnique.mockResolvedValue(departmentToDelete)
        mockPrisma.department.delete.mockResolvedValue(departmentToDelete)

        const result = await executeGraphQL({
          schema,
          query: TestMutations.DELETE_DEPARTMENT,
          variables: { id: departmentToDelete.id },
          context: createMockContext(adminUser, 'admin-token')
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.deleteDepartment).toMatchObject({
          success: true
        })
      })
    })
  })

  describe('Machine Template Operations', () => {
    describe('Queries', () => {
      it('should list machine templates', async () => {
        const mockTemplates = [
          createMockMachineTemplate({ id: 'template-1', name: 'Ubuntu Template' }),
          createMockMachineTemplate({ id: 'template-2', name: 'Windows Template' })
        ]

        mockPrisma.machineTemplate.findMany.mockResolvedValue(mockTemplates)
        mockPrisma.machineTemplate.count.mockResolvedValue(mockTemplates.length)

        const result = await executeGraphQL({
          schema,
          query: TestQueries.MACHINE_TEMPLATES,
          variables: { pagination: { take: 10, skip: 0 } },
          context: createUserContext()
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.machineTemplates).toMatchObject({
          templates: expect.arrayContaining(
            mockTemplates.map(t => ({
              id: t.id,
              name: t.name
            }))
          ),
          total: mockTemplates.length
        })
      })
    })
  })
})
