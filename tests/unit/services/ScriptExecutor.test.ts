/**
 * Unit tests for ScriptExecutor.
 *
 * Uses jest.mock() for ScriptManager, TemplateEngine, ScriptParser,
 * VirtioSocketWatcherService, and SocketService. PrismaClient is mocked
 * with jest-mock-extended.
 */

import { ScriptExecutor, ExecuteScriptOptions } from '../../../app/services/scripts/ScriptExecutor'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient, ExecutionType, ExecutionStatus, ShellType } from '@prisma/client'
import { CommandResponse } from '../../../app/services/VirtioSocketWatcherService'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockGetScript = jest.fn()
const mockValidateRequiredInputs = jest.fn()
const mockValidateInputValue = jest.fn()
const mockInterpolate = jest.fn()
const mockSanitizeForLogging = jest.fn().mockReturnValue({})

jest.mock('../../../app/services/scripts/ScriptManager', () => ({
  ScriptManager: jest.fn().mockImplementation(() => ({
    getScript: mockGetScript,
  })),
}))

jest.mock('../../../app/services/scripts/TemplateEngine', () => ({
  TemplateEngine: jest.fn().mockImplementation(() => ({
    validateRequiredInputs: mockValidateRequiredInputs,
    interpolate: mockInterpolate,
    sanitizeForLogging: mockSanitizeForLogging,
  })),
}))

jest.mock('../../../app/services/scripts/ScriptParser', () => ({
  ScriptParser: jest.fn().mockImplementation(() => ({
    validateInputValue: mockValidateInputValue,
  })),
}))

const mockSendSafeCommand = jest.fn<Promise<CommandResponse>, [string, any, number]>()
const mockSendUnsafeCommand = jest.fn<Promise<CommandResponse>, [string, string, any, number]>()

jest.mock('../../../app/services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: () => ({
    sendSafeCommand: mockSendSafeCommand,
    sendUnsafeCommand: mockSendUnsafeCommand,
  }),
}))

const mockSendToUser = jest.fn()

jest.mock('../../../app/services/SocketService', () => ({
  getSocketService: () => ({
    sendToUser: mockSendToUser,
  }),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeScript(overrides?: any) {
  return {
    id: 'script-1',
    name: 'Test Script',
    scriptBody: 'echo {{message}}',
    os: [],
    parsedInputs: [{ name: 'message', type: 'text', required: true }],
    shell: ShellType.BASH,
    ...overrides,
  }
}

function makeMachine(overrides?: any) {
  return {
    id: 'vm-1',
    name: 'TestVM',
    os: 'ubuntu-22.04',
    user: { id: 'user-1', name: 'Admin' },
    ...overrides,
  }
}

function makeOptions(overrides?: Partial<ExecuteScriptOptions>): ExecuteScriptOptions {
  return {
    scriptId: 'script-1',
    machineId: 'vm-1',
    inputValues: { message: 'hello' },
    executionType: ExecutionType.ON_DEMAND,
    triggeredById: 'user-1',
    ...overrides,
  }
}

function makeCommandResponse(overrides?: Partial<CommandResponse>): CommandResponse {
  return {
    id: 'cmd-1',
    success: true,
    exit_code: 0,
    stdout: 'hello\n',
    stderr: '',
    execution_time_ms: 500,
    command_type: 'safe',
    ...overrides,
  }
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('ScriptExecutor', () => {
  let executor: ScriptExecutor
  let mockPrisma: ReturnType<typeof mockDeep<PrismaClient>>

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = mockDeep<PrismaClient>()

    mockGetScript.mockResolvedValue(makeScript())
    mockValidateRequiredInputs.mockReturnValue(undefined)
    mockValidateInputValue.mockReturnValue(undefined)
    mockInterpolate.mockReturnValue('echo hello')
    mockSanitizeForLogging.mockReturnValue({ message: 'hello' })

    mockPrisma.machine.findUnique.mockResolvedValue(makeMachine() as any)
    mockPrisma.scriptExecution.create.mockResolvedValue({
      id: 'exec-1',
      scriptId: 'script-1',
      machineId: 'vm-1',
    } as any)
    mockPrisma.scriptExecution.update.mockResolvedValue({} as any)
    mockPrisma.scriptAuditLog.create.mockResolvedValue({} as any)
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }] as any)

    mockSendUnsafeCommand.mockResolvedValue(makeCommandResponse())
    mockSendSafeCommand.mockResolvedValue(makeCommandResponse())

    executor = new ScriptExecutor(mockPrisma as any)
  })

  // ─── executeScript - success ───────────────────────────────────────────

  describe('executeScript - success', () => {
    it('executes a script on a Linux VM successfully', async () => {
      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(true)
      expect(result.executionId).toBe('exec-1')

      expect(mockGetScript).toHaveBeenCalledWith('script-1')
      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'vm-1' } }),
      )
      expect(mockValidateRequiredInputs).toHaveBeenCalled()

      const createCall = mockPrisma.scriptExecution.create.mock.calls[0][0]
      expect(createCall.data.status).toBe(ExecutionStatus.PENDING)

      expect(mockInterpolate).toHaveBeenCalledWith('echo {{message}}', { message: 'hello' })
      expect(mockSendUnsafeCommand).toHaveBeenCalled()

      const updateCalls = mockPrisma.scriptExecution.update.mock.calls
      const successUpdate = updateCalls.find(
        (c: any) => c[0]?.data?.status === ExecutionStatus.SUCCESS,
      )
      expect(successUpdate).toBeDefined()
      expect(successUpdate![0].data.stdout).toBe('hello\n')
    })

    it('uses safe command for Windows PowerShell with admin elevation', async () => {
      // Override script to have PowerShell shell for this test
      mockGetScript.mockResolvedValue(makeScript({ shell: ShellType.POWERSHELL }))
      mockPrisma.machine.findUnique.mockResolvedValue(
        makeMachine({ os: 'windows11' }) as any,
      )
      const response = makeCommandResponse()
      mockSendSafeCommand.mockResolvedValue(response)

      const result = await executor.executeScript(makeOptions({
        runAs: 'administrator',
      }))

      expect(result.success).toBe(true)
      expect(mockSendSafeCommand).toHaveBeenCalledWith(
        'vm-1',
        expect.objectContaining({
          action: 'ExecutePowerShellScript',
        }),
        expect.any(Number),
      )
    })

    it('creates audit log with sanitized passwords', async () => {
      await executor.executeScript(makeOptions({
        inputValues: { username: 'admin', password: 'secret' },
      }))

      const auditCall = mockPrisma.scriptAuditLog.create.mock.calls[0][0] as any
      expect(auditCall.data.details.inputValues.password).toBe('***REDACTED***')
    })

    it('emits socket events to relevant users', async () => {
      await executor.executeScript(makeOptions())
      expect(mockSendToUser).toHaveBeenCalled()
    })
  })

  // ─── executeScript - validation errors ─────────────────────────────────

  describe('executeScript - validation errors', () => {
    it('returns error when script not found', async () => {
      mockGetScript.mockResolvedValue(null)

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('returns error when machine not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null)

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Machine')
    })

    it('returns error for OS incompatibility', async () => {
      mockGetScript.mockResolvedValue(makeScript({ os: ['LINUX'] }))
      mockPrisma.machine.findUnique.mockResolvedValue(
        makeMachine({ os: 'windows11' }) as any,
      )

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.error).toContain('not compatible')
    })

    it('returns error for unsupported OS type', async () => {
      mockGetScript.mockResolvedValue(makeScript({ os: ['LINUX'] }))
      mockPrisma.machine.findUnique.mockResolvedValue(
        makeMachine({ os: 'haiku' }) as any,
      )

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.error).toContain('unsupported OS')
    })
  })

  // ─── executeScript - execution failures ────────────────────────────────

  describe('executeScript - execution failures', () => {
    it('handles command failure response', async () => {
      mockSendUnsafeCommand.mockResolvedValue(
        makeCommandResponse({
          success: false,
          exit_code: 1,
          stderr: 'command not found',
          error: 'Script failed',
        }),
      )

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.error).toBe('Script failed')

      const updateCalls = mockPrisma.scriptExecution.update.mock.calls
      const failUpdate = updateCalls.find(
        (c: any) => c[0]?.data?.status === ExecutionStatus.FAILED,
      )
      expect(failUpdate).toBeDefined()
    })

    it('handles timeout errors', async () => {
      mockSendUnsafeCommand.mockRejectedValue(new Error('Command timeout after 600000ms'))

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')

      const updateCalls = mockPrisma.scriptExecution.update.mock.calls
      const timeoutUpdate = updateCalls.find(
        (c: any) => c[0]?.data?.status === ExecutionStatus.TIMEOUT,
      )
      expect(timeoutUpdate).toBeDefined()
    })

    it('handles unexpected errors and marks execution as failed', async () => {
      mockSendUnsafeCommand.mockRejectedValue(new Error('Socket disconnected'))

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.error).toContain('Socket disconnected')

      const calls = mockPrisma.scriptExecution.update.mock.calls
      const lastUpdate = calls[calls.length - 1]
      expect(lastUpdate[0].data.status).toBe(ExecutionStatus.FAILED)
    })

    it('returns empty executionId when error occurs before record creation', async () => {
      mockGetScript.mockImplementation(() => {
        throw new Error('DB connection lost')
      })

      const result = await executor.executeScript(makeOptions())

      expect(result.success).toBe(false)
      expect(result.executionId).toBe('')
    })
  })

  // ─── cancelScriptExecution ─────────────────────────────────────────────

  describe('cancelScriptExecution', () => {
    it('cancels a pending execution', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        scriptId: 'script-1',
        machineId: 'vm-1',
        status: ExecutionStatus.PENDING,
        machine: { id: 'vm-1' },
      } as any)
      mockPrisma.scriptExecution.update.mockResolvedValue({} as any)

      const result = await executor.cancelScriptExecution('exec-1')

      expect(result).toBe(true)
      expect(mockPrisma.scriptExecution.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1' },
          data: {
            status: ExecutionStatus.CANCELLED,
            completedAt: expect.any(Date),
            error: 'Execution cancelled by user',
          },
        }),
      )
    })

    it('cancels a running execution', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        scriptId: 'script-1',
        machineId: 'vm-1',
        status: ExecutionStatus.RUNNING,
        machine: { id: 'vm-1' },
      } as any)
      mockPrisma.scriptExecution.update.mockResolvedValue({} as any)

      const result = await executor.cancelScriptExecution('exec-1')
      expect(result).toBe(true)
    })

    it('throws when execution not found', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue(null)

      await expect(
        executor.cancelScriptExecution('nonexistent'),
      ).rejects.toThrow('not found')
    })

    it('throws when execution cannot be cancelled', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue({
        id: 'exec-1',
        status: ExecutionStatus.SUCCESS,
        machine: { id: 'vm-1' },
      } as any)

      await expect(
        executor.cancelScriptExecution('exec-1'),
      ).rejects.toThrow('Cannot cancel')
    })
  })

  // ─── getExecutionStatus ────────────────────────────────────────────────

  describe('getExecutionStatus', () => {
    it('returns execution with relations', async () => {
      const execution = {
        id: 'exec-1',
        scriptId: 'script-1',
        machineId: 'vm-1',
        script: { id: 'script-1', name: 'Test' },
        machine: { id: 'vm-1', name: 'VM1' },
        triggeredBy: { id: 'user-1', name: 'Admin' },
      }
      mockPrisma.scriptExecution.findUnique.mockResolvedValue(execution as any)

      const result = await executor.getExecutionStatus('exec-1')

      expect(result.id).toBe('exec-1')
      expect(mockPrisma.scriptExecution.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'exec-1' },
          include: { script: true, machine: true, triggeredBy: true },
        }),
      )
    })

    it('throws when execution not found', async () => {
      mockPrisma.scriptExecution.findUnique.mockResolvedValue(null)

      await expect(
        executor.getExecutionStatus('nonexistent'),
      ).rejects.toThrow('not found')
    })
  })
})
