#!/usr/bin/env ts-node
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function checkFilter() {
  const filterName = 'ibay-a454599817540260'
  
  const filter = await prisma.nWFilter.findFirst({
    where: {
      internalName: filterName
    }
  })
  
  if (filter) {
    console.log('Filter found in database:', filter)
  } else {
    console.log('Filter NOT found in database')
  }
  
  await prisma.$disconnect()
}

checkFilter().catch(console.error)