import { Resolver, Query, Mutation, Arg, ID, Ctx, Authorized } from 'type-graphql';
import { UserInputError } from "apollo-server-core";
import { InfinibayContext } from '@utils/context';
import { 
  FilterType, 
  GenericFilter, 
  DepartmentFilter, 
  VMFilter, 
  FWRule,
  CreateFilterInput,
  UpdateFilterInput,
  CreateFilterRuleInput,
  UpdateFilterRuleInput
} from './types';
import { NetworkFilterService } from '@services/networkFilterService';

@Resolver()
export class FirewallResolver {
  constructor(private networkFilterService: NetworkFilterService) {}

  @Query(() => [GenericFilter])
  @Authorized('ADMIN')
  async listFilters(
    @Ctx() { prisma }: InfinibayContext,
    @Arg('departmentId', () => ID, { nullable: true }) departmentId?: string | null,
    @Arg('vmId', () => ID, { nullable: true }) vmId?: string | null,
  ): Promise<GenericFilter[]> {
    if (departmentId && vmId) {
      // Error
      throw new UserInputError('Both departmentId and vmId cannot be specified');
    }
    let filters: any[] = [];
    if (departmentId) {
      filters = await prisma.nWFilter.findMany({
        include: {
          vms: true,
          departments: true,
          rules: true,
          references: true
        },
        where: {
          departments: {
            some: {
              id: departmentId
            }
          }
        }
      });
    } else if (vmId) {
      filters = await prisma.nWFilter.findMany({
        include: {
          vms: true,
          rules: true,
          references: true
        },
        where: {
          vms: {
            some: {
              id: vmId
            }
          }
        }
      });
    } else {
      filters = await prisma.nWFilter.findMany({
        include: {
          vms: true,
          departments: true,
          rules: true,
          references: true
        },
        where: {
          type: 'generic'
        }
      });
    }

    return filters.map( (filter:any) => {
      return {
        id: filter.id,
        name: filter.name,
        description: filter.description || '',
        type: filter.type as FilterType,
        rules: filter.rules.map((rule: any) => {
          return {
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
          } as FWRule
        }),
        references: filter.references.map((ref:any) => ref.targetFilterId),
        createdAt: filter.createdAt,
        updatedAt: filter.updatedAt
      }
    });
  }

  @Query(() => GenericFilter, { nullable: true })
  @Authorized('ADMIN')
  async getFilter(
    @Arg('id', () => ID) id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<GenericFilter | null> {
    let result = await prisma.nWFilter.findUnique({
      where: { id },
      include: {
        rules: true,
        references: true
      }
    });

    if (!result) {
      return null;
    }
    return {
      id: result.id,
      name: result.name,
      description: result.description || '',
      type: result.type as FilterType,
      rules: result.rules.map((rule: any) => {
        return {
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
        } as FWRule
      }),
      references: result.references.map((ref:any) => ref.targetFilterId),
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    };
  }

  @Query(() => [FWRule])
  @Authorized('ADMIN')
  async listFilterRules(
    @Arg('filterId', () => ID, { nullable: true }) filterId: string | null,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule[]> {
    if (!filterId) {
      // Cast the result to FWRule[] to handle null vs undefined differences
      return (await prisma.fWRule.findMany()).map(rule => ({
        ...rule,
        // Ensure all fields match the FWRule type definition
      } as unknown as FWRule));
    }
    return (await prisma.fWRule.findMany({
      where: { nwFilterId: filterId }
    })).map(rule => ({
      ...rule,
      // Ensure all fields match the FWRule type definition
    } as unknown as FWRule));
  }

  @Mutation(() => GenericFilter)
  @Authorized()
  async createFilter(
    @Arg('input') input: CreateFilterInput,
  ): Promise<GenericFilter> {
    let fitler:any = this.networkFilterService.createFilter(
      input.name,
      input.description,
      input.chain,
      input.type
    );
    fitler.rules = [];
    fitler.references = [];
    return fitler;
  }

  @Mutation(() => GenericFilter)
  @Authorized('ADMIN')
  async updateFilter(
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateFilterInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<GenericFilter> {
    let result:any = this.networkFilterService.updateFilter(id, {
      name: input.name,
      description: input.description,
      chain: input.chain,
      type: input.type
    });
    result.rules = (await prisma.fWRule.findMany({
      where: { nwFilterId: id }
    })).map((rule: any) => {
      return {
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
      } as FWRule
    });
    result.references = (await prisma.filterReference.findMany({
      where: { targetFilterId: id }
    })).map((ref: any) => ref.sourceFilterId);
    return result;
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteFilter(
    @Arg('id', () => ID) id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    return (await prisma.nWFilter.delete({
      where: { id }
    })) !== null;
  }

  @Mutation(() => FWRule)
  @Authorized('ADMIN')
  async createFilterRule(
    @Arg('filterId', () => ID) filterId: string,
    @Arg('input') input: CreateFilterRuleInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule> {
    const rule = await this.networkFilterService.createRule(
      filterId,
      input.action,
      input.direction,
      input.priority,
      input.protocol || 'all',
      undefined, // port parameter
      {
        srcPortStart: input.srcPortStart,
        srcPortEnd: input.srcPortEnd,
        dstPortStart: input.dstPortStart,
        dstPortEnd: input.dstPortEnd,
        comment: input.comment,
        ipVersion: input.ipVersion,
        state: input.state
      }
    );
    
    // Cast to FWRule to handle null vs undefined differences
    return rule as unknown as FWRule;
  }

  @Mutation(() => FWRule)
  @Authorized('ADMIN')
  async updateFilterRule(
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateFilterRuleInput,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<FWRule> {
    let rule = prisma.fWRule.findUnique({
      where: { id }
    });

    if (!rule) {
      throw new UserInputError(`Rule with id ${id} not found`);
    }

    return await prisma.fWRule.update({
      where: { id },
      data: {
        action: input.action,
        direction: input.direction,
        priority: input.priority,
        protocol: input.protocol || undefined,
        srcPortStart: input.srcPortStart || undefined,
        srcPortEnd: input.srcPortEnd || undefined,
        dstPortStart: input.dstPortStart || undefined,
        dstPortEnd: input.dstPortEnd || undefined,
        comment: input.comment || undefined,
        ipVersion: input.ipVersion || undefined,
        state: input.state ? JSON.parse(input.state) : undefined
      }
    });
    
    // Cast to FWRule to handle null vs undefined differences
    return rule as unknown as FWRule;
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteFilterRule(
    @Arg('id', () => ID) id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    let rule = prisma.fWRule.findUnique({
      where: { id }
    });

    if (!rule) {
      throw new UserInputError(`Rule with id ${id} not found`);
    }

    return (await prisma.fWRule.delete({
      where: { id }
    })) !== null;
  }

  @Mutation(() => Boolean, {description: "Apply a network filter inmediatly"})
  @Authorized('ADMIN')
  async flushFilter(
    @Arg('filterId', () => ID) filterId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<boolean> {
    let filter = prisma.nWFilter.findUnique({
      where: { id: filterId }
    });

    if (!filter) {
      throw new UserInputError(`Filter with id ${filterId} not found`);
    }

    return this.networkFilterService.flushNWFilter(filterId);
  }
}
