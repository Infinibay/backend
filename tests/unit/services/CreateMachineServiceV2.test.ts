/**
 * Unit tests for CreateMachineServiceV2.
 *
 * This service has many internal dependencies (fs, portfinder, systeminformation,
 * infinization, unattended managers, DepartmentNetworkService), so we use
 * jest.mock() extensively to isolate the logic.
 */

import { CreateMachineServiceV2 } from '../../../app/services/CreateMachineServiceV2'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient, Machine } from '@prisma/client'

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockInfinization = {
  createVM: jest.fn(),
  getVMStatus: jest.fn(),
  stopVM: jest.fn(),
}

jest.mock('../../../app/services/InfinizationService', () => ({
  getInfinization: jest.fn(() => Promise.resolve(mockInfinization)),
  getInfinizationConfig: jest.fn(() => ({ diskDir: '/var/lib/infinization/disks' })),
}))

jest.mock('../../../app/services/network/DepartmentNetworkService', () => ({
  DepartmentNetworkService: jest.fn().mockImplementation(() => ({
    getBridgeForDepartment: jest.fn().mockResolvedValue('br-test'),
  })),
}))

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn().mockReturnValue(false),
  readdirSync: jest.fn().mockReturnValue([]),
  promises: {
    ...jest.requireActual('fs').promises,
    unlink: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('portfinder', () => ({
  basePort: 5900,
  getPortPromise: jest.fn().mockResolvedValue(5900),
}))

jest.mock('systeminformation', () => ({
  graphics: jest.fn().mockResolvedValue({ controllers: [] }),
}))

jest.mock('../../../app/services/unattendedWindowsManager', () => ({
  UnattendedWindowsManager: jest.fn().mockImplementation(() => ({
    isoPath: '',
    init: jest.fn(),
    generateNewImage: jest.fn().mockResolvedValue('/tmp/test-unattended.iso'),
  })),
}))

jest.mock('../../../app/services/unattendedUbuntuManager', () => ({
  UnattendedUbuntuManager: jest.fn().mockImplementation(() => ({
    isoPath: '',
    generateNewImage: jest.fn().mockResolvedValue('/tmp/test-unattended.iso'),
  })),
}))

jest.mock('../../../app/services/unattendedRedHatManager', () => ({
  UnattendedRedHatManager: jest.fn().mockImplementation(() => ({
    isoPath: '',
    generateNewImage: jest.fn().mockResolvedValue('/tmp/test-unattended.iso'),
  })),
}))

jest.mock('../../../app/services/unattendedManagerBase', () => ({
  UnattendedManagerBase: jest.fn().mockImplementation(() => ({})),
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMachine(overrides?: Partial<Machine>): Machine {
  const machine = {
    id: 'vm-1',
    name: 'TestVM',
    internalName: 'vm-test-1',
    status: 'stopped',
    userId: null,
    templateId: 'tpl-1',
    os: 'ubuntu-22.04',
    cpuCores: 4,
    ramGB: 8,
    diskSizeGB: 100,
    gpuPciAddress: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    departmentId: 'dept-1',
    localIP: null,
    publicIP: null,
    firewallRuleSetId: null,
    version: 1,
    poolId: null,
    nodeId: null,
    ...overrides,
  }

  return {
    ...machine,
    nodeId: machine.nodeId ?? null,
  }
}

function makeTemplate() {
  return {
    id: 'tpl-1',
    name: 'Ubuntu Template',
    os: 'ubuntu-22.04',
    cores: 4,
    ram: 8,
    storage: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
    departmentId: 'dept-1',
    categoryId: null,
    description: 'Test template',
    icon: null,
  }
}

function makeConfiguration() {
  return {
    id: 'cfg-1',
    machineId: 'vm-1',
    xml: { domain: { name: 'test-vm' } },
    graphicProtocol: null,
    graphicPort: null,
    graphicPassword: null,
    graphicHost: null,
    assignedGpuBus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    qmpSocketPath: null,
    qemuPid: null,
    tapDeviceName: null,
    bridge: 'virbr0',
    networkModel: 'virtio-net-pci',
    networkQueues: 1,
    machineType: 'q35',
    cpuModel: 'host',
    diskBus: 'virtio',
    diskCacheMode: 'writeback',
    ioThreads: false,
    diskPaths: null,
    gpuRomFile: null,
    gpuAudioBus: null,
    memoryBalloon: false,
    hugepages: false,
    numaConfig: null,
    cpuPinning: null,
    enableNumaCtlPinning: false,
    cpuPinningStrategy: 'basic',
    uefiFirmware: null,
    secureboot: false,
    tpmSocketPath: null,
    guestAgentSocketPath: null,
    infiniServiceSocketPath: null,
    virtioDriversIso: null,
    enableAudio: false,
    enableUsbTablet: true,
    setupComplete: false,
  }
}

function makeCreateResult() {
  return {
    success: true,
    vmId: 'vm-1',
    displayPort: 5900,
    displayPassword: undefined,
    diskPaths: ['/var/lib/infinibay/disks/vm-1-disk0.qcow2'],
    tapDevice: 'tap0',
    pid: 12345,
    qmpSocketPath: '/opt/infinibay/sockets/vm-test-1-qmp.sock',
  }
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('CreateMachineServiceV2', () => {
  let service: CreateMachineServiceV2
  let mockPrisma: ReturnType<typeof mockDeep<PrismaClient>>

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = mockDeep<PrismaClient>()
    service = new CreateMachineServiceV2(mockPrisma as any)
  })

  // ─── validatePreconditions (via create) ────────────────────────────────

  describe('validatePreconditions', () => {
    it('throws if machine has no department assigned', async () => {
      const machine = makeMachine({ departmentId: null })
      await expect(
        service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York'),
      ).rejects.toThrow('has no department assigned')
    })
  })

  // ─── fetchMachineTemplate (via create) ─────────────────────────────────

  describe('fetchMachineTemplate', () => {
    it('throws if template not found in database', async () => {
      const machine = makeMachine()
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null as any)
      mockPrisma.machineConfiguration.findUnique.mockResolvedValue(makeConfiguration() as any)
      mockPrisma.machineApplication.findMany.mockResolvedValue([] as any)
      mockPrisma.scriptExecution.findMany.mockResolvedValue([] as any)

      await expect(
        service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York'),
      ).rejects.toThrow('Template not found')
    })
  })

  describe('fetchMachineConfiguration', () => {
    it('throws if configuration not found', async () => {
      const machine = makeMachine()
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(makeTemplate() as any)
      mockPrisma.machineConfiguration.findUnique.mockResolvedValue(null as any)

      await expect(
        service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York'),
      ).rejects.toThrow('Configuration not found')
    })
  })

  // ─── full create flow ──────────────────────────────────────────────────

  describe('create - success', () => {
    it('creates a VM successfully with all steps', async () => {
      const machine = makeMachine()
      const template = makeTemplate()
      const config = makeConfiguration()

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template as any)
      mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config as any)
      mockPrisma.machineApplication.findMany.mockResolvedValue([] as any)
      mockPrisma.scriptExecution.findMany.mockResolvedValue([] as any)
      mockPrisma.machine.update.mockResolvedValue(machine as any)
      mockPrisma.machineConfiguration.update.mockResolvedValue(config as any)

      mockInfinization.createVM.mockResolvedValue(makeCreateResult())

      const result = await service.create(
        machine, 'admin', 'password123', undefined, null,
        'en_US.UTF-8', 'us', 'America/New_York',
      )

      expect(result).toBe(true)

      // Status transitions are driven by infinization/QMP events; create only writes runtime config.
      expect(mockPrisma.machine.update).not.toHaveBeenCalled()

      // Verify infinization was called
      expect(mockInfinization.createVM).toHaveBeenCalledWith(
        expect.objectContaining({
          vmId: 'vm-1',
          name: 'TestVM',
          os: 'ubuntu-22.04',
        }),
      )

      // Verify machine configuration was updated with runtime values
      expect(mockPrisma.machineConfiguration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { machineId: 'vm-1' },
          data: expect.objectContaining({
            graphicPort: 5900,
            qemuPid: 12345,
            tapDeviceName: 'tap0',
          }),
        }),
      )
    })

    it('creates VM without template (uses machine specs)', async () => {
      const machine = makeMachine({ templateId: null })
      const config = makeConfiguration()

      mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config as any)
      mockPrisma.machineApplication.findMany.mockResolvedValue([] as any)
      mockPrisma.scriptExecution.findMany.mockResolvedValue([] as any)
      mockPrisma.machine.update.mockResolvedValue(machine as any)
      mockPrisma.machineConfiguration.update.mockResolvedValue(config as any)

      mockInfinization.createVM.mockResolvedValue(makeCreateResult())

      const result = await service.create(
        machine, 'admin', 'password123', undefined, null,
        'en_US.UTF-8', 'us', 'America/New_York',
      )

      expect(result).toBe(true)
      // Template should not be fetched if templateId is null
      expect(mockPrisma.machineTemplate.findUnique).not.toHaveBeenCalled()
    })
  })

  // ─── create - failure and rollback ─────────────────────────────────────

  describe('create - failure', () => {
    it('rolls back and throws on infinization failure', async () => {
      const machine = makeMachine()
      const config = makeConfiguration()

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(makeTemplate() as any)
      mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config as any)
      mockPrisma.machineApplication.findMany.mockResolvedValue([] as any)
      mockPrisma.scriptExecution.findMany.mockResolvedValue([] as any)
      mockPrisma.machine.update.mockResolvedValue(machine as any)

      mockInfinization.createVM.mockResolvedValue({
        success: false,
        vmId: 'vm-1',
        displayPort: 0,
        diskPaths: [],
        tapDevice: '',
        pid: 0,
        qmpSocketPath: '',
      })

      mockInfinization.getVMStatus.mockResolvedValue({ processAlive: false } as any)

      await expect(
        service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York'),
      ).rejects.toThrow('Error creating machine')

      // Verify rollback: status should be set to 'error'
      const updateCalls = (mockPrisma.machine.update as jest.Mock).mock.calls
      const errorUpdate = updateCalls.find((c: any) => c[0]?.data?.status === 'error')
      expect(errorUpdate).toBeDefined()
    })

    it('rolls back VM if it was started before failure', async () => {
      const machine = makeMachine()
      const config = makeConfiguration()

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(makeTemplate() as any)
      mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config as any)
      mockPrisma.machineApplication.findMany.mockResolvedValue([] as any)
      mockPrisma.scriptExecution.findMany.mockResolvedValue([] as any)
      mockPrisma.machine.update.mockResolvedValue(machine as any)

      // Make createVM throw (simulating a mid-creation error)
      mockInfinization.createVM.mockRejectedValue(new Error('QEMU crashed'))

      // For rollback, VM is alive and should be stopped
      mockInfinization.getVMStatus.mockResolvedValue({ processAlive: true } as any)
      mockInfinization.stopVM.mockResolvedValue(undefined)
      mockPrisma.machineConfiguration.update.mockResolvedValue(config as any)

      await expect(
        service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York'),
      ).rejects.toThrow('Error creating machine')

      expect(mockInfinization.stopVM).toHaveBeenCalledWith('vm-1', { force: true })
    })

    it('deletes the orphaned qcow2 on failure even though diskPaths was never persisted', async () => {
      // This is the leak fix: infinization creates the disk at a deterministic
      // path but never persists diskPaths to the DB on failure, so rollback must
      // unlink the computed path itself.
      const fs = jest.requireMock('fs') as { promises: { unlink: jest.Mock } }
      const machine = makeMachine() // internalName: 'vm-test-1'
      const config = makeConfiguration()

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(makeTemplate() as any)
      mockPrisma.machineConfiguration.findUnique.mockResolvedValue({ ...config, diskPaths: null } as any)
      mockPrisma.machineApplication.findMany.mockResolvedValue([] as any)
      mockPrisma.scriptExecution.findMany.mockResolvedValue([] as any)
      mockPrisma.machine.update.mockResolvedValue(machine as any)
      mockInfinization.createVM.mockRejectedValue(new Error('QEMU spawn failed'))
      mockInfinization.getVMStatus.mockResolvedValue({ processAlive: false } as any)

      await expect(
        service.create(machine, 'user', 'pass', undefined, null, 'en_US.UTF-8', 'us', 'America/New_York'),
      ).rejects.toThrow('Error creating machine')

      // rollback unlinks the deterministic path: <diskDir>/<internalName>.qcow2
      expect(fs.promises.unlink).toHaveBeenCalledWith('/var/lib/infinization/disks/vm-test-1.qcow2')
    })
  })

  // ─── buildVMConfig: display + privilege hardening ───────────────────────
  //
  // buildVMConfig is private, so we exercise it through create() and inspect
  // the VMCreateConfig handed to infinization.createVM. These assertions lock
  // in the production-readiness fixes:
  //   B1   — a non-empty displayPassword is always supplied (the library
  //          delivers it over QMP set_password and its fail-closed guard would
  //          otherwise throw INVALID_CONFIG on a non-loopback bind).
  //   L249 — displayAddr defaults to loopback (127.0.0.1) when APP_HOST unset.
  //   H11  — runAsUser is threaded from INFINIZATION_QEMU_USER (undefined when
  //          unset, preserving the current no-privilege-drop behavior).
  describe('buildVMConfig - display + privilege hardening', () => {
    let savedAppHost: string | undefined
    let savedQemuUser: string | undefined

    beforeEach(() => {
      savedAppHost = process.env.APP_HOST
      savedQemuUser = process.env.INFINIZATION_QEMU_USER
      delete process.env.APP_HOST
      delete process.env.INFINIZATION_QEMU_USER
    })

    afterEach(() => {
      if (savedAppHost === undefined) delete process.env.APP_HOST
      else process.env.APP_HOST = savedAppHost
      if (savedQemuUser === undefined) delete process.env.INFINIZATION_QEMU_USER
      else process.env.INFINIZATION_QEMU_USER = savedQemuUser
    })

    async function runCreateAndCapture(): Promise<any> {
      const machine = makeMachine()
      const template = makeTemplate()
      const config = makeConfiguration()

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template as any)
      mockPrisma.machineConfiguration.findUnique.mockResolvedValue(config as any)
      mockPrisma.machineApplication.findMany.mockResolvedValue([] as any)
      mockPrisma.scriptExecution.findMany.mockResolvedValue([] as any)
      mockPrisma.machine.update.mockResolvedValue(machine as any)
      mockPrisma.machineConfiguration.update.mockResolvedValue(config as any)
      mockInfinization.createVM.mockResolvedValue(makeCreateResult())

      await service.create(
        machine, 'admin', 'password123', undefined, null,
        'en_US.UTF-8', 'us', 'America/New_York',
      )

      expect(mockInfinization.createVM).toHaveBeenCalledTimes(1)
      return (mockInfinization.createVM as jest.Mock).mock.calls[0][0]
    }

    it('(a) supplies a non-empty displayPassword and persists the same value as graphicPassword', async () => {
      const vmCreateConfig = await runCreateAndCapture()

      expect(typeof vmCreateConfig.displayPassword).toBe('string')
      expect(vmCreateConfig.displayPassword.length).toBeGreaterThan(0)

      // Single source of truth: the persisted graphicPassword must equal the
      // generated displayPassword (so the console-connect resolver can present
      // the same ticket the library provisioned over QMP).
      const updateArg = (mockPrisma.machineConfiguration.update as jest.Mock).mock.calls[0][0]
      expect(updateArg.data.graphicPassword).toBe(vmCreateConfig.displayPassword)
    })

    it('(b) defaults displayAddr to 127.0.0.1 when APP_HOST is unset', async () => {
      const vmCreateConfig = await runCreateAndCapture()
      expect(vmCreateConfig.displayAddr).toBe('127.0.0.1')
    })

    it('(b2) honors APP_HOST for displayAddr when set (paired with the password)', async () => {
      process.env.APP_HOST = '192.168.1.100'
      const vmCreateConfig = await runCreateAndCapture()
      expect(vmCreateConfig.displayAddr).toBe('192.168.1.100')
      // A routable bind is only safe because it is paired with a real password.
      expect(vmCreateConfig.displayPassword?.length).toBeGreaterThan(0)
    })

    it('(c) sets runAsUser from INFINIZATION_QEMU_USER when set', async () => {
      process.env.INFINIZATION_QEMU_USER = 'infinibay-qemu'
      const vmCreateConfig = await runCreateAndCapture()
      expect(vmCreateConfig.runAsUser).toBe('infinibay-qemu')
    })

    it('(c2) leaves runAsUser undefined when INFINIZATION_QEMU_USER is unset (no privilege-drop regression)', async () => {
      const vmCreateConfig = await runCreateAndCapture()
      expect(vmCreateConfig.runAsUser).toBeUndefined()
      // seccomp sandbox stays on: disableSandbox must never be set to true here.
      expect(vmCreateConfig.disableSandbox).not.toBe(true)
    })
  })

  // ─── getGraphicsInfo ───────────────────────────────────────────────────

  describe('getGraphicsInfo', () => {
    it('returns filtered GPU controllers from allowed vendors', async () => {
      const si = require('systeminformation')
      si.graphics.mockResolvedValue({
        controllers: [
          { vendor: 'NVIDIA Corporation', name: 'RTX 3080' },
          { vendor: 'Intel Corporation', name: 'UHD 630' },
          { vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]', name: 'RX 6800' },
        ],
      })

      const result = await service.getGraphicsInfo()
      expect(result).toHaveLength(2)
      expect(result[0].vendor).toBe('NVIDIA Corporation')
      expect(result[1].vendor).toBe('Advanced Micro Devices, Inc. [AMD/ATI]')
    })

    it('returns empty array on error', async () => {
      const si = require('systeminformation')
      si.graphics.mockRejectedValue(new Error('No GPU info'))

      const result = await service.getGraphicsInfo()
      expect(result).toEqual([])
    })
  })
})
