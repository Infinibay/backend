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

async function createDefaultDepartment () {
  try {
    await prisma.department.create({
      data: {
        name: 'Default'
      }
    })
    console.log('Default department created successfully')
  } catch (error) {
    console.error('Error creating default department:', error)
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
    console.log('Seeding completed successfully')
  } catch (error) {
    console.error('Error during seeding:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
