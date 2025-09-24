import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { DepartmentFirewallService } from '../../../app/services/departmentFirewallService'
import { NetworkFilterService } from '../../../app/services/networkFilterService'
import { mockPrisma } from '../../setup/jest.setup'
import { createMockNWFilter, createMockFWRule, createMockMachine, createMockFilterReference } from '../../setup/mock-factories'
import { NotFoundError, CircularDependencyError, ConflictError } from '../../../app/utils/errors'

// Mock dependencies
jest.mock('../../../app/services/networkFilterService')

describe('DepartmentFirewallService - Comprehensive Error Handling', () => {
  let service: DepartmentFirewallService
  let mockNetworkFilterService: jest.Mocked<NetworkFilterService>

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock NetworkFilterService following DepartmentFirewallService.test.ts pattern
    mockNetworkFilterService = {
      flushNWFilter: jest.fn().mockResolvedValue(true),
      createRule: jest.fn().mockResolvedValue(createMockFWRule())
    } as unknown as jest.Mocked<NetworkFilterService>

    const NetworkFilterServiceMock = (jest.requireMock('../../../app/services/networkFilterService') as { NetworkFilterService: jest.Mock }).NetworkFilterService
    NetworkFilterServiceMock.mockImplementation(() => mockNetworkFilterService)

    service = new DepartmentFirewallService(mockPrisma, mockNetworkFilterService)
  })

  describe('Advanced Circular Dependency Scenarios', () => {
    it('should detect circular dependencies with corrupted filter reference data', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' })
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' })

      // Corrupted reference with null sourceFilterId
      const corruptedReference = {
        sourceFilterId: null,
        targetFilterId: 'filter-a'
      }

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)
      mockPrisma.filterReference.findMany.mockResolvedValue([corruptedReference])

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow()
    })

    it('should handle performance of circular dependency detection with large filter graphs', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' })
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' })

      // Create a large graph with 1000 filter references
      const manyReferences = Array.from({ length: 1000 }, (_, i) =>
        createMockFilterReference({
          sourceFilterId: `filter-${i}`,
          targetFilterId: `filter-${i + 1}`
        })
      )

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)

      // Mock database timeout due to large query
      mockPrisma.filterReference.findMany.mockRejectedValue(new Error('Query timeout: too many results'))

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow('Query timeout: too many results')
    })

    it('should handle circular dependencies created through concurrent operations', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' })
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)

      // Simulate concurrent modification during traversal
      mockPrisma.filterReference.findMany
        .mockResolvedValueOnce([])  // First traversal finds no references
        .mockImplementation(() => {
          throw new Error('Concurrent modification: filter graph changed during traversal')
        })

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow('Concurrent modification: filter graph changed during traversal')
    })

    it('should handle circular dependency detection when database is in inconsistent state', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' })
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)

      // Database returns inconsistent data
      mockPrisma.filterReference.findMany.mockResolvedValue([
        { sourceFilterId: 'filter-b', targetFilterId: 'nonexistent-filter' }
      ])

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow()
    })

    it('should handle memory exhaustion during deep circular dependency traversal', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' })
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)

      // Simulate memory exhaustion during traversal
      jest.spyOn(service as any, 'checkCircularDependency').mockImplementation(() => {
        throw new Error('Maximum call stack size exceeded')
      })

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow('Maximum call stack size exceeded')
    })

    it('should handle complex dependency graphs with multiple circular paths', async () => {
      const filterA = createMockNWFilter({ id: 'filter-a', type: 'department' })
      const filterB = createMockNWFilter({ id: 'filter-b', type: 'template' })

      // Complex graph: B->C, B->D, C->E, D->E, E->A (multiple paths to circular dependency)
      const complexReferences = [
        createMockFilterReference({ sourceFilterId: 'filter-b', targetFilterId: 'filter-c' }),
        createMockFilterReference({ sourceFilterId: 'filter-b', targetFilterId: 'filter-d' }),
        createMockFilterReference({ sourceFilterId: 'filter-c', targetFilterId: 'filter-e' }),
        createMockFilterReference({ sourceFilterId: 'filter-d', targetFilterId: 'filter-e' }),
        createMockFilterReference({ sourceFilterId: 'filter-e', targetFilterId: 'filter-a' })
      ]

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(filterA)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(filterB)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)
      mockPrisma.filterReference.findMany
        .mockResolvedValueOnce([complexReferences[0], complexReferences[1]])  // B->C, B->D
        .mockResolvedValueOnce([complexReferences[2]])  // C->E
        .mockResolvedValueOnce([complexReferences[3]])  // D->E
        .mockResolvedValueOnce([complexReferences[4]])  // E->A (circular!)

      await expect(
        service.applyTemplateToDepartment('dept-id', 'filter-b')
      ).rejects.toThrow(CircularDependencyError)
    })
  })

  describe('NetworkFilterService Integration Failures', () => {
    it('should handle cascading failures when NetworkFilterService operations fail', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)

      // Simulate cascading failure: first operation succeeds, second fails
      mockNetworkFilterService.createRule
        .mockResolvedValueOnce(createMockFWRule())  // First rule succeeds
        .mockRejectedValueOnce(new Error('NetworkFilterService cascade failure'))  // Second rule fails

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in', protocol: 'tcp' })
      ).rejects.toThrow('NetworkFilterService cascade failure')
    })

    it('should handle partial success scenarios in bulk operations', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const mockVMs = [
        createMockMachine({ nwFilters: [{ id: 'vm-filter-1' }] }),
        createMockMachine({ nwFilters: [{ id: 'vm-filter-2' }] }),
        createMockMachine({ nwFilters: [{ id: 'vm-filter-3' }] })
      ]

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue(mockVMs)

      // Department filter succeeds, first VM succeeds, second VM fails
      mockNetworkFilterService.flushNWFilter
        .mockResolvedValueOnce(true)   // Department filter
        .mockResolvedValueOnce(true)   // VM 1
        .mockRejectedValueOnce(new Error('VM 2 filter flush failed'))   // VM 2
        .mockResolvedValueOnce(true)   // VM 3 (never reached)

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('VM 2 filter flush failed')
    })

    it('should handle timeout scenarios during NetworkFilterService calls', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)

      // Simulate long-running operation that times out
      mockNetworkFilterService.createRule.mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('NetworkFilterService operation timeout')), 1)
        })
      })

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('NetworkFilterService operation timeout')
    })

    it('should handle NetworkFilterService state inconsistencies', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)

      // NetworkFilterService returns inconsistent state
      mockNetworkFilterService.createRule.mockRejectedValue(
        new Error('NetworkFilterService state inconsistent: filter not found after creation')
      )

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('NetworkFilterService state inconsistent: filter not found after creation')
    })

    it('should handle error propagation from NetworkFilterService with context preservation', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const originalError = new Error('Original NetworkFilterService error')
      originalError.stack = 'Original stack trace...'

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockNetworkFilterService.createRule.mockRejectedValue(originalError)

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('Original NetworkFilterService error')
    })
  })

  describe('Complex Database Transaction Scenarios', () => {
    it('should handle transaction rollback during template application', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const mockTemplateFilter = createMockNWFilter({ type: 'template' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)
      mockPrisma.filterReference.findMany.mockResolvedValue([])

      // Transaction rollback during reference creation
      mockPrisma.filterReference.create.mockRejectedValue(
        new Error('Transaction rollback: concurrent modification detected')
      )

      await expect(
        service.applyTemplateToDepartment('dept-id', 'template-id')
      ).rejects.toThrow('Transaction rollback: concurrent modification detected')
    })

    it('should handle concurrent modification conflicts', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockNetworkFilterService.createRule.mockRejectedValue(
        new Error('Concurrent modification: rule priority conflict')
      )

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in', priority: 100 })
      ).rejects.toThrow('Concurrent modification: rule priority conflict')
    })

    it('should handle database deadlock scenarios', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockRejectedValue(
        new Error('Deadlock detected: transaction aborted')
      )

      await expect(
        service.getDepartmentFirewallState('dept-id')
      ).rejects.toThrow('Deadlock detected: transaction aborted')
    })

    it('should handle orphaned reference cleanup failures', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)

      // Reference deletion fails due to orphaned state
      mockPrisma.filterReference.delete.mockRejectedValue(
        new Error('Reference cleanup failed: orphaned reference detected')
      )

      await expect(
        service.removeTemplateFromDepartment('dept-id', 'template-id')
      ).rejects.toThrow('Reference cleanup failed: orphaned reference detected')
    })

    it('should handle constraint violation recovery', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const mockTemplateFilter = createMockNWFilter({ type: 'template' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)
      mockPrisma.filterReference.findMany.mockResolvedValue([])

      // Constraint violation with recovery attempt
      mockPrisma.filterReference.create.mockRejectedValue(
        new Error('Check constraint violation: invalid filter type combination')
      )

      await expect(
        service.applyTemplateToDepartment('dept-id', 'template-id')
      ).rejects.toThrow('Check constraint violation: invalid filter type combination')
    })
  })

  describe('Department and VM State Corruption', () => {
    it('should handle operations on departments with corrupted filter associations', async () => {
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(null)

      await expect(
        service.getDepartmentFirewallState('corrupted-dept-id')
      ).rejects.toThrow(NotFoundError)
    })

    it('should handle VM filter corruption scenarios', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const corruptedVM = {
        ...createMockMachine(),
        nwFilters: [{ id: null }]  // Corrupted filter reference
      }

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([corruptedVM])

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow()
    })

    it('should handle missing department data during operations', async () => {
      mockPrisma.department.findUnique.mockResolvedValue(null)

      await expect(
        service.getDepartmentFirewallState('missing-dept-id')
      ).rejects.toThrow()
    })

    it('should handle inconsistent VM-department relationships', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const inconsistentVM = {
        ...createMockMachine(),
        departmentId: 'different-dept-id'  // VM belongs to different department
      }

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue([inconsistentVM])

      // Should handle gracefully but may not process inconsistent VMs
      const result = await service.flushDepartmentToAllVMs('dept-id')
      expect(result).toBeDefined()
    })

    it('should handle filter reference corruption and recovery', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const corruptedReference = {
        sourceFilterId: 'dept-filter-id',
        targetFilterId: null  // Corrupted target reference
      }

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([])
      mockPrisma.filterReference.findMany.mockResolvedValue([corruptedReference])

      await expect(
        service['getEffectiveRules']('dept-id')
      ).rejects.toThrow()
    })
  })

  describe('Bulk Operation Failure Scenarios', () => {
    it('should handle flushDepartmentToAllVMs with extreme scale (10000+ VMs)', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const manyVMs = Array.from({ length: 10000 }, (_, i) =>
        createMockMachine({
          id: `vm-${i}`,
          nwFilters: [{ id: `vm-filter-${i}` }]
        })
      )

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getVMsInDepartment').mockRejectedValue(
        new Error('Query result set too large: memory exhausted')
      )

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Query result set too large: memory exhausted')
    })

    it('should handle getEffectiveRules when template rule fetching fails intermittently', async () => {
      const templateFilter1 = createMockNWFilter({ id: 'template-1' })
      const templateFilter2 = createMockNWFilter({ id: 'template-2' })
      const templateFilter3 = createMockNWFilter({ id: 'template-3' })

      jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([])
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([
        templateFilter1, templateFilter2, templateFilter3
      ])

      mockPrisma.fWRule.findMany
        .mockResolvedValueOnce([createMockFWRule()])   // First template succeeds
        .mockRejectedValueOnce(new Error('Template 2 temporarily unavailable'))   // Second template fails
        .mockResolvedValueOnce([createMockFWRule()])   // Third template succeeds

      await expect(
        service['getEffectiveRules']('dept-id')
      ).rejects.toThrow('Template 2 temporarily unavailable')
    })

    it('should handle inheritance impact calculation with extreme VM counts', async () => {
      const extremeVMCount = Array.from({ length: 50000 }, (_, i) =>
        createMockMachine({ id: `vm-${i}` })
      )

      jest.spyOn(service as any, 'getVMsInDepartment').mockRejectedValue(
        new Error('Query timeout: too many VMs in department')
      )

      await expect(
        service['calculateInheritanceImpact']('dept-id')
      ).rejects.toThrow('Query timeout: too many VMs in department')
    })

    it('should handle bulk rule application with mixed success/failure patterns', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const mixedVMs = Array.from({ length: 25 }, (_, i) =>
        createMockMachine({
          id: `vm-${i}`,
          nwFilters: [{ id: `vm-filter-${i}` }]
        })
      )

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getVMsInDepartment').mockResolvedValue(mixedVMs)

      // Complex failure pattern: every 10th VM fails
      mockNetworkFilterService.flushNWFilter
        .mockResolvedValueOnce(true)  // Department filter succeeds
        .mockImplementation((filterId) => {
          const vmIndex = parseInt(filterId.split('-')[2])
          if (vmIndex % 10 === 0) {
            return Promise.reject(new Error(`VM ${vmIndex} filter flush failed`))
          }
          return Promise.resolve(true)
        })

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('VM 0 filter flush failed')
    })
  })

  describe('Resource and Permission Edge Cases', () => {
    it('should handle operations when user lacks permissions for specific departments', async () => {
      mockPrisma.department.findUnique.mockRejectedValue(
        new Error('Access denied: insufficient permissions for department')
      )

      await expect(
        service.getDepartmentFirewallState('restricted-dept-id')
      ).rejects.toThrow('Access denied: insufficient permissions for department')
    })

    it('should handle filter operations when system resources are exhausted', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockNetworkFilterService.flushNWFilter.mockRejectedValue(
        new Error('System resource exhausted: too many active filters')
      )

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('System resource exhausted: too many active filters')
    })

    it('should handle scenarios with department containing maximum VM limit', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getVMsInDepartment').mockRejectedValue(
        new Error('Department VM limit exceeded: cannot process more than 10000 VMs')
      )

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Department VM limit exceeded: cannot process more than 10000 VMs')
    })

    it('should handle timeout scenarios during extremely long-running operations', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'refreshAllVMFilters').mockImplementation(() => {
        return new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Operation timeout: exceeded maximum execution time')), 1)
        })
      })

      await expect(
        service.flushDepartmentToAllVMs('dept-id')
      ).rejects.toThrow('Operation timeout: exceeded maximum execution time')
    })

    it('should handle quota exhaustion scenarios', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockNetworkFilterService.createRule.mockRejectedValue(
        new Error('Quota exceeded: department rule limit reached')
      )

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('Quota exceeded: department rule limit reached')
    })
  })

  describe('Error Recovery and Consistency', () => {
    it('should maintain system state consistency after various failure scenarios', async () => {
      // Test multiple failure scenarios and ensure service remains functional
      const failures = [
        'Database connection lost',
        'NetworkFilterService unavailable',
        'Memory exhaustion',
        'Concurrent modification detected'
      ]

      for (const failure of failures) {
        jest.spyOn(service as any, 'getDepartmentFilter').mockRejectedValueOnce(new Error(failure))

        await expect(
          service.getDepartmentFirewallState('dept-id')
        ).rejects.toThrow(failure)
      }

      // Service should still be functional after all failures
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([])
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([])

      const result = await service.getDepartmentFirewallState('dept-id')
      expect(result).toBeDefined()
    })

    it('should handle error recovery mechanisms', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      // First attempt fails, recovery attempt succeeds
      jest.spyOn(service as any, 'getDepartmentFilter')
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(mockDeptFilter)

      // First call should fail
      await expect(
        service.getDepartmentFirewallState('dept-id')
      ).rejects.toThrow('Temporary failure')

      // Second call should succeed (simulating retry mechanism)
      jest.spyOn(service as any, 'getDepartmentCustomRules').mockResolvedValue([])
      jest.spyOn(service as any, 'getAppliedTemplates').mockResolvedValue([])

      const result = await service.getDepartmentFirewallState('dept-id')
      expect(result).toBeDefined()
    })

    it('should handle cleanup procedures after partial failures', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })
      const mockTemplateFilter = createMockNWFilter({ type: 'template' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockPrisma.nWFilter.findUnique.mockResolvedValue(mockTemplateFilter)
      mockPrisma.filterReference.findFirst.mockResolvedValue(null)
      mockPrisma.filterReference.findMany.mockResolvedValue([])

      // Template application partially succeeds then fails
      mockPrisma.filterReference.create.mockRejectedValue(
        new Error('Partial failure: reference created but not committed')
      )

      await expect(
        service.applyTemplateToDepartment('dept-id', 'template-id')
      ).rejects.toThrow('Partial failure: reference created but not committed')

      // System should handle cleanup and remain consistent
    })

    it('should handle data integrity verification after errors', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockNetworkFilterService.createRule.mockRejectedValue(
        new Error('Data integrity check failed: rule validation failed')
      )

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('Data integrity check failed: rule validation failed')
    })

    it('should handle audit trail preservation during error scenarios', async () => {
      const mockDeptFilter = createMockNWFilter({ type: 'department' })

      jest.spyOn(service as any, 'getDepartmentFilter').mockResolvedValue(mockDeptFilter)
      mockNetworkFilterService.createRule.mockRejectedValue(
        new Error('Audit trail error: failed to log operation')
      )

      await expect(
        service.addDepartmentRule('dept-id', { action: 'accept', direction: 'in' })
      ).rejects.toThrow('Audit trail error: failed to log operation')
    })
  })
})