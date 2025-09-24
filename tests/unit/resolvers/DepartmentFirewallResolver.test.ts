import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { DepartmentFirewallResolver } from '@resolvers/DepartmentFirewallResolver'
import { mockPrisma } from '../../setup/jest.setup'
import { createAdminContext, createUserContext, createUnauthenticatedContext, executeGraphQL } from '../../setup/test-helpers'
import { UserInputError } from 'apollo-server-core'
import { DepartmentFirewallService } from '@services/departmentFirewallService'
import { getSocketService } from '@services/SocketService'
import {
  createMockNWFilter,
  createMockFWRule,
  generateId
} from '../../setup/mock-factories'
import { buildSchema } from 'type-graphql'
import { authChecker } from '@utils/authChecker'

// Mock DepartmentFirewallService
jest.mock('@services/departmentFirewallService')
// Mock SocketService
jest.mock('@services/SocketService')

describe('DepartmentFirewallResolver', () => {
  let resolver: DepartmentFirewallResolver
  let mockDepartmentFirewallService: jest.Mocked<DepartmentFirewallService>
  let mockSocketService: jest.Mocked<any>
  const adminCtx = createAdminContext()
  const userCtx = createUserContext()
  const unauthCtx = createUnauthenticatedContext()

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock DepartmentFirewallService methods
    mockDepartmentFirewallService = {
      getDepartmentFirewallState: jest.fn(),
      getEffectiveRules: jest.fn(),
      getAppliedTemplates: jest.fn(),
      applyTemplateToDepart: jest.fn(),
      removeTemplateFromDepartment: jest.fn(),
      addDepartmentRule: jest.fn(),
      removeDepartmentRule: jest.fn(),
      flushDepartmentToAllVMs: jest.fn(),
      refreshAllVMFilters: jest.fn(),
      validateRulePriority: jest.fn()
    } as unknown as jest.Mocked<DepartmentFirewallService>

    // Mock SocketService
    mockSocketService = {
      sendToAdmins: jest.fn()
    }
    ;(getSocketService as jest.Mock).mockReturnValue(mockSocketService)

    // Mock the DepartmentFirewallService constructor
    ;(DepartmentFirewallService as jest.Mock).mockImplementation(() => mockDepartmentFirewallService)

    resolver = new DepartmentFirewallResolver()
  })

  describe('Query: getDepartmentFirewallState', () => {
    it('should return department firewall state for admin', async () => {
      const departmentId = generateId()
      const mockState = {
        departmentId,
        appliedTemplates: ['template-1', 'template-2'],
        customRules: [createMockFWRule()],
        effectiveRules: [createMockFWRule(), createMockFWRule()],
        vmCount: 5,
        lastSync: new Date()
      }

      mockDepartmentFirewallService.getDepartmentFirewallState.mockResolvedValue(mockState)

      const result = await resolver.getDepartmentFirewallState(departmentId, adminCtx)

      expect(mockDepartmentFirewallService.getDepartmentFirewallState).toHaveBeenCalledWith(departmentId)
      expect(result).toEqual(mockState)
      expect(result.vmCount).toBe(5)
      expect(result.appliedTemplates).toHaveLength(2)
    })

    it('should handle service errors', async () => {
      const departmentId = generateId()
      mockDepartmentFirewallService.getDepartmentFirewallState.mockRejectedValue(
        new Error('Department not found')
      )

      await expect(
        resolver.getDepartmentFirewallState(departmentId, adminCtx)
      ).rejects.toThrow('Department not found')
    })
  })

  describe('Query: getDepartmentFirewallRules', () => {
    it('should return effective rules for department', async () => {
      const departmentId = generateId()
      const mockRules = [
        createMockFWRule({ action: 'accept', priority: 100 }),
        createMockFWRule({ action: 'drop', priority: 200 })
      ]

      mockDepartmentFirewallService.getEffectiveRules.mockResolvedValue(mockRules)

      const result = await resolver.getDepartmentFirewallRules(departmentId, adminCtx)

      expect(mockDepartmentFirewallService.getEffectiveRules).toHaveBeenCalledWith(departmentId)
      expect(result).toEqual(mockRules)
      expect(result).toHaveLength(2)
    })

    it('should return empty array when no rules exist', async () => {
      const departmentId = generateId()
      mockDepartmentFirewallService.getEffectiveRules.mockResolvedValue([])

      const result = await resolver.getDepartmentFirewallRules(departmentId, adminCtx)

      expect(result).toEqual([])
    })
  })

  describe('Query: getAvailableTemplatesForDepartment', () => {
    it('should return available templates with correct mapping', async () => {
      const departmentId = generateId()
      const mockTemplates = [
        createMockNWFilter({
          name: 'web-template',
          description: 'Web server template',
          type: 'generic'
        }),
        createMockNWFilter({
          name: 'ssh-template',
          description: 'SSH access template',
          type: 'generic'
        })
      ]

      mockPrisma.nWFilter.findMany.mockResolvedValue(
        mockTemplates.map(t => ({
          ...t,
          rules: [createMockFWRule()],
          references: [{ targetFilterId: 'ref-1' }]
        }))
      )

      const result = await resolver.getAvailableTemplatesForDepartment(departmentId, adminCtx)

      // Verify query includes generic type filter
      expect(mockPrisma.nWFilter.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'generic'
          }),
          include: expect.objectContaining({
            rules: true,
            references: true
          })
        })
      )

      // Verify result structure and mapping
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: mockTemplates[0].id,
          name: 'web-template',
          description: 'Web server template',
          type: 'generic',
          rules: expect.any(Array),
          references: ['ref-1'],
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date)
        })
      )
      expect(result[1].name).toBe('ssh-template')
    })

    it('should return empty array when no templates found', async () => {
      const departmentId = generateId()
      mockPrisma.nWFilter.findMany.mockResolvedValue([])

      const result = await resolver.getAvailableTemplatesForDepartment(departmentId, adminCtx)

      expect(result).toEqual([])
    })
  })

  describe('Mutation: applyDepartmentFirewallTemplate', () => {
    it('should apply template successfully and send WebSocket event', async () => {
      const input = {
        departmentId: generateId(),
        templateFilterId: generateId()
      }

      mockDepartmentFirewallService.applyTemplateToDepart.mockResolvedValue(true)

      const result = await resolver.applyDepartmentFirewallTemplate(input, adminCtx)

      expect(mockDepartmentFirewallService.applyTemplateToDepart).toHaveBeenCalledWith(
        input.departmentId,
        input.templateFilterId
      )
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'templateApplied',
        {
          data: {
            departmentId: input.departmentId,
            templateFilterId: input.templateFilterId
          }
        }
      )
      expect(result).toBe(true)
    })

    it('should not send WebSocket event when operation fails', async () => {
      const input = {
        departmentId: generateId(),
        templateFilterId: generateId()
      }

      mockDepartmentFirewallService.applyTemplateToDepart.mockResolvedValue(false)

      const result = await resolver.applyDepartmentFirewallTemplate(input, adminCtx)

      expect(mockSocketService.sendToAdmins).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('should handle service errors', async () => {
      const input = {
        departmentId: generateId(),
        templateFilterId: generateId()
      }

      mockDepartmentFirewallService.applyTemplateToDepart.mockRejectedValue(
        new Error('Template already applied')
      )

      await expect(
        resolver.applyDepartmentFirewallTemplate(input, adminCtx)
      ).rejects.toThrow('Template already applied')
    })
  })

  describe('Mutation: removeDepartmentFirewallTemplate', () => {
    it('should remove template successfully and send WebSocket event', async () => {
      const departmentId = generateId()
      const templateFilterId = generateId()

      mockDepartmentFirewallService.removeTemplateFromDepartment.mockResolvedValue(true)

      const result = await resolver.removeDepartmentFirewallTemplate(
        departmentId,
        templateFilterId,
        adminCtx
      )

      expect(mockDepartmentFirewallService.removeTemplateFromDepartment).toHaveBeenCalledWith(
        departmentId,
        templateFilterId
      )
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'templateRemoved',
        {
          data: {
            departmentId,
            templateFilterId
          }
        }
      )
      expect(result).toBe(true)
    })

    it('should not send WebSocket event when operation fails', async () => {
      const departmentId = generateId()
      const templateFilterId = generateId()

      mockDepartmentFirewallService.removeTemplateFromDepartment.mockResolvedValue(false)

      const result = await resolver.removeDepartmentFirewallTemplate(
        departmentId,
        templateFilterId,
        adminCtx
      )

      expect(mockSocketService.sendToAdmins).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })
  })

  describe('Mutation: toggleDepartmentFirewallTemplate', () => {
    it('should apply template when not currently applied', async () => {
      const departmentId = generateId()
      const templateFilterId = generateId()

      mockDepartmentFirewallService.getAppliedTemplates.mockResolvedValue([])
      mockDepartmentFirewallService.applyTemplateToDepart.mockResolvedValue(true)

      const result = await resolver.toggleDepartmentFirewallTemplate(
        departmentId,
        templateFilterId,
        adminCtx
      )

      expect(mockDepartmentFirewallService.getAppliedTemplates).toHaveBeenCalledWith(departmentId)
      expect(mockDepartmentFirewallService.applyTemplateToDepart).toHaveBeenCalledWith(
        departmentId,
        templateFilterId
      )
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'templateApplied',
        {
          data: {
            departmentId,
            templateFilterId
          }
        }
      )
      expect(result).toBe(true)
    })

    it('should remove template when currently applied', async () => {
      const departmentId = generateId()
      const templateFilterId = generateId()
      const appliedTemplate = createMockNWFilter({ id: templateFilterId })

      mockDepartmentFirewallService.getAppliedTemplates.mockResolvedValue([appliedTemplate])
      mockDepartmentFirewallService.removeTemplateFromDepartment.mockResolvedValue(true)

      const result = await resolver.toggleDepartmentFirewallTemplate(
        departmentId,
        templateFilterId,
        adminCtx
      )

      expect(mockDepartmentFirewallService.removeTemplateFromDepartment).toHaveBeenCalledWith(
        departmentId,
        templateFilterId
      )
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'templateRemoved',
        {
          data: {
            departmentId,
            templateFilterId
          }
        }
      )
      expect(result).toBe(true)
    })

    it('should not send WebSocket event when toggle operation fails', async () => {
      const departmentId = generateId()
      const templateFilterId = generateId()

      mockDepartmentFirewallService.getAppliedTemplates.mockResolvedValue([])
      mockDepartmentFirewallService.applyTemplateToDepart.mockResolvedValue(false)

      const result = await resolver.toggleDepartmentFirewallTemplate(
        departmentId,
        templateFilterId,
        adminCtx
      )

      expect(mockSocketService.sendToAdmins).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('should handle getAppliedTemplates error in toggle operation', async () => {
      const departmentId = generateId()
      const templateFilterId = generateId()

      mockDepartmentFirewallService.getAppliedTemplates.mockRejectedValue(
        new Error('Fetch failed')
      )

      await expect(
        resolver.toggleDepartmentFirewallTemplate(
          departmentId,
          templateFilterId,
          adminCtx
        )
      ).rejects.toThrow('Fetch failed')
    })
  })

  describe('Mutation: createDepartmentFirewallRule', () => {
    it('should create rule successfully and send WebSocket event', async () => {
      const departmentId = generateId()
      const input = {
        filterId: generateId(), // Required field
        action: 'accept',
        direction: 'in',
        priority: 500,
        protocol: 'tcp',
        dstPortStart: 80,
        dstPortEnd: 80,
        comment: 'Allow HTTP'
      }

      const mockCreatedRule = createMockFWRule({
        action: input.action,
        direction: input.direction,
        priority: input.priority,
        protocol: input.protocol,
        id: generateId(),
        nwFilterId: generateId()
      })

      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(true)
      mockDepartmentFirewallService.addDepartmentRule.mockResolvedValue(mockCreatedRule)

      const result = await resolver.createDepartmentFirewallRule(departmentId, input, adminCtx)

      expect(mockDepartmentFirewallService.validateRulePriority).toHaveBeenCalledWith({
        priority: input.priority
      })
      expect(mockDepartmentFirewallService.addDepartmentRule).toHaveBeenCalledWith(
        departmentId,
        {
          action: input.action,
          direction: input.direction,
          priority: input.priority,
          protocol: input.protocol,
          srcPortStart: undefined,
          srcPortEnd: undefined,
          dstPortStart: input.dstPortStart,
          dstPortEnd: input.dstPortEnd,
          comment: input.comment,
          ipVersion: undefined,
          state: undefined
        }
      )
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'ruleCreated',
        {
          data: {
            departmentId,
            ruleId: mockCreatedRule.id
          }
        }
      )
      expect(result).toEqual(mockCreatedRule)
    })

    it('should throw error for invalid priority', async () => {
      const departmentId = generateId()
      const input = {
        filterId: generateId(),
        action: 'accept',
        direction: 'in',
        priority: 50, // Invalid priority
        protocol: 'tcp'
      }

      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(false)

      await expect(
        resolver.createDepartmentFirewallRule(departmentId, input, adminCtx)
      ).rejects.toThrow(UserInputError)
      expect(mockDepartmentFirewallService.addDepartmentRule).not.toHaveBeenCalled()
    })

    it('should handle JSON state parsing', async () => {
      const departmentId = generateId()
      const input = {
        filterId: generateId(),
        action: 'accept',
        direction: 'in',
        priority: 500,
        protocol: 'tcp',
        state: '{"NEW": true, "ESTABLISHED": true}'
      }

      const mockCreatedRule = createMockFWRule({ id: generateId() })

      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(true)
      mockDepartmentFirewallService.addDepartmentRule.mockResolvedValue(mockCreatedRule)

      await resolver.createDepartmentFirewallRule(departmentId, input, adminCtx)

      expect(mockDepartmentFirewallService.addDepartmentRule).toHaveBeenCalledWith(
        departmentId,
        expect.objectContaining({
          state: { NEW: true, ESTABLISHED: true }
        })
      )
    })
  })

  describe('Mutation: updateDepartmentFirewallRule', () => {
    it('should update rule successfully and send WebSocket event', async () => {
      const ruleId = generateId()
      const departmentId = generateId()
      const input = {
        action: 'drop',
        direction: 'out',
        priority: 600,
        protocol: 'udp'
      }

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [{ id: departmentId }]
        }
      } as any

      const mockUpdatedRule = { ...mockRule, ...input }

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(true)
      mockPrisma.fWRule.update.mockResolvedValue(mockUpdatedRule)

      const result = await resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)

      expect(mockPrisma.fWRule.findUnique).toHaveBeenCalledWith({
        where: { id: ruleId },
        include: {
          nwFilter: {
            include: {
              departments: true
            }
          }
        }
      })
      expect(mockDepartmentFirewallService.validateRulePriority).toHaveBeenCalledWith({
        priority: input.priority
      })
      expect(mockPrisma.fWRule.update).toHaveBeenCalledWith({
        where: { id: ruleId },
        data: {
          action: input.action,
          direction: input.direction,
          priority: input.priority,
          protocol: input.protocol,
          srcPortStart: undefined,
          srcPortEnd: undefined,
          dstPortStart: undefined,
          dstPortEnd: undefined,
          comment: undefined,
          ipVersion: undefined,
          state: undefined
        }
      })
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'ruleUpdated',
        {
          data: {
            departmentId,
            ruleId
          }
        }
      )
      expect(result).toEqual(mockUpdatedRule)
    })

    it('should throw error when rule not found', async () => {
      const ruleId = generateId()
      const input = { action: 'accept', direction: 'in', priority: 500 }

      mockPrisma.fWRule.findUnique.mockResolvedValue(null)

      await expect(
        resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error when rule is not a department rule', async () => {
      const ruleId = generateId()
      const input = { action: 'accept', direction: 'in', priority: 500 }

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'generic',
          departments: []
        }
      } as any

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)

      await expect(
        resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error for invalid priority', async () => {
      const ruleId = generateId()
      const input = { action: 'accept', direction: 'in', priority: 50 }

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [{ id: generateId() }]
        }
      } as any

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(false)

      await expect(
        resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)
      ).rejects.toThrow(UserInputError)
    })

    it('should handle JSON state parsing in updateDepartmentFirewallRule', async () => {
      const ruleId = generateId()
      const departmentId = generateId()
      const input = {
        action: 'accept',
        direction: 'in',
        priority: 500,
        state: '{"NEW": true, "RELATED": true}'
      }

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [{ id: departmentId }]
        }
      } as any

      const mockUpdatedRule = { ...mockRule, ...input }

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(true)
      mockPrisma.fWRule.update.mockResolvedValue(mockUpdatedRule)

      await resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)

      expect(mockPrisma.fWRule.update).toHaveBeenCalledWith({
        where: { id: ruleId },
        data: expect.objectContaining({
          state: { NEW: true, RELATED: true }
        })
      })
    })

    it('should handle invalid JSON in updateDepartmentFirewallRule state', async () => {
      const ruleId = generateId()
      const departmentId = generateId()
      const input = {
        action: 'accept',
        direction: 'in',
        priority: 500,
        state: 'invalid-json-string'
      }

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [{ id: departmentId }]
        }
      } as any

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(true)

      await expect(
        resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)
      ).rejects.toThrow() // Should throw JSON parse error
    })

    it('should handle rules with department type but no associated departments - update', async () => {
      const ruleId = generateId()
      const input = { action: 'accept', direction: 'in', priority: 500 }

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [] // No departments associated
        }
      } as any

      const mockUpdatedRule = { ...mockRule, ...input }

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(true)
      mockPrisma.fWRule.update.mockResolvedValue(mockUpdatedRule)

      const result = await resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)

      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'ruleUpdated',
        {
          data: {
            departmentId: undefined, // Should be undefined when no departments
            ruleId
          }
        }
      )
      expect(result).toEqual(mockUpdatedRule)
    })
  })

  describe('Mutation: deleteDepartmentFirewallRule', () => {
    it('should delete rule successfully and send WebSocket event', async () => {
      const ruleId = generateId()
      const departmentId = generateId()

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [{ id: departmentId }]
        }
      } as any

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.removeDepartmentRule.mockResolvedValue(true)

      const result = await resolver.deleteDepartmentFirewallRule(ruleId, adminCtx)

      expect(mockPrisma.fWRule.findUnique).toHaveBeenCalledWith({
        where: { id: ruleId },
        include: {
          nwFilter: {
            include: {
              departments: true
            }
          }
        }
      })
      expect(mockDepartmentFirewallService.removeDepartmentRule).toHaveBeenCalledWith(
        departmentId,
        ruleId
      )
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'ruleDeleted',
        {
          data: {
            departmentId,
            ruleId
          }
        }
      )
      expect(result).toBe(true)
    })

    it('should throw error when rule not found', async () => {
      const ruleId = generateId()

      mockPrisma.fWRule.findUnique.mockResolvedValue(null)

      await expect(
        resolver.deleteDepartmentFirewallRule(ruleId, adminCtx)
      ).rejects.toThrow(UserInputError)
    })

    it('should throw error when rule is not a department rule', async () => {
      const ruleId = generateId()

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'vm',
          departments: []
        }
      } as any

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)

      await expect(
        resolver.deleteDepartmentFirewallRule(ruleId, adminCtx)
      ).rejects.toThrow(UserInputError)
    })

    it('should not send WebSocket event when deletion fails', async () => {
      const ruleId = generateId()
      const departmentId = generateId()

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [{ id: departmentId }]
        }
      } as any

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.removeDepartmentRule.mockResolvedValue(false)

      const result = await resolver.deleteDepartmentFirewallRule(ruleId, adminCtx)

      expect(mockSocketService.sendToAdmins).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('should handle rules with department type but no associated departments - delete', async () => {
      const ruleId = generateId()

      const mockRule = {
        ...createMockFWRule({ id: ruleId }),
        nwFilter: {
          type: 'department',
          departments: [] // No departments associated
        }
      } as any

      mockPrisma.fWRule.findUnique.mockResolvedValue(mockRule)
      mockDepartmentFirewallService.removeDepartmentRule.mockResolvedValue(true)

      const result = await resolver.deleteDepartmentFirewallRule(ruleId, adminCtx)

      expect(mockDepartmentFirewallService.removeDepartmentRule).toHaveBeenCalledWith(
        undefined, // Should call with undefined departmentId
        ruleId
      )
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'ruleDeleted',
        {
          data: {
            departmentId: undefined,
            ruleId
          }
        }
      )
      expect(result).toBe(true)
    })
  })

  describe('Mutation: flushDepartmentFirewall', () => {
    it('should flush department firewall successfully and send WebSocket event', async () => {
      const departmentId = generateId()

      mockDepartmentFirewallService.flushDepartmentToAllVMs.mockResolvedValue(true)

      const result = await resolver.flushDepartmentFirewall(departmentId, adminCtx)

      expect(mockDepartmentFirewallService.flushDepartmentToAllVMs).toHaveBeenCalledWith(departmentId)
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'flushed',
        {
          data: {
            departmentId
          }
        }
      )
      expect(result).toBe(true)
    })

    it('should not send WebSocket event when flush fails', async () => {
      const departmentId = generateId()

      mockDepartmentFirewallService.flushDepartmentToAllVMs.mockResolvedValue(false)

      const result = await resolver.flushDepartmentFirewall(departmentId, adminCtx)

      expect(mockSocketService.sendToAdmins).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('should handle service errors', async () => {
      const departmentId = generateId()

      mockDepartmentFirewallService.flushDepartmentToAllVMs.mockRejectedValue(
        new Error('Flush operation failed')
      )

      await expect(
        resolver.flushDepartmentFirewall(departmentId, adminCtx)
      ).rejects.toThrow('Flush operation failed')
    })
  })

  describe('Mutation: refreshDepartmentVMFilters', () => {
    it('should refresh VM filters successfully and send WebSocket event', async () => {
      const departmentId = generateId()

      mockDepartmentFirewallService.refreshAllVMFilters.mockResolvedValue(true)

      const result = await resolver.refreshDepartmentVMFilters(departmentId, adminCtx)

      expect(mockDepartmentFirewallService.refreshAllVMFilters).toHaveBeenCalledWith(departmentId)
      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'vmFiltersRefreshed',
        {
          data: {
            departmentId
          }
        }
      )
      expect(result).toBe(true)
    })

    it('should not send WebSocket event when refresh fails', async () => {
      const departmentId = generateId()

      mockDepartmentFirewallService.refreshAllVMFilters.mockResolvedValue(false)

      const result = await resolver.refreshDepartmentVMFilters(departmentId, adminCtx)

      expect(mockSocketService.sendToAdmins).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('should handle service errors', async () => {
      const departmentId = generateId()

      mockDepartmentFirewallService.refreshAllVMFilters.mockRejectedValue(
        new Error('Refresh operation failed')
      )

      await expect(
        resolver.refreshDepartmentVMFilters(departmentId, adminCtx)
      ).rejects.toThrow('Refresh operation failed')
    })
  })

  describe('Authorization - Schema-based Tests', () => {
    const departmentId = generateId()
    let schema: any

    beforeEach(async () => {
      // Build minimal schema containing DepartmentFirewallResolver with authChecker
      schema = await buildSchema({
        resolvers: [DepartmentFirewallResolver],
        authChecker,
        validate: false
      })
    })

    describe('Query: getDepartmentFirewallState', () => {
      beforeEach(() => {
        // Mock service to prevent side-effects
        mockDepartmentFirewallService.getDepartmentFirewallState.mockResolvedValue({
          departmentId,
          appliedTemplates: [],
          customRules: [],
          effectiveRules: [],
          vmCount: 0,
          lastSync: new Date()
        })
      })

      it('should reject USER context with Unauthorized error', async () => {
        const query = `
          query GetDepartmentFirewallState($departmentId: ID!) {
            getDepartmentFirewallState(departmentId: $departmentId) {
              departmentId
              vmCount
            }
          }
        `

        const result = await executeGraphQL({
          schema,
          query,
          variables: { departmentId },
          context: userCtx
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Unauthorized')
        expect(mockDepartmentFirewallService.getDepartmentFirewallState).not.toHaveBeenCalled()
      })

      it('should reject unauthenticated context with Unauthorized error', async () => {
        const query = `
          query GetDepartmentFirewallState($departmentId: ID!) {
            getDepartmentFirewallState(departmentId: $departmentId) {
              departmentId
              vmCount
            }
          }
        `

        const result = await executeGraphQL({
          schema,
          query,
          variables: { departmentId },
          context: unauthCtx
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Unauthorized')
        expect(mockDepartmentFirewallService.getDepartmentFirewallState).not.toHaveBeenCalled()
      })

      it('should allow ADMIN context and return mocked values', async () => {
        const query = `
          query GetDepartmentFirewallState($departmentId: ID!) {
            getDepartmentFirewallState(departmentId: $departmentId) {
              departmentId
              vmCount
            }
          }
        `

        const result = await executeGraphQL({
          schema,
          query,
          variables: { departmentId },
          context: adminCtx
        })

        expect(result.errors).toBeUndefined()
        expect(result.data).toBeDefined()
        expect((result.data as any)?.getDepartmentFirewallState?.departmentId).toBe(departmentId)
        expect((result.data as any)?.getDepartmentFirewallState?.vmCount).toBe(0)
        expect(mockDepartmentFirewallService.getDepartmentFirewallState).toHaveBeenCalledWith(departmentId)
      })
    })

    describe('Mutation: applyDepartmentFirewallTemplate', () => {
      beforeEach(() => {
        // Mock service to prevent side-effects
        mockDepartmentFirewallService.applyTemplateToDepart.mockResolvedValue(true)
      })

      it('should reject USER context with Unauthorized error', async () => {
        const mutation = `
          mutation ApplyDepartmentFirewallTemplate($input: ApplyDepartmentTemplateInput!) {
            applyDepartmentFirewallTemplate(input: $input)
          }
        `

        const input = {
          departmentId,
          templateFilterId: generateId()
        }

        const result = await executeGraphQL({
          schema,
          query: mutation,
          variables: { input },
          context: userCtx
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Unauthorized')
        expect(mockDepartmentFirewallService.applyTemplateToDepart).not.toHaveBeenCalled()
      })

      it('should reject unauthenticated context with Unauthorized error', async () => {
        const mutation = `
          mutation ApplyDepartmentFirewallTemplate($input: ApplyDepartmentTemplateInput!) {
            applyDepartmentFirewallTemplate(input: $input)
          }
        `

        const input = {
          departmentId,
          templateFilterId: generateId()
        }

        const result = await executeGraphQL({
          schema,
          query: mutation,
          variables: { input },
          context: unauthCtx
        })

        expect(result.errors).toBeDefined()
        expect(result.errors?.[0].message).toContain('Unauthorized')
        expect(mockDepartmentFirewallService.applyTemplateToDepart).not.toHaveBeenCalled()
      })

      it('should allow ADMIN context and return mocked values', async () => {
        const mutation = `
          mutation ApplyDepartmentFirewallTemplate($input: ApplyDepartmentTemplateInput!) {
            applyDepartmentFirewallTemplate(input: $input)
          }
        `

        const input = {
          departmentId,
          templateFilterId: generateId()
        }

        const result = await executeGraphQL({
          schema,
          query: mutation,
          variables: { input },
          context: adminCtx
        })

        expect(result.errors).toBeUndefined()
        expect(result.data).toBeDefined()
        expect((result.data as any)?.applyDepartmentFirewallTemplate).toBe(true)
        expect(mockDepartmentFirewallService.applyTemplateToDepart).toHaveBeenCalledWith(
          input.departmentId,
          input.templateFilterId
        )
      })
    })
  })

  describe('Error Handling', () => {
    it('should propagate service errors', async () => {
      const departmentId = generateId()
      mockDepartmentFirewallService.getDepartmentFirewallState.mockRejectedValue(
        new Error('Database connection failed')
      )

      await expect(
        resolver.getDepartmentFirewallState(departmentId, adminCtx)
      ).rejects.toThrow('Database connection failed')
    })

    it('should handle prisma errors', async () => {
      const ruleId = generateId()
      const input = { action: 'accept', direction: 'in', priority: 500 }

      mockPrisma.fWRule.findUnique.mockRejectedValue(new Error('Database error'))

      await expect(
        resolver.updateDepartmentFirewallRule(ruleId, input, adminCtx)
      ).rejects.toThrow('Database error')
    })
  })

  describe('WebSocket Events', () => {
    it('should send correct event structure for template operations', async () => {
      const input = {
        departmentId: generateId(),
        templateFilterId: generateId()
      }

      mockDepartmentFirewallService.applyTemplateToDepart.mockResolvedValue(true)

      await resolver.applyDepartmentFirewallTemplate(input, adminCtx)

      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'templateApplied',
        {
          data: {
            departmentId: input.departmentId,
            templateFilterId: input.templateFilterId
          }
        }
      )
    })

    it('should send correct event structure for rule operations', async () => {
      const departmentId = generateId()
      const ruleId = generateId()
      const mockRule = createMockFWRule({ id: ruleId })

      mockDepartmentFirewallService.validateRulePriority.mockReturnValue(true)
      mockDepartmentFirewallService.addDepartmentRule.mockResolvedValue(mockRule)

      await resolver.createDepartmentFirewallRule(departmentId, {
        filterId: generateId(),
        action: 'accept',
        direction: 'in',
        priority: 500
      }, adminCtx)

      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'ruleCreated',
        {
          data: {
            departmentId,
            ruleId: mockRule.id
          }
        }
      )
    })

    it('should send correct event structure for system operations', async () => {
      const departmentId = generateId()

      mockDepartmentFirewallService.flushDepartmentToAllVMs.mockResolvedValue(true)

      await resolver.flushDepartmentFirewall(departmentId, adminCtx)

      expect(mockSocketService.sendToAdmins).toHaveBeenCalledWith(
        'departmentFirewall',
        'flushed',
        {
          data: {
            departmentId
          }
        }
      )
    })
  })
})