/**
 * OverlayCoordinatorService unit tests — the master-side overlay control plane. All
 * IO (Prisma, the node dispatcher, local-node resolution) is mocked, so these assert
 * the coordination LOGIC (VNI allocation, membership, single-gateway election, the
 * fail-closed contract, teardown hand-off) without a cluster.
 */
import { OverlayCoordinatorService } from '@services/network/OverlayCoordinatorService'

// mockResolveLocalNodeId lives in InfinizationService (which pulls in the whole VM stack);
// mock the module so importing the coordinator never constructs it.
const mockResolveLocalNodeId = jest.fn<Promise<string | undefined>, []>()
jest.mock('@services/InfinizationService', () => ({ resolveLocalNodeId: () => mockResolveLocalNodeId() }))

interface Exec { ensureSegment: jest.Mock, setPeers: jest.Mock, destroySegment: jest.Mock }

function makeDispatcher () {
  const execs = new Map<string, Exec>()
  const failOn = new Set<string>()
  const executorForNode = jest.fn(async (nodeId: string): Promise<Exec> => {
    let e = execs.get(nodeId)
    if (!e) {
      e = {
        ensureSegment: jest.fn(async () => { if (failOn.has(nodeId)) throw new Error(`realize failed on ${nodeId}`) }),
        setPeers: jest.fn(async () => {}),
        destroySegment: jest.fn(async () => {})
      }
      execs.set(nodeId, e)
    }
    return e
  })
  return { dispatcher: { executorForNode } as any, execs, executorForNode, failOn }
}

const UNDERLAY = (n: string) => ({ nodeId: n, vtepIp: `10.77.0.${n.length}`, wgPubKey: `PUB_${n}`, wgEndpoint: `192.168.0.${n.length}:51820` })

function makePrisma (opts: {
  dept?: any
  machines?: Array<{ nodeId: string, status: string }>
  underlays?: string[] // node ids that HAVE an underlay
  maxVni?: number | null
} = {}) {
  const dept = opts.dept ?? { id: 'D', bridgeName: 'infinibr-abc123', ipSubnet: '10.10.100.0/24', gatewayIP: '10.10.100.1', overlayMtu: 1370, gatewayNodeId: null, vni: null }
  const underlaySet = new Set(opts.underlays ?? [])
  const update = jest.fn(async () => ({}))
  const updateMany = jest.fn(async () => ({ count: 1 }))
  return {
    prisma: {
      department: {
        findUnique: jest.fn(async ({ select }: any) => (select?.vni && Object.keys(select).length === 1 ? { vni: dept.vni } : dept)),
        findMany: jest.fn(async () => []),
        update,
        updateMany,
        aggregate: jest.fn(async () => ({ _max: { vni: opts.maxVni ?? null } }))
      },
      machine: { findMany: jest.fn(async () => opts.machines ?? []) },
      nodeUnderlay: {
        findUnique: jest.fn(async ({ where }: any) => underlaySet.has(where.nodeId) ? UNDERLAY(where.nodeId) : null),
        findMany: jest.fn(async ({ where }: any) => (where.nodeId.in as string[]).filter(n => underlaySet.has(n)).map(UNDERLAY))
      }
    } as any,
    update,
    updateMany,
    dept
  }
}

beforeEach(() => { mockResolveLocalNodeId.mockReset() })

