import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { PrismaClient } from '@prisma/client'
import { mockPrisma } from '../../setup/jest.setup'
import { VMRecommendationService } from '../../../app/services/VMRecommendationService'
import { createMockMachine } from '../../setup/mock-factories'

describe('VMRecommendationService Error Handling', () => {
  let service: VMRecommendationService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new VMRecommendationService(mockPrisma as unknown as PrismaClient)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Error Handling with Generic Messages', () => {
    const machineId = 'test-machine-error'

    beforeEach(() => {
      // Mock machine exists
      mockPrisma.machine.findUnique.mockResolvedValue(
        createMockMachine({ id: machineId })
      )
    })

    it('should throw generic error message from generateRecommendations when database fails', async () => {
      // Simulate database error
      const dbError = new Error('ECONNREFUSED: Connection refused')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError)

      // Spy on console.error to verify detailed logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

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

    it('should throw generic error message from getRecommendations when service fails', async () => {
      // Simulate service error
      const serviceError = new Error('Internal service failure')
      mockPrisma.vMRecommendation.findMany.mockRejectedValue(serviceError)

      // Spy on console.error to verify detailed logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      await expect(service.getRecommendations(machineId)).rejects.toThrow('VM recommendation service failed')

      // Verify that the detailed error is logged but not thrown
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('VMRecommendationService error'),
        expect.objectContaining({
          originalError: 'Internal service failure',
          errorName: 'Error',
          vmId: machineId
        })
      )

      consoleSpy.mockRestore()
    })

    it('should return generic error message from safe wrapper methods', async () => {
      // Simulate database error
      const dbError = new Error('Database connection timeout')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(dbError)

      // Spy on console.error to verify detailed logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      const result = await service.generateRecommendationsSafe(machineId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('Failed to generate recommendations')
        expect('recommendations' in result).toBe(false)
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

    it('should not leak sensitive database details in thrown error messages', async () => {
      // Simulate database constraint violation error with sensitive info
      const sensitiveError = new Error('duplicate key value violates unique constraint "users_email_key" DETAIL: Key (email)=(secret@example.com) already exists.')
      mockPrisma.vMRecommendation.findMany.mockRejectedValue(sensitiveError)

      try {
        await service.getRecommendations(machineId)
        fail('Expected error to be thrown')
      } catch (error: any) {
        // The thrown error message should be generic
        expect(error.message).toBe('VM recommendation service failed')
        expect(error.message).not.toContain('duplicate key')
        expect(error.message).not.toContain('secret@example.com')
        expect(error.message).not.toContain('users_email_key')
      }
    })

    it('should log sensitive details for debugging while keeping thrown messages generic', async () => {
      // Simulate error with sensitive information
      const sensitiveError = new Error('PostgreSQL connection failed: password authentication failed for user "db_admin"')
      mockPrisma.vMHealthSnapshot.findFirst.mockRejectedValue(sensitiveError)

      // Spy on console.error to verify detailed logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

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
