import crypto from 'crypto'
import { PrismaClient } from '@prisma/client'

/**
 * Opaque refresh tokens persisted as SHA-256 hashes.
 *
 * The raw token is returned to the caller exactly once (on issue/rotate) and is
 * never stored in plaintext. Lookups happen by hashing the presented raw token.
 */

export function hashToken (raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export const ACCESS_TOKEN_TTL: string = process.env.ACCESS_TOKEN_TTL || '1h'

function parseTtlSeconds (ttl: string): number {
  const match = /^(\d+)([smh])$/.exec(ttl.trim())
  if (!match) {
    return 3600
  }
  const value = parseInt(match[1], 10)
  const unit = match[2]
  if (unit === 's') {
    return value
  }
  if (unit === 'm') {
    return value * 60
  }
  if (unit === 'h') {
    return value * 3600
  }
  return 3600
}

export const ACCESS_TOKEN_TTL_SECONDS: number = parseTtlSeconds(ACCESS_TOKEN_TTL)

export const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30')

const DAY_MS = 24 * 60 * 60 * 1000

export async function issueRefreshToken (
  prisma: PrismaClient,
  userId: string
): Promise<{ token: string, expiresAt: Date }> {
  const raw = crypto.randomBytes(48).toString('base64url')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * DAY_MS)

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt
    }
  })

  return { token: raw, expiresAt }
}

export async function rotateRefreshToken (
  prisma: PrismaClient,
  rawToken: string
): Promise<{ userId: string, token: string, expiresAt: Date } | null> {
  const tokenHash = hashToken(rawToken)
  const now = new Date()

  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } })
  if (!existing || existing.revokedAt !== null || existing.expiresAt < now) {
    return null
  }

  const userId = existing.userId
  const raw = crypto.randomBytes(48).toString('base64url')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * DAY_MS)

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: now }
    }),
    prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        expiresAt
      }
    })
  ])

  return { userId, token: raw, expiresAt }
}

export async function revokeAllForUser (
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  })
}
