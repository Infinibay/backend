import 'reflect-metadata'
import { testPrisma } from '../setup/jest.setup'
import { NodePlacementService } from '@services/node/NodePlacementService'
import { VMMigrationService } from '@services/node/VMMigrationService'

describe('Production readiness flows — real database', () => {
  const prisma = testPrisma.prisma
  const originalNodeName = process.env.INFINIBAY_NODE_NAME

  afterEach(() => {
    if (originalNodeName === undefined) {
      delete process.env.INFINIBAY_NODE_NAME
    } else {
      process.env.INFINIBAY_NODE_NAME = originalNodeName
    }
  })

  async function createNode (overrides: Partial<{
    id: string
    name: string
    cores: number
    ram: number
    maintenanceMode: boolean
  }> = {}) {
    return prisma.node.create({
      data: {
        id: overrides.id,
        name: overrides.name ?? `node-${Math.random().toString(16).slice(2)}`,
        currentRaid: 'none',
        cpuFlags: [],
        cores: overrides.cores ?? 16,
        ram: overrides.ram ?? 64 * 1024,
        maintenanceMode: overrides.maintenanceMode ?? false
      }
    })
  }

  async function createMachineOnNode (nodeId: string, overrides: Partial<{
    id: string
    name: string
    status: string
    cpuCores: number
    ramGB: number
    diskSizeGB: number
  }> = {}) {
    return prisma.machine.create({
      data: {
        id: overrides.id,
        name: overrides.name ?? `vm-${Math.random().toString(16).slice(2)}`,
        internalName: `${overrides.name ?? 'vm'}-internal`,
        status: overrides.status ?? 'off',
        os: 'ubuntu',
        cpuCores: overrides.cpuCores ?? 2,
        ramGB: overrides.ramGB ?? 4,
        diskSizeGB: overrides.diskSizeGB ?? 40,
        nodeId
      }
    })
  }

  it('places new VMs on the local healthy node when it has enough capacity', async () => {
    process.env.INFINIBAY_NODE_NAME = 'local-node'
    const local = await createNode({ name: 'local-node', cores: 12, ram: 32 * 1024 })
    await createNode({ name: 'remote-node', cores: 32, ram: 128 * 1024 })
    await createMachineOnNode(local.id, { cpuCores: 2, ramGB: 4 })

    const placement = new NodePlacementService(prisma)
    await expect(
      placement.chooseNodeForMachine({ cpuCores: 4, ramGB: 8, diskSizeGB: 80 })
    ).resolves.toBe(local.id)
  })

  it('skips maintenance nodes during placement', async () => {
    process.env.INFINIBAY_NODE_NAME = 'local-node'
    await createNode({ name: 'local-node', maintenanceMode: true })
    const remote = await createNode({ name: 'remote-node', cores: 16, ram: 64 * 1024 })

    const placement = new NodePlacementService(prisma)
    await expect(
      placement.chooseNodeForMachine({ cpuCores: 4, ramGB: 8, diskSizeGB: 80 })
    ).resolves.toBe(remote.id)
  })

  it('migrates only stopped VMs to healthy nodes with capacity', async () => {
    const source = await createNode({ name: 'source-node' })
    const target = await createNode({ name: 'target-node', cores: 16, ram: 64 * 1024 })
    const vm = await createMachineOnNode(source.id, { status: 'off', cpuCores: 4, ramGB: 8 })

    const result = await new VMMigrationService(prisma, { storageMode: 'shared' }).migrateStoppedMachineToNode(vm.id, target.id)
    const migrated = await prisma.machine.findUniqueOrThrow({ where: { id: vm.id } })

    expect(result).toEqual({
      success: true,
      machineId: vm.id,
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    expect(migrated.nodeId).toBe(target.id)
  })

  it('rejects cold migration to a node in maintenance mode', async () => {
    const source = await createNode({ name: 'source-node' })
    const target = await createNode({ name: 'target-node', maintenanceMode: true })
    const vm = await createMachineOnNode(source.id, { status: 'off' })

    await expect(
      new VMMigrationService(prisma, { storageMode: 'shared' }).migrateStoppedMachineToNode(vm.id, target.id)
    ).rejects.toThrow('Target node is in maintenance mode')

    const unchanged = await prisma.machine.findUniqueOrThrow({ where: { id: vm.id } })
    expect(unchanged.nodeId).toBe(source.id)
  })

  // NOTE: the former "enterprise permission overrides" test was removed — it
  // exercised the deleted RolePermissionService / role↔resource matrix. The
  // action/verb RBAC is covered by tests/integration/permissions/*.
})
