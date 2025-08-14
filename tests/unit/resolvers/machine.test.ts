import 'reflect-metadata';
import { MachineResolver } from '@resolvers/machine/resolver';
import { mockPrisma } from '../../setup/jest.setup';
import {
  createMockMachine,
  createMockMachineTemplate,
  createMockDepartment,
  createMockUser,
  createMockMachineConfiguration,
  createMockMachineInput,
  createMockMachines,
  createMockDomainXML,
} from '../../setup/mock-factories';
import {
  createMockContext,
  createAdminContext,
  setupLibvirtMockState,
} from '../../setup/test-helpers';
import { UserInputError } from 'apollo-server-errors';

// Mock VirtManager
jest.mock('@utils/VirtManager', () => ({
  VirtManager: {
    getInstance: jest.fn(() => ({
      createMachine: jest.fn(),
      destroyMachine: jest.fn(),
      powerOn: jest.fn(),
      powerOff: jest.fn(),
      rebootMachine: jest.fn(),
      suspendMachine: jest.fn(),
      resumeMachine: jest.fn(),
      getMachineInfo: jest.fn(),
      getMachineStats: jest.fn(),
      updateMachineResources: jest.fn(),
      attachDevice: jest.fn(),
      detachDevice: jest.fn(),
      takeSnapshot: jest.fn(),
      revertSnapshot: jest.fn(),
      deleteSnapshot: jest.fn(),
      listSnapshots: jest.fn(),
      getMachineXML: jest.fn(),
      setAutostart: jest.fn(),
    })),
  },
}));

// Mock EventManager
jest.mock('@services/EventManager', () => ({
  getEventManager: jest.fn(() => ({
    dispatch: jest.fn(),
  })),
}));

