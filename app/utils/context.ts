import { Request, Response } from 'express'
import { PrismaClient, User } from '@prisma/client'

export interface InfinibayContext {
  req: Request
  res: Response
  // user should be of User prisma type or null
  user: User | null
  prisma: PrismaClient
  setupMode: boolean
}
