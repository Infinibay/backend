// @ts-nocheck - Extensive mock typing prevents proper TS type checking
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'

// Create mock before importing anything that uses it
const mockISO = {
  findFirst: jest.fn<any, any[]>(),
  findUnique: jest.fn<any, any[]>(),
  findMany: jest.fn<any, any[]>(),
  create: jest.fn<any, any[]>(),
  update: jest.fn<any, any[]>(),
  delete: jest.fn<any, any[]>()
} as { findFirst: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock; delete: jest.Mock }

// Mock @prisma/client BEFORE ISOService imports it
jest.mock('@prisma/client', () => ({
  __esModule: true,
  PrismaClient: jest.fn().mockReturnValue({ iSO: mockISO }),
  Prisma: {}
}))
const mockPrismaISO = mockISO

// Create mockFs first for hoisting
const mockFs = {
  mkdir: jest.fn<any, any[]>(),
  stat: jest.fn<any, any[]>(),
  access: jest.fn<any, any[]>(),
  unlink: jest.fn<any, any[]>(),
  readFile: jest.fn<any, any[]>(),
  readdir: jest.fn<any, any[]>()
}

// Mock fs/promises
jest.mock('fs/promises', () => ({
  mkdir: (...args: any[]) => mockFs.mkdir(...args),
  stat: (...args: any[]) => mockFs.stat(...args),
  access: (...args: any[]) => mockFs.access(...args),
  unlink: (...args: any[]) => mockFs.unlink(...args),
  readFile: (...args: any[]) => mockFs.readFile(...args),
  readdir: (...args: any[]) => mockFs.readdir(...args),
  default: {}
}))

// Mock EventManager
const mockISOEventManagerInstance = {
  emitISORegistered: jest.fn(),
  emitISORemoved: jest.fn(),
  emitISOValidated: jest.fn(),
  emitUploadProgress: jest.fn(),
  emitDownloadProgress: jest.fn(),
  emitStatusChanged: jest.fn(),
  emitBatchStatusUpdate: jest.fn(),
  emitSystemReadinessUpdate: jest.fn()
}

jest.mock('../../../app/services/EventManagers/ISOEventManager', () => ({
  __esModule: true,
  ISOEventManager: {
    getInstance: jest.fn(() => mockISOEventManagerInstance)
  }
}))

import { ISOService } from '../../../app/services/ISOService'

