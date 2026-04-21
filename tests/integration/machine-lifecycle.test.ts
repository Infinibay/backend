import 'reflect-metadata'
import { MachineLifecycleService } from '@services/machineLifecycleService'
import { MachineCleanupServiceV2 as MachineCleanupService } from '@services/cleanup/machineCleanupServiceV2'
import { OsEnum } from '@graphql/resolvers/machine/type'
import { testPrisma } from '../setup/jest.setup'
import {
  createAdmin,
  createUser,
  createDepartment,
  createTemplate,
  createApplication,
  createMachine
} from '../setup/db-factories'

// External systems — still mocked because this test isn't about libvirt/infinization.
jest.mock('@infinibay/libvirt-node')

jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn().mockResolvedValue({
    getVMStatus: jest.fn().mockResolvedValue({ processAlive: false }),
    getVMInfo: jest.fn().mockResolvedValue({}),
    stopVM: jest.fn().mockResolvedValue(undefined),
    destroyVM: jest.fn().mockResolvedValue({ success: true }),
  }),
  initializeInfinization: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@utils/VirtManager', () => ({
  default: jest.fn().mockImplementation(() => ({
    createVM: jest.fn().mockResolvedValue(true),
    destroyVM: jest.fn().mockResolvedValue(true),
    startVM: jest.fn().mockResolvedValue(true),
    stopVM: jest.fn().mockResolvedValue(true),
    getVMState: jest.fn().mockResolvedValue('running'),
    updateVMHardware: jest.fn().mockResolvedValue(true)
  }))
}))

jest.mock('@services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => ({
    cleanupVmConnection: jest.fn(),
    disconnectVm: jest.fn(),
    isVmConnected: jest.fn().mockReturnValue(false)
  }))
}))

jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  unlink: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  readdir: jest.fn().mockResolvedValue([])
}))

// MachineLifecycleService.createMachine fires `setImmediate(() => backgroundCode(...))`
// after committing the VM row. In production that spawns the VM via libvirt; in
// tests it would keep the event loop alive past the test's end. Stub it to a
// no-op so the process exits cleanly without --forceExit.
beforeAll(() => {
  jest
    .spyOn(MachineLifecycleService.prototype as any, 'backgroundCode')
    .mockResolvedValue(undefined)
})

describe('VM Lifecycle — real database', () => {
  const prisma = testPrisma.prisma

  let admin: Awaited<ReturnType<typeof createAdmin>>
  let regularUser: Awaited<ReturnType<typeof createUser>>
  let department: Awaited<ReturnType<typeof createDepartment>>
  let template: Awaited<ReturnType<typeof createTemplate>>
  let application: Awaited<ReturnType<typeof createApplication>>

  beforeEach(async () => {
    admin = await createAdmin(prisma)
    regularUser = await createUser(prisma)
    department = await createDepartment(prisma)
    template = await createTemplate(prisma, { cores: 4, ram: 8, storage: 100 })
    application = await createApplication(prisma)
  })

  describe('createMachine', () => {
    it('creates a VM with all resources inside a single transaction', async () => {
      const service = new MachineLifecycleService(prisma, admin)

      const created = await service.createMachine({
        name: 'Test VM',
        templateId: template.id,
        departmentId: department.id,
        os: OsEnum.UBUNTU,
        username: 'testuser',
        password: 'TestPass123!',
        productKey: undefined,
        firstBootScripts: [],
        pciBus: null,
        applications: [{
          machineId: '',
          applicationId: application.id,
          parameters: {}
        }]
      })

      expect(created.id).toBeDefined()
      expect(created.status).toBe('building')
      expect(created.cpuCores).toBe(template.cores)
      expect(created.ramGB).toBe(template.ram)

      // Verify everything is actually in the DB.
      const dbMachine = await prisma.machine.findUnique({
        where: { id: created.id },
        include: { configuration: true, applications: true }
      })
      expect(dbMachine).not.toBeNull()
      expect(dbMachine!.userId).toBe(admin.id)
      expect(dbMachine!.departmentId).toBe(department.id)
      expect(dbMachine!.configuration).not.toBeNull()
      expect(dbMachine!.applications).toHaveLength(1)
      expect(dbMachine!.applications[0].applicationId).toBe(application.id)
    })

    it('rolls back the transaction if the template is missing', async () => {
      const service = new MachineLifecycleService(prisma, admin)

      await expect(
        service.createMachine({
          name: 'Test VM',
          templateId: 'non-existent-template',
          departmentId: department.id,
          os: OsEnum.UBUNTU,
          username: 'testuser',
          password: 'TestPass123!',
          productKey: undefined,
          firstBootScripts: [],
          pciBus: null,
          applications: []
        })
      ).rejects.toThrow('Machine template not found')

      // Nothing written.
      expect(await prisma.machine.count()).toBe(0)
      expect(await prisma.machineConfiguration.count()).toBe(0)
    })

    it('rolls back the transaction if the department is missing', async () => {
      const service = new MachineLifecycleService(prisma, admin)

      await expect(
        service.createMachine({
          name: 'Test VM',
          templateId: template.id,
          departmentId: 'non-existent-dept',
          os: OsEnum.UBUNTU,
          username: 'testuser',
          password: 'TestPass123!',
          productKey: undefined,
          firstBootScripts: [],
          pciBus: null,
          applications: []
        })
      ).rejects.toThrow('Department not found')

      expect(await prisma.machine.count()).toBe(0)
    })

    it('assigns ownership to the calling user', async () => {
      const service = new MachineLifecycleService(prisma, regularUser)

      const created = await service.createMachine({
        name: 'User VM',
        templateId: template.id,
        departmentId: department.id,
        os: OsEnum.UBUNTU,
        username: 'testuser',
        password: 'TestPass123!',
        productKey: undefined,
        firstBootScripts: [],
        pciBus: null,
        applications: []
      })

      const dbMachine = await prisma.machine.findUnique({ where: { id: created.id } })
      expect(dbMachine!.userId).toBe(regularUser.id)
    })
  })

  describe('destroyMachine authorization', () => {
    it('admins can destroy a VM they do not own', async () => {
      const otherUser = await createUser(prisma)
      const vm = await createMachine(prisma, {
        userId: otherUser.id,
        departmentId: department.id,
        overrides: { status: 'running' }
      })

      const result = await new MachineLifecycleService(prisma, admin).destroyMachine(vm.id)
      expect(result.success).toBe(true)
    })

    it('regular users cannot destroy a VM they do not own', async () => {
      const otherUser = await createUser(prisma)
      const vm = await createMachine(prisma, {
        userId: otherUser.id,
        departmentId: department.id,
        overrides: { status: 'running' }
      })

      const result = await new MachineLifecycleService(prisma, regularUser).destroyMachine(vm.id)

      expect(result.success).toBe(false)
      expect(result.message).toBe('Machine not found')
      expect(await prisma.machine.findUnique({ where: { id: vm.id } })).not.toBeNull()
    })
  })

  describe('cleanupVM', () => {
    async function seedMachine () {
      const vm = await createMachine(prisma, {
        userId: admin.id,
        departmentId: department.id,
        withConfiguration: true
      })
      await prisma.machineApplication.create({
        data: { machineId: vm.id, applicationId: application.id, parameters: {} }
      })
      return vm
    }

    it('removes the machine, its configuration, and joined applications', async () => {
      const vm = await seedMachine()
      expect(await prisma.machine.count()).toBe(1)
      expect(await prisma.machineConfiguration.count()).toBe(1)
      expect(await prisma.machineApplication.count()).toBe(1)

      const cleanupService = new MachineCleanupService(prisma)
      await cleanupService.cleanupVM(vm.id)

      expect(await prisma.machine.count()).toBe(0)
      expect(await prisma.machineConfiguration.count()).toBe(0)
      expect(await prisma.machineApplication.count()).toBe(0)
    })

    it('is a no-op when the machine does not exist', async () => {
      const cleanupService = new MachineCleanupService(prisma)
      await expect(cleanupService.cleanupVM('no-such-id')).resolves.toBeUndefined()
    })

    it('completes cleanup even when disk file deletion fails', async () => {
      // fs/promises.unlink is already mocked to reject with ENOENT (see top-level mock).
      const vm = await seedMachine()
      const cleanupService = new MachineCleanupService(prisma)

      await expect(cleanupService.cleanupVM(vm.id)).resolves.toBeUndefined()
      expect(await prisma.machine.count()).toBe(0)
    })
  })
})
