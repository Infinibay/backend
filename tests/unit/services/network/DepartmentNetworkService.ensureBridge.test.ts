/**
 * Unit tests for DepartmentNetworkService.ensureDepartmentBridgeReady().
 *
 * This is the VM-create pre-flight that turns a late, cryptic TAP-attach failure
 * (`ip link set vnet... master <bridge> ... Device does not exist`) into either a
 * clear error (no network configured) or a self-heal (missing-but-configured
 * bridge is re-provisioned). DB-FREE: prisma and the infinization managers are
 * faked.
 */

// Mock the infinization managers the constructor instantiates. BridgeManager is
// the only one the ensure path touches; the others just need to construct.
const mockExists = jest.fn()
jest.mock('@infinibay/infinization', () => ({
  BridgeManager: jest.fn().mockImplementation(() => ({ exists: mockExists })),
  DepartmentNatService: jest.fn().mockImplementation(() => ({ initialize: jest.fn(), addMasquerade: jest.fn() })),
  TapDeviceManager: jest.fn().mockImplementation(() => ({}))
}))

// Silence the module logger.
jest.mock('@main/logger', () => ({
  __esModule: true,
  default: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }
}))

import { DepartmentNetworkService } from '../../../../app/services/network/DepartmentNetworkService'

function makeService (deptRow: any) {
  const prisma: any = {
    department: {
      findUnique: jest.fn().mockResolvedValue(deptRow),
      update: jest.fn().mockResolvedValue({})
    }
  }
  const svc = new DepartmentNetworkService(prisma)
  return { svc, prisma }
}

describe('ensureDepartmentBridgeReady', () => {
  beforeEach(() => {
    mockExists.mockReset()
  })

  it("throws an actionable error for a department with a bridge name but NO subnet (the 'Default' case)", async () => {
    const { svc } = makeService({ id: 'd1', name: 'Default', bridgeName: 'infbr0', ipSubnet: null })
    const provision = jest.spyOn(svc as any, 'provisionDepartmentBridge')

    await expect(svc.ensureDepartmentBridgeReady('d1')).rejects.toThrow(
      /Department 'Default' has no network configured.*bridge 'infbr0' has no subnet/i
    )
    // It must NOT attempt to create kernel resources for an unprovisionable dept.
    expect(provision).not.toHaveBeenCalled()
    expect(mockExists).not.toHaveBeenCalled()
  })

  it('throws when the department does not exist', async () => {
    const { svc } = makeService(null)
    await expect(svc.ensureDepartmentBridgeReady('missing')).rejects.toThrow(/not found/i)
  })

  it('returns the bridge name without provisioning when the bridge already exists (fast path)', async () => {
    const { svc } = makeService({ id: 'd2', name: 'QA', bridgeName: 'infinibr-37c595', ipSubnet: '10.10.1.0/24' })
    const provision = jest.spyOn(svc as any, 'provisionDepartmentBridge')
    mockExists.mockResolvedValue(true)

    await expect(svc.ensureDepartmentBridgeReady('d2')).resolves.toBe('infinibr-37c595')
    expect(provision).not.toHaveBeenCalled()
  })

  it('self-heals: provisions a missing-but-configured bridge, then returns it', async () => {
    const { svc } = makeService({ id: 'd3', name: 'QA', bridgeName: 'infinibr-37c595', ipSubnet: '10.10.1.0/24' })
    const provision = jest.spyOn(svc as any, 'provisionDepartmentBridge').mockResolvedValue(undefined)
    // Missing before provisioning, present after.
    mockExists.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await expect(svc.ensureDepartmentBridgeReady('d3')).resolves.toBe('infinibr-37c595')
    expect(provision).toHaveBeenCalledTimes(1)
  })

  it('throws a clear error when provisioning runs but the bridge still is not there', async () => {
    const { svc } = makeService({ id: 'd4', name: 'QA', bridgeName: 'infinibr-37c595', ipSubnet: '10.10.1.0/24' })
    jest.spyOn(svc as any, 'provisionDepartmentBridge').mockResolvedValue(undefined)
    mockExists.mockResolvedValue(false) // never comes up

    await expect(svc.ensureDepartmentBridgeReady('d4')).rejects.toThrow(
      /Failed to provision network bridge 'infinibr-37c595'.*NET_ADMIN/i
    )
  })
})
