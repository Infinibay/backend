import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt';

import { PASSWORD_PASSES } from '../src/utils/globals';

const prisma = new PrismaClient()

async function initSystemSettings() {
  await prisma.systemSetting.create({
    data: {
      path: 'system.paths.isos',
      hidden: false,
      value: '/media/isos'
    }
  })
  await prisma.systemSetting.create({
    data: {
      path: 'system.paths.disks',
      hidden: false,
      value: '/media/disks'
    }
  })
  await prisma.systemSetting.create({
    data: {
      path: 'system.paths.downloads',
      hidden: false,
      value: '/media/downloads'
    }
  })
  await prisma.systemSetting.create({
    data: {
      path: 'system.paths.extract_isos',
      hidden: false,
      value: '/media/extract_isos'
    }
  })
  await prisma.systemSetting.create({
    data: {
      path: 'system.paths.modified_isos',
      hidden: false,
      value: '/media/modified_isos'
    }
  }) 
}
// To run this script, run: npx prisma db seed
async function main() {
  const hashedPassword = bcrypt.hashSync('password', PASSWORD_PASSES)
  await prisma.user.create({
    data: {
      email: 'example@example.com',
      firstName: 'John',
      lastName: 'Doe',
      password: hashedPassword,
    }
  })
  await initSystemSettings()
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  });