import type { PrismaClient } from '@prisma/client'
import { StorageProvider, StorageBackendKind } from './StorageProvider'
import { LocalStorageProvider } from './LocalStorageProvider'
import { SharedMountStorageProvider } from './SharedMountStorageProvider'
import { CephRbdStorageProvider } from './CephRbdStorageProvider'

export * from './StorageProvider'
export { LocalStorageProvider } from './LocalStorageProvider'
export { SharedMountStorageProvider } from './SharedMountStorageProvider'
export { CephRbdStorageProvider } from './CephRbdStorageProvider'

/** Values accepted as "shared storage enabled" for the legacy env flag. */
const SHARED_STORAGE_TRUTHY = new Set(['1', 'true', 'yes'])
const VALID_KINDS: StorageBackendKind[] = ['local', 'shared-mount', 'ceph']

/** Shape persisted in `AppSettings.storageConfig` (forward-looking reconfigure). */
export interface StorageConfig {
  backend: StorageBackendKind
  /** Backend-specific options (NFS export, RBD pool/keyring, ...). */
  options?: Record<string, unknown>
}

/**
 * Legacy honor-system read of `INFINIBAY_SHARED_STORAGE` (`1`/`true`/`yes`).
 * Single source of truth replacing the three duplicated copies that used to live
 * in VMMigrationService, machine/resolver and production-preflight.
 */
export function isSharedStorageEnv (): boolean {
  return SHARED_STORAGE_TRUTHY.has((process.env.INFINIBAY_SHARED_STORAGE || '').toLowerCase())
}

/**
 * Synchronous backend selection from environment only:
 *   INFINIBAY_STORAGE_BACKEND (local|shared-mount|ceph) wins; otherwise the legacy
 *   INFINIBAY_SHARED_STORAGE=true maps to `shared-mount`; otherwise `local`.
 * Used on hot/sync paths (migration) where an async DB read is undesirable.
 */
export function storageKindFromEnv (): StorageBackendKind {
  const explicit = (process.env.INFINIBAY_STORAGE_BACKEND || '').toLowerCase().trim()
  if ((VALID_KINDS as string[]).includes(explicit)) return explicit as StorageBackendKind
  return isSharedStorageEnv() ? 'shared-mount' : 'local'
}

/** Instantiate a provider for an explicit backend kind. */
export function getStorageProvider (kind: StorageBackendKind): StorageProvider {
  switch (kind) {
    case 'shared-mount':
      return new SharedMountStorageProvider()
    case 'ceph':
      return new CephRbdStorageProvider()
    case 'local':
    default:
      return new LocalStorageProvider()
  }
}

/** The env-configured provider (sync). */
export function getStorageProviderFromEnv (): StorageProvider {
  return getStorageProvider(storageKindFromEnv())
}

function parseStorageConfig (value: unknown): StorageConfig | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const backend = (value as Record<string, unknown>).backend
    if (typeof backend === 'string' && (VALID_KINDS as string[]).includes(backend)) {
      return {
        backend: backend as StorageBackendKind,
        options: (value as Record<string, unknown>).options as Record<string, unknown> | undefined
      }
    }
  }
  return null
}

/**
 * Resolve the configured backend kind, preferring the persisted
 * `AppSettings.storageConfig` (future reconfigure UI) and falling back to the env
 * (`storageKindFromEnv`). Pass a prisma client to consult the DB; omit it to use
 * env only.
 */
export async function resolveStorageBackendKind (prisma?: PrismaClient): Promise<StorageBackendKind> {
  if (prisma) {
    try {
      const settings = await prisma.appSettings.findUnique({
        where: { id: 'default-settings' },
        select: { storageConfig: true }
      })
      const cfg = parseStorageConfig(settings?.storageConfig)
      if (cfg) return cfg.backend
    } catch {
      /* fall through to env */
    }
  }
  return storageKindFromEnv()
}

/** The configured provider, DB-first then env. */
export async function getConfiguredStorageProvider (prisma?: PrismaClient): Promise<StorageProvider> {
  return getStorageProvider(await resolveStorageBackendKind(prisma))
}
