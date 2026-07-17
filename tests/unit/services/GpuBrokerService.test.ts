import 'reflect-metadata'
import {
  GpuBrokerService,
  GpuAdmissionError,
  extractGpuPolicy,
  DepartmentGpuPolicy
} from '../../../app/services/GpuBrokerService'

function policy (overrides: Partial<DepartmentGpuPolicy> = {}): DepartmentGpuPolicy {
  return {
    gpuEnabled: true,
    vramReserveMB: 1024,
    vramCapMB: 4096,
    priorityTier: 2,
    maxConcurrentGpuVMs: 8,
    gpuTimeWeight: 1,
    submissionRateTokens: 50000,
    ...overrides
  }
}

describe('GpuBrokerService', () => {
  describe('admit — fail-closed policy gate', () => {
    it('admits an enabled department VM and reserves its VRAM cap by default', () => {
      const broker = new GpuBrokerService({ totalVramMB: 10000, hostReserveMB: 1000 })
      const cfg = broker.admit({ vmId: 'vm-1', departmentId: 'dep-a', policy: policy({ vramCapMB: 2048, gpuTimeWeight: 4 }) })
      expect(cfg).toMatchObject({ vmId: 'vm-1', weight: 4, vramCapMB: 2048, vramReservedMB: 2048, priorityTier: 2 })
      expect(broker.isAdmitted('vm-1')).toBe(true)
      // 10000 - 1000 reserve - 2048 = 6952
      expect(broker.availableVramMB()).toBe(6952)
    })

    it('denies with GpuDisabled when the department has GPU off', () => {
      const broker = new GpuBrokerService({ totalVramMB: 10000, hostReserveMB: 1000 })
      expect(() => broker.admit({ vmId: 'vm-x', departmentId: 'dep-a', policy: policy({ gpuEnabled: false }) }))
        .toThrow(GpuAdmissionError)
      try {
        broker.admit({ vmId: 'vm-x', departmentId: 'dep-a', policy: policy({ gpuEnabled: false }) })
      } catch (e) {
        expect((e as GpuAdmissionError).reason.code).toBe('GpuDisabled')
      }
      expect(broker.isAdmitted('vm-x')).toBe(false)
    })

    it('rejects double-admitting the same vmId (AlreadyAdmitted)', () => {
      const broker = new GpuBrokerService({ totalVramMB: 10000, hostReserveMB: 1000 })
      broker.admit({ vmId: 'vm-1', departmentId: 'dep-a', policy: policy() })
      try {
        broker.admit({ vmId: 'vm-1', departmentId: 'dep-a', policy: policy() })
        fail('expected AlreadyAdmitted')
      } catch (e) {
        expect((e as GpuAdmissionError).reason.code).toBe('AlreadyAdmitted')
      }
    })

    it('rejects a request above the per-VM VRAM cap (ExceedsVmCap)', () => {
      const broker = new GpuBrokerService({ totalVramMB: 100000, hostReserveMB: 1000 })
      try {
        broker.admit({ vmId: 'vm-1', departmentId: 'dep-a', policy: policy({ vramCapMB: 2048 }), requestedVramMB: 4096 })
        fail('expected ExceedsVmCap')
      } catch (e) {
        expect((e as GpuAdmissionError).reason.code).toBe('ExceedsVmCap')
      }
    })

    it('enforces the department concurrency cap (AtConcurrencyCap)', () => {
      const broker = new GpuBrokerService({ totalVramMB: 100000, hostReserveMB: 0 })
      const p = policy({ maxConcurrentGpuVMs: 2, vramCapMB: 1024 })
      broker.admit({ vmId: 'a1', departmentId: 'dep-a', policy: p })
      broker.admit({ vmId: 'a2', departmentId: 'dep-a', policy: p })
      try {
        broker.admit({ vmId: 'a3', departmentId: 'dep-a', policy: p })
        fail('expected AtConcurrencyCap')
      } catch (e) {
        expect((e as GpuAdmissionError).reason.code).toBe('AtConcurrencyCap')
      }
      // a different department is unaffected by dep-a's cap
      expect(() => broker.admit({ vmId: 'b1', departmentId: 'dep-b', policy: p })).not.toThrow()
    })

    it('enforces the host VRAM ledger (InsufficientVram)', () => {
      // 5000 total - 1000 reserve = 4000 admittable
      const broker = new GpuBrokerService({ totalVramMB: 5000, hostReserveMB: 1000 })
      const p = policy({ vramCapMB: 3000, maxConcurrentGpuVMs: 10 })
      broker.admit({ vmId: 'vm-1', departmentId: 'dep-a', policy: p }) // reserves 3000 → 1000 left
      try {
        broker.admit({ vmId: 'vm-2', departmentId: 'dep-a', policy: p }) // wants 3000, only 1000 free
        fail('expected InsufficientVram')
      } catch (e) {
        const r = (e as GpuAdmissionError).reason
        expect(r.code).toBe('InsufficientVram')
        if (r.code === 'InsufficientVram') {
          expect(r.requestedMB).toBe(3000)
          expect(r.availableMB).toBe(1000)
        }
      }
    })
  })

  describe('release + ledger', () => {
    it('release frees the reservation and concurrency slot, allowing re-admit', () => {
      const broker = new GpuBrokerService({ totalVramMB: 5000, hostReserveMB: 1000 })
      broker.admit({ vmId: 'vm-1', departmentId: 'dep-a', policy: policy({ vramCapMB: 4000 }) })
      expect(broker.availableVramMB()).toBe(0)
      expect(broker.release('vm-1')).toBe(true)
      expect(broker.isAdmitted('vm-1')).toBe(false)
      expect(broker.availableVramMB()).toBe(4000)
      // now a fresh VM fits again
      expect(() => broker.admit({ vmId: 'vm-2', departmentId: 'dep-a', policy: policy({ vramCapMB: 4000 }) })).not.toThrow()
    })

    it('release of an unknown vmId is a no-op returning false (idempotent)', () => {
      const broker = new GpuBrokerService({ totalVramMB: 5000, hostReserveMB: 1000 })
      expect(broker.release('nope')).toBe(false)
    })
  })

  describe('fleetView', () => {
    it('reports host capacity and per-department admitted counts', () => {
      const broker = new GpuBrokerService({ totalVramMB: 24576, hostReserveMB: 1024 })
      broker.admit({ vmId: 'a1', departmentId: 'dep-a', policy: policy({ vramCapMB: 2048 }) })
      broker.admit({ vmId: 'a2', departmentId: 'dep-a', policy: policy({ vramCapMB: 2048 }) })
      broker.admit({ vmId: 'b1', departmentId: 'dep-b', policy: policy({ vramCapMB: 4096 }) })
      const fv = broker.fleetView()
      expect(fv.totalVramMB).toBe(24576)
      expect(fv.hostReserveMB).toBe(1024)
      expect(fv.vramReservedMB).toBe(2048 + 2048 + 4096)
      expect(fv.vramAvailableMB).toBe(24576 - 1024 - 8192)
      expect(fv.admittedVms).toBe(3)
      const depA = fv.byDepartment.find(d => d.departmentId === 'dep-a')
      const depB = fv.byDepartment.find(d => d.departmentId === 'dep-b')
      expect(depA?.admittedVms).toBe(2)
      expect(depB?.admittedVms).toBe(1)
    })
  })

  describe('constructor + helpers', () => {
    it('throws if host reserve exceeds total VRAM', () => {
      expect(() => new GpuBrokerService({ totalVramMB: 512, hostReserveMB: 1024 })).toThrow()
    })

    it('clamps a weight below 1 up to 1', () => {
      const broker = new GpuBrokerService({ totalVramMB: 10000, hostReserveMB: 0 })
      const cfg = broker.admit({ vmId: 'vm-1', departmentId: 'dep-a', policy: policy({ gpuTimeWeight: 0 }) })
      expect(cfg.weight).toBe(1)
    })

    it('extractGpuPolicy picks exactly the 7 policy fields off a Department row', () => {
      const row = {
        id: 'dep-a',
        name: 'ignored',
        gpuEnabled: true,
        vramReserveMB: 512,
        vramCapMB: 8192,
        priorityTier: 1,
        maxConcurrentGpuVMs: 3,
        gpuTimeWeight: 5,
        submissionRateTokens: 100000
      } as unknown as DepartmentGpuPolicy
      expect(extractGpuPolicy(row)).toEqual({
        gpuEnabled: true,
        vramReserveMB: 512,
        vramCapMB: 8192,
        priorityTier: 1,
        maxConcurrentGpuVMs: 3,
        gpuTimeWeight: 5,
        submissionRateTokens: 100000
      })
    })
  })

  describe('pixel ports', () => {
    it('assigns a distinct infiniPixel port per admitted VM', () => {
      const broker = new GpuBrokerService({ totalVramMB: 100000, hostReserveMB: 0, pixelPortMin: 7000, pixelPortMax: 7099 })
      const a = broker.admit({ vmId: 'a', departmentId: 'd', policy: policy({ vramCapMB: 1024 }) })
      const b = broker.admit({ vmId: 'b', departmentId: 'd', policy: policy({ vramCapMB: 1024 }) })
      expect(a.pixelPort).toBe(7000)
      expect(b.pixelPort).toBe(7001)
    })

    it('reuses a freed port after release', () => {
      const broker = new GpuBrokerService({ totalVramMB: 100000, hostReserveMB: 0, pixelPortMin: 7000, pixelPortMax: 7099 })
      const a = broker.admit({ vmId: 'a', departmentId: 'd', policy: policy({ vramCapMB: 1024 }) })
      broker.release('a')
      const b = broker.admit({ vmId: 'b', departmentId: 'd', policy: policy({ vramCapMB: 1024 }) })
      expect(b.pixelPort).toBe(a.pixelPort)
    })

    it('denies with NoPixelPort when the pool is exhausted', () => {
      const broker = new GpuBrokerService({ totalVramMB: 100000, hostReserveMB: 0, pixelPortMin: 7000, pixelPortMax: 7000 })
      broker.admit({ vmId: 'a', departmentId: 'd', policy: policy({ vramCapMB: 1024 }) })
      try {
        broker.admit({ vmId: 'b', departmentId: 'd', policy: policy({ vramCapMB: 1024 }) })
        fail('expected NoPixelPort')
      } catch (e) {
        expect((e as GpuAdmissionError).reason.code).toBe('NoPixelPort')
      }
    })
  })
})
