import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals'
import { buildSchema } from 'type-graphql'
import { graphql, ExecutionResult } from 'graphql'
import { Container } from 'typedi'
import { PrismaClient } from '@prisma/client'
import { DepartmentResolver } from '@graphql/resolvers/department/resolver'
import { DepartmentFirewallResolver } from '@graphql/resolvers/DepartmentFirewallResolver'
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
  checkWorkflowEventDelivery,
  simulateConcurrentServiceOperations
} from '../setup/test-helpers'
import {
  createMockUser,
  createMockAdminUser,
  createMockDepartment,
  createMockMachine,
  createMockNWFilter,
  createMockFWRule,
  createMockDepartmentConfiguration,
  createMockDepartmentWithMachines,
  createMockNetworkFilterWithRules
} from '../setup/mock-factories'

// Mock SocketService
const mockSocketService = {
  sendToAdmins: jest.fn(),
  sendEvent: jest.fn(),
  sendToUser: jest.fn()
}

jest.mock('@services/SocketService', () => ({
  getSocketService: () => mockSocketService
}))

// Mock NetworkFilterService
const mockNetworkFilterService = {
  flushNWFilter: jest.fn().mockResolvedValue(true),
  createRule: jest.fn(),
  deleteRule: jest.fn(),
  getFilter: jest.fn(),
  updateFilter: jest.fn()
}

jest.mock('@services/networkFilterService', () => ({
  NetworkFilterService: jest.fn(() => mockNetworkFilterService)
}))

// Mock libvirt-node
jest.mock('libvirt-node')

