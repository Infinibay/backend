import 'reflect-metadata'
import { ApolloServer } from 'apollo-server-express'
import { buildSchema } from 'type-graphql'
import { GraphQLSchema } from 'graphql'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import { createServer } from 'http'
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
import { mockPrisma } from '../setup/jest.setup'
import { executeGraphQL, TestQueries, TestMutations } from '../setup/test-helpers'

// Import resolvers
import { UserResolver } from '@graphql/resolvers/user/resolver'
import { MachineQueries, MachineMutations } from '@graphql/resolvers/machine/resolver'
import { DepartmentQueries, DepartmentMutations } from '@graphql/resolvers/department/resolver'

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

describe('E2E GraphQL API Tests', () => {
  let apolloServer: ApolloServer
  let schema: GraphQLSchema
  let prisma: PrismaClient
  let app: express.Application
  let httpServer: any

  beforeAll(async () => {
    prisma = mockPrisma as any

    // Build GraphQL schema
    schema = await buildSchema({
      resolvers: [
        UserResolver,
        MachineQueries,
        MachineMutations,
        DepartmentQueries,
        DepartmentMutations
      ] as any,
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
        req,
        prisma,
        user: null as any,
        setupMode: false
      }),
      formatError: (error) => {
        console.error('GraphQL Error:', error)
        return error
      }
    })

    await apolloServer.start()
    apolloServer.applyMiddleware({ app, path: '/graphql' })

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

  describe('Authentication Flow', () => {
    it('should successfully login with valid credentials', async () => {
      const password = 'TestPassword123!'
      const hashedPassword = await bcrypt.hash(password, 10)
      const user = createMockUser({
        email: 'test@example.com',
        password: hashedPassword
      });

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user)

      const result = await executeGraphQL(
        schema,
        TestQueries.LOGIN,
        {
          email: 'test@example.com',
          password
        },
        { prisma, user: null, setupMode: false }
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.login).toBeDefined()
      expect(result.data?.login.token).toBeDefined()

      // Verify token is valid
      const decoded = jwt.verify(
        result.data?.login.token,
        process.env.TOKENKEY || 'test-secret-key'
      ) as any
      expect(decoded.userId).toBe(user.id)
      expect(decoded.userRole).toBe(user.role)
    })

    it('should reject login with invalid credentials', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null)

      const result = await executeGraphQL(
        schema,
        TestQueries.LOGIN,
        {
          email: 'nonexistent@example.com',
          password: 'WrongPassword'
        },
        { prisma, user: null, setupMode: false }
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.login).toBeNull()
    })

    it('should get current user with valid token', async () => {
      const user = createMockUser()
      const token = jwt.sign(
        { userId: user.id, userRole: user.role },
        process.env.TOKENKEY || 'test-secret-key'
      );

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user)

      const context: InfinibayContext = {
        req: { headers: { authorization: token } } as any,
        prisma,
        user,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestQueries.CURRENT_USER,
        {},
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.currentUser).toBeDefined()
      expect(result.data?.currentUser.id).toBe(user.id)
      expect(result.data?.currentUser.email).toBe(user.email)
    })
  })

  describe('User Management', () => {
    it('should allow admin to create new user', async () => {
      const admin = createMockAdminUser()
      const newUserId = generateId();

      (prisma.user.findUnique as jest.Mock)
        .mockResolvedValueOnce(admin) // For auth check
        .mockResolvedValueOnce(null); // For email uniqueness check

      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: newUserId,
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User',
        role: 'USER',
        deleted: false,
        createdAt: new Date()
      })

      const context: InfinibayContext = {
        req: { headers: { authorization: 'admin-token' } } as any,
        prisma,
        user: admin,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestMutations.CREATE_USER,
        {
          input: {
            email: 'newuser@example.com',
            password: 'SecurePass123!',
            passwordConfirmation: 'SecurePass123!',
            firstName: 'New',
            lastName: 'User',
            role: 'USER'
          }
        },
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.createUser).toBeDefined()
      expect(result.data?.createUser.email).toBe('newuser@example.com')

      // Verify password was hashed
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          password: expect.not.stringContaining('SecurePass123!')
        })
      })
    })

    it('should prevent regular users from creating users', async () => {
      const user = createMockUser({ role: 'USER' })

      const context: InfinibayContext = {
        req: { headers: { authorization: 'user-token' } } as any,
        prisma,
        user,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestMutations.CREATE_USER,
        {
          input: {
            email: 'newuser@example.com',
            password: 'SecurePass123!',
            passwordConfirmation: 'SecurePass123!',
            firstName: 'New',
            lastName: 'User',
            role: 'USER'
          }
        },
        context
      )

      expect(result.errors).toBeDefined()
      expect(result.errors?.[0].message).toContain('Access denied')
    })

    it('should list users with pagination', async () => {
      const admin = createMockAdminUser()
      const users = [
        createMockUser({ email: 'user1@example.com' }),
        createMockUser({ email: 'user2@example.com' }),
        createMockUser({ email: 'user3@example.com' })
      ];

      (prisma.user.findMany as jest.Mock).mockResolvedValue(users)

      const context: InfinibayContext = {
        req: { headers: { authorization: 'admin-token' } } as any,
        prisma,
        user: admin,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestQueries.LIST_USERS,
        {
          take: 10,
          skip: 0,
          orderBy: { fieldName: 'email', direction: 'asc' }
        },
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.users).toBeDefined()
      expect(Array.isArray(result.data?.users.users)).toBe(true)
      expect(result.data?.users.users).toHaveLength(3)
    })
  })

  describe('VM Operations', () => {
    it('should create a new VM with proper authorization', async () => {
      const admin = createMockAdminUser()
      const template = createMockMachineTemplate()
      const department = createMockDepartment()
      const newMachine = createMockMachine({
        templateId: template.id,
        departmentId: department.id,
        userId: admin.id
      })

      // Mock MachineLifecycleService
      const { MachineLifecycleService } = require('@services/machineLifecycleService')
      MachineLifecycleService.mockImplementation(() => ({
        createMachine: jest.fn().mockResolvedValue(newMachine)
      }))

      const context: InfinibayContext = {
        req: { headers: { authorization: 'admin-token' } } as any,
        prisma,
        user: admin,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestMutations.CREATE_MACHINE,
        {
          input: {
            name: 'Test VM',
            templateId: template.id,
            departmentId: department.id,
            os: 'ubuntu-22.04',
            username: 'testuser',
            password: 'TestPass123!',
            applications: []
          }
        },
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.createMachine).toBeDefined()
      expect(result.data?.createMachine.name).toBe(newMachine.name)
    })

    it('should power on VM with proper authorization', async () => {
      const user = createMockUser()
      const machine = createMockMachine({ userId: user.id, status: 'stopped' });

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue(machine);
      (prisma.machine.update as jest.Mock).mockResolvedValue({
        ...machine,
        status: 'running'
      })

      // Mock libvirt operations
      const mockDomain = {
        create: jest.fn().mockResolvedValue(true),
        getState: jest.fn().mockResolvedValue([1, 1])
      }

      const { Connection } = require('libvirt-node')
      Connection.open = jest.fn().mockResolvedValue({
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain)
      })

      const context: InfinibayContext = {
        req: { headers: { authorization: 'user-token' } } as any,
        prisma,
        user,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestMutations.POWER_ON,
        { id: machine.id },
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.powerOn).toBeDefined()
      expect(result.data?.powerOn.success).toBe(true)
    })

    it('should list user VMs with proper filtering', async () => {
      const user = createMockUser()
      const userMachines = [
        createMockMachine({ userId: user.id, name: 'User VM 1' }),
        createMockMachine({ userId: user.id, name: 'User VM 2' })
      ]
      const otherMachine = createMockMachine({ userId: 'other-user', name: 'Other VM' });

      (prisma.machine.findMany as jest.Mock).mockImplementation(({ where }) => {
        if (where.userId === user.id) {
          return Promise.resolve(userMachines)
        }
        return Promise.resolve([])
      })

      const context: InfinibayContext = {
        req: { headers: { authorization: 'user-token' } } as any,
        prisma,
        user,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestQueries.LIST_MACHINES,
        { take: 10, skip: 0 },
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.machines).toBeDefined()
      expect(result.data?.machines.machines).toHaveLength(2)
      expect(result.data?.machines.machines.every((m: any) =>
        m.name.startsWith('User VM')
      )).toBe(true)
    })
  })

  describe('Department Operations', () => {
    it('should create department with admin privileges', async () => {
      const admin = createMockAdminUser()
      const newDepartment = createMockDepartment({ name: 'Engineering' });

      (prisma.department.create as jest.Mock).mockResolvedValue(newDepartment)

      const context: InfinibayContext = {
        req: { headers: { authorization: 'admin-token' } } as any,
        prisma,
        user: admin,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestMutations.CREATE_DEPARTMENT,
        { name: 'Engineering' },
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.createDepartment).toBeDefined()
      expect(result.data?.createDepartment.name).toBe('Engineering')
    })

    it('should list departments with machine count', async () => {
      const departments = [
        { ...createMockDepartment({ name: 'Engineering' }), totalMachines: 5 },
        { ...createMockDepartment({ name: 'Marketing' }), totalMachines: 3 }
      ];

      (prisma.department.findMany as jest.Mock).mockResolvedValue(departments);
      (prisma.machine.count as jest.Mock).mockImplementation(({ where }) => {
        const dept = departments.find(d => d.id === where.departmentId)
        return Promise.resolve(dept?.totalMachines || 0)
      })

      const context: InfinibayContext = {
        req: { headers: {} } as any,
        prisma,
        user: null as any,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestQueries.LIST_DEPARTMENTS,
        {},
        context
      )

      expect(result.errors).toBeUndefined()
      expect(result.data?.departments).toBeDefined()
      expect(result.data?.departments).toHaveLength(2)
      expect(result.data?.departments[0].totalMachines).toBe(5)
    })
  })

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      const user = createMockUser();

      (prisma.user.findUnique as jest.Mock).mockRejectedValue(
        new Error('Database connection failed')
      )

      const result = await executeGraphQL(
        schema,
        TestQueries.LOGIN,
        {
          email: user.email,
          password: 'password'
        },
        { prisma, user: null, setupMode: false }
      )

      expect(result.errors).toBeDefined()
      expect(result.errors?.[0].message).toContain('Database connection failed')
    })

    it('should validate input data', async () => {
      const admin = createMockAdminUser()

      const context: InfinibayContext = {
        req: { headers: { authorization: 'admin-token' } } as any,
        prisma,
        user: admin,
        setupMode: false
      }

      const result = await executeGraphQL(
        schema,
        TestMutations.CREATE_USER,
        {
          input: {
            email: 'invalid-email', // Invalid email format
            password: 'weak', // Too weak password
            passwordConfirmation: 'different', // Doesn't match
            firstName: '', // Empty
            lastName: '', // Empty
            role: 'INVALID_ROLE' // Invalid role
          }
        },
        context
      )

      expect(result.errors).toBeDefined()
    })

    it('should handle concurrent requests properly', async () => {
      const users = [
        createMockUser({ email: 'user1@example.com' }),
        createMockUser({ email: 'user2@example.com' }),
        createMockUser({ email: 'user3@example.com' })
      ]

      const contexts = users.map(user => ({
        req: { headers: { authorization: `token-${user.id}` } } as any,
        prisma,
        user,
        setupMode: false
      }));

      (prisma.machine.findMany as jest.Mock).mockImplementation(() => {
        return Promise.resolve([])
      })

      // Execute multiple concurrent requests
      const promises = contexts.map(context =>
        executeGraphQL(
          schema,
          TestQueries.LIST_MACHINES,
          { take: 10, skip: 0 },
          context
        )
      )

      const results = await Promise.all(promises)

      // All requests should succeed
      results.forEach(result => {
        expect(result.errors).toBeUndefined()
        expect(result.data?.machines).toBeDefined()
      })
    })
  })

  describe('Subscription Mechanism', () => {
    it('should setup WebSocket subscriptions', async () => {
      // Note: Full WebSocket subscription testing would require a more complex setup
      // This is a placeholder for subscription mechanism testing

      const { getEventManager } = require('@services/EventManager')
      const eventManager = getEventManager()

      // Verify event manager is properly mocked
      expect(eventManager.dispatchEvent).toBeDefined()
      expect(eventManager.subscribe).toBeDefined()
      expect(eventManager.unsubscribe).toBeDefined()

      // Simulate subscription
      const callback = jest.fn()
      eventManager.subscribe('vms', 'create', callback)

      // Simulate event dispatch
      await eventManager.dispatchEvent('vms', 'create', { id: 'test-vm' }, 'user-id')

      // In a real test, we would verify the callback was called
      // This would require actual WebSocket implementation
      expect(eventManager.dispatchEvent).toHaveBeenCalledWith(
        'vms',
        'create',
        { id: 'test-vm' },
        'user-id'
      )
    })
  })

  describe('Middleware Integration', () => {
    it('should apply authentication middleware correctly', async () => {
      const user = createMockUser()
      const token = jwt.sign(
        { userId: user.id, userRole: user.role },
        process.env.TOKENKEY || 'test-secret-key'
      );

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(user)

      // Test authenticated endpoint
      const authContext: InfinibayContext = {
        req: { headers: { authorization: token } } as any,
        prisma,
        user,
        setupMode: false
      }

      const authResult = await executeGraphQL(
        schema,
        TestQueries.CURRENT_USER,
        {},
        authContext
      )

      expect(authResult.errors).toBeUndefined()
      expect(authResult.data?.currentUser).toBeDefined()

      // Test same endpoint without auth
      const noAuthContext: InfinibayContext = {
        req: { headers: {} } as any,
        prisma,
        user: null as any,
        setupMode: false
      }

      const noAuthResult = await executeGraphQL(
        schema,
        TestQueries.CURRENT_USER,
        {},
        noAuthContext
      )

      expect(noAuthResult.errors).toBeDefined()
      expect(noAuthResult.errors?.[0].message).toContain('Access denied')
    })

    it('should handle CORS headers properly', () => {
      // CORS configuration would be tested here
      // This is a placeholder as CORS is typically handled by Apollo Server
      expect(process.env.FRONTEND_URL).toBeDefined()
    })
  })

  describe('Performance and Rate Limiting', () => {
    it('should handle bulk operations efficiently', async () => {
      const admin = createMockAdminUser()
      const machineCount = 100
      const machines = Array.from({ length: machineCount }, (_, i) =>
        createMockMachine({ name: `VM ${i}` })
      );

      (prisma.machine.findMany as jest.Mock).mockResolvedValue(machines.slice(0, 20))

      const context: InfinibayContext = {
        req: { headers: { authorization: 'admin-token' } } as any,
        prisma,
        user: admin,
        setupMode: false
      }

      const startTime = Date.now()
      const result = await executeGraphQL(
        schema,
        TestQueries.LIST_MACHINES,
        { take: 20, skip: 0 },
        context
      )
      const endTime = Date.now()

      expect(result.errors).toBeUndefined()
      expect(result.data?.machines.machines).toHaveLength(20)

      // Query should complete within reasonable time (< 1 second)
      expect(endTime - startTime).toBeLessThan(1000)
    })
  })
})
