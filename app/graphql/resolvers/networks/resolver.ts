import { Resolver, Query, Mutation, Arg, Authorized } from "type-graphql";
import { NetworkService } from "@services/networkService";
import { Network, IpRangeInput, NetworkIpInput, BridgeNameInput, NetworkBridge, NetworkIp, NetworkDhcp, NetworkDhcpRange, CreateNetworkInput, DeleteNetworkInput } from "./types";

@Resolver()
export class NetworkResolver {
  private networkService: NetworkService;

  constructor() {
    this.networkService = new NetworkService();
  }

  private formatDhcpRange(xml: any): NetworkDhcpRange {
    return {
      start: xml.range[0].$.start,
      end: xml.range[0].$.end
    };
  }

  private formatDhcp(xml: any): NetworkDhcp | undefined {
    if (!xml) return undefined;
    return {
      range: this.formatDhcpRange(xml[0])
    };
  }

  private formatNetworkIp(xml: any): NetworkIp {
    if (!xml) {
      return {
        address: "",
        netmask: "",
      };
    }
    return {
      address: xml.$.address,
      netmask: xml.$.netmask,
      dhcp: this.formatDhcp(xml.dhcp)
    };
  }

  private formatBridge(xml: any): NetworkBridge {
    if (!xml) {
      return {
        name: "",
        stp: "on",
        delay: "0"
      };
    }
    return {
      name: xml.$.name,
      stp: xml.$.stp,
      delay: xml.$.delay
    };
  }

  private formatNetwork(name: string, xml: any): Network {
    return {
      name: name,
      uuid: xml.uuid?.[0] || "",
      bridge: this.formatBridge(xml.bridge?.[0]),
      ip: this.formatNetworkIp(xml.ip?.[0]),
      description: xml.description?.[0]
    };
  }

  @Query(() => [Network])
  @Authorized("USER")
  async networks(): Promise<Network[]> {
    const networks = await this.networkService.getAllNetworks();
    return networks.map(net => this.formatNetwork(net.name, net.xml));
  }

  @Query(() => Network)
  @Authorized("USER")
  async network(@Arg("name") name: string): Promise<Network> {
    const net = await this.networkService.getNetwork(name);
    return this.formatNetwork(net.name, net.xml);
  }

  @Mutation(() => Boolean)
  @Authorized("ADMIN")
  async createNetwork(
    @Arg("input") input: CreateNetworkInput
  ): Promise<boolean> {
    await this.networkService.createNetwork(input);
    return true;
  }

  @Mutation(() => Boolean)
  @Authorized("ADMIN")
  async setNetworkIpRange(
    @Arg("input") input: IpRangeInput
  ): Promise<boolean> {
    await this.networkService.setIpRange(
      input.networkName,
      input.start,
      input.end
    );
    return true;
  }

  @Mutation(() => Boolean)
  @Authorized("ADMIN")
  async setNetworkIp(
    @Arg("input") input: NetworkIpInput
  ): Promise<boolean> {
    await this.networkService.setNetworkIp(
      input.networkName,
      input.address,
      input.netmask
    );
    return true;
  }

  @Mutation(() => Boolean)
  @Authorized("ADMIN")
  async setNetworkBridgeName(
    @Arg("input") input: BridgeNameInput
  ): Promise<boolean> {
    await this.networkService.setBridgeName(
      input.networkName,
      input.bridgeName
    );
    return true;
  }

  @Mutation(() => Boolean)
  @Authorized("ADMIN")
  async deleteNetwork(
    @Arg("input") input: DeleteNetworkInput
  ): Promise<boolean> {
    try {
      await this.networkService.deleteNetwork(input.name);
      return true;
    } catch (error: any) {
      throw new Error(`Failed to delete network: ${error?.message}`);
    }
  }
}