import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { buildSchema } from 'type-graphql'
import { graphql, ExecutionResult } from 'graphql'
import { Container } from 'typedi'
import { PrismaClient } from '@prisma/client'
import { AdvancedFirewallResolver } from '@graphql/resolvers/AdvancedFirewallResolver'
import { SimplifiedFirewallResolver } from '@graphql/resolvers/SimplifiedFirewallResolver'
import { DepartmentFirewallResolver } from '@graphql/resolvers/DepartmentFirewallResolver'
import {
  withTransaction,
  createDepartmentWithVMs,
  verifyFirewallStateConsistency,
  captureWebSocketEvents,
  executeAcrossAllFirewallServices,
  simulateErrorAndRecovery,
  waitForEventDelivery
} from '../setup/test-helpers'
import { createMockUser, createMockMachine, createMockDepartment } from '../setup/mock-factories'
import { InfinibayContext } from '@utils/context'

// Mock all external services
const mockSocketService = {
  sendToUser: jest.fn(),
  sendToAll: jest.fn(),
  sendToDepartment: jest.fn(),
  sendToUsers: jest.fn(),
  emit: jest.fn(),
  getConnectedUsers: jest.fn().mockReturnValue(['user1', 'user2', 'user3']),
  isUserConnected: jest.fn().mockReturnValue(true),
  getUserConnections: jest.fn().mockReturnValue(['conn1', 'conn2']),
  sendToConnection: jest.fn(),
  queueEventForReconnection: jest.fn(),
  flushQueuedEvents: jest.fn()
}

const mockNetworkFilterService = {
  createFilter: jest.fn().mockResolvedValue({ id: 'nf-123', name: 'test-filter' }),
  updateFilter: jest.fn().mockResolvedValue(true),
  deleteFilter: jest.fn().mockResolvedValue(true),
  getFilter: jest.fn().mockResolvedValue({ id: 'nf-123', rules: [] }),
  listFilters: jest.fn().mockResolvedValue([])
}

const mockFirewallSimplifierService = {
  optimizeRules: jest.fn().mockResolvedValue({
    optimizedRules: [],
    originalCount: 0,
    optimizedCount: 0,
    savedRules: 0
  }),
  analyzeRules: jest.fn().mockResolvedValue({
    duplicates: [],
    conflicts: [],
    suggestions: []
  })
}

jest.mock('@services/SocketService', () => ({
  getSocketService: () => mockSocketService
}))

jest.mock('@services/NetworkFilterService', () => ({
  NetworkFilterService: jest.fn().mockImplementation(() => mockNetworkFilterService)
}))

jest.mock('@services/FirewallSimplifierService', () => ({
  FirewallSimplifierService: jest.fn().mockImplementation(() => mockFirewallSimplifierService)
}))

jest.mock('libvirt-node')

