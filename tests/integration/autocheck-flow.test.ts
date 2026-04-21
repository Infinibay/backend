import 'reflect-metadata'
import { Server } from 'socket.io'
import { createServer, Server as HTTPServer } from 'http'
import { AddressInfo } from 'net'
import { VirtioSocketWatcherService } from '../../app/services/VirtioSocketWatcherService'
import { VmEventManager } from '../../app/services/VmEventManager'
import { EventManager, createEventManager } from '../../app/services/EventManager'
import { SocketService, createSocketService } from '../../app/services/SocketService'
import { BackgroundHealthService } from '../../app/services/BackgroundHealthService'
import { VMHealthQueueManager } from '../../app/services/VMHealthQueueManager'
import { RUNNING_STATUS, STOPPED_STATUS } from '../../app/constants/machine-status'
import { testPrisma } from '../setup/jest.setup'
import {
  createUser,
  createAdmin,
  createDepartment,
  createMachine
} from '../setup/db-factories'
import logger from '@main/logger'

/**
 * Auto-check end-to-end integration.
 *
 * Covers the path from health-check detection through event dispatch. The DB
 * is real; Socket.IO is real but we spy on `sendToUser` to assert on delivery.
 * VMRecommendationService timers are captured by fake-timers when we need to
 * instantiate services that construct it transitively — otherwise Jest can't
 * exit.
 */