describe('Department Firewall Integration', () => {
  let schema: any
  let prisma: PrismaClient

  beforeAll(async () => {
    // Create schema with department and firewall resolvers
    schema = await buildSchema({
      resolvers: [DepartmentResolver, DepartmentFirewallResolver],
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
    testAdminUser: any,
    testDepartment: any,
    testMachines: any[],
    context: any,
    adminContext: any
  }) => Promise<void>) => {
    await withTransaction(prisma, testFn)
  }

  describe('Department Firewall State End-to-End', () => {
    const GET_DEPARTMENT_FIREWALL_STATE_QUERY = `
      query GetDepartmentFirewallState($departmentId: ID!) {
        getDepartmentFirewallState(departmentId: $departmentId) {
          departmentId
          appliedTemplates
          customRules {
            id
            action
            direction
            priority
            protocol
            dstPortStart
            dstPortEnd
            comment
          }
          effectiveRules {
            id
            action
            direction
            priority
            protocol
            dstPortStart
            dstPortEnd
            comment
          }
          vmCount
          lastSync
        }
      }
    `

    it('should retrieve complete department firewall state through GraphQL', async () => {
      await runTestInTransaction(async ({ testDepartment, testMachines, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create custom rules for department
        const customRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'Allow HTTP traffic'
          }
        })

        const result: ExecutionResult = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.getDepartmentFirewallState).toBeDefined()

        const state = result.data?.getDepartmentFirewallState
        expect(state.departmentId).toBe(testDepartment.id)
        expect(state.vmCount).toBe(testMachines.length)
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0]).toMatchObject({
          id: customRule.id,
          action: 'accept',
          direction: 'in',
          priority: 100,
          protocol: 'tcp',
          dstPortStart: 80,
          dstPortEnd: 80,
          comment: 'Allow HTTP traffic'
        })
        expect(state.effectiveRules).toContainEqual(
          expect.objectContaining({
            id: customRule.id,
            action: 'accept',
            protocol: 'tcp'
          })
        )
      })
    })

    const APPLY_DEPARTMENT_TEMPLATE_MUTATION = `
      mutation ApplyDepartmentFirewallTemplate($input: ApplyDepartmentTemplateInput!) {
        applyDepartmentFirewallTemplate(input: $input)
      }
    `

    it('should apply department template affecting VM firewall rules', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create generic template filter
        const templateFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'web-server-template',
            internalName: 'web-template',
            uuid: 'web-template-uuid',
            description: 'Web server firewall template',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        // Add rules to template
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: templateFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 80,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'HTTP template rule'
          }
        })

        const input = {
          departmentId: testDepartment.id,
          templateFilterId: templateFilter.id
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: APPLY_DEPARTMENT_TEMPLATE_MUTATION,
          contextValue: adminContext,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.applyDepartmentFirewallTemplate).toBe(true)

        // Verify filter reference was created
        const filterReference = await adminContext.prisma.filterReference.findFirst({
          where: {
            sourceFilterId: departmentFilter.id,
            targetFilterId: templateFilter.id
          }
        })

        expect(filterReference).toBeDefined()

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
          'departmentFirewall',
          'templateApplied',
          expect.objectContaining({
            data: {
              departmentId: testDepartment.id,
              templateFilterId: templateFilter.id
            }
          })
        )

        // Verify network filter was flushed
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(departmentFilter.id)
      })
    })

    const CREATE_DEPARTMENT_RULE_MUTATION = `
      mutation CreateDepartmentFirewallRule($departmentId: ID!, $input: CreateFilterRuleInput!) {
        createDepartmentFirewallRule(departmentId: $departmentId, input: $input) {
          id
          action
          direction
          priority
          protocol
          dstPortStart
          dstPortEnd
          comment
        }
      }
    `

    it('should create department rule propagating to VMs', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        const input = {
          action: 'accept',
          direction: 'in',
          priority: 200,
          protocol: 'tcp',
          dstPortStart: 443,
          dstPortEnd: 443,
          comment: 'HTTPS access rule'
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_DEPARTMENT_RULE_MUTATION,
          contextValue: adminContext,
          variableValues: {
            departmentId: testDepartment.id,
            input
          }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createDepartmentFirewallRule).toBeDefined()

        const createdRule = result.data?.createDepartmentFirewallRule
        expect(createdRule).toMatchObject({
          action: 'accept',
          direction: 'in',
          priority: 200,
          protocol: 'tcp',
          dstPortStart: 443,
          dstPortEnd: 443,
          comment: 'HTTPS access rule'
        })

        // Verify rule was created in database
        const dbRule = await adminContext.prisma.fWRule.findUnique({
          where: { id: createdRule.id }
        })

        expect(dbRule).toBeDefined()
        expect(dbRule?.nwFilterId).toBe(departmentFilter.id)

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
          'departmentFirewall',
          'ruleCreated',
          expect.objectContaining({
            data: {
              departmentId: testDepartment.id,
              ruleId: createdRule.id
            }
          })
        )
      })
    })

    const FLUSH_DEPARTMENT_FIREWALL_MUTATION = `
      mutation FlushDepartmentFirewall($departmentId: ID!) {
        flushDepartmentFirewall(departmentId: $departmentId)
      }
    `

    it('should flush department firewall synchronization across multiple VMs', async () => {
      await runTestInTransaction(async ({ testDepartment, testMachines, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create VM filters for each machine
        for (const machine of testMachines) {
          const vmFilter = await adminContext.prisma.nWFilter.create({
            data: {
              name: `vm-${machine.name}`,
              internalName: `vm-filter-${machine.id}`,
              uuid: `vm-uuid-${machine.id}`,
              description: 'VM firewall filter',
              chain: 'ipv4',
              type: 'vm',
              priority: 600,
              stateMatch: true
            }
          })

          await adminContext.prisma.machineNWFilter.create({
            data: {
              machineId: machine.id,
              nwFilterId: vmFilter.id
            }
          })
        }

        const result: ExecutionResult = await graphql({
          schema,
          source: FLUSH_DEPARTMENT_FIREWALL_MUTATION,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.flushDepartmentFirewall).toBe(true)

        // Verify network filter flush was called
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(departmentFilter.id)

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
          'departmentFirewall',
          'flushed',
          expect.objectContaining({
            data: {
              departmentId: testDepartment.id
            }
          })
        )
      })
    })
  })

  describe('Complex Rule Inheritance Testing', () => {
    const GET_DEPARTMENT_RULES_QUERY = `
      query GetDepartmentFirewallRules($departmentId: ID!) {
        getDepartmentFirewallRules(departmentId: $departmentId) {
          id
          action
          direction
          priority
          protocol
          dstPortStart
          dstPortEnd
          comment
        }
      }
    `

    it('should test multi-level rule inheritance (global -> department -> VM)', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create global template
        const globalTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'global-security-template',
            internalName: 'global-template',
            uuid: 'global-template-uuid',
            description: 'Global security rules',
            chain: 'ipv4',
            type: 'generic',
            priority: 100,
            stateMatch: true
          }
        })

        // Add global rules
        const globalRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: globalTemplate.id,
            action: 'drop',
            direction: 'in',
            priority: 50,
            protocol: 'tcp',
            dstPortStart: 22,
            dstPortEnd: 22,
            comment: 'Global SSH restriction'
          }
        })

        // Create department template
        const departmentTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'department-template',
            internalName: 'dept-template',
            uuid: 'dept-template-uuid',
            description: 'Department specific rules',
            chain: 'ipv4',
            type: 'generic',
            priority: 200,
            stateMatch: true
          }
        })

        // Add department template rules
        const deptTemplateRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentTemplate.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'Department HTTP access'
          }
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create inheritance chain: department -> dept template -> global template
        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: departmentFilter.id,
            targetFilterId: departmentTemplate.id
          }
        })

        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: departmentTemplate.id,
            targetFilterId: globalTemplate.id
          }
        })

        // Add custom department rule
        const customRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 300,
            protocol: 'tcp',
            dstPortStart: 443,
            dstPortEnd: 443,
            comment: 'Department HTTPS access'
          }
        })

        const result: ExecutionResult = await graphql({
          schema,
          source: GET_DEPARTMENT_RULES_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.getDepartmentFirewallRules).toBeDefined()

        const rules = result.data?.getDepartmentFirewallRules
        expect(rules).toHaveLength(3) // Global + Department Template + Custom

        // Verify rule priorities and inheritance
        const rulesByPriority = rules.sort((a: any, b: any) => a.priority - b.priority)
        expect(rulesByPriority[0]).toMatchObject({
          id: globalRule.id,
          priority: 50,
          comment: 'Global SSH restriction'
        })
        expect(rulesByPriority[1]).toMatchObject({
          id: deptTemplateRule.id,
          priority: 100,
          comment: 'Department HTTP access'
        })
        expect(rulesByPriority[2]).toMatchObject({
          id: customRule.id,
          priority: 300,
          comment: 'Department HTTPS access'
        })
      })
    })

    it('should handle rule priority resolution across inheritance levels', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create multiple templates with conflicting priorities
        const highPriorityTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'high-priority-template',
            internalName: 'high-template',
            uuid: 'high-template-uuid',
            description: 'High priority rules',
            chain: 'ipv4',
            type: 'generic',
            priority: 100,
            stateMatch: true
          }
        })

        const lowPriorityTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'low-priority-template',
            internalName: 'low-template',
            uuid: 'low-template-uuid',
            description: 'Low priority rules',
            chain: 'ipv4',
            type: 'generic',
            priority: 800,
            stateMatch: true
          }
        })

        // Add rules with same port but different actions
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: highPriorityTemplate.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 8080,
            dstPortEnd: 8080,
            comment: 'High priority accept'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: lowPriorityTemplate.id,
            action: 'drop',
            direction: 'in',
            priority: 900,
            protocol: 'tcp',
            dstPortStart: 8080,
            dstPortEnd: 8080,
            comment: 'Low priority drop'
          }
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Apply both templates
        await adminContext.prisma.filterReference.createMany({
          data: [
            {
              sourceFilterId: departmentFilter.id,
              targetFilterId: highPriorityTemplate.id
            },
            {
              sourceFilterId: departmentFilter.id,
              targetFilterId: lowPriorityTemplate.id
            }
          ]
        })

        const result: ExecutionResult = await graphql({
          schema,
          source: GET_DEPARTMENT_RULES_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        const rules = result.data?.getDepartmentFirewallRules

        // High priority rule should come first
        const sortedRules = rules.sort((a: any, b: any) => a.priority - b.priority)
        expect(sortedRules[0]).toMatchObject({
          action: 'accept',
          priority: 100,
          comment: 'High priority accept'
        })
        expect(sortedRules[1]).toMatchObject({
          action: 'drop',
          priority: 900,
          comment: 'Low priority drop'
        })
      })
    })

    it('should handle template application with rule conflicts', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create conflicting templates
        const webTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'web-template',
            internalName: 'web-template',
            uuid: 'web-template-uuid',
            description: 'Web server template',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        const securityTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'security-template',
            internalName: 'security-template',
            uuid: 'security-template-uuid',
            description: 'Security hardening template',
            chain: 'ipv4',
            type: 'generic',
            priority: 300,
            stateMatch: true
          }
        })

        // Web template allows HTTP
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: webTemplate.id,
            action: 'accept',
            direction: 'in',
            priority: 400,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'Allow HTTP'
          }
        })

        // Security template blocks HTTP
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: securityTemplate.id,
            action: 'drop',
            direction: 'in',
            priority: 200,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'Block HTTP for security'
          }
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Apply both conflicting templates
        await adminContext.prisma.filterReference.createMany({
          data: [
            {
              sourceFilterId: departmentFilter.id,
              targetFilterId: webTemplate.id
            },
            {
              sourceFilterId: departmentFilter.id,
              targetFilterId: securityTemplate.id
            }
          ]
        })

        const result: ExecutionResult = await graphql({
          schema,
          source: GET_DEPARTMENT_RULES_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        const rules = result.data?.getDepartmentFirewallRules

        // Both rules should be present, with security rule taking precedence due to priority
        expect(rules).toHaveLength(2)
        const httpRules = rules.filter((rule: any) => rule.dstPortStart === 80)
        expect(httpRules).toHaveLength(2)

        const securityRule = httpRules.find((rule: any) => rule.priority === 200)
        const webRule = httpRules.find((rule: any) => rule.priority === 400)

        expect(securityRule).toMatchObject({
          action: 'drop',
          comment: 'Block HTTP for security'
        })
        expect(webRule).toMatchObject({
          action: 'accept',
          comment: 'Allow HTTP'
        })
      })
    })
  })

  describe('Department-VM Relationship Integration', () => {
    it('should handle VM addition to department inheriting firewall rules', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter with rules
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 22,
            dstPortEnd: 22,
            comment: 'Department SSH access'
          }
        })

        // Create new machine in department
        const newMachine = await adminContext.prisma.machine.create({
          data: {
            name: 'new-test-vm',
            internalName: 'new-test-vm-internal',
            status: 'stopped',
            os: 'ubuntu-22.04',
            cpuCores: 2,
            ramGB: 4,
            diskSizeGB: 50,
            departmentId: testDepartment.id,
            templateId: testDepartment.id // Using department ID as placeholder
          }
        })

        // Create VM filter for new machine
        const vmFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `vm-${newMachine.name}`,
            internalName: `vm-filter-${newMachine.id}`,
            uuid: `vm-uuid-${newMachine.id}`,
            description: 'VM firewall filter',
            chain: 'ipv4',
            type: 'vm',
            priority: 600,
            stateMatch: true
          }
        })

        await adminContext.prisma.machineNWFilter.create({
          data: {
            machineId: newMachine.id,
            nwFilterId: vmFilter.id
          }
        })

        // Create reference from VM filter to department filter (inheritance)
        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: vmFilter.id,
            targetFilterId: departmentFilter.id
          }
        })

        // Verify department state includes new VM
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
                vmCount
                effectiveRules {
                  id
                  comment
                }
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        const state = result.data?.getDepartmentFirewallState

        expect(state.vmCount).toBe(4) // 3 original + 1 new
        expect(state.effectiveRules).toContainEqual(
          expect.objectContaining({
            comment: 'Department SSH access'
          })
        )
      })
    })

    it('should handle VM removal from department cleaning up firewall associations', async () => {
      await runTestInTransaction(async ({ testDepartment, testMachines, adminContext }) => {
        const machineToRemove = testMachines[0]

        // Create VM filter for machine
        const vmFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `vm-${machineToRemove.name}`,
            internalName: `vm-filter-${machineToRemove.id}`,
            uuid: `vm-uuid-${machineToRemove.id}`,
            description: 'VM firewall filter',
            chain: 'ipv4',
            type: 'vm',
            priority: 600,
            stateMatch: true
          }
        })

        await adminContext.prisma.machineNWFilter.create({
          data: {
            machineId: machineToRemove.id,
            nwFilterId: vmFilter.id
          }
        })

        // Remove machine from department
        await adminContext.prisma.machine.update({
          where: { id: machineToRemove.id },
          data: { departmentId: null }
        })

        // Verify department VM count is updated
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
                vmCount
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        const state = result.data?.getDepartmentFirewallState

        expect(state.vmCount).toBe(2) // 3 original - 1 removed
      })
    })

    it('should handle department firewall changes affecting existing VMs', async () => {
      await runTestInTransaction(async ({ testDepartment, testMachines, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create VM filters and references
        for (const machine of testMachines) {
          const vmFilter = await adminContext.prisma.nWFilter.create({
            data: {
              name: `vm-${machine.name}`,
              internalName: `vm-filter-${machine.id}`,
              uuid: `vm-uuid-${machine.id}`,
              description: 'VM firewall filter',
              chain: 'ipv4',
              type: 'vm',
              priority: 600,
              stateMatch: true
            }
          })

          await adminContext.prisma.machineNWFilter.create({
            data: {
              machineId: machine.id,
              nwFilterId: vmFilter.id
            }
          })

          // Create inheritance reference
          await adminContext.prisma.filterReference.create({
            data: {
              sourceFilterId: vmFilter.id,
              targetFilterId: departmentFilter.id
            }
          })
        }

        // Add new rule to department
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            mutation CreateDepartmentFirewallRule($departmentId: ID!, $input: CreateFilterRuleInput!) {
              createDepartmentFirewallRule(departmentId: $departmentId, input: $input) {
                id
                comment
              }
            }
          `,
          contextValue: adminContext,
          variableValues: {
            departmentId: testDepartment.id,
            input: {
              action: 'accept',
              direction: 'in',
              priority: 150,
              protocol: 'tcp',
              dstPortStart: 3389,
              dstPortEnd: 3389,
              comment: 'RDP access for all VMs'
            }
          }
        })

        expect(result.errors).toBeUndefined()
        const createdRule = result.data?.createDepartmentFirewallRule

        expect(createdRule).toMatchObject({
          comment: 'RDP access for all VMs'
        })

        // Verify all VMs would inherit this rule through effective rules calculation
        const stateResult: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallRules($departmentId: ID!) {
              getDepartmentFirewallRules(departmentId: $departmentId) {
                id
                comment
                dstPortStart
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(stateResult.errors).toBeUndefined()
        const rules = stateResult.data?.getDepartmentFirewallRules

        expect(rules).toContainEqual(
          expect.objectContaining({
            comment: 'RDP access for all VMs',
            dstPortStart: 3389
          })
        )
      })
    })
  })

  describe('Real-time Event Integration', () => {
    it('should emit WebSocket events for department firewall changes', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Clear previous calls
        jest.clearAllMocks()

        // Create rule and verify events
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            mutation CreateDepartmentFirewallRule($departmentId: ID!, $input: CreateFilterRuleInput!) {
              createDepartmentFirewallRule(departmentId: $departmentId, input: $input) {
                id
              }
            }
          `,
          contextValue: adminContext,
          variableValues: {
            departmentId: testDepartment.id,
            input: {
              action: 'accept',
              direction: 'in',
              priority: 100,
              protocol: 'tcp',
              dstPortStart: 80,
              dstPortEnd: 80,
              comment: 'HTTP rule'
            }
          }
        })

        expect(result.errors).toBeUndefined()

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
          'departmentFirewall',
          'ruleCreated',
          expect.objectContaining({
            data: expect.objectContaining({
              departmentId: testDepartment.id,
              ruleId: expect.any(String)
            })
          })
        )
      })
    })

    it('should emit events with correct payload structure and data integrity', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create template
        const template = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'test-template',
            internalName: 'test-template',
            uuid: 'test-template-uuid',
            description: 'Test template',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        jest.clearAllMocks()

        // Apply template
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            mutation ApplyDepartmentFirewallTemplate($input: ApplyDepartmentTemplateInput!) {
              applyDepartmentFirewallTemplate(input: $input)
            }
          `,
          contextValue: adminContext,
          variableValues: {
            input: {
              departmentId: testDepartment.id,
              templateFilterId: template.id
            }
          }
        })

        expect(result.errors).toBeUndefined()

        // Verify event payload structure
        expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
          'departmentFirewall',
          'templateApplied',
          {
            data: {
              departmentId: testDepartment.id,
              templateFilterId: template.id
            }
          }
        )

        // Verify the event was called exactly once
        expect(mockSocketService.sendToAdmins).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Authorization Integration', () => {
    it('should enforce department access control for firewall operations', async () => {
      await runTestInTransaction(async ({ testUser, testDepartment, context, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Try to access as regular user (should fail authorization)
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
              }
            }
          `,
          contextValue: context, // Regular user context
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Unauthorized')
      })
    })

    it('should allow admin access to all department firewall operations', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Admin should have access
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
                vmCount
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.getDepartmentFirewallState).toBeDefined()
        expect(result.data?.getDepartmentFirewallState.departmentId).toBe(testDepartment.id)
      })
    })
  })

  describe('Error Handling Integration', () => {
    it('should prevent circular template reference and ensure transaction rollback', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create a chain of template filters: A -> B -> C
        const templateA = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'template-a',
            internalName: 'template-a',
            uuid: 'template-a-uuid',
            description: 'Template A',
            chain: 'ipv4',
            type: 'generic',
            priority: 300,
            stateMatch: true
          }
        })

        const templateB = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'template-b',
            internalName: 'template-b',
            uuid: 'template-b-uuid',
            description: 'Template B',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        const templateC = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'template-c',
            internalName: 'template-c',
            uuid: 'template-c-uuid',
            description: 'Template C',
            chain: 'ipv4',
            type: 'generic',
            priority: 500,
            stateMatch: true
          }
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 600,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create reference chain: Department -> A -> B -> C
        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: departmentFilter.id,
            targetFilterId: templateA.id
          }
        })

        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: templateA.id,
            targetFilterId: templateB.id
          }
        })

        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: templateB.id,
            targetFilterId: templateC.id
          }
        })

        // Count references before attempting circular reference
        const referencesBefore = await adminContext.prisma.filterReference.count()

        // Now try to create a circular reference: C -> Department (which would create a cycle)
        const circularRefResult: ExecutionResult = await graphql({
          schema,
          source: `
            mutation ApplyDepartmentFirewallTemplate($input: ApplyDepartmentTemplateInput!) {
              applyDepartmentFirewallTemplate(input: $input)
            }
          `,
          contextValue: adminContext,
          variableValues: {
            input: {
              departmentId: testDepartment.id,
              templateFilterId: templateC.id
            }
          }
        })

        // Should fail with circular dependency error
        expect(circularRefResult.errors).toBeDefined()
        expect(circularRefResult.errors?.[0]?.message).toContain('circular dependency')

        // Verify no new filter reference was created (transaction rollback)
        const referencesAfter = await adminContext.prisma.filterReference.count()
        expect(referencesAfter).toBe(referencesBefore)

        // Verify the existing valid references are still intact
        const validReferences = await adminContext.prisma.filterReference.findMany({
          where: {
            OR: [
              { sourceFilterId: departmentFilter.id, targetFilterId: templateA.id },
              { sourceFilterId: templateA.id, targetFilterId: templateB.id },
              { sourceFilterId: templateB.id, targetFilterId: templateC.id }
            ]
          }
        })
        expect(validReferences).toHaveLength(3)
      })
    })

    it('should handle constraint violation scenarios', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Try to get firewall state for non-existent department
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: 'non-existent-department-id' }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('not found')
      })
    })

    it('should handle rollback scenarios when firewall operations fail', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Mock network service to fail
        mockNetworkFilterService.flushNWFilter.mockRejectedValueOnce(new Error('Flush failed'))

        // Try to flush - should handle the error gracefully
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            mutation FlushDepartmentFirewall($departmentId: ID!) {
              flushDepartmentFirewall(departmentId: $departmentId)
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Failed to flush')

        // Reset mock for cleanup
        mockNetworkFilterService.flushNWFilter.mockResolvedValue(true)
      })
    })

    it('should handle data consistency across department-VM firewall relationships', async () => {
      await runTestInTransaction(async ({ testDepartment, testMachines, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Add rule to department
        const rule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 22,
            dstPortEnd: 22,
            comment: 'SSH access'
          }
        })

        // Verify department state is consistent
        const stateResult: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
                customRules {
                  id
                  comment
                }
                effectiveRules {
                  id
                  comment
                }
                vmCount
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(stateResult.errors).toBeUndefined()
        const state = stateResult.data?.getDepartmentFirewallState

        expect(state.customRules).toHaveLength(1)
        expect(state.effectiveRules).toHaveLength(1)
        expect(state.customRules[0].id).toBe(rule.id)
        expect(state.effectiveRules[0].id).toBe(rule.id)
        expect(state.vmCount).toBe(testMachines.length)
      })
    })
  })

  describe('Configuration-Driven Security Testing', () => {
    it('should update effective rules when department cleanTraffic configuration changes', async () => {
      await runTestInTransaction(async ({ testDepartment, testMachines, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create initial configuration with cleanTraffic = false
        const initialConfig = await adminContext.prisma.departmentConfiguration.create({
          data: {
            departmentId: testDepartment.id,
            cleanTraffic: false
          }
        })

        // Create initial rules
        const initialRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'HTTP rule - no clean traffic'
          }
        })

        // Get initial state
        const initialStateResult: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallRules($departmentId: ID!) {
              getDepartmentFirewallRules(departmentId: $departmentId) {
                id
                comment
                action
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(initialStateResult.errors).toBeUndefined()
        const initialRules = initialStateResult.data?.getDepartmentFirewallRules
        expect(initialRules).toHaveLength(1)
        expect(initialRules[0].comment).toBe('HTTP rule - no clean traffic')

        // Update configuration to enable cleanTraffic
        await adminContext.prisma.departmentConfiguration.update({
          where: { id: initialConfig.id },
          data: { cleanTraffic: true }
        })

        // Add clean traffic rule that would be applied when cleanTraffic is enabled
        const cleanTrafficRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'drop',
            direction: 'in',
            priority: 50, // Higher priority than regular rules
            protocol: 'tcp',
            dstPortStart: 445, // SMB port - commonly blocked in clean traffic
            dstPortEnd: 445,
            comment: 'Clean traffic - block SMB'
          }
        })

        // Verify configuration change affects effective rules
        const updatedStateResult: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallRules($departmentId: ID!) {
              getDepartmentFirewallRules(departmentId: $departmentId) {
                id
                comment
                action
                priority
                dstPortStart
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        expect(updatedStateResult.errors).toBeUndefined()
        const updatedRules = updatedStateResult.data?.getDepartmentFirewallRules
        expect(updatedRules).toHaveLength(2)

        // Rules should be sorted by priority
        const sortedRules = updatedRules.sort((a: any, b: any) => a.priority - b.priority)
        expect(sortedRules[0]).toMatchObject({
          id: cleanTrafficRule.id,
          comment: 'Clean traffic - block SMB',
          action: 'drop',
          priority: 50,
          dstPortStart: 445
        })
        expect(sortedRules[1]).toMatchObject({
          id: initialRule.id,
          comment: 'HTTP rule - no clean traffic',
          action: 'accept',
          priority: 100
        })
      })
    })

    it('should handle department internet speed configuration affecting rules', async () => {
      await runTestInTransaction(async ({ adminContext }) => {
        // Create department with speed limit
        const limitedDepartment = await adminContext.prisma.department.create({
          data: {
            name: 'Limited Speed Department',
            internetSpeed: 50 // 50 Mbps limit
          }
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${limitedDepartment.name}`,
            internalName: `dept-filter-${limitedDepartment.id}`,
            uuid: `uuid-${limitedDepartment.id}`,
            description: 'Department firewall filter with speed limits',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: limitedDepartment.id }
            }
          }
        })

        // Create speed-limiting rules that would be applied based on internetSpeed config
        const speedLimitRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'out',
            priority: 75,
            protocol: 'tcp',
            comment: `Rate limit for ${limitedDepartment.internetSpeed}Mbps`
          }
        })

        // Verify rules reflect speed configuration
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallRules($departmentId: ID!) {
              getDepartmentFirewallRules(departmentId: $departmentId) {
                id
                comment
                priority
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: limitedDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        const rules = result.data?.getDepartmentFirewallRules
        expect(rules).toHaveLength(1)
        expect(rules[0].comment).toContain('50Mbps')
        expect(rules[0].priority).toBe(75)
      })
    })

    it('should handle IP subnet configuration affecting rule generation', async () => {
      await runTestInTransaction(async ({ adminContext }) => {
        // Create department with specific subnet
        const subnetDepartment = await adminContext.prisma.department.create({
          data: {
            name: 'Subnet Department',
            ipSubnet: '192.168.100.0/24'
          }
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${subnetDepartment.name}`,
            internalName: `dept-filter-${subnetDepartment.id}`,
            uuid: `uuid-${subnetDepartment.id}`,
            description: 'Department firewall filter with subnet rules',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: subnetDepartment.id }
            }
          }
        })

        // Create subnet-specific rules
        const subnetRule = await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 200,
            protocol: 'tcp',
            srcIpAddr: '192.168.100.0',
            srcIpMask: '255.255.255.0',
            comment: 'Allow from department subnet'
          }
        })

        // Verify subnet configuration is reflected in rules
        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallRules($departmentId: ID!) {
              getDepartmentFirewallRules(departmentId: $departmentId) {
                id
                comment
                srcIpAddr
                srcIpMask
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: subnetDepartment.id }
        })

        expect(result.errors).toBeUndefined()
        const rules = result.data?.getDepartmentFirewallRules
        expect(rules).toHaveLength(1)
        expect(rules[0]).toMatchObject({
          comment: 'Allow from department subnet',
          srcIpAddr: '192.168.100.0',
          srcIpMask: '255.255.255.0'
        })
      })
    })
  })

  describe('DepartmentResolver Authorization Integration', () => {
    const CREATE_DEPARTMENT_MUTATION = `
      mutation CreateDepartment($name: String!) {
        createDepartment(name: $name) {
          id
          name
          totalMachines
        }
      }
    `

    const DESTROY_DEPARTMENT_MUTATION = `
      mutation DestroyDepartment($id: ID!) {
        destroyDepartment(id: $id) {
          id
          name
        }
      }
    `

    it('should deny USER access to createDepartment mutation', async () => {
      await runTestInTransaction(async ({ context }) => {
        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_DEPARTMENT_MUTATION,
          contextValue: context, // USER role context
          variableValues: { name: 'Test Department' }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Access denied')
      })
    })

    it('should allow ADMIN access to createDepartment mutation', async () => {
      await runTestInTransaction(async ({ adminContext }) => {
        const result: ExecutionResult = await graphql({
          schema,
          source: CREATE_DEPARTMENT_MUTATION,
          contextValue: adminContext, // ADMIN role context
          variableValues: { name: 'Admin Created Department' }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createDepartment).toBeDefined()
        expect(result.data?.createDepartment.name).toBe('Admin Created Department')
        expect(result.data?.createDepartment.totalMachines).toBe(0)
      })
    })

    it('should deny USER access to destroyDepartment mutation', async () => {
      await runTestInTransaction(async ({ testDepartment, context }) => {
        const result: ExecutionResult = await graphql({
          schema,
          source: DESTROY_DEPARTMENT_MUTATION,
          contextValue: context, // USER role context
          variableValues: { id: testDepartment.id }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Access denied')
      })
    })

    it('should allow ADMIN access to destroyDepartment mutation when department has no machines', async () => {
      await runTestInTransaction(async ({ adminContext }) => {
        // First create a department to delete
        const createResult: ExecutionResult = await graphql({
          schema,
          source: CREATE_DEPARTMENT_MUTATION,
          contextValue: adminContext,
          variableValues: { name: 'Department To Delete' }
        })

        expect(createResult.errors).toBeUndefined()
        const createdDepartmentId = createResult.data?.createDepartment.id

        // Then destroy it
        const destroyResult: ExecutionResult = await graphql({
          schema,
          source: DESTROY_DEPARTMENT_MUTATION,
          contextValue: adminContext,
          variableValues: { id: createdDepartmentId }
        })

        expect(destroyResult.errors).toBeUndefined()
        expect(destroyResult.data?.destroyDepartment).toBeDefined()
        expect(destroyResult.data?.destroyDepartment.id).toBe(createdDepartmentId)
        expect(destroyResult.data?.destroyDepartment.name).toBe('Department To Delete')
      })
    })

    it('should prevent ADMIN from destroying department with machines (business rule violation)', async () => {
      await runTestInTransaction(async ({ testDepartment, testMachines, adminContext }) => {
        // testDepartment already has machines from the test setup
        const result: ExecutionResult = await graphql({
          schema,
          source: DESTROY_DEPARTMENT_MUTATION,
          contextValue: adminContext,
          variableValues: { id: testDepartment.id }
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0]?.message).toContain('Cannot delete department with machines')
      })
    })
  })

  describe('Multi-VM Integration Testing', () => {
    it('should handle department template application to multiple VMs simultaneously', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments, multipleVMs }) => {
        const department = departments[0]
        const departmentVMs = multipleVMs.filter(vmData =>
          vmData.vm.departmentId === department.id
        )

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${department.name}`,
            internalName: `dept-filter-${department.id}`,
            uuid: `uuid-${department.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: department.id }
            }
          }
        })

        // Create web template
        const webTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'multi-vm-web-template',
            internalName: 'multi-vm-web-template',
            uuid: 'multi-vm-web-template-uuid',
            description: 'Web template for multi-VM testing',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        // Add rules to template
        const templateRules = [
          { port: 80, comment: 'HTTP for web servers' },
          { port: 443, comment: 'HTTPS for web servers' },
          { port: 8080, comment: 'Alt HTTP for web servers' }
        ]

        for (const rule of templateRules) {
          await adminContext.prisma.fWRule.create({
            data: {
              nwFilterId: webTemplate.id,
              action: 'accept',
              direction: 'in',
              priority: 100,
              protocol: 'tcp',
              dstPortStart: rule.port,
              dstPortEnd: rule.port,
              comment: rule.comment
            }
          })
        }

        // Apply template to department
        const templateResult = await graphql({
          schema,
          source: APPLY_DEPARTMENT_TEMPLATE_MUTATION,
          contextValue: adminContext,
          variableValues: {
            input: {
              departmentId: department.id,
              templateFilterId: webTemplate.id
            }
          }
        })

        expect(templateResult.errors).toBeUndefined()
        expect(templateResult.data?.applyDepartmentFirewallTemplate).toBe(true)

        // Verify all VMs in department inherit template rules
        const stateResult = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: department.id }
        })

        expect(stateResult.errors).toBeUndefined()
        const state = stateResult.data?.getDepartmentFirewallState
        expect(state.vmCount).toBe(departmentVMs.length)
        expect(state.effectiveRules).toHaveLength(3) // HTTP + HTTPS + Alt HTTP

        // Verify template reference was created
        const filterReference = await adminContext.prisma.filterReference.findFirst({
          where: {
            sourceFilterId: departmentFilter.id,
            targetFilterId: webTemplate.id
          }
        })
        expect(filterReference).toBeDefined()

        // Verify WebSocket event was emitted
        expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
          'departmentFirewall',
          'templateApplied',
          expect.objectContaining({
            data: {
              departmentId: department.id,
              templateFilterId: webTemplate.id
            }
          })
        )
      })
    })

    it('should handle department rule creation with propagation to multiple VMs', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments, multipleVMs }) => {
        const department = departments[0]
        const departmentVMs = multipleVMs.filter(vmData =>
          vmData.vm.departmentId === department.id
        )

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${department.name}`,
            internalName: `dept-filter-${department.id}`,
            uuid: `uuid-${department.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: department.id }
            }
          }
        })

        // Create VM filters and establish inheritance chain
        for (const vmData of departmentVMs) {
          const vmFilter = await adminContext.prisma.nWFilter.create({
            data: {
              name: `vm-${vmData.vm.name}`,
              internalName: `vm-filter-${vmData.vm.id}`,
              uuid: `vm-uuid-${vmData.vm.id}`,
              description: 'VM firewall filter',
              chain: 'ipv4',
              type: 'vm',
              priority: 600,
              stateMatch: true
            }
          })

          await adminContext.prisma.machineNWFilter.create({
            data: {
              machineId: vmData.vm.id,
              nwFilterId: vmFilter.id
            }
          })

          // Create inheritance reference
          await adminContext.prisma.filterReference.create({
            data: {
              sourceFilterId: vmFilter.id,
              targetFilterId: departmentFilter.id
            }
          })
        }

        // Create department rule that affects all VMs
        const ruleResult = await graphql({
          schema,
          source: CREATE_DEPARTMENT_RULE_MUTATION,
          contextValue: adminContext,
          variableValues: {
            departmentId: department.id,
            input: {
              action: 'accept',
              direction: 'in',
              priority: 150,
              protocol: 'tcp',
              dstPortStart: 3389,
              dstPortEnd: 3389,
              comment: 'RDP access for all department VMs'
            }
          }
        })

        expect(ruleResult.errors).toBeUndefined()
        const createdRule = ruleResult.data?.createDepartmentFirewallRule
        expect(createdRule.comment).toBe('RDP access for all department VMs')

        // Verify rule exists in department state
        const stateResult = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: department.id }
        })

        expect(stateResult.errors).toBeUndefined()
        const state = stateResult.data?.getDepartmentFirewallState
        expect(state.customRules).toHaveLength(1)
        expect(state.customRules[0].dstPortStart).toBe(3389)
        expect(state.vmCount).toBe(departmentVMs.length)

        // Verify all VMs would inherit this rule through effective rules
        expect(state.effectiveRules).toContainEqual(
          expect.objectContaining({
            id: createdRule.id,
            comment: 'RDP access for all department VMs'
          })
        )
      })
    })

    it('should handle bulk VM addition to department with existing firewall rules', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments }) => {
        const department = departments[0]

        // Create department filter with existing rules
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${department.name}`,
            internalName: `dept-filter-${department.id}`,
            uuid: `uuid-${department.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: department.id }
            }
          }
        })

        // Add existing rules to department
        const existingRules = [
          { port: 22, comment: 'SSH access' },
          { port: 80, comment: 'HTTP access' },
          { port: 443, comment: 'HTTPS access' }
        ]

        for (const rule of existingRules) {
          await adminContext.prisma.fWRule.create({
            data: {
              nwFilterId: departmentFilter.id,
              action: 'accept',
              direction: 'in',
              priority: 100,
              protocol: 'tcp',
              dstPortStart: rule.port,
              dstPortEnd: rule.port,
              comment: rule.comment
            }
          })
        }

        // Create multiple new VMs and add them to department
        const newVMs = []
        for (let i = 0; i < 5; i++) {
          const newVM = await adminContext.prisma.machine.create({
            data: {
              name: `bulk-vm-${i + 1}`,
              internalName: `bulk-vm-${i + 1}-internal`,
              status: 'stopped',
              os: 'ubuntu-22.04',
              cpuCores: 2,
              ramGB: 4,
              diskSizeGB: 50,
              departmentId: department.id,
              templateId: department.id
            }
          })
          newVMs.push(newVM)
        }

        // Create VM filters and inheritance for new VMs
        for (const vm of newVMs) {
          const vmFilter = await adminContext.prisma.nWFilter.create({
            data: {
              name: `vm-${vm.name}`,
              internalName: `vm-filter-${vm.id}`,
              uuid: `vm-uuid-${vm.id}`,
              description: 'VM firewall filter',
              chain: 'ipv4',
              type: 'vm',
              priority: 600,
              stateMatch: true
            }
          })

          await adminContext.prisma.machineNWFilter.create({
            data: {
              machineId: vm.id,
              nwFilterId: vmFilter.id
            }
          })

          await adminContext.prisma.filterReference.create({
            data: {
              sourceFilterId: vmFilter.id,
              targetFilterId: departmentFilter.id
            }
          })
        }

        // Verify department state reflects new VMs
        const stateResult = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: department.id }
        })

        expect(stateResult.errors).toBeUndefined()
        const state = stateResult.data?.getDepartmentFirewallState
        expect(state.vmCount).toBe(7) // 2 original + 5 new
        expect(state.customRules).toHaveLength(3) // SSH, HTTP, HTTPS
        expect(state.effectiveRules).toHaveLength(3)

        // Verify all rules are inherited by new VMs
        const portsCovered = state.effectiveRules.map((rule: any) => rule.dstPortStart)
        expect(portsCovered).toContain(22)
        expect(portsCovered).toContain(80)
        expect(portsCovered).toContain(443)
      })
    })
  })

  describe('Cross-Department Integration Testing', () => {
    it('should handle VM migration between departments with different firewall policies', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments, multipleVMs }) => {
        const sourceDept = departments[0]
        const targetDept = departments[1]
        const vmToMigrate = multipleVMs.find(vmData =>
          vmData.vm.departmentId === sourceDept.id
        )?.vm

        if (!vmToMigrate) {
          throw new Error('No VM found in source department')
        }

        // Create source department filter with restrictive rules
        const sourceDeptFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${sourceDept.name}`,
            internalName: `dept-filter-${sourceDept.id}`,
            uuid: `uuid-${sourceDept.id}`,
            description: 'Source department filter - restrictive',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: sourceDept.id }
            }
          }
        })

        // Add restrictive rules to source department
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: sourceDeptFilter.id,
            action: 'drop',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'Block HTTP in source dept'
          }
        })

        // Create target department filter with permissive rules
        const targetDeptFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${targetDept.name}`,
            internalName: `dept-filter-${targetDept.id}`,
            uuid: `uuid-${targetDept.id}`,
            description: 'Target department filter - permissive',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: targetDept.id }
            }
          }
        })

        // Add permissive rules to target department
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: targetDeptFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'Allow HTTP in target dept'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: targetDeptFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 110,
            protocol: 'tcp',
            dstPortStart: 443,
            dstPortEnd: 443,
            comment: 'Allow HTTPS in target dept'
          }
        })

        // Verify source department state before migration
        const sourceBefore = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: sourceDept.id }
        })

        expect(sourceBefore.errors).toBeUndefined()
        expect(sourceBefore.data?.getDepartmentFirewallState.vmCount).toBeGreaterThan(0)
        expect(sourceBefore.data?.getDepartmentFirewallState.customRules).toHaveLength(1)

        // Migrate VM to target department
        await adminContext.prisma.machine.update({
          where: { id: vmToMigrate.id },
          data: { departmentId: targetDept.id }
        })

        // Verify source department state after migration
        const sourceAfter = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: sourceDept.id }
        })

        expect(sourceAfter.errors).toBeUndefined()
        expect(sourceAfter.data?.getDepartmentFirewallState.vmCount).toBe(
          sourceBefore.data?.getDepartmentFirewallState.vmCount - 1
        )

        // Verify target department state after migration
        const targetAfter = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: targetDept.id }
        })

        expect(targetAfter.errors).toBeUndefined()
        expect(targetAfter.data?.getDepartmentFirewallState.vmCount).toBeGreaterThan(0)
        expect(targetAfter.data?.getDepartmentFirewallState.customRules).toHaveLength(2) // HTTP + HTTPS

        // Verify target department has different firewall policies
        const targetRules = targetAfter.data?.getDepartmentFirewallState.customRules
        const httpRule = targetRules.find((rule: any) => rule.dstPortStart === 80)
        expect(httpRule.action).toBe('accept') // Permissive in target
        expect(httpRule.comment).toBe('Allow HTTP in target dept')
      })
    })

    it('should handle template sharing between departments', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments }) => {
        const dept1 = departments[0]
        const dept2 = departments[1]

        // Create shared template
        const sharedTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'shared-web-template',
            internalName: 'shared-web-template',
            uuid: 'shared-web-template-uuid',
            description: 'Shared template for web services',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        // Add rules to shared template
        const sharedRules = [
          { port: 80, comment: 'Shared HTTP rule' },
          { port: 443, comment: 'Shared HTTPS rule' }
        ]

        for (const rule of sharedRules) {
          await adminContext.prisma.fWRule.create({
            data: {
              nwFilterId: sharedTemplate.id,
              action: 'accept',
              direction: 'in',
              priority: 100,
              protocol: 'tcp',
              dstPortStart: rule.port,
              dstPortEnd: rule.port,
              comment: rule.comment
            }
          })
        }

        // Create department filters
        const dept1Filter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${dept1.name}`,
            internalName: `dept-filter-${dept1.id}`,
            uuid: `uuid-${dept1.id}`,
            description: 'Department 1 filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: dept1.id }
            }
          }
        })

        const dept2Filter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${dept2.name}`,
            internalName: `dept-filter-${dept2.id}`,
            uuid: `uuid-${dept2.id}`,
            description: 'Department 2 filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: dept2.id }
            }
          }
        })

        // Apply shared template to both departments
        const applyToDept1 = await graphql({
          schema,
          source: APPLY_DEPARTMENT_TEMPLATE_MUTATION,
          contextValue: adminContext,
          variableValues: {
            input: {
              departmentId: dept1.id,
              templateFilterId: sharedTemplate.id
            }
          }
        })

        const applyToDept2 = await graphql({
          schema,
          source: APPLY_DEPARTMENT_TEMPLATE_MUTATION,
          contextValue: adminContext,
          variableValues: {
            input: {
              departmentId: dept2.id,
              templateFilterId: sharedTemplate.id
            }
          }
        })

        expect(applyToDept1.errors).toBeUndefined()
        expect(applyToDept2.errors).toBeUndefined()
        expect(applyToDept1.data?.applyDepartmentFirewallTemplate).toBe(true)
        expect(applyToDept2.data?.applyDepartmentFirewallTemplate).toBe(true)

        // Verify both departments have access to shared template rules
        const dept1State = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: dept1.id }
        })

        const dept2State = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: dept2.id }
        })

        expect(dept1State.errors).toBeUndefined()
        expect(dept2State.errors).toBeUndefined()

        // Both departments should have the same shared template rules
        expect(dept1State.data?.getDepartmentFirewallState.effectiveRules).toHaveLength(2)
        expect(dept2State.data?.getDepartmentFirewallState.effectiveRules).toHaveLength(2)

        // Verify rules are the same across both departments
        const dept1Ports = dept1State.data?.getDepartmentFirewallState.effectiveRules.map((rule: any) => rule.dstPortStart)
        const dept2Ports = dept2State.data?.getDepartmentFirewallState.effectiveRules.map((rule: any) => rule.dstPortStart)

        expect(dept1Ports.sort()).toEqual(dept2Ports.sort())
        expect(dept1Ports).toContain(80)
        expect(dept1Ports).toContain(443)
      })
    })

    it('should verify department isolation (rules dont leak between departments)', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments }) => {
        const dept1 = departments[0]
        const dept2 = departments[1]

        // Create separate department filters
        const dept1Filter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${dept1.name}`,
            internalName: `dept-filter-${dept1.id}`,
            uuid: `uuid-${dept1.id}`,
            description: 'Department 1 filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: dept1.id }
            }
          }
        })

        const dept2Filter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${dept2.name}`,
            internalName: `dept-filter-${dept2.id}`,
            uuid: `uuid-${dept2.id}`,
            description: 'Department 2 filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: dept2.id }
            }
          }
        })

        // Add unique rules to each department
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: dept1Filter.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 3000,
            dstPortEnd: 3000,
            comment: 'Department 1 unique rule'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: dept2Filter.id,
            action: 'accept',
            direction: 'in',
            priority: 100,
            protocol: 'tcp',
            dstPortStart: 4000,
            dstPortEnd: 4000,
            comment: 'Department 2 unique rule'
          }
        })

        // Verify each department only sees its own rules
        const dept1State = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: dept1.id }
        })

        const dept2State = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: dept2.id }
        })

        expect(dept1State.errors).toBeUndefined()
        expect(dept2State.errors).toBeUndefined()

        const dept1Rules = dept1State.data?.getDepartmentFirewallState.customRules
        const dept2Rules = dept2State.data?.getDepartmentFirewallState.customRules

        expect(dept1Rules).toHaveLength(1)
        expect(dept2Rules).toHaveLength(1)

        // Department 1 should only have its rule (port 3000)
        expect(dept1Rules[0].dstPortStart).toBe(3000)
        expect(dept1Rules[0].comment).toBe('Department 1 unique rule')

        // Department 2 should only have its rule (port 4000)
        expect(dept2Rules[0].dstPortStart).toBe(4000)
        expect(dept2Rules[0].comment).toBe('Department 2 unique rule')

        // Verify no cross-contamination
        expect(dept1Rules[0].dstPortStart).not.toBe(4000)
        expect(dept2Rules[0].dstPortStart).not.toBe(3000)
      })
    })
  })

  describe('Enhanced Real-Time Event Integration', () => {
    it('should handle event delivery to multiple admins for department changes', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments }) => {
        const department = departments[0]
        const { mockEmit, getCapturedEvents } = captureWebSocketEvents()
        const adminConnections = simulateMultipleConnections(3)

        // Mock socket service to capture events for multiple admins
        mockSocketService.sendToAdmins.mockImplementation((channel, event, data) => {
          adminConnections.forEach(conn => {
            mockEmit(event, data, `admin-${conn.id}`)
          })
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${department.name}`,
            internalName: `dept-filter-${department.id}`,
            uuid: `uuid-${department.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: department.id }
            }
          }
        })

        jest.clearAllMocks()

        // Create department rule
        const ruleResult = await graphql({
          schema,
          source: CREATE_DEPARTMENT_RULE_MUTATION,
          contextValue: adminContext,
          variableValues: {
            departmentId: department.id,
            input: {
              action: 'accept',
              direction: 'in',
              priority: 100,
              protocol: 'tcp',
              dstPortStart: 80,
              dstPortEnd: 80,
              comment: 'Multi-admin event test'
            }
          }
        })

        expect(ruleResult.errors).toBeUndefined()

        // Verify events were captured for all admin connections
        const events = getCapturedEvents()
        expect(events.length).toBe(3) // One for each admin connection

        events.forEach(event => {
          assertEventPayload(event, {
            eventType: 'ruleCreated',
            payload: expect.objectContaining({
              data: expect.objectContaining({
                departmentId: department.id,
                ruleId: expect.any(String)
              })
            })
          })
        })
      })
    })

    it('should verify event sequencing during complex department operations', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments }) => {
        const department = departments[0]
        const { mockEmit, getCapturedEvents } = captureWebSocketEvents()

        // Mock socket service to capture event sequence
        mockSocketService.sendToAdmins.mockImplementation((channel, event, data) => {
          mockEmit(event, data)
        })

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${department.name}`,
            internalName: `dept-filter-${department.id}`,
            uuid: `uuid-${department.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: department.id }
            }
          }
        })

        // Create template
        const template = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'sequence-test-template',
            internalName: 'sequence-test-template',
            uuid: 'sequence-test-template-uuid',
            description: 'Template for sequence testing',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        jest.clearAllMocks()

        // Execute complex workflow with events
        const workflowSteps = [
          {
            name: 'Apply template',
            operation: () => graphql({
              schema,
              source: APPLY_DEPARTMENT_TEMPLATE_MUTATION,
              contextValue: adminContext,
              variableValues: {
                input: {
                  departmentId: department.id,
                  templateFilterId: template.id
                }
              }
            }),
            verify: (result: any) => expect(result.errors).toBeUndefined()
          },
          {
            name: 'Create custom rule',
            operation: () => graphql({
              schema,
              source: CREATE_DEPARTMENT_RULE_MUTATION,
              contextValue: adminContext,
              variableValues: {
                departmentId: department.id,
                input: {
                  action: 'accept',
                  direction: 'in',
                  priority: 150,
                  protocol: 'tcp',
                  dstPortStart: 8080,
                  dstPortEnd: 8080,
                  comment: 'Custom rule after template'
                }
              }
            }),
            verify: (result: any) => expect(result.errors).toBeUndefined()
          },
          {
            name: 'Flush firewall',
            operation: () => graphql({
              schema,
              source: FLUSH_DEPARTMENT_FIREWALL_MUTATION,
              contextValue: adminContext,
              variableValues: { departmentId: department.id }
            }),
            verify: (result: any) => expect(result.errors).toBeUndefined()
          }
        ]

        await executeCompleteWorkflow(workflowSteps)

        // Verify event sequence
        const events = getCapturedEvents()
        expect(events.length).toBe(3)

        verifyEventSequence(events, [
          'templateApplied',
          'ruleCreated',
          'flushed'
        ])

        // Verify event timing
        for (let i = 1; i < events.length; i++) {
          expect(events[i].timestamp).toBeGreaterThan(events[i - 1].timestamp)
        }
      })
    })
  })

  describe('Service Integration Verification', () => {
    it('should verify integration with NetworkFilterService during department operations', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments }) => {
        const department = departments[0]

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${department.name}`,
            internalName: `dept-filter-${department.id}`,
            uuid: `uuid-${department.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: department.id }
            }
          }
        })

        // Clear network service mocks
        jest.clearAllMocks()

        // Test cross-service operations
        const serviceOperations = {
          departmentFirewall: async () => {
            return await graphql({
              schema,
              source: CREATE_DEPARTMENT_RULE_MUTATION,
              contextValue: adminContext,
              variableValues: {
                departmentId: department.id,
                input: {
                  action: 'accept',
                  direction: 'in',
                  priority: 100,
                  protocol: 'tcp',
                  dstPortStart: 80,
                  dstPortEnd: 80,
                  comment: 'Service integration test'
                }
              }
            })
          }
        }

        const results = await executeAcrossAllFirewallServices(serviceOperations)
        verifyServiceIntegration(results, ['departmentFirewall'])

        // Verify NetworkFilterService was not called for rule creation
        expect(mockNetworkFilterService.flushNWFilter).not.toHaveBeenCalled()

        // But should be called during flush operation
        const flushResult = await graphql({
          schema,
          source: FLUSH_DEPARTMENT_FIREWALL_MUTATION,
          contextValue: adminContext,
          variableValues: { departmentId: department.id }
        })

        expect(flushResult.errors).toBeUndefined()
        expect(mockNetworkFilterService.flushNWFilter).toHaveBeenCalledWith(departmentFilter.id)
      })
    })

    it('should verify consistent state across department and VM-level services', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments, multipleVMs }) => {
        const department = departments[0]
        const departmentVMs = multipleVMs.filter(vmData =>
          vmData.vm.departmentId === department.id
        )

        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${department.name}`,
            internalName: `dept-filter-${department.id}`,
            uuid: `uuid-${department.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: department.id }
            }
          }
        })

        // Create VM filters with inheritance
        for (const vmData of departmentVMs) {
          const vmFilter = await adminContext.prisma.nWFilter.create({
            data: {
              name: `vm-${vmData.vm.name}`,
              internalName: `vm-filter-${vmData.vm.id}`,
              uuid: `vm-uuid-${vmData.vm.id}`,
              description: 'VM firewall filter',
              chain: 'ipv4',
              type: 'vm',
              priority: 600,
              stateMatch: true
            }
          })

          await adminContext.prisma.machineNWFilter.create({
            data: {
              machineId: vmData.vm.id,
              nwFilterId: vmFilter.id
            }
          })

          await adminContext.prisma.filterReference.create({
            data: {
              sourceFilterId: vmFilter.id,
              targetFilterId: departmentFilter.id
            }
          })
        }

        // Create department rule
        const ruleResult = await graphql({
          schema,
          source: CREATE_DEPARTMENT_RULE_MUTATION,
          contextValue: adminContext,
          variableValues: {
            departmentId: department.id,
            input: {
              action: 'accept',
              direction: 'in',
              priority: 100,
              protocol: 'tcp',
              dstPortStart: 443,
              dstPortEnd: 443,
              comment: 'Cross-service consistency test'
            }
          }
        })

        expect(ruleResult.errors).toBeUndefined()
        const createdRule = ruleResult.data?.createDepartmentFirewallRule

        // Verify department state
        const deptState = await graphql({
          schema,
          source: GET_DEPARTMENT_FIREWALL_STATE_QUERY,
          contextValue: adminContext,
          variableValues: { departmentId: department.id }
        })

        expect(deptState.errors).toBeUndefined()
        const deptData = deptState.data?.getDepartmentFirewallState

        // Check service state consistency
        checkServiceStateConsistency(
          {
            departmentService: {
              customRules: deptData.customRules,
              effectiveRules: deptData.effectiveRules,
              vmCount: deptData.vmCount
            },
            createdRule: createdRule
          },
          ['customRules', 'effectiveRules']
        )

        // Verify firewall state consistency for each VM
        for (const vmData of departmentVMs) {
          const consistency = await verifyFirewallStateConsistency(
            adminContext.prisma,
            vmData.vm.id
          )
          expect(consistency.isValid).toBe(true)
        }
      })
    })
  })

  describe('Performance Testing', () => {
    it('should handle firewall rule calculation performance with large departments', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create multiple rules to simulate large department
        const rulePromises = []
        for (let i = 0; i < 50; i++) {
          rulePromises.push(
            adminContext.prisma.fWRule.create({
              data: {
                nwFilterId: departmentFilter.id,
                action: i % 2 === 0 ? 'accept' : 'drop',
                direction: 'in',
                priority: 100 + i,
                protocol: 'tcp',
                dstPortStart: 8000 + i,
                dstPortEnd: 8000 + i,
                comment: `Rule ${i + 1}`
              }
            })
          )
        }

        await Promise.all(rulePromises)

        // Measure performance of state calculation
        const startTime = Date.now()

        const result: ExecutionResult = await graphql({
          schema,
          source: `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
                customRules {
                  id
                  priority
                }
                effectiveRules {
                  id
                  priority
                }
              }
            }
          `,
          contextValue: adminContext,
          variableValues: { departmentId: testDepartment.id }
        })

        const endTime = Date.now()
        const duration = endTime - startTime

        expect(result.errors).toBeUndefined()
        expect(result.data?.getDepartmentFirewallState.customRules).toHaveLength(50)
        expect(result.data?.getDepartmentFirewallState.effectiveRules).toHaveLength(50)

        // Performance should be reasonable (less than 5 seconds for 50 rules)
        expect(duration).toBeLessThan(5000)
        console.log(`Department firewall state calculation completed in ${duration}ms`)
      })
    })

    it('should handle concurrent department operations efficiently', async () => {
      await withComplexTransaction(prisma, async ({ adminContext, departments }) => {
        // Create department filters for concurrent operations
        const deptFilters = []
        for (const dept of departments) {
          const filter = await adminContext.prisma.nWFilter.create({
            data: {
              name: `dept-${dept.name}`,
              internalName: `dept-filter-${dept.id}`,
              uuid: `uuid-${dept.id}`,
              description: 'Department firewall filter',
              chain: 'ipv4',
              type: 'department',
              priority: 500,
              stateMatch: true,
              departments: {
                connect: { id: dept.id }
              }
            }
          })
          deptFilters.push({ dept, filter })
        }

        // Create concurrent operations
        const concurrentOperations = deptFilters.map(({ dept }, index) =>
          () => graphql({
            schema,
            source: CREATE_DEPARTMENT_RULE_MUTATION,
            contextValue: adminContext,
            variableValues: {
              departmentId: dept.id,
              input: {
                action: 'accept',
                direction: 'in',
                priority: 100,
                protocol: 'tcp',
                dstPortStart: 9000 + index,
                dstPortEnd: 9000 + index,
                comment: `Concurrent rule ${index + 1}`
              }
            }
          })
        )

        const startTime = Date.now()
        const results = await simulateConcurrentServiceOperations(concurrentOperations)
        const endTime = Date.now()
        const duration = endTime - startTime

        // All operations should succeed
        expect(results.successCount).toBe(departments.length)
        expect(results.failureCount).toBe(0)

        // Verify all rules were created
        results.successful.forEach((result, index) => {
          expect(result.errors).toBeUndefined()
          expect(result.data?.createDepartmentFirewallRule).toBeDefined()
          expect(result.data?.createDepartmentFirewallRule.comment).toBe(`Concurrent rule ${index + 1}`)
        })

        console.log(`Concurrent department operations completed in ${duration}ms`)
      })
    })
  })

  describe('Recursive Filter Reference Tests', () => {
    it('should fetch rules from deeply nested filter references (4+ levels)', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create department filter
        const departmentFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        // Create 4-level chain: dept -> level1 -> level2 -> level3 -> level4
        const level1 = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'level-1',
            internalName: 'level-1-filter',
            uuid: 'level-1-uuid',
            description: 'Level 1 template',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        const level2 = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'level-2',
            internalName: 'level-2-filter',
            uuid: 'level-2-uuid',
            description: 'Level 2 template',
            chain: 'ipv4',
            type: 'generic',
            priority: 300,
            stateMatch: true
          }
        })

        const level3 = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'level-3',
            internalName: 'level-3-filter',
            uuid: 'level-3-uuid',
            description: 'Level 3 template',
            chain: 'ipv4',
            type: 'generic',
            priority: 200,
            stateMatch: true
          }
        })

        const level4 = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'level-4',
            internalName: 'level-4-filter',
            uuid: 'level-4-uuid',
            description: 'Level 4 template',
            chain: 'ipv4',
            type: 'generic',
            priority: 100,
            stateMatch: true
          }
        })

        // Create rules at each level
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: departmentFilter.id,
            action: 'accept',
            direction: 'in',
            priority: 500,
            protocol: 'tcp',
            dstPortStart: 22,
            dstPortEnd: 22,
            comment: 'Department custom rule'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: level1.id,
            action: 'accept',
            direction: 'in',
            priority: 400,
            protocol: 'tcp',
            dstPortStart: 80,
            dstPortEnd: 80,
            comment: 'Level 1 HTTP'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: level2.id,
            action: 'accept',
            direction: 'in',
            priority: 300,
            protocol: 'tcp',
            dstPortStart: 443,
            dstPortEnd: 443,
            comment: 'Level 2 HTTPS'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: level3.id,
            action: 'accept',
            direction: 'in',
            priority: 200,
            protocol: 'tcp',
            dstPortStart: 3306,
            dstPortEnd: 3306,
            comment: 'Level 3 MySQL'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: level4.id,
            action: 'drop',
            direction: 'in',
            priority: 100,
            protocol: 'all',
            comment: 'Level 4 Drop All'
          }
        })

        // Create reference chain
        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: departmentFilter.id,
            targetFilterId: level1.id
          }
        })

        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: level1.id,
            targetFilterId: level2.id
          }
        })

        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: level2.id,
            targetFilterId: level3.id
          }
        })

        await adminContext.prisma.filterReference.create({
          data: {
            sourceFilterId: level3.id,
            targetFilterId: level4.id
          }
        })

        // Query firewall rules
        const response = await executeGraphQL(
          GET_DEPARTMENT_FIREWALL_RULES,
          { departmentId: testDepartment.id },
          adminContext
        )

        expect(response.errors).toBeUndefined()
        const rules = response.data?.getDepartmentFirewallRules

        // Should have all 5 rules from all levels
        expect(rules).toHaveLength(5)

        // Verify rules are sorted by priority
        expect(rules[0].comment).toBe('Level 4 Drop All')
        expect(rules[1].comment).toBe('Level 3 MySQL')
        expect(rules[2].comment).toBe('Level 2 HTTPS')
        expect(rules[3].comment).toBe('Level 1 HTTP')
        expect(rules[4].comment).toBe('Department custom rule')
      })
    })

    it('should show Basic Security nested rules in department firewall state', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // The department callback already creates Basic Security and Drop All references
        // We just need to verify we can see all nested rules

        const response = await executeGraphQL(
          `
            query GetDepartmentFirewallState($departmentId: ID!) {
              getDepartmentFirewallState(departmentId: $departmentId) {
                departmentId
                effectiveRules {
                  id
                  action
                  direction
                  priority
                  protocol
                  comment
                }
                appliedTemplates
                vmCount
              }
            }
          `,
          { departmentId: testDepartment.id },
          adminContext
        )

        expect(response.errors).toBeUndefined()
        const state = response.data?.getDepartmentFirewallState

        expect(state).toBeDefined()
        expect(state.departmentId).toBe(testDepartment.id)

        // Should have rules from:
        // - Basic Security filter (if it has direct rules)
        // - Clean Traffic filter (referenced by Basic Security)
        // - DHCP filter (referenced by Basic Security)
        // - Use HTTP service filter (referenced by Basic Security)
        // - Use HTTPS service filter (referenced by Basic Security)
        // - Drop All filter
        expect(state.effectiveRules.length).toBeGreaterThan(0)

        // Verify rules are sorted by priority
        for (let i = 1; i < state.effectiveRules.length; i++) {
          expect(state.effectiveRules[i].priority).toBeGreaterThanOrEqual(
            state.effectiveRules[i - 1].priority
          )
        }
      })
    })

    it('should handle circular filter references without infinite loop', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create filters with circular reference: A -> B -> C -> A
        const filterA = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'filter-a',
            internalName: 'filter-a',
            uuid: 'filter-a-uuid',
            description: 'Filter A',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        const filterB = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'filter-b',
            internalName: 'filter-b',
            uuid: 'filter-b-uuid',
            description: 'Filter B',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        const filterC = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'filter-c',
            internalName: 'filter-c',
            uuid: 'filter-c-uuid',
            description: 'Filter C',
            chain: 'ipv4',
            type: 'generic',
            priority: 300,
            stateMatch: true
          }
        })

        // Create rules
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: filterA.id,
            action: 'accept',
            direction: 'in',
            priority: 500,
            protocol: 'tcp',
            comment: 'Rule A'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: filterB.id,
            action: 'accept',
            direction: 'in',
            priority: 400,
            protocol: 'tcp',
            comment: 'Rule B'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: filterC.id,
            action: 'accept',
            direction: 'in',
            priority: 300,
            protocol: 'tcp',
            comment: 'Rule C'
          }
        })

        // Create circular reference
        await adminContext.prisma.filterReference.createMany({
          data: [
            { sourceFilterId: filterA.id, targetFilterId: filterB.id },
            { sourceFilterId: filterB.id, targetFilterId: filterC.id },
            { sourceFilterId: filterC.id, targetFilterId: filterA.id }
          ]
        })

        // Query should complete without timeout
        const startTime = Date.now()
        const response = await executeGraphQL(
          GET_DEPARTMENT_FIREWALL_RULES,
          { departmentId: testDepartment.id },
          adminContext
        )
        const endTime = Date.now()

        expect(response.errors).toBeUndefined()
        const rules = response.data?.getDepartmentFirewallRules

        // Should have exactly 3 rules (each filter's rule once)
        expect(rules).toHaveLength(3)

        // Should complete in reasonable time (< 1 second)
        expect(endTime - startTime).toBeLessThan(1000)

        // Verify each rule appears once
        const comments = rules.map((r: any) => r.comment)
        expect(comments).toContain('Rule A')
        expect(comments).toContain('Rule B')
        expect(comments).toContain('Rule C')
      })
    })

    it('should not duplicate rules in diamond dependency pattern', async () => {
      await runTestInTransaction(async ({ testDepartment, adminContext }) => {
        // Create diamond: dept -> [templateA, templateB] -> sharedTemplate
        const deptFilter = await adminContext.prisma.nWFilter.create({
          data: {
            name: `dept-${testDepartment.name}`,
            internalName: `dept-filter-${testDepartment.id}`,
            uuid: `uuid-${testDepartment.id}`,
            description: 'Department firewall filter',
            chain: 'ipv4',
            type: 'department',
            priority: 500,
            stateMatch: true,
            departments: {
              connect: { id: testDepartment.id }
            }
          }
        })

        const templateA = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'template-a',
            internalName: 'template-a',
            uuid: 'template-a-uuid',
            description: 'Template A',
            chain: 'ipv4',
            type: 'generic',
            priority: 400,
            stateMatch: true
          }
        })

        const templateB = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'template-b',
            internalName: 'template-b',
            uuid: 'template-b-uuid',
            description: 'Template B',
            chain: 'ipv4',
            type: 'generic',
            priority: 300,
            stateMatch: true
          }
        })

        const sharedTemplate = await adminContext.prisma.nWFilter.create({
          data: {
            name: 'shared-template',
            internalName: 'shared-template',
            uuid: 'shared-template-uuid',
            description: 'Shared Template',
            chain: 'ipv4',
            type: 'generic',
            priority: 200,
            stateMatch: true
          }
        })

        // Create unique rules
        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: templateA.id,
            action: 'accept',
            direction: 'in',
            priority: 400,
            protocol: 'tcp',
            comment: 'Template A rule'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: templateB.id,
            action: 'accept',
            direction: 'in',
            priority: 300,
            protocol: 'tcp',
            comment: 'Template B rule'
          }
        })

        await adminContext.prisma.fWRule.create({
          data: {
            nwFilterId: sharedTemplate.id,
            action: 'accept',
            direction: 'in',
            priority: 200,
            protocol: 'tcp',
            dstPortStart: 8080,
            dstPortEnd: 8080,
            comment: 'Shared template unique rule'
          }
        })

        // Create diamond references
        await adminContext.prisma.filterReference.createMany({
          data: [
            { sourceFilterId: deptFilter.id, targetFilterId: templateA.id },
            { sourceFilterId: deptFilter.id, targetFilterId: templateB.id },
            { sourceFilterId: templateA.id, targetFilterId: sharedTemplate.id },
            { sourceFilterId: templateB.id, targetFilterId: sharedTemplate.id }
          ]
        })

        // Query firewall rules
        const response = await executeGraphQL(
          GET_DEPARTMENT_FIREWALL_RULES,
          { departmentId: testDepartment.id },
          adminContext
        )

        expect(response.errors).toBeUndefined()
        const rules = response.data?.getDepartmentFirewallRules

        // Should have 3 unique rules (not 4 - shared template rule should appear once)
        expect(rules).toHaveLength(3)

        // Verify shared template rule appears only once
        const sharedRules = rules.filter((r: any) => r.comment === 'Shared template unique rule')
        expect(sharedRules).toHaveLength(1)
      })
    })
  })
})
})