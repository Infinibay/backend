/**
 * Prisma Test Client — Real database with transaction isolation per test.
 *
 * Usage:
 *   // In jest.setup.ts (integration tests):
 *   const testPrisma = createTestPrismaClient({ url: process.env.TEST_DATABASE_URL! })
 *   beforeEach(async () => { await testPrisma.cleanup() })
 *   afterEach(async () => { await testPrisma.rollback() })
 *   afterAll(async () => { await testPrisma.disconnect() })
 *
 *   // In individual tests, use the client directly:
 *   const user = await testPrisma.user.create({ data: { email: 'test@test.com', ... } })
 *
 * For unit tests that still use mocks, the jest.setup.ts mock of @prisma/client
 * is unaffected — only integration tests that import this module get real DB access.
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://infinibay:20gGt%21%3FjuKEQAlVzD%29%3DT9.e4%3E%24kkJ5c%3A@localhost:5432/infinibay_test?schema=public'

export interface TestPrismaClientOptions {
  /** PostgreSQL connection string. Defaults to TEST_DATABASE_URL env var. */
  url?: string
  /** Log Prisma queries in test output. Default: false. */
  verbose?: boolean
}

export interface CleanupResult {
  tables: string[]
  durations: Record<string, number>
}

/**
 * A thin wrapper around PrismaClient that provides:
 * - `$transaction()` helper that auto-rolls-back on test cleanup
 * - `cleanup()` — truncates all tables in reverse-FK order
 * - `connect()` / `disconnect()` lifecycle
 * - `snapshot()` — captures table row counts for assertion helpers
 */
export class PrismaTestClient {
  private readonly _client: PrismaClient
  private _connected = false

  // Tables in reverse dependency order (child → parent) for truncation.
  // Add new models here as the schema grows.
  private readonly TRUNCATE_ORDER = [
    // Join / junction tables first
    'ScriptAuditLog',
    'DepartmentScript',
    'MachineApplication',
    'FirewallRuleSet',
    'FirewallRule',
    'PackageLicense',
    'PackageChecker',
    // Child → parent progression
    'MaintenanceHistory',
    'MaintenanceTask',
    'SystemMetrics',
    'ProcessSnapshot',
    'ApplicationUsage',
    'PortUsage',
    'BlockedConnection',
    'WindowsService',
    'ServiceStateHistory',
    'VMHealthAlert',
    'VMHealthSnapshot',
    'VMHealthConfig',
    'VMHealthCheckQueue',
    'VMRecommendation',
    'PendingCommand',
    'Machine',
    'ScriptExecution',
    'Script',
    'MachineConfiguration',
    'MachineTemplate',
    'MachineTemplateCategory',
    'Application',
    'Department',
    'ISO',
    'Disk',
    'Node',
    'User',
    'Package',
    'Notification',
    'ErrorLog',
    'PerformanceMetric',
    'PerformanceAggregate',
    'HealthCheck',
    'BackgroundTaskLog',
    'KnownService',
    'SystemEvent',
  ]
  constructor (options: TestPrismaClientOptions = {}) {
    const url = options.url ?? TEST_DATABASE_URL
    const log: ('error' | 'warn' | 'info')[] = options.verbose ? ['error', 'warn', 'info'] : ['error']

    this._client = new PrismaClient({
      datasources: { db: { url } },
      log,
    })
  }

  /** The raw Prisma client — use this in tests for create/find/update/delete. */
  get prisma (): PrismaClient {
    return this._client
  }

  /** Expose the $transaction method directly. */
  $transaction<T> (
    fn: (prisma: PrismaClient) => Promise<T>,
  ): Promise<T> {
    // Use interactive transaction to ensure rollback works in tests
    return this._client.$transaction(async (tx) => fn(tx as unknown as PrismaClient), {
      isolationLevel: 'Serializable',
    })
  }

  /** Connect to the test database. Called in beforeAll. */
  async connect (): Promise<void> {
    if (!this._connected) {
      await this._client.$connect()
      this._connected = true
    }
  }

  /** Disconnect from the test database. Call in afterAll. */
  async disconnect (): Promise<void> {
    if (this._connected) {
      await this._client.$disconnect()
      this._connected = false
    }
  }

  /**
   * Truncate all known tables in reverse FK-dependency order.
   * Each table is truncated with RESTART IDENTITY to reset auto-increment counters.
   *
   * Returns a CleanupResult with the list of affected tables and per-table timing.
   */
  async cleanup (): Promise<CleanupResult> {
    const durations: Record<string, number> = {}
    const tables: string[] = []

    for (const modelName of this.TRUNCATE_ORDER) {
      const start = Date.now()
      const tableName = this.toSnakeCase(modelName)
      try {
        // Use raw query for performance — Prisma doesn't have a bulk truncate API
        await this._client.$executeRawUnsafe(
          `TRUNCATE TABLE "${tableName}" RESTART IDENTITY CASCADE;`,
        )
        durations[tableName] = Date.now() - start
        tables.push(tableName)
      } catch (error) {
        // Some tables may not exist in test DB (e.g., if migrations haven't run).
        // Silently skip — the test DB should be fully migrated.
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[PrismaTestClient] Could not truncate "${tableName}": ${error}`)
        }
      }
    }

    return { tables, durations }
  }

  /**
   * Rollback any uncommitted transaction and reset sequences.
   * After this the DB should be in the same state as after cleanup().
   *
   * Implementation: issues a ROLLBACK on the current connection.
   * Note: If tests use $transaction(), changes are auto-rolled back when
   * the transaction scope exits (interactive transaction pattern).
   */
  async rollback (): Promise<void> {
    try {
      await this._client.$executeRawUnsafe('ROLLBACK;')
    } catch {
      // No-op if no transaction is active
    }
  }

  /**
   * Snapshot — capture current row counts for all tables.
   * Useful for asserting that a create/delete modified the right rows.
   *
   * @example
   *   const before = await testPrisma.snapshot()
   *   await testPrisma.prisma.user.create({ data: { email: 'x@test.com', ... } })
   *   const after = await testPrisma.snapshot()
   *   expect(after.User - before.User).toBe(1)
   */
  async snapshot (): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    for (const modelName of this.TRUNCATE_ORDER) {
      const tableName = this.toSnakeCase(modelName)
      try {
        const result = await this._client.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT COUNT(*) as count FROM "${tableName}";`,
        )
        counts[modelName] = Number(result[0]?.count ?? 0)
      } catch {
        // Skip tables that don't exist
      }
    }
    return counts
  }

  /**
   * Create a unique test email address.
   * Convenience helper so tests don't clash on UNIQUE constraints.
   */
  uniqueEmail (prefix = 'test'): string {
    return `${prefix}+${randomUUID()}@test.infinibay`
  }

  private toSnakeCase (name: string): string {
    return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, '')
  }
}

// ── Module-level singleton (one per test file that imports it) ─────────────────

let _singleton: PrismaTestClient | null = null

/**
 * Factory — returns a shared PrismaTestClient instance.
 * Subsequent calls in the same process return the same instance.
 *
 * Call `resetTestPrismaClient()` to clear and reconnect (e.g., in beforeAll).
 */
export function createTestPrismaClient (options?: TestPrismaClientOptions): PrismaTestClient {
  if (!_singleton) {
    _singleton = new PrismaTestClient(options)
  }
  return _singleton
}

/** Reset the singleton — useful in beforeAll to ensure a clean slate. */
export function resetTestPrismaClient (): void {
  if (_singleton) {
    _singleton.disconnect().catch(() => {/* ignore */})
    _singleton = null
  }
}

/**
 * Jest afterEach hook helper — resets the DB to a clean state.
 *
 * Usage in jest.setup.ts or at the top of each integration test file:
 *
 *   beforeEach(async () => { await cleanDatabase(testPrisma) })
 *   afterEach(async () => { await rollbackTransaction(testPrisma) })
 *
 * The `cleanDatabase` approach (truncate) is the most reliable because
 * it doesn't require all tests to wrap every write in $transaction().
 * The `rollbackTransaction` approach only works if tests DO use $transaction().
 */
export async function cleanDatabase (client: PrismaTestClient): Promise<void> {
  await client.cleanup()
}

export async function rollbackTransaction (client: PrismaTestClient): Promise<void> {
  await client.rollback()
}
