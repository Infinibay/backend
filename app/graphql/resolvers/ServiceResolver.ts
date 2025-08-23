import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql'
import { InfinibayContext } from '@utils/context'
import { ServiceManager } from '@services/ServiceManager'
import {
  ServiceInfo,
  ServiceControlInput,
  ServiceStatusType,
  VMServiceAction,
  ServiceStatus,
  ServiceStartType
} from '../types/ServiceType'

@Resolver()
export class ServiceResolver {
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
      const services = await serviceManager.listServices(machineId)
      
      // Convert service info to GraphQL types
      return services.map(svc => ({
        ...svc,
        status: svc.status as ServiceStatus,
        startType: svc.startType as ServiceStartType
      }))
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
      const result = await serviceManager.controlService(
        input.machineId,
        input.serviceName,
        input.action
      )

      // Convert service info to GraphQL type if present
      const service = result.service ? {
        ...result.service,
        status: result.service.status as ServiceStatus,
        startType: result.service.startType as ServiceStartType
      } : undefined

      return {
        success: result.success,
        message: result.message,
        service,
        error: result.error
      } as ServiceStatusType
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