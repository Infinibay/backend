import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { ISO as PrismaISO } from '@prisma/client'

// Mock PrismaClient at module level since ISOService instantiates its own
const mockPrismaInstance: any = {
  iSO: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
    upsert: jest.fn()
  }
}

jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client') as any
  return {
    ...actual,
    PrismaClient: jest.fn(() => mockPrismaInstance)
  }
})

// Mock fs/promises
jest.mock('fs/promises', () => {
  const mkdirMock = jest.fn() as jest.Mock<any>
  mkdirMock.mockResolvedValue(undefined)
  const readdirMock = jest.fn() as jest.Mock<any>
  readdirMock.mockResolvedValue([])
  const accessMock = jest.fn() as jest.Mock<any>
  accessMock.mockResolvedValue(undefined)
  const statMock = jest.fn() as jest.Mock<any>
  statMock.mockResolvedValue({ size: 5368709120 })
  const readFileMock = jest.fn() as jest.Mock<any>
  readFileMock.mockResolvedValue(Buffer.from('fake-iso-data'))
  const unlinkMock = jest.fn() as jest.Mock<any>
  unlinkMock.mockResolvedValue(undefined)
  return {
    mkdir: mkdirMock,
    readdir: readdirMock,
    access: accessMock,
    stat: statMock,
    readFile: readFileMock,
    unlink: unlinkMock
  }
})

// Mock ISOEventManager
jest.mock('../../../app/services/EventManagers/ISOEventManager', () => ({
  ISOEventManager: {
    getInstance: jest.fn(() => ({
      emitISORegistered: jest.fn(),
      emitISORemoved: jest.fn(),
      emitISOValidated: jest.fn(),
      emitUploadProgress: jest.fn(),
      emitDownloadProgress: jest.fn(),
      emitStatusChanged: jest.fn(),
      emitBatchStatusUpdate: jest.fn(),
      emitSystemReadinessUpdate: jest.fn()
    }))
  }
}))

import { ISOService, ISOStatus } from '../../../app/services/vm/ISOService'