describe('ensurePlacement', () => {
  it('is a no-op for a single-host department (only the master hosts it)', async () => {
    mockResolveLocalNodeId.mockResolvedValue('master')
    const { prisma } = makePrisma({ machines: [{ nodeId: 'master', status: 'running' }], underlays: ['master'] })
    const { dispatcher, executorForNode } = makeDispatcher()
    await new OverlayCoordinatorService(prisma, dispatcher).ensurePlacement('D', 'master')
    expect(executorForNode).not.toHaveBeenCalled()
  })

  it('FAIL-CLOSED: throws when the target node has no NodeUnderlay identity', async () => {
    mockResolveLocalNodeId.mockResolvedValue('master')
    const { prisma } = makePrisma({ machines: [{ nodeId: 'nodeB', status: 'off' }], underlays: ['master'] /* nodeB missing */ })
    const { dispatcher } = makeDispatcher()
    await expect(new OverlayCoordinatorService(prisma, dispatcher).ensurePlacement('D', 'nodeB'))
      .rejects.toThrow(/no.*WireGuard\/VTEP identity/i)
  })

  it('realizes every member; the master is the gateway owner with the gateway CIDR', async () => {
    mockResolveLocalNodeId.mockResolvedValue('master')
    const { prisma } = makePrisma({ machines: [{ nodeId: 'nodeB', status: 'running' }, { nodeId: 'master', status: 'running' }], underlays: ['master', 'nodeB'], maxVni: 5000 })
    const { dispatcher, execs } = makeDispatcher()
    await new OverlayCoordinatorService(prisma, dispatcher).ensurePlacement('D', 'nodeB')

    const masterSpec = execs.get('master')!.ensureSegment.mock.calls[0][0]
    const nodeBSpec = execs.get('nodeB')!.ensureSegment.mock.calls[0][0]
    expect(masterSpec.isGatewayOwner).toBe(true)
    expect(masterSpec.gatewayCidr).toBe('10.10.100.1/24')
    expect(nodeBSpec.isGatewayOwner).toBe(false)
    expect(nodeBSpec.vni).toBe(5001) // allocated max+1
    // Each member's peer set excludes itself.
    expect(nodeBSpec.peers.map((p: any) => p.nodeId)).toEqual(['master'])
    expect(masterSpec.peers.map((p: any) => p.nodeId)).toEqual(['nodeB'])
  })

  it('FAIL-CLOSED: rethrows when the GATEWAY OWNER (not just the target) fails to realize', async () => {
    mockResolveLocalNodeId.mockResolvedValue('master')
    const { prisma } = makePrisma({ machines: [{ nodeId: 'nodeB', status: 'running' }, { nodeId: 'master', status: 'running' }], underlays: ['master', 'nodeB'] })
    const { dispatcher, failOn } = makeDispatcher()
    failOn.add('master') // the gateway owner's realize rejects
    await expect(new OverlayCoordinatorService(prisma, dispatcher).ensurePlacement('D', 'nodeB'))
      .rejects.toThrow(/realize failed on master/)
  })

  it('throws fail-closed when the master cannot resolve its own node id but the dept is multi-node', async () => {
    mockResolveLocalNodeId.mockResolvedValue(undefined)
    const { prisma } = makePrisma({ machines: [{ nodeId: 'nodeB', status: 'running' }, { nodeId: 'nodeC', status: 'running' }], underlays: ['nodeB', 'nodeC'] })
    const { dispatcher } = makeDispatcher()
    await expect(new OverlayCoordinatorService(prisma, dispatcher).ensurePlacement('D', 'nodeB'))
      .rejects.toThrow(/could not resolve its own/i)
  })

  it('FAIL-CLOSED: throws (never elects a compute gateway) when the MASTER has no NodeUnderlay', async () => {
    mockResolveLocalNodeId.mockResolvedValue('master')
    // Two compute members have identities; the master (gateway owner) has none.
    const { prisma } = makePrisma({ machines: [{ nodeId: 'nodeB', status: 'running' }, { nodeId: 'nodeC', status: 'running' }], underlays: ['nodeB', 'nodeC'] /* master missing */ })
    const { dispatcher, executorForNode } = makeDispatcher()
    await expect(new OverlayCoordinatorService(prisma, dispatcher).ensurePlacement('D', 'nodeB'))
      .rejects.toThrow(/master node master has no.*NodeUnderlay/i)
    expect(executorForNode).not.toHaveBeenCalled() // nothing realized — no compute gateway elected
  })
})

describe('allocateVniIfNeeded', () => {
  it('returns the existing VNI without allocating', async () => {
    const { prisma, updateMany } = makePrisma({ dept: { id: 'D', vni: 4242, bridgeName: 'infinibr-x', ipSubnet: '10.0.0.0/24', gatewayIP: '10.0.0.1', overlayMtu: 1370, gatewayNodeId: null } })
    const vni = await new OverlayCoordinatorService(prisma, makeDispatcher().dispatcher).allocateVniIfNeeded('D')
    expect(vni).toBe(4242)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('allocates VNI_MIN (4096) for the first cross-node department', async () => {
    const { prisma } = makePrisma({ maxVni: null })
    const vni = await new OverlayCoordinatorService(prisma, makeDispatcher().dispatcher).allocateVniIfNeeded('D')
    expect(vni).toBe(4096)
  })
})

describe('teardownIfEmpty', () => {
  it('does nothing when the node still hosts a department VM', async () => {
    mockResolveLocalNodeId.mockResolvedValue('master')
    const { prisma } = makePrisma({ machines: [{ nodeId: 'nodeB', status: 'running' }], underlays: ['master', 'nodeB'] })
    const { dispatcher, execs } = makeDispatcher()
    await new OverlayCoordinatorService(prisma, dispatcher).teardownIfEmpty('D', 'nodeB')
    expect(execs.get('nodeB')?.destroySegment).toBeUndefined()
  })

  it('destroys the departed node segment and re-elects the gateway owner on drain', async () => {
    mockResolveLocalNodeId.mockResolvedValue('master')
    // nodeB was the gateway owner and is now gone; master survives.
    const dept = { id: 'D', bridgeName: 'infinibr-abc123', ipSubnet: '10.10.100.0/24', gatewayIP: '10.10.100.1', overlayMtu: 1370, gatewayNodeId: 'nodeB', vni: 5000 }
    const { prisma, update } = makePrisma({ dept, machines: [{ nodeId: 'master', status: 'running' }], underlays: ['master'] })
    const { dispatcher, execs } = makeDispatcher()
    await new OverlayCoordinatorService(prisma, dispatcher).teardownIfEmpty('D', 'nodeB')
    expect(execs.get('nodeB')!.destroySegment).toHaveBeenCalledWith('D', 'infinibr-abc123')
    // Gateway re-elected to the surviving master and persisted.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { gatewayNodeId: 'master' } }))
    // The new owner is re-realized (full ensureSegment, gateway CIDR set) — not just setPeers.
    const masterSpec = execs.get('master')!.ensureSegment.mock.calls[0][0]
    expect(masterSpec.isGatewayOwner).toBe(true)
    expect(masterSpec.gatewayCidr).toBe('10.10.100.1/24')
  })
})
