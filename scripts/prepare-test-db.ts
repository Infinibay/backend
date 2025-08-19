import { config as loadEnv } from 'dotenv'
import path from 'path'
import { execSync } from 'child_process'

function log (msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[test-db] ${msg}`)
}

function warn (msg: string) {
  // eslint-disable-next-line no-console
  console.warn(`[test-db] ${msg}`)
}

async function main () {
  const args = process.argv.slice(2)
  const doReset = args.includes('--reset')

  // Load .env.test if present
  loadEnv({ path: path.resolve(__dirname, '../.env.test') })

  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    warn('DATABASE_URL is not set. Set it in backend/.env.test to enable DB-backed tests.')
    process.exit(0)
    return
  }

  try {
    const url = new URL(dbUrl)
    if (!/^postgres/.test(url.protocol)) {
      warn(`Only PostgreSQL is supported for test DB prep. Got protocol: ${url.protocol}`)
      process.exit(0)
      return
    }

    const host = url.hostname || 'localhost'
    const port = url.port || '5432'
    const user = decodeURIComponent(url.username || 'postgres')
    const password = decodeURIComponent(url.password || '')
    const dbName = (url.pathname || '').replace(/^\//, '')

    if (!dbName.endsWith('_test')) {
      warn(`Refusing to prepare a non-test database: ${dbName}. Please use a DATABASE_URL whose db name ends with _test.`)
      process.exit(1)
      return
    }

    // Use PGPASSWORD env var to avoid prompts
    const env = { ...process.env, PGPASSWORD: password }

    // Check if DB exists
    log(`Checking if database '${dbName}' exists on ${host}:${port} as ${user}...`)
    const checkCmd = `psql -h ${host} -p ${port} -U ${user} -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'"`
    let exists = false
    try {
      const out = execSync(checkCmd, { env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
      exists = out === '1'
    } catch (_) {
      exists = false
    }

    if (!exists) {
      log(`Creating database '${dbName}'...`)
      const createCmd = `createdb -h ${host} -p ${port} -U ${user} ${dbName}`
      execSync(createCmd, { env, stdio: 'inherit' })
      log('Database created.')
    } else {
      log('Database already exists.')
    }

    // Apply schema
    if (doReset) {
      log('Resetting database via prisma migrate reset --force ...')
      execSync('npx prisma migrate reset --force', { env: { ...env, DATABASE_URL: dbUrl }, stdio: 'inherit' })
    } else {
      // Prefer deploy migrations; if none, fall back to db push
      try {
        log('Applying migrations via prisma migrate deploy ...')
        execSync('npx prisma migrate deploy', { env: { ...env, DATABASE_URL: dbUrl }, stdio: 'inherit' })
      } catch (e) {
        log('No migrations to deploy or failed. Falling back to prisma db push ...')
        execSync('npx prisma db push', { env: { ...env, DATABASE_URL: dbUrl }, stdio: 'inherit' })
      }
    }

    // Optional: generate client for test env
    try {
      execSync('npx prisma generate', { env: { ...env, DATABASE_URL: dbUrl }, stdio: 'inherit' })
    } catch (_) {}

    log('Test database is ready.')
  } catch (err) {
    console.error('[test-db] Error preparing test DB:', err)
    process.exit(1)
  }
}

main()
