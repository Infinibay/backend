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

  describe('WebSocket Performance', () => {
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

        const startTime = Date.now()
        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })
        const endTime = Date.now()

        // Mutation should complete successfully
        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()
        expect(result.data?.createAdvancedFirewallRule.customRules).toHaveLength(1)
        expect(result.data?.createAdvancedFirewallRule.customRules[0].port).toBe('8080')

        // Should not take too long (no blocking on WebSocket failure)
        expect(endTime - startTime).toBeLessThan(1000)
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
})