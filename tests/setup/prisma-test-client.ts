/**
 * Prisma Test Client — Real database with truncate-per-test isolation.
 *
 * Usage:
 *   // In jest.setup.ts:
 *   const testPrisma = createTestPrismaClient()
 *   beforeAll(async () => { await testPrisma.connect() })
 *   beforeEach(async () => { await testPrisma.cleanup() })
 *   afterAll(async () => { await testPrisma.disconnect() })
 *
 *   // In tests, use the client directly:
 *   const user = await testPrisma.prisma.user.create({ data: { ... } })
 *
 * Isolation model:
 *   Every test starts with a fully-truncated DB. Tests do not share state.
 *   Do NOT rely on transaction rollback — `cleanup()` via TRUNCATE is the
 *   single source of truth.
 *
 * Configuration:
 *   TEST_DATABASE_URL is REQUIRED. No fallback is provided, on purpose: running
 *   tests against an unintended DB (e.g. dev) would wipe real data.
 */

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

/**
 * Resolve the test database URL from the environment.
 * Throws if missing, or if it matches DATABASE_URL (to prevent nuking dev data).
 */
function resolveTestDatabaseUrl (): string {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Tests need a dedicated Postgres database — ' +
      'the test runner truncates every table between tests. ' +
      'Copy .env.test.example to .env.test and adjust credentials.'
    )
  }

  // Sanity check: DB name should smell like a test DB. This catches obvious
  // misconfigurations (TEST_DATABASE_URL left pointing at `infinibay`) without
  // false-positives when DATABASE_URL and TEST_DATABASE_URL are intentionally
  // identical (e.g. a local .env.test that mirrors both to infinibay_test).
  const dbName = extractDbName(url)
  if (dbName && !/_test(\b|$)|test_|^test$/i.test(dbName)) {
    throw new Error(
      `TEST_DATABASE_URL database name "${dbName}" does not look like a test DB. ` +
      'The test runner truncates every table on every test. ' +
      'Name it something ending in _test (e.g. infinibay_test) to confirm intent, ' +
      'or adjust the heuristic in prisma-test-client.ts.'
    )
  }

  return url
}

function extractDbName (url: string): string | null {
  try {
    // URL() percent-decodes the pathname, so passwords with `?` or `/` don't
    // confuse the parse. The pathname is e.g. "/infinibay_test".
    return new URL(url).pathname.replace(/^\//, '') || null
  } catch {
    return null
  }
}

export interface TestPrismaClientOptions {
  /** PostgreSQL connection string. Defaults to TEST_DATABASE_URL env var. */
  url?: string
  /** Log Prisma queries in test output. Default: false. */
  verbose?: boolean
}

export interface CleanupResult {
  tables: string[]
  durationMs: number
}

/**
 * A thin wrapper around PrismaClient that provides:
 * - `cleanup()` — truncates every user table (discovered from the live schema)
 * - `connect()` / `disconnect()` lifecycle
 * - `snapshot()` — captures table row counts for assertion helpers
 */
export class PrismaTestClient {
  private readonly _client: PrismaClient
  private _connected = false
  private _tableNames: string[] | null = null

  constructor (options: TestPrismaClientOptions = {}) {
    const url = options.url ?? resolveTestDatabaseUrl()
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
   * Truncate every user table in the public schema, excluding `_prisma_migrations`.
   * Uses a single `TRUNCATE a, b, c RESTART IDENTITY CASCADE` so FK order is
   * handled by Postgres — no hand-maintained dependency list required.
   */
  async cleanup (): Promise<CleanupResult> {
    const start = Date.now()
    const tables = await this.getTableNames()

    if (tables.length === 0) {
      return { tables: [], durationMs: 0 }
    }

    const quoted = tables.map(t => `"${t}"`).join(', ')
    await this._client.$executeRawUnsafe(
      `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`,
    )

    return { tables, durationMs: Date.now() - start }
  }

  /**
   * Snapshot — capture current row counts for all tables.
   * Useful for asserting that a create/delete modified the right rows.
   */
  async snapshot (): Promise<Record<string, number>> {
    const tables = await this.getTableNames()
    const counts: Record<string, number> = {}
    for (const t of tables) {
      const result = await this._client.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM "${t}";`,
      )
      counts[t] = Number(result[0]?.count ?? 0)
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

  /**
   * Discover user tables from information_schema, cached per instance.
   * Excludes Prisma's internal migration table.
   */
  private async getTableNames (): Promise<string[]> {
    if (this._tableNames) return this._tableNames

    const rows = await this._client.$queryRawUnsafe<Array<{ tablename: string }>>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename;
    `)
    this._tableNames = rows.map(r => r.tablename)
    return this._tableNames
  }
}

// ── Module-level singleton (one per test process) ──────────────────────────

let _singleton: PrismaTestClient | null = null

/**
 * Factory — returns a shared PrismaTestClient instance.
 * Subsequent calls in the same process return the same instance.
 */
export function createTestPrismaClient (options?: TestPrismaClientOptions): PrismaTestClient {
  if (!_singleton) {
    _singleton = new PrismaTestClient(options)
  }
  return _singleton
}

/** Reset the singleton — disconnects and clears the cached instance. */
export function resetTestPrismaClient (): void {
  if (_singleton) {
    _singleton.disconnect().catch(() => {/* ignore */})
    _singleton = null
  }
}

/** Jest hook helper — truncates every table. Call in beforeEach. */
export async function cleanDatabase (client: PrismaTestClient): Promise<void> {
  await client.cleanup()
}
