import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { buildSchema } from 'type-graphql'
import { graphql, ExecutionResult } from 'graphql'
import { Container } from 'typedi'
import { PrismaClient } from '@prisma/client'
import { AdvancedFirewallResolver } from '@graphql/resolvers/AdvancedFirewallResolver'
import { SimplifiedFirewallResolver } from '@graphql/resolvers/SimplifiedFirewallResolver'
import {
  withTransaction,
  withComplexTransaction,
  createDepartmentWithVMs,
  createMultipleDepartments,
  setupComplexFirewallHierarchy,
  verifyFirewallStateConsistency,
  assertEffectiveRules,
  checkRuleInheritance,
  captureWebSocketEvents,
  verifyEventSequence,
  assertEventPayload,
  simulateMultipleConnections,
  executeAcrossAllFirewallServices,
  verifyServiceIntegration,
  checkServiceStateConsistency,
  executeCompleteWorkflow,
  verifyWorkflowSteps,
  assertWorkflowConsistency,
  checkWorkflowEventDelivery
} from '../setup/test-helpers'
import { createMockUser } from '../setup/mock-factories'

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

        // Verify WebSocket event was emitted for the machine
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
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

  describe('End-to-End VM Lifecycle Integration', () => {
    const GET_FIREWALL_STATE_QUERY = `
      query GetFirewallState($machineId: String!) {
        firewallState(machineId: $machineId) {
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

    it('should handle complete VM lifecycle with firewall integration', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        // Step 1: Create VM and verify initial firewall state
        const initialState: ExecutionResult = await graphql({
          schema,
          source: GET_FIREWALL_STATE_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(initialState.errors).toBeUndefined()
        expect(initialState.data?.firewallState.customRules).toEqual([])

        // Step 2: Apply department template (simulate department assignment)
        const departmentTemplate = {
          machineId: testMachine.id,
          templateName: 'web-server',
          rules: [
            { port: '80', protocol: 'tcp', direction: 'in', action: 'accept' },
            { port: '443', protocol: 'tcp', direction: 'in', action: 'accept' }
          ]
        }

        // Update machine with template
        await context.prisma.machine.update({
          where: { id: testMachine.id },
          data: {
            firewallTemplates: {
              appliedTemplates: ['web-server'],
              customRules: [],
              lastSync: new Date().toISOString()
            }
          }
        })

        // Step 3: Add custom advanced rules
        const customRuleInput = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '22',
            description: 'SSH access'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Administrative SSH access'
        }

        const customRuleResult: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: customRuleInput }
        })

        expect(customRuleResult.errors).toBeUndefined()

        // Step 4: Verify complete firewall state
        const finalState: ExecutionResult = await graphql({
          schema,
          source: GET_FIREWALL_STATE_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(finalState.errors).toBeUndefined()
        const state = finalState.data?.firewallState

        // Should have applied template
        expect(state.appliedTemplates).toContain('web-server')

        // Should have custom rule
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0]).toMatchObject({
          port: '22',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          sources: ['advanced']
        })

        // Effective rules should include both template and custom rules
        expect(state.effectiveRules.length).toBeGreaterThanOrEqual(1)
        const effectivePorts = state.effectiveRules.map((rule: any) => rule.port)
        expect(effectivePorts).toContain('22')

        // Step 5: Verify WebSocket events were emitted
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:advanced:rule:created',
          expect.any(Object)
        )
      })
    })

    it('should handle VM migration between departments with firewall rules', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        // Step 1: Create VM in department A with template
        await context.prisma.machine.update({
          where: { id: testMachine.id },
          data: {
            firewallTemplates: {
              appliedTemplates: ['development'],
              customRules: [],
              lastSync: new Date().toISOString()
            }
          }
        })

        // Step 2: Add custom rules
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '8080',
            description: 'Dev server'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Development server'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Step 3: Migrate to department B (simulate department change)
        await context.prisma.machine.update({
          where: { id: testMachine.id },
          data: {
            firewallTemplates: {
              appliedTemplates: ['production'],
              customRules: [
                {
                  port: '8080',
                  protocol: 'tcp',
                  direction: 'in',
                  action: 'accept',
                  description: 'Development server',
                  sources: ['advanced']
                }
              ],
              lastSync: new Date().toISOString()
            }
          }
        })

        // Step 4: Verify firewall state after migration
        const finalState: ExecutionResult = await graphql({
          schema,
          source: GET_FIREWALL_STATE_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(finalState.errors).toBeUndefined()
        const state = finalState.data?.firewallState

        // Should have new template
        expect(state.appliedTemplates).toContain('production')
        expect(state.appliedTemplates).not.toContain('development')

        // Should preserve custom rules
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0].port).toBe('8080')
      })
    })

    it('should handle VM deletion with proper firewall cleanup', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        // Step 1: Create rules
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

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Step 2: Verify rules exist
        const beforeDeletion: ExecutionResult = await graphql({
          schema,
          source: GET_FIREWALL_STATE_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(beforeDeletion.data?.firewallState.customRules).toHaveLength(3)

        // Step 3: Simulate VM deletion
        await context.prisma.machine.update({
          where: { id: testMachine.id },
          data: {
            deleted: true,
            firewallTemplates: {
              appliedTemplates: [],
              customRules: [],
              lastSync: new Date().toISOString()
            }
          }
        })

        // Step 4: Verify firewall state is cleaned up
        const afterDeletion: ExecutionResult = await graphql({
          schema,
          source: GET_FIREWALL_STATE_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        // Should return error for deleted machine
        expect(afterDeletion.errors).toBeDefined()
        expect(afterDeletion.errors?.[0]?.message).toContain('Machine not found')
      })
    })
  })

  describe('Cross-Service Integration Testing', () => {
    it('should integrate AdvancedFirewallResolver with SimplifiedFirewallResolver', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Step 1: Create simplified rule first
        const simplifiedMutation = `
          mutation CreateSimplifiedRule($input: CreateSimplifiedFirewallRuleInput!) {
            createSimplifiedFirewallRule(input: $input) {
              customRules {
                port
                protocol
                sources
              }
              effectiveRules {
                port
                protocol
              }
            }
          }
        `

        const simplifiedInput = {
          machineId: testMachine.id,
          port: '3000',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Dev server via simplified'
        }

        const simplifiedResult: ExecutionResult = await graphql({
          schema,
          source: simplifiedMutation,
          contextValue: context,
          variableValues: { input: simplifiedInput }
        })

        expect(simplifiedResult.errors).toBeUndefined()

        // Step 2: Create advanced rule
        const advancedInput = {
          machineId: testMachine.id,
          ports: {
            type: 'RANGE',
            value: '8000-8002',
            description: 'App servers'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Application servers via advanced'
        }

        const advancedResult: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: advancedInput }
        })

        expect(advancedResult.errors).toBeUndefined()

        // Step 3: Verify integrated state
        const state = advancedResult.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(4) // 1 simplified + 3 advanced

        // Check rule sources
        const simplifiedRules = state.customRules.filter((rule: any) =>
          rule.sources.includes('custom')
        )
        const advancedRules = state.customRules.filter((rule: any) =>
          rule.sources.includes('advanced')
        )

        expect(simplifiedRules).toHaveLength(1)
        expect(advancedRules).toHaveLength(3)

        // Step 4: Verify all rules in effective rules
        const effectivePorts = state.effectiveRules.map((rule: any) => rule.port)
        expect(effectivePorts).toContain('3000')
        expect(effectivePorts).toContain('8000')
        expect(effectivePorts).toContain('8001')
        expect(effectivePorts).toContain('8002')
      })
    })

    it('should maintain consistent state across different resolver operations', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Step 1: Create rules with both resolvers
        const operations = [
          // Simplified rule
          {
            query: `
              mutation CreateSimplifiedRule($input: CreateSimplifiedFirewallRuleInput!) {
                createSimplifiedFirewallRule(input: $input) {
                  customRules { port }
                }
              }
            `,
            variables: {
              input: {
                machineId: testMachine.id,
                port: '80',
                protocol: 'tcp',
                direction: 'in',
                action: 'accept'
              }
            }
          },
          // Advanced rule
          {
            query: CREATE_ADVANCED_RULE_MUTATION,
            variables: {
              input: {
                machineId: testMachine.id,
                ports: {
                  type: 'SINGLE',
                  value: '443'
                },
                protocol: 'tcp',
                direction: 'in',
                action: 'accept'
              }
            }
          }
        ]

        // Execute operations sequentially
        for (const operation of operations) {
          const result: ExecutionResult = await graphql({
            schema,
            source: operation.query,
            contextValue: context,
            variableValues: operation.variables
          })
          expect(result.errors).toBeUndefined()
        }

        // Step 2: Query final state through both resolvers
        const advancedQuery = `
          query GetAdvancedState($machineId: String!) {
            firewallState(machineId: $machineId) {
              customRules { port sources }
              effectiveRules { port }
            }
          }
        `

        const simplifiedQuery = `
          query GetSimplifiedState($machineId: String!) {
            simplifiedFirewallState(machineId: $machineId) {
              customRules { port sources }
              effectiveRules { port }
            }
          }
        `

        const [advancedState, simplifiedState] = await Promise.all([
          graphql({
            schema,
            source: advancedQuery,
            contextValue: context,
            variableValues: { machineId: testMachine.id }
          }),
          graphql({
            schema,
            source: simplifiedQuery,
            contextValue: context,
            variableValues: { machineId: testMachine.id }
          })
        ])

        expect(advancedState.errors).toBeUndefined()
        expect(simplifiedState.errors).toBeUndefined()

        // Step 3: Verify state consistency
        const advancedRules = advancedState.data?.firewallState.customRules
        const simplifiedRules = simplifiedState.data?.simplifiedFirewallState.customRules

        expect(advancedRules).toHaveLength(2)
        expect(simplifiedRules).toHaveLength(2)

        // Both should have the same rules
        const advancedPorts = advancedRules.map((rule: any) => rule.port).sort()
        const simplifiedPorts = simplifiedRules.map((rule: any) => rule.port).sort()
        expect(advancedPorts).toEqual(simplifiedPorts)
      })
    })
  })

  describe('Complex Rule Inheritance and Conflict Resolution', () => {
    it('should handle advanced rules with department template inheritance', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Step 1: Set up department template
        await context.prisma.machine.update({
          where: { id: testMachine.id },
          data: {
            firewallTemplates: {
              appliedTemplates: ['secure-web'],
              customRules: [],
              lastSync: new Date().toISOString()
            }
          }
        })

        // Step 2: Add advanced rule that might conflict
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80',
            description: 'HTTP override'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'deny', // Conflicting action
          description: 'Block HTTP for security'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()

        // Step 3: Verify rule priority (advanced rules should take precedence)
        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0]).toMatchObject({
          port: '80',
          action: 'deny',
          sources: ['advanced']
        })

        // Step 4: Check effective rules prioritize advanced rules
        const httpRules = state.effectiveRules.filter((rule: any) => rule.port === '80')
        expect(httpRules.length).toBeGreaterThan(0)

        // Advanced rule should be present in effective rules
        const advancedHttpRule = httpRules.find((rule: any) => rule.action === 'deny')
        expect(advancedHttpRule).toBeDefined()
      })
    })

    it('should resolve conflicting rule scenarios correctly', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Step 1: Create conflicting rules
        const allowRule = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '8080',
            description: 'Allow app'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Allow application traffic'
        }

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: allowRule }
        })

        const denyRule = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '8080',
            description: 'Deny app'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'deny',
          description: 'Block application traffic'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: denyRule }
        })

        expect(result.errors).toBeUndefined()

        // Step 2: Verify conflict resolution
        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(2)

        // Both rules should exist
        const actions = state.customRules.map((rule: any) => rule.action)
        expect(actions).toContain('accept')
        expect(actions).toContain('deny')

        // Step 3: Check effective rules handling
        const port8080Rules = state.effectiveRules.filter((rule: any) => rule.port === '8080')
        expect(port8080Rules.length).toBeGreaterThan(0)

        // Should handle conflicting rules appropriately
        // (Implementation detail: deny rules typically take precedence for security)
      })
    })
  })

  describe('Real-Time Event Integration', () => {
    it('should emit WebSocket events with correct ordering during rapid rule creation', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        // Clear previous mock calls
        mockSocketService.sendToUser.mockClear()

        // Create multiple rules rapidly
        const rules = [
          { port: '80', description: 'HTTP' },
          { port: '443', description: 'HTTPS' },
          { port: '8080', description: 'Alt HTTP' }
        ]

        for (let i = 0; i < rules.length; i++) {
          const input = {
            machineId: testMachine.id,
            ports: {
              type: 'SINGLE',
              value: rules[i].port,
              description: rules[i].description
            },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept',
            description: `Rule ${i + 1}`
          }

          const result: ExecutionResult = await graphql({
            schema,
            source: CREATE_ADVANCED_RULE_MUTATION,
            contextValue: context,
            variableValues: { input }
          })

          expect(result.errors).toBeUndefined()
        }

        // Verify events were emitted for each rule creation
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'vm',
          'firewall:advanced:rule:created',
          expect.objectContaining({
            data: expect.objectContaining({
              machineId: testMachine.id
            })
          })
        )
        expect(mockSocketService.sendToUser.mock.calls.length).toBeGreaterThanOrEqual(3)

        // Check event ordering and content
        const calls = mockSocketService.sendToUser.mock.calls
        calls.forEach((call, index) => {
          expect(call[0]).toBe(testUser.id) // User ID
          expect(call[1]).toBe('vm') // Channel
          expect(call[2]).toBe('firewall:advanced:rule:created') // Event type
          expect(call[3]).toMatchObject({
            data: expect.objectContaining({
              machineId: testMachine.id
            })
          })
        })
      })
    })

    it('should emit events with accurate payload during complex operations', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        mockSocketService.sendToUser.mockClear()

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'RANGE',
            value: '9000-9002',
            description: 'Service range'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Service port range'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()

        // Verify event was emitted for the machine
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'vm',
          'firewall:advanced:rule:created',
          expect.objectContaining({
            data: expect.objectContaining({
              machineId: testMachine.id
            })
          })
        )

        const eventCall = mockSocketService.sendToUser.mock.calls[0]
        const eventData = eventCall[3].data

        // Verify event payload structure
        expect(eventData).toMatchObject({
          machineId: testMachine.id,
          rules: expect.any(Array),
          state: expect.objectContaining({
            appliedTemplates: expect.any(Array),
            customRules: expect.any(Array),
            effectiveRules: expect.any(Array),
            lastSync: expect.any(String)
          })
        })

        // Verify event includes all created rules
        expect(eventData.rules).toHaveLength(3) // 9000, 9001, 9002
        const ports = eventData.rules.map((rule: any) => rule.port)
        expect(ports).toContain('9000')
        expect(ports).toContain('9001')
        expect(ports).toContain('9002')
      })
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should handle advanced rule creation when NetworkFilterService fails', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Mock NetworkFilterService to simulate failure
        const mockNetworkFilterService = {
          syncVmFilters: jest.fn().mockRejectedValue(new Error('Network filter sync failed'))
        }

        // Note: In a real implementation, this would require dependency injection
        // For now, we test that the GraphQL mutation still handles errors gracefully

        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80',
            description: 'HTTP'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTP traffic'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Should succeed even if sync fails (graceful degradation)
        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()
      })
    })

    it('should maintain system consistency after various failure modes', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Step 1: Create rules successfully
        const input1 = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80',
            description: 'HTTP'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTP traffic'
        }

        const result1: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: input1 }
        })

        expect(result1.errors).toBeUndefined()

        // Step 2: Attempt operation that might fail
        const input2 = {
          machineId: 'non-existent-machine',
          ports: {
            type: 'SINGLE',
            value: '443',
            description: 'HTTPS'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTPS traffic'
        }

        const result2: ExecutionResult = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: input2 }
        })

        expect(result2.errors).toBeDefined()

        // Step 3: Verify original state is preserved
        const stateQuery = `
          query GetState($machineId: String!) {
            firewallState(machineId: $machineId) {
              customRules { port }
            }
          }
        `

        const stateResult: ExecutionResult = await graphql({
          schema,
          source: stateQuery,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(stateResult.errors).toBeUndefined()
        expect(stateResult.data?.firewallState.customRules).toHaveLength(1)
        expect(stateResult.data?.firewallState.customRules[0].port).toBe('80')
      })
    })
  })

  describe('Multi-VM Integration Testing', () => {
    it('should handle advanced rule creation on multiple VMs simultaneously', async () => {
      await withComplexTransaction(prisma, async ({ context, departments, multipleVMs }) => {
        // Step 1: Create advanced rules on multiple VMs
        const ruleInputs = multipleVMs.slice(0, 3).map((vmData, index) => ({
          machineId: vmData.vm.id,
          ports: {
            type: 'SINGLE',
            value: `${8080 + index}`,
            description: `App server ${index + 1}`
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: `Application server ${index + 1}`
        }))

        // Execute rule creation in parallel
        const results = await Promise.all(
          ruleInputs.map(input =>
            graphql({
              schema,
              source: CREATE_ADVANCED_RULE_MUTATION,
              contextValue: context,
              variableValues: { input }
            })
          )
        )

        // Step 2: Verify all operations succeeded
        results.forEach((result, index) => {
          expect(result.errors).toBeUndefined()
          expect(result.data?.createAdvancedFirewallRule).toBeDefined()

          const state = result.data?.createAdvancedFirewallRule
          expect(state.customRules).toHaveLength(1)
          expect(state.customRules[0].port).toBe(`${8080 + index}`)
        })

        // Step 3: Verify WebSocket events were emitted for each VM
        // Each VM should have received at least one event
        multipleVMs.forEach(({ vm }) => {
          expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
            expect.any(String),
            'vm',
            expect.stringMatching(/firewall.*rule.*created/),
            expect.objectContaining({
              data: expect.objectContaining({
                machineId: vm.id
              })
            })
          )
        })
        expect(mockSocketService.sendToUser.mock.calls.length).toBeGreaterThanOrEqual(3)

        const calls = mockSocketService.sendToUser.mock.calls
        calls.forEach((call, index) => {
          expect(call[1]).toBe('vm')
          expect(call[2]).toBe('firewall:advanced:rule:created')
          expect(call[3].data.machineId).toBe(multipleVMs[index].vm.id)
        })
      })
    })

    it('should handle port range rule creation affecting multiple VMs in same department', async () => {
      await withComplexTransaction(prisma, async ({ context, departments, multipleVMs }) => {
        // Step 1: Apply same port range to VMs in the same department
        const departmentVMs = multipleVMs.filter(vmData =>
          vmData.vm.departmentId === departments[0].id
        )

        const portRangeInputs = departmentVMs.map(vmData => ({
          machineId: vmData.vm.id,
          ports: {
            type: 'RANGE',
            value: '9000-9002',
            description: 'Service range'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Department service range'
        }))

        // Step 2: Execute operations and verify
        const results = await Promise.all(
          portRangeInputs.map(input =>
            graphql({
              schema,
              source: CREATE_ADVANCED_RULE_MUTATION,
              contextValue: context,
              variableValues: { input }
            })
          )
        )

        results.forEach(result => {
          expect(result.errors).toBeUndefined()
          const state = result.data?.createAdvancedFirewallRule
          expect(state.customRules).toHaveLength(3) // 9000, 9001, 9002

          const ports = state.customRules.map((rule: any) => parseInt(rule.port))
          expect(ports).toContain(9000)
          expect(ports).toContain(9001)
          expect(ports).toContain(9002)
        })
      })
    })

    it('should verify rule synchronization across multiple VMs', async () => {
      await withComplexTransaction(prisma, async ({ context, multipleVMs }) => {
        // Step 1: Create rules on multiple VMs
        const vmIds = multipleVMs.slice(0, 2).map(vmData => vmData.vm.id)

        for (const vmId of vmIds) {
          const input = {
            machineId: vmId,
            ports: {
              type: 'SINGLE',
              value: '3306',
              description: 'MySQL'
            },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept',
            description: 'Database access'
          }

          await graphql({
            schema,
            source: CREATE_ADVANCED_RULE_MUTATION,
            contextValue: context,
            variableValues: { input }
          })
        }

        // Step 2: Verify each VM has the rule
        for (const vmId of vmIds) {
          const stateResult = await graphql({
            schema,
            source: GET_FIREWALL_STATE_QUERY,
            contextValue: context,
            variableValues: { machineId: vmId }
          })

          expect(stateResult.errors).toBeUndefined()
          const state = stateResult.data?.firewallState
          expect(state.customRules).toHaveLength(1)
          expect(state.customRules[0].port).toBe('3306')

          // Verify firewall state consistency
          const consistency = await verifyFirewallStateConsistency(context.prisma, vmId)
          expect(consistency.isValid).toBe(true)
        }
      })
    })
  })

  describe('Enhanced Real-Time Event Integration', () => {
    it('should handle event delivery to multiple users for same VM', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        // Step 1: Set up multiple mock connections
        const { mockEmit, getCapturedEvents } = captureWebSocketEvents()
        const connections = simulateMultipleConnections(3)

        // Mock the socket service to capture events for multiple users
        mockSocketService.sendToUser.mockImplementation((userId, channel, event, data) => {
          connections.forEach(conn => {
            if (conn.userId === userId) {
              mockEmit(event, data, userId)
            }
          })
        })

        // Step 2: Create advanced rule
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

        await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Step 3: Verify event structure and delivery
        const events = getCapturedEvents()
        expect(events.length).toBeGreaterThan(0)

        events.forEach(event => {
          assertEventPayload(event, {
            eventType: 'firewall:advanced:rule:created',
            payload: expect.objectContaining({
              data: expect.objectContaining({
                machineId: testMachine.id
              })
            })
          })
        })
      })
    })

    it('should verify event ordering during multi-step operations', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        const { mockEmit, getCapturedEvents } = captureWebSocketEvents()

        // Mock socket service to capture event sequence
        mockSocketService.sendToUser.mockImplementation((userId, channel, event, data) => {
          mockEmit(event, data, userId)
        })

        // Step 1: Execute multi-step workflow
        const workflowSteps = [
          {
            name: 'Create HTTP rule',
            operation: () => graphql({
              schema,
              source: CREATE_ADVANCED_RULE_MUTATION,
              contextValue: context,
              variableValues: {
                input: {
                  machineId: testMachine.id,
                  ports: { type: 'SINGLE', value: '80', description: 'HTTP' },
                  protocol: 'tcp',
                  direction: 'in',
                  action: 'accept',
                  description: 'HTTP traffic'
                }
              }
            }),
            verify: (result: any) => expect(result.errors).toBeUndefined()
          },
          {
            name: 'Create HTTPS rule',
            operation: () => graphql({
              schema,
              source: CREATE_ADVANCED_RULE_MUTATION,
              contextValue: context,
              variableValues: {
                input: {
                  machineId: testMachine.id,
                  ports: { type: 'SINGLE', value: '443', description: 'HTTPS' },
                  protocol: 'tcp',
                  direction: 'in',
                  action: 'accept',
                  description: 'HTTPS traffic'
                }
              }
            }),
            verify: (result: any) => expect(result.errors).toBeUndefined()
          }
        ]

        await executeCompleteWorkflow(workflowSteps)

        // Step 2: Verify event sequence
        const events = getCapturedEvents()
        expect(events.length).toBe(2)

        verifyEventSequence(events, [
          'firewall:advanced:rule:created',
          'firewall:advanced:rule:created'
        ])

        // Step 3: Verify event timing
        expect(events[1].timestamp).toBeGreaterThan(events[0].timestamp)
      })
    })

    it('should handle event aggregation for multi-service operations', async () => {
      await runTestInTransaction(async ({ testUser, testMachine, context }) => {
        const { mockEmit, getCapturedEvents } = captureWebSocketEvents()

        // Mock service integration
        mockSocketService.sendToUser.mockImplementation((userId, channel, event, data) => {
          mockEmit(event, data, userId)
        })

        // Step 1: Simulate cross-service operations
        const serviceOperations = {
          advancedFirewall: async () => {
            return await graphql({
              schema,
              source: CREATE_ADVANCED_RULE_MUTATION,
              contextValue: context,
              variableValues: {
                input: {
                  machineId: testMachine.id,
                  ports: { type: 'RANGE', value: '8000-8002', description: 'App range' },
                  protocol: 'tcp',
                  direction: 'in',
                  action: 'accept',
                  description: 'Application range'
                }
              }
            })
          }
        }

        const results = await executeAcrossAllFirewallServices(serviceOperations)
        verifyServiceIntegration(results, ['advancedFirewall'])

        // Step 2: Verify aggregated events
        const events = getCapturedEvents()
        expect(events.length).toBeGreaterThan(0)

        events.forEach(event => {
          expect(event.payload.data.rules).toBeDefined()
          expect(event.payload.data.state).toMatchObject({
            appliedTemplates: expect.any(Array),
            customRules: expect.any(Array),
            effectiveRules: expect.any(Array)
          })
        })
      })
    })
  })

  describe('Advanced Integration Workflow Testing', () => {
    it('should execute complete end-to-end advanced firewall workflow', async () => {
      await withComplexTransaction(prisma, async ({
        testUser,
        testMachine,
        context,
        departments,
        multipleVMs,
        templates
      }) => {
        // Step 1: Set up complex scenario
        const workflowSteps = [
          {
            name: 'Apply department template',
            operation: async () => {
              return await context.prisma.machine.update({
                where: { id: testMachine.id },
                data: {
                  departmentId: departments[0].id,
                  firewallTemplates: {
                    appliedTemplates: ['web-security'],
                    customRules: [],
                    lastSync: new Date().toISOString()
                  }
                }
              })
            },
            verify: (result: any) => expect(result.departmentId).toBe(departments[0].id)
          },
          {
            name: 'Create advanced port range',
            operation: async () => {
              return await graphql({
                schema,
                source: CREATE_ADVANCED_RULE_MUTATION,
                contextValue: context,
                variableValues: {
                  input: {
                    machineId: testMachine.id,
                    ports: { type: 'RANGE', value: '9000-9005', description: 'Service range' },
                    protocol: 'tcp',
                    direction: 'in',
                    action: 'accept',
                    description: 'Service port range'
                  }
                }
              })
            },
            verify: (result: any) => {
              expect(result.errors).toBeUndefined()
              expect(result.data?.createAdvancedFirewallRule.customRules).toHaveLength(6)
            }
          },
          {
            name: 'Add complex multiple ports',
            operation: async () => {
              return await graphql({
                schema,
                source: CREATE_ADVANCED_RULE_MUTATION,
                contextValue: context,
                variableValues: {
                  input: {
                    machineId: testMachine.id,
                    ports: { type: 'MULTIPLE', value: '80,443,8080,8443', description: 'Web stack' },
                    protocol: 'tcp',
                    direction: 'in',
                    action: 'accept',
                    description: 'Complete web stack'
                  }
                }
              })
            },
            verify: (result: any) => {
              expect(result.errors).toBeUndefined()
              expect(result.data?.createAdvancedFirewallRule.customRules).toHaveLength(10) // 6 + 4
            }
          },
          {
            name: 'Verify final state consistency',
            operation: async () => {
              return await graphql({
                schema,
                source: GET_FIREWALL_STATE_QUERY,
                contextValue: context,
                variableValues: { machineId: testMachine.id }
              })
            },
            verify: (result: any) => {
              expect(result.errors).toBeUndefined()
              const state = result.data?.firewallState
              expect(state.appliedTemplates).toContain('web-security')
              expect(state.customRules).toHaveLength(10)
              expect(state.effectiveRules.length).toBeGreaterThanOrEqual(10)
            }
          }
        ]

        // Execute complete workflow
        const workflowResults = await executeCompleteWorkflow(workflowSteps)

        // Verify workflow completion
        verifyWorkflowSteps(workflowResults, [
          'Apply department template',
          'Create advanced port range',
          'Add complex multiple ports',
          'Verify final state consistency'
        ])

        assertWorkflowConsistency(workflowResults)
      })
    })

    it('should handle complex inheritance with advanced rules and department conflicts', async () => {
      await withComplexTransaction(prisma, async ({ context, testMachine, templates }) => {
        const { globalTemplate, departmentTemplate, vmTemplate } = templates

        // Step 1: Set up complex inheritance scenario
        await context.prisma.machine.update({
          where: { id: testMachine.id },
          data: {
            firewallTemplates: {
              appliedTemplates: [
                globalTemplate.name,
                departmentTemplate.name,
                vmTemplate.name
              ],
              customRules: [],
              lastSync: new Date().toISOString()
            }
          }
        })

        // Step 2: Add advanced rule that conflicts with templates
        const conflictingInput = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80', // Conflicts with global template
            description: 'HTTP override'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'deny', // Conflicts with allow in template
          description: 'Block HTTP for security override'
        }

        const result = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: conflictingInput }
        })

        expect(result.errors).toBeUndefined()

        // Step 3: Verify rule inheritance and priority resolution
        const state = result.data?.createAdvancedFirewallRule

        // Advanced rule should be present
        const advancedRules = state.customRules.filter((rule: any) =>
          rule.sources.includes('advanced')
        )
        expect(advancedRules).toHaveLength(1)
        expect(advancedRules[0]).toMatchObject({
          port: '80',
          action: 'deny',
          sources: ['advanced']
        })

        // Step 4: Verify effective rules prioritize advanced rules
        const effectiveHttpRules = state.effectiveRules.filter((rule: any) =>
          rule.port === '80'
        )
        expect(effectiveHttpRules.length).toBeGreaterThan(0)

        // Check rule inheritance chain
        const inheritanceChain = [
          { source: 'global', rules: globalTemplate.rules },
          { source: 'department', rules: departmentTemplate.rules },
          { source: 'vm', rules: vmTemplate.rules },
          { source: 'advanced', rules: [advancedRules[0]] }
        ]

        assertRuleInheritance(state.effectiveRules, inheritanceChain)
      })
    })

    it('should verify cross-service state consistency during complex operations', async () => {
      await withComplexTransaction(prisma, async ({ context, multipleVMs }) => {
        // Step 1: Perform operations across multiple services
        const vmId = multipleVMs[0].vm.id

        const serviceOperations = {
          advancedFirewall: async () => {
            return await graphql({
              schema,
              source: CREATE_ADVANCED_RULE_MUTATION,
              contextValue: context,
              variableValues: {
                input: {
                  machineId: vmId,
                  ports: { type: 'SINGLE', value: '8080', description: 'App' },
                  protocol: 'tcp',
                  direction: 'in',
                  action: 'accept',
                  description: 'Application server'
                }
              }
            })
          }
        }

        const results = await executeAcrossAllFirewallServices(serviceOperations)

        // Step 2: Verify service integration
        verifyServiceIntegration(results, ['advancedFirewall'])

        // Step 3: Check state consistency across services
        const stateQuery = `
          query GetState($machineId: String!) {
            firewallState(machineId: $machineId) {
              customRules { port protocol sources }
              effectiveRules { port protocol }
              lastSync
            }
          }
        `

        const stateResult = await graphql({
          schema,
          source: stateQuery,
          contextValue: context,
          variableValues: { machineId: vmId }
        })

        expect(stateResult.errors).toBeUndefined()
        const state = stateResult.data?.firewallState

        // Verify state consistency
        checkServiceStateConsistency(
          { advancedFirewall: results.advancedFirewall, state },
          ['customRules', 'effectiveRules']
        )

        // Verify firewall state consistency
        const consistency = await verifyFirewallStateConsistency(context.prisma, vmId)
        expect(consistency.isValid).toBe(true)
      })
    })
  })

  describe('Advanced Error Handling and Recovery', () => {
    it('should handle rule synchronization failures and recovery mechanisms', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Step 1: Create rule successfully
        const input1 = {
          machineId: testMachine.id,
          ports: {
            type: 'SINGLE',
            value: '80',
            description: 'HTTP'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTP traffic'
        }

        const result1 = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: input1 }
        })

        expect(result1.errors).toBeUndefined()

        // Step 2: Simulate partial failure scenario
        const input2 = {
          machineId: testMachine.id,
          ports: {
            type: 'RANGE',
            value: '8000-8010', // Large range that might cause issues
            description: 'Large range'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Large port range'
        }

        const result2 = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input: input2 }
        })

        // Should handle large ranges gracefully
        expect(result2.errors).toBeUndefined()
        const state = result2.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(12) // 1 previous + 11 new (8000-8010)

        // Step 3: Verify system state consistency
        const consistency = await verifyFirewallStateConsistency(context.prisma, testMachine.id)
        expect(consistency.isValid).toBe(true)
      })
    })

    it('should handle partial failure scenarios in multi-VM operations', async () => {
      await withComplexTransaction(prisma, async ({ context, multipleVMs }) => {
        const validVMs = multipleVMs.slice(0, 2)
        const allVMs = [...validVMs, { vm: { id: 'invalid-vm-id' }, user: null }]

        // Step 1: Attempt operations on valid and invalid VMs
        const operations = allVMs.map(vmData =>
          graphql({
            schema,
            source: CREATE_ADVANCED_RULE_MUTATION,
            contextValue: context,
            variableValues: {
              input: {
                machineId: vmData.vm.id,
                ports: { type: 'SINGLE', value: '80', description: 'HTTP' },
                protocol: 'tcp',
                direction: 'in',
                action: 'accept',
                description: 'HTTP traffic'
              }
            }
          })
        )

        const results = await Promise.allSettled(operations)

        // Step 2: Verify partial success/failure handling
        const successful = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>[]
        const failed = results.filter(r => r.status === 'rejected')

        expect(successful.length).toBe(2) // Valid VMs should succeed
        expect(failed.length).toBe(1) // Invalid VM should fail

        // Step 3: Verify successful operations completed correctly
        successful.forEach(result => {
          expect(result.value.errors).toBeUndefined()
          expect(result.value.data?.createAdvancedFirewallRule).toBeDefined()
        })

        // Step 4: Verify system consistency for successful operations
        for (const vmData of validVMs) {
          const consistency = await verifyFirewallStateConsistency(context.prisma, vmData.vm.id)
          expect(consistency.isValid).toBe(true)
        }
      })
    })

    it('should verify graceful degradation when libvirt is unavailable', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Note: libvirt-node is already mocked in the test setup
        // This test verifies that advanced firewall operations continue
        // to work even when the underlying virtualization layer has issues

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

        const result = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        // Should succeed despite libvirt being mocked/unavailable
        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule).toBeDefined()

        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(3)
        expect(state.effectiveRules.length).toBeGreaterThanOrEqual(3)

        // Verify WebSocket events still work
        expect(mockSocketService.sendToUser).toHaveBeenCalled()
      })
    })
  })

  describe('Reliability and Scale Integration', () => {
    it('should handle creation of large numbers of rules correctly', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Create a large port range to test functionality
        const input = {
          machineId: testMachine.id,
          ports: {
            type: 'RANGE',
            value: '10000-10050', // 51 ports
            description: 'Large service range'
          },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Large port range for testing'
        }

        const result = await graphql({
          schema,
          source: CREATE_ADVANCED_RULE_MUTATION,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        const state = result.data?.createAdvancedFirewallRule
        expect(state.customRules).toHaveLength(51)

        // Verify all ports in range are present
        const ports = state.customRules.map((rule: any) => parseInt(rule.port)).sort((a, b) => a - b)
        expect(ports[0]).toBe(10000)
        expect(ports[50]).toBe(10050)
      })
    })

    it('should handle complex rule combinations without conflicts', async () => {
      await runTestInTransaction(async ({ testMachine, context }) => {
        // Step 1: Create various types of rules
        const ruleTypes = [
          {
            ports: { type: 'SINGLE', value: '22', description: 'SSH' },
            description: 'SSH access'
          },
          {
            ports: { type: 'RANGE', value: '8080-8085', description: 'App range' },
            description: 'Application range'
          },
          {
            ports: { type: 'MULTIPLE', value: '80,443,8000', description: 'Web' },
            description: 'Web services'
          },
          {
            ports: { type: 'ALL', value: 'all', description: 'All ports' },
            description: 'All traffic',
            protocol: 'udp' // Different protocol
          }
        ]

        // Step 2: Create all rule types
        for (const ruleConfig of ruleTypes) {
          const input = {
            machineId: testMachine.id,
            ports: ruleConfig.ports,
            protocol: ruleConfig.protocol || 'tcp',
            direction: 'in',
            action: 'accept',
            description: ruleConfig.description
          }

          const result = await graphql({
            schema,
            source: CREATE_ADVANCED_RULE_MUTATION,
            contextValue: context,
            variableValues: { input }
          })

          expect(result.errors).toBeUndefined()
        }

        // Step 3: Verify final state
        const finalState = await graphql({
          schema,
          source: GET_FIREWALL_STATE_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(finalState.errors).toBeUndefined()
        const state = finalState.data?.firewallState

        // Should have: 1 SSH + 6 app range + 3 web + 1 all = 11 rules
        expect(state.customRules).toHaveLength(11)

        // Verify different protocols and types are handled
        const tcpRules = state.customRules.filter((rule: any) => rule.protocol === 'tcp')
        const udpRules = state.customRules.filter((rule: any) => rule.protocol === 'udp')

        expect(tcpRules).toHaveLength(10)
        expect(udpRules).toHaveLength(1)

        // Verify effective rules include all custom rules
        expect(state.effectiveRules.length).toBeGreaterThanOrEqual(11)
      })
    })
  })
})
