import { GraphQLSchema, graphql } from 'graphql'
import { buildSchema } from 'type-graphql'
import * as jwt from 'jsonwebtoken'
import { User, PrismaClient } from '@prisma/client'
import { Request, Response } from 'express'
import * as Express from 'express'
import { InfinibayContext } from '@utils/context'
import { mockPrisma } from './jest.setup'
import { createMockUser, createMockAdminUser } from './mock-factories'

// JWT token generation for testing
export function generateTestToken (userId: string, role: string = 'USER'): string {
  return jwt.sign(
    { id: userId, role },
    process.env.TOKENKEY || 'test-secret-key',
    { expiresIn: '24h' }
  )
}

// GraphQL query/mutation executor
export async function executeGraphQL (options: {
  schema: GraphQLSchema,
  query: string,
  variables?: Record<string, unknown>,
  context?: unknown
}) {
  const result = await graphql({
    schema: options.schema,
    source: options.query,
    variableValues: options.variables,
    contextValue: options.context
  })

  return result
}

// Create mock Express request/response objects
export function createMockContext (options: { user?: User | null; prisma?: PrismaClient } | User | null = null, authorization?: string): InfinibayContext {
  // Handle both calling patterns: createMockContext(user) and createMockContext({ user, prisma })
  let user: User | null = null
  if (options && typeof options === 'object' && 'user' in options) {
    user = options.user || null
  } else {
    user = options as User | null
  }
  const mockReq = {
    headers: authorization ? { authorization } : {},
    get: jest.fn(),
    header: jest.fn(),
    accepts: jest.fn(),
    acceptsCharsets: jest.fn(),
    // Add other required Request properties as empty functions/values
    method: 'GET',
    url: '/',
    originalUrl: '/',
    path: '/',
    query: {},
    params: {},
    body: {},
    cookies: {},
    files: undefined,
    hostname: 'localhost',
    ip: '127.0.0.1',
    ips: [],
    protocol: 'http',
    secure: false,
    xhr: false,
    fresh: false,
    stale: true,
    subdomains: [],
    baseUrl: '',
    route: undefined,
    app: {} as Express.Application,
    is: jest.fn(),
    param: jest.fn(),
    range: jest.fn(),
    accepted: [],
    acceptsEncodings: jest.fn(),
    acceptsLanguages: jest.fn(),
    connection: {} as NodeJS.Socket,
    socket: {} as NodeJS.Socket
  } as unknown as Request

  const mockRes = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
    header: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
    redirect: jest.fn().mockReturnThis(),
    locals: {},
    headersSent: false
  } as unknown as Response

  return {
    req: mockReq,
    res: mockRes,
    prisma: mockPrisma,
    user,
    setupMode: false
  }
}

// Helper functions for common context scenarios
export function createAdminContext (): InfinibayContext {
  const adminUser = createMockAdminUser()
  return createMockContext(adminUser, 'admin-token')
}

export function createUserContext (): InfinibayContext {
  const user = createMockUser()
  return createMockContext(user, 'user-token')
}

export function createUnauthenticatedContext (): InfinibayContext {
  return createMockContext(null)
}

// Common GraphQL queries and mutations for testing
export const TestQueries = {
  LOGIN: `
    query Login($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        token
      }
    }
  `,

  CURRENT_USER: `
    query CurrentUser {
      currentUser {
        id
        email
        firstName
        lastName
        role
      }
    }
  `,

  GET_USER: `
    query GetUser($id: String!) {
      user(id: $id) {
        id
        email
        firstName
        lastName
        role
        deleted
      }
    }
  `,

  LIST_USERS: `
    query ListUsers($orderBy: String, $take: Int, $skip: Int) {
      users(orderBy: $orderBy, take: $take, skip: $skip) {
        users {
          id
          email
          firstName
          lastName
          role
        }
        total
      }
    }
  `,

  GET_MACHINE: `
    query GetMachine($id: String!) {
      machine(id: $id) {
        id
        name
        internalName
        status
        os
        cpuCores
        ramGB
        diskSizeGB
      }
    }
  `,

  LIST_MACHINES: `
    query ListMachines($take: Int, $skip: Int) {
      machines(take: $take, skip: $skip) {
        machines {
          id
          name
          status
          os
        }
        total
      }
    }
  `,

  LIST_DEPARTMENTS: `
    query ListDepartments {
      departments {
        id
        name
        totalMachines
      }
    }
  `,

  USERS: `
    query Users($orderBy: String, $take: Int, $skip: Int) {
      users(orderBy: $orderBy, take: $take, skip: $skip) {
        users {
          id
          email
          firstName
          lastName
          role
        }
        total
      }
    }
  `,

  MACHINE: `
    query Machine($id: String!) {
      machine(id: $id) {
        id
        name
        internalName
        status
        os
        cpuCores
        ramGB
        diskSizeGB
      }
    }
  `,

  MACHINES: `
    query Machines($take: Int, $skip: Int) {
      machines(take: $take, skip: $skip) {
        machines {
          id
          name
          status
          os
        }
        total
      }
    }
  `,

  DEPARTMENT: `
    query Department($id: String!) {
      department(id: $id) {
        id
        name
        totalMachines
      }
    }
  `,

  DEPARTMENTS: `
    query Departments {
      departments {
        id
        name
        totalMachines
      }
    }
  `,

  MACHINE_TEMPLATES: `
    query MachineTemplates($take: Int, $skip: Int) {
      machineTemplates(take: $take, skip: $skip) {
        templates {
          id
          name
          os
          cpuCores
          ramGB
          diskSizeGB
        }
        total
      }
    }
  `
}

