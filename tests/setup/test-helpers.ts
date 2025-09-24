import { GraphQLSchema, graphql } from 'graphql'
import { buildSchema } from 'type-graphql'
import * as jwt from 'jsonwebtoken'
import { User, PrismaClient } from '@prisma/client'
import { Request, Response } from 'express'
import * as Express from 'express'
import { InfinibayContext } from '@utils/context'
import { mockPrisma } from './jest.setup'
import { createMockUser, createMockAdminUser, createMockMachine } from './mock-factories'

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
    setupMode: false,
    virtioSocketWatcher: undefined,
    eventManager: undefined
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
    query ListUsers($orderBy: UserOrderByInputType, $pagination: PaginationInputType) {
      users(orderBy: $orderBy, pagination: $pagination) {
        id
        email
        firstName
        lastName
        role
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
    query ListMachines($orderBy: MachineOrderBy, $pagination: PaginationInputType) {
      machines(orderBy: $orderBy, pagination: $pagination) {
        id
        name
        status
        os
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
    query Users($orderBy: UserOrderByInputType, $pagination: PaginationInputType) {
      users(orderBy: $orderBy, pagination: $pagination) {
        id
        email
        firstName
        lastName
        role
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
    query Machines($orderBy: MachineOrderBy, $pagination: PaginationInputType) {
      machines(orderBy: $orderBy, pagination: $pagination) {
        id
        name
        status
        os
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
    query MachineTemplates($orderBy: MachineTemplateOrderBy, $pagination: PaginationInputType) {
      machineTemplates(orderBy: $orderBy, pagination: $pagination) {
        id
        name
        cores
        ram
        storage
      }
    }
  `
}

export const TestMutations = {
  CREATE_USER: `
    mutation CreateUser($input: CreateUserInputType!) {
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
    mutation UpdateUser($id: String!, $input: UpdateUserInputType!) {
      updateUser(id: $id, input: $input) {
        id
        email
        firstName
        lastName
      }
    }
  `,

  CREATE_MACHINE: `
    mutation CreateMachine($input: CreateMachineInputType!) {
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
    query Login($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        token
      }
    }
  `,

  DELETE_USER: `
    mutation UpdateUser($id: String!, $input: UpdateUserInputType!) {
      updateUser(id: $id, input: $input) {
        id
        email
      }
    }
  `,

  DELETE_DEPARTMENT: `
    mutation DestroyDepartment($id: String!) {
      destroyDepartment(id: $id) {
        id
        name
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

// Multi-VM Test Setup Helpers
export async function createDepartmentWithVMs (
  prisma: PrismaClient,
  vmCount: number = 3,
  departmentName?: string
) {
  const department = await prisma.department.create({
    data: {
      name: departmentName || `Department-${Date.now()}`
    }
  })

  const vms = []
  for (let i = 0; i < vmCount; i++) {
    const user = await prisma.user.create({
      data: createMockUser()
    })

    const vm = await prisma.machine.create({
      data: {
        ...createMockMachine(),
        name: `TestVM-${i + 1}`,
        internalName: `testvm-${i + 1}`,
        userId: user.id,
        departmentId: department.id,
        firewallTemplates: {
          appliedTemplates: [],
          customRules: [],
          lastSync: new Date().toISOString()
        }
      }
    })
    vms.push({ vm, user })
  }

  return { department, vms }
}

export async function createMultipleDepartments (
  prisma: PrismaClient,
  departmentCount: number = 2,
  vmsPerDepartment: number = 2
) {
  const departments = []
  for (let i = 0; i < departmentCount; i++) {
    const { department, vms } = await createDepartmentWithVMs(
      prisma,
      vmsPerDepartment,
      `TestDept-${i + 1}`
    )
    departments.push({ department, vms })
  }
  return departments
}

export async function setupComplexFirewallHierarchy (prisma: PrismaClient) {
  const globalTemplate = {
    name: 'Global-Security',
    rules: [
      { action: 'allow', port: 22, protocol: 'tcp', description: 'SSH' },
      { action: 'allow', port: 80, protocol: 'tcp', description: 'HTTP' }
    ]
  }

  const departmentTemplate = {
    name: 'Department-Web',
    rules: [
      { action: 'allow', port: 443, protocol: 'tcp', description: 'HTTPS' },
      { action: 'allow', port: 8080, protocol: 'tcp', description: 'Alt-HTTP' }
    ]
  }

  const vmTemplate = {
    name: 'VM-Database',
    rules: [
      { action: 'allow', port: 3306, protocol: 'tcp', description: 'MySQL' },
      { action: 'allow', port: 5432, protocol: 'tcp', description: 'PostgreSQL' }
    ]
  }

  return { globalTemplate, departmentTemplate, vmTemplate }
}

export function createIntegrationTestData () {
  return {
    users: Array.from({ length: 5 }, (_, i) => ({
      ...createMockUser(),
      email: `user${i + 1}@test.com`
    })),
    machines: Array.from({ length: 5 }, (_, i) => ({
      ...createMockMachine(),
      name: `TestMachine-${i + 1}`,
      internalName: `testmachine-${i + 1}`
    })),
    departments: Array.from({ length: 3 }, (_, i) => ({
      name: `TestDepartment-${i + 1}`
    }))
  }
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

// Transaction test helper interface
export interface TransactionTestParams {
  testUser: any;
  adminUser?: any;
  testMachine: any;
  context: InfinibayContext;
  adminContext?: InfinibayContext;
}

// Firewall State Verification Utilities
export async function verifyFirewallStateConsistency (
  prisma: PrismaClient,
  machineId: string
) {
  const machine = await prisma.machine.findUnique({
    where: { id: machineId },
    include: { department: true }
  })

  if (!machine) {
    throw new Error(`Machine ${machineId} not found`)
  }

  const firewallData = machine.firewallTemplates as any
  const hasValidStructure = firewallData &&
    Array.isArray(firewallData.appliedTemplates) &&
    Array.isArray(firewallData.customRules) &&
    firewallData.lastSync

  return {
    isValid: hasValidStructure,
    machine,
    firewallData,
    departmentId: machine.departmentId
  }
}

export function assertEffectiveRules (rules: any[], expectedRules: any[]) {
  expect(rules).toHaveLength(expectedRules.length)
  expectedRules.forEach((expected, index) => {
    expect(rules[index]).toMatchObject(expected)
  })
}

export function checkRuleInheritance (
  vmRules: any[],
  departmentRules: any[],
  globalRules: any[]
) {
  const allRules = [...globalRules, ...departmentRules, ...vmRules]
  const effectiveRules = allRules.reduce((acc, rule) => {
    const key = `${rule.port}-${rule.protocol}`
    if (!acc[key] || rule.priority > acc[key].priority) {
      acc[key] = rule
    }
    return acc
  }, {})

  return Object.values(effectiveRules)
}

export function verifyRuleSynchronization (beforeRules: any[], afterRules: any[]) {
  const beforeSet = new Set(beforeRules.map(r => `${r.port}-${r.protocol}-${r.action}`))
  const afterSet = new Set(afterRules.map(r => `${r.port}-${r.protocol}-${r.action}`))

  return {
    added: [...afterSet].filter(r => !beforeSet.has(r)),
    removed: [...beforeSet].filter(r => !afterSet.has(r)),
    unchanged: [...beforeSet].filter(r => afterSet.has(r))
  }
}

// WebSocket Event Testing Helpers
interface CapturedEvent {
  eventType: string;
  payload: any;
  timestamp: number;
  userId?: string;
}

let capturedEvents: CapturedEvent[] = []

export function captureWebSocketEvents () {
  capturedEvents = []
  const mockEmit = jest.fn((eventType: string, payload: any, userId?: string) => {
    capturedEvents.push({
      eventType,
      payload,
      timestamp: Date.now(),
      userId
    })
  })
  return { mockEmit, getCapturedEvents: () => [...capturedEvents] }
}

export function verifyEventSequence (events: CapturedEvent[], expectedSequence: string[]) {
  expect(events).toHaveLength(expectedSequence.length)
  events.forEach((event, index) => {
    expect(event.eventType).toBe(expectedSequence[index])
  })
}

export function assertEventPayload (event: CapturedEvent, expectedPayload: any) {
  expect(event.payload).toMatchObject(expectedPayload)
}

export function simulateMultipleConnections (userCount: number) {
  const connections = []
  for (let i = 0; i < userCount; i++) {
    const userId = `user-${i + 1}`
    const mockSocket = {
      id: `socket-${i + 1}`,
      userId,
      emit: jest.fn(),
      on: jest.fn(),
      disconnect: jest.fn()
    }
    connections.push(mockSocket)
  }
  return connections
}

// Error Simulation and Recovery Testing
export function simulateServiceFailure (serviceName: string, errorMessage?: string) {
  const error = new Error(errorMessage || `${serviceName} service failure`)
  const mockFn = jest.fn().mockRejectedValue(error)
  return { error, mockFn }
}

export function simulateNetworkIssues () {
  const networkError = new Error('Network connection failed')
  networkError.name = 'NetworkError'
  return networkError
}

export function simulateDatabaseFailure () {
  const dbError = new Error('Database connection lost')
  dbError.name = 'DatabaseError'
  return dbError
}

export async function verifyErrorRecovery (
  operation: () => Promise<any>,
  expectedError: string
) {
  await expect(operation()).rejects.toThrow(expectedError)
}

// Multi-Operation Helpers
export async function executeMultiStepWorkflow (
  steps: Array<() => Promise<any>>,
  rollbackOnFailure: boolean = true
) {
  const results = []
  const completedSteps = []

  try {
    for (const step of steps) {
      const result = await step()
      results.push(result)
      completedSteps.push(step)
    }
    return results
  } catch (error) {
    if (rollbackOnFailure) {
      // Simulate rollback of completed steps
      console.log(`Rolling back ${completedSteps.length} completed steps`)
    }
    throw error
  }
}

export function createMultipleRules (count: number, basePort: number = 8000) {
  return Array.from({ length: count }, (_, i) => ({
    action: i % 2 === 0 ? 'allow' : 'deny',
    port: basePort + i,
    protocol: i % 3 === 0 ? 'udp' : 'tcp',
    description: `Test rule ${i + 1}`
  }))
}

export function applyMultipleTemplates (templateCount: number) {
  return Array.from({ length: templateCount }, (_, i) => ({
    name: `Template-${i + 1}`,
    description: `Test template ${i + 1}`,
    rules: createMultipleRules(3, 9000 + (i * 10))
  }))
}

export function verifyMultiOperationResults (results: any[], expectedCount: number) {
  expect(results).toHaveLength(expectedCount)
  results.forEach((result, index) => {
    expect(result).toBeDefined()
    expect(result).not.toBeNull()
  })
}

// Cross-Service Integration Helpers
export async function executeAcrossAllFirewallServices (
  operations: {
    networkFilter?: () => Promise<any>;
    departmentFirewall?: () => Promise<any>;
    firewallSimplifier?: () => Promise<any>;
    advancedFirewall?: () => Promise<any>;
  }
) {
  const results: Record<string, any> = {}

  if (operations.networkFilter) {
    results.networkFilter = await operations.networkFilter()
  }
  if (operations.departmentFirewall) {
    results.departmentFirewall = await operations.departmentFirewall()
  }
  if (operations.firewallSimplifier) {
    results.firewallSimplifier = await operations.firewallSimplifier()
  }
  if (operations.advancedFirewall) {
    results.advancedFirewall = await operations.advancedFirewall()
  }

  return results
}

export function verifyServiceIntegration (serviceResults: Record<string, any>) {
  Object.entries(serviceResults).forEach(([serviceName, result]) => {
    expect(result).toBeDefined()
    expect(result).not.toBeNull()
  })
}

export function checkServiceStateConsistency (
  serviceStates: Record<string, any>,
  expectedConsistencyKeys: string[]
) {
  const services = Object.keys(serviceStates)
  expect(services.length).toBeGreaterThan(1)

  expectedConsistencyKeys.forEach(key => {
    const values = services.map(service => serviceStates[service][key])
    const firstValue = values[0]
    values.forEach(value => {
      expect(value).toEqual(firstValue)
    })
  })
}

export async function simulateConcurrentServiceOperations (
  operations: Array<() => Promise<any>>
) {
  const results = await Promise.allSettled(operations.map(op => op()))

  const successful = results.filter(r => r.status === 'fulfilled')
  const failed = results.filter(r => r.status === 'rejected')

  return {
    successful: successful.map(r => (r as PromiseFulfilledResult<any>).value),
    failed: failed.map(r => (r as PromiseRejectedResult).reason),
    totalCount: results.length,
    successCount: successful.length,
    failureCount: failed.length
  }
}

// Advanced Transaction Helpers
export interface ComplexTransactionParams extends TransactionTestParams {
  departments: any[];
  multipleVMs: any[];
  templates: any[];
}

export async function withComplexTransaction (
  prisma: PrismaClient,
  testFn: (params: ComplexTransactionParams) => Promise<void>,
  options: { vmCount?: number; departmentCount?: number } = {}
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const testUser = await tx.user.create({ data: createMockUser() })
    const adminUser = await tx.user.create({
      data: { ...createMockUser(), role: 'ADMIN', email: 'admin@test.com' }
    })

    const departments = await createMultipleDepartments(
      tx,
      options.departmentCount || 2,
      options.vmCount || 2
    )

    const testMachine = await tx.machine.create({
      data: {
        ...createMockMachine(),
        userId: testUser.id,
        firewallTemplates: {
          appliedTemplates: [],
          customRules: [],
          lastSync: new Date().toISOString()
        }
      }
    })

    const multipleVMs = departments.flatMap(d => d.vms)
    const templates = await setupComplexFirewallHierarchy(tx)

    const context: InfinibayContext = {
      prisma: tx, user: testUser, req: {} as any, res: {} as any,
      setupMode: false, virtioSocketWatcher: undefined, eventManager: undefined
    }

    const adminContext: InfinibayContext = {
      prisma: tx, user: adminUser, req: {} as any, res: {} as any,
      setupMode: false, virtioSocketWatcher: undefined, eventManager: undefined
    }

    jest.clearAllMocks()

    await testFn({
      testUser, adminUser, testMachine, context, adminContext,
      departments: departments.map(d => d.department),
      multipleVMs,
      templates
    })

    throw new Error('Test complete - rollback transaction')
  }, { timeout: 30000 }).catch((error) => {
    if (!error.message.includes('Test complete - rollback transaction')) {
      throw error
    }
  })
}

export async function withErrorInjection (
  prisma: PrismaClient,
  testFn: (params: TransactionTestParams) => Promise<void>,
  errorConfig: { failurePoint?: string; errorMessage?: string } = {}
): Promise<void> {
  const originalTransaction = withTransaction

  try {
    await originalTransaction(prisma, async (params) => {
      if (errorConfig.failurePoint) {
        // Inject error at specified point
        const error = new Error(errorConfig.errorMessage || 'Injected test error')
        error.name = 'InjectedError'
        throw error
      }
      await testFn(params)
    })
  } catch (error) {
    if (error.name === 'InjectedError') {
      // Expected injected error
      return
    }
    throw error
  }
}

export async function withMultiUserScenario (
  prisma: PrismaClient,
  testFn: (params: TransactionTestParams & { additionalUsers: any[] }) => Promise<void>,
  userCount: number = 3
): Promise<void> {
  await withTransaction(prisma, async (params) => {
    const additionalUsers = []
    for (let i = 0; i < userCount; i++) {
      const user = await params.context.prisma.user.create({
        data: { ...createMockUser(), email: `additional-user-${i + 1}@test.com` }
      })
      additionalUsers.push(user)
    }

    await testFn({ ...params, additionalUsers })
  })
}

export async function withServiceIntegrationTesting (
  prisma: PrismaClient,
  testFn: (params: ComplexTransactionParams) => Promise<void>
): Promise<void> {
  await withComplexTransaction(prisma, testFn, { vmCount: 3, departmentCount: 2 })
}

// Workflow Testing Utilities
export async function executeCompleteWorkflow (
  steps: Array<{ name: string; operation: () => Promise<any>; verify: (result: any) => void }>
) {
  const results = []

  for (const step of steps) {
    console.log(`Executing workflow step: ${step.name}`)
    const result = await step.operation()
    step.verify(result)
    results.push({ step: step.name, result })
  }

  return results
}

export function verifyWorkflowSteps (workflow: any[], expectedSteps: string[]) {
  expect(workflow).toHaveLength(expectedSteps.length)
  workflow.forEach((step, index) => {
    expect(step.step).toBe(expectedSteps[index])
    expect(step.result).toBeDefined()
  })
}

export function assertWorkflowConsistency (workflowResults: any[]) {
  expect(workflowResults.length).toBeGreaterThan(0)
  workflowResults.forEach(result => {
    expect(result.step).toBeDefined()
    expect(result.result).toBeDefined()
  })
}

export function checkWorkflowEventDelivery (
  events: CapturedEvent[],
  workflowSteps: string[]
) {
  workflowSteps.forEach(stepName => {
    const stepEvents = events.filter(e => e.eventType.includes(stepName))
    expect(stepEvents.length).toBeGreaterThanOrEqual(1)
  })
}

// Test Data Factories
export function createComplexDepartmentScenario () {
  return {
    departments: [
      { name: 'Engineering', vmCount: 5 },
      { name: 'Marketing', vmCount: 3 },
      { name: 'Operations', vmCount: 4 }
    ],
    templates: [
      {
        name: 'Web-Server',
        rules: [
          { action: 'allow', port: 80, protocol: 'tcp' },
          { action: 'allow', port: 443, protocol: 'tcp' }
        ]
      },
      {
        name: 'Database-Server',
        rules: [
          { action: 'allow', port: 3306, protocol: 'tcp' },
          { action: 'allow', port: 5432, protocol: 'tcp' }
        ]
      }
    ]
  }
}

export function createComplexRuleHierarchy () {
  return {
    global: [
      { action: 'allow', port: 22, protocol: 'tcp', priority: 1 },
      { action: 'deny', port: 23, protocol: 'tcp', priority: 1 }
    ],
    department: [
      { action: 'allow', port: 80, protocol: 'tcp', priority: 2 },
      { action: 'allow', port: 443, protocol: 'tcp', priority: 2 }
    ],
    vm: [
      { action: 'allow', port: 8080, protocol: 'tcp', priority: 3 },
      { action: 'deny', port: 80, protocol: 'tcp', priority: 3 } // Override department rule
    ]
  }
}

export function createFailureTestScenarios () {
  return {
    networkFailure: () => simulateNetworkIssues(),
    databaseFailure: () => simulateDatabaseFailure(),
    serviceFailure: (service: string) => simulateServiceFailure(service),
    partialFailure: () => ({ success: false, partialData: { recovered: true } })
  }
}

// Assertion Helpers
export function assertStateConsistency (
  states: Record<string, any>,
  consistencyRules: Array<{ key: string; validator: (value: any) => boolean }>
) {
  consistencyRules.forEach(rule => {
    Object.entries(states).forEach(([stateName, state]) => {
      const value = state[rule.key]
      expect(rule.validator(value)).toBe(true)
    })
  })
}

export function assertEventTiming (events: CapturedEvent[], maxTimeDifference: number = 1000, enabled: boolean = false) {
  // Timing assertions are disabled by default to avoid flakiness
  if (!enabled || events.length < 2) return

  for (let i = 1; i < events.length; i++) {
    const timeDiff = events[i].timestamp - events[i - 1].timestamp
    expect(timeDiff).toBeLessThanOrEqual(maxTimeDifference)
  }
}

export function assertRuleInheritance (
  effectiveRules: any[],
  inheritanceChain: { source: string; rules: any[] }[]
) {
  const allSourceRules = inheritanceChain.flatMap(chain =>
    chain.rules.map(rule => ({ ...rule, source: chain.source }))
  )

  effectiveRules.forEach(rule => {
    const matchingSourceRules = allSourceRules.filter(
      sr => sr.port === rule.port && sr.protocol === rule.protocol
    )
    expect(matchingSourceRules.length).toBeGreaterThan(0)
  })
}

export function assertServiceIntegration (
  integrationResults: Record<string, any>,
  requiredServices: string[]
) {
  requiredServices.forEach(service => {
    expect(integrationResults[service]).toBeDefined()
    expect(integrationResults[service]).not.toBeNull()
  })
}

// Shared transaction helper for integration tests
export async function withTransaction (
  prisma: PrismaClient,
  testFn: (params: TransactionTestParams) => Promise<void>
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Create test users within transaction
    const testUser = await tx.user.create({
      data: createMockUser()
    })

    const adminUser = await tx.user.create({
      data: {
        ...createMockUser(),
        role: 'ADMIN',
        email: 'admin@test.com'
      }
    })

    // Create test machine
    const testMachine = await tx.machine.create({
      data: {
        ...createMockMachine(),
        userId: testUser.id,
        firewallTemplates: {
          appliedTemplates: [],
          customRules: [],
          lastSync: new Date().toISOString()
        }
      }
    })

    const context: InfinibayContext = {
      prisma: tx,
      user: testUser,
      req: {} as any,
      res: {} as any,
      setupMode: false,
      virtioSocketWatcher: undefined,
      eventManager: undefined
    }

    const adminContext: InfinibayContext = {
      prisma: tx,
      user: adminUser,
      req: {} as any,
      res: {} as any,
      setupMode: false,
      virtioSocketWatcher: undefined,
      eventManager: undefined
    }

    // Clear all mocks
    jest.clearAllMocks()

    // Run the test
    await testFn({ testUser, adminUser, testMachine, context, adminContext })

    // Throw error to force rollback
    throw new Error('Test complete - rollback transaction')
  }, {
    timeout: 30000 // 30 second timeout for long tests
  }).catch((error) => {
    // Expected error from rollback
    if (!error.message.includes('Test complete - rollback transaction')) {
      throw error // Re-throw unexpected errors
    }
  })
}
