import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { UserInputError } from 'apollo-server-core'
import { AdvancedFirewallResolver } from '@resolvers/AdvancedFirewallResolver'
import { FirewallSimplifierService, SimplifiedRule } from '@services/FirewallSimplifierService'
import { PortValidationService, ValidationResult, PortRange } from '@services/PortValidationService'
import { getSocketService } from '@services/SocketService'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockContext, createAdminContext } from '../../setup/test-helpers'
import { createMockMachine, createMockUser, createMockAdminUser } from '../../setup/mock-factories'
import { PortInputType, CreateAdvancedFirewallRuleInput } from '@graphql/types/SimplifiedFirewallType'

// Mock services
jest.mock('@services/FirewallSimplifierService')
jest.mock('@services/PortValidationService')
jest.mock('@services/SocketService')

const MockedFirewallSimplifierService = FirewallSimplifierService as jest.MockedClass<typeof FirewallSimplifierService>
const MockedPortValidationService = PortValidationService as jest.MockedClass<typeof PortValidationService>

describe('AdvancedFirewallResolver', () => {
  let resolver: AdvancedFirewallResolver
  let mockFirewallService: jest.Mocked<FirewallSimplifierService>
  let mockPortValidationService: jest.Mocked<PortValidationService>
  let mockSocketService: any

  const mockUser = createMockUser({ id: 'user-1', role: 'USER' })
  const mockAdmin = createMockAdminUser({ id: 'admin-1' })
  const mockMachine = createMockMachine({ id: 'machine-1', userId: 'user-1' })
  const mockAdminMachine = createMockMachine({ id: 'machine-2', userId: 'other-user' })

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock FirewallSimplifierService
    mockFirewallService = {
      addMultipleCustomRules: jest.fn(),
      addCustomRule: jest.fn(),
      getVMFirewallState: jest.fn()
    } as any
    MockedFirewallSimplifierService.mockImplementation(() => mockFirewallService)

    // Mock PortValidationService
    mockPortValidationService = {
      validatePortString: jest.fn(),
      parsePortString: jest.fn()
    } as any
    MockedPortValidationService.mockImplementation(() => mockPortValidationService)

    // Mock SocketService
    mockSocketService = {
      sendToUser: jest.fn()
    }
    ;(getSocketService as jest.Mock).mockReturnValue(mockSocketService)

    resolver = new AdvancedFirewallResolver()
  })

  describe('createAdvancedFirewallRule', () => {
    const validInput: CreateAdvancedFirewallRuleInput = {
      machineId: 'machine-1',
      ports: {
        type: PortInputType.SINGLE,
        value: '80',
        description: 'HTTP port'
      },
      protocol: 'tcp',
      direction: 'in',
      action: 'accept',
      description: 'Allow HTTP traffic'
    }

    const mockVMFirewallState = {
      appliedTemplates: [],
      customRules: [],
      effectiveRules: [],
      lastSync: new Date()
    }

    describe('Success cases', () => {
      beforeEach(() => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)
        mockPortValidationService.validatePortString.mockReturnValue({
          isValid: true,
          errors: []
        })
        mockFirewallService.addMultipleCustomRules.mockResolvedValue(mockVMFirewallState)
      })

      it('should create rule for single port configuration', async () => {
        const portRanges: PortRange[] = [{ start: 80, end: 80 }]
        mockPortValidationService.parsePortString.mockReturnValue(portRanges)

        const ctx = createMockContext(mockUser)
        const result = await resolver.createAdvancedFirewallRule(validInput, ctx)

        expect(mockPortValidationService.validatePortString).toHaveBeenCalledWith('80')
        expect(mockPortValidationService.parsePortString).toHaveBeenCalledWith('80')

        const expectedRules: SimplifiedRule[] = [{
          port: '80',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Allow HTTP traffic'
        }]

        expect(mockFirewallService.addMultipleCustomRules).toHaveBeenCalledWith('machine-1', expectedRules)
        expect(result).toEqual(mockVMFirewallState)
      })

      it('should create rule for port range configuration', async () => {
        const rangeInput = {
          ...validInput,
          ports: {
            type: PortInputType.RANGE,
            value: '80-90',
            description: 'HTTP range'
          }
        }

        const portRanges: PortRange[] = [{ start: 80, end: 90 }]
        mockPortValidationService.parsePortString.mockReturnValue(portRanges)

        const ctx = createMockContext(mockUser)
        const result = await resolver.createAdvancedFirewallRule(rangeInput, ctx)

        const expectedRules: SimplifiedRule[] = [{
          port: '80-90',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Allow HTTP traffic'
        }]

        expect(mockFirewallService.addMultipleCustomRules).toHaveBeenCalledWith('machine-1', expectedRules)
        expect(result).toEqual(mockVMFirewallState)
      })

      it('should create multiple rules for multiple ports configuration', async () => {
        const multipleInput = {
          ...validInput,
          ports: {
            type: PortInputType.MULTIPLE,
            value: '80,443,8080',
            description: 'Web ports'
          }
        }

        const portRanges: PortRange[] = [
          { start: 80, end: 80 },
          { start: 443, end: 443 },
          { start: 8080, end: 8080 }
        ]
        mockPortValidationService.parsePortString.mockReturnValue(portRanges)

        const ctx = createMockContext(mockUser)
        const result = await resolver.createAdvancedFirewallRule(multipleInput, ctx)

        const expectedRules: SimplifiedRule[] = [
          { port: '80', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Allow HTTP traffic' },
          { port: '443', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Allow HTTP traffic' },
          { port: '8080', protocol: 'tcp', direction: 'in', action: 'accept', description: 'Allow HTTP traffic' }
        ]

        expect(mockFirewallService.addMultipleCustomRules).toHaveBeenCalledWith('machine-1', expectedRules)
        expect(result).toEqual(mockVMFirewallState)
      })

      it('should create rule for ALL ports configuration', async () => {
        const allInput = {
          ...validInput,
          ports: {
            type: PortInputType.ALL,
            value: 'all',
            description: 'All ports'
          }
        }

        const ctx = createMockContext(mockUser)
        const result = await resolver.createAdvancedFirewallRule(allInput, ctx)

        const expectedRules: SimplifiedRule[] = [{
          port: 'all',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Allow HTTP traffic'
        }]

        expect(mockFirewallService.addMultipleCustomRules).toHaveBeenCalledWith('machine-1', expectedRules)
        expect(result).toEqual(mockVMFirewallState)
      })

      it('should emit WebSocket event on successful creation', async () => {
        const portRanges: PortRange[] = [{ start: 80, end: 80 }]
        mockPortValidationService.parsePortString.mockReturnValue(portRanges)

        const ctx = createMockContext(mockUser)
        await resolver.createAdvancedFirewallRule(validInput, ctx)

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          'user-1',
          'vm',
          'firewall:advanced:rule:created',
          {
            data: {
              machineId: 'machine-1',
              rules: expect.any(Array),
              state: mockVMFirewallState
            }
          }
        )
      })
    })

    describe('Authorization tests', () => {
      beforeEach(() => {
        mockPortValidationService.validatePortString.mockReturnValue({
          isValid: true,
          errors: []
        })
        mockPortValidationService.parsePortString.mockReturnValue([{ start: 80, end: 80 }])
        mockFirewallService.addMultipleCustomRules.mockResolvedValue(mockVMFirewallState)
      })

      it('should allow user to access own machine', async () => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)

        const ctx = createMockContext(mockUser)
        const result = await resolver.createAdvancedFirewallRule(validInput, ctx)

        expect(result).toEqual(mockVMFirewallState)
      })

      it('should allow admin to access any machine', async () => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockAdminMachine)

        const adminInput = { ...validInput, machineId: 'machine-2' }
        const ctx = createMockContext(mockAdmin)
        const result = await resolver.createAdvancedFirewallRule(adminInput, ctx)

        expect(result).toEqual(mockVMFirewallState)
      })

      it('should deny non-owner access to other user\'s machine', async () => {
        mockPrisma.machine.findFirst.mockResolvedValue(null)

        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createAdvancedFirewallRule(validInput, ctx)
        ).rejects.toThrow(UserInputError)
      })
    })

    describe('Validation tests', () => {
      beforeEach(() => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)
      })

      it('should reject invalid port formats', async () => {
        mockPortValidationService.validatePortString.mockReturnValue({
          isValid: false,
          errors: ['Invalid port format']
        })

        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createAdvancedFirewallRule(validInput, ctx)
        ).rejects.toThrow(UserInputError)
      })

      it('should reject when machine not found', async () => {
        mockPrisma.machine.findFirst.mockResolvedValue(null)

        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createAdvancedFirewallRule(validInput, ctx)
        ).rejects.toThrow('Machine not found or access denied')
      })
    })
  })

  describe('createPortRangeRule', () => {
    const mockVMFirewallState = {
      appliedTemplates: [],
      customRules: [],
      effectiveRules: [],
      lastSync: new Date()
    }

    describe('Success cases', () => {
      beforeEach(() => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)
        mockFirewallService.addCustomRule.mockResolvedValue(mockVMFirewallState)
      })

      it('should create rule for single port (startPort = endPort)', async () => {
        const ctx = createMockContext(mockUser)
        const result = await resolver.createPortRangeRule(
          'machine-1', 80, 80, 'tcp', 'in', 'accept', 'HTTP port', ctx
        )

        const expectedRule: SimplifiedRule = {
          port: '80',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'HTTP port'
        }

        expect(mockFirewallService.addCustomRule).toHaveBeenCalledWith('machine-1', expectedRule)
        expect(result).toEqual(mockVMFirewallState)
      })

      it('should create rule for port range (startPort < endPort)', async () => {
        const ctx = createMockContext(mockUser)
        const result = await resolver.createPortRangeRule(
          'machine-1', 8000, 8010, 'tcp', 'in', 'accept', 'Dev ports', ctx
        )

        const expectedRule: SimplifiedRule = {
          port: '8000-8010',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Dev ports'
        }

        expect(mockFirewallService.addCustomRule).toHaveBeenCalledWith('machine-1', expectedRule)
        expect(result).toEqual(mockVMFirewallState)
      })

      it('should use default description when not provided', async () => {
        const ctx = createMockContext(mockUser)
        const result = await resolver.createPortRangeRule(
          'machine-1', 80, 80, 'tcp', 'in', 'accept', undefined, ctx
        )

        const expectedRule: SimplifiedRule = {
          port: '80',
          protocol: 'tcp',
          direction: 'in',
          action: 'accept',
          description: 'Port range 80 (tcp/in/accept)'
        }

        expect(mockFirewallService.addCustomRule).toHaveBeenCalledWith('machine-1', expectedRule)
        expect(result).toEqual(mockVMFirewallState)
      })

      it('should emit WebSocket event on successful creation', async () => {
        const ctx = createMockContext(mockUser)
        await resolver.createPortRangeRule(
          'machine-1', 80, 80, 'tcp', 'in', 'accept', 'HTTP port', ctx
        )

        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          'user-1',
          'vm',
          'firewall:range:rule:created',
          {
            data: {
              machineId: 'machine-1',
              rule: expect.any(Object),
              state: mockVMFirewallState
            }
          }
        )
      })
    })

    describe('Validation tests', () => {
      beforeEach(() => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)
      })

      it('should reject startPort < 1', async () => {
        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createPortRangeRule('machine-1', 0, 80, 'tcp', 'in', 'accept', undefined, ctx)
        ).rejects.toThrow('Start port must be between 1 and 65535')
      })

      it('should reject startPort > 65535', async () => {
        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createPortRangeRule('machine-1', 65536, 80, 'tcp', 'in', 'accept', undefined, ctx)
        ).rejects.toThrow('Start port must be between 1 and 65535')
      })

      it('should reject endPort < 1', async () => {
        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createPortRangeRule('machine-1', 80, 0, 'tcp', 'in', 'accept', undefined, ctx)
        ).rejects.toThrow('End port must be between 1 and 65535')
      })

      it('should reject endPort > 65535', async () => {
        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createPortRangeRule('machine-1', 80, 65536, 'tcp', 'in', 'accept', undefined, ctx)
        ).rejects.toThrow('End port must be between 1 and 65535')
      })

      it('should reject startPort > endPort', async () => {
        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createPortRangeRule('machine-1', 90, 80, 'tcp', 'in', 'accept', undefined, ctx)
        ).rejects.toThrow('Start port must be less than or equal to end port')
      })

      it('should reject when machine not found', async () => {
        mockPrisma.machine.findFirst.mockResolvedValue(null)

        const ctx = createMockContext(mockUser)

        await expect(
          resolver.createPortRangeRule('machine-1', 80, 80, 'tcp', 'in', 'accept', undefined, ctx)
        ).rejects.toThrow('Machine not found or access denied')
      })
    })

    describe('Authorization tests', () => {
      beforeEach(() => {
        mockFirewallService.addCustomRule.mockResolvedValue(mockVMFirewallState)
      })

      it('should allow user to access own machine', async () => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)

        const ctx = createMockContext(mockUser)
        const result = await resolver.createPortRangeRule(
          'machine-1', 80, 80, 'tcp', 'in', 'accept', undefined, ctx
        )

        expect(result).toEqual(mockVMFirewallState)
      })

      it('should allow admin to access any machine', async () => {
        mockPrisma.machine.findFirst.mockResolvedValue(mockAdminMachine)

        const ctx = createMockContext(mockAdmin)
        const result = await resolver.createPortRangeRule(
          'machine-2', 80, 80, 'tcp', 'in', 'accept', undefined, ctx
        )

        expect(result).toEqual(mockVMFirewallState)
      })
    })
  })

  describe('Service integration', () => {
    it('should initialize services correctly', () => {
      const resolver = new AdvancedFirewallResolver()

      // Services should be null initially
      expect(resolver['firewallSimplifierService']).toBeNull()
      expect(resolver['portValidationService']).toBeNull()
    })

    it('should handle service failures gracefully', async () => {
      mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)
      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: true,
        errors: []
      })
      mockPortValidationService.parsePortString.mockReturnValue([{ start: 80, end: 80 }])
      mockFirewallService.addMultipleCustomRules.mockRejectedValue(new Error('Service error'))

      const validInput: CreateAdvancedFirewallRuleInput = {
        machineId: 'machine-1',
        ports: { type: PortInputType.SINGLE, value: '80' },
        protocol: 'tcp',
        direction: 'in',
        action: 'accept'
      }

      const ctx = createMockContext(mockUser)

      await expect(
        resolver.createAdvancedFirewallRule(validInput, ctx)
      ).rejects.toThrow('Service error')
    })

    it('should handle WebSocket event failures without breaking main flow', async () => {
      mockPrisma.machine.findFirst.mockResolvedValue(mockMachine)
      mockPortValidationService.validatePortString.mockReturnValue({
        isValid: true,
        errors: []
      })
      mockPortValidationService.parsePortString.mockReturnValue([{ start: 80, end: 80 }])
      mockFirewallService.addMultipleCustomRules.mockResolvedValue({
        appliedTemplates: [],
        customRules: [],
        effectiveRules: [],
        lastSync: new Date()
      })
      mockSocketService.sendToUser.mockImplementation(() => {
        throw new Error('Socket error')
      })

      const validInput: CreateAdvancedFirewallRuleInput = {
        machineId: 'machine-1',
        ports: { type: PortInputType.SINGLE, value: '80' },
        protocol: 'tcp',
        direction: 'in',
        action: 'accept'
      }

      const ctx = createMockContext(mockUser)

      // Should not throw despite socket error
      const result = await resolver.createAdvancedFirewallRule(validInput, ctx)
      expect(result).toBeDefined()
    })
  })
})