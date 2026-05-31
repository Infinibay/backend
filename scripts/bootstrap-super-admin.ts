/// <reference types="node" />

import 'dotenv/config'
import { PrismaClient, UserRole } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const args = process.argv.slice(2)

function argValue (name: string): string | undefined {
  return args.find(arg => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

const email = argValue('email') || process.env.SUPER_ADMIN_EMAIL || process.env.DEFAULT_ADMIN_EMAIL
const password = argValue('password') || process.env.SUPER_ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD
const firstName = argValue('first-name') || process.env.SUPER_ADMIN_FIRST_NAME || 'Super'
const lastName = argValue('last-name') || process.env.SUPER_ADMIN_LAST_NAME || 'Admin'
const allowWeak = args.includes('--allow-weak')

function validateInput (): void {
  if (!email) {
    throw new Error('Missing email. Use --email=admin@example.com or SUPER_ADMIN_EMAIL.')
  }
  if (!password) {
    throw new Error('Missing password. Use --password=... or SUPER_ADMIN_PASSWORD.')
  }
  if (!allowWeak && password.length < 12) {
    throw new Error('Password must be at least 12 characters. Use --allow-weak only for local development.')
  }
}

async function main (): Promise<void> {
  validateInput()

  const hashedPassword = await bcrypt.hash(
    password as string,
    parseInt(process.env.BCRYPT_ROUNDS || '10')
  )
  const user = await prisma.user.upsert({
    where: {
      email: email as string
    },
    update: {
      password: hashedPassword,
      firstName,
      lastName,
      role: UserRole.SUPER_ADMIN,
      deleted: false,
      identityProviderId: null,
      externalId: null,
      externalDn: null
    },
    create: {
      email: email as string,
      password: hashedPassword,
      firstName,
      lastName,
      role: UserRole.SUPER_ADMIN,
      deleted: false
    },
    select: {
      id: true,
      email: true,
      role: true
    }
  })

  console.log(`SUPER_ADMIN ready: ${user.email} (${user.id})`)
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
