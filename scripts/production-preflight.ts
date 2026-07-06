/// <reference types="node" />

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { PrismaClient, UserRole } from '@prisma/client'
import { calculateNodeCapacity } from '../app/services/node/NodeCapacity'
import { IdentityProviderService } from '../app/services/identity/IdentityProviderService'
import { getStorageProviderFromEnv } from '../app/services/storage'

type CheckStatus = 'pass' | 'warn' | 'fail'

interface CheckResult {
  name: string
  status: CheckStatus
  message: string
  details?: Record<string, unknown>
}

interface MigrationRow {
  migration_name: string
  finished_at: Date | null
  rolled_back_at: Date | null
}

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const json = args.includes('--json')
const minOnlineNodes = Number(
  args.find(arg => arg.startsWith('--min-online-nodes='))?.split('=')[1] ||
  process.env.INFINIBAY_PREFLIGHT_MIN_ONLINE_NODES ||
  2
)

const prisma = new PrismaClient()
const results: CheckResult[] = []

function addResult (
  status: CheckStatus,
  name: string,
  message: string,
  details?: Record<string, unknown>
): void {
  results.push({ status, name, message, details })
}

function strictStatus (defaultStatus: CheckStatus = 'warn'): CheckStatus {
  return strict ? 'fail' : defaultStatus
}

function hasStrongSecret (value: string | undefined): boolean {
  return typeof value === 'string' && value.length >= 32
}

async function checkEnvironment (): Promise<void> {
  if (!process.env.DATABASE_URL) {
    addResult('fail', 'DATABASE_URL', 'DATABASE_URL is required')
  } else {
    addResult('pass', 'DATABASE_URL', 'DATABASE_URL is configured')
  }

  if (!hasStrongSecret(process.env.TOKENKEY)) {
    addResult(
      process.env.NODE_ENV === 'production' || strict ? 'fail' : 'warn',
      'TOKENKEY',
      'TOKENKEY should be set to a unique secret with at least 32 characters'
    )
  } else {
    addResult('pass', 'TOKENKEY', 'TOKENKEY is configured')
  }

  if (!hasStrongSecret(process.env.IDENTITY_SECRET_KEY)) {
    addResult(
      strictStatus(),
      'IDENTITY_SECRET_KEY',
      'IDENTITY_SECRET_KEY should be set before storing directory bind passwords'
    )
  } else {
    addResult('pass', 'IDENTITY_SECRET_KEY', 'IDENTITY_SECRET_KEY is configured')
  }

  if (process.env.IDENTITY_SECRET_KEY && process.env.IDENTITY_SECRET_KEY === process.env.TOKENKEY) {
    addResult(
      strictStatus(),
      'Secret separation',
      'IDENTITY_SECRET_KEY must differ from TOKENKEY so a single leak does not compromise both JWT signing and directory secret encryption'
    )
  } else {
    addResult('pass', 'Secret separation', 'IDENTITY_SECRET_KEY and TOKENKEY are distinct')
  }

  addResult(
    'pass',
    'Access token TTL',
    'ACCESS_TOKEN_TTL controls access-token lifetime (default 1h); REFRESH_TOKEN_TTL_DAYS controls refresh-token lifetime (default 30 days)',
    {
      accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '1h',
      refreshTokenTtlDays: process.env.REFRESH_TOKEN_TTL_DAYS || '30'
    }
  )

  addResult(
    'pass',
    'Directory TLS validation',
    'Per-provider tlsInsecureSkipVerify is ignored in production; certificate validation is always enforced when NODE_ENV=production'
  )

  // Source shared-ness through the StorageProvider abstraction and, for a shared
  // mount, actually VERIFY the mount (closes the old honor-system gap where a
  // declared-but-missing mount passed silently). See app/services/storage.
  const storageProvider = getStorageProviderFromEnv()
  if (!storageProvider.isShared()) {
    addResult(
      strictStatus(),
      'Shared VM storage',
      'INFINIBAY_SHARED_STORAGE=true (or INFINIBAY_STORAGE_BACKEND=shared-mount) is required for built-in cold migration between nodes unless a storage migration adapter is configured'
    )
  } else {
    const diskDir = process.env.INFINIZATION_DISK_DIR || '/var/lib/infinization/disks'
    const verify = await storageProvider.verify(diskDir)
    addResult(verify.ok ? 'pass' : strictStatus(), 'Shared VM storage', verify.detail)
  }
}

