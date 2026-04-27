"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaTestClient = void 0;
exports.createTestPrismaClient = createTestPrismaClient;
exports.resetTestPrismaClient = resetTestPrismaClient;
exports.cleanDatabase = cleanDatabase;
const client_1 = require("@prisma/client");
const crypto_1 = require("crypto");
/**
 * Resolve the test database URL from the environment.
 * Throws if missing, or if it matches DATABASE_URL (to prevent nuking dev data).
 */
function resolveTestDatabaseUrl() {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
        throw new Error('TEST_DATABASE_URL is not set. Tests need a dedicated Postgres database — ' +
            'the test runner truncates every table between tests. ' +
            'Copy .env.test.example to .env.test and adjust credentials.');
    }
    // Sanity check: DB name should smell like a test DB. This catches obvious
    // misconfigurations (TEST_DATABASE_URL left pointing at `infinibay`) without
    // false-positives when DATABASE_URL and TEST_DATABASE_URL are intentionally
    // identical (e.g. a local .env.test that mirrors both to infinibay_test).
    const dbName = extractDbName(url);
    if (dbName && !/_test(\b|$)|test_|^test$/i.test(dbName)) {
        throw new Error(`TEST_DATABASE_URL database name "${dbName}" does not look like a test DB. ` +
            'The test runner truncates every table on every test. ' +
            'Name it something ending in _test (e.g. infinibay_test) to confirm intent, ' +
            'or adjust the heuristic in prisma-test-client.ts.');
    }
    return url;
}
function extractDbName(url) {
    try {
        // URL() percent-decodes the pathname, so passwords with `?` or `/` don't
        // confuse the parse. The pathname is e.g. "/infinibay_test".
        return new URL(url).pathname.replace(/^\//, '') || null;
    }
    catch (_a) {
        return null;
    }
}
/**
 * A thin wrapper around PrismaClient that provides:
 * - `cleanup()` — truncates every user table (discovered from the live schema)
 * - `connect()` / `disconnect()` lifecycle
 * - `snapshot()` — captures table row counts for assertion helpers
 */
class PrismaTestClient {
    constructor(options = {}) {
        var _a;
        this._connected = false;
        this._tableNames = null;
        const url = (_a = options.url) !== null && _a !== void 0 ? _a : resolveTestDatabaseUrl();
        const log = options.verbose ? ['error', 'warn', 'info'] : ['error'];
        this._client = new client_1.PrismaClient({
            datasources: { db: { url } },
            log,
        });
    }
    /** The raw Prisma client — use this in tests for create/find/update/delete. */
    get prisma() {
        return this._client;
    }
    /** Connect to the test database. Called in beforeAll. */
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this._connected) {
                yield this._client.$connect();
                this._connected = true;
            }
        });
    }
    /** Disconnect from the test database. Call in afterAll. */
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._connected) {
                yield this._client.$disconnect();
                this._connected = false;
            }
        });
    }
    /**
     * Truncate every user table in the public schema, excluding `_prisma_migrations`.
     * Uses a single `TRUNCATE a, b, c RESTART IDENTITY CASCADE` so FK order is
     * handled by Postgres — no hand-maintained dependency list required.
     */
    cleanup() {
        return __awaiter(this, void 0, void 0, function* () {
            const start = Date.now();
            const tables = yield this.getTableNames();
            if (tables.length === 0) {
                return { tables: [], durationMs: 0 };
            }
            const quoted = tables.map(t => `"${t}"`).join(', ');
            yield this._client.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
            return { tables, durationMs: Date.now() - start };
        });
    }
    /**
     * Snapshot — capture current row counts for all tables.
     * Useful for asserting that a create/delete modified the right rows.
     */
    snapshot() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const tables = yield this.getTableNames();
            const counts = {};
            for (const t of tables) {
                const result = yield this._client.$queryRawUnsafe(`SELECT COUNT(*) as count FROM "${t}";`);
                counts[t] = Number((_b = (_a = result[0]) === null || _a === void 0 ? void 0 : _a.count) !== null && _b !== void 0 ? _b : 0);
            }
            return counts;
        });
    }
    /**
     * Create a unique test email address.
     * Convenience helper so tests don't clash on UNIQUE constraints.
     */
    uniqueEmail(prefix = 'test') {
        return `${prefix}+${(0, crypto_1.randomUUID)()}@test.infinibay`;
    }
    /**
     * Discover user tables from information_schema, cached per instance.
     * Excludes Prisma's internal migration table.
     */
    getTableNames() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._tableNames)
                return this._tableNames;
            const rows = yield this._client.$queryRawUnsafe(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename;
    `);
            this._tableNames = rows.map(r => r.tablename);
            return this._tableNames;
        });
    }
}
exports.PrismaTestClient = PrismaTestClient;
// ── Module-level singleton (one per test process) ──────────────────────────
let _singleton = null;
/**
 * Factory — returns a shared PrismaTestClient instance.
 * Subsequent calls in the same process return the same instance.
 */
function createTestPrismaClient(options) {
    if (!_singleton) {
        _singleton = new PrismaTestClient(options);
    }
    return _singleton;
}
/** Reset the singleton — disconnects and clears the cached instance. */
function resetTestPrismaClient() {
    if (_singleton) {
        _singleton.disconnect().catch(() => { });
        _singleton = null;
    }
}
/** Jest hook helper — truncates every table. Call in beforeEach. */
function cleanDatabase(client) {
    return __awaiter(this, void 0, void 0, function* () {
        yield client.cleanup();
    });
}