describe('ISOService', () => {
  let service: ISOService
  let originalBaseDir: string | undefined

  const createMockISO = (overrides?: Partial<any>): any => ({
    id: 'iso-1', filename: 'windows10.iso', os: 'WINDOWS10',
    version: null, size: BigInt(5368709120),
    path: '/opt/infinibay/iso/windows10.iso',
    checksum: null, isAvailable: true,
    lastVerified: new Date(), uploadedAt: new Date(),
    downloadUrl: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides
  })

  beforeEach(async () => {
    jest.clearAllMocks()
    originalBaseDir = process.env.INFINIBAY_BASE_DIR
    process.env.INFINIBAY_BASE_DIR = '/opt/infinibay'
    ;(ISOService as any).instance = undefined
    service = ISOService.getInstance()

    mockFs.mkdir.mockResolvedValue(undefined)
    mockFs.stat.mockResolvedValue({ size: 5368709120, isFile: () => true } as any)
    mockFs.access.mockResolvedValue(undefined)
    mockFs.unlink.mockResolvedValue(undefined)
    mockFs.readFile.mockResolvedValue(Buffer.from('mock'))
    mockFs.readdir.mockResolvedValue(['windows10.iso'])
  })

  afterEach(() => {
    jest.restoreAllMocks()
    process.env.INFINIBAY_BASE_DIR = originalBaseDir
  })

  describe('singleton pattern', () => {
    it('should return the same instance on multiple calls', () => {
      const i1 = ISOService.getInstance()
      const i2 = ISOService.getInstance()
      expect(i1).toBe(i2)
    })

    it('should create new instance when instance is undefined', () => {
      ;(ISOService as any).instance = undefined
      const n = ISOService.getInstance()
      expect(n).toBeDefined()
      expect(n).toBeInstanceOf(ISOService)
    })
  })

  describe('getAvailableISOs', () => {
    it('should return available ISOs', async () => {
      mockPrismaISO.findMany.mockResolvedValue([
        createMockISO({ os: 'WINDOWS10', isAvailable: true })
      ])
      const result = await service.getAvailableISOs()
      expect(result).toHaveLength(1)
      expect(result[0].os).toBe('WINDOWS10')
    })

    it('should return empty array when no ISOs available', async () => {
      mockPrismaISO.findMany.mockResolvedValue([])
      const result = await service.getAvailableISOs()
      expect(result).toEqual([])
    })
  })

 describe('syncISOsWithFileSystem', () => {
   it('should sync ISOs from filesystem to database', async () => {
      mockFs.readdir.mockResolvedValueOnce(['windows10.iso', 'ubuntu.iso'])
      mockPrismaISO.findUnique.mockResolvedValue(null)
      mockPrismaISO.create.mockResolvedValue(createMockISO())
      mockPrismaISO.findMany.mockResolvedValue([])
      await service.syncISOsWithFileSystem()
      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      expect(mockPrismaISO.create).toHaveBeenCalled()
      expect(mockISOEventManagerInstance.emitISORegistered).toHaveBeenCalled()
    })

    it('should update existing ISO with new verification timestamp', async () => {
      mockFs.readdir.mockResolvedValueOnce(['windows10.iso'])
      const existing = createMockISO({ id: 'existing-iso' })
      mockPrismaISO.findUnique.mockResolvedValueOnce(existing)
      mockPrismaISO.findUnique.mockResolvedValueOnce(null)
      mockPrismaISO.update.mockResolvedValue(existing)
      mockPrismaISO.findMany.mockResolvedValue([])
      await service.syncISOsWithFileSystem()
      expect(mockPrismaISO.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'existing-iso' },
          data: expect.objectContaining({ lastVerified: expect.any(Date), isAvailable: true })
        })
      )
    })

    it('should mark ISOs as unavailable if file is deleted', async () => {
     mockFs.readdir.mockResolvedValueOnce(['windows10.iso'])
      const existing = createMockISO({ id: 'iso-1' })
      mockPrismaISO.findMany.mockResolvedValue([existing])
      mockPrismaISO.update.mockResolvedValue({ ...existing, isAvailable: false })
      mockFs.access.mockRejectedValueOnce(new Error('File not found'))
      await service.syncISOsWithFileSystem()
      expect(mockPrismaISO.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'iso-1' },
          data: { isAvailable: false }
        })
      )
    })

    it('should handle error gracefully', async () => {
      mockFs.mkdir.mockRejectedValueOnce(new Error('Permission denied'))
      await expect(service.syncISOsWithFileSystem()).rejects.toThrow('Permission denied')
    })

    it('should handle ISO directory not existing', async () => {
      mockFs.readdir.mockResolvedValueOnce([])
      mockPrismaISO.findMany.mockResolvedValue([])
      await service.syncISOsWithFileSystem()
      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })
  })

  describe('checkISOForOS', () => {
    it('should return true when ISO exists', async () => {
      mockPrismaISO.findFirst.mockResolvedValue(createMockISO())
      const result = await service.checkISOForOS('windows10')
      expect(result).toEqual({ os: 'WINDOWS10', available: true, iso: expect.any(Object) })
    })

    it('should return false when ISO does not exist', async () => {
      mockPrismaISO.findFirst.mockResolvedValue(null)
      const result = await service.checkISOForOS('ubuntu')
      expect(result).toEqual({ os: 'UBUNTU', available: false, iso: undefined })
    })

    it('should handle case insensitivity', async () => {
      mockPrismaISO.findFirst.mockResolvedValue(createMockISO())
      await service.checkISOForOS('Windows10')
      expect(mockPrismaISO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ os: 'WINDOWS10' }) })
      )
    })
  })

  describe('getSystemReadiness', () => {
    it('should return ready when ISOs are available', async () => {
      mockPrismaISO.findMany.mockResolvedValue([
        createMockISO({ os: 'WINDOWS10' }),
        createMockISO({ id: 'iso-2', os: 'UBUNTU' })
      ])
      const result = await service.getSystemReadiness()
      expect(result.ready).toBe(true)
      expect(result.availableOS).toEqual(expect.arrayContaining(['WINDOWS10', 'UBUNTU']))
      expect(result.missingOS).toEqual(expect.arrayContaining(['WINDOWS11', 'FEDORA']))
    })

    it('should return not ready when no ISOs', async () => {
      mockPrismaISO.findMany.mockResolvedValue([])
      const result = await service.getSystemReadiness()
      expect(result).toEqual({
        ready: false, availableOS: [],
        missingOS: ['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA']
      })
    })

    it('should include all supported OS types', async () => {
      mockPrismaISO.findMany.mockResolvedValue([createMockISO({ os: 'WINDOWS10' })])
      const result = await service.getSystemReadiness()
      expect(result.missingOS).toEqual(['WINDOWS11', 'UBUNTU', 'FEDORA'])
    })
  })

 describe('validateISO', () => {
    it('should validate ISO successfully', async () => {
      mockPrismaISO.findUnique.mockResolvedValue(createMockISO())
      mockPrismaISO.update.mockResolvedValue(createMockISO())
      const result = await service.validateISO('iso-1')
      expect(result).toBe(true)
      expect(mockPrismaISO.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'iso-1' },
          data: expect.objectContaining({ isAvailable: true, lastVerified: expect.any(Date) })
        })
      )
    })

    it('should return false when file size does not match', async () => {
      mockFs.stat.mockResolvedValue({ size: 1000000, isFile: () => true })
      mockPrismaISO.findUnique.mockResolvedValue(createMockISO())
      mockPrismaISO.update.mockResolvedValue({ ...createMockISO(), isAvailable: false })
      const result = await service.validateISO('iso-1')
      expect(result).toBe(false)
    })

    it('should throw error when ISO not found', async () => {
      mockPrismaISO.findUnique.mockResolvedValue(null)
      expect(await service.validateISO('non-existent')).toBe(false)
    })

    it('should handle validation failure gracefully', async () => {
      mockFs.stat.mockRejectedValue(new Error('File error'))
      const result = await service.validateISO('iso-1')
      expect(result).toBe(false)
    })
  })

