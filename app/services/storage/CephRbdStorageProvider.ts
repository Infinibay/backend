import { StorageProvider, StorageVerifyResult } from './StorageProvider'

/**
 * STUB — native Ceph RBD (no filesystem mount). This is the one backend that
 * breaks the "a VM disk is just a filesystem path" assumption: `resolveDiskLocation`
 * would return an `rbd:pool/<vmId>` style URI, which requires the infinization
 * QemuCommandBuilder to emit `-drive file=rbd:...` (or a `-blockdev` with the rbd
 * driver) instead of a plain file path. Implementing it is a separate project.
 *
 * See lxd/docs/setup-system/03-storage-provider-scaffolding.md §6.
 */
export class CephRbdStorageProvider implements StorageProvider {
  readonly kind = 'ceph' as const

  isShared (): boolean {
    // RBD volumes are cluster-reachable by definition — no per-node copy.
    return true
  }

  async verify (_diskDir: string): Promise<StorageVerifyResult> {
    return {
      ok: false,
      backend: 'ceph',
      diskDir: _diskDir,
      detail: 'Ceph RBD storage backend is not implemented yet (see 03-storage-provider-scaffolding.md).'
    }
  }

  resolveDiskLocation (_diskDir: string, _fileName: string): string {
    // TODO(ceph): return `rbd:${pool}/${vmId}` and teach infinization
    // QemuCommandBuilder to attach RBD volumes. See 03-storage-provider-scaffolding.md.
    throw new Error('CephRbdStorageProvider is not implemented (see 03-storage-provider-scaffolding.md)')
  }

  describe (): string {
    return 'Ceph RBD (native block, no mount) — NOT YET IMPLEMENTED.'
  }
}
