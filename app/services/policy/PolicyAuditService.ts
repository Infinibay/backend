import { Prisma, PrismaClient } from '@prisma/client'
import logger from '@main/logger'

/**
 * Append-only audit trail for authorization changes (role-permission matrix
 * edits, department-membership changes). Recording must never break the
 * operation it is auditing, so failures are logged and swallowed.
 */
export interface RecordAuditInput {
  actorId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  summary: string
  metadata?: Record<string, unknown>
}

export class PolicyAuditService {
  constructor (private readonly prisma: PrismaClient) {}

  async record (input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.policyAuditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          summary: input.summary,
          metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull
        }
      })
    } catch (err) {
      logger.warn(`policy audit record failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async list (limit = 100) {
    const take = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500)
    return this.prisma.policyAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        actor: { select: { id: true, firstName: true, lastName: true, email: true } }
      }
    })
  }
}
