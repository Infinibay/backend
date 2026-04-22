import { PrismaClient, RecommendationType, VMRecommendation } from '@prisma/client'
import { installOSUpdatesHandler } from './InstallOSUpdatesHandler'
import { installAppUpdatesHandler, installSecurityUpdatesHandler } from './InstallAppUpdatesHandler'
import { rebootVMHandler } from './RebootVMHandler'
import { scheduleRebootHandler } from './ScheduleRebootHandler'
import { enableDefenderHandler } from './EnableDefenderHandler'

export interface ResolutionHandlerContext {
  prisma: PrismaClient
  recommendation: VMRecommendation & { machine: { id: string; userId: string | null; name: string; os: string } }
  machineId: string
  params: Record<string, unknown>
  reportProgress: (progress: number, message?: string) => Promise<void>
}

export interface HandlerResult {
  message?: string
  data?: Record<string, unknown>
  /** If true, the resolution ends in REQUIRES_REBOOT state instead of SUCCEEDED */
  requiresReboot?: boolean
}

export interface ResolutionHandler {
  actionKey: string
  /** Recommendation types this handler applies to */
  types: RecommendationType[]
  /** Destructive actions must check params.confirmed === true */
  requiresConfirmation?: boolean
  run: (ctx: ResolutionHandlerContext) => Promise<HandlerResult>
}

const REGISTRY: ResolutionHandler[] = [
  installOSUpdatesHandler,
  installAppUpdatesHandler,
  installSecurityUpdatesHandler,
  rebootVMHandler,
  scheduleRebootHandler,
  enableDefenderHandler
]

export function getResolutionHandler (type: RecommendationType, actionKey: string): ResolutionHandler | undefined {
  return REGISTRY.find(h => h.actionKey === actionKey && h.types.includes(type))
}

export function listHandlers (): ResolutionHandler[] {
  return REGISTRY.slice()
}
