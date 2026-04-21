/**
 * Global Jest setup — runs once before ALL test files.
 *
 * Responsibilities:
 * 1. Ensure the test database is ready (tables exist, etc.)
 * 2. Set up any global test environment (teardown helpers, timers, etc.)
 *
 * NOTE: Do NOT connect to the DB here — that is handled by the test Prisma client
 * singleton in prisma-test-client.ts, which is initialised via setupFilesAfterEnv.
 * Doing DB connection here would race with the singleton.
 */
export default async function globalSetup() {
  // Ensure test directories exist
  const testDirs = ['/tmp/infinibay-test', '/tmp/infinibay-test/iso', '/tmp/infinibay-test/disks']
  for (const dir of testDirs) {
    try {
      const fs = await import('fs')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    } catch {
      // ignore
    }
  }
}
