import { RuleSetType } from '@prisma/client'
import { MachineCleanupServiceV2 } from '@services/cleanup/machineCleanupServiceV2'
import { DepartmentCleanupService } from '@services/cleanup/departmentCleanupService'
import { testPrisma } from '../../setup/jest.setup'
import { createAdmin, createDepartment, createMachine } from '../../setup/db-factories'

// External systems stay mocked — this test is about the DB-side cleanup.
const mockDestroyVM = jest.fn().mockResolvedValue({ success: true })
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => ({
    destroyVM: mockDestroyVM,
    getNftablesService: jest.fn(() => ({ chainExists: jest.fn().mockResolvedValue(false) }))
  }))
}))

jest.mock('@infinibay/infinization', () => ({
  TapDeviceManager: jest.fn().mockImplementation(() => ({
    exists: jest.fn().mockResolvedValue(false)
  })),
  generateVMChainName: jest.fn((id: string) => `vm_${id.substring(0, 8)}`)
}))

jest.mock('@services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => ({
    cleanupVmConnection: jest.fn()
  }))
}))

jest.mock('@services/network/DepartmentNetworkService', () => ({
  DepartmentNetworkService: jest.fn().mockImplementation(() => ({
    destroyNetwork: jest.fn().mockResolvedValue(undefined),
    forceDestroyNetwork: jest.fn().mockResolvedValue({ success: true })
  }))
}))

jest.mock('fs/promises', () => ({
  unlink: jest.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  readdir: jest.fn().mockResolvedValue([])
}))

describe('Firewall cleanup — real database', () => {
  const prisma = testPrisma.prisma
  const machineCleanup = () => new MachineCleanupServiceV2(prisma)
  const departmentCleanup = () => new DepartmentCleanupService(prisma)

  let admin: Awaited<ReturnType<typeof createAdmin>>
  let department: Awaited<ReturnType<typeof createDepartment>>

  beforeEach(async () => {
    admin = await createAdmin(prisma)
    department = await createDepartment(prisma)
    mockDestroyVM.mockReset()
    mockDestroyVM.mockResolvedValue({ success: true })
  })

  async function seedVMWithRuleset (rulesCount = 0) {
    const vm = await createMachine(prisma, {
      userId: admin.id,
      departmentId: department.id,
      withConfiguration: true
    })
    const ruleSet = await prisma.firewallRuleSet.create({
      data: {
        name: `VM Firewall ${vm.id}`,
        internalName: `vm-${vm.id.substring(0, 8)}`,
        entityType: RuleSetType.VM,
        entityId: vm.id,
        priority: 500,
        isActive: true,
      }
    })
    await prisma.machine.update({
      where: { id: vm.id },
      data: { firewallRuleSetId: ruleSet.id }
    })
    for (let i = 0; i < rulesCount; i++) {
      await prisma.firewallRule.create({
        data: {
          ruleSetId: ruleSet.id,
          name: `Rule ${i}`,
          action: 'ACCEPT',
          direction: 'IN',
          priority: 100 + i,
          protocol: 'tcp',
        }
      })
    }
    return { vm, ruleSet }
  }

  describe('VM firewall cleanup', () => {
    it('calls infinization.destroyVM as part of cleanup', async () => {
      const { vm } = await seedVMWithRuleset(1)
      await machineCleanup().cleanupVM(vm.id)
      expect(mockDestroyVM).toHaveBeenCalledWith(vm.id)
    })

    it('removes the VM FirewallRuleSet and its rules from the DB', async () => {
      const { vm, ruleSet } = await seedVMWithRuleset(3)
      expect(await prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(3)

      await machineCleanup().cleanupVM(vm.id)

      expect(await prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(0)
      expect(await prisma.firewallRuleSet.findUnique({ where: { id: ruleSet.id } })).toBeNull()
      expect(await prisma.machine.findUnique({ where: { id: vm.id } })).toBeNull()
    })

    it('deletes the VM even when it has no firewall rule set', async () => {
      const vm = await createMachine(prisma, {
        userId: admin.id,
        departmentId: department.id,
        withConfiguration: true
      })

      await expect(machineCleanup().cleanupVM(vm.id)).resolves.not.toThrow()
      expect(await prisma.machine.findUnique({ where: { id: vm.id } })).toBeNull()
    })

    it('FAILS CLOSED: preserves the VM row when infinization teardown reports failure', async () => {
      const { vm } = await seedVMWithRuleset()
      mockDestroyVM.mockResolvedValueOnce({ success: false, error: 'Process not found' })

      // Physical teardown failed => keep the row (for retry) and surface the failure.
      await expect(machineCleanup().cleanupVM(vm.id)).rejects.toThrow(/physical teardown failed/)
      const stillThere = await prisma.machine.findUnique({ where: { id: vm.id } })
      expect(stillThere).not.toBeNull()
    })
  })

  describe('Department firewall cleanup', () => {
    async function seedDepartmentWithRuleset (rulesCount = 0) {
      const ruleSet = await prisma.firewallRuleSet.create({
        data: {
          name: `Dept Firewall ${department.id}`,
          internalName: `dept-${department.id.substring(0, 8)}`,
          entityType: RuleSetType.DEPARTMENT,
          entityId: department.id,
          priority: 1000,
          isActive: true,
        }
      })
      await prisma.department.update({
        where: { id: department.id },
        data: { firewallRuleSetId: ruleSet.id }
      })
      for (let i = 0; i < rulesCount; i++) {
        await prisma.firewallRule.create({
          data: {
            ruleSetId: ruleSet.id,
            name: `Rule ${i}`,
            action: 'ACCEPT',
            direction: 'IN',
            priority: 100 + i,
            protocol: 'tcp',
          }
        })
      }
      return ruleSet
    }

    it('removes the department, its FirewallRuleSet, and rules from the DB', async () => {
      const ruleSet = await seedDepartmentWithRuleset(2)
      expect(await prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(2)

      await departmentCleanup().cleanupDepartment(department.id)

      expect(await prisma.firewallRule.count({ where: { ruleSetId: ruleSet.id } })).toBe(0)
      expect(await prisma.firewallRuleSet.findUnique({ where: { id: ruleSet.id } })).toBeNull()
      expect(await prisma.department.findUnique({ where: { id: department.id } })).toBeNull()
    })

    it('refuses to delete a department that still has VMs', async () => {
      await createMachine(prisma, { userId: admin.id, departmentId: department.id })
      await createMachine(prisma, { userId: admin.id, departmentId: department.id })

      await expect(departmentCleanup().cleanupDepartment(department.id))
        .rejects.toThrow(/VMs still exist/)

      // Department remains.
      expect(await prisma.department.findUnique({ where: { id: department.id } })).not.toBeNull()
    })

    it('deletes the department when it has no firewall rule set', async () => {
      await departmentCleanup().cleanupDepartment(department.id)
      expect(await prisma.department.findUnique({ where: { id: department.id } })).toBeNull()
    })
  })
})
