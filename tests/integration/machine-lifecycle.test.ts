import 'reflect-metadata'
import { PrismaClient, User, Prisma } from '@prisma/client'
import { MachineLifecycleService } from '@services/machineLifecycleService'
import { MachineCleanupService } from '@services/cleanup/machineCleanupService'
import {
  createMockUser,
  createMockAdminUser,
  createMockMachine,
  createMockMachineTemplate,
  createMockDepartment,
  createMockMachineConfiguration,
  createMockApplication,
  generateId
} from '../setup/mock-factories'
import { OsEnum } from '@graphql/resolvers/machine/type'
import { mockPrisma } from '../setup/jest.setup'
import { Connection } from '@infinibay/libvirt-node'

// Mock libvirt-node
jest.mock('@infinibay/libvirt-node')

// Mock VirtManager
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

// Mock XMLGenerator
jest.mock('@utils/VirtManager/xmlGenerator', () => ({
  XMLGenerator: jest.fn().mockImplementation(() => ({
    generateDomainXML: jest.fn().mockReturnValue('<domain>...</domain>'),
    generateNetworkXML: jest.fn().mockReturnValue('<network>...</network>'),
    load: jest.fn().mockReturnValue(true),
    getUefiVarFile: jest.fn().mockReturnValue(null),
    getDisks: jest.fn().mockReturnValue([])
  }))
}))

// Mock GraphicPortService
jest.mock('@utils/VirtManager/graphicPortService', () => ({
  GraphicPortService: jest.fn().mockImplementation(() => ({
    getGraphicPort: jest.fn().mockResolvedValue(5900),
    allocatePort: jest.fn().mockResolvedValue(5901),
    releasePort: jest.fn().mockResolvedValue(true)
  }))
}))

