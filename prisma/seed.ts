// Polyfill the Reflect metadata API FIRST: this seed transitively imports
// TypeGraphQL-decorated modules (via app/permissions/presets → pagination), and
// their @Field decorators throw ReflectMetadataMissingError unless reflect-metadata
// is loaded before any decorated class is evaluated.
import 'reflect-metadata'

// Register tsconfig paths before any imports that use path aliases
import { register } from 'tsconfig-paths'
import { resolve } from 'path'

import { PrismaClient, Prisma } from '@prisma/client'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
import createApplications from './seeds/applications'
import createScripts from './seeds/scripts'

import installCallbacks from '../app/utils/modelsCallbacks'
import { applyRolePresets } from '../app/permissions/presets'
import { DepartmentNetworkService } from '../app/services/network/DepartmentNetworkService'
import { FirewallRuleService } from '../app/services/firewall/FirewallRuleService'
import { FirewallPolicyService } from '../app/services/firewall/FirewallPolicyService'
import { FirewallOrchestrationService } from '../app/services/firewall/FirewallOrchestrationService'
import { FirewallValidationService } from '../app/services/firewall/FirewallValidationService'
import { InfinizationFirewallService } from '../app/services/firewall/InfinizationFirewallService'

// Register path mappings for ts-node to resolve @utils and other aliases
register({
  baseUrl: resolve(__dirname, '..', 'app'),
  paths: {
    '@main/*': ['*'],
    '@services/*': ['services/*'],
    '@graphql/*': ['graphql/*'],
    '@utils/*': ['utils/*'],
    '@resolvers/*': ['graphql/resolvers/*']
  }
})

dotenv.config()

const prisma = new PrismaClient()

const DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com'
const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || 'password'
const DEFAULT_ADMIN_ROLE = process.env.DEFAULT_ADMIN_ROLE === 'ADMIN' ? 'ADMIN' : 'SUPER_ADMIN'

function validateAdminSeedPassword () {
  if (process.env.NODE_ENV !== 'production') {
    if (DEFAULT_ADMIN_PASSWORD === 'password') {
      console.warn('WARNING: DEFAULT_ADMIN_PASSWORD is using the development default. Set a strong value before production use.')
    }
    return
  }

  if (DEFAULT_ADMIN_PASSWORD === 'password' || DEFAULT_ADMIN_PASSWORD.length < 12) {
    throw new Error('DEFAULT_ADMIN_PASSWORD must be set to a unique password with at least 12 characters in production.')
  }
}

async function createAdminUser () {
  validateAdminSeedPassword()
  const password = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10)
  try {
    await prisma.user.upsert({
      where: {
        email: DEFAULT_ADMIN_EMAIL
      },
      update: {
        password,
        firstName: 'Admin',
        lastName: 'User',
        role: DEFAULT_ADMIN_ROLE,
        deleted: false
      },
      create: {
        email: DEFAULT_ADMIN_EMAIL,
        password,
        firstName: 'Admin',
        lastName: 'User',
        role: DEFAULT_ADMIN_ROLE,
        deleted: false
      }
    })
    console.log(`${DEFAULT_ADMIN_ROLE} user created/updated successfully`)
  } catch (error) {
    console.error('Error creating admin user:', error)
  }
}

// Mirror of DepartmentResolver.getNextAvailableSubnet: departments live on
// 10.10.X.0/24, one per third octet. Pick the first free octet so the seeded
// Default department gets the same deterministic subnet the UI would assign.
async function getNextAvailableSubnet (): Promise<string> {
  const departments = await prisma.department.findMany({
    where: { ipSubnet: { not: null } },
    select: { ipSubnet: true }
  })
  const usedOctets = new Set<number>()
  for (const dept of departments) {
    const match = dept.ipSubnet?.match(/^10\.10\.(\d+)\.0\/24$/)
    if (match && match[1]) usedOctets.add(parseInt(match[1], 10))
  }
  for (let octet = 1; octet <= 254; octet++) {
    if (!usedOctets.has(octet)) return `10.10.${octet}.0/24`
  }
  throw new Error('No available subnets remaining (max 254 departments reached).')
}

// Create the Default department WITH an ipSubnet so its Linux bridge can be
// provisioned. The actual bridge (dnsmasq/NAT) is built AFTER the seed
// transaction commits, in provisionDefaultDepartmentNetwork() — kernel side
// effects must not run inside a DB transaction. firewallPolicy (BLOCK_ALL) and
// firewallDefaultConfig (allow_outbound) come from their schema defaults, so the
// seeded department matches one created via the createDepartment mutation.
async function createDefaultDepartment () {
  try {
    const existing = await prisma.department.findFirst({
      where: { name: { equals: 'Default', mode: 'insensitive' } }
    })
    if (existing) {
      // Legacy Default departments (seeded before network provisioning existed)
      // have no subnet, so neither restoreAllNetworks nor the VM-create path can
      // ever build their bridge. Backfill a subnet so the provisioning step below
      // can create it — makes re-running the seed self-healing.
      if (!existing.ipSubnet) {
        const ipSubnet = await getNextAvailableSubnet()
        await prisma.department.update({ where: { id: existing.id }, data: { ipSubnet } })
        console.log(`Default department already existed — backfilled subnet ${ipSubnet}`)
      } else {
        console.log('Default department already exists')
      }
      return
    }

    const ipSubnet = await getNextAvailableSubnet()
    await prisma.department.create({
      data: { name: 'Default', ipSubnet }
    })
    console.log(`Default department created successfully (subnet ${ipSubnet})`)
  } catch (error) {
    console.error('Error creating default department:', error)
  }
}

// Provision the Default department's network (Linux bridge + dnsmasq/DHCP + NAT +
// default firewall rule set), mirroring the createDepartment GraphQL mutation.
// Runs OUTSIDE the seed transaction: configureNetwork() creates kernel resources
// and updates the DB itself, so wrapping it in an interactive transaction would
// both risk the transaction timeout and mix real side effects with a rollback-able
// unit. Idempotent — skips a department that already has a bridge.
async function provisionDefaultDepartmentNetwork () {
  const department = await prisma.department.findFirst({
    where: { name: { equals: 'Default', mode: 'insensitive' } }
  })
  if (!department) return
  if (department.bridgeName) {
    console.log(`Default department network already provisioned (bridge ${department.bridgeName})`)
    return
  }
  if (!department.ipSubnet) {
    console.warn('Default department has no subnet — skipping network provisioning')
    return
  }

  // Wire the same firewall stack the createDepartment resolver uses so the seeded
  // department gets an identical default firewall rule set (configureNetwork skips
  // firewall setup silently if these are omitted).
  const firewallRuleService = new FirewallRuleService(prisma)
  const firewallPolicyService = new FirewallPolicyService(prisma, firewallRuleService)
  const firewallValidationService = new FirewallValidationService()
  const infinizationFirewallService = new InfinizationFirewallService(prisma)
  const firewallOrchestrationService = new FirewallOrchestrationService(
    prisma,
    firewallRuleService,
    firewallValidationService,
    infinizationFirewallService
  )
  const networkService = new DepartmentNetworkService(
    prisma,
    firewallRuleService,
    firewallPolicyService,
    firewallOrchestrationService
  )

  try {
    console.log(`Provisioning Default department network (${department.ipSubnet})…`)
    await networkService.configureNetwork(department.id, department.ipSubnet)
    console.log('Default department network provisioned successfully')
  } catch (error) {
    // Host networking may be unavailable here (control-plane-only / no NET_ADMIN,
    // e.g. Docker Desktop). Don't fail the whole seed. configureNetwork persists
    // bridgeName BEFORE creating kernel resources and its rollback does NOT clear
    // that pointer, so reset the network columns to null — otherwise the VM-create
    // check would see a bridgeName and try to attach VMs to a bridge that does not
    // exist. Leaving ipSubnet lets a later provision (UI recreate, or a KVM-host
    // boot) build the bridge cleanly.
    console.warn(
      'Could not provision Default department network (host networking may be ' +
      `unavailable in this environment): ${error instanceof Error ? error.message : String(error)}`
    )
    await prisma.department.update({
      where: { id: department.id },
      data: { bridgeName: null, gatewayIP: null, dhcpRangeStart: null, dhcpRangeEnd: null, dnsmasqPid: null }
    }).catch(() => { /* best-effort cleanup */ })
  }
}

async function createDefaultMachineTemplateCategory () {
  try {
    const defaultCategory = await prisma.machineTemplateCategory.create({
      data: {
        name: 'Default Category',
        description: 'Default category for machine templates'
      }
    })
    console.log('Default machine template category created successfully')
    return defaultCategory
  } catch (error) {
    console.error('Error creating default machine template category:', error)
    return null
  }
}

async function updateMachineTemplates (defaultCategoryId: string) {
  try {
    await prisma.machineTemplate.updateMany({
      where: { categoryId: null },
      data: { categoryId: defaultCategoryId }
    })
    console.log('Machine templates updated successfully')
  } catch (error) {
    console.error('Error updating machine templates:', error)
  }
}

async function createDefaultMachineTemplate () {
  // Removed default template creation - users should create their own templates
  // or use custom hardware configuration
  console.log('Skipping default template creation - users will use custom hardware')
}

async function createDefaultAppSettings (prisma: Prisma.TransactionClient | PrismaClient) {
  try {
    await prisma.appSettings.upsert({
      where: {
        id: 'default-settings'
      },
      update: {
        theme: 'system',
        wallpaper: 'wallpaper1.jpg',
        logoUrl: null,
        interfaceSize: 'xl'
      },
      create: {
        id: 'default-settings',
        theme: 'system',
        wallpaper: 'wallpaper1.jpg',
        logoUrl: null,
        interfaceSize: 'xl'
      }
    })
    console.log('Default app settings created/updated successfully')
  } catch (error) {
    console.error('Error creating default app settings:', error)
  }
}

async function main () {
  try {
    // Note: installCallbacks is deprecated and does nothing (callbacks are auto-applied via Prisma Client Extensions)
    // Callbacks will be triggered during seeding, but they gracefully handle errors without failing the seed
    installCallbacks(prisma)
    await prisma.$transaction(async (transactionPrisma) => {
      // Create admin user and departments
      await createAdminUser()
      // Seed system roles (SUPER_ADMIN/ADMIN/USER) + their verb grants, and
      // backfill roleId for the admin (and any pre-existing users).
      await applyRolePresets(prisma)
      await createDefaultDepartment()
      const defaultCategory = await createDefaultMachineTemplateCategory()
      if (defaultCategory) {
        await updateMachineTemplates(defaultCategory.id)
        await createDefaultMachineTemplate()
      }
      await createApplications(transactionPrisma)
      await createScripts(transactionPrisma)

      // Create default app settings
      await createDefaultAppSettings(transactionPrisma)
    })

    // Provision the Default department's Linux bridge AFTER the transaction: this
    // touches the host network (bridge/dnsmasq/NAT) and must not run inside a DB
    // transaction. Non-fatal — a host without KVM/NET_ADMIN still gets a seeded DB.
    await provisionDefaultDepartmentNetwork()

    console.log('Seeding completed successfully')
  } catch (error) {
    console.error('Error during seeding:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