describe('ISOService', () => {
  const originalEnv = process.env

  const mockISO: PrismaISO = {
    id: 'iso-123',
    filename: 'windows10.iso',
    os: 'WINDOWS10',
    version: null,
    path: '/opt/infinibay/iso/windows10.iso',
    size: BigInt(5368709120),
    uploadedAt: new Date(),
    lastVerified: new Date(),
    isAvailable: true,
    checksum: null,
    downloadUrl: null,
    createdAt: new Date(),
    updatedAt: new Date()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, INFINIBAY_BASE_DIR: '/opt/infinibay' }
    // Reset singleton
    ;(ISOService as any).instance = undefined
  })

  afterEach(() => {
    process.env = originalEnv
    jest.restoreAllMocks()
  })

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = ISOService.getInstance()
      const instance2 = ISOService.getInstance()

      expect(instance1).toBe(instance2)
    })
  })

  describe('getAvailableISOs', () => {
    it('should return all available ISOs', async () => {
      const availableISOs = [mockISO]
      mockPrismaInstance.iSO.findMany.mockResolvedValue(availableISOs)

      const result = await ISOService.getInstance().getAvailableISOs()

      expect(mockPrismaInstance.iSO.findMany).toHaveBeenCalledWith({
        where: { isAvailable: true },
        orderBy: { os: 'asc' }
      })
      expect(result).toEqual(availableISOs)
    })

    it('should handle empty results', async () => {
      mockPrismaInstance.iSO.findMany.mockResolvedValue([])

      const result = await ISOService.getInstance().getAvailableISOs()

      expect(result).toEqual([])
    })

    it('should propagate database errors', async () => {
      const error = new Error('Database connection failed')
      mockPrismaInstance.iSO.findMany.mockRejectedValue(error)

      await expect(ISOService.getInstance().getAvailableISOs()).rejects.toThrow('Database connection failed')
    })
  })

  describe('checkISOForOS', () => {
    it('should return available status when ISO exists', async () => {
      mockPrismaInstance.iSO.findFirst.mockResolvedValue(mockISO)

      const result = await ISOService.getInstance().checkISOForOS('WINDOWS10')

      expect(result.os).toBe('WINDOWS10')
      expect(result.available).toBe(true)
      expect(result.iso).toEqual(mockISO)
    })

    it('should return unavailable status when ISO not found', async () => {
      mockPrismaInstance.iSO.findFirst.mockResolvedValue(null)

      const result = await ISOService.getInstance().checkISOForOS('LINUX_DISTRO')

      expect(result.os).toBe('LINUX_DISTRO')
      expect(result.available).toBe(false)
      expect(result.iso).toBeUndefined()
    })
  })

  describe('validateISO', () => {
    it('should return true for valid ISO', async () => {
      mockPrismaInstance.iSO.findUnique.mockResolvedValue({
        ...mockISO,
        size: BigInt(5368709120)
      })
      mockPrismaInstance.iSO.update.mockResolvedValue(mockISO)

      const fs = require('fs/promises')
      fs.stat.mockResolvedValue({ size: 5368709120 })

      const result = await ISOService.getInstance().validateISO('iso-123')

      expect(result).toBe(true)
    })

    it('should return false when ISO not found', async () => {
      mockPrismaInstance.iSO.findUnique.mockResolvedValue(null)

      const result = await ISOService.getInstance().validateISO('non-existent-id')

      expect(result).toBe(false)
    })

    it('should return false when file size mismatch', async () => {
      mockPrismaInstance.iSO.findUnique.mockResolvedValue({
        ...mockISO,
        size: BigInt(9999999)
      })
      mockPrismaInstance.iSO.update.mockResolvedValue(mockISO)

      const fs = require('fs/promises')
      fs.stat.mockResolvedValue({ size: 5368709120 })

      const result = await ISOService.getInstance().validateISO('iso-123')

      expect(result).toBe(false)
    })
  })

  describe('getSystemReadiness', () => {
    it('should return system readiness status', async () => {
      const mockISOs = [
        { ...mockISO, os: 'WINDOWS10', isAvailable: true },
        { ...mockISO, id: 'iso-456', os: 'UBUNTU', isAvailable: true }
      ]

      mockPrismaInstance.iSO.findMany.mockResolvedValue(mockISOs)

      const result = await ISOService.getInstance().getSystemReadiness()

      expect(result).toHaveProperty('ready')
      expect(result).toHaveProperty('availableOS')
      expect(result).toHaveProperty('missingOS')
      expect(result.ready).toBe(true)
      expect(result.availableOS).toContain('WINDOWS10')
      expect(result.availableOS).toContain('UBUNTU')
    })

    it('should report missing OS types', async () => {
      mockPrismaInstance.iSO.findMany.mockResolvedValue([])

      const result = await ISOService.getInstance().getSystemReadiness()

      expect(result.ready).toBe(false)
      expect(result.missingOS.length).toBeGreaterThan(0)
    })
  })

  describe('getSupportedOSTypes', () => {
    it('should return supported OS types', () => {
      const result = ISOService.getInstance().getSupportedOSTypes()

      expect(result).toContain('WINDOWS10')
      expect(result).toContain('WINDOWS11')
      expect(result).toContain('UBUNTU')
      expect(result).toContain('FEDORA')
    })
  })

  describe('extractOSType', () => {
    it('should extract OS type from filename', () => {
      const osType = ISOService.getInstance()['extractOSType']('windows10.iso')

      expect(osType).toBe('WINDOWS10')
    })

    it('should handle windows11 filename', () => {
      const osType = ISOService.getInstance()['extractOSType']('windows11.iso')

      expect(osType).toBe('WINDOWS11')
    })

    it('should return null for unknown filenames', () => {
      const osType = ISOService.getInstance()['extractOSType']('unknown_file.iso')

      expect(osType).toBeNull()
    })
  })

  describe('checkMultipleOSAvailability', () => {
    it('should check multiple OS availability', async () => {
      mockPrismaInstance.iSO.findMany.mockResolvedValue([
        { ...mockISO, os: 'WINDOWS10' }
      ])

      const result = await ISOService.getInstance().checkMultipleOSAvailability(['WINDOWS10', 'UBUNTU'])

      expect(result.get('WINDOWS10')).toBe(true)
      expect(result.get('UBUNTU')).toBe(false)
    })
  })

  describe('error handling', () => {
    it('should handle database errors gracefully in getAvailableISOs', async () => {
      const error = new Error('Database connection error')
      mockPrismaInstance.iSO.findMany.mockRejectedValue(error)

      await expect(ISOService.getInstance().getAvailableISOs()).rejects.toThrow(
        'Database connection error'
      )
    })

    it('should handle validation errors', async () => {
      const error = new Error('File not found')
      mockPrismaInstance.iSO.findUnique.mockRejectedValue(error)

      const result = await ISOService.getInstance().validateISO('iso-123')

      // validateISO returns false on error (catches internally)
      expect(result).toBe(false)
    })
  })
})
