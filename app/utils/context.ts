import { Request, Response } from 'express'
import { PrismaClient, User } from '@prisma/client'
import { EventManager } from '../services/EventManager'
import { VirtioSocketWatcherService } from '../services/VirtioSocketWatcherService'

export interface InfinibayContext {
  req: Request
  res: Response
  // user should be of User prisma type or null
  user: User | null
  prisma: PrismaClient
  setupMode: boolean
  eventManager?: EventManager
  virtioSocketWatcher?: VirtioSocketWatcherService
}
