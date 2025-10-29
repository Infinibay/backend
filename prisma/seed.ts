// Register tsconfig paths before any imports that use path aliases
import { register } from 'tsconfig-paths'
import { resolve } from 'path'

import { PrismaClient, Prisma } from '@prisma/client'
import bcrypt from 'bcrypt'
import dotenv from 'dotenv'
import createApplications from './seeds/applications'
import createScripts from './seeds/scripts'

import installCallbacks from '../app/utils/modelsCallbacks'

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
async function createAdminUser () {
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
        role: 'ADMIN',
        deleted: false
      },
      create: {
        email: DEFAULT_ADMIN_EMAIL,
        password,
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        deleted: false
      }
    })
    console.log('Admin user created/updated successfully')
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

async function createDefaultMachineTemplate (defaultCategoryId: string) {
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
      await createDefaultDepartment()
      const defaultCategory = await createDefaultMachineTemplateCategory()
      if (defaultCategory) {
        await updateMachineTemplates(defaultCategory.id)
        await createDefaultMachineTemplate(defaultCategory.id)
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
