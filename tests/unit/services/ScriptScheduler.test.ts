/**
 * Unit tests for ScriptScheduler.
 *
 * ScriptScheduler has many internal dependencies (ScriptManager,
 * TemplateEngine, ScriptParser, getVirtioSocketWatcherService,
 * getEventManager), so we use jest.mock() heavily.
 * PrismaClient is mocked with jest-mock-extended.
 */
import { ScriptScheduler, ScheduleScriptConfig } from '../../../app/services/scripts/ScriptScheduler'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient, ExecutionType, ExecutionStatus } from '@prisma/client'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockGetScript = jest.fn()
const mockValidateRequiredInputs = jest.fn()
const mockValidateInputValue = jest.fn()

jest.mock('../../../app/services/scripts/ScriptManager', () => {
  return {
    ScriptManager: jest.fn().mockImplementation(() => ({
      getScript: mockGetScript,
    })),
  }
})

jest.mock('../../../app/services/scripts/TemplateEngine', () => ({
  TemplateEngine: jest.fn().mockImplementation(() => ({
    validateRequiredInputs: mockValidateRequiredInputs,
  })),
}))

jest.mock('../../../app/services/scripts/ScriptParser', () => ({
  ScriptParser: jest.fn().mockImplementation(() => ({
    validateInputValue: mockValidateInputValue,
  })),
}))

const mockPushPendingScripts = jest.fn()

jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: () => ({
    pushPendingScriptsToVM: mockPushPendingScripts,
  }),
}))

const mockDispatchEvent = jest.fn()

jest.mock('../../../app/services/EventManager', () => ({
  getEventManager: () => ({
    dispatchEvent: mockDispatchEvent,
  }),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeScript() {
  return {
    id: 'script-1',
    name: 'Test Script',
    content: 'name: Test\nscript: |-\n  echo hello',
    scriptBody: 'echo hello',
    os: [],
    parsedInputs: [],
    shell: 'BASH',
  }
}

function makeConfig(overrides?: Partial<ScheduleScriptConfig>): ScheduleScriptConfig {
  return {
    scriptId: 'script-1',
    machineIds: ['vm-1', 'vm-2'],
    inputValues: {},
    scheduleType: 'immediate',
    userId: 'user-1',
    ...overrides,
  }
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('ScriptScheduler', () => {
  let scheduler: ScriptScheduler
  let mockPrisma: ReturnType<typeof mockDeep<PrismaClient>>

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = mockDeep<PrismaClient>()

    // Default: script exists
    mockGetScript.mockResolvedValue(makeScript())
    mockValidateRequiredInputs.mockReturnValue(undefined)
    mockValidateInputValue.mockReturnValue(undefined)

    // Default: machines are running
    mockPrisma.machine.findMany.mockResolvedValue([
      { id: 'vm-1', name: 'VM1', status: 'running' },
      { id: 'vm-2', name: 'VM2', status: 'running' },
    ] as any)

    // Default: scriptExecution.create returns an execution record
    mockPrisma.scriptExecution.create.mockResolvedValue({
      id: 'exec-1',
      scriptId: 'script-1',
      machineId: 'vm-1',
    } as any)

    // Default: scriptAuditLog.create succeeds
    mockPrisma.scriptAuditLog.create.mockResolvedValue({} as any)

    // Default: script has no OS restriction (for validateScriptOSCompatibility)
    mockPrisma.script.findUnique.mockResolvedValue({
      os: [],
      name: 'Test Script',
    } as any)

    // Default: push succeeds
    mockPushPendingScripts.mockResolvedValue({ success: true, scriptCount: 1 })
    scheduler = new ScriptScheduler(mockPrisma as any)
  })

  // ─── scheduleScript ────────────────────────────────────────────────────

  describe('scheduleScript', () => {
    it('schedules an immediate script for multiple VMs', async () => {
      const config = makeConfig()

      const result = await scheduler.scheduleScript(config)

      expect(result.success).toBe(true)
      expect(result.executionIds).toHaveLength(2)
      expect(mockPrisma.scriptExecution.create).toHaveBeenCalledTimes(2)

      const createCall = mockPrisma.scriptExecution.create.mock.calls[0][0]
      expect(createCall.data).toEqual(
        expect.objectContaining({
          scriptId: 'script-1',
          executionType: ExecutionType.SCHEDULED,
          status: ExecutionStatus.PENDING,
          triggeredById: 'user-1',
        }),
      )
    })

    it('schedules for department when departmentId provided', async () => {
      mockPrisma.machine.findMany
        .mockResolvedValueOnce([{ id: 'vm-dept-1' }] as any) // expandDepartmentToVMs
        .mockResolvedValueOnce([{ id: 'vm-dept-1', name: 'DeptVM', status: 'running' }] as any) // VM status check

      const config = makeConfig({
        machineIds: undefined,
        departmentId: 'dept-1',
      })

      const result = await scheduler.scheduleScript(config)

      expect(result.success).toBe(true)
      expect(result.executionIds).toHaveLength(1)
    })

    it('returns error when neither machineIds nor departmentId provided', async () => {
      const config = makeConfig({ machineIds: undefined })

      const result = await scheduler.scheduleScript(config)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('INVALID_TARGET')
    })

    it('returns error when script not found', async () => {
      mockGetScript.mockResolvedValue(null)

      const result = await scheduler.scheduleScript(makeConfig())

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SCRIPT_NOT_FOUND')
    })

    it('returns error when no target machines found', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([] as any)

      const config = makeConfig({ machineIds: undefined, departmentId: 'empty-dept' })

      const result = await scheduler.scheduleScript(config)

      expect(result.success).toBe(false)
      expect(result.error).toContain('No target machines')
    })

    it('returns error for one-time schedule without scheduledFor', async () => {
      const config = makeConfig({ scheduleType: 'one-time', scheduledFor: undefined })

      const result = await scheduler.scheduleScript(config)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('MISSING_SCHEDULE_TIME')
    })

    it('returns error for periodic schedule without repeatIntervalMinutes', async () => {
      const config = makeConfig({
        scheduleType: 'periodic',
        repeatIntervalMinutes: undefined,
      })

      const result = await scheduler.scheduleScript(config)

      expect(result.success).toBe(false)
      expect(result.error).toContain('repeatIntervalMinutes')
    })

    it('returns error for periodic schedule with invalid repeatIntervalMinutes', async () => {
      const config = makeConfig({
        scheduleType: 'periodic',
        repeatIntervalMinutes: -5,
      })

      const result = await scheduler.scheduleScript(config)

      expect(result.success).toBe(false)
      expect(result.error).toContain('repeatIntervalMinutes')
    })

    it('warns about offline VMs but still schedules', async () => {
      mockPrisma.machine.findMany.mockResolvedValue([
        { id: 'vm-1', name: 'OnlineVM', status: 'running', configuration: { setupComplete: true } },
        { id: 'vm-2', name: 'OfflineVM', status: 'stopped' },
      ] as any)

      const result = await scheduler.scheduleScript(makeConfig())

      expect(result.success).toBe(true)
      expect(result.warnings).toBeDefined()
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings![0]).toContain('OfflineVM')
    })

    it('validates OS compatibility and rejects incompatible VMs', async () => {
      mockPrisma.script.findUnique.mockResolvedValue({
        os: ['LINUX'],
        name: 'Linux Script',
      } as any)
      mockPrisma.machine.findMany.mockResolvedValue([
        { id: 'vm-1', name: 'WinVM', os: 'windows11' },
      ] as any)

      const result = await scheduler.scheduleScript(makeConfig())

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('OS_INCOMPATIBLE')
    })

    it('creates audit logs with redacted passwords', async () => {
      const config = makeConfig({
        inputValues: { username: 'admin', password: 'secret123' },
      })

      await scheduler.scheduleScript(config)

      const auditCall = mockPrisma.scriptAuditLog.create.mock.calls[0][0] as any
      expect(auditCall.data.details.inputValues.password).toBe('***REDACTED***')
      expect(auditCall.data.details.inputValues.username).toBe('admin')
    })

    it('emits schedule_created event', async () => {
      await scheduler.scheduleScript(makeConfig())

      expect(mockDispatchEvent).toHaveBeenCalledWith(
        'scripts',
        'create',
        expect.objectContaining({
          action: 'schedule_created',
          scriptId: 'script-1',
        }),
        'user-1',
      )
    })

    it('handles event emission failure gracefully', async () => {
      mockDispatchEvent.mockRejectedValue(new Error('Event bus down'))

      const result = await scheduler.scheduleScript(makeConfig())

      expect(result.success).toBe(true) // Should not fail
    })

    it('handles push scripts failure gracefully', async () => {
      mockPushPendingScripts.mockRejectedValue(new Error('Push failed'))

      const result = await scheduler.scheduleScript(makeConfig())

      expect(result.success).toBe(true) // Polling serves as fallback
    })
  })

  // ─── updateScheduledScript ─────────────────────────────────────────────

  describe('updateScheduledScript', () => {
    it('updates a pending scheduled execution', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        scriptId: 'script-1',
        status: ExecutionStatus.PENDING,
        script: makeScript(),
        machine: { id: 'vm-1', name: 'VM1' },
      } as any)
      mockPrisma.scriptExecution.update.mockResolvedValue({} as any)

      const result = await scheduler.updateScheduledScript('exec-1', {
        scheduledFor: new Date('2025-12-01'),
        runAs: 'admin',
      }, 'user-1')

      expect(result.success).toBe(true)
      expect(mockPrisma.scriptExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1' },
          data: expect.objectContaining({
            scheduledFor: expect.any(Date),
            executedAs: 'admin',
          }),
        }),
      )
    })

    it('returns error when execution not found', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue(null)

      const result = await scheduler.updateScheduledScript('nonexistent', {}, 'user-1')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('returns error when execution is not PENDING', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        status: ExecutionStatus.RUNNING,
      } as any)

      const result = await scheduler.updateScheduledScript('exec-1', {}, 'user-1')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Only PENDING')
    })

    it('re-validates input values when updating inputs', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        scriptId: 'script-1',
        status: ExecutionStatus.PENDING,
        script: makeScript(),
        machine: { id: 'vm-1', name: 'VM1' },
      } as any)
      mockPrisma.scriptExecution.update.mockResolvedValue({} as any)

      await scheduler.updateScheduledScript('exec-1', {
        inputValues: { key: 'value' },
      }, 'user-1')

      expect(mockValidateRequiredInputs).toHaveBeenCalled()
    })
  })

  // ─── cancelScheduledScript ─────────────────────────────────────────────

  describe('cancelScheduledScript', () => {
    it('cancels a pending execution', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        scriptId: 'script-1',
        status: ExecutionStatus.PENDING,
      } as any)
      mockPrisma.scriptExecution.update.mockResolvedValue({} as any)

      const result = await scheduler.cancelScheduledScript('exec-1', 'user-1')

      expect(result).toBe(true)
      expect(mockPrisma.scriptExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1' },
          data: {
            status: ExecutionStatus.CANCELLED,
            completedAt: expect.any(Date),
            error: 'Cancelled by user',
          },
        }),
      )
    })

    it('cancels a running execution', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        scriptId: 'script-1',
        status: ExecutionStatus.RUNNING,
      } as any)
      mockPrisma.scriptExecution.update.mockResolvedValue({} as any)

      const result = await scheduler.cancelScheduledScript('exec-1', 'user-1')
      expect(result).toBe(true)
    })

    it('throws when execution not found', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue(null)

      await expect(
        scheduler.cancelScheduledScript('nonexistent', 'user-1'),
      ).rejects.toThrow('not found')
    })

    it('throws when execution status cannot be cancelled', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        status: ExecutionStatus.SUCCESS,
      } as any)

      await expect(
        scheduler.cancelScheduledScript('exec-1', 'user-1'),
      ).rejects.toThrow('Cannot cancel')
    })
  })

  // ─── hasActiveSchedules ────────────────────────────────────────────────

  describe('hasActiveSchedules', () => {
    it('returns count and affected VMs', async () => {
      mockPrisma.scriptExecution.findMany.mockResolvedValue([
        { scriptId: 's1', machine: { id: 'vm-1', name: 'VM1' } },
        { scriptId: 's1', machine: { id: 'vm-2', name: 'VM2' } },
      ] as any)

      const result = await scheduler.hasActiveSchedules('s1')

      expect(result.count).toBe(2)
      expect(result.affectedVMs).toHaveLength(2)
    })

    it('returns empty when no active schedules', async () => {
      mockPrisma.scriptExecution.findMany.mockResolvedValue([])

      const result = await scheduler.hasActiveSchedules('s1')

      expect(result.count).toBe(0)
      expect(result.affectedVMs).toEqual([])
    })

    it('deduplicates VMs', async () => {
      mockPrisma.scriptExecution.findMany.mockResolvedValue([
        { scriptId: 's1', machine: { id: 'vm-1', name: 'VM1' } },
        { scriptId: 's1', machine: { id: 'vm-1', name: 'VM1' } },
      ] as any)

      const result = await scheduler.hasActiveSchedules('s1')

      expect(result.count).toBe(2)
      expect(result.affectedVMs).toHaveLength(1) // deduplicated
    })
  })
})
