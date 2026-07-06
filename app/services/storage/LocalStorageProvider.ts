import path from 'path'
import { StorageProvider, StorageVerifyResult, verifyLocalStorage } from './StorageProvider'

/**
 * Per-node local qcow2 storage (the default). Disks live under
 * `INFINIZATION_DISK_DIR` on each host; a cross-node migration must copy the disk
 * because it is NOT reachable from the target without a transfer.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local' as const

  isShared (): boolean {
    return false
  }

  async verify (diskDir: string): Promise<StorageVerifyResult> {
    return await verifyLocalStorage(diskDir)
  }

  resolveDiskLocation (diskDir: string, fileName: string): string {
    return path.join(diskDir, fileName)
  }

  describe (): string {
    return 'Local per-node disk storage (qcow2). Cross-node migration copies + verifies the disk.'
  }
}