describe('Auto-check end-to-end integration — real database', () => {
  const prisma = testPrisma.prisma

  let virtioService: VirtioSocketWatcherService
  let vmEventManager: VmEventManager
  let eventManager: EventManager
  let socketService: SocketService
  let httpServer: HTTPServer
  let ioServer: Server

  beforeAll(() => {
    httpServer = createServer()
    httpServer.listen()
    const port = (httpServer.address() as AddressInfo).port
    void port

    ioServer = new Server(httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    })
    socketService = createSocketService(prisma)
    socketService.initialize(httpServer)
  })

  afterAll(() => {
    // socket.io's Server is mocked globally in jest.setup; nothing to close on ioServer.
    httpServer?.close()
  })

  // These IDs are referenced by hard-coded strings across the tests; seeding
  // with explicit IDs keeps the test bodies readable.
  const OWNER_ID = 'test-user-id'
  const ADMIN_ID = 'admin-user-id'
  const DEPT_ID = 'test-dept-id'
  const VM_ID = 'test-vm-id'

  beforeEach(async () => {
    eventManager = createEventManager(socketService, prisma)
    vmEventManager = new VmEventManager(socketService, prisma)
    virtioService = new VirtioSocketWatcherService(prisma as any)

    eventManager.registerResourceManager('vms', vmEventManager)
    virtioService.initialize(vmEventManager)

    await createUser(prisma, { id: OWNER_ID, email: `${OWNER_ID}@test.infinibay` })
    await createAdmin(prisma, { id: ADMIN_ID, email: `${ADMIN_ID}@test.infinibay` })
    await createDepartment(prisma, { id: DEPT_ID, name: 'AutoCheckDept' })
    await createMachine(prisma, {
      userId: OWNER_ID,
      departmentId: DEPT_ID,
      overrides: { id: VM_ID, name: 'integration-test-vm', status: RUNNING_STATUS, os: 'windows' }
    })
  })

  describe('VmEventManager event dispatch', () => {
    it('dispatches issue-detected + remediation-available + remediation-completed events', async () => {
      const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn())

      await vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
        checkType: 'WindowsUpdates',
        severity: 'critical',
        description: '2 critical Windows updates are pending',
        details: { criticalUpdates: 2 }
      })
      await vmEventManager.handleAutoCheckRemediationAvailable(VM_ID, {
        checkType: 'WindowsUpdates',
        remediationType: 'AutoFixWindowsUpdates',
        description: 'Auto install',
        isAutomatic: true,
        estimatedTime: '15m',
        details: {}
      })
      await vmEventManager.handleAutoCheckRemediationCompleted(VM_ID, {
        checkType: 'WindowsUpdates',
        remediationType: 'AutoFixWindowsUpdates',
        success: true,
        description: 'done',
        executionTime: '1s',
        details: {}
      })

      expect(spy).toHaveBeenCalledWith(
        OWNER_ID, 'autocheck', 'issue-detected',
        expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, issueType: 'WindowsUpdates' }) })
      )
      expect(spy).toHaveBeenCalledWith(
        OWNER_ID, 'autocheck', 'remediation-available',
        expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, isAutomatic: true }) })
      )
      expect(spy).toHaveBeenCalledWith(
        OWNER_ID, 'autocheck', 'remediation-completed',
        expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, success: true }) })
      )
    })

    it('dispatches a disk-space issue-detected event', async () => {
      const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn())

      await vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
        checkType: 'DiskSpace',
        severity: 'critical',
        description: 'Drive C: is critically low on space',
        details: { drive: 'C:', usedPercent: 95 }
      })

      expect(spy).toHaveBeenCalledWith(
        OWNER_ID, 'autocheck', 'issue-detected',
        expect.objectContaining({ data: expect.objectContaining({ vmId: VM_ID, issueType: 'DiskSpace' }) })
      )
    })

    it('dispatches a Windows Defender issue-detected event', async () => {
      const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn())

      await vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
        checkType: 'WindowsDefender',
        severity: 'critical',
        description: 'Windows Defender is disabled',
        details: { antivirusEnabled: false }
      })

      expect(spy).toHaveBeenCalledWith(
        OWNER_ID, 'autocheck', 'issue-detected',
        expect.objectContaining({ data: expect.objectContaining({ issueType: 'WindowsDefender' }) })
      )
    })

    it('still dispatches notifications for stopped VMs (status filter is upstream)', async () => {
      const STOPPED_ID = 'stopped-vm-id'
      await createMachine(prisma, {
        userId: OWNER_ID,
        departmentId: DEPT_ID,
        overrides: { id: STOPPED_ID, status: STOPPED_STATUS, name: 'stopped-vm' }
      })

      const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn())
      await vmEventManager.handleAutoCheckIssueDetected(STOPPED_ID, {
        checkType: 'HealthCheck', severity: 'warning', description: 'test', details: {}
      })

      expect(spy).toHaveBeenCalled()
    })
  })

  describe('BackgroundHealthService — VM status filtering', () => {
    async function buildBackgroundHealthService (opts: {
      queueManager?: any
      eventManager?: any
    } = {}) {
      const mockBackgroundTaskService = {
        queueTask: jest.fn().mockImplementation(async (_n: string, fn: () => Promise<void>) => {
          await fn()
          return 'task-123'
        })
      }
      const mockEventManager = opts.eventManager ?? { dispatchEvent: jest.fn() }
      const mockQueueManager = opts.queueManager ?? { queueHealthChecks: jest.fn().mockResolvedValue(undefined) }

      // Fake timers swallow the setInterval/setTimeout that
      // VMRecommendationService schedules when constructed transitively.
      jest.useFakeTimers({ advanceTimers: false })
      const service = new BackgroundHealthService(
        prisma as any,
        mockBackgroundTaskService as any,
        mockEventManager as any,
        mockQueueManager as any
      )
      jest.useRealTimers()

      return { service, mockEventManager, mockQueueManager, mockBackgroundTaskService }
    }

    it('queues health checks only for running VMs, ignoring stopped/paused', async () => {
      // Seed extra VMs with mixed statuses.
      await createMachine(prisma, {
        userId: OWNER_ID,
        departmentId: DEPT_ID,
        overrides: { status: STOPPED_STATUS, name: 'stopped' }
      })
      await createMachine(prisma, {
        userId: OWNER_ID,
        departmentId: DEPT_ID,
        overrides: { status: RUNNING_STATUS, name: 'running-extra' }
      })

      const { service, mockQueueManager, mockEventManager } = await buildBackgroundHealthService()
      await service.executeHealthCheckRound()

      // Exactly two running VMs exist (VM_ID + running-extra). queueHealthChecks
      // should be called once per each, and never for the stopped one.
      expect(mockQueueManager.queueHealthChecks).toHaveBeenCalledTimes(2)
      const queuedIds = mockQueueManager.queueHealthChecks.mock.calls.map((c: any) => c[0])
      expect(queuedIds).toContain(VM_ID)

      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'health', 'round_started',
        expect.objectContaining({ vmCount: 2 })
      )
      expect(mockEventManager.dispatchEvent).toHaveBeenCalledWith(
        'health', 'round_completed',
        expect.objectContaining({ totalVMs: 2, successCount: 2, failureCount: 0 })
      )
    })
  })

  describe('VMHealthQueueManager — stopped-VM short-circuit', () => {
    it('skips queueing and does not write when the VM is stopped', async () => {
      const STOPPED_ID = 'stopped-queue-vm'
      await createMachine(prisma, {
        userId: OWNER_ID,
        departmentId: DEPT_ID,
        overrides: { id: STOPPED_ID, status: STOPPED_STATUS, name: 'stopped-queue-vm' }
      })

      const mockEventManager = { dispatchEvent: jest.fn() }
      jest.useFakeTimers({ advanceTimers: false })
      const queueManager = new VMHealthQueueManager(prisma as any, mockEventManager as any)
      jest.useRealTimers()

      const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined as any)

      await queueManager.queueHealthChecks(STOPPED_ID)

      expect(await prisma.vMHealthCheckQueue.count({ where: { machineId: STOPPED_ID } })).toBe(0)
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("Skipping health checks for VM stopped-queue-vm")
      )
      infoSpy.mockRestore()
    })
  })

  describe('Multi-user event distribution', () => {
    it('delivers auto-check events to the VM owner and every admin', async () => {
      // Seed a second admin so we can count recipients deterministically.
      await createAdmin(prisma, {
        id: 'admin-second',
        email: 'admin-second@test.infinibay'
      })

      const spy = jest.spyOn(socketService, 'sendToUser').mockImplementation(jest.fn())

      await vmEventManager.handleAutoCheckIssueDetected(VM_ID, {
        checkType: 'HealthCheck',
        severity: 'warning',
        description: 'System health check detected warning issues',
        details: { overall_health: 'Warning' }
      })

      const recipients = new Set(spy.mock.calls.map(c => c[0]))
      expect(recipients.has(OWNER_ID)).toBe(true)
      expect(recipients.has(ADMIN_ID)).toBe(true)
      expect(recipients.has('admin-second')).toBe(true)
    })
  })
})
