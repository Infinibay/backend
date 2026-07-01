/**
 * Unit tests for DepartmentNetworkService.ensureDepartmentBridgeReady().
 *
 * This is the VM-create pre-flight that turns a late, cryptic TAP-attach failure
 * (`ip link set vnet... master <bridge> ... Device does not exist`) into either a
 * clear error (no network configured) or a self-heal (missing-but-configured
 * bridge is re-provisioned). DB-FREE: prisma and the infinization managers are
 * faked.
 */

// Mock the infinization managers the constructor instantiates. KeyedMutex is a
// REAL (functional) minimal impl so the per-department serialization is actually
// exercised, not stubbed away.
const mockExists = jest.fn()
const mockCreate = jest.fn()
const mockAssignIP = jest.fn()
const mockHasMasquerade = jest.fn()
const mockAddMasquerade = jest.fn()
jest.mock('@infinibay/infinization', () => {
  class KeyedMutex {
    chains = new Map<string, Promise<unknown>>()
    async runExclusive<T> (key: string, fn: () => Promise<T>): Promise<T> {
      const prev = this.chains.get(key) ?? Promise.resolve()
      let release!: () => void
      const gate = new Promise<void>((r) => { release = r })
      this.chains.set(key, prev.then(() => gate))
      await prev
      try { return await fn() } finally { release() }
    }
  }
  return {
    BridgeManager: jest.fn().mockImplementation(() => ({ exists: mockExists, create: mockCreate, assignIP: mockAssignIP })),
    DepartmentNatService: jest.fn().mockImplementation(() => ({ initialize: jest.fn(), addMasquerade: mockAddMasquerade, hasMasquerade: mockHasMasquerade })),
    TapDeviceManager: jest.fn().mockImplementation(() => ({})),
    KeyedMutex
  }
})

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
    mockCreate.mockReset().mockResolvedValue(undefined)
    mockAssignIP.mockReset().mockResolvedValue(undefined)
    mockHasMasquerade.mockReset().mockResolvedValue(true)
    mockAddMasquerade.mockReset().mockResolvedValue(undefined)
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

  it('fast path: bridge exists -> returns it, repairs DHCP/NAT, does NOT provision', async () => {
    const { svc } = makeService({ id: 'd2', name: 'QA', bridgeName: 'infinibr-37c595', ipSubnet: '10.10.1.0/24' })
    const provision = jest.spyOn(svc as any, 'provisionDepartmentBridge')
    const repair = jest.spyOn(svc as any, 'ensureDepartmentServices').mockResolvedValue(undefined)
    mockExists.mockResolvedValue(true)

    await expect(svc.ensureDepartmentBridgeReady('d2')).resolves.toBe('infinibr-37c595')
    expect(provision).not.toHaveBeenCalled()
    // A bridge that exists but lost its dnsmasq/NAT must be repaired, not blindly
    // returned as "ready" (else VMs attach to a DHCP/NAT-less network silently).
    expect(repair).toHaveBeenCalledTimes(1)
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

  it('serializes two concurrent self-heals of the SAME department (provisions ONCE, no TOCTOU)', async () => {
    const { svc } = makeService({ id: 'd5', name: 'QA', bridgeName: 'infinibr-abc', ipSubnet: '10.10.5.0/24' })
    jest.spyOn(svc as any, 'ensureDepartmentServices').mockResolvedValue(undefined)
    const provision = jest.spyOn(svc as any, 'provisionDepartmentBridge').mockResolvedValue(undefined)
    // First caller: missing -> provision -> now present. Second caller (serialized
    // behind the lock) then sees it present and takes the fast path.
    mockExists.mockResolvedValueOnce(false).mockResolvedValue(true)

    const [a, b] = await Promise.all([
      svc.ensureDepartmentBridgeReady('d5'),
      svc.ensureDepartmentBridgeReady('d5')
    ])

    expect(a).toBe('infinibr-abc')
    expect(b).toBe('infinibr-abc')
    // Without the KeyedMutex both would have provisioned (loser's `ip link add`
    // would throw 'Bridge already exists' and fail its create).
    expect(provision).toHaveBeenCalledTimes(1)
  })

  it('provisionDepartmentBridge rolls back the bridge/IP it created when a later step fails', async () => {
    const { svc } = makeService({ id: 'd6', name: 'QA', bridgeName: 'infinibr-roll', ipSubnet: '10.10.6.0/24' })
    const dept = { id: 'd6', name: 'QA', bridgeName: 'infinibr-roll', ipSubnet: '10.10.6.0/24', dnsServers: [], ntpServers: [], mtu: null }

    jest.spyOn(svc as any, 'configureBridgeNetfilter').mockResolvedValue(undefined)
    jest.spyOn(svc as any, 'ensureDirectories').mockResolvedValue(undefined)
    jest.spyOn(svc as any, 'parseSubnet').mockReturnValue({
      bridgeName: 'ignored', gatewayIP: '10.10.6.1', netmask: '24', dnsServers: [], ntpServers: [], dhcpStart: '', dhcpEnd: ''
    })
    // bridge + IP succeed (mockCreate/mockAssignIP resolve), then dnsmasq fails.
    jest.spyOn(svc as any, 'startDnsmasq').mockRejectedValue(new Error('dnsmasq could not bind :67'))
    const rollback = jest.spyOn(svc as any, 'rollback').mockResolvedValue(undefined)

    await expect((svc as any).provisionDepartmentBridge(dept)).rejects.toThrow(/dnsmasq could not bind/)

    // The bridge + IP that WERE created get torn down; dnsmasq/nat were not.
    expect(rollback).toHaveBeenCalledTimes(1)
    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({ bridgeName: 'infinibr-roll' }),
      { bridge: true, ip: true, dnsmasq: false, nat: false }
    )
    // The DB dnsmasqPid write must NOT have happened (provisioning failed).
    // (mockAddMasquerade never reached either.)
    expect(mockAddMasquerade).not.toHaveBeenCalled()
  })
})
