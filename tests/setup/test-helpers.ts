import { GraphQLSchema, graphql } from 'graphql'
import { buildSchema } from 'type-graphql'
import * as jwt from 'jsonwebtoken'
import { User } from '@prisma/client'

// Authentication context builder
export interface TestContext {
  user?: User;
  prisma?: any;
  token?: string;
}

export function createMockContext (overrides?: Partial<TestContext>): TestContext {
  const defaultUser: User = {
    id: 'test-user-id',
    email: 'test@example.com',
    password: 'hashed-password',
    deleted: false,
    token: 'test-token',
    firstName: 'Test',
    lastName: 'User',
    userImage: null,
    role: 'USER',
    createdAt: new Date()
  }

  return {
    user: defaultUser,
    ...overrides
  }
}

export function createAdminContext (): TestContext {
  return createMockContext({
    user: {
      id: 'admin-user-id',
      email: 'admin@example.com',
      password: 'hashed-password',
      deleted: false,
      token: 'admin-token',
      firstName: 'Admin',
      lastName: 'User',
      userImage: null,
      role: 'ADMIN',
      createdAt: new Date()
    }
  })
}

// JWT token generation for testing
export function generateTestToken (userId: string, role: string = 'USER'): string {
  return jwt.sign(
    { id: userId, role },
    process.env.TOKENKEY || 'test-secret-key',
    { expiresIn: '24h' }
  )
}

// GraphQL query/mutation executor
export async function executeGraphQL (
  schema: GraphQLSchema,
  query: string,
  variables?: any,
  context?: any
) {
  const result = await graphql({
    schema,
    source: query,
    variableValues: variables,
    contextValue: context
  })

  return result
}

// Common GraphQL queries and mutations for testing
export const TestQueries = {
  LOGIN: `
    query Login($email: String!, $password: String!) {
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
export async function cleanupTestData (prisma: any, tables: string[]) {
  for (const table of tables.reverse()) {
    try {
      await prisma[table].deleteMany({})
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
export function setupLibvirtMockState (state: any) {
  const libvirt = require('libvirt-node')
  if (libvirt.__setLibvirtMockState) {
    libvirt.__setLibvirtMockState(state)
  }
}

// Response assertion helpers
export function assertGraphQLSuccess (result: any) {
  expect(result.errors).toBeUndefined()
  expect(result.data).toBeDefined()
}

export function assertGraphQLError (result: any, expectedError?: string) {
  expect(result.errors).toBeDefined()
  expect(result.errors.length).toBeGreaterThan(0)

  if (expectedError) {
    expect(result.errors[0].message).toContain(expectedError)
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
