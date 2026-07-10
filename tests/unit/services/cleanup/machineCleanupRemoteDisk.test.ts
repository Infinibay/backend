import 'reflect-metadata'
import { MachineCleanupServiceV2 } from '@services/cleanup/machineCleanupServiceV2'
import { mockDeep, DeepMockProxy } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

/**
 * Focused tests for the multi-node disk reclaim on VM delete: a VM owned by a
 * REMOTE node keeps its qcow2 on that node's filesystem, so cleanupDiskFiles must
 * dispatch `/agent/disk/delete` to the owning node's agent (mTLS) instead of only
 * unlinking locally (which would ENOENT and silently leak the disk).
 */

const mockHttpsJsonPost = jest.fn()
const mockResolveLocalNodeId = jest.fn<Promise<string | undefined>, []>()

jest.mock('@services/node/clusterMtls', () => ({
  httpsJsonPost: (...a: unknown[]) => mockHttpsJsonPost(...a)
}))
jest.mock('@services/node/NodeDispatcher', () => ({
  NodeDispatcher: jest.fn(),
  masterIdentity: jest.fn(() => ({ certPem: 'c', keyPem: 'k', caPem: 'a' }))
}))
jest.mock('@services/InfinizationService', () => ({
  getInfinization: jest.fn(() => Promise.resolve({ destroyVM: jest.fn().mockResolvedValue({ success: true }) })),
  resolveLocalNodeId: () => mockResolveLocalNodeId()
}))
jest.mock('../../../../app/services/VirtioSocketWatcherService', () => ({
  getVirtioSocketWatcherService: jest.fn(() => ({ cleanupVmConnection: jest.fn().mockResolvedValue(undefined) }))
}))
jest.mock('fs/promises', () => ({
  // Local unlinks always ENOENT here (disk lives on the remote node, not the master).
  unlink: jest.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' }))
}))

const REMOTE_DISK = '/opt/infinibay/disks/vm-abc.qcow2'

function makeService (nodeId: string | null): { service: MachineCleanupServiceV2, prisma: DeepMockProxy<PrismaClient>, destroyVM: jest.Mock } {
  const prisma = mockDeep<PrismaClient>()
  prisma.machine.findUnique.mockResolvedValue({
    id: 'vm1', internalName: 'vm-abc', nodeId, configuration: { diskPaths: [REMOTE_DISK] }
  } as any)
  prisma.node.findUnique.mockResolvedValue({ name: 'nodeB', address: '10.0.0.8', agentPort: 9443, status: 'online' } as any)
  const destroyVM = jest.fn().mockResolvedValue({ success: true })
  const dispatcher: any = { executorFor: jest.fn().mockResolvedValue({ destroyVM }) }
  return { service: new MachineCleanupServiceV2(prisma, dispatcher), prisma, destroyVM }
}

describe('MachineCleanupServiceV2 — remote-node disk reclaim', () => {
  const OLD_ENV = process.env.INFINIBAY_CLUSTER_MTLS
  beforeEach(() => { jest.clearAllMocks(); mockResolveLocalNodeId.mockResolvedValue('master') })
  afterAll(() => { process.env.INFINIBAY_CLUSTER_MTLS = OLD_ENV })

  it('dispatches /agent/disk/delete to the owning node for a remote VM', async () => {
    process.env.INFINIBAY_CLUSTER_MTLS = '1'
    mockHttpsJsonPost.mockResolvedValue({ status: 200, text: JSON.stringify({ ok: true, deleted: true }) })
    const { service } = makeService('nodeB')

    await service.cleanupRuntimeResources('vm1', true)

    const call = mockHttpsJsonPost.mock.calls.find(c => String(c[0]).includes(REMOTE_DISK) || (c[1] as any)?.path === REMOTE_DISK)
    expect(call).toBeTruthy()
    expect(String(call![0])).toBe('https://10.0.0.8:9443/agent/disk/delete')
    expect((call![1] as any).path).toBe(REMOTE_DISK)
    // 4th arg pins the target node CN so a rogue node can't impersonate the agent.
    expect((call![3] as any).expectedCn).toBe('nodeB')
  })

  it('does NOT dispatch for a VM owned by THIS host (local disk)', async () => {
    process.env.INFINIBAY_CLUSTER_MTLS = '1'
    mockResolveLocalNodeId.mockResolvedValue('master')
    const { service } = makeService('master') // owner === local node id

    await service.cleanupRuntimeResources('vm1', true)

    expect(mockHttpsJsonPost).not.toHaveBeenCalled()
  })

  it('does NOT dispatch (and leaves the disk) when cluster mTLS is off', async () => {
    process.env.INFINIBAY_CLUSTER_MTLS = '0'
    const { service } = makeService('nodeB')

    await service.cleanupRuntimeResources('vm1', true)

    expect(mockHttpsJsonPost).not.toHaveBeenCalled()
  })
})
