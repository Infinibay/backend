import { Resolver, Query, Arg, Ctx } from "type-graphql";
import { InfinibayContext } from '../../../utils/context';
import { FirewallService } from '../../../services/firewallService';
import { VmPortInfo } from './types';

@Resolver()
export class FirewallResolver {
  private firewallService: FirewallService  | null = null;

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
}