describe('End-to-End Firewall Integration', () => {
  let schema: any
  let prisma: PrismaClient

  beforeAll(async () => {
    // Create comprehensive schema with all firewall resolvers
    schema = await buildSchema({
      resolvers: [
        AdvancedFirewallResolver,
        SimplifiedFirewallResolver,
        DepartmentFirewallResolver
      ],
      container: Container
    })

    // Create test database instance
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

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Complete Firewall Workflow Integration', () => {
    it('should handle complete department firewall setup and VM provisioning workflow', async () => {
      await withTransaction(prisma, async ({ adminContext }) => {
        // Phase 1: Department Creation and Policy Setup
        const department = await prisma.department.create({
          data: {
            name: 'Development Team',
            description: 'Software Development Department'
          }
        })

        // Create department firewall policy
        const DEPARTMENT_POLICY_MUTATION = `
          mutation CreateDepartmentPolicy($input: CreateDepartmentFirewallPolicyInput!) {
            createDepartmentFirewallPolicy(input: $input) {
              id
              name
              rules { port protocol direction action priority }
              isActive
            }
          }
        `

        const policyInput = {
          departmentId: department.id,
          name: 'Development Standard Policy',
          description: 'Standard firewall rules for development environment',
          rules: [
            {
              port: '22',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept',
              priority: 100,
              description: 'SSH access'
            },
            {
              port: '80',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept',
              priority: 200,
              description: 'HTTP traffic'
            },
            {
              port: '443',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept',
              priority: 200,
              description: 'HTTPS traffic'
            }
          ]
        }

        const policyResult = await graphql({
          schema,
          source: DEPARTMENT_POLICY_MUTATION,
          contextValue: adminContext,
          variableValues: { input: policyInput }
        })

        expect(policyResult.errors).toBeUndefined()
        expect(policyResult.data?.createDepartmentFirewallPolicy).toBeDefined()

        // Phase 2: User Creation and VM Provisioning
        const users = await Promise.all([
          prisma.user.create({
            data: {
              username: 'dev-user1',
              email: 'dev1@company.com',
              passwordHash: 'hash1',
              role: 'USER',
              departmentId: department.id
            }
          }),
          prisma.user.create({
            data: {
              username: 'dev-user2',
              email: 'dev2@company.com',
              passwordHash: 'hash2',
              role: 'USER',
              departmentId: department.id
            }
          })
        ])

        const machines = await Promise.all([
          prisma.machine.create({
            data: {
              uuid: 'dev-vm1-uuid',
              name: 'dev-workstation-1',
              status: 'running',
              memory: 4096,
              vcpus: 4,
              userId: users[0].id,
              departmentId: department.id
            }
          }),
          prisma.machine.create({
            data: {
              uuid: 'dev-vm2-uuid',
              name: 'dev-server-1',
              status: 'running',
              memory: 8192,
              vcpus: 8,
              userId: users[1].id,
              departmentId: department.id
            }
          })
        ])

        // Phase 3: Machine-Specific Firewall Configuration
        const MACHINE_RULE_MUTATION = `
          mutation CreateMachineRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port protocol direction action }
              effectiveRules { port protocol direction action priority }
              inheritedRules { port protocol direction action source }
              networkFilterApplied
            }
          }
        `

        // User 1 adds development-specific rules
        const user1Rules = [
          {
            machineId: machines[0].id,
            ports: { type: 'SINGLE', value: '3000' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept',
            description: 'Development server'
          },
          {
            machineId: machines[0].id,
            ports: { type: 'RANGE', value: '8000-8010' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept',
            description: 'Development tools'
          }
        ]

        // User 2 adds server-specific rules
        const user2Rules = [
          {
            machineId: machines[1].id,
            ports: { type: 'SINGLE', value: '5432' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept',
            description: 'PostgreSQL database'
          },
          {
            machineId: machines[1].id,
            ports: { type: 'SINGLE', value: '6379' },
            protocol: 'tcp',
            direction: 'in',
            action: 'accept',
            description: 'Redis cache'
          }
        ]

        // Apply rules for user 1
        for (const rule of user1Rules) {
          const result = await graphql({
            schema,
            source: MACHINE_RULE_MUTATION,
            contextValue: { prisma, user: users[0] },
            variableValues: { input: rule }
          })
          expect(result.errors).toBeUndefined()
        }

        // Apply rules for user 2
        for (const rule of user2Rules) {
          const result = await graphql({
            schema,
            source: MACHINE_RULE_MUTATION,
            contextValue: { prisma, user: users[1] },
            variableValues: { input: rule }
          })
          expect(result.errors).toBeUndefined()
        }

        // Phase 4: Verification of Complete State
        const FIREWALL_STATE_QUERY = `
          query GetFirewallState($machineId: ID!) {
            getAdvancedFirewallRules(machineId: $machineId) {
              customRules { port protocol direction action }
              effectiveRules { port protocol direction action priority source }
              inheritedRules { port protocol direction action source }
              lastSync
            }
          }
        `

        // Verify machine 1 firewall state
        const machine1State = await graphql({
          schema,
          source: FIREWALL_STATE_QUERY,
          contextValue: { prisma, user: users[0] },
          variableValues: { machineId: machines[0].id }
        })

        expect(machine1State.errors).toBeUndefined()
        const machine1Rules = machine1State.data?.getAdvancedFirewallRules

        // Should have department rules + custom rules
        expect(machine1Rules.effectiveRules).toEqual(
          expect.arrayContaining([
            // Department inherited rules
            expect.objectContaining({ port: '22', source: 'department' }),
            expect.objectContaining({ port: '80', source: 'department' }),
            expect.objectContaining({ port: '443', source: 'department' }),
            // Custom machine rules
            expect.objectContaining({ port: '3000', source: 'custom' }),
            expect.objectContaining({ port: '8000-8010', source: 'custom' })
          ])
        )

        // Verify machine 2 firewall state
        const machine2State = await graphql({
          schema,
          source: FIREWALL_STATE_QUERY,
          contextValue: { prisma, user: users[1] },
          variableValues: { machineId: machines[1].id }
        })

        expect(machine2State.errors).toBeUndefined()
        const machine2Rules = machine2State.data?.getAdvancedFirewallRules

        expect(machine2Rules.effectiveRules).toEqual(
          expect.arrayContaining([
            // Department inherited rules
            expect.objectContaining({ port: '22', source: 'department' }),
            expect.objectContaining({ port: '80', source: 'department' }),
            expect.objectContaining({ port: '443', source: 'department' }),
            // Custom machine rules
            expect.objectContaining({ port: '5432', source: 'custom' }),
            expect.objectContaining({ port: '6379', source: 'custom' })
          ])
        )

        // Phase 5: Network Filter Integration Verification
        // Verify network filters were created for each machine
        expect(mockNetworkFilterService.createFilter).toHaveBeenCalledWith(
          expect.objectContaining({
            machineId: machines[0].id
          })
        )
        expect(mockNetworkFilterService.createFilter).toHaveBeenCalledWith(
          expect.objectContaining({
            machineId: machines[1].id
          })
        )
        expect(mockNetworkFilterService.updateFilter).toHaveBeenCalled()

        // Phase 6: WebSocket Event Verification
        // Should have received events for:
        // - Department policy creation (1)
        // - Machine rule creation (4 total)
        expect(mockSocketService.sendToUser).toHaveBeenCalled()
        expect(mockSocketService.sendToDepartment).toHaveBeenCalledWith(
          department.id,
          'vm',
          'firewall:department:policy:created',
          expect.any(Object)
        )
      })
    })

    it('should handle cross-department firewall rule conflicts and resolution', async () => {
      await withTransaction(prisma, async ({ adminContext }) => {
        // Create two departments with conflicting policies
        const dept1 = await prisma.department.create({
          data: { name: 'Security Team', description: 'Security Operations' }
        })

        const dept2 = await prisma.department.create({
          data: { name: 'Development Team', description: 'Software Development' }
        })

        // Create restrictive security policy
        const SECURITY_POLICY_MUTATION = `
          mutation CreateSecurityPolicy($input: CreateDepartmentFirewallPolicyInput!) {
            createDepartmentFirewallPolicy(input: $input) {
              id
              rules { port action priority }
            }
          }
        `

        const securityPolicy = {
          departmentId: dept1.id,
          name: 'High Security Policy',
          rules: [
            {
              port: '22',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept',
              priority: 50, // Higher priority
              description: 'SSH only'
            },
            {
              port: '80',
              protocol: 'tcp',
              direction: 'in',
              action: 'reject',
              priority: 100, // Block HTTP
              description: 'No HTTP allowed'
            }
          ]
        }

        // Create permissive development policy
        const devPolicy = {
          departmentId: dept2.id,
          name: 'Development Policy',
          rules: [
            {
              port: '80',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept',
              priority: 200, // Lower priority
              description: 'HTTP for development'
            },
            {
              port: '3000',
              protocol: 'tcp',
              direction: 'in',
              action: 'accept',
              priority: 200,
              description: 'Development server'
            }
          ]
        }

        await graphql({
          schema,
          source: SECURITY_POLICY_MUTATION,
          contextValue: adminContext,
          variableValues: { input: securityPolicy }
        })

        await graphql({
          schema,
          source: SECURITY_POLICY_MUTATION,
          contextValue: adminContext,
          variableValues: { input: devPolicy }
        })

        // Create user with machine that needs to follow security policy
        const secUser = await prisma.user.create({
          data: {
            username: 'sec-user',
            email: 'sec@company.com',
            passwordHash: 'hash',
            role: 'USER',
            departmentId: dept1.id
          }
        })

        const secMachine = await prisma.machine.create({
          data: {
            uuid: 'sec-vm-uuid',
            name: 'security-server',
            status: 'running',
            memory: 2048,
            vcpus: 2,
            userId: secUser.id,
            departmentId: dept1.id
          }
        })

        // Try to add conflicting rule (should be overridden by department policy)
        const CONFLICTING_RULE_MUTATION = `
          mutation CreateConflictingRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port action }
              effectiveRules { port action priority source }
              conflicts { conflictType description resolution }
            }
          }
        `

        const conflictingRule = {
          machineId: secMachine.id,
          ports: { type: 'SINGLE', value: '80' },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept', // Conflicts with department reject
          description: 'Try to allow HTTP'
        }

        const result = await graphql({
          schema,
          source: CONFLICTING_RULE_MUTATION,
          contextValue: { prisma, user: secUser },
          variableValues: { input: conflictingRule }
        })

        expect(result.errors).toBeUndefined()

        // Verify conflict detection and resolution
        const effectiveRules = result.data?.createAdvancedFirewallRule.effectiveRules
        const httpRule = effectiveRules.find((rule: any) => rule.port === '80')

        // Department policy should win (higher priority = lower number)
        expect(httpRule.action).toBe('reject')
        expect(httpRule.source).toBe('department')

        // Conflict should be reported
        const conflicts = result.data?.createAdvancedFirewallRule.conflicts
        expect(conflicts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              conflictType: 'department_override',
              description: expect.stringContaining('department policy takes precedence')
            })
          ])
        )
      })
    })

    it('should handle complete firewall rule optimization and simplification workflow', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Create multiple overlapping and redundant rules
        const CREATE_RULE_MUTATION = `
          mutation CreateRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port protocol }
            }
          }
        `

        const redundantRules = [
          // Overlapping port ranges
          { ports: { type: 'SINGLE', value: '80' }, protocol: 'tcp', action: 'accept' },
          { ports: { type: 'SINGLE', value: '81' }, protocol: 'tcp', action: 'accept' },
          { ports: { type: 'SINGLE', value: '82' }, protocol: 'tcp', action: 'accept' },
          { ports: { type: 'SINGLE', value: '83' }, protocol: 'tcp', action: 'accept' },

          // Duplicate rules
          { ports: { type: 'SINGLE', value: '443' }, protocol: 'tcp', action: 'accept' },
          { ports: { type: 'SINGLE', value: '443' }, protocol: 'tcp', action: 'accept' },

          // Conflicting rules (different actions for same port)
          { ports: { type: 'SINGLE', value: '22' }, protocol: 'tcp', action: 'accept' },
          { ports: { type: 'SINGLE', value: '22' }, protocol: 'tcp', action: 'reject' },

          // Rules that can be merged into ranges
          { ports: { type: 'SINGLE', value: '8000' }, protocol: 'tcp', action: 'accept' },
          { ports: { type: 'SINGLE', value: '8001' }, protocol: 'tcp', action: 'accept' },
          { ports: { type: 'SINGLE', value: '8002' }, protocol: 'tcp', action: 'accept' }
        ]

        // Create all redundant rules
        for (const rule of redundantRules) {
          const input = {
            machineId: testMachine.id,
            direction: 'in',
            ...rule
          }

          await graphql({
            schema,
            source: CREATE_RULE_MUTATION,
            contextValue: context,
            variableValues: { input }
          })
        }

        // Analyze rules before optimization
        const ANALYZE_MUTATION = `
          mutation AnalyzeRules($machineId: ID!) {
            analyzeFirewallRules(machineId: $machineId) {
              totalRules
              duplicates { count rules }
              conflicts { count rules }
              optimizationSuggestions {
                type
                description
                potentialSavings
              }
            }
          }
        `

        const analysisResult = await graphql({
          schema,
          source: ANALYZE_MUTATION,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(analysisResult.errors).toBeUndefined()
        const analysis = analysisResult.data?.analyzeFirewallRules

        expect(analysis.totalRules).toBe(11)
        expect(analysis.duplicates.count).toBeGreaterThan(0)
        expect(analysis.conflicts.count).toBeGreaterThan(0)
        expect(analysis.optimizationSuggestions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'range_consolidation',
              description: expect.stringContaining('consecutive ports')
            }),
            expect.objectContaining({
              type: 'duplicate_removal',
              description: expect.stringContaining('duplicate rules')
            })
          ])
        )

        // Perform optimization
        const OPTIMIZE_MUTATION = `
          mutation OptimizeRules($input: OptimizeFirewallRulesInput!) {
            optimizeFirewallRules(input: $input) {
              originalRuleCount
              optimizedRuleCount
              savedRules
              optimizedRules { port protocol action }
              optimizationSummary {
                duplicatesRemoved
                conflictsResolved
                rangesConsolidated
                performance {
                  processingTimeReduction
                  memoryUsageReduction
                }
              }
            }
          }
        `

        const optimizeInput = {
          machineId: testMachine.id,
          strategy: 'aggressive',
          preserveUserRules: true,
          conflictResolution: 'most_permissive'
        }

        const optimizeResult = await graphql({
          schema,
          source: OPTIMIZE_MUTATION,
          contextValue: context,
          variableValues: { input: optimizeInput }
        })

        expect(optimizeResult.errors).toBeUndefined()
        const optimization = optimizeResult.data?.optimizeFirewallRules

        // Verify optimization results
        expect(optimization.originalRuleCount).toBe(11)
        expect(optimization.optimizedRuleCount).toBeLessThan(11)
        expect(optimization.savedRules).toBeGreaterThan(0)

        // Verify specific optimizations
        const optimizedRules = optimization.optimizedRules
        expect(optimizedRules).toEqual(
          expect.arrayContaining([
            // Should have range for 80-83
            expect.objectContaining({ port: '80-83', protocol: 'tcp', action: 'accept' }),
            // Should have single rule for 443 (duplicates removed)
            expect.objectContaining({ port: '443', protocol: 'tcp', action: 'accept' }),
            // Should resolve SSH conflict with most permissive (accept)
            expect.objectContaining({ port: '22', protocol: 'tcp', action: 'accept' }),
            // Should have range for 8000-8002
            expect.objectContaining({ port: '8000-8002', protocol: 'tcp', action: 'accept' })
          ])
        )

        // Verify optimization summary
        expect(optimization.optimizationSummary.duplicatesRemoved).toBeGreaterThan(0)
        expect(optimization.optimizationSummary.conflictsResolved).toBeGreaterThan(0)
        expect(optimization.optimizationSummary.rangesConsolidated).toBeGreaterThan(0)

        // Verify WebSocket events for optimization
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:rules:optimized',
          expect.objectContaining({
            data: expect.objectContaining({
              machineId: testMachine.id,
              optimizationSummary: optimization.optimizationSummary
            })
          })
        )

        // Verify network filter was updated with optimized rules
        expect(mockNetworkFilterService.updateFilter).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            rules: optimization.optimizedRules
          })
        )
      })
    })

    it('should handle firewall backup, restore, and disaster recovery workflow', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, adminContext, context }) => {
        // Phase 1: Create complex firewall configuration
        const setupRules = [
          { ports: { type: 'SINGLE', value: '22' }, protocol: 'tcp', action: 'accept', description: 'SSH' },
          { ports: { type: 'SINGLE', value: '80' }, protocol: 'tcp', action: 'accept', description: 'HTTP' },
          { ports: { type: 'SINGLE', value: '443' }, protocol: 'tcp', action: 'accept', description: 'HTTPS' },
          { ports: { type: 'RANGE', value: '8000-8010' }, protocol: 'tcp', action: 'accept', description: 'Dev tools' }
        ]

        const CREATE_RULE_MUTATION = `
          mutation CreateRule($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port protocol action description }
            }
          }
        `

        for (const rule of setupRules) {
          await graphql({
            schema,
            source: CREATE_RULE_MUTATION,
            contextValue: context,
            variableValues: {
              input: { machineId: testMachine.id, direction: 'in', ...rule }
            }
          })
        }

        // Phase 2: Create firewall backup
        const BACKUP_MUTATION = `
          mutation BackupFirewall($input: BackupFirewallConfigInput!) {
            backupFirewallConfig(input: $input) {
              backupId
              timestamp
              machineId
              ruleCount
              configHash
              backupSize
            }
          }
        `

        const backupInput = {
          machineId: testMachine.id,
          includeDepartmentRules: true,
          includeNetworkFilters: true,
          backupName: 'Pre-migration backup'
        }

        const backupResult = await graphql({
          schema,
          source: BACKUP_MUTATION,
          contextValue: context,
          variableValues: { input: backupInput }
        })

        expect(backupResult.errors).toBeUndefined()
        const backup = backupResult.data?.backupFirewallConfig

        expect(backup).toEqual(
          expect.objectContaining({
            backupId: expect.any(String),
            timestamp: expect.any(String),
            machineId: testMachine.id,
            ruleCount: 4,
            configHash: expect.any(String)
          })
        )

        // Phase 3: Simulate disaster - corrupt/delete all rules
        const DELETE_ALL_MUTATION = `
          mutation DeleteAllRules($machineId: ID!) {
            deleteAllFirewallRules(machineId: $machineId) {
              success
              deletedCount
            }
          }
        `

        const deleteResult = await graphql({
          schema,
          source: DELETE_ALL_MUTATION,
          contextValue: adminContext,
          variableValues: { machineId: testMachine.id }
        })

        expect(deleteResult.errors).toBeUndefined()
        expect(deleteResult.data?.deleteAllFirewallRules.deletedCount).toBe(4)

        // Verify rules are gone
        const VERIFY_EMPTY_QUERY = `
          query VerifyEmpty($machineId: ID!) {
            getAdvancedFirewallRules(machineId: $machineId) {
              customRules { port }
              effectiveRules { port }
            }
          }
        `

        const emptyResult = await graphql({
          schema,
          source: VERIFY_EMPTY_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        expect(emptyResult.data?.getAdvancedFirewallRules.customRules).toHaveLength(0)

        // Phase 4: Restore from backup
        const RESTORE_MUTATION = `
          mutation RestoreFirewall($input: RestoreFirewallConfigInput!) {
            restoreFirewallConfig(input: $input) {
              success
              restoredRuleCount
              skippedRules
              conflicts { rule reason }
              restoredRules { port protocol action description }
              networkFiltersRestored
            }
          }
        `

        const restoreInput = {
          backupId: backup.backupId,
          machineId: testMachine.id,
          restoreStrategy: 'replace_all',
          validateBeforeRestore: true
        }

        const restoreResult = await graphql({
          schema,
          source: RESTORE_MUTATION,
          contextValue: adminContext,
          variableValues: { input: restoreInput }
        })

        expect(restoreResult.errors).toBeUndefined()
        const restore = restoreResult.data?.restoreFirewallConfig

        expect(restore).toEqual(
          expect.objectContaining({
            success: true,
            restoredRuleCount: 4,
            skippedRules: 0,
            networkFiltersRestored: true
          })
        )

        // Phase 5: Verify complete restoration
        const verifyResult = await graphql({
          schema,
          source: VERIFY_EMPTY_QUERY,
          contextValue: context,
          variableValues: { machineId: testMachine.id }
        })

        const restoredRules = verifyResult.data?.getAdvancedFirewallRules.customRules
        expect(restoredRules).toHaveLength(4)
        expect(restoredRules).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ port: '22', protocol: 'tcp', action: 'accept' }),
            expect.objectContaining({ port: '80', protocol: 'tcp', action: 'accept' }),
            expect.objectContaining({ port: '443', protocol: 'tcp', action: 'accept' }),
            expect.objectContaining({ port: '8000-8010', protocol: 'tcp', action: 'accept' })
          ])
        )

        // Phase 6: Verify WebSocket events for backup/restore
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:backup:created',
          expect.objectContaining({
            data: expect.objectContaining({
              backupId: backup.backupId,
              machineId: testMachine.id
            })
          })
        )

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          testUser.id,
          'vm',
          'firewall:config:restored',
          expect.objectContaining({
            data: expect.objectContaining({
              machineId: testMachine.id,
              restoredRuleCount: 4
            })
          })
        )

        // Phase 7: Verify network filter restoration
        expect(mockNetworkFilterService.createFilter).toHaveBeenCalledWith(
          expect.objectContaining({
            machineId: testMachine.id,
            rules: expect.arrayContaining([
              expect.objectContaining({ port: '22' }),
              expect.objectContaining({ port: '80' }),
              expect.objectContaining({ port: '443' }),
              expect.objectContaining({ port: '8000-8010' })
            ])
          })
        )
      })
    })
  })

  describe('Multi-Service Integration Error Handling', () => {
    it('should handle cascading failures across all firewall services', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Mock service failures
        mockNetworkFilterService.createFilter.mockRejectedValueOnce(
          new Error('Network filter service unavailable')
        )
        mockSocketService.sendToUser.mockImplementationOnce(() => {
          throw new Error('WebSocket service connection lost')
        })
        mockFirewallSimplifierService.optimizeRules.mockRejectedValueOnce(
          new Error('Optimization service overloaded')
        )

        const input = {
          machineId: testMachine.id,
          ports: { type: 'SINGLE', value: '80' },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          enableOptimization: true,
          updateNetworkFilter: true
        }

        const CREATE_WITH_ALL_SERVICES = `
          mutation CreateWithAllServices($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
              networkFilterApplied
              optimizationApplied
              errors { service error recoveryAction }
            }
          }
        `

        const result = await graphql({
          schema,
          source: CREATE_WITH_ALL_SERVICES,
          contextValue: context,
          variableValues: { input }
        })

        // Main operation should still succeed
        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule.customRules).toHaveLength(1)

        // But services should report their failures
        const serviceResult = result.data?.createAdvancedFirewallRule
        expect(serviceResult.networkFilterApplied).toBe(false)
        expect(serviceResult.optimizationApplied).toBe(false)
        expect(serviceResult.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              service: 'NetworkFilterService',
              error: 'Network filter service unavailable',
              recoveryAction: 'retry_later'
            }),
            expect.objectContaining({
              service: 'WebSocketService',
              error: 'WebSocket service connection lost',
              recoveryAction: 'event_queued'
            }),
            expect.objectContaining({
              service: 'FirewallSimplifierService',
              error: 'Optimization service overloaded',
              recoveryAction: 'manual_optimization_available'
            })
          ])
        )
      })
    })

    it('should handle partial service recovery and retry mechanisms', async () => {
      await withTransaction(prisma, async ({ testUser, testMachine, context }) => {
        // Mock intermittent failures that recover
        let networkFilterCallCount = 0
        mockNetworkFilterService.createFilter.mockImplementation(() => {
          networkFilterCallCount++
          if (networkFilterCallCount === 1) {
            throw new Error('Temporary network failure')
          }
          return Promise.resolve({ id: 'nf-recovered', name: 'test-filter' })
        })

        let socketCallCount = 0
        mockSocketService.sendToUser.mockImplementation((...args) => {
          socketCallCount++
          if (socketCallCount === 1) {
            throw new Error('Socket temporarily unavailable')
          }
          // Second call succeeds
        })

        const input = {
          machineId: testMachine.id,
          ports: { type: 'SINGLE', value: '443' },
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          updateNetworkFilter: true,
          retryFailedServices: true
        }

        const CREATE_WITH_RETRY = `
          mutation CreateWithRetry($input: CreateAdvancedFirewallRuleInput!) {
            createAdvancedFirewallRule(input: $input) {
              customRules { port }
              networkFilterApplied
              serviceRetries {
                service
                attempts
                success
                finalError
              }
            }
          }
        `

        const result = await graphql({
          schema,
          source: CREATE_WITH_RETRY,
          contextValue: context,
          variableValues: { input }
        })

        expect(result.errors).toBeUndefined()
        expect(result.data?.createAdvancedFirewallRule.customRules).toHaveLength(1)
        expect(result.data?.createAdvancedFirewallRule.networkFilterApplied).toBe(true)

        // Verify retry mechanism worked
        expect(result.data?.createAdvancedFirewallRule.serviceRetries).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              service: 'NetworkFilterService',
              attempts: 2,
              success: true,
              finalError: null
            }),
            expect.objectContaining({
              service: 'WebSocketService',
              attempts: 2,
              success: true,
              finalError: null
            })
          ])
        )

        // Verify actual retry calls occurred
        expect(networkFilterCallCount).toBe(2)
        expect(socketCallCount).toBe(2)
      })
    })
  })

})