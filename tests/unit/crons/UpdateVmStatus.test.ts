import { classifyVmStatuses, VMProbe } from '@main/crons/UpdateVmStatus'

// Fake mapper mirroring StateSync.QMP_TO_DB_STATUS_MAP for the cases we exercise.
const fakeMapper = {
  mapQMPStatusToDBStatus: (s: string) =>
    (({ running: 'running', paused: 'suspended', suspended: 'suspended', shutdown: 'off' } as Record<string, string>)[s] ?? 'error')
} as any

function probes (entries: Array<[string, VMProbe]>): Map<string, VMProbe> {
  return new Map(entries)
}

describe('classifyVmStatuses (fallback status reconciliation)', () => {
  it('reflects a paused VM as suspended — never promotes it to running', () => {
    const vms = [{ id: 'vm1', status: 'running' }]
    const r = classifyVmStatuses(vms, probes([['vm1', { qmpStatus: 'paused', processAlive: true }]]), fakeMapper)
    expect(r.suspendedVmIds).toEqual(['vm1'])
    expect(r.runningVmIds).toEqual([])
    expect(r.stoppedVmIds).toEqual([])
  })

  it('promotes a genuinely running VM (off in DB) to running', () => {
    const vms = [{ id: 'vm1', status: 'off' }]
    const r = classifyVmStatuses(vms, probes([['vm1', { qmpStatus: 'running', processAlive: true }]]), fakeMapper)
    expect(r.runningVmIds).toEqual(['vm1'])
  })

  it('never demotes a live-but-paused VM whose QMP is unreachable (no run-state)', () => {
    // processAlive=true but qmpStatus=null -> desired=null -> leave as-is. This is
    // the bug the fix closes (the old code collapsed to processAlive and could flip).
    const vms = [{ id: 'vm1', status: 'running' }]
    const r = classifyVmStatuses(vms, probes([['vm1', { qmpStatus: null, processAlive: true }]]), fakeMapper)
    expect(r.runningVmIds).toEqual([])
    expect(r.stoppedVmIds).toEqual([])
    expect(r.suspendedVmIds).toEqual([])
  })

  it('demotes a dead VM (no process) to off only from a previously-live state', () => {
    const vms = [
      { id: 'wasRunning', status: 'running' },
      { id: 'wasSuspended', status: 'suspended' },
      { id: 'alreadyOff', status: 'off' }
    ]
    const r = classifyVmStatuses(vms, probes([
      ['wasRunning', { qmpStatus: null, processAlive: false }],
      ['wasSuspended', { qmpStatus: null, processAlive: false }],
      ['alreadyOff', { qmpStatus: null, processAlive: false }]
    ]), fakeMapper)
    expect(r.stoppedVmIds.sort()).toEqual(['wasRunning', 'wasSuspended'])
  })

  it('leaves a paused-in-DB VM that is still paused untouched (no churn)', () => {
    const vms = [{ id: 'vm1', status: 'suspended' }]
    const r = classifyVmStatuses(vms, probes([['vm1', { qmpStatus: 'paused', processAlive: true }]]), fakeMapper)
    expect(r.runningVmIds).toEqual([])
    expect(r.stoppedVmIds).toEqual([])
    expect(r.suspendedVmIds).toEqual([])
  })

  it('never touches a VM mid-transition (starting), even if the probe says off', () => {
    const vms = [{ id: 'vm1', status: 'starting' }]
    const r = classifyVmStatuses(vms, probes([['vm1', { qmpStatus: null, processAlive: false }]]), fakeMapper)
    expect(r.runningVmIds).toEqual([])
    expect(r.stoppedVmIds).toEqual([])
    expect(r.suspendedVmIds).toEqual([])
  })
})