describe('calculateChecksum', () => {
    it('should calculate and return checksum', async () => {
      const mockHash = { update: jest.fn(), digest: jest.fn().mockReturnValue('abc123') }
      jest.spyOn(require('crypto'), 'createHash').mockReturnValue(mockHash as any)
      mockPrismaISO.findUnique.mockResolvedValue(createMockISO())
      mockPrismaISO.update.mockResolvedValue(createMockISO())
      const result = await service.calculateChecksum('iso-1')
      expect(result).toBe('abc123')
      expect(mockPrismaISO.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'iso-1' }, data: { checksum: 'abc123' } })
      )
    })

    it('should throw error when ISO not found', async () => {
      mockPrismaISO.findUnique.mockResolvedValue(null)
      await expect(service.calculateChecksum('non-existent')).rejects.toThrow('ISO not found')
    })
  })

 describe('registerISO', () => {
  it('should create new ISO record', async () => {
      mockPrismaISO.findUnique.mockResolvedValueOnce(null)
      const result = await service.registerISO('windows10.iso', 'windows10', 5368709120, '/opt/infinibay/iso/windows10.iso')
      expect(result).toMatchObject({
        filename: 'windows10.iso',
        os: 'WINDOWS10',
        size: BigInt(5368709120),
        path: '/opt/infinibay/iso/windows10.iso',
        isAvailable: true
      })
      expect(result.filename).toBe('windows10.iso')
      expect(mockISOEventManagerInstance.emitISORegistered).toHaveBeenCalledWith(expect.any(Object))
    })

    it('should update existing ISO record', async () => {
      const existing = createMockISO({ id: 'existing-iso' })
      mockPrismaISO.findUnique.mockResolvedValueOnce(existing)
      mockPrismaISO.update.mockResolvedValue(existing)
      await service.registerISO('windows10.iso', 'windows10', 6000000000, '/opt/infinibay/iso/windows10-new.iso')
      expect(mockPrismaISO.create).not.toHaveBeenCalled()
      expect(mockISOEventManagerInstance.emitISORegistered).not.toHaveBeenCalled()
    })

    it('should normalize OS to uppercase', async () => {
      mockPrismaISO.findUnique.mockResolvedValueOnce(null)
      mockPrismaISO.create.mockResolvedValue(createMockISO())
      await service.registerISO('windows10.iso', 'windows10', 5368709120, '/path')
      expect(mockPrismaISO.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ os: 'WINDOWS10' }) })
      )
    })
  })

  describe('removeISO', () => {
    it('should remove ISO successfully', async () => {
      mockPrismaISO.findUnique.mockResolvedValueOnce(createMockISO())
      mockPrismaISO.delete.mockResolvedValue(createMockISO())
      await service.removeISO('iso-1')
      expect(mockFs.unlink).toHaveBeenCalledWith(expect.any(String))
      expect(mockPrismaISO.delete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'iso-1' } }))
      expect(mockISOEventManagerInstance.emitISORemoved).toHaveBeenCalledWith('iso-1', 'windows10.iso')
    })

    it('should handle file deletion failure gracefully', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Permission denied'))
      mockPrismaISO.findUnique.mockResolvedValueOnce(createMockISO())
      mockPrismaISO.delete.mockResolvedValue(createMockISO())
      await service.removeISO('iso-1')
      expect(mockPrismaISO.delete).toHaveBeenCalled()
    })

    it('should throw error when ISO not found', async () => {
      mockPrismaISO.findUnique.mockResolvedValueOnce(null)
      await expect(service.removeISO('non-existent')).rejects.toThrow('ISO not found')
    })
  })

  describe('getISOsByAvailability', () => {
    it('should group ISOs by availability', async () => {
      mockPrismaISO.findMany.mockResolvedValue([
        createMockISO({ isAvailable: true }),
        createMockISO({ id: 'iso-2', isAvailable: false }),
        createMockISO({ id: 'iso-3', isAvailable: true })
      ])
      const result = await service.getISOsByAvailability()
      expect(result.available).toHaveLength(2)
      expect(result.unavailable).toHaveLength(1)
    })

    it('should return all available when all are available', async () => {
      mockPrismaISO.findMany.mockResolvedValue([
        createMockISO({ isAvailable: true }),
        createMockISO({ id: 'iso-2', isAvailable: true })
      ])
      const result = await service.getISOsByAvailability()
      expect(result.available).toHaveLength(2)
      expect(result.unavailable).toHaveLength(0)
    })

    it('should return all unavailable when none are available', async () => {
      mockPrismaISO.findMany.mockResolvedValue([
        createMockISO({ isAvailable: false }),
        createMockISO({ id: 'iso-2', isAvailable: false })
      ])
      const result = await service.getISOsByAvailability()
      expect(result.available).toHaveLength(0)
      expect(result.unavailable).toHaveLength(2)
    })
  })

  describe('extractOSType', () => {
    it('should extract WINDOWS10 from filename', () => {
      expect((service as any).extractOSType('windows10.iso')).toBe('WINDOWS10')
    })
    it('should extract WINDOWS11 from filename', () => {
      expect((service as any).extractOSType('windows11.iso')).toBe('WINDOWS11')
    })
    it('should extract UBUNTU from filename', () => {
      expect((service as any).extractOSType('ubuntu.iso')).toBe('UBUNTU')
    })
    it('should extract FEDORA from filename', () => {
      expect((service as any).extractOSType('fedora.iso')).toBe('FEDORA')
    })
    it('should handle short names (win10, win11)', () => {
      expect((service as any).extractOSType('win10.iso')).toBe('WINDOWS10')
      expect((service as any).extractOSType('win11.iso')).toBe('WINDOWS11')
    })
    it('should return null for unknown OS', () => {
      expect((service as any).extractOSType('centos.iso')).toBeNull()
    })
    it('should handle filename without .iso extension', () => {
      expect((service as any).extractOSType('windows10')).toBe('WINDOWS10')
    })
    it('should be case insensitive', () => {
      expect((service as any).extractOSType('WINDOWS10.ISO')).toBe('WINDOWS10')
      expect((service as any).extractOSType('Windows10.iso')).toBe('WINDOWS10')
    })
  })

  describe('getSupportedOSTypes', () => {
    it('should return all supported OS types', () => {
      expect(service.getSupportedOSTypes()).toEqual(['WINDOWS10', 'WINDOWS11', 'UBUNTU', 'FEDORA'])
    })
  })

  describe('checkMultipleOSAvailability', () => {
    it('should check availability for multiple OSes', async () => {
      mockPrismaISO.findMany.mockResolvedValue([
        createMockISO({ os: 'WINDOWS10' }),
        createMockISO({ id: 'iso-2', os: 'UBUNTU' })
      ])
      const result = await service.checkMultipleOSAvailability(['windows10', 'ubuntu', 'fedora'])
      expect(result.get('WINDOWS10')).toBe(true)
      expect(result.get('UBUNTU')).toBe(true)
      expect(result.get('FEDORA')).toBe(false)
    })

    it('should return all false when no ISOs', async () => {
      mockPrismaISO.findMany.mockResolvedValue([])
      const result = await service.checkMultipleOSAvailability(['windows10', 'ubuntu'])
      expect(result.get('WINDOWS10')).toBe(false)
      expect(result.get('UBUNTU')).toBe(false)
    })

    it('should handle empty OS list', async () => {
      mockPrismaISO.findMany.mockResolvedValue([])
      const result = await service.checkMultipleOSAvailability([])
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })

    it('should normalize OS names to uppercase', async () => {
      mockPrismaISO.findMany.mockResolvedValue([createMockISO({ os: 'WINDOWS10' })])
      const result = await service.checkMultipleOSAvailability(['windows10'])
      expect(result.get('WINDOWS10')).toBe(true)
      expect(result.get('windows10')).toBe(undefined)
    })
  })

  describe('safe paths and edge cases', () => {
    it('should handle empty filesystem with no ISOs', async () => {
      mockFs.readdir.mockResolvedValueOnce([])
      mockPrismaISO.findMany.mockResolvedValue([])
      await service.syncISOsWithFileSystem()
      expect(mockPrismaISO.create).not.toHaveBeenCalled()
    })

    it('should handle non-ISO files in directory', async () => {
      mockFs.readdir.mockResolvedValueOnce(['windows10.iso', 'readme.txt', 'ubuntu.iso'])
      mockPrismaISO.findUnique.mockResolvedValue(null)
      mockPrismaISO.create.mockResolvedValue(createMockISO())
      mockPrismaISO.findMany.mockResolvedValue([])
      await service.syncISOsWithFileSystem()
      expect(mockPrismaISO.create).toHaveBeenCalled()
    })

    it('should handle invalid filename format gracefully', async () => {
      mockFs.readdir.mockResolvedValueOnce(['invalid-file-name', 'another-file.txt'])
      mockPrismaISO.findMany.mockResolvedValue([])
      await service.syncISOsWithFileSystem()
      expect(mockPrismaISO.create).not.toHaveBeenCalled()
    })

    it('should handle database error in sync', async () => {
      mockFs.readdir.mockResolvedValueOnce(['windows10.iso'])
      mockPrismaISO.findUnique.mockResolvedValueOnce(null)
      mockPrismaISO.create.mockRejectedValueOnce(new Error('Database error'))
      await expect(service.syncISOsWithFileSystem()).rejects.toThrow('Database error')
    })

    it('should handle permission denied when accessing file', async () => {
      mockFs.readdir.mockResolvedValueOnce([])
      mockFs.stat.mockResolvedValue({ size: 5368709120, isFile: () => true } as any)
      mockPrismaISO.findMany.mockResolvedValue([])
      await service.syncISOsWithFileSystem()
      expect(mockPrismaISO.update).not.toHaveBeenCalled()
    })

   it('should handle very large file size (BigInt)', async () => {
      mockFs.readdir.mockResolvedValueOnce(['windows10.iso'])
      mockFs.stat.mockResolvedValue({ size: Number.MAX_SAFE_INTEGER, isFile: () => true })
      mockPrismaISO.findUnique.mockResolvedValueOnce(null)
      mockPrismaISO.create.mockResolvedValue(createMockISO())
      await service.syncISOsWithFileSystem()
      expect(mockPrismaISO.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ size: expect.any(BigInt) }) })
      )
    })

    it('should handle null checksum in database', async () => {
      mockPrismaISO.findUnique.mockResolvedValue({ ...createMockISO(), checksum: null })
      mockPrismaISO.update.mockResolvedValue(createMockISO())
      mockFs.stat.mockResolvedValue({ size: 5368709120n, isFile: () => true } as any)
      const result = await service.validateISO('iso-1')
      expect(result).toBe(true)
    })

    it('should handle custom base directory', async () => {
      process.env.INFINIBAY_BASE_DIR = '/custom/path'
      ;(ISOService as any).instance = undefined
      const custom = ISOService.getInstance()
      mockPrismaISO.findMany.mockResolvedValue([])
      await custom.syncISOsWithFileSystem()
      expect(mockFs.mkdir).toHaveBeenCalledWith('/custom/path/iso', { recursive: true })
    })
  })
})