describe('MachineResolver', () => {
  let resolver: MachineResolver;
  let mockVirtManager: any;

  beforeEach(() => {
    resolver = new MachineResolver();
    const VirtManager = require('@utils/VirtManager').VirtManager;
    mockVirtManager = VirtManager.getInstance();
    jest.clearAllMocks();
  });

  describe('machine', () => {
    it('should return machine by id', async () => {
      const mockMachine = createMockMachine();
      const mockTemplate = createMockMachineTemplate();
      const mockDepartment = createMockDepartment();
      const mockUser = createMockUser();
      const mockConfig = createMockMachineConfiguration({ machineId: mockMachine.id });

      const machineWithRelations = {
        ...mockMachine,
        template: mockTemplate,
        department: mockDepartment,
        user: mockUser,
        configuration: mockConfig,
      };

      mockPrisma.machine.findUnique.mockResolvedValue(machineWithRelations);

      const result = await resolver.machine(mockMachine.id);

      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: mockMachine.id },
        include: {
          template: true,
          department: true,
          user: true,
          configuration: true,
          applications: {
            include: { application: true },
          },
          nwFilters: {
            include: { nwFilter: true },
          },
          ports: true,
          serviceConfigs: true,
        },
      });
      expect(result).toEqual(machineWithRelations);
    });

    it('should return null if machine not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null);

      const result = await resolver.machine('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('machines', () => {
    it('should return paginated machines list', async () => {
      const mockMachines = createMockMachines(5);
      const total = 10;

      mockPrisma.machine.findMany.mockResolvedValue(mockMachines);
      mockPrisma.machine.count.mockResolvedValue(total);

      const result = await resolver.machines({ take: 5, skip: 0 });

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith({
        take: 5,
        skip: 0,
        include: {
          template: true,
          department: true,
          user: true,
          configuration: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({
        machines: mockMachines,
        total,
      });
    });

    it('should filter machines by status', async () => {
      const runningMachines = createMockMachines(3).map(m => ({ ...m, status: 'running' }));
      
      mockPrisma.machine.findMany.mockResolvedValue(runningMachines);
      mockPrisma.machine.count.mockResolvedValue(3);

      await resolver.machines({ take: 10, skip: 0 }, { status: 'running' });

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'running' },
        })
      );
    });

    it('should filter machines by department', async () => {
      const departmentId = 'dept-123';
      const deptMachines = createMockMachines(3).map(m => ({ ...m, departmentId }));
      
      mockPrisma.machine.findMany.mockResolvedValue(deptMachines);
      mockPrisma.machine.count.mockResolvedValue(3);

      await resolver.machines({ take: 10, skip: 0 }, { departmentId });

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { departmentId },
        })
      );
    });

    it('should filter machines by user', async () => {
      const userId = 'user-123';
      const userMachines = createMockMachines(2).map(m => ({ ...m, userId }));
      
      mockPrisma.machine.findMany.mockResolvedValue(userMachines);
      mockPrisma.machine.count.mockResolvedValue(2);

      await resolver.machines({ take: 10, skip: 0 }, { userId });

      expect(mockPrisma.machine.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
        })
      );
    });
  });

  describe('createMachine', () => {
    it('should create machine with valid input', async () => {
      const template = createMockMachineTemplate();
      const department = createMockDepartment();
      const input = createMockMachineInput({
        templateId: template.id,
        departmentId: department.id,
      });

      const createdMachine = createMockMachine({
        ...input,
        internalName: `vm-${Date.now()}`,
        status: 'stopped',
        cpuCores: template.cores,
        ramGB: template.ram,
        diskSizeGB: template.storage,
      });

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
      mockPrisma.department.findUnique.mockResolvedValue(department);
      mockPrisma.machine.create.mockResolvedValue(createdMachine);
      mockVirtManager.createMachine.mockResolvedValue({
        success: true,
        xml: createMockDomainXML(createdMachine.internalName),
      });

      const context = createAdminContext();
      const result = await resolver.createMachine(context, input);

      expect(mockPrisma.machineTemplate.findUnique).toHaveBeenCalledWith({
        where: { id: input.templateId },
      });
      expect(mockPrisma.machine.create).toHaveBeenCalled();
      expect(mockVirtManager.createMachine).toHaveBeenCalled();
      expect(result).toEqual(createdMachine);
    });

    it('should throw error if template not found', async () => {
      const input = createMockMachineInput();
      mockPrisma.machineTemplate.findUnique.mockResolvedValue(null);

      const context = createAdminContext();
      await expect(resolver.createMachine(context, input)).rejects.toThrow(UserInputError);
    });

    it('should throw error if department not found', async () => {
      const template = createMockMachineTemplate();
      const input = createMockMachineInput({
        templateId: template.id,
        departmentId: 'non-existent',
      });

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
      mockPrisma.department.findUnique.mockResolvedValue(null);

      const context = createAdminContext();
      await expect(resolver.createMachine(context, input)).rejects.toThrow(UserInputError);
    });

    it('should handle libvirt creation failure', async () => {
      const template = createMockMachineTemplate();
      const input = createMockMachineInput({ templateId: template.id });

      mockPrisma.machineTemplate.findUnique.mockResolvedValue(template);
      mockPrisma.machine.create.mockResolvedValue(createMockMachine());
      mockVirtManager.createMachine.mockRejectedValue(new Error('Libvirt error'));

      const context = createAdminContext();
      await expect(resolver.createMachine(context, input)).rejects.toThrow('Libvirt error');
    });
  });

  describe('destroyMachine', () => {
    it('should destroy machine successfully', async () => {
      const machine = createMockMachine({ status: 'stopped' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.destroyMachine.mockResolvedValue({ success: true });
      mockPrisma.machine.delete.mockResolvedValue(machine);

      const result = await resolver.destroyMachine(machine.id);

      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: machine.id },
      });
      expect(mockVirtManager.destroyMachine).toHaveBeenCalledWith(machine.internalName);
      expect(mockPrisma.machine.delete).toHaveBeenCalledWith({
        where: { id: machine.id },
      });
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('destroyed'),
      });
    });

    it('should force destroy running machine if force flag is set', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.destroyMachine.mockResolvedValue({ success: true });
      mockPrisma.machine.delete.mockResolvedValue(machine);

      const result = await resolver.destroyMachine(machine.id, true);

      expect(mockVirtManager.destroyMachine).toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('should not destroy running machine without force flag', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      await expect(resolver.destroyMachine(machine.id, false)).rejects.toThrow(UserInputError);
      expect(mockVirtManager.destroyMachine).not.toHaveBeenCalled();
    });

    it('should throw error if machine not found', async () => {
      mockPrisma.machine.findUnique.mockResolvedValue(null);

      await expect(resolver.destroyMachine('non-existent')).rejects.toThrow(UserInputError);
    });
  });

  describe('powerOn', () => {
    it('should power on stopped machine', async () => {
      const machine = createMockMachine({ status: 'stopped' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.powerOn.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'running' });

      const result = await resolver.powerOn(machine.id);

      expect(mockVirtManager.powerOn).toHaveBeenCalledWith(machine.internalName);
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { status: 'running' },
      });
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('powered on'),
      });
    });

    it('should not power on already running machine', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      await expect(resolver.powerOn(machine.id)).rejects.toThrow(UserInputError);
      expect(mockVirtManager.powerOn).not.toHaveBeenCalled();
    });

    it('should handle libvirt power on failure', async () => {
      const machine = createMockMachine({ status: 'stopped' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.powerOn.mockRejectedValue(new Error('Failed to start domain'));

      await expect(resolver.powerOn(machine.id)).rejects.toThrow('Failed to start domain');
    });
  });

  describe('powerOff', () => {
    it('should power off running machine', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.powerOff.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'stopped' });

      const result = await resolver.powerOff(machine.id);

      expect(mockVirtManager.powerOff).toHaveBeenCalledWith(machine.internalName, false);
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { status: 'stopped' },
      });
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('powered off'),
      });
    });

    it('should force power off with force flag', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.powerOff.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'stopped' });

      await resolver.powerOff(machine.id, true);

      expect(mockVirtManager.powerOff).toHaveBeenCalledWith(machine.internalName, true);
    });

    it('should not power off already stopped machine', async () => {
      const machine = createMockMachine({ status: 'stopped' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      await expect(resolver.powerOff(machine.id)).rejects.toThrow(UserInputError);
      expect(mockVirtManager.powerOff).not.toHaveBeenCalled();
    });
  });

  describe('rebootMachine', () => {
    it('should reboot running machine', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.rebootMachine.mockResolvedValue({ success: true });

      const result = await resolver.rebootMachine(machine.id);

      expect(mockVirtManager.rebootMachine).toHaveBeenCalledWith(machine.internalName, false);
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('rebooted'),
      });
    });

    it('should force reboot with force flag', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.rebootMachine.mockResolvedValue({ success: true });

      await resolver.rebootMachine(machine.id, true);

      expect(mockVirtManager.rebootMachine).toHaveBeenCalledWith(machine.internalName, true);
    });

    it('should not reboot stopped machine', async () => {
      const machine = createMockMachine({ status: 'stopped' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      await expect(resolver.rebootMachine(machine.id)).rejects.toThrow(UserInputError);
    });
  });

  describe('suspendMachine', () => {
    it('should suspend running machine', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.suspendMachine.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'paused' });

      const result = await resolver.suspendMachine(machine.id);

      expect(mockVirtManager.suspendMachine).toHaveBeenCalledWith(machine.internalName);
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { status: 'paused' },
      });
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('suspended'),
      });
    });

    it('should not suspend already suspended machine', async () => {
      const machine = createMockMachine({ status: 'paused' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      await expect(resolver.suspendMachine(machine.id)).rejects.toThrow(UserInputError);
    });
  });

  describe('resumeMachine', () => {
    it('should resume suspended machine', async () => {
      const machine = createMockMachine({ status: 'paused' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.resumeMachine.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, status: 'running' });

      const result = await resolver.resumeMachine(machine.id);

      expect(mockVirtManager.resumeMachine).toHaveBeenCalledWith(machine.internalName);
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { status: 'running' },
      });
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('resumed'),
      });
    });

    it('should not resume running machine', async () => {
      const machine = createMockMachine({ status: 'running' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      await expect(resolver.resumeMachine(machine.id)).rejects.toThrow(UserInputError);
    });
  });

  describe('updateMachineResources', () => {
    it('should update machine CPU cores', async () => {
      const machine = createMockMachine({ cpuCores: 4 });
      const newCores = 8;
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.updateMachineResources.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, cpuCores: newCores });

      const result = await resolver.updateMachineResources(machine.id, { cpuCores: newCores });

      expect(mockVirtManager.updateMachineResources).toHaveBeenCalledWith(
        machine.internalName,
        { cpuCores: newCores }
      );
      expect(mockPrisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { cpuCores: newCores },
      });
      expect(result.cpuCores).toBe(newCores);
    });

    it('should update machine RAM', async () => {
      const machine = createMockMachine({ ramGB: 8 });
      const newRam = 16;
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.updateMachineResources.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, ramGB: newRam });

      const result = await resolver.updateMachineResources(machine.id, { ramGB: newRam });

      expect(mockVirtManager.updateMachineResources).toHaveBeenCalledWith(
        machine.internalName,
        { ramGB: newRam }
      );
      expect(result.ramGB).toBe(newRam);
    });

    it('should update machine disk size', async () => {
      const machine = createMockMachine({ diskSizeGB: 100 });
      const newDiskSize = 200;
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.updateMachineResources.mockResolvedValue({ success: true });
      mockPrisma.machine.update.mockResolvedValue({ ...machine, diskSizeGB: newDiskSize });

      const result = await resolver.updateMachineResources(machine.id, { diskSizeGB: newDiskSize });

      expect(mockVirtManager.updateMachineResources).toHaveBeenCalledWith(
        machine.internalName,
        { diskSizeGB: newDiskSize }
      );
      expect(result.diskSizeGB).toBe(newDiskSize);
    });

    it('should validate resource limits', async () => {
      const machine = createMockMachine();
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      // Test invalid CPU cores
      await expect(
        resolver.updateMachineResources(machine.id, { cpuCores: 0 })
      ).rejects.toThrow(UserInputError);

      // Test invalid RAM
      await expect(
        resolver.updateMachineResources(machine.id, { ramGB: -1 })
      ).rejects.toThrow(UserInputError);

      // Test invalid disk size (can't shrink)
      await expect(
        resolver.updateMachineResources(machine.id, { diskSizeGB: machine.diskSizeGB - 10 })
      ).rejects.toThrow(UserInputError);
    });
  });

  describe('getMachineStats', () => {
    it('should return machine statistics', async () => {
      const machine = createMockMachine({ status: 'running' });
      const stats = {
        cpuUsage: 45.5,
        memoryUsage: 4096,
        memoryTotal: 8192,
        diskRead: 1000000,
        diskWrite: 500000,
        networkRx: 2000000,
        networkTx: 1000000,
      };
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.getMachineStats.mockResolvedValue(stats);

      const result = await resolver.getMachineStats(machine.id);

      expect(mockVirtManager.getMachineStats).toHaveBeenCalledWith(machine.internalName);
      expect(result).toEqual(stats);
    });

    it('should return null for stopped machine', async () => {
      const machine = createMockMachine({ status: 'stopped' });
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);

      const result = await resolver.getMachineStats(machine.id);

      expect(mockVirtManager.getMachineStats).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });

  describe('setMachineAutostart', () => {
    it('should enable autostart', async () => {
      const machine = createMockMachine();
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.setAutostart.mockResolvedValue({ success: true });

      const result = await resolver.setMachineAutostart(machine.id, true);

      expect(mockVirtManager.setAutostart).toHaveBeenCalledWith(machine.internalName, true);
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('autostart enabled'),
      });
    });

    it('should disable autostart', async () => {
      const machine = createMockMachine();
      
      mockPrisma.machine.findUnique.mockResolvedValue(machine);
      mockVirtManager.setAutostart.mockResolvedValue({ success: true });

      const result = await resolver.setMachineAutostart(machine.id, false);

      expect(mockVirtManager.setAutostart).toHaveBeenCalledWith(machine.internalName, false);
      expect(result).toEqual({
        success: true,
        message: expect.stringContaining('autostart disabled'),
      });
    });
  });

  describe('Authorization Tests', () => {
    it('should allow USER to view their own machines', async () => {
      const user = createMockUser();
      const userMachine = createMockMachine({ userId: user.id });
      const context = createMockContext({ user });

      mockPrisma.machine.findUnique.mockResolvedValue(userMachine);

      const result = await resolver.machine(userMachine.id);
      expect(result).toEqual(userMachine);
    });

    it('should require ADMIN for createMachine', () => {
      const metadata = Reflect.getMetadata('custom:authorized', MachineResolver.prototype, 'createMachine');
      expect(metadata).toBe('ADMIN');
    });

    it('should require ADMIN for destroyMachine', () => {
      const metadata = Reflect.getMetadata('custom:authorized', MachineResolver.prototype, 'destroyMachine');
      expect(metadata).toBe('ADMIN');
    });

    it('should require USER for power operations', () => {
      const powerOnMeta = Reflect.getMetadata('custom:authorized', MachineResolver.prototype, 'powerOn');
      const powerOffMeta = Reflect.getMetadata('custom:authorized', MachineResolver.prototype, 'powerOff');
      const rebootMeta = Reflect.getMetadata('custom:authorized', MachineResolver.prototype, 'rebootMachine');
      
      expect(powerOnMeta).toBe('USER');
      expect(powerOffMeta).toBe('USER');
      expect(rebootMeta).toBe('USER');
    });
  });
});