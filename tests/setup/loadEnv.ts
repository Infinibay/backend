/**
 * Load .env.test into process.env before any test code runs.
 * Registered as `setupFiles` in jest.config.js so it executes before
 * `jest.setup.ts` (which imports prisma-test-client and reads TEST_DATABASE_URL).
 *
 * CI may set TEST_DATABASE_URL directly — the file is optional.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(__dirname, '../../.env.test') })
