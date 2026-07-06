import path from 'path'
import { StorageProvider, StorageVerifyResult, verifySharedStorage } from './StorageProvider'

/**
 * Shared filesystem mount (NFS/iSCSI/SAN/CephFS mounted at the disk directory).
 * The disk is reachable at the same path from every node, so cross-node migration
 * needs no copy. Still just a filesystem path — `resolveDiskLocation` is identical
 * to the local provider; the difference is `isShared()` and the mount `verify()`.
 */
export class SharedMountStorageProvider implements StorageProvider {
  readonly kind = 'shared-mount' as const

  isShared (): boolean {
    return true
  }

  async verify (diskDir: string): Promise<StorageVerifyResult> {
    return await verifySharedStorage(diskDir)
  }

  resolveDiskLocation (diskDir: string, fileName: string): string {
    return path.join(diskDir, fileName)
  }

  describe (): string {
    return 'Shared mount (NFS/iSCSI/SAN/CephFS) at the disk directory. Migration skips the disk copy.'
  }
}
