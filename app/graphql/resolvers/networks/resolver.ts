import { Resolver, Query, Mutation, Arg, Authorized, Ctx } from 'type-graphql'
import { DepartmentNetworkService } from '@services/network/DepartmentNetworkService'
import { InfinibayContext } from '@main/utils/context'
import { Network, IpRangeInput, NetworkIpInput, BridgeNameInput, NetworkBridge, NetworkIp, NetworkDhcp, NetworkDhcpRange, CreateNetworkInput, DeleteNetworkInput } from './types'
import { assertCanAccessResource } from '../../utils/auth'

type NetworkXml = {
  $?: Record<string, string>
  range?: NetworkXml[]
  dhcp?: NetworkXml[]
  bridge?: NetworkXml[]
  ip?: NetworkXml[]
  uuid?: string[]
  description?: string[]
}

@Resolver()
export class NetworkResolver {
  private networkService?: DepartmentNetworkService

  private getNetworkService (ctx: InfinibayContext): DepartmentNetworkService {
    if (!this.networkService) {
      this.networkService = new DepartmentNetworkService(ctx.prisma)
    }
    return this.networkService
  }

  private formatDhcpRange (xml: NetworkXml): NetworkDhcpRange {
    return {
      start: xml.range?.[0]?.$?.start ?? '',
      end: xml.range?.[0]?.$?.end ?? ''
    }
  }

  private formatDhcp (xml: NetworkXml[] | undefined): NetworkDhcp | undefined {
    if (!xml) return undefined
    return {
      range: this.formatDhcpRange(xml[0])
    }
  }

  private formatNetworkIp (xml: NetworkXml | undefined): NetworkIp {
    if (!xml) {
      return {
        address: '',
        netmask: ''
      }
    }
    return {
      address: xml.$?.address ?? '',
      netmask: xml.$?.netmask ?? '',
      dhcp: this.formatDhcp(xml.dhcp)
    }
  }

  private formatBridge (xml: NetworkXml | undefined): NetworkBridge {
    if (!xml) {
      return {
        name: '',
        stp: 'on',
        delay: '0'
      }
    }
    return {
      name: xml.$?.name ?? '',
      stp: xml.$?.stp ?? 'on',
      delay: xml.$?.delay ?? '0'
    }
  }

  private formatNetwork (name: string, xml: NetworkXml): Network {
    return {
      name,
      uuid: xml.uuid?.[0] || '',
      bridge: this.formatBridge(xml.bridge?.[0]),
      ip: this.formatNetworkIp(xml.ip?.[0]),
      description: xml.description?.[0]
    }
  }

  @Query(() => [Network])
  @Authorized('USER')
  async networks (): Promise<Network[]> {
    // Department networks are managed per-department, not as global libvirt networks
    // Return empty array — network info is now available via department resolvers
    return []
  }

  @Query(() => Network)
  @Authorized('USER')
  async network (@Arg('name') name: string): Promise<Network> {
    throw new Error(`Network '${name}' not found. Network management is now handled per-department via DepartmentNetworkService.`)
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async createNetwork (
    @Arg('input') _input: CreateNetworkInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    await assertCanAccessResource(ctx, 'infrastructure')
    throw new Error('Global network creation is deprecated. Create networks via department management.')
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async setNetworkIpRange (
    @Arg('input') _input: IpRangeInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    await assertCanAccessResource(ctx, 'infrastructure')
    throw new Error('Global network IP range management is deprecated. Use department network settings.')
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async setNetworkIp (
    @Arg('input') _input: NetworkIpInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    await assertCanAccessResource(ctx, 'infrastructure')
    throw new Error('Global network IP management is deprecated. Use department network settings.')
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async setNetworkBridgeName (
    @Arg('input') _input: BridgeNameInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    await assertCanAccessResource(ctx, 'infrastructure')
    throw new Error('Global network bridge management is deprecated. Use department network settings.')
  }

  @Mutation(() => Boolean)
  @Authorized('ADMIN')
  async deleteNetwork (
    @Arg('input') _input: DeleteNetworkInput,
    @Ctx() ctx: InfinibayContext
  ): Promise<boolean> {
    await assertCanAccessResource(ctx, 'infrastructure')
    throw new Error('Global network deletion is deprecated. Delete networks via department management.')
  }
}
