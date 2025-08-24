import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { 
  ServiceManager,
  InternalServiceInfo,
  InternalServiceControlResult
} from '@services/ServiceManager'
import {
  ServiceInfo,
  ServiceControlInput,
  ServiceStatusType,
  VMServiceAction,
  ServiceStatus,
  ServiceStartType
} from '../types/ServiceType'
import { getSocketService } from '@services/SocketService'
import Debug from 'debug'

const debug = Debug('infinibay:service-resolver')

@Resolver()
export class ServiceResolver {
  /**
   * Maps internal service info to GraphQL type
   */
  private mapToGraphQLServiceInfo(internal: InternalServiceInfo): ServiceInfo {
    const serviceInfo = new ServiceInfo()
    serviceInfo.name = internal.name
    serviceInfo.displayName = internal.displayName
    serviceInfo.status = internal.status as ServiceStatus
    serviceInfo.startType = internal.startType as ServiceStartType
    serviceInfo.description = internal.description
    serviceInfo.pid = internal.pid
    return serviceInfo
  }

  /**
   * Maps internal service control result to GraphQL type
   */
  private mapToGraphQLResult(internal: InternalServiceControlResult): ServiceStatusType {
    const result = new ServiceStatusType()
    result.success = internal.success
    result.message = internal.message
    result.error = internal.error
    if (internal.service) {
      result.service = this.mapToGraphQLServiceInfo(internal.service)
    }
    return result
  }

  @Query(() => [ServiceInfo], { description: 'List all services running on a virtual machine' })
  @Authorized('USER')
  async listServices(
    @Arg('machineId') machineId: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<ServiceInfo[]> {
    try {
      // Check if user has access to this machine
      const machine = await prisma.machine.findUnique({
        where: { id: machineId }
      })

      if (!machine) {
        throw new Error('Machine not found')
      }

      // Check if user has access to this machine
      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id
      
      if (!isAdmin && !isOwner) {
        throw new Error('Access denied to this machine')
      }

      const serviceManager = new ServiceManager(prisma)
      const internalServices = await serviceManager.listServices(machineId)
      
      // Map internal types to GraphQL types
      return internalServices.map(svc => this.mapToGraphQLServiceInfo(svc))
    } catch (error) {
      console.error('Error listing services:', error)
      return []
    }
  }

  @Mutation(() => ServiceStatusType, { description: 'Control a service on a virtual machine' })
  @Authorized('USER')
  async controlService(
    @Arg('input') input: ServiceControlInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<ServiceStatusType> {
    try {
      // Check if user has access to this machine
      const machine = await prisma.machine.findUnique({
        where: { id: input.machineId }
      })

      if (!machine) {
        return {
          success: false,
          message: 'Machine not found',
          error: 'Machine not found'
        } as ServiceStatusType
      }

      // Check if user has access to this machine
      const isAdmin = user?.role === 'ADMIN'
      const isOwner = machine.userId === user?.id
      
      if (!isAdmin && !isOwner) {
        return {
          success: false,
          message: 'Access denied',
          error: 'You do not have permission to control services on this machine'
        } as ServiceStatusType
      }

      // For dangerous actions, require admin role
      if (input.action === VMServiceAction.DISABLE && !isAdmin) {
        return {
          success: false,
          message: 'Admin permission required',
          error: 'Only administrators can disable services'
        } as ServiceStatusType
      }

      const serviceManager = new ServiceManager(prisma)
      const internalResult = await serviceManager.controlService(
        input.machineId,
        input.serviceName,
        input.action
      )

      // Emit WebSocket event if successful
      if (internalResult.success && user) {
        try {
          const socketService = getSocketService()
          const actionName = input.action.toLowerCase()
          
          socketService.sendToUser(machine.userId || user.id, 'vm', `service:${actionName}`, {
            data: {
              machineId: input.machineId,
              serviceName: input.serviceName,
              action: input.action,
              newStatus: internalResult.service?.status
            }
          })
          debug(`📡 Emitted vm:service:${actionName} event for machine ${input.machineId}`)
        } catch (eventError) {
          debug(`Failed to emit WebSocket event: ${eventError}`)
        }
      }

      // Map internal type to GraphQL type
      return this.mapToGraphQLResult(internalResult)
    } catch (error) {
      console.error('Error controlling service:', error)
      return {
        success: false,
        message: 'Failed to control service',
        error: String(error)
      } as ServiceStatusType
    }
  }
}