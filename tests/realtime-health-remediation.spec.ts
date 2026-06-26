import { EventEmitter } from 'events'
import { PrismaClient } from '@prisma/client'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'

import { MetricsHandler } from '@services/socket-watcher/MetricsHandler'
import { VmEventManager } from '@services/VmEventManager'

// The shared jest.setup.ts mocks '@services/EventManager' globally (so resolvers
// under test get a no-op dispatcher). The error-isolation test below needs the
// REAL dispatch implementation, so we pull it via requireActual.
const { EventManager: RealEventManager } = jest.requireActual('@services/EventManager') as {
  EventManager: typeof import('@services/EventManager').EventManager
}

/**
 * Real-time health + remediation wiring.
 *
 * No DB, no real socket: prisma, socketService and the EventManagers are
 * mocked. We exercise three contracts:
 *   1. MetricsHandler health baseline-dedup (no toast spam; emit on real
 *      transitions only).
 *   2. VmEventManager.handleEvent remediation routing → wire resource
 *      'remediation' with the de-prefixed/hyphenated action.
 *   3. Error isolation: an emit failure must never abort/throw out of the
 *      core processing path.
 */

type MockSocketService = {
  sendToUser: jest.Mock
}

/** Minimal winston-shaped logger stub (MetricsHandler injects `debug`). */
const makeLoggerStub = () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
})

// A health-check command that routes through analyzeHealthCheckResponse.
const makeHealthResponse = () => ({
  command_type: 'RunHealthCheck',
  success: true,
  id: 'resp-1'
})

const makeHealthData = (overall: string, checks: unknown[]) => ({
  overall_health: overall,
  checks
})

describe('Real-time health + remediation wiring', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // 1. MetricsHandler — health_status:change baseline dedup
  // ──────────────────────────────────────────────────────────────────────────
  describe('MetricsHandler health baseline-dedup', () => {
    const vmId = 'vm-1'
    const checks = [{ name: 'cpu', status: 'ok' }]

    let handleHealthStatusChange: jest.Mock
    let handleAutoCheckIssueDetected: jest.Mock
    let handler: MetricsHandler

    beforeEach(() => {
      handleHealthStatusChange = jest.fn()
      // Critical/Warning verdicts also fan out an auto-check issue; stub it so
      // the path resolves cleanly and we can isolate the health_status emit.
      handleAutoCheckIssueDetected = jest.fn().mockResolvedValue(undefined)

      const vmEventManager = {
        handleHealthStatusChange,
        handleAutoCheckIssueDetected
      }

      handler = new MetricsHandler({
        debug: makeLoggerStub() as any,
        prisma: {} as any,
        getVmEventManager: () => vmEventManager as any,
        emitter: new EventEmitter()
      })
    })

    it('does NOT emit on the first sighting (establishes a silent baseline)', async () => {
      await handler.handleAutoCheckResponse(
        vmId,
        makeHealthResponse() as any,
        makeHealthData('Healthy', checks) as any
      )

      expect(handleHealthStatusChange).not.toHaveBeenCalled()
    })

    it('does NOT emit when the same overall_health repeats (idempotent)', async () => {
      // First sighting → baseline.
      await handler.handleAutoCheckResponse(
        vmId,
        makeHealthResponse() as any,
        makeHealthData('Healthy', checks) as any
      )
      // Same verdict again → no transition, no emit.
      await handler.handleAutoCheckResponse(
        vmId,
        makeHealthResponse() as any,
        makeHealthData('Healthy', checks) as any
      )

      expect(handleHealthStatusChange).not.toHaveBeenCalled()
    })

    it('emits exactly once on a real transition with the lowercased status + checks', async () => {
      // Baseline: Healthy.
      await handler.handleAutoCheckResponse(
        vmId,
        makeHealthResponse() as any,
        makeHealthData('Healthy', checks) as any
      )
      // Transition: Healthy → Warning.
      await handler.handleAutoCheckResponse(
        vmId,
        makeHealthResponse() as any,
        makeHealthData('Warning', checks) as any
      )

      expect(handleHealthStatusChange).toHaveBeenCalledTimes(1)
      expect(handleHealthStatusChange).toHaveBeenCalledWith(vmId, 'warning', checks)
    })

    it('does not emit again once the new status becomes the baseline', async () => {
      await handler.handleAutoCheckResponse(vmId, makeHealthResponse() as any, makeHealthData('Healthy', checks) as any)
      await handler.handleAutoCheckResponse(vmId, makeHealthResponse() as any, makeHealthData('Critical', checks) as any)
      await handler.handleAutoCheckResponse(vmId, makeHealthResponse() as any, makeHealthData('Critical', checks) as any)

      // One transition (healthy → critical) only.
      expect(handleHealthStatusChange).toHaveBeenCalledTimes(1)
      expect(handleHealthStatusChange).toHaveBeenCalledWith(vmId, 'critical', checks)
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 2. VmEventManager — remediation lifecycle routing
  // ──────────────────────────────────────────────────────────────────────────
  describe('VmEventManager.handleEvent remediation routing', () => {
    let mockSocketService: MockSocketService
    let mockPrisma: DeepMockProxy<PrismaClient>
    let vmEventManager: VmEventManager

    beforeEach(() => {
      mockSocketService = { sendToUser: jest.fn() }
      mockPrisma = mockDeep<PrismaClient>()
      vmEventManager = new VmEventManager(mockSocketService as any, mockPrisma)

      // VM with an owner, no department → target users = { owner }.
      mockPrisma.machine.findUnique.mockResolvedValue({
        id: 'vm1',
        name: 'VM One',
        userId: 'owner-1',
        departmentId: null
      } as any)
      // No admins.
      mockPrisma.user.findMany.mockResolvedValue([] as any)
    })

    it("routes 'remediation_succeeded' to the wire action 'succeeded' on resource 'remediation'", async () => {
      await vmEventManager.handleEvent(
        'remediation_succeeded',
        { id: 'vm1', result: { description: 'Cleared temp files' } } as any,
        'actor-1'
      )

      expect(mockSocketService.sendToUser).toHaveBeenCalledTimes(1)
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'owner-1',
        'remediation',
        'succeeded',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({
            vmId: 'vm1',
            actionType: 'succeeded',
            result: { description: 'Cleared temp files' },
            triggeredBy: 'actor-1'
          })
        })
      )
    })

    it("maps 'remediation_requires_reboot' to the hyphenated wire action 'requires-reboot'", async () => {
      await vmEventManager.handleEvent(
        'remediation_requires_reboot',
        { id: 'vm1', result: { description: 'Reboot required' } } as any
      )

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'owner-1',
        'remediation',
        'requires-reboot',
        expect.objectContaining({
          status: 'success',
          data: expect.objectContaining({ actionType: 'requires-reboot' })
        })
      )
    })

    it("routes 'remediation_started' / 'remediation_failed' / 'remediation_cancelled' to their wire actions", async () => {
      const cases: Array<[string, string]> = [
        ['remediation_started', 'started'],
        ['remediation_failed', 'failed'],
        ['remediation_cancelled', 'cancelled']
      ]

      for (const [action, wire] of cases) {
        mockSocketService.sendToUser.mockClear()
        await vmEventManager.handleEvent(action as any, { id: 'vm1', result: {} } as any)
        expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
          'owner-1',
          'remediation',
          wire,
          expect.objectContaining({ status: 'success' })
        )
      }
    })

    it('defaults result to an empty object when none is supplied (no crash)', async () => {
      await vmEventManager.handleEvent('remediation_succeeded', { id: 'vm1' } as any)

      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'owner-1',
        'remediation',
        'succeeded',
        expect.objectContaining({
          data: expect.objectContaining({ result: {} })
        })
      )
    })
  })

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Error isolation — an emit failure must not abort the caller
  // ──────────────────────────────────────────────────────────────────────────
  describe('Error isolation', () => {
    it('MetricsHandler: a throwing health emit does not reject handleAutoCheckResponse', async () => {
      const vmId = 'vm-err'
      const checks = [{ name: 'disk', status: 'low' }]

      const handleHealthStatusChange = jest.fn(() => {
        throw new Error('socket transport down')
      })
      const vmEventManager = {
        handleHealthStatusChange,
        handleAutoCheckIssueDetected: jest.fn().mockResolvedValue(undefined)
      }

      const handler = new MetricsHandler({
        debug: makeLoggerStub() as any,
        prisma: {} as any,
        getVmEventManager: () => vmEventManager as any,
        emitter: new EventEmitter()
      })

      // Baseline (Healthy), then transition (Critical) which triggers the
      // throwing emit. The processing path must swallow it.
      await handler.handleAutoCheckResponse(vmId, makeHealthResponse() as any, makeHealthData('Healthy', checks) as any)

      await expect(
        handler.handleAutoCheckResponse(vmId, makeHealthResponse() as any, makeHealthData('Critical', checks) as any)
      ).resolves.not.toThrow()

      // The emit was attempted (and failed) — proving we hit the isolated path.
      expect(handleHealthStatusChange).toHaveBeenCalledTimes(1)
    })

    it('EventManager.dispatchEvent: a throwing remediation handler does not reject the dispatch', async () => {
      const mockSocketService: MockSocketService = { sendToUser: jest.fn() }
      const mockPrisma = mockDeep<PrismaClient>()

      const vmEventManager = new VmEventManager(mockSocketService as any, mockPrisma)
      const eventManager = new RealEventManager(mockSocketService as any, mockPrisma)
      eventManager.registerResourceManager('vms', vmEventManager)

      // Force the emit path to throw deep inside handleRemediationEvent.
      mockPrisma.machine.findUnique.mockRejectedValue(new Error('db unavailable'))

      await expect(
        eventManager.dispatchEvent(
          'vms',
          'remediation_failed',
          { id: 'vm1', result: { description: 'x' } },
          'actor-1'
        )
      ).resolves.not.toThrow()

      // dispatchEvent's isolation surfaces a structured error to the actor
      // rather than rethrowing.
      expect(mockSocketService.sendToUser).toHaveBeenCalledWith(
        'actor-1',
        'vms',
        'remediation_failed',
        expect.objectContaining({ status: 'error' })
      )
    })
  })
})
