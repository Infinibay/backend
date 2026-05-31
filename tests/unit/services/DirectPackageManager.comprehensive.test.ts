import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { DirectPackageManager, PackageAction } from '../../../app/services/DirectPackageManager'
import { PrismaClient } from '@prisma/client'

// Mock dependencies
class MockVirtioSocketWatcherService {
  sendPackageCommand = jest.fn()
  isVmConnected = jest.fn().mockReturnValue(true)
}

// Mock PrismaClient
class MockPrismaClient {
  machine = {
    findUnique: jest.fn()
  }
}

// Mock the logger to prevent import issues
jest.mock('@main/logger', () => {
  const mockChild = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    log: jest.fn()
  }
  return {
    __esModule: true,
    default: {
      ...mockChild,
      child: jest.fn(() => mockChild)
    }
  }
})

describe('DirectPackageManager', () => {
  let service: DirectPackageManager
  let mockPrisma: MockPrismaClient
  let mockVirtioService: MockVirtioSocketWatcherService

  beforeEach(() => {
    jest.clearAllMocks()
    mockPrisma = new MockPrismaClient()
    mockVirtioService = new MockVirtioSocketWatcherService()

    service = new DirectPackageManager(mockPrisma as any, mockVirtioService as any)
  })

  const readyMachine = (overrides: Record<string, unknown> = {}) => ({
    id: 'vm-123',
    name: 'test-vm',
    os: 'WINDOWS10',
    status: 'running',
    configuration: { setupComplete: true },
    ...overrides
  })

  describe('listPackages', () => {
    it('should list all packages on a machine', async () => {
      const mockMachine = readyMachine()
      const mockPackages = [
        { name: 'Chrome', version: '100.0', installed: true },
        { name: 'Firefox', version: '99.0', installed: true }
      ]

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        data: { packages: mockPackages }
      })

      const result = await service.listPackages('vm-123')

      expect(mockPrisma.machine.findUnique).toHaveBeenCalledWith({
        where: { id: 'vm-123' },
        select: { id: true, name: true, os: true, status: true, configuration: { select: { setupComplete: true } } }
      })
      expect(result.length).toBe(2)
      expect(result[0].name).toBe('Chrome')
    })

    it('should throw error when machine not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(null)

      await expect(service.listPackages('non-existent')).rejects.toThrow(
        'not found'
      )
    })

    it('should throw error when command execution fails', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: false,
        error: 'Command failed'
      })

      await expect(service.listPackages('vm-123')).rejects.toThrow()
    })

    it('should return empty array when no packages installed', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        data: { packages: [] }
      })

      const result = await service.listPackages('vm-123')

      expect(result).toEqual([])
    })

    it('should throw error when machine is not running', async () => {
      const mockMachine = readyMachine({ status: 'stopped' })

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)

      await expect(service.listPackages('vm-123')).rejects.toThrow(
        'not ready'
      )
    })
  })

  describe('installPackage', () => {
    it('should install a package successfully', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        stdout: 'Package installed successfully',
        exit_code: 0
      })

      const result = await service.installPackage('vm-123', 'Chrome')

      expect(result.success).toBe(true)
      expect(result.message).toContain('successfully')
    })

    it('should return failure when installation fails', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: false,
        error: 'Package not found',
        exit_code: 1
      })

      const result = await service.installPackage('vm-123', 'nonexistent-package')

      expect(result.success).toBe(false)
      expect(result.message).toContain('Failed')
    })

    it('should return failure when machine not found', async () => {
      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(null)

      const result = await service.installPackage('non-existent', 'Chrome')

      expect(result.success).toBe(false)
      expect(result.error).toBe('Machine not found')
    })
  })

  describe('removePackage', () => {
    it('should remove a package successfully', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        stdout: 'Package removed successfully',
        exit_code: 0
      })

      const result = await service.removePackage('vm-123', 'Chrome')

      expect(result.success).toBe(true)
    })

    it('should return failure when removal fails', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: false,
        error: 'Package not found',
        exit_code: 1
      })

      const result = await service.removePackage('vm-123', 'nonexistent')

      expect(result.success).toBe(false)
      expect(result.message).toContain('Failed')
    })
  })

  describe('updatePackage', () => {
    it('should update a package successfully', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        stdout: 'Package updated successfully',
        exit_code: 0
      })

      const result = await service.updatePackage('vm-123', 'Chrome')

      expect(result.success).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should handle VirtioSocketWatcherService execution errors in installPackage', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockRejectedValue(
        new Error('Connection lost')
      )

      // installPackage catches errors and returns a failure result
      const result = await service.installPackage('vm-123', 'Chrome')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should handle database errors in listPackages', async () => {
      const dbError = new Error('Database connection failed')
      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockRejectedValue(dbError)

      await expect(service.listPackages('vm-123')).rejects.toThrow(
        'Database connection failed'
      )
    })
  })

  describe('package format handling', () => {
    it('should handle PascalCase response fields', async () => {
      const mockMachine = readyMachine()
      const mockPackage = {
        Name: 'Chrome',
        Version: '100.0',
        Installed: true,
        Publisher: 'Google'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        data: { packages: [mockPackage] }
      })

      const result = await service.listPackages('vm-123')

      expect(result).toEqual([
        expect.objectContaining({
          name: 'Chrome',
          version: '100.0',
          installed: true,
          publisher: 'Google'
        })
      ])
    })

    it('should handle lowercase response fields', async () => {
      const mockMachine = readyMachine()
      const mockPackage = {
        name: 'Firefox',
        version: '99.0',
        installed: true,
        publisher: 'Mozilla'
      }

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        data: { packages: [mockPackage] }
      })

      const result = await service.listPackages('vm-123')

      expect(result).toEqual([
        expect.objectContaining({
          name: 'Firefox',
          version: '99.0',
          installed: true,
          publisher: 'Mozilla'
        })
      ])
    })
  })

  describe('edge cases', () => {
    it('should handle empty package list', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        data: { packages: [] }
      })

      const result = await service.listPackages('vm-123')

      expect(result).toEqual([])
    })

    it('should handle packages without version', async () => {
      const mockMachine = readyMachine()
      const mockPackages = [
        { name: 'App1', installed: true },
        { name: 'App2', version: '1.0', installed: true }
      ]

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        data: { packages: mockPackages }
      })

      const result = await service.listPackages('vm-123')

      expect(result.length).toBe(2)
      expect(result[0].name).toBe('App1')
      expect(result[0].version).toBe('')
    })

    it('should handle packages with missing optional fields', async () => {
      const mockMachine = readyMachine()
      const mockPackages = [
        { name: 'App1', installed: true },
        { name: 'App2', version: '1.0', installed: true, description: 'Test app' }
      ]

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        data: { packages: mockPackages }
      })

      const result = await service.listPackages('vm-123')

      expect(result.length).toBe(2)
      expect(result[1].description).toBe('Test app')
    })
  })

  describe('managePackage', () => {
    it('should route to installPackage for INSTALL action', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        stdout: 'Installed'
      })

      const result = await service.managePackage('vm-123', 'Chrome', PackageAction.INSTALL)
      expect(result.success).toBe(true)
    })

    it('should route to removePackage for REMOVE action', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        stdout: 'Removed'
      })

      const result = await service.managePackage('vm-123', 'Chrome', PackageAction.REMOVE)
      expect(result.success).toBe(true)
    })

    it('should route to updatePackage for UPDATE action', async () => {
      const mockMachine = readyMachine()

      ;(mockPrisma.machine.findUnique as jest.Mock<any>).mockResolvedValue(mockMachine)
      ;(mockVirtioService.sendPackageCommand as jest.Mock<any>).mockResolvedValue({
        success: true,
        stdout: 'Updated'
      })

      const result = await service.managePackage('vm-123', 'Chrome', PackageAction.UPDATE)
      expect(result.success).toBe(true)
    })
  })
})
