import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-core'
import Debug from 'debug'
import { InfinibayContext } from '@utils/context'
import { validateDepartmentAccess, validateResourceDepartmentAccess } from '@utils/authChecker'
import { GenericFilter, FilterType } from './firewall/types'
import { AssignedGenericFilter } from '../types/GenericFilterTypes'
import { isDomainError } from '@utils/errors'
import { getSocketService } from '@services/SocketService'

const debug = Debug('infinibay:generic-filter-resolver')

const CRITICAL_FILTERS = ['Basic Security', 'DHCP']

function isCriticalFilter(filterName: string): boolean {
  return CRITICAL_FILTERS.includes(filterName)
}

@Resolver()
export class GenericFilterResolver {
  @Authorized('USER')
  @Query(() => [GenericFilter])
  async getGenericFilters(@Ctx() ctx: InfinibayContext): Promise<GenericFilter[]> {
    const { prisma } = ctx
    debug('getGenericFilters: Fetching all generic filters')

    try {
      const filters = await prisma.nWFilter.findMany({
        where: {
          type: 'generic'
        },
        include: {
          rules: true,
          references: true
        }
      })

      debug(`getGenericFilters: Found ${filters.length} generic filters`)

      return filters.map(filter => ({
        id: filter.id,
        name: filter.name,
        description: filter.description || '',
        type: filter.type as FilterType,
        rules: filter.rules.map(rule => ({
          id: rule.id,
          protocol: rule.protocol,
          direction: rule.direction,
          action: rule.action,
          priority: rule.priority,
          ipVersion: rule.ipVersion,
          srcMacAddr: rule.srcMacAddr,
          srcIpAddr: rule.srcIpAddr,
          srcIpMask: rule.srcIpMask,
          dstIpAddr: rule.dstIpAddr,
          dstIpMask: rule.dstIpMask,
          srcPortStart: rule.srcPortStart,
          srcPortEnd: rule.srcPortEnd,
          dstPortStart: rule.dstPortStart,
          dstPortEnd: rule.dstPortEnd,
          state: rule.state,
          comment: rule.comment,
          createdAt: rule.createdAt,
          updatedAt: rule.updatedAt
        })),
        references: filter.references.map(ref => ref.targetFilterId),
        createdAt: filter.createdAt,
        updatedAt: filter.updatedAt
      }))
    } catch (error) {
      debug('getGenericFilters: Error fetching filters', error)
      throw error
    }
  }

  @Authorized('USER')
  @Query(() => [AssignedGenericFilter])
  async getVMAssignedGenericFilters(
    @Arg('vmId', () => ID) vmId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<AssignedGenericFilter[]> {
    const { prisma, user } = ctx
    debug(`getVMAssignedGenericFilters: Fetching assigned filters for VM ${vmId}`)

    try {
      // Validate VM access
      const hasAccess = await validateResourceDepartmentAccess(prisma, user, vmId, 'vm')
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this VM')
      }

      // Get VM's filter and department
      const vmFilterRelation = await prisma.vMNWFilter.findFirst({
        where: { vmId },
        include: {
          nwFilter: {
            include: {
              references: {
                include: {
                  targetFilter: {
                    include: {
                      rules: true,
                      references: true
                    }
                  }
                }
              }
            }
          }
        }
      })

      if (!vmFilterRelation) {
        debug(`getVMAssignedGenericFilters: No filter found for VM ${vmId}`)
        return []
      }

      const vm = await prisma.machine.findUnique({
        where: { id: vmId },
        include: {
          department: {
            include: {
              nwFilters: {
                include: {
                  nwFilter: {
                    include: {
                      references: {
                        include: {
                          targetFilter: {
                            include: {
                              rules: true,
                              references: true
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      })

      // Map direct assignments
      const directAssignments: AssignedGenericFilter[] = vmFilterRelation.nwFilter.references
        .filter(ref => ref.targetFilter.type === 'generic')
        .map(ref => ({
          filter: {
            id: ref.targetFilter.id,
            name: ref.targetFilter.name,
            description: ref.targetFilter.description || '',
            type: ref.targetFilter.type as FilterType,
            rules: ref.targetFilter.rules.map(rule => ({
              id: rule.id,
              protocol: rule.protocol,
              direction: rule.direction,
              action: rule.action,
              priority: rule.priority,
              ipVersion: rule.ipVersion,
              srcMacAddr: rule.srcMacAddr,
              srcIpAddr: rule.srcIpAddr,
              srcIpMask: rule.srcIpMask,
              dstIpAddr: rule.dstIpAddr,
              dstIpMask: rule.dstIpMask,
              srcPortStart: rule.srcPortStart,
              srcPortEnd: rule.srcPortEnd,
              dstPortStart: rule.dstPortStart,
              dstPortEnd: rule.dstPortEnd,
              state: rule.state,
              comment: rule.comment,
              createdAt: rule.createdAt,
              updatedAt: rule.updatedAt
            })),
            references: ref.targetFilter.references.map(r => r.targetFilterId),
            createdAt: ref.targetFilter.createdAt,
            updatedAt: ref.targetFilter.updatedAt
          },
          isInherited: false,
          inheritedFrom: null,
          inheritedFromId: null
        }))

      // Map inherited assignments from department filters
      const inheritedAssignments: AssignedGenericFilter[] = vm?.department?.nwFilters
        ? vm.department.nwFilters.flatMap(deptFilterRel =>
            deptFilterRel.nwFilter.references
              .filter(ref => ref.targetFilter.type === 'generic')
              .map(ref => ({
                filter: {
                  id: ref.targetFilter.id,
                  name: ref.targetFilter.name,
                  description: ref.targetFilter.description || '',
                  type: ref.targetFilter.type as FilterType,
                  rules: ref.targetFilter.rules.map(rule => ({
                    id: rule.id,
                    protocol: rule.protocol,
                    direction: rule.direction,
                    action: rule.action,
                    priority: rule.priority,
                    ipVersion: rule.ipVersion,
                    srcMacAddr: rule.srcMacAddr,
                    srcIpAddr: rule.srcIpAddr,
                    srcIpMask: rule.srcIpMask,
                    dstIpAddr: rule.dstIpAddr,
                    dstIpMask: rule.dstIpMask,
                    srcPortStart: rule.srcPortStart,
                    srcPortEnd: rule.srcPortEnd,
                    dstPortStart: rule.dstPortStart,
                    dstPortEnd: rule.dstPortEnd,
                    state: rule.state,
                    comment: rule.comment,
                    createdAt: rule.createdAt,
                    updatedAt: rule.updatedAt
                  })),
                  references: ref.targetFilter.references.map(r => r.targetFilterId),
                  createdAt: ref.targetFilter.createdAt,
                  updatedAt: ref.targetFilter.updatedAt
                },
                isInherited: true,
                inheritedFrom: vm.department!.name,
                inheritedFromId: vm.department!.id
              }))
          )
        : []

      const allAssignments = [...directAssignments, ...inheritedAssignments]
      debug(`getVMAssignedGenericFilters: Found ${allAssignments.length} assigned filters (${directAssignments.length} direct, ${inheritedAssignments.length} inherited)`)

      return allAssignments
    } catch (error) {
      debug('getVMAssignedGenericFilters: Error fetching assigned filters', error)
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw error
    }
  }

  @Authorized('USER')
  @Query(() => [GenericFilter])
  async getDepartmentAssignedGenericFilters(
    @Arg('departmentId', () => ID) departmentId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<GenericFilter[]> {
    const { prisma, user } = ctx
    debug(`getDepartmentAssignedGenericFilters: Fetching assigned filters for department ${departmentId}`)

    try {
      // Validate department access
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }

      // Get department's filters
      const departmentFilterRelations = await prisma.departmentNWFilter.findMany({
        where: { departmentId },
        include: {
          nwFilter: {
            include: {
              references: {
                include: {
                  targetFilter: {
                    include: {
                      rules: true,
                      references: true
                    }
                  }
                }
              }
            }
          }
        }
      })

      if (!departmentFilterRelations || departmentFilterRelations.length === 0) {
        debug(`getDepartmentAssignedGenericFilters: No filters found for department ${departmentId}`)
        return []
      }

      const genericFilters = departmentFilterRelations.flatMap(deptFilterRel =>
        deptFilterRel.nwFilter.references
          .filter(ref => ref.targetFilter.type === 'generic')
          .map(ref => ({
            id: ref.targetFilter.id,
            name: ref.targetFilter.name,
            description: ref.targetFilter.description || '',
            type: ref.targetFilter.type as FilterType,
            rules: ref.targetFilter.rules.map(rule => ({
              id: rule.id,
              protocol: rule.protocol,
              direction: rule.direction,
              action: rule.action,
              priority: rule.priority,
              ipVersion: rule.ipVersion,
              srcMacAddr: rule.srcMacAddr,
              srcIpAddr: rule.srcIpAddr,
              srcIpMask: rule.srcIpMask,
              dstIpAddr: rule.dstIpAddr,
              dstIpMask: rule.dstIpMask,
              srcPortStart: rule.srcPortStart,
              srcPortEnd: rule.srcPortEnd,
              dstPortStart: rule.dstPortStart,
              dstPortEnd: rule.dstPortEnd,
              state: rule.state,
              comment: rule.comment,
              createdAt: rule.createdAt,
              updatedAt: rule.updatedAt
            })),
            references: ref.targetFilter.references.map(r => r.targetFilterId),
            createdAt: ref.targetFilter.createdAt,
            updatedAt: ref.targetFilter.updatedAt
          }))
      )

      debug(`getDepartmentAssignedGenericFilters: Found ${genericFilters.length} assigned filters`)
      return genericFilters
    } catch (error) {
      debug('getDepartmentAssignedGenericFilters: Error fetching assigned filters', error)
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw error
    }
  }

  @Authorized('USER')
  @Mutation(() => Boolean)
  async assignGenericFilterToVM(
    @Arg('vmId', () => ID) vmId: string,
    @Arg('genericFilterId', () => ID) genericFilterId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const { prisma, user } = ctx
    debug(`assignGenericFilterToVM: Assigning filter ${genericFilterId} to VM ${vmId}`)

    try {
      // Validate VM access
      const hasAccess = await validateResourceDepartmentAccess(prisma, user, vmId, 'vm')
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this VM')
      }

      // Validate that the filter is actually a generic filter
      const genericFilter = await prisma.nWFilter.findUnique({
        where: { id: genericFilterId }
      })

      if (!genericFilter || genericFilter.type !== 'generic') {
        throw new UserInputError('Invalid generic filter ID')
      }

      // Get VM's filter
      const vmFilterRelation = await prisma.vMNWFilter.findFirst({
        where: { vmId }
      })

      if (!vmFilterRelation) {
        throw new UserInputError('VM does not have an associated filter')
      }

      // Check for existing FilterReference
      const existingRef = await prisma.filterReference.findFirst({
        where: {
          sourceFilterId: vmFilterRelation.nwFilterId,
          targetFilterId: genericFilterId
        }
      })

      if (existingRef) {
        debug('assignGenericFilterToVM: Filter already assigned')
        return true
      }

      // Create FilterReference
      await prisma.filterReference.create({
        data: {
          sourceFilterId: vmFilterRelation.nwFilterId,
          targetFilterId: genericFilterId
        }
      })

      // Update VM filter to trigger flush
      await prisma.nWFilter.update({
        where: { id: vmFilterRelation.nwFilterId },
        data: { needsFlush: true }
      })

      debug('assignGenericFilterToVM: Successfully assigned filter')

      // Emit WebSocket event to VM owner
      try {
        const socketService = getSocketService()
        const vm = await prisma.machine.findUnique({
          where: { id: vmId },
          select: { userId: true }
        })

        if (vm?.userId) {
          socketService.sendToUser(vm.userId, 'firewall', 'generic:assigned', {
            data: {
              vmId,
              filterId: genericFilterId,
              filterName: genericFilter.name
            }
          })
          debug(`📡 Emitted firewall:generic:assigned event for VM ${vmId}`)
        }
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }

      return true
    } catch (error) {
      debug('assignGenericFilterToVM: Error assigning filter', error)
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw error
    }
  }

  @Authorized('USER')
  @Mutation(() => Boolean)
  async unassignGenericFilterFromVM(
    @Arg('vmId', () => ID) vmId: string,
    @Arg('genericFilterId', () => ID) genericFilterId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const { prisma, user } = ctx
    debug(`unassignGenericFilterFromVM: Unassigning filter ${genericFilterId} from VM ${vmId}`)

    try {
      // Validate VM access
      const hasAccess = await validateResourceDepartmentAccess(prisma, user, vmId, 'vm')
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this VM')
      }

      // Get the generic filter to check its name
      const genericFilter = await prisma.nWFilter.findUnique({
        where: { id: genericFilterId }
      })

      if (!genericFilter) {
        throw new UserInputError('Filter not found')
      }

      // Critical filter check
      if (isCriticalFilter(genericFilter.name) && user?.role !== 'ADMIN') {
        throw new UserInputError('Only administrators can unassign critical security filters')
      }

      // Get VM's filter
      const vmFilterRelation = await prisma.vMNWFilter.findFirst({
        where: { vmId }
      })

      if (!vmFilterRelation) {
        throw new UserInputError('VM does not have an associated filter')
      }

      // Find FilterReference
      const filterRef = await prisma.filterReference.findFirst({
        where: {
          sourceFilterId: vmFilterRelation.nwFilterId,
          targetFilterId: genericFilterId
        }
      })

      if (!filterRef) {
        debug('unassignGenericFilterFromVM: Filter reference not found')
        return false
      }

      // Delete FilterReference
      await prisma.filterReference.delete({
        where: { id: filterRef.id }
      })

      // Update VM filter to trigger flush
      await prisma.nWFilter.update({
        where: { id: vmFilterRelation.nwFilterId },
        data: { needsFlush: true }
      })

      debug('unassignGenericFilterFromVM: Successfully unassigned filter')

      // Emit WebSocket event to VM owner
      try {
        const socketService = getSocketService()
        const vm = await prisma.machine.findUnique({
          where: { id: vmId },
          select: { userId: true }
        })

        if (vm?.userId) {
          socketService.sendToUser(vm.userId, 'firewall', 'generic:unassigned', {
            data: {
              vmId,
              filterId: genericFilterId,
              filterName: genericFilter.name
            }
          })
          debug(`📡 Emitted firewall:generic:unassigned event for VM ${vmId}`)
        }
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }

      return true
    } catch (error) {
      debug('unassignGenericFilterFromVM: Error unassigning filter', error)
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw error
    }
  }

  @Authorized('USER')
  @Mutation(() => Boolean)
  async assignGenericFilterToDepartment(
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('genericFilterId', () => ID) genericFilterId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const { prisma, user } = ctx
    debug(`assignGenericFilterToDepartment: Assigning filter ${genericFilterId} to department ${departmentId}`)

    try {
      // Validate department access
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }

      // Validate that the filter is actually a generic filter
      const genericFilter = await prisma.nWFilter.findUnique({
        where: { id: genericFilterId }
      })

      if (!genericFilter || genericFilter.type !== 'generic') {
        throw new UserInputError('Invalid generic filter ID')
      }

      // Get or create department's filter
      const departmentFilterRelation = await prisma.departmentNWFilter.findFirst({
        where: { departmentId }
      })

      if (!departmentFilterRelation) {
        throw new UserInputError('Department does not have an associated filter')
      }

      // Check for existing FilterReference
      const existingRef = await prisma.filterReference.findFirst({
        where: {
          sourceFilterId: departmentFilterRelation.nwFilterId,
          targetFilterId: genericFilterId
        }
      })

      if (existingRef) {
        debug('assignGenericFilterToDepartment: Filter already assigned')
        return true
      }

      // Create FilterReference
      await prisma.filterReference.create({
        data: {
          sourceFilterId: departmentFilterRelation.nwFilterId,
          targetFilterId: genericFilterId
        }
      })

      // Update department filter to trigger flush
      await prisma.nWFilter.update({
        where: { id: departmentFilterRelation.nwFilterId },
        data: { needsFlush: true }
      })

      debug('assignGenericFilterToDepartment: Successfully assigned filter')

      // Emit WebSocket event to admins
      try {
        const socketService = getSocketService()
        socketService.sendToAdmins('firewall', 'generic:assigned:department', {
          data: {
            departmentId,
            filterId: genericFilterId,
            filterName: genericFilter.name
          }
        })
        debug(`📡 Emitted firewall:generic:assigned:department event for department ${departmentId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }

      return true
    } catch (error) {
      debug('assignGenericFilterToDepartment: Error assigning filter', error)
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw error
    }
  }

  @Authorized('USER')
  @Mutation(() => Boolean)
  async unassignGenericFilterFromDepartment(
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('genericFilterId', () => ID) genericFilterId: string,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    const { prisma, user } = ctx
    debug(`unassignGenericFilterFromDepartment: Unassigning filter ${genericFilterId} from department ${departmentId}`)

    try {
      // Validate department access
      const hasAccess = await validateDepartmentAccess(prisma, user, departmentId)
      if (!hasAccess) {
        throw new UserInputError('Unauthorized: You do not have access to this department')
      }

      // Get the generic filter to check its name
      const genericFilter = await prisma.nWFilter.findUnique({
        where: { id: genericFilterId }
      })

      if (!genericFilter) {
        throw new UserInputError('Filter not found')
      }

      // Critical filter check
      if (isCriticalFilter(genericFilter.name) && user?.role !== 'ADMIN') {
        throw new UserInputError('Only administrators can unassign critical security filters')
      }

      // Get department's filter
      const departmentFilterRelation = await prisma.departmentNWFilter.findFirst({
        where: { departmentId }
      })

      if (!departmentFilterRelation) {
        throw new UserInputError('Department does not have an associated filter')
      }

      // Find FilterReference
      const filterRef = await prisma.filterReference.findFirst({
        where: {
          sourceFilterId: departmentFilterRelation.nwFilterId,
          targetFilterId: genericFilterId
        }
      })

      if (!filterRef) {
        debug('unassignGenericFilterFromDepartment: Filter reference not found')
        return false
      }

      // Delete FilterReference
      await prisma.filterReference.delete({
        where: { id: filterRef.id }
      })

      // Update department filter to trigger flush
      await prisma.nWFilter.update({
        where: { id: departmentFilterRelation.nwFilterId },
        data: { needsFlush: true }
      })

      debug('unassignGenericFilterFromDepartment: Successfully unassigned filter')

      // Emit WebSocket event to admins
      try {
        const socketService = getSocketService()
        socketService.sendToAdmins('firewall', 'generic:unassigned:department', {
          data: {
            departmentId,
            filterId: genericFilterId,
            filterName: genericFilter.name
          }
        })
        debug(`📡 Emitted firewall:generic:unassigned:department event for department ${departmentId}`)
      } catch (eventError) {
        debug(`Failed to emit WebSocket event: ${eventError}`)
      }

      return true
    } catch (error) {
      debug('unassignGenericFilterFromDepartment: Error unassigning filter', error)
      if (isDomainError(error)) {
        throw new UserInputError(error.message)
      }
      throw error
    }
  }
}
