import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { PrismaClient } from '@prisma/client'
import { mockPrisma } from '../../setup/jest.setup'
import { VMRecommendationService } from '../../../app/services/VMRecommendationService'
import { createMockMachine, createMockDepartment } from '../../setup/mock-factories'

// Mock PackageManager to prevent DB calls during constructor
import logger from '@main/logger'
jest.mock('../../../app/services/packages/PackageManager', () => ({
  getPackageManager: jest.fn().mockReturnValue({
    loadAll: jest.fn().mockResolvedValue(undefined as never),
    getPackageStatuses: jest.fn().mockReturnValue([]),
    runCheckers: jest.fn().mockResolvedValue([] as never)
  }),
  PackageManager: jest.fn()
}))

describe('VMRecommendationService Error Handling', () => {
  let service: VMRecommendationService

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers({ advanceTimers: false })
    service = new VMRecommendationService(mockPrisma as unknown as PrismaClient)
    jest.useRealTimers()

    // Default mocks for buildContext
    mockPrisma.portUsage.findMany.mockResolvedValue([])
    mockPrisma.processSnapshot.findMany.mockResolvedValue([])
    mockPrisma.machine.findUnique.mockResolvedValue(
      { ...createMockMachine({ id: 'default-machine' }), department: createMockDepartment() } as any
    )
    // Default transaction mock
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma))
    mockPrisma.vMHealthSnapshot.findUnique.mockResolvedValue({ customCheckResults: null } as any)
  })

  afterEach(() => {
    jest.clearAllMocks()
    if (service && typeof (service as any).dispose === 'function') {
      (service as any).dispose()
    }
  })

  describe('Error Handling with Generic Messages', () => {
    const machineId = 'test-machine-error'

    beforeEach(() => {
      // Mock machine exists
      mockPrisma.machine.findUnique.mockResolvedValue(
        createMockMachine({ id: machineId })
      )
      // Mock latest snapshot exists (needed by getRecommendations to reach findMany)
      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue({
        id: 'test-snapshot-1',
        machineId,
        snapshotDate: new Date(),
        overallStatus: 'OK'
      } as any)
    })

    it('should throw generic error message from generateRecommendations when database fails', async () => {
      // Simulate database error
      const dbError = new Error('ECONNREFUSED: Connection refused')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError)

      // Spy on logger.error to verify detailed logging
      const consoleSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

      await expect(service.generateRecommendations(machineId)).rejects.toThrow('VM recommendation service failed')

      // Verify that the detailed error is logged but not thrown
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VMRecommendationService error'),
        expect.objectContaining({
          originalError: 'ECONNREFUSED: Connection refused',
          errorName: 'Error',
          vmId: machineId
        })
      )

      consoleSpy.mockRestore()
    })

    it('should propagate error from getRecommendations when service fails', async () => {
      // Simulate service error
      const serviceError = new Error('Internal service failure')
      mockPrisma.vMRecommendation.findMany.mockRejectedValue(serviceError)

      // Spy on logger.error to verify detailed logging
      const consoleSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

      // getRecommendations wraps non-AppError errors via handleServiceError
      await expect(service.getRecommendations(machineId)).rejects.toThrow('VM recommendation service failed')

      consoleSpy.mockRestore()
    })

    it('should return generic error message from safe wrapper methods', async () => {
      // Simulate database error
      const dbError = new Error('Database connection timeout')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError)

      // Spy on logger.error to verify detailed logging
      const consoleSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(false)
      if (!result.success) {
        // The safe wrapper returns a generic error message
        expect(typeof result.error).toBe('string')
        expect(result.error.length).toBeGreaterThan(0)
      }

      // Verify that the detailed error is logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VM Recommendation Service Error'),
        expect.objectContaining({
          vmId: machineId
        })
      )

      consoleSpy.mockRestore()
    })

    it('should not leak sensitive database details via safe wrapper methods', async () => {
      // Simulate database constraint violation error with sensitive info
      const sensitiveError = new Error('duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(secret@example.com) already exists.')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(sensitiveError)

      // Use the safe wrapper which wraps errors with generic messages
      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(false)
      if (!result.success) {
        // The returned error message should be generic
        expect(result.error).not.toContain('duplicate key')
        expect(result.error).not.toContain('secret@example.com')
        expect(result.error).not.toContain('users_email_key')
      }
    })

    it('should log sensitive details for debugging while keeping thrown messages generic', async () => {
      // Simulate error with sensitive information
      const sensitiveError = new Error('PostgreSQL connection failed: password authentication failed for user "db_admin"')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(sensitiveError)

      // Spy on logger.error to verify detailed logging
      const consoleSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined as any)

      try {
        await service.generateRecommendations(machineId)
        fail('Expected error to be thrown')
      } catch (error: any) {
        // The thrown error message should be generic
        expect(error.message).toBe('VM recommendation service failed')
        expect(error.message).not.toContain('password authentication')
        expect(error.message).not.toContain('db_admin')
      }

      // Verify that the detailed error is logged for debugging
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VMRecommendationService error'),
        expect.objectContaining({
          originalError: 'PostgreSQL connection failed: password authentication failed for user "db_admin"',
          errorName: 'Error',
          vmId: machineId
        })
      )

      consoleSpy.mockRestore()
    })
  })
})
