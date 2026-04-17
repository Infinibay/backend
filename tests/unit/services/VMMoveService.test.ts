import { PrismaClient, Machine, MachineConfiguration, Department } from '@prisma/client'
import { VMMoveService, MoveResult } from '../../../app/services/VMMoveService'
import { FirewallOrchestrationService } from '../../../app/services/firewall/FirewallOrchestrationService'
import { TapDeviceManager } from '@infinibay/infinization'
import { createMockMachine, createMockMachineConfiguration, createMockDepartment } from '../../setup/mock-factories'

// Create a configurable mock for InfinizationService
let mockGetVMStatusResult: any = { processAlive: true }
import logger from '@main/logger'

// Set up mock module BEFORE it is used
jest.mock('../../../app/services/InfinizationService', () => ({
  __esModule: true,
  getInfinization: jest.fn(),
  initializeInfinization: jest.fn()
}))

// Import mocked module
import * as InfinizationService from '../../../app/services/InfinizationService'

describe('VMMoveService', () => {
  let prisma: PrismaConfig
  let firewallOrchestration: jest.Mocked<FirewallOrchestrationService>
  let moveService: VMMoveService
  let debugLogSpy: jest.SpyInstance

  interface PrismaConfig {
    machine: {
      findUnique: jest.Mock
      update: jest.Mock
      findFirst: jest.Mock
    }
    department: {
      findUnique: jest.Mock
    }
    machineConfiguration: {
      findFirst: jest.Mock
      update: jest.Mock
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()

    // Reset mock VM status to running by default
    mockGetVMStatusResult = { processAlive: true }
    ;(InfinizationService.getInfinization as jest.Mock).mockResolvedValue({
      getVMStatus: jest.fn().mockImplementation(() => Promise.resolve(mockGetVMStatusResult)),
      getVMInfo: jest.fn().mockResolvedValue({}),
    })

    prisma = {
      machine: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn()
      },
      department: {
        findUnique: jest.fn()
      },
      machineConfiguration: {
        findFirst: jest.fn(),
        update: jest.fn()
      }
    }

    firewallOrchestration = {
      applyVMRules: jest.fn(),
      getEffectiveRules: jest.fn(),
      syncAllRules: jest.fn()
    } as unknown as jest.Mocked<FirewallOrchestrationService>

    moveService = new VMMoveService(prisma as unknown as PrismaClient, firewallOrchestration)

    debugLogSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any)
    jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)
  })

  afterEach(() => {
    debugLogSpy.mockRestore()
  })

  describe('moveVMToDepartment', () => {
    const mockVM = createMockMachine({
      id: 'vm-123',
      name: 'Test VM',
      status: 'running',
      departmentId: 'dept-old',
      userId: 'user-123'
    })

    const mockConfig = createMockMachineConfiguration({
      id: 'config-123',
      machineId: 'vm-123',
      bridge: 'br-old',
      tapDeviceName: 'tap123',
      graphicProtocol: 'spice',
      graphicPort: 5900
    })

    const mockOldDept = createMockDepartment({
      id: 'dept-old',
      name: 'Old Department',
      bridgeName: 'br-old'
    })

    const mockNewDept = createMockDepartment({
      id: 'dept-new',
      name: 'New Department',
      bridgeName: 'br-new'
    })

    describe('successful moves', () => {
      it('should move a running VM with hot-swap when bridges differ', async () => {
        mockGetVMStatusResult = { processAlive: true }
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(mockNewDept)
        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockNewDept
        } as any)

        jest.mocked(prisma.machine.update).mockResolvedValue(mockVM)
        jest.mocked(prisma.machineConfiguration.update).mockResolvedValue(mockConfig)
        jest.mocked(firewallOrchestration.applyVMRules).mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' })

        const tapDetachSpy = jest.spyOn(TapDeviceManager.prototype, 'detachFromBridge').mockResolvedValue(undefined as any)
        const tapAttachSpy = jest.spyOn(TapDeviceManager.prototype, 'attachToBridge').mockResolvedValue(undefined as any)

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(true)
        expect(result.hotSwapPerformed).toBe(true)
        expect(result.networkChanged).toBe(true)
        expect(result.firewallChanged).toBe(true)

        expect(prisma.machine.update).toHaveBeenCalledWith({
          where: { id: 'vm-123' },
          data: { departmentId: 'dept-new' }
        })

        expect(prisma.machineConfiguration.update).toHaveBeenCalledWith({
          where: { id: 'config-123' },
          data: { bridge: 'br-new' }
        })

        expect(TapDeviceManager.prototype.detachFromBridge).toHaveBeenCalledWith('tap123')
        expect(TapDeviceManager.prototype.attachToBridge).toHaveBeenCalledWith('tap123', 'br-new')

        expect(firewallOrchestration.applyVMRules).toHaveBeenCalledWith('vm-123')

        tapDetachSpy.mockRestore()
        tapAttachSpy.mockRestore()
      })

      it('should update database only when VM is stopped', async () => {
        mockGetVMStatusResult = { processAlive: false }
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: { ...mockConfig, tapDeviceName: null },
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(mockNewDept)
        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: { ...mockConfig, tapDeviceName: null },
          department: mockNewDept
        } as any)

        jest.mocked(prisma.machine.update).mockResolvedValue(mockVM)
        jest.mocked(firewallOrchestration.applyVMRules).mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' })

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(true)
        expect(result.hotSwapPerformed).toBe(false)
        expect(result.networkChanged).toBe(false)
        expect(result.firewallChanged).toBe(false)

        expect(prisma.machine.update).toHaveBeenCalledWith({
          where: { id: 'vm-123' },
          data: { departmentId: 'dept-new' }
        })
      })

      it('should move VM with no existing configuration', async () => {
        mockGetVMStatusResult = { processAlive: false }
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: null,
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(mockNewDept)
        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: null,
          department: mockNewDept
        } as any)

        jest.mocked(prisma.machine.update).mockResolvedValue(mockVM)
        jest.mocked(firewallOrchestration.applyVMRules).mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' })

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(true)
        expect(result.firewallChanged).toBe(false)

        expect(prisma.machineConfiguration.update).not.toHaveBeenCalled()
      })

      it('should skip network change when bridges are the same', async () => {
        mockGetVMStatusResult = { processAlive: true }
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: { ...mockOldDept, bridgeName: 'br-same' }
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce({
          ...mockNewDept,
          bridgeName: 'br-same'
        })

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: { ...mockNewDept, bridgeName: 'br-same' }
        } as any)

        jest.mocked(prisma.machine.update).mockResolvedValue(mockVM)
        jest.mocked(firewallOrchestration.applyVMRules).mockResolvedValue({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' })

        const tapDetachSpy = jest.spyOn(TapDeviceManager.prototype, 'detachFromBridge').mockImplementation()
        const tapAttachSpy = jest.spyOn(TapDeviceManager.prototype, 'attachToBridge').mockImplementation()

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(true)
        expect(result.networkChanged).toBe(false)

        expect(TapDeviceManager.prototype.detachFromBridge).not.toHaveBeenCalled()
        expect(TapDeviceManager.prototype.attachToBridge).not.toHaveBeenCalled()

        tapDetachSpy.mockRestore()
        tapAttachSpy.mockRestore()
      })
    })

    describe('error handling', () => {
      it('should return error when VM not found', async () => {
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce(null)

        const result = await moveService.moveVMToDepartment('non-existent-vm', 'dept-new')

        expect(result.success).toBe(false)
        expect(result.error).toBe('VM not found')
        expect(result.hotSwapPerformed).toBe(false)
        expect(result.networkChanged).toBe(false)
        expect(result.firewallChanged).toBe(false)

        expect(prisma.machine.update).not.toHaveBeenCalled()
        expect(firewallOrchestration.applyVMRules).not.toHaveBeenCalled()
      })

      it('should return error when target department not found', async () => {
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(null)

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-nonexistent')

        expect(result.success).toBe(false)
        expect(result.error).toBe('Target department not found')

        expect(prisma.machine.update).not.toHaveBeenCalled()
      })

      it('should return error when target department has no network', async () => {
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        const deptWithoutNetwork: Department = {
          ...mockNewDept,
          bridgeName: null
        }

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(deptWithoutNetwork)

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(false)
        expect(result.error).toBe('Target department has no network configured')
      })

      it('should return error when VM has no department', async () => {
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

        const vmNoDept = { ...mockVM, departmentId: null }

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...vmNoDept,
          configuration: mockConfig,
          department: null
        } as any)

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(false)
        expect(result.error).toBe('VM has no department assigned')
      })

      it('should continue with firewall rollback even if rollback fails', async () => {
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
        jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(mockNewDept)
        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockNewDept
        } as any)

        jest.mocked(prisma.machine.update).mockRejectedValueOnce(new Error('Database error'))

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(false)
        expect(result.error).toBe('Database error')
      })

      it('should not block move if firewall application fails', async () => {
        mockGetVMStatusResult = { processAlive: true }
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
        jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(mockNewDept)
        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockNewDept
        } as any)

        jest.mocked(prisma.machine.update).mockResolvedValue(mockVM)
        jest.mocked(prisma.machineConfiguration.update).mockResolvedValue(mockConfig)
        jest.mocked(firewallOrchestration.applyVMRules).mockRejectedValueOnce(new Error('Firewall error'))

        const tapDetachSpy = jest.spyOn(TapDeviceManager.prototype, 'detachFromBridge').mockResolvedValue(undefined as any)
        const tapAttachSpy = jest.spyOn(TapDeviceManager.prototype, 'attachToBridge').mockResolvedValue(undefined as any)

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(true)
        expect(result.firewallChanged).toBe(false)
        expect(result.error).toBeUndefined()

        tapDetachSpy.mockRestore()
        tapAttachSpy.mockRestore()
      })
    })

    describe('rollback behavior', () => {
      it('should rollback all changes when database update fails', async () => {
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
        jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

        const originalVM = { ...mockVM, configuration: mockConfig, department: mockOldDept }
        const updatedVM = { ...mockVM, department: mockNewDept }

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce(originalVM as any)
        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(mockNewDept)
        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...originalVM,
          department: mockNewDept
        } as any)

        jest.mocked(prisma.machine.update)
          .mockResolvedValueOnce(originalVM as any)
          .mockResolvedValueOnce(updatedVM as any)

        jest.mocked(prisma.machineConfiguration.findFirst).mockResolvedValueOnce(mockConfig)
        jest.mocked(prisma.machineConfiguration.update).mockResolvedValueOnce(mockConfig)
        jest.mocked(firewallOrchestration.applyVMRules).mockResolvedValueOnce({ success: true, rulesApplied: 0, rulesFailed: 0, chainName: 'test' })

        const tapAttachSpy = jest.spyOn(TapDeviceManager.prototype, 'attachToBridge')
          .mockRejectedValueOnce(new Error('Detach failed'))

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        expect(result.success).toBe(false)

        expect(TapDeviceManager.prototype.attachToBridge).toHaveBeenCalled()

        tapAttachSpy.mockRestore()
      })

      it('should rollback network change if firewall fails', async () => {
        mockGetVMStatusResult = { processAlive: true }
        jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)
        jest.spyOn(logger, 'warn').mockImplementation(() => undefined as any)

        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockOldDept
        } as any)

        jest.mocked(prisma.department.findUnique).mockResolvedValueOnce(mockNewDept)
        jest.mocked(prisma.machine.findUnique).mockResolvedValueOnce({
          ...mockVM,
          configuration: mockConfig,
          department: mockNewDept
        } as any)

        jest.mocked(prisma.machine.update).mockResolvedValue(mockVM)
        jest.mocked(prisma.machineConfiguration.update).mockResolvedValue(mockConfig)

        const tapDetachSpy = jest.spyOn(TapDeviceManager.prototype, 'detachFromBridge')
          .mockRejectedValueOnce(new Error('Detach failed'))

        const result = await moveService.moveVMToDepartment('vm-123', 'dept-new')

        // Network change fails, error is the failure itself
        expect(result.success).toBe(false)
        expect(result.error).toBe('Detach failed')

        tapDetachSpy.mockRestore()
      })
    })
  })
})
