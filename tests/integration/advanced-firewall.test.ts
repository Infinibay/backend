import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { buildSchema } from 'type-graphql'
import { graphql, ExecutionResult } from 'graphql'
import { Container } from 'typedi'
import { PrismaClient } from '@prisma/client'
import { AdvancedFirewallResolver } from '@graphql/resolvers/AdvancedFirewallResolver'
import { SimplifiedFirewallResolver } from '@graphql/resolvers/SimplifiedFirewallResolver'
import { withTransaction } from '../setup/test-helpers'

// Mock SocketService
const mockSocketService = {
  sendToUser: jest.fn()
}

jest.mock('@services/SocketService', () => ({
  getSocketService: () => mockSocketService
}))

// Mock libvirt-node
jest.mock('libvirt-node')

describe('AdvancedFirewallResolver Integration', () => {
  let schema: any
  let prisma: PrismaClient

  beforeAll(async () => {
    // Create schema with both resolvers once for all tests
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

  // Helper function to run tests in isolated transactions
  const runTestInTransaction = async (testFn: (params: {
    testUser: any,
    testMachine: any,
    context: any
  }) => Promise<void>) => {
    await withTransaction(prisma, testFn)
  }

  describe('createAdvancedFirewallRule Integration', () => {
    const CREATE_ADVANCED_RULE_MUTATION = `
      mutation CreateAdvancedFirewallRule($input: CreateAdvancedFirewallRuleInput!) {
        createAdvancedFirewallRule(input: $input) {
          appliedTemplates
          customRules {
            port
            protocol
            direction
            action
            description
            sources
          }
          effectiveRules {
            port
            protocol
            direction
            action
            description
          }
          lastSync
        }
      }
    `

    it('should create single port rule end-to-end', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
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

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()

        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0]).toMatchObject({
          port: '80',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Allow HTTP traffic'
        })
        expect(state.effectiveRules).toContain(
          expect.objectContaining({
            port: '80',
            protocol: 'tcp'
          })
        )

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
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

    it('should create port range rule end-to-end', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'RANGE',
            value: '8080-8090',
            description: 'App server range'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Application server ports'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()

        const state = result.data?.createAdvancedFirewallRule
        // Should create multiple rules for the range
        expect(state.customRules.length).toBeGreaterThan(1)

        // Check that range ports are included
        const ports = state.customRules.map((rule: any) => parseInt(rule.port))
        expect(ports).toContain(8080)
        expect(ports).toContain(8090)

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.anything()
        )
      })
    })

    it('should create multiple ports rule end-to-end', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'MULTIPLE',
            value: '80,443,8080',
            description: 'Web services'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Web server ports'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()

        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(3)

        const ports = state.customRules.map((rule: any) => rule.port)
        expect(ports).toContain('80')
        expect(ports).toContain('443')
        expect(ports).toContain('8080')

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(1)
      })
    })

    it('should handle "all" ports correctly', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'ALL',
            value: 'all',
            description: 'All ports'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Allow all TCP traffic'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()

        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0].port).toBe('all')
      })
    })

    it('should emit correct WebSocket events', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '22',
            description: 'SSH port'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'SSH access'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Verify WebSocket event structure
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          {
            data: {
              machineId: testMachine.id,
              rules: expect.any(Array),
              state: expect.objectContaining({
                appliedTemplates: expect.any(Array),
                customRules: expect.any(Array),
                effectiveRules: expect.any(Array)
              })
            }
          }
        )
      })
    })

    it('should enforce authorization correctly', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Create another user
        const otherUser = await context.prisma.user.create({
          data: createMockUser()
        })

        const unauthorizedContext = {
          ...context,
          user: otherUser
        }

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: unauthorizedContext,
          variableValues: { input }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Machine not found or access denied')
      })
    })

    it('should handle invalid port formats', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: 'invalid-port'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Invalid port')
      })
    })
  })

  describe('createPortRangeRule Integration', () => {
    const CREATE_PORT_RANGE_MUTATION = `
      mutation CreatePortRangeRule(
        $machineId: ID!
        $startPort: Int!
        $endPort: Int!
        $protocol: String!
        $direction: String!
        $action: String!
        $description: String
      ) {
        createPortRangeRule(
          machineId: $machineId
          startPort: $startPort
          endPort: $endPort
          protocol: $protocol
          direction: $direction
          action: $action
          description: $description
        ) {
          appliedTemplates
          customRules {
            port
            protocol
            direction
            action
            description
          }
          effectiveRules {
            port
            protocol
            direction
            action
          }
        }
      }
    `

    it('should create single port when start equals end', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        const variables = {
          machineId: testMachine.id,
          startPort: 80,
          endPort: 80,
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTP port'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_PORT_RANGE_MUTATION,
          contextValue: context,
          variableValues: variables
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createPortRangeRule).toBeDefined()

        const state = result.data?.createPortRangeRule
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0].port).toBe('80')
      })
    })

    it('should create port range correctly', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        const variables = {
          machineId: testMachine.id,
          startPort: 8000,
          endPort: 8002,
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Development servers'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_PORT_RANGE_MUTATION,
          contextValue: context,
          variableValues: variables
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createPortRangeRule).toBeDefined()

        const state = result.data?.createPortRangeRule
        expect(state.customRules).toHaveLength(3) // 8000, 8001, 8002

        const ports = state.customRules.map((rule: any) => parseInt(rule.port)).sort()
        expect(ports).toEqual([8000, 8001, 8002])
      })
    })

    it('should validate port boundaries', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        const variables = {
          machineId: testMachine.id,
          startPort: 0,
          endPort: 80,
          protocol: 'tcp',
          direction: 'in',
          action: 'accept'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_PORT_RANGE_MUTATION,
          contextValue: context,
          variableValues: variables
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Invalid port range')
      })
    })

    it('should emit correct WebSocket events', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        const variables = {
          machineId: testMachine.id,
          startPort: 9000,
          endPort: 9001,
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Test range'
        }

        await graphql({
          schema,
          source: CREATE_PORT_RANGE_MUTATION,
          contextValue: context,
          variableValues: variables
        })

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:range:rule:created',
          expect.objectContaining({
            data: expect.objectContaining({
              machineId: testMachine.id
            })
          })
        )
      })
    })
  })

  describe('Firewall Resolver Compatibility', () => {
    it('should work alongside SimplifiedFirewallResolver', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // First create a rule using SimplifiedFirewallResolver
        const simplifiedMutation = `
          mutation CreateSimplifiedRule($input: CreateSimplifiedFirewallRuleInput!) {
            createSimplifiedFirewallRule(input: $input) {
              customRules {
                port
                protocol
                sources
              }
            }
          }
        `

        const simplifiedInput = {
          machineId: testMachine.id,
          port: '443',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTPS via simplified'
        }

        const simplifiedResult: ExecutionResult = await graphql({
          schema,
          source: simplifiedMutation,
          contextValue: context,
          variableValues: { input: simplifiedInput }
        })

        expect(simplifiedResult.errors).toBeUndefined()

        // Then create a rule using AdvancedFirewallResolver
        const advancedMutation = `
          mutation CreateAdvancedRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules {
                port
                protocol
                sources
              }
            }
          }
        `

        const advancedInput = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80',
            description: 'HTTP port'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTP via advanced'
        }

        const advancedResult: ExecutionResult = await graphql({
          schema,
          source: advancedMutation,
          contextValue: context,
          variableValues: { input: advancedInput }
        })

        expect(advancedResult.errors).toBeUndefined()

        // Check that both rules exist
        const finalState = advancedResult.data?.createAdvancedFirewallRule
        expect(finalState.customRules).toHaveLength(2)

        const ports = finalState.customRules.map((rule: any) => rule.port)
        expect(ports).toContain('443')
        expect(ports).toContain('80')

        // Verify different sources
        const sources = finalState.customRules.map((rule: any) => rule.sources)
        expect(sources).toContainEqual(['custom']) // Simplified rule
        expect(sources).toContainEqual(['advanced']) // Advanced rule
      })
    })

    it('should maintain consistent state across resolvers', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Create rules using both resolvers
        const simplifiedMutation = `
          mutation CreateSimplifiedRule($input: CreateSimplifiedFirewallRuleInput!) {
            createSimplifiedFirewallRule(input: $input) {
              appliedTemplates
              customRules { port }
              effectiveRules { port }
            }
          }
        `

        const advancedMutation = `
          mutation CreateAdvancedRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              appliedTemplates
              customRules { port }
              effectiveRules { port }
            }
          }
        `

        // Create simplified rule
        await graphql({
          schema,
          source: simplifiedMutation,
          contextValue: context,
          variableValues: {
            input: {
              machineId: testMachine.id,
              port: '22',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept'
            }
          }
        })

        // Create advanced rule and check state consistency
        const result: ExecutionResult = await graphql({
          schema,
          source: advancedMutation,
          contextValue: context,
          variableValues: {
            input: {
              machineId: testMachine.id,
              ports: {
                type: 'SINGLE',
                value: '80'
              },
              protocol: 'tcp',
              direction: 'in',
              action: 'accept'
            }
          }
        })

        expect(result.errors).toBeUndefined()

        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(2)
        expect(state.effectiveRules.length).toBeGreaterThanOrEqual(2)

        // Effective rules should include both custom rules
        const effectivePorts = state.effectiveRules.map((rule: any) => rule.port)
        expect(effectivePorts).toContain('22')
        expect(effectivePorts).toContain('80')
      })
    })
  })
})