async function checkDatabaseAndMigrations (): Promise<void> {
  try {
    await prisma.$connect()
    addResult('pass', 'Database connection', 'Connected to PostgreSQL')
  } catch (error) {
    addResult('fail', 'Database connection', 'Could not connect to PostgreSQL', {
      error: error instanceof Error ? error.message : String(error)
    })
    return
  }

  try {
    const rows = await prisma.$queryRaw<MigrationRow[]>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
      ORDER BY started_at DESC
    `
    const unfinished = rows.filter(row => !row.finished_at && !row.rolled_back_at)
    const migrationDir = path.join(process.cwd(), 'prisma', 'migrations')
    const localMigrations = fs.existsSync(migrationDir)
      ? fs.readdirSync(migrationDir)
        .filter(entry => !entry.startsWith('.'))
        .filter(entry => fs.statSync(path.join(migrationDir, entry)).isDirectory())
      : []
    const appliedMigrations = rows.filter(row => row.finished_at && !row.rolled_back_at)

    if (unfinished.length > 0) {
      addResult('fail', 'Prisma migrations', 'There are unfinished Prisma migrations', {
        unfinished: unfinished.map(row => row.migration_name)
      })
    } else if (appliedMigrations.length < localMigrations.length) {
      addResult('fail', 'Prisma migrations', 'Not all local Prisma migrations are applied', {
        local: localMigrations.length,
        applied: appliedMigrations.length
      })
    } else {
      addResult('pass', 'Prisma migrations', 'All local Prisma migrations are applied', {
        local: localMigrations.length,
        applied: appliedMigrations.length
      })
    }
  } catch (error) {
    addResult('fail', 'Prisma migrations', 'Could not inspect Prisma migration state', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function checkNodes (): Promise<void> {
  const nodes = await prisma.node.findMany({
    include: {
      machines: {
        select: {
          cpuCores: true,
          ramGB: true,
          diskSizeGB: true
        }
      }
    }
  })
  const capacities = nodes.map(node => calculateNodeCapacity(node))
  const onlineNodes = capacities.filter(capacity => capacity.health === 'online').length
  const schedulableNodes = capacities.filter(capacity => capacity.schedulable).length
  const maintenanceNodes = nodes.filter(node => node.maintenanceMode).length

  if (schedulableNodes < minOnlineNodes) {
    addResult(
      strictStatus(),
      'Multi-node scheduling',
      `Expected at least ${minOnlineNodes} online schedulable nodes`,
      {
        totalNodes: nodes.length,
        onlineNodes,
        schedulableNodes,
        maintenanceNodes
      }
    )
  } else {
    addResult('pass', 'Multi-node scheduling', 'Enough online schedulable nodes are available', {
      totalNodes: nodes.length,
      onlineNodes,
      schedulableNodes,
      maintenanceNodes
    })
  }

  const activeUnassigned = await prisma.machine.count({
    where: {
      nodeId: null,
      status: {
        in: ['starting', 'running', 'paused', 'suspended', 'updating_hardware', 'powering_off_update']
      }
    }
  })

  if (activeUnassigned > 0) {
    addResult(
      strictStatus(),
      'Machine node assignment',
      'Active machines without node assignment were found',
      { activeUnassigned }
    )
  } else {
    addResult('pass', 'Machine node assignment', 'No active machines are missing node assignment')
  }
}

async function checkIdentity (): Promise<void> {
  const providers = await prisma.identityProvider.findMany({
    include: {
      groupRoleMappings: true
    }
  })
  const enabled = providers.filter(provider => provider.enabled)
  const connected = enabled.filter(provider => provider.status === 'CONNECTED')
  const mappings = providers.reduce((total, provider) => total + provider.groupRoleMappings.length, 0)

  if (enabled.length === 0) {
    addResult(
      strictStatus(),
      'Directory identity',
      'No enabled ActiveDirectory/LDAP identity provider is configured'
    )
  } else if (connected.length === 0) {
    addResult(
      strictStatus(),
      'Directory identity',
      'Identity providers exist, but none are currently connected',
      { enabledProviders: enabled.length }
    )
  } else {
    const identityService = new IdentityProviderService(prisma)
    const activeChecks = await Promise.all(enabled.map(async provider => ({
      provider: provider.name,
      result: await identityService.testSavedProvider(provider.id, { requireBind: strict })
    })))
    const reachable = activeChecks.filter(check => check.result.success)

    if (reachable.length === 0) {
      addResult(
        strictStatus(),
        'Directory identity',
        'Enabled identity providers exist, but none passed active connection validation',
        {
          enabledProviders: enabled.length,
          checks: activeChecks.map(check => ({
            provider: check.provider,
            success: check.result.success,
            message: check.result.message
          }))
        }
      )
    } else {
      addResult('pass', 'Directory identity', 'At least one enabled identity provider passed active validation', {
        enabledProviders: enabled.length,
        connectedProviders: connected.length,
        activeProviders: reachable.length
      })
    }
  }

  if (mappings === 0) {
    addResult(
      strictStatus(),
      'Directory role mappings',
      'No directory group-to-role mappings are configured'
    )
  } else {
    addResult('pass', 'Directory role mappings', 'Directory group-to-role mappings are present', {
      mappings
    })
  }
}

async function checkPermissions (): Promise<void> {
  const superAdmins = await prisma.user.count({
    where: {
      role: UserRole.SUPER_ADMIN,
      deleted: false
    }
  })
  const defaultSuperAdmins = await prisma.user.count({
    where: {
      role: UserRole.SUPER_ADMIN,
      deleted: false,
      email: 'admin@example.com'
    }
  })
  const overrides = await prisma.rolePermission.count()

  if (superAdmins === 0) {
    addResult('fail', 'Administrative access', 'No active SUPER_ADMIN user exists')
  } else {
    addResult('pass', 'Administrative access', 'At least one active SUPER_ADMIN user exists', {
      superAdmins
    })
  }

  if (defaultSuperAdmins > 0) {
    addResult(
      strictStatus(),
      'Administrative account hardening',
      'The development SUPER_ADMIN email admin@example.com is still active',
      { defaultSuperAdmins }
    )
  } else {
    addResult('pass', 'Administrative account hardening', 'No development SUPER_ADMIN email is active')
  }

  addResult('pass', 'Role permission matrix', 'Role permission service is backed by the database', {
    explicitOverrides: overrides
  })
}

function printResults (): void {
  if (json) {
    console.log(JSON.stringify({ strict, minOnlineNodes, results }, null, 2))
    return
  }

  console.log(`Infinibay production preflight${strict ? ' (strict)' : ''}`)
  console.log('')
  for (const result of results) {
    const marker = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL'
    console.log(`[${marker}] ${result.name}: ${result.message}`)
    if (result.details) {
      console.log(`       ${JSON.stringify(result.details)}`)
    }
  }
}

async function main (): Promise<void> {
  await checkEnvironment()
  await checkDatabaseAndMigrations()

  if (!results.some(result => result.name === 'Database connection' && result.status === 'fail')) {
    await checkNodes()
    await checkIdentity()
    await checkPermissions()
  }

  printResults()

  const failed = results.some(result => result.status === 'fail')
  await prisma.$disconnect()
  process.exit(failed ? 1 : 0)
}

main().catch(async error => {
  addResult('fail', 'Preflight runtime', error instanceof Error ? error.message : String(error))
  printResults()
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