export const TestMutations = {
  CREATE_USER: `
    mutation CreateUser($input: UserInput!) {
      createUser(input: $input) {
        id
        email
        firstName
        lastName
        role
      }
    }
  `,

  UPDATE_USER: `
    mutation UpdateUser($id: String!, $input: UserInput!) {
      updateUser(id: $id, input: $input) {
        id
        email
        firstName
        lastName
      }
    }
  `,

  CREATE_MACHINE: `
    mutation CreateMachine($input: MachineInput!) {
      createMachine(input: $input) {
        id
        name
        internalName
        status
        os
      }
    }
  `,

  POWER_ON: `
    mutation PowerOn($id: String!) {
      powerOn(id: $id) {
        success
        message
      }
    }
  `,

  POWER_OFF: `
    mutation PowerOff($id: String!) {
      powerOff(id: $id) {
        success
        message
      }
    }
  `,

  DESTROY_MACHINE: `
    mutation DestroyMachine($id: String!) {
      destroyMachine(id: $id) {
        success
        message
      }
    }
  `,

  CREATE_DEPARTMENT: `
    mutation CreateDepartment($name: String!) {
      createDepartment(name: $name) {
        id
        name
      }
    }
  `,

  DESTROY_DEPARTMENT: `
    mutation DestroyDepartment($id: String!) {
      destroyDepartment(id: $id) {
        success
        message
      }
    }
  `,

  LOGIN: `
    mutation Login($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        id
        email
        firstName
        lastName
        role
        token
      }
    }
  `,

  DELETE_USER: `
    mutation DeleteUser($id: String!) {
      deleteUser(id: $id) {
        success
        message
      }
    }
  `,

  DELETE_DEPARTMENT: `
    mutation DeleteDepartment($id: String!) {
      destroyDepartment(id: $id) {
        success
        message
      }
    }
  `
}

// Error matchers
export const ErrorMatchers = {
  unauthorized: expect.objectContaining({
    message: expect.stringContaining('Unauthorized')
  }),

  notFound: expect.objectContaining({
    message: expect.stringContaining('not found')
  }),

  validationError: expect.objectContaining({
    message: expect.stringContaining('Validation')
  }),

  duplicateError: expect.objectContaining({
    message: expect.stringContaining('already exists')
  })
}

// Test data cleanup utilities
export async function cleanupTestData (prisma: unknown, tables: string[]) {
  const prismaClient = prisma as Record<string, { deleteMany: (args?: unknown) => Promise<unknown> }>
  for (const table of tables.reverse()) {
    try {
      await prismaClient[table].deleteMany({})
    } catch (error) {
      // Ignore errors for non-existent tables
    }
  }
}

// Wait utility for async operations
export function waitFor (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Mock libvirt state helper
export function setupLibvirtMockState (state: unknown) {
  const libvirt = require('libvirt-node')
  if (libvirt.__setLibvirtMockState) {
    libvirt.__setLibvirtMockState(state)
  }
}

// GraphQL response type
interface GraphQLResponse {
  errors?: Array<{ message: string }>;
  data?: unknown;
}

// Response assertion helpers
export function assertGraphQLSuccess (result: unknown) {
  const response = result as GraphQLResponse
  expect(response.errors).toBeUndefined()
  expect(response.data).toBeDefined()
}

export function assertGraphQLError (result: unknown, expectedError?: string) {
  const response = result as GraphQLResponse
  expect(response.errors).toBeDefined()
  expect(response.errors?.length).toBeGreaterThan(0)

  if (expectedError && response.errors) {
    expect(response.errors[0].message).toContain(expectedError)
  }
}

// Pagination helpers
export interface PaginationInput {
  take?: number;
  skip?: number;
  orderBy?: string;
}

export function createPaginationInput (
  page: number = 1,
  pageSize: number = 10,
  orderBy: string = 'createdAt'
): PaginationInput {
  return {
    take: pageSize,
    skip: (page - 1) * pageSize,
    orderBy
  }
}
