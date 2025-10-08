import { RuleSetType } from '@prisma/client'

import { FirewallEventManager } from '@services/FirewallEventManager'

// Mock types
type MockSocketService = {
  sendToUser: jest.Mock
}

type MockPrismaClient = {
  firewallRule: {
    findUnique: jest.Mock
  }
  user: {
    findMany: jest.Mock
  }
  machine: {
    findUnique: jest.Mock
  }
}

describe('FirewallEventManager', () => {
  let firewallEventManager: FirewallEventManager
  let mockSocketService: MockSocketService
  let mockPrisma: MockPrismaClient

  beforeEach(() => {
    // Create mock Socket Service
    mockSocketService = {
      sendToUser: jest.fn()
    }

    // Create mock Prisma client
    mockPrisma = {
      firewallRule: {
        findUnique: jest.fn()
      },
      user: {
        findMany: jest.fn()
      },
      machine: {
        findUnique: jest.fn()
      }
    }

    firewallEventManager = new FirewallEventManager(mockSocketService as any, mockPrisma as any)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('handleEvent', () => {
    describe('Department Firewall Rules', () => {
      it('should send rule:created:department event to all admins and users with VMs in department', async () => {
        const departmentId = 'dept-123'
        const ruleId = 'rule-456'

        // Mock rule data
        const mockRule = {
          id: ruleId,
          name: 'Allow HTTPS',
          ruleSet: {
            entityType: RuleSetType.DEPARTMENT,
            entityId: departmentId
          }
        }

        // Mock admin users
        const mockAdmins = [
          { id: 'admin-1' },
          { id: 'admin-2' }
        ]

        // Mock users with VMs in department
        const mockDeptUsers = [
          { id: 'user-1' },
          { id: 'user-2' }
        ]

        mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule as any)
        mockPrisma.user.findMany
          .mockResolvedValueOnce(mockAdmins as any) // Admin query
          .mockResolvedValueOnce(mockDeptUsers as any) // Department users query

        await firewallEventManager.handleEvent('create', { id: ruleId }, 'admin-1')

        // Should fetch rule data
        expect(mockPrisma.firewallRule.findUnique).toHaveBeenCalledWith({
          where: { id: ruleId },
          include: { ruleSet: true }
        })

        // Should query admins
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
          where: {
            role: 'ADMIN',
            deleted: false
          },
          select: { id: true }
        })

        // Should query users with VMs in department
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
          where: {
            deleted: false,
            VM: {
              some: {
                departmentId: departmentId
              }
            }
          },
          select: { id: true }
        })

        // Should send events to all 4 users (2 admins + 2 department users)
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(4)

        // Verify event format for one of the calls
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'firewall',
          'rule:created:department',
          {
            status: 'success',
            data: {
              ruleId: ruleId,
              ruleName: 'Allow HTTPS',
              departmentId: departmentId
            }
          }
        )
      })

      it('should send rule:updated:department event', async () => {
        const departmentId = 'dept-123'
        const ruleId = 'rule-456'

        const mockRule = {
          id: ruleId,
          name: 'Updated Rule',
          ruleSet: {
            entityType: RuleSetType.DEPARTMENT,
            entityId: departmentId
          }
        }

        mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule as any)
        mockPrisma.user.findMany
          .mockResolvedValueOnce([{ id: 'admin-1' }] as any)
          .mockResolvedValueOnce([{ id: 'user-1' }] as any)

        await firewallEventManager.handleEvent('update', { id: ruleId })

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'firewall',
          'rule:updated:department',
          expect.objectContaining({
            status: 'success',
            data: expect.objectContaining({
              ruleId: ruleId,
              departmentId: departmentId
            })
          })
        )
      })

      it('should send rule:deleted:department event', async () => {
        const departmentId = 'dept-123'
        const ruleId = 'rule-456'

        const mockRule = {
          id: ruleId,
          name: 'Deleted Rule',
          ruleSet: {
            entityType: RuleSetType.DEPARTMENT,
            entityId: departmentId
          }
        }

        mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule as any)
        mockPrisma.user.findMany
          .mockResolvedValueOnce([{ id: 'admin-1' }] as any)
          .mockResolvedValueOnce([{ id: 'user-1' }] as any)

        await firewallEventManager.handleEvent('delete', { id: ruleId })

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'firewall',
          'rule:deleted:department',
          expect.objectContaining({
            status: 'success',
            data: expect.objectContaining({
              ruleId: ruleId,
              departmentId: departmentId
            })
          })
        )
      })
    })

    describe('VM Firewall Rules', () => {
      it('should send rule:created event to admins and VM owner', async () => {
        const vmId = 'vm-123'
        const ruleId = 'rule-789'
        const ownerId = 'user-1'

        const mockRule = {
          id: ruleId,
          name: 'Allow SSH',
          ruleSet: {
            entityType: RuleSetType.VM,
            entityId: vmId
          }
        }

        const mockAdmins = [{ id: 'admin-1' }]
        const mockVM = { userId: ownerId }

        mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule as any)
        mockPrisma.user.findMany.mockResolvedValueOnce(mockAdmins as any)
        mockPrisma.machine.findUnique.mockResolvedValue(mockVM as any)

        await firewallEventManager.handleEvent('create', { id: ruleId })

        // Should query VM to get owner
        expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
          where: { id: vmId },
          select: { userId: true }
        })

        // Should send to admin and VM owner (2 users)
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(2)

        // Verify event format
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'firewall',
          'rule:created',
          {
            status: 'success',
            data: {
              ruleId: ruleId,
              ruleName: 'Allow SSH',
              vmId: vmId
            }
          }
        )
      })

      it('should send rule:updated event', async () => {
        const vmId = 'vm-123'
        const ruleId = 'rule-789'

        const mockRule = {
          id: ruleId,
          name: 'Updated VM Rule',
          ruleSet: {
            entityType: RuleSetType.VM,
            entityId: vmId
          }
        }

        mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule as any)
        mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }] as any)
        mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' } as any)

        await firewallEventManager.handleEvent('update', { id: ruleId })

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'firewall',
          'rule:updated',
          expect.objectContaining({
            status: 'success',
            data: expect.objectContaining({
              ruleId: ruleId,
              vmId: vmId
            })
          })
        )
      })

      it('should send rule:deleted event', async () => {
        const vmId = 'vm-123'
        const ruleId = 'rule-789'

        const mockRule = {
          id: ruleId,
          name: 'Deleted VM Rule',
          ruleSet: {
            entityType: RuleSetType.VM,
            entityId: vmId
          }
        }

        mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule as any)
        mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }] as any)
        mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' } as any)

        await firewallEventManager.handleEvent('delete', { id: ruleId })

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          expect.any(String),
          'firewall',
          'rule:deleted',
          expect.objectContaining({
            status: 'success',
            data: expect.objectContaining({
              ruleId: ruleId,
              vmId: vmId
            })
          })
        )
      })

      it('should handle VM with no owner gracefully', async () => {
        const vmId = 'vm-123'
        const ruleId = 'rule-789'

        const mockRule = {
          id: ruleId,
          name: 'VM Rule No Owner',
          ruleSet: {
            entityType: RuleSetType.VM,
            entityId: vmId
          }
        }

        mockPrisma.firewallRule.findUnique.mockResolvedValue(mockRule as any)
        mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }] as any)
        mockPrisma.machine.findUnique.mockResolvedValue({ userId: null } as any)

        await firewallEventManager.handleEvent('create', { id: ruleId })

        // Should only send to admin (1 user)
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(1)
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          'admin-1',
          'firewall',
          'rule:created',
          expect.any(Object)
        )
      })
    })

    describe('Error Handling', () => {
      it('should handle rule not found gracefully', async () => {
        mockPrisma.firewallRule.findUnique.mockResolvedValue(null)

        await expect(
          firewallEventManager.handleEvent('create', { id: 'non-existent' })
        ).resolves.not.toThrow()

        // Should not send any events
        expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
      })

      it('should handle database errors gracefully', async () => {
        mockPrisma.firewallRule.findUnique.mockRejectedValue(new Error('Database error'))

        // Should not throw - errors are caught and logged
        await expect(
          firewallEventManager.handleEvent('create', { id: 'rule-123' })
        ).resolves.not.toThrow()

        // Should not send any events due to error
        expect(mockSocketService.sendToUser).not.toHaveBeenCalled()
      })

      it('should handle rule data with ruleSet already included', async () => {
        const vmId = 'vm-123'
        const ruleData = {
          id: 'rule-456',
          name: 'Pre-loaded Rule',
          ruleSet: {
            entityType: RuleSetType.VM,
            entityId: vmId
          }
        }

        mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'admin-1' }] as any)
        mockPrisma.machine.findUnique.mockResolvedValue({ userId: 'user-1' } as any)

        await firewallEventManager.handleEvent('create', ruleData)

        // Should NOT query database for rule (already provided)
        expect(mockPrisma.firewallRule.findUnique).not.toHaveBeenCalled()

        // Should still send events
        expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(2)
      })
    })
  })
})
