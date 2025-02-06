import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from "type-graphql";
import { InfinibayContext } from '../../../utils/context';
import { FirewallService } from '../../../services/firewallService';
import { 
  VmPortInfo, 
  DepartmentPortInfo, 
  DepartmentConfigurationInfo,
  UpdatePortStatusInput,
  CreateDepartmentPortInput,
  UpdateDepartmentConfigInput
} from './types';

@Resolver()
export class FirewallResolver {
  private firewallService: FirewallService | null = null;

  @Query(() => [VmPortInfo])
  async listVmPorts(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('departmentId', { nullable: true }) departmentId?: string,
  ): Promise<VmPortInfo[]> {
    this.firewallService = new FirewallService(prisma);
    if (departmentId) {
      return this.firewallService.getVmPortsByDepartment(departmentId);
    }
    return this.firewallService.getVmPorts();
  }

  @Query(() => [DepartmentPortInfo])
  @Authorized("ADMIN")
  async listDepartmentPorts(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('departmentId') departmentId: string,
  ): Promise<DepartmentPortInfo[]> {
    const ports = await prisma.departmentPort.findMany({
      where: { departmentId }
    });
    return ports;
  }

  @Query(() => DepartmentConfigurationInfo, { nullable: true })
  @Authorized("ADMIN")
  async getDepartmentConfiguration(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('departmentId') departmentId: string,
  ): Promise<DepartmentConfigurationInfo | null> {
    return prisma.departmentConfiguration.findUnique({
      where: { departmentId }
    });
  }

  @Mutation(() => DepartmentPortInfo)
  @Authorized("ADMIN")
  async createDepartmentPort(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('input') input: CreateDepartmentPortInput,
  ): Promise<DepartmentPortInfo> {
    return prisma.departmentPort.create({
      data: {
        departmentId: input.departmentId,
        portStart: input.portStart,
        portEnd: input.portEnd,
        protocol: input.protocol,
        toEnable: input.toEnable,
      }
    });
  }

  @Mutation(() => DepartmentPortInfo)
  @Authorized("ADMIN")
  async updateDepartmentPortStatus(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('input') input: UpdatePortStatusInput,
  ): Promise<DepartmentPortInfo> {
    return prisma.departmentPort.update({
      where: { id: input.id },
      data: { toEnable: input.toEnable }
    });
  }

  @Mutation(() => Boolean)
  @Authorized("ADMIN")
  async deleteDepartmentPort(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('id') id: string,
  ): Promise<boolean> {
    await prisma.departmentPort.delete({
      where: { id }
    });
    return true;
  }

  @Mutation(() => DepartmentConfigurationInfo)
  @Authorized("ADMIN")
  async updateDepartmentConfiguration(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('input') input: UpdateDepartmentConfigInput,
  ): Promise<DepartmentConfigurationInfo> {
    return prisma.departmentConfiguration.upsert({
      where: { departmentId: input.departmentId },
      update: { cleanTraffic: input.cleanTraffic },
      create: {
        departmentId: input.departmentId,
        cleanTraffic: input.cleanTraffic
      }
    });
  }

  @Mutation(() => VmPortInfo)
  @Authorized("ADMIN")
  async updateVmPortStatus(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('input') input: UpdatePortStatusInput,
  ): Promise<VmPortInfo> {
    const port = await prisma.vmPort.update({
      where: { id: input.id },
      data: { toEnable: input.toEnable }
    });

    const vm = await prisma.machine.findUnique({
      where: { id: port.vmId }
    });

    if (!vm) {
      throw new Error(`VM not found for port ${port.id}`);
    }

    return {
      vmId: port.vmId,
      name: vm.name,
      ports: [port]
    };
  }
}
