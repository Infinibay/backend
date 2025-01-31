import { FirewallRule } from '../networkFirewallRules';

export interface NetworkService {
  name: string;
  rules: FirewallRule[];
}

export interface NetworkBandwidth {
  inbound?: {
    average?: number;
    peak?: number;
    burst?: number;
  };
  outbound?: {
    average?: number;
    peak?: number;
    burst?: number;
  };
}

export interface NetworkDNSHost {
  hostname: string;
  ip: string;
}

export interface NetworkIPConfig {
  address: string;
  netmask: string;
  dhcp?: {
    start: string;
    end: string;
  };
}
