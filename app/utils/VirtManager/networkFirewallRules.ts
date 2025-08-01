import { NetworkService } from './types/network'

export interface FirewallRule {
  protocol: string;
  port?: number | string;
  action: 'accept' | 'reject' | 'drop';
}

export class NetworkFirewallRules {
  private static commonServices: Record<string, NetworkService> = {
    'remote-desktop': {
      name: 'Remote Desktop',
      rules: [
        { protocol: 'tcp', port: 3389, action: 'accept' }
      ]
    },
    ssh: {
      name: 'SSH',
      rules: [
        { protocol: 'tcp', port: 22, action: 'accept' }
      ]
    },
    http: {
      name: 'HTTP',
      rules: [
        { protocol: 'tcp', port: 80, action: 'accept' }
      ]
    },
    https: {
      name: 'HTTPS',
      rules: [
        { protocol: 'tcp', port: 443, action: 'accept' }
      ]
    },
    dns: {
      name: 'DNS',
      rules: [
        { protocol: 'tcp', port: 53, action: 'accept' },
        { protocol: 'udp', port: 53, action: 'accept' }
      ]
    }
  }

  public static getServiceRules (serviceName: string): FirewallRule[] {
    const service = this.commonServices[serviceName]
    if (!service) {
      throw new Error(`Service ${serviceName} not found`)
    }
    return service.rules
  }

  public static addCustomService (
    name: string,
    displayName: string,
    rules: FirewallRule[]
  ): void {
    this.commonServices[name] = {
      name: displayName,
      rules
    }
  }

  public static getAllServices (): string[] {
    return Object.keys(this.commonServices)
  }
}