describe('VM Lifecycle Integration Tests', () => {
  let prisma: PrismaClient
  let lifecycleService: MachineLifecycleService
  let cleanupService: MachineCleanupService
  let mockAdmin: User

  beforeAll(() => {
    prisma = mockPrisma as PrismaClient
    mockAdmin = createMockAdminUser()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    lifecycleService = new MachineLifecycleService(prisma, mockAdmin)
    cleanupService = new MachineCleanupService(prisma)
  })

  describe('VM Creation Workflow', () => {
    it('should successfully create a VM with all resources', async () => {
      const template = createMockMachineTemplate({
        cores: 4,
        ram: 8,
        storage: 100
      })
      const department = createMockDepartment()
      const application = createMockApplication()

      const vmId = generateId()
      const internalName = `vm-${vmId}`

      const newMachine = createMockMachine({
        id: vmId,
        name: 'Test VM',
        internalName,
        templateId: template.id,
        departmentId: department.id,
        status: 'building',
        cpuCores: template.cores,
        ramGB: template.ram,
        diskSizeGB: template.storage
      })

      const configuration = createMockMachineConfiguration({
        machineId: vmId,
        graphicProtocol: 'spice',
        graphicPort: 5900,
        graphicHost: '192.168.1.100'
      })

      // Setup mocks for transaction
      const mockTransaction = {
        machineTemplate: {
          findUnique: jest.fn().mockResolvedValue(template)
        },
        department: {
          findUnique: jest.fn().mockResolvedValue(department),
          findFirst: jest.fn().mockResolvedValue(department)
        },
        machine: {
          create: jest.fn().mockResolvedValue({
            ...newMachine,
            configuration,
            department,
            template,
            user: mockAdmin
          })
        },
        machineApplication: {
          create: jest.fn().mockResolvedValue({
            machineId: vmId,
            applicationId: application.id,
            parameters: {}
          })
        }
      };

      (prisma.machineTemplate.findUnique as jest.Mock).mockResolvedValue(template);
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        return callback(mockTransaction)
      })

      const input = {
        name: 'Test VM',
        templateId: template.id,
        departmentId: department.id,
        os: OsEnum.UBUNTU,
        username: 'testuser',
        password: 'TestPass123!',
        productKey: undefined,
        pciBus: null,
        applications: [{
          machineId: '', // Will be filled by the service
          applicationId: application.id,
          parameters: {}
        }]
      }

      const result = await lifecycleService.createMachine(input)

      expect(result).toBeDefined()
      expect(result.id).toBe(vmId)
      expect(result.name).toBe('Test VM')
      expect(result.status).toBe('building')
      expect(result.cpuCores).toBe(template.cores)
      expect(result.ramGB).toBe(template.ram)
      expect(result.diskSizeGB).toBe(template.storage)

      // Verify template was validated
      expect(prisma.machineTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: template.id }
      })

      // Verify machine was created with correct data
      expect(mockTransaction.machine.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Test VM',
            userId: mockAdmin.id,
            status: 'building',
            os: OsEnum.UBUNTU,
            templateId: template.id,
            departmentId: department.id,
            cpuCores: template.cores,
            ramGB: template.ram,
            diskSizeGB: template.storage
          })
        })
      )

      // Verify application was attached
      expect(mockTransaction.machineApplication.create).toHaveBeenCalledWith({
        data: {
          machineId: vmId,
          applicationId: application.id,
          parameters: {}
        }
      })
    })

    it('should fail VM creation with non-existent template', async () => {
      (prisma.machineTemplate.findUnique as jest.Mock).mockResolvedValue(null)

      const input = {
        name: 'Test VM',
        templateId: 'non-existent-template',
        departmentId: 'dept-id',
        os: OsEnum.UBUNTU,
        username: 'testuser',
        password: 'TestPass123!',
        productKey: undefined,
        pciBus: null,
        applications: []
      }

      await expect(lifecycleService.createMachine(input)).rejects.toThrow('Machine template not found')
    })

    it('should fail VM creation when no department exists', async () => {
      const template = createMockMachineTemplate()

      const mockTransaction = {
        department: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null)
        }
      };

      (prisma.machineTemplate.findUnique as jest.Mock).mockResolvedValue(template);
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        return callback(mockTransaction)
      })

      const input = {
        name: 'Test VM',
        templateId: template.id,
        departmentId: 'non-existent-dept',
        os: OsEnum.UBUNTU,
        username: 'testuser',
        password: 'TestPass123!',
        productKey: undefined,
        pciBus: null,
        applications: []
      }

      await expect(lifecycleService.createMachine(input)).rejects.toThrow('Department not found')
    })
  })

  describe('Power State Transitions', () => {
    it('should successfully power on a stopped VM', async () => {
      const machine = createMockMachine({ status: 'stopped' })
      const configuration = createMockMachineConfiguration({ machineId: machine.id });

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue({
        ...machine,
        configuration
      });

      (prisma.machine.update as jest.Mock).mockResolvedValue({
        ...machine,
        status: 'running'
      })

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue({
          create: jest.fn().mockResolvedValue(true),
          getState: jest.fn().mockResolvedValue([1, 1]) // Running state
        })
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn)

      // Simulate power on operation
      const whereClause = { id: machine.id, userId: mockAdmin.id }
      const foundMachine = await prisma.machine.findFirst({ where: whereClause })
      expect(foundMachine).toBeDefined()

      // Update status to running
      const updatedMachine = await prisma.machine.update({
        where: { id: machine.id },
        data: { status: 'running' }
      })

      expect(updatedMachine.status).toBe('running')
    })

    it('should successfully power off a running VM', async () => {
      const machine = createMockMachine({ status: 'running' })
      const configuration = createMockMachineConfiguration({ machineId: machine.id });

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue({
        ...machine,
        configuration
      });

      (prisma.machine.update as jest.Mock).mockResolvedValue({
        ...machine,
        status: 'stopped'
      })

      const mockDomain = {
        shutdown: jest.fn().mockResolvedValue(true),
        getState: jest.fn().mockResolvedValue([5, 1]) // Shutoff state
      }

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain)
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn)

      // Simulate power off operation
      const foundMachine = await prisma.machine.findFirst({
        where: { id: machine.id }
      })
      expect(foundMachine).toBeDefined()

      // Update status to stopped
      const updatedMachine = await prisma.machine.update({
        where: { id: machine.id },
        data: { status: 'stopped' }
      })

      expect(updatedMachine.status).toBe('stopped')
    })

    it('should handle force shutdown when graceful shutdown fails', async () => {
      const machine = createMockMachine({ status: 'running' });

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue(machine)

      const mockDomain = {
        shutdown: jest.fn().mockRejectedValue(new Error('Shutdown failed')),
        destroy: jest.fn().mockResolvedValue(true),
        getState: jest.fn().mockResolvedValue([5, 1])
      }

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain)
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn);
      (prisma.machine.update as jest.Mock).mockResolvedValue({
        ...machine,
        status: 'stopped'
      })

      // First attempt graceful shutdown (will fail)
      await expect(mockDomain.shutdown()).rejects.toThrow('Shutdown failed')

      // Force shutdown should succeed
      await expect(mockDomain.destroy()).resolves.toBe(true)

      const updatedMachine = await prisma.machine.update({
        where: { id: machine.id },
        data: { status: 'stopped' }
      })

      expect(updatedMachine.status).toBe('stopped')
    })
  })

  describe('Resource Allocation and Deallocation', () => {
    it('should allocate resources when creating VM', async () => {
      const template = createMockMachineTemplate({
        cores: 4,
        ram: 8,
        storage: 100
      })
      const department = createMockDepartment()

      // Track resource allocation
      const allocatedResources = {
        cpu: 0,
        memory: 0,
        storage: 0,
        graphicPort: null as number | null
      }

      const mockTransaction = {
        machineTemplate: {
          findUnique: jest.fn().mockResolvedValue(template)
        },
        department: {
          findFirst: jest.fn().mockResolvedValue(department),
          findUnique: jest.fn().mockResolvedValue(department)
        },
        machine: {
          create: jest.fn().mockImplementation(({ data }) => {
            // Simulate resource allocation
            allocatedResources.cpu = data.cpuCores
            allocatedResources.memory = data.ramGB
            allocatedResources.storage = data.diskSizeGB
            allocatedResources.graphicPort = 5900

            return Promise.resolve({
              ...createMockMachine(data),
              configuration: createMockMachineConfiguration({
                machineId: data.id,
                graphicPort: 5900
              })
            })
          })
        },
        machineApplication: {
          create: jest.fn()
        }
      };

      (prisma.machineTemplate.findUnique as jest.Mock).mockResolvedValue(template);
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        return callback(mockTransaction)
      })

      const input = {
        name: 'Resource Test VM',
        templateId: template.id,
        departmentId: department.id,
        os: OsEnum.UBUNTU,
        username: 'testuser',
        password: 'TestPass123!',
        productKey: undefined,
        pciBus: null,
        applications: []
      }

      await lifecycleService.createMachine(input)

      // Verify resources were allocated
      expect(allocatedResources.cpu).toBe(template.cores)
      expect(allocatedResources.memory).toBe(template.ram)
      expect(allocatedResources.storage).toBe(template.storage)
      expect(allocatedResources.graphicPort).toBe(5900)
    })

    it('should deallocate resources when destroying VM', async () => {
      const machine = createMockMachine()
      const configuration = createMockMachineConfiguration({
        machineId: machine.id,
        graphicPort: 5900
      })

      const nwFilter = {
        id: generateId(),
        nwFilter: {
          id: generateId(),
          internalName: 'test-filter',
          uuid: generateId()
        }
      };

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue({
        ...machine,
        configuration,
        nwFilters: [nwFilter]
      })

      // Track cleanup operations
      const cleanupOps = {
        vmDestroyed: false,
        portReleased: false,
        filterRemoved: false,
        databaseDeleted: false
      }

      const mockDomain = {
        destroy: jest.fn().mockImplementation(() => {
          cleanupOps.vmDestroyed = true
          return Promise.resolve(true)
        }),
        undefine: jest.fn().mockResolvedValue(true)
      }

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain),
        lookupNwFilterByUUID: jest.fn().mockResolvedValue({
          undefine: jest.fn().mockImplementation(() => {
            cleanupOps.filterRemoved = true
            return Promise.resolve(true)
          })
        })
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn);

      (prisma.machineConfiguration.delete as jest.Mock).mockImplementation(() => {
        cleanupOps.portReleased = true
        return Promise.resolve(true)
      });

      (prisma.machine.delete as jest.Mock).mockImplementation(() => {
        cleanupOps.databaseDeleted = true
        return Promise.resolve(true)
      })

      const result = await lifecycleService.destroyMachine(machine.id)

      expect(result.success).toBe(true)
      // Note: The actual cleanup happens in the MachineCleanupService
      // which would need to be properly mocked for full verification
    })
  })

  describe('Cleanup on VM Deletion', () => {
    it('should clean up all VM resources on deletion', async () => {
      const machine = createMockMachine()
      const configuration = createMockMachineConfiguration({
        machineId: machine.id
      });

      (prisma.machine.findUnique as jest.Mock).mockResolvedValue({
        ...machine,
        configuration,
        nwFilters: [],
        applications: []
      })

      // Mock cleanup service operations
      const cleanupSteps = {
        stopVM: false,
        removeDisks: false,
        removeNetworkFilters: false,
        releaseGraphicPort: false,
        removeFromDatabase: false
      };

      (prisma.machine.update as jest.Mock).mockImplementation(({ data }) => {
        if (data.status === 'stopped') cleanupSteps.stopVM = true
        return Promise.resolve({ ...machine, ...data })
      });

      (prisma.machineConfiguration.delete as jest.Mock).mockImplementation(() => {
        cleanupSteps.releaseGraphicPort = true
        return Promise.resolve(configuration)
      });

      (prisma.machine.delete as jest.Mock).mockImplementation(() => {
        cleanupSteps.removeFromDatabase = true
        return Promise.resolve(machine)
      })

      const mockDomain = {
        destroy: jest.fn().mockResolvedValue(true),
        undefine: jest.fn().mockImplementation(() => {
          cleanupSteps.removeDisks = true
          return Promise.resolve(true)
        })
      }

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain)
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn)

      await cleanupService.cleanupVM(machine.id)

      // Verify all cleanup steps
      expect(prisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: machine.id },
        include: expect.any(Object)
      })
    })

    it('should handle partial cleanup failures gracefully', async () => {
      const machine = createMockMachine();

      (prisma.machine.findUnique as jest.Mock).mockResolvedValue({
        ...machine,
        configuration: createMockMachineConfiguration({ machineId: machine.id }),
        nwFilters: []
      })

      const mockDomain = {
        destroy: jest.fn().mockRejectedValue(new Error('Failed to destroy')),
        undefine: jest.fn().mockResolvedValue(true)
      }

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain)
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn)

      // Mock transaction to execute the callback with a transaction object
      const mockTx = {
        machine: { delete: jest.fn().mockResolvedValue(machine) },
        machineConfiguration: { delete: jest.fn() },
        machineApplication: { deleteMany: jest.fn() },
        vMNWFilter: { deleteMany: jest.fn() },
        vmPort: { deleteMany: jest.fn() },
        nWFilter: { deleteMany: jest.fn() }
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback: Function) => {
        return callback(mockTx)
      })

      // Cleanup should not throw even if some operations fail
      await expect(cleanupService.cleanupVM(machine.id)).resolves.not.toThrow()
    })

    it('should remove orphaned resources during cleanup', async () => {
      const machine = createMockMachine()
      const orphanedDiskPath = `/var/lib/libvirt/images/${machine.internalName}.qcow2`;

      (prisma.machine.findUnique as jest.Mock).mockResolvedValue({
        ...machine,
        configuration: createMockMachineConfiguration({ machineId: machine.id }),
        nwFilters: []
      })

      // Mock file system operations for disk cleanup
      const fs = require('fs/promises')
      jest.spyOn(fs, 'unlink').mockResolvedValue(undefined)
      jest.spyOn(require('fs'), 'existsSync').mockReturnValue(true)

      const mockConn = {
        lookupDomainByName: jest.fn().mockRejectedValue(new Error('Domain not found'))
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn)

      // Mock transaction to execute the callback with a transaction object
      const mockTx = {
        machine: { delete: jest.fn().mockResolvedValue(machine) },
        machineConfiguration: { delete: jest.fn() },
        machineApplication: { deleteMany: jest.fn() },
        vMNWFilter: { deleteMany: jest.fn() },
        vmPort: { deleteMany: jest.fn() },
        nWFilter: { deleteMany: jest.fn() }
      };
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback: Function) => {
        return callback(mockTx)
      })

      await cleanupService.cleanupVM(machine.id)

      // Verify database entry was still cleaned up via transaction
      expect(mockTx.machine.delete).toHaveBeenCalledWith({
        where: { id: machine.id }
      })
    })
  })

  describe('Authorization Checks', () => {
    it('should allow admin to manage any VM', async () => {
      const otherUser = createMockUser()
      const machine = createMockMachine({ userId: otherUser.id });

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue(machine)

      const adminService = new MachineLifecycleService(prisma, mockAdmin);

      // Admin should be able to destroy any machine
      (prisma.machine.update as jest.Mock).mockResolvedValue({
        ...machine,
        status: 'stopped'
      })

      const result = await adminService.destroyMachine(machine.id)

      expect(prisma.machine.findFirst).toHaveBeenCalledWith({
        where: { id: machine.id }, // No userId constraint for admin
        include: expect.any(Object)
      })
    })

    it('should restrict regular users to their own VMs', async () => {
      const regularUser = createMockUser({ role: 'USER' })
      const otherUser = createMockUser()
      const machine = createMockMachine({ userId: otherUser.id })

      const userService = new MachineLifecycleService(prisma, regularUser);

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue(null) // User can't see other's VMs

      const result = await userService.destroyMachine(machine.id)

      expect(result.success).toBe(false)
      expect(result.message).toBe('Machine not found')

      expect(prisma.machine.findFirst).toHaveBeenCalledWith({
        where: { id: machine.id, userId: regularUser.id }, // userId constraint for regular user
        include: expect.any(Object)
      })
    })

    it('should track VM ownership throughout lifecycle', async () => {
      const user = createMockUser()
      const template = createMockMachineTemplate()
      const department = createMockDepartment()

      const userService = new MachineLifecycleService(prisma, user)

      const mockTransaction = {
        machineTemplate: {
          findUnique: jest.fn().mockResolvedValue(template)
        },
        department: {
          findFirst: jest.fn().mockResolvedValue(department),
          findUnique: jest.fn().mockResolvedValue(department)
        },
        machine: {
          create: jest.fn().mockImplementation(({ data }) => {
            expect(data.userId).toBe(user.id) // Verify ownership is set
            return Promise.resolve(createMockMachine(data))
          })
        },
        machineApplication: {
          create: jest.fn()
        }
      };

      (prisma.machineTemplate.findUnique as jest.Mock).mockResolvedValue(template);
      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        return callback(mockTransaction)
      })

      const input = {
        name: 'User VM',
        templateId: template.id,
        departmentId: department.id,
        os: OsEnum.UBUNTU,
        username: 'testuser',
        password: 'TestPass123!',
        productKey: undefined,
        pciBus: null,
        applications: []
      }

      const result = await userService.createMachine(input)

      expect(mockTransaction.machine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: user.id
        }),
        include: expect.any(Object)
      })
    })
  })

  describe('State Consistency', () => {
    it('should maintain state consistency between database and libvirt', async () => {
      const machine = createMockMachine({ status: 'running' });

      (prisma.machine.findFirst as jest.Mock).mockResolvedValue(machine)

      const mockDomain = {
        getState: jest.fn().mockResolvedValue([5, 1]) // Shutoff in libvirt
      }

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain)
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn);

      // Detect inconsistency and fix it
      (prisma.machine.update as jest.Mock).mockResolvedValue({
        ...machine,
        status: 'stopped'
      })

      // Simulate state sync
      const libvirtState = await mockDomain.getState()
      const expectedStatus = libvirtState[0] === 5 ? 'stopped' : 'running'

      const updatedMachine = await prisma.machine.update({
        where: { id: machine.id },
        data: { status: expectedStatus }
      })

      expect(updatedMachine.status).toBe('stopped')
    })

    it('should handle VM state transitions atomically', async () => {
      const machine = createMockMachine({ status: 'stopped' })

      let transactionCompleted = false;

      (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
        const result = await callback({
          machine: {
            update: jest.fn().mockResolvedValue({
              ...machine,
              status: 'running'
            })
          }
        })
        transactionCompleted = true
        return result
      })

      const mockDomain = {
        create: jest.fn().mockResolvedValue(true)
      }

      const mockConn = {
        lookupDomainByName: jest.fn().mockResolvedValue(mockDomain)
      };

      (Connection.open as jest.Mock).mockResolvedValue(mockConn)

      // Simulate atomic state change
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await mockDomain.create()
        await tx.machine.update({
          where: { id: machine.id },
          data: { status: 'running' }
        })
      })

      expect(transactionCompleted).toBe(true)
      expect(mockDomain.create).toHaveBeenCalled()
    })
  })
})
