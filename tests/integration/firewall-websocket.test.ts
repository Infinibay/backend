import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { buildSchema } from 'type-graphql'
import { graphql, ExecutionResult } from 'graphql'
import { Container } from 'typedi'
import { PrismaClient } from '@prisma/client'
import { AdvancedFirewallResolver } from '@graphql/resolvers/AdvancedFirewallResolver'
import { SimplifiedFirewallResolver } from '@graphql/resolvers/SimplifiedFirewallResolver'
import { withTransaction } from '../setup/test-helpers'
import { createMockUser, createMockMachine } from '../setup/mock-factories'
import { InfinibayContext } from '@utils/context'

// Mock SocketService with detailed tracking
const mockSocketService = {
  sendToUser: jest.fn(),
  sendToAll: jest.fn(),
  getConnectedUsers: jest.fn().mockReturnValue(['user1', 'user2']),
  isUserConnected: jest.fn().mockReturnValue(true)
}

jest.mock('@services/SocketService', () => ({
  getSocketService: () => mockSocketService
}))

// Mock libvirt-node
jest.mock('libvirt-node')

describe('Firewall WebSocket Events', () => {
  let schema: any
  let prisma: PrismaClient

  beforeAll(async () => {
    // Create schema once for all tests
    schema = await buildSchema({
      resolvers: [AdvancedFirewallResolver, SimplifiedFirewallResolver],
      container: Container
    })

    // Create test database instance with isolation
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:5432/test_db'
        }
      }
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('WebSocket Event Structure Validation', () => {
    const CREATE_ADVANCED_RULE_MUTATION = `
      mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
        createAdvancedFirewallRule(input: $input) {
          appliedTemplates
          customRules { port protocol direction action }
          effectiveRules { port protocol direction action }
        }
      }
    `

    it('should emit firewall:advanced:rule:created with correct structure', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80',
            description: 'HTTP port'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Allow HTTP traffic'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Verify event was emitted with correct structure
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          {
            data: {
              machineId: testMachine.id,
              rules: expect.arrayContaining([
                expect.objectContaining({
                  port: '80',
                  protocol: 'tcp',
                  direction: 'in',
                  action: 'accept'
                })
              ]),
              state: expect.objectContaining({
                appliedTemplates: expect.any(Array),
                customRules: expect.any(Array),
                effectiveRules: expect.any(Array),
                lastSync: expect.any(String)
              })
            }
          }
        )
      })
    })

    it('should emit firewall:range:rule:created with correct structure', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        const CREATE_PORT_RANGE_MUTATION = `
          mutation CreatePortRangeRule(
            $machineId: ID!
            $startPort: Int!
            $endPort: Int!
            $protocol: String!
            $direction: String!
            $action: String!
          ) {
            createPortRangeRule(
              machineId: $machineId
              startPort: $startPort
              endPort: $endPort
              protocol: $protocol
              direction: $direction
              action: $action
            ) {
              customRules { port }
            }
          }
        `

        const variables = {
          machineId: testMachine.id,
          startPort: 8000,
          endPort: 8001,
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: CREATE_PORT_RANGE_MUTATION,
          contextValue: context,
          variableValues: variables
        })

        // Verify range rule event structure
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:range:rule:created',
          {
            data: {
              machineId: testMachine.id,
              startPort: 8000,
              endPort: 8001,
              rules: expect.arrayContaining([
                expect.objectContaining({ port: '8000-8001' })
              ]),
              state: expect.objectContaining({
                appliedTemplates: expect.any(Array),
                customRules: expect.any(Array),
                effectiveRules: expect.any(Array),
                lastSync: expect.any(String)
              })
            }
          }
        )
      })
    })

    it('should include all required fields in event data', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'MULTIPLE',
            value: '80,443',
            description: 'Web ports'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        const eventCall = mockSocketService.sendToUser.mock.calls[0]
        const eventData = eventCall[3].data

        // Verify all required fields are present
        expect(eventData).toHaveProperty('machineId')
        expect(eventData).toHaveProperty('rules')
        expect(eventData).toHaveProperty('state')
        expect(eventData.state).toHaveProperty('appliedTemplates')
        expect(eventData.state).toHaveProperty('customRules')
        expect(eventData.state).toHaveProperty('effectiveRules')
        expect(eventData.state).toHaveProperty('lastSync')

        // Verify data types
        expect(typeof eventData.machineId).toBe('string')
        expect(Array.isArray(eventData.rules)).toBe(true)
        expect(Array.isArray(eventData.state.appliedTemplates)).toBe(true)
        expect(Array.isArray(eventData.state.customRules)).toBe(true)
        expect(Array.isArray(eventData.state.effectiveRules)).toBe(true)
      })
    })
  })

  describe('WebSocket Event Delivery', () => {
    const CREATE_ADVANCED_RULE_MUTATION = `
      mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
        createAdvancedFirewallRule(input: $input) {
          customRules { port }
        }
      }
    `

    it('should deliver events to machine owner', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '22'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Verify event is sent to machine owner
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )
      })
    })

    it('should deliver events to admin when admin creates rule', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, adminContext }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '443'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: adminContext,
          variableValues: { input }
        })

        // Verify event is sent to machine owner (not admin)
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id, // Machine owner, not admin
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )
      })
    })

    it('should handle WebSocket service failures gracefully', async () => {
      await withTransaction(prisma, async ({ testMachine, context }) => {
        // Mock sendToUser to throw an error
        mockSocketService.sendToUser.mockImplementationOnce(() => {
          throw new Error('WebSocket connection failed')
        })

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '3000'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        // Mutation should still succeed even if WebSocket fails
        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()
        expect(result.data?.createAdvancedFirewallRule.customRules).toHaveLength(1)
      })
    })
  })

  describe('WebSocket System Compatibility', () => {
    it('should not interfere with existing firewall events', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Create a simplified rule first (existing event)
        const SIMPLIFIED_MUTATION = `
          mutation CreateSimplifiedRule($input: CreateSimplifiedFirewallRuleInput!) {
            createSimplifiedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        const simplifiedInput = {
          machineId: testMachine.id,
          port: '80',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: SIMPLIFIED_MUTATION,
          contextValue: context,
          variableValues: { input: simplifiedInput }
        })

        // Then create an advanced rule (new event)
        const ADVANCED_MUTATION = `
          mutation CreateAdvancedRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        const advancedInput = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '443'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: ADVANCED_MUTATION,
          contextValue: context,
          variableValues: { input: advancedInput }
        })

        // Verify both events were sent correctly
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(2)

        // First call: simplified firewall event
        expect(mockSocketService.sendToUser).toHaveBeenNthCalledWith(
          1,
          testUser.id,
          'vm',
          'firewall:rule:created', // Existing event name
          expect.any(Object)
        )

        // Second call: advanced firewall event
        expect(mockSocketService.sendToUser).toHaveBeenNthCalledWith(
          2,
          testUser.id,
          'vm',
          'firewall:advanced:rule:created', // New event name
          expect.any(Object)
        )
      })
    })

    it('should maintain event ordering', async () => {
      await withTransaction(prisma, async ({ testMachine, context }) => {
        const CREATE_ADVANCED_RULE_MUTATION = `
          mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        // Create multiple rules rapidly
        const inputs = [
          {
            machineId: testMachine.id,
            ports: { type: 'SINGLE', value: '80' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          },
          {
            machineId: testMachine.id,
            ports: { type: 'SINGLE', value: '443' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          },
          {
            machineId: testMachine.id,
            ports: { type: 'SINGLE', value: '22' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          }
        ]

        // Execute mutations sequentially
        for (const input of inputs) {
          await graphql({
            schema,
            source: CREATE_ADVANCED_RULE_MUTATION,
            contextValue: context,
            variableValues: { input }
          })
        }

        // Verify events were sent in correct order
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(3)

        const calls = mockSocketService.sendToUser.mock.calls
        expect(calls[0][2]).toBe('firewall:advanced:rule:created')
        expect(calls[1][2]).toBe('firewall:advanced:rule:created')
        expect(calls[2][2]).toBe('firewall:advanced:rule:created')

        // Verify rule data is different in each call
        const rule1 = calls[0][3].data.rules[0]
        const rule2 = calls[1][3].data.rules[0]
        const rule3 = calls[2][3].data.rules[0]

        expect(rule1.port).toBe('80')
        expect(rule2.port).toBe('443')
        expect(rule3.port).toBe('22')
      })
    })

    it('should work with existing WebSocket middleware', async () => {
      await withTransaction(prisma, async ({ testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '9000'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const CREATE_ADVANCED_RULE_MUTATION = `
          mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Verify the event follows the expected pattern for existing middleware
        const eventCall = mockSocketService.sendToUser.mock.calls[0]

        // Check channel and event naming convention
        expect(eventCall[1]).toBe('vm') // Channel
        expect(eventCall[2]).toMatch(/^firewall:/) // Event prefix

        // Check data structure matches existing patterns
        expect(eventCall[3]).toHaveProperty('data')
        expect(eventCall[3].data).toHaveProperty('machineId')
        expect(eventCall[3].data).toHaveProperty('state')
      })
    })
  })

  describe('WebSocket Reliability', () => {
    it('should handle multiple rapid events', async () => {
      await withTransaction(prisma, async ({ testMachine, context }) => {
        const CREATE_PORT_RANGE_MUTATION = `
          mutation CreatePortRangeRule(
            $machineId: ID!
            $startPort: Int!
            $endPort: Int!
            $protocol: String!
            $direction: String!
            $action: String!
          ) {
            createPortRangeRule(
              machineId: $machineId
              startPort: $startPort
              endPort: $endPort
              protocol: $protocol
              direction: $direction
              action: $action
            ) {
              customRules { port }
            }
          }
        `

        // Create multiple port ranges rapidly
        const promises = []
        for (let i = 0; i < 5; i++) {
          const variables = {
            machineId: testMachine.id,
            startPort: 9000 + i * 10,
            endPort: 9000 + i * 10 + 2,
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          }

          promises.push(
            graphql({
              schema,
              source: CREATE_PORT_RANGE_MUTATION,
              contextValue: context,
              variableValues: variables
            })
          )
        }

        // Execute all mutations concurrently
        const results = await Promise.all(promises)

        // All mutations should succeed
        results.forEach(result => {
          expect(result.errors).toBeUndefined()
          expect(result.data?.createPortRangeRule).toBeDefined()
        })

        // All events should be sent
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(5)
      })
    })

    it('should not block mutation completion on WebSocket failure', async () => {
      await withTransaction(prisma, async ({ testMachine, context }) => {
        // Make WebSocket service consistently fail
        mockSocketService.sendToUser.mockImplementation(() => {
          throw new Error('WebSocket service unavailable')
        })

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '8080'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const CREATE_ADVANCED_RULE_MUTATION = `
          mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port protocol }
            }
          }
        `

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Mutation should complete successfully
        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()
        expect(result.data?.createAdvancedFirewallRule.customRules).toHaveLength(1)
        expect(result.data?.createAdvancedFirewallRule.customRules[0].port).toBe('8080')
      })
    })
  })

  describe('Event Data Validation', () => {
    const CREATE_ADVANCED_RULE_MUTATION = `
      mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
        createAdvancedFirewallRule(input: $input) {
          customRules { port protocol direction action }
        }
      }
    `

    it('should include event timestamps', async () => {
      await withTransaction(prisma, async ({ testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '5000'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const beforeTime = new Date()
        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })
        const afterTime = new Date()

        const eventCall = mockSocketService.sendToUser.mock.calls[0]
        const eventData = eventCall[3].data

        // Check that lastSync timestamp is within expected range
        expect(typeof eventData.state.lastSync).toBe('string')
        const ts = new Date(eventData.state.lastSync as string)
        expect(ts.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
        expect(ts.getTime()).toBeLessThanOrEqual(afterTime.getTime())
      })
    })

    it('should validate user ID and machine ID accuracy', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '6000'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        const eventCall = mockSocketService.sendToUser.mock.calls[0]

        // Verify correct user ID (event sent to machine owner)
        expect(eventCall[0]).toBe(testUser.id)

        // Verify correct machine ID in event data
        expect(eventCall[3].data.machineId).toBe(testMachine.id)
      })
    })

    it('should handle event data serialization correctly', async () => {
      await withTransaction(prisma, async ({ testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'RANGE',
            value: '7000-7002',
            description: 'Test range with special chars: áéíóú'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Test description with unicode: 🔥🚀'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        const eventCall = mockSocketService.sendToUser.mock.calls[0]
        const eventData = eventCall[3].data

        // Verify that data can be serialized/deserialized without issues
        const serializedData = JSON.stringify(eventData)
        const deserializedData = JSON.parse(serializedData)

        expect(deserializedData).toEqual(eventData)

        // Verify unicode characters are preserved
        expect(deserializedData.rules.some((rule: any) =>
          rule.description?.includes('🔥🚀')
        )).toBe(true)
      })
    })
  })

  describe('Multi-User WebSocket Event Scenarios', () => {
    const CREATE_ADVANCED_RULE_MUTATION = `
      mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
        createAdvancedFirewallRule(input: $input) {
          customRules { port protocol direction action }
          effectiveRules { port protocol direction action }
        }
      }
    `

    beforeEach(() => {
      jest.clearAllMocks()
      // Reset mock user connections
      mockSocketService.getConnectedUsers.mockReturnValue(['user1', 'user2', 'user3'])
      mockSocketService.isUserConnected.mockImplementation((userId: string) =>
        ['user1', 'user2', 'user3'].includes(userId)
      )
    })

    it('should broadcast department-level firewall changes to all department users', async () => {
      await withTransaction(prisma, async ({ adminContext }) => {
        // Create department with multiple users
        const department = await prisma.department.create({
          data: { name: 'Engineering', description: 'Engineering Department' }
        })

        const users = await Promise.all([
          prisma.user.create({
            data: {
              username: 'eng-user1',
              email: 'user1@eng.com',
              passwordHash: 'hash1',
              role: 'USER',
              departmentId: department.id
            }
          }),
          prisma.user.create({
            data: {
              username: 'eng-user2',
              email: 'user2@eng.com',
              passwordHash: 'hash2',
              role: 'USER',
              departmentId: department.id
            }
          })
        ])

        const machine = await prisma.machine.create({
          data: {
            uuid: 'dept-vm-uuid',
            name: 'dept-vm',
            status: 'running',
            memory: 2048,
            vcpus: 2,
            userId: users[0].id,
            departmentId: department.id
          }
        })

        // Mock broadcast to department users
        mockSocketService.sendToDepartment = jest.fn()

        const input = {
          machineId: machine.id,
          ports: {
            type: 'SINGLE',
            value: '80'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Department web server'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: adminContext,
          variableValues: { input }
        })

        // Verify department broadcast occurred
        expect(mockSocketService.sendToDepartment).toHaveBeenCalledWith(
          department.id,
          'vm',
          'firewall:department:rule:created',
          expect.objectContaining({
            data: expect.objectContaining({
              machineId: machine.id,
              departmentId: department.id
            })
          })
        )
      })
    })

    it('should handle concurrent WebSocket events from multiple users', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine }) => {
        // Create additional users
        const user2 = await prisma.user.create({
          data: {
            username: 'concurrent-user2',
            email: 'user2@test.com',
            passwordHash: 'hash2',
            role: 'USER'
          }
        })

        const user3 = await prisma.user.create({
          data: {
            username: 'concurrent-user3',
            email: 'user3@test.com',
            passwordHash: 'hash3',
            role: 'ADMIN'
          }
        })

        // Create machines for each user
        const machine2 = await prisma.machine.create({
          data: {
            uuid: 'user2-vm-uuid',
            name: 'user2-vm',
            status: 'running',
            memory: 1024,
            vcpus: 1,
            userId: user2.id
          }
        })

        const machine3 = await prisma.machine.create({
          data: {
            uuid: 'user3-vm-uuid',
            name: 'user3-vm',
            status: 'running',
            memory: 4096,
            vcpus: 4,
            userId: user3.id
          }
        })

        // Create contexts for each user
        const contexts = [
          { prisma, user: testUser },
          { prisma, user: user2 },
          { prisma, user: user3 }
        ]

        const inputs = [
          {
            machineId: testMachine.id,
            ports: { type: 'SINGLE', value: '80' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          },
          {
            machineId: machine2.id,
            ports: { type: 'SINGLE', value: '443' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          },
          {
            machineId: machine3.id,
            ports: { type: 'RANGE', value: '8000-8002' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          }
        ]

        // Execute mutations concurrently
        const promises = contexts.map((context, index) =>
          graphql({
            schema,
            source: CREATE_ADVANCED_RULE_MUTATION,
            contextValue: context,
            variableValues: { input: inputs[index] }
          })
        )

        const results = await Promise.all(promises)

        // All mutations should succeed
        results.forEach(result => {
          expect(result.errors).toBeUndefined()
          expect(result.data?.createAdvancedFirewallRule).toBeDefined()
        })

        // Each user should receive their respective event
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(3)
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          user2.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          user3.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )
      })
    })

    it('should filter events based on user permissions and machine ownership', async () => {
      await withTransaction(prisma, async ({ testUser }) => {
        // Create another user and their machine
        const otherUser = await prisma.user.create({
          data: {
            username: 'other-user',
            email: 'other@test.com',
            passwordHash: 'hash',
            role: 'USER'
          }
        })

        const otherMachine = await prisma.machine.create({
          data: {
            uuid: 'other-vm-uuid',
            name: 'other-vm',
            status: 'running',
            memory: 1024,
            vcpus: 1,
            userId: otherUser.id
          }
        })

        // testUser tries to create rule on otherUser's machine
        const input = {
          machineId: otherMachine.id,
          ports: {
            type: 'SINGLE',
            value: '22'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const result = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: { prisma, user: testUser },
          variableValues: { input }
        })

        // Should fail due to permissions
        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('permission')

        // No WebSocket event should be sent
        expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
      })
    })

    it('should handle WebSocket events for admin operations affecting multiple users', async () => {
      await withTransaction(prisma, async ({ adminContext }) => {
        // Create department with users and machines
        const department = await prisma.department.create({
          data: { name: 'IT Department', description: 'IT Operations' }
        })

        const users = await Promise.all([
          prisma.user.create({
            data: {
              username: 'it-user1',
              email: 'it1@test.com',
              passwordHash: 'hash1',
              role: 'USER',
              departmentId: department.id
            }
          }),
          prisma.user.create({
            data: {
              username: 'it-user2',
              email: 'it2@test.com',
              passwordHash: 'hash2',
              role: 'USER',
              departmentId: department.id
            }
          })
        ])

        const machines = await Promise.all([
          prisma.machine.create({
            data: {
              uuid: 'it-vm1-uuid',
              name: 'it-vm1',
              status: 'running',
              memory: 2048,
              vcpus: 2,
              userId: users[0].id,
              departmentId: department.id
            }
          }),
          prisma.machine.create({
            data: {
              uuid: 'it-vm2-uuid',
              name: 'it-vm2',
              status: 'running',
              memory: 2048,
              vcpus: 2,
              userId: users[1].id,
              departmentId: department.id
            }
          })
        ])

        // Admin creates department-wide firewall policy
        const DEPARTMENT_POLICY_MUTATION = `
          mutation CreateDepartmentFirewallPolicy($input: CreateDepartmentFirewallPolicyInput!) {
            createDepartmentFirewallPolicy(input: $input) {
              id
              name
              rules { port protocol direction action }
            }
          }
        `

        const policyInput = {
          departmentId: department.id,
          name: 'Standard Web Policy',
          rules: [
            {
              port: '80',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept'
            },
            {
              port: '443',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept'
            }
          ]
        }

        // Mock department policy events
        mockSocketService.sendToDepartment = jest.fn()
        mockSocketService.sendToUsers = jest.fn()

        await graphql({
          schema,
          source: DEPARTMENT_POLICY_MUTATION,
          contextValue: adminContext,
          variableValues: { input: policyInput }
        })

        // Verify department-wide notification
        expect(mockSocketService.sendToDepartment).toHaveBeenCalledWith(
          department.id,
          'vm',
          'firewall:department:policy:created',
          expect.objectContaining({
            data: expect.objectContaining({
              departmentId: department.id,
              policy: expect.objectContaining({
                name: 'Standard Web Policy'
              })
            })
          })
        )

        // Verify individual user notifications for affected machines
        expect(mockSocketService.sendToUsers).toHaveBeenCalledWith(
          [users[0].id, users[1].id],
          'vm',
          'firewall:machines:policy:applied',
          expect.objectContaining({
            data: expect.objectContaining({
              affectedMachines: expect.arrayContaining([
                machines[0].id,
                machines[1].id
              ])
            })
          })
        )
      })
    })
  })

  describe('Cross-Service WebSocket Integration', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should coordinate events between AdvancedFirewallResolver and SimplifiedFirewallResolver', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Create simplified rule first
        const SIMPLIFIED_MUTATION = `
          mutation CreateSimplifiedRule($input: CreateSimplifiedFirewallRuleInput!) {
            createSimplifiedFirewallRule(input: $input) {
              customRules { port protocol }
            }
          }
        `

        const simplifiedInput = {
          machineId: testMachine.id,
          port: '80',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: SIMPLIFIED_MUTATION,
          contextValue: context,
          variableValues: { input: simplifiedInput }
        })

        // Then create advanced rule
        const ADVANCED_MUTATION = `
          mutation CreateAdvancedRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port protocol }
              effectiveRules { port protocol }
            }
          }
        `

        const advancedInput = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '443'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: ADVANCED_MUTATION,
          contextValue: context,
          variableValues: { input: advancedInput }
        })

        // Verify proper event sequence
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(2)

        // First event: simplified rule
        const firstCall = mockSocketService.sendToUser.mock.calls[0]
        expect(firstCall[2]).toBe('firewall:rule:created')
        expect(firstCall[3].data.rules[0].port).toBe('80')

        // Second event: advanced rule with updated effective rules
        const secondCall = mockSocketService.sendToUser.mock.calls[1]
        expect(secondCall[2]).toBe('firewall:advanced:rule:created')
        expect(secondCall[3].data.rules[0].port).toBe('443')
        expect(secondCall[3].data.effectiveRules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ port: '80' }),
            expect.objectContaining({ port: '443' })
          ])
        )
      })
    })

    it('should handle NetworkFilterService events integration', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Mock NetworkFilterService events
        const mockNetworkFilterEvent = jest.fn()
        mockSocketService.emit = mockNetworkFilterEvent

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '22'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          updateNetworkFilter: true
        }

        const MUTATION_WITH_NETWORK_FILTER = `
          mutation CreateRuleWithNetworkFilter($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
              networkFilterApplied
            }
          }
        `

        await graphql({
          schema,
          source: MUTATION_WITH_NETWORK_FILTER,
          contextValue: context,
          variableValues: { input }
        })

        // Verify firewall event was sent
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )

        // Verify network filter event was triggered
        expect(mockNetworkFilterEvent).toHaveBeenCalledWith(
          'network:filter:updated',
          expect.objectContaining({
            machineId: testMachine.id,
            filterId: expect.any(String)
          })
        )
      })
    })

    it('should coordinate with DepartmentFirewallService for cross-service consistency', async () => {
      await withTransaction(prisma, async ({ adminContext }) => {
        // Create department and machines
        const department = await prisma.department.create({
          data: { name: 'Security Department', description: 'Security Team' }
        })

        const user = await prisma.user.create({
          data: {
            username: 'sec-user',
            email: 'sec@test.com',
            passwordHash: 'hash',
            role: 'USER',
            departmentId: department.id
          }
        })

        const machine = await prisma.machine.create({
          data: {
            uuid: 'sec-vm-uuid',
            name: 'sec-vm',
            status: 'running',
            memory: 2048,
            vcpus: 2,
            userId: user.id,
            departmentId: department.id
          }
        })

        // Create department firewall policy first
        const DEPT_POLICY_MUTATION = `
          mutation CreateDepartmentPolicy($input: CreateDepartmentFirewallPolicyInput!) {
            createDepartmentFirewallPolicy(input: $input) {
              rules { port protocol }
            }
          }
        `

        const policyInput = {
          departmentId: department.id,
          name: 'Security Policy',
          rules: [
            {
              port: '22',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept'
            }
          ]
        }

        await graphql({
          schema,
          source: DEPT_POLICY_MUTATION,
          contextValue: adminContext,
          variableValues: { input: policyInput }
        })

        // Then create machine-specific rule
        const MACHINE_RULE_MUTATION = `
          mutation CreateMachineRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
              effectiveRules { port }
              inheritedRules { port }
            }
          }
        `

        const machineInput = {
          machineId: machine.id,
          ports: {
            type: 'SINGLE',
            value: '80'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        await graphql({
          schema,
          source: MACHINE_RULE_MUTATION,
          contextValue: { prisma, user },
          variableValues: { input: machineInput }
        })

        // Verify coordinated events
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          user.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.objectContaining({
            data: expect.objectContaining({
              machineId: machine.id,
              effectiveRules: expect.arrayContaining([
                expect.objectContaining({ port: '22' }), // From department policy
                expect.objectContaining({ port: '80' })  // From machine rule
              ]),
              inheritedRules: expect.arrayContaining([
                expect.objectContaining({ port: '22' })
              ])
            })
          })
        )
      })
    })

    it('should handle FirewallSimplifierService integration for rule optimization events', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Create multiple overlapping rules that can be simplified
        const rules = [
          {
            machineId: testMachine.id,
            ports: { type: 'SINGLE', value: '80' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          },
          {
            machineId: testMachine.id,
            ports: { type: 'SINGLE', value: '81' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          },
          {
            machineId: testMachine.id,
            ports: { type: 'SINGLE', value: '82' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept'
          }
        ]

        const CREATE_RULE_MUTATION = `
          mutation CreateRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        // Create all rules
        for (const rule of rules) {
          await graphql({
            schema,
            source: CREATE_RULE_MUTATION,
            contextValue: context,
            variableValues: { input: rule }
          })
        }

        // Trigger rule optimization
        const OPTIMIZE_MUTATION = `
          mutation OptimizeFirewallRules($machineId: ID!) {
            optimizeFirewallRules(machineId: $machineId) {
              optimizedRules { port }
              optimizationSummary {
                originalCount
                optimizedCount
                savedRules
              }
            }
          }
        `

        await graphql({
          schema,
          source: OPTIMIZE_MUTATION,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        // Verify optimization event was sent
        const optimizationCall = mockSocketService.sendToUser.mock.calls.find(
          call => call[2] === 'firewall:rules:optimized'
        )

        expect(optimizationCall).toBeDefined()
        expect(optimizationCall[3].data).toEqual(
          expect.objectContaining({
            machineId: testMachine.id,
            optimizationSummary: expect.objectContaining({
              originalCount: 3,
              optimizedCount: expect.any(Number),
              savedRules: expect.any(Number)
            })
          })
        )
      })
    })
  })

  describe('Real-Time Event Synchronization', () => {
    beforeEach(() => {
      jest.clearAllMocks()
    })

    it('should maintain event ordering across concurrent operations', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Track event sequence
        const eventSequence: any[] = []
        mockSocketService.sendToUser.mockImplementation((...args) => {
          eventSequence.push({
            event: args[2],
            data: args[3]
          })
        })

        const CREATE_RULE_MUTATION = `
          mutation CreateRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        // Create multiple rules with small delays
        const rules = [
          { ports: { type: 'SINGLE', value: '80' }, protocol: 'tcp' },
          { ports: { type: 'SINGLE', value: '443' }, protocol: 'tcp' },
          { ports: { type: 'SINGLE', value: '22' }, protocol: 'tcp' }
        ]

        for (const [index, rule] of rules.entries()) {
          const input = {
            machineId: testMachine.id,
            ...rule,
            direction: 'in',
            action: 'accept'
          }

          await graphql({
            schema,
            source: CREATE_RULE_MUTATION,
            contextValue: context,
            variableValues: { input }
          })

          // Small delay to ensure ordering
          await new Promise(resolve => setTimeout(resolve, 10))
        }

        // Verify events are in correct order
        expect(eventSequence).toHaveLength(3)
        expect(eventSequence[0].data.data.rules[0].port).toBe('80')
        expect(eventSequence[1].data.data.rules[0].port).toBe('443')
        expect(eventSequence[2].data.data.rules[0].port).toBe('22')

        // Verify event order is maintained
        expect(eventSequence[0].event).toBe('firewall:advanced:rule:created')
        expect(eventSequence[1].event).toBe('firewall:advanced:rule:created')
        expect(eventSequence[2].event).toBe('firewall:advanced:rule:created')
      })
    })

    it('should handle event deduplication for rapid successive operations', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Create and immediately update the same rule
        const CREATE_MUTATION = `
          mutation CreateRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        const UPDATE_MUTATION = `
          mutation UpdateRule($input: UpdateAdvancedFirewallRuleInput!) {
            updateAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        const createInput = {
          machineId: testMachine.id,
          ports: { type: 'SINGLE', value: '3000' },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        // Create rule
        const createResult = await graphql({
          schema,
          source: CREATE_MUTATION,
          contextValue: context,
          variableValues: { input: createInput }
        })

        // Immediately update it
        const updateInput = {
          ruleId: 'rule-id', // Would be extracted from create result
          action: 'reject' // Change action
        }

        await graphql({
          schema,
          source: UPDATE_MUTATION,
          contextValue: context,
          variableValues: { input: updateInput }
        })

        // Should receive both events but with correct sequencing
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(2)

        const calls = mockSocketService.sendToUser.mock.calls
        expect(calls[0][2]).toBe('firewall:advanced:rule:created')
        expect(calls[1][2]).toBe('firewall:advanced:rule:updated')

        // Update event should reflect the final state
        expect(calls[1][3].data.rules[0].action).toBe('reject')
      })
    })

    it('should synchronize state across multiple WebSocket connections per user', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Mock multiple connections for the same user
        const connectionIds = ['conn1', 'conn2', 'conn3']
        mockSocketService.getUserConnections = jest.fn().mockReturnValue(connectionIds)
        mockSocketService.sendToConnection = jest.fn()

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '4000'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const CREATE_MUTATION = `
          mutation CreateRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
              effectiveRules { port }
            }
          }
        `

        await graphql({
          schema,
          source: CREATE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Verify event sent to all user connections
        expect(mockSocketService.sendToConnection).toHaveBeenCalledTimes(3)
        connectionIds.forEach((connId, index) => {
          expect(mockSocketService.sendToConnection).toHaveBeenNthCalledWith(
            index + 1,
            connId,
            'vm',
            'firewall:advanced:rule:created',
            expect.objectContaining({
              data: expect.objectContaining({
                machineId: testMachine.id
              })
            })
          )
        })
      })
    })

    it('should handle WebSocket reconnection scenarios', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Mock user connection status changes
        let isConnected = true
        mockSocketService.isUserConnected.mockImplementation(() => isConnected)
        mockSocketService.queueEventForReconnection = jest.fn()

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '5000'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const CREATE_MUTATION = `
          mutation CreateRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
            }
          }
        `

        // User disconnects
        isConnected = false

        await graphql({
          schema,
          source: CREATE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Event should be queued for reconnection
        expect(mockSocketService.queueEventForReconnection).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )

        // User reconnects
        isConnected = true
        mockSocketService.flushQueuedEvents = jest.fn()

        // Simulate reconnection event
        await graphql({
          schema,
          source: `query { __typename }`,
          contextValue: context
        })

        // Queued events should be flushed
        expect(mockSocketService.flushQueuedEvents).toHaveBeenCalledWith(testUser.id)
      })
    })
  })
})
