/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
// @ts-nocheck
import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql';
import { UserInputError } from 'apollo-server-core';
import { InfinibayContext } from '../../../utils/context';
import { PrismaClient } from '@prisma/client';
import { 
  ServiceDefinition as GraphQLServiceDefinition, 
  VmServiceStatus as GraphQLVmServiceStatus, 
  DepartmentServiceStatus as GraphQLDepartmentServiceStatus,
  GlobalServiceStatus as GraphQLGlobalServiceStatus,
  ServiceStatusSummary,
  ServiceAction
} from './types';
import { 
  ToggleServiceInput, 
  ToggleVmServiceInput, 
  ToggleDepartmentServiceInput 
} from './inputs';
import { FirewallService } from '../../../services/firewallService';
import { KNOWN_SERVICES } from '../../../config/knownServices';

@Resolver()
export class SecurityResolver {
  private firewallService: FirewallService | null = null;

  /**
   * Get or initialize the firewall service
   */
  private getFirewallService(prisma: PrismaClient): FirewallService {
    if (!this.firewallService) {
      this.firewallService = new FirewallService(prisma);
    }
    return this.firewallService;
  }

  /**
   * List all available services with their definitions
   */
  @Query(() => [GraphQLServiceDefinition])
  @Authorized(['ADMIN'])
  async listServices(
    @Ctx() { prisma }: InfinibayContext
  ): Promise<GraphQLServiceDefinition[]> {
    return this.getFirewallService(prisma).getServices();
  }

  /**
   * Get service status for a specific VM
   * @param vmId VM ID
   * @param serviceId Optional service ID to filter results
   */
  @Query(() => [GraphQLVmServiceStatus])
  @Authorized(['ADMIN'])
  async getVmServiceStatus(
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('vmId', () => ID) vmId: string,
    @Arg('serviceId', () => ID, { nullable: true }) serviceId?: string
  ): Promise<GraphQLVmServiceStatus[]> {
    // Validate that the VM exists
    const vm = await prisma.machine.findUnique({
      where: { id: vmId },
      select: { id: true }
    });

    if (!vm) {
      throw new UserInputError(`VM with ID ${vmId} not found`);
    }

    // Get the service status
    return this.getFirewallService(prisma).getVmServiceStatus(vmId, serviceId);
  }

  /**
   * Get service status for a department
   * @param departmentId Department ID
   * @param serviceId Optional service ID to filter results
   */
  @Query(() => [GraphQLDepartmentServiceStatus])
  @Authorized(['ADMIN'])
  async getDepartmentServiceStatus(
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('departmentId', () => ID) departmentId: string,
    @Arg('serviceId', () => ID, { nullable: true }) serviceId?: string
  ): Promise<GraphQLDepartmentServiceStatus[]> {
    // Validate department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true }
    });

    if (!department) {
      throw new UserInputError(`Department with ID ${departmentId} not found`);
    }

    // Get the department service status
    return this.getFirewallService(prisma).getDepartmentServiceStatus(departmentId, serviceId);
  }

  /**
   * Get global service status
   * @param serviceId Optional service ID to filter results
   */
  @Query(() => [GraphQLGlobalServiceStatus])
  @Authorized(['ADMIN'])
  async getGlobalServiceStatus(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('serviceId', () => ID, { nullable: true }) serviceId?: string
  ): Promise<GraphQLGlobalServiceStatus[]> {
    return this.getFirewallService(prisma).getGlobalServiceStatus(serviceId);
  }

  /**
   * Get service status summary across all VMs
   */
  @Query(() => [ServiceStatusSummary])
  @Authorized(['ADMIN'])
  async getServiceStatusSummary(
    @Ctx() { prisma }: InfinibayContext
  ): Promise<ServiceStatusSummary[]> {
    // Get all services
    const services = await this.getFirewallService(prisma).getServices();
    
    // For each service, get VM statistics
    const result: ServiceStatusSummary[] = [];
    
    for (const service of services) {
      // Get all VMs that have ports matching this service
      const vms = await prisma.machine.findMany({
        include: {
          ports: {
            where: {
              OR: service.ports.map(port => ({
                AND: [
                  { protocol: port.protocol },
                  { portStart: { lte: port.portEnd } },
                  { portEnd: { gte: port.portStart } }
                ]
              }))
            }
          }
        }
      });

      const totalVms = vms.length;
      let runningVms = 0;
      let enabledVms = 0;

      for (const vm of vms) {
        // VM is considered running this service if any matching port is running
        const isRunning = vm.ports.some(port => port.running);
        if (isRunning) runningVms++;

        // VM is considered to have service enabled if any matching port is enabled
        const isEnabled = vm.ports.some(port => port.enabled);
        if (isEnabled) enabledVms++;
      }

      result.push({
        serviceId: service.id,
        serviceName: service.name,
        totalVms,
        runningVms,
        enabledVms
      });
    }

    return result;
  }

  /**
   * Toggle a service for a specific VM
   * @param input ToggleVmServiceInput
   */
  @Mutation(() => GraphQLVmServiceStatus)
  @Authorized(['ADMIN'])
  async toggleVmService(
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('input') input: ToggleVmServiceInput
  ): Promise<GraphQLVmServiceStatus> {
    const { vmId, serviceId, action, enabled } = input;

    // Validate that the VM exists
    const vm = await prisma.machine.findUnique({
      where: { id: vmId },
      select: { id: true }
    });

    if (!vm) {
      throw new UserInputError(`VM with ID ${vmId} not found`);
    }

    // Toggle the service
    return this.getFirewallService(prisma).toggleVmService(vmId, serviceId, action, enabled);
  }

  /**
   * Toggle a service for all VMs in a department
   * @param input ToggleDepartmentServiceInput
   */
  @Mutation(() => GraphQLDepartmentServiceStatus)
  @Authorized(['ADMIN'])
  async toggleDepartmentService(
    @Ctx() { prisma, user }: InfinibayContext,
    @Arg('input') input: ToggleDepartmentServiceInput
  ): Promise<GraphQLDepartmentServiceStatus> {
    const { departmentId, serviceId, action, enabled } = input;

    // Validate that the department exists
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true }
    });

    if (!department) {
      throw new UserInputError(`Department with ID ${departmentId} not found`);
    }

    // Toggle the service for the department
    return this.getFirewallService(prisma).toggleDepartmentService(departmentId, serviceId, action, enabled);
  }

  /**
   * Toggle a global service (affects all VMs)
   * @param input ToggleServiceInput
   */
  @Mutation(() => GraphQLGlobalServiceStatus)
  @Authorized(['ADMIN'])
  async toggleGlobalService(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('input') input: ToggleServiceInput
  ): Promise<GraphQLGlobalServiceStatus> {
    const { serviceId, action, enabled } = input;

    // Toggle the global service
    return this.getFirewallService(prisma).toggleGlobalService(serviceId, action, enabled);
  }
}
