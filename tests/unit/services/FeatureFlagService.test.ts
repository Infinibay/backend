import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { mockDeep } from 'jest-mock-extended'
import { PrismaClient } from '@prisma/client'

import { FeatureFlagService } from '../../../app/services/FeatureFlagService'

describe('FeatureFlagService', () => {
  let prisma: ReturnType<typeof mockDeep<PrismaClient>>
  let service: FeatureFlagService

  beforeEach(() => {
    jest.clearAllMocks()
    prisma = mockDeep<PrismaClient>()
    service = new FeatureFlagService(prisma)
  })

  describe('getAll', () => {
    it('returns the storage flag DISABLED by default when there is no DB override', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([] as never)

      const flags = await service.getAll()
      const storage = flags.find((f) => f.key === 'storage')

      expect(storage).toBeDefined()
      expect(storage?.enabled).toBe(false)
      expect(storage?.label).toBeTruthy()
      expect(storage?.description).toBeTruthy()
    })

    it('overlays a DB override on top of the registry default', async () => {
      prisma.featureFlag.findMany.mockResolvedValue([{ key: 'storage', enabled: true }] as never)

      const flags = await service.getAll()

      expect(flags.find((f) => f.key === 'storage')?.enabled).toBe(true)
    })
  })

  describe('isEnabled', () => {
    it('returns the DB override when a row exists', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue({ key: 'storage', enabled: true } as never)
      expect(await service.isEnabled('storage')).toBe(true)
    })

    it('falls back to the registry default (false) when there is no row', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null as never)
      expect(await service.isEnabled('storage')).toBe(false)
    })

    it('returns false for an unknown key with no row', async () => {
      prisma.featureFlag.findUnique.mockResolvedValue(null as never)
      expect(await service.isEnabled('does-not-exist')).toBe(false)
    })
  })

  describe('set', () => {
    it('upserts a known flag and returns the resolved flag', async () => {
      prisma.featureFlag.upsert.mockResolvedValue({ key: 'storage', enabled: true } as never)

      const result = await service.set('storage', true, 'user-1')

      expect(prisma.featureFlag.upsert).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({ key: 'storage', enabled: true })
    })

    it('rejects an unknown flag key without touching the DB', async () => {
      await expect(service.set('not-a-real-flag', true)).rejects.toThrow(/unknown feature flag/i)
      expect(prisma.featureFlag.upsert).not.toHaveBeenCalled()
    })
  })
})
