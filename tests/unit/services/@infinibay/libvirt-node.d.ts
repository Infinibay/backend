// Type declarations for @infinibay/libvirt-node mock
export interface Domain {
  destroy(): Promise<boolean>;
  undefine(): Promise<boolean>;
  shutdown(): Promise<boolean>;
  suspend(): Promise<boolean>;
  resume(): Promise<boolean>;
  reboot(): Promise<boolean>;
  reset(): Promise<boolean>;
  getXMLDesc(): Promise<string>;
  getName(): Promise<string>;
  getUUID(): Promise<string>;
  getState(): Promise<number[]>;
  isActive(): Promise<boolean>;
  isPersistent(): Promise<boolean>;
  getAutostart(): Promise<boolean>;
  setAutostart(value: boolean): Promise<boolean>;
  attachDevice(xml: string): Promise<boolean>;
  detachDevice(xml: string): Promise<boolean>;
  updateDevice(xml: string): Promise<boolean>;
  setVcpus(count: number): Promise<boolean>;
  setMemory(memory: number): Promise<boolean>;
  blockResize(device: string, size: number): Promise<boolean>;
  getBlockInfo(device: string): Promise<{ capacity: number; allocation: number; physical: number }>;
  getCPUStats(): Promise<any>;
  getMemoryStats(): Promise<any>;
  getInterfaceStats(iface: string): Promise<any>;
  getBlockStats(device: string): Promise<any>;
  screenshot(stream: any, screen: number): Promise<Buffer>;
}

export interface Network {
  create(): Promise<boolean>;
  destroy(): Promise<boolean>;
  undefine(): Promise<boolean>;
  getXMLDesc(): Promise<string>;
  getName(): Promise<string>;
  getUUID(): Promise<string>;
  isActive(): Promise<boolean>;
  isPersistent(): Promise<boolean>;
  getAutostart(): Promise<boolean>;
  setAutostart(value: boolean): Promise<boolean>;
  getBridgeName(): Promise<string>;
  getDHCPLeases(): Promise<any>;
}

export interface StoragePool {
  create(): Promise<boolean>;
  build(flags: number): Promise<boolean>;
  destroy(): Promise<boolean>;
  undefine(): Promise<boolean>;
  getXMLDesc(): Promise<string>;
  getName(): Promise<string>;
  getUUID(): Promise<string>;
  isActive(): Promise<boolean>;
  isPersistent(): Promise<boolean>;
  getAutostart(): Promise<boolean>;
  setAutostart(value: boolean): Promise<boolean>;
  refresh(): Promise<boolean>;
  getInfo(): Promise<any>;
  listVolumes(): Promise<string[]>;
  createVolume(xml: string): Promise<StorageVolume>;
  lookupVolumeByName(name: string): Promise<StorageVolume | null>;
}

export interface StorageVolume {
  getXMLDesc(): Promise<string>;
  getName(): Promise<string>;
  getKey(): Promise<string>;
  getPath(): Promise<string>;
  getInfo(): Promise<any>;
  delete(): Promise<boolean>;
  wipe(): Promise<boolean>;
  resize(capacity: number): Promise<boolean>;
}

export interface NWFilter {
  getXMLDesc(): Promise<string>;
  getName(): Promise<string>;
  getUUID(): Promise<string>;
  undefine(): Promise<boolean>;
}

export interface Hypervisor {
  getCapabilities(): Promise<string>;
  getHostname(): Promise<string>;
  getType(): Promise<string>;
  getVersion(): Promise<number>;
  getLibVersion(): Promise<number>;
  getURI(): Promise<string>;
  isAlive(): Promise<boolean>;
  isSecure(): Promise<boolean>;
  getNodeInfo(): Promise<any>;
  listDomains(): Promise<string[]>;
  listActiveDomains(): Promise<number[]>;
  listDefinedDomains(): Promise<string[]>;
  lookupDomainByName(name: string): Promise<Domain>;
  lookupDomainById(id: number): Promise<Domain>;
  lookupDomainByUUID(uuid: string): Promise<Domain>;
  createDomainXML(xml: string): Promise<Domain>;
  defineDomainXML(xml: string): Promise<Domain>;
  listNetworks(): Promise<string[]>;
  listActiveNetworks(): Promise<string[]>;
  listDefinedNetworks(): Promise<string[]>;
  lookupNetworkByName(name: string): Promise<Network>;
  lookupNetworkByUUID(uuid: string): Promise<Network>;
  createNetworkXML(xml: string): Promise<Network>;
  defineNetworkXML(xml: string): Promise<Network>;
  listStoragePools(): Promise<string[]>;
  listActiveStoragePools(): Promise<string[]>;
  listDefinedStoragePools(): Promise<string[]>;
  lookupStoragePoolByName(name: string): Promise<StoragePool>;
  lookupStoragePoolByUUID(uuid: string): Promise<StoragePool>;
  createStoragePoolXML(xml: string): Promise<StoragePool>;
  defineStoragePoolXML(xml: string): Promise<StoragePool>;
  listNWFilters(): Promise<string[]>;
  lookupNWFilterByName(name: string): Promise<NWFilter>;
  lookupNWFilterByUUID(uuid: string): Promise<NWFilter>;
  defineNWFilterXML(xml: string): Promise<NWFilter>;
  getNodeMemoryStats(): Promise<any>;
  getNodeCPUStats(): Promise<any>;
  getNodeDevices(): Promise<any>;
}

export class GuestAgent {
  constructor(domain: Domain);
  exec(command: string, args: string[], captureOutput: boolean): { stdout: string; stderr: string; exitCode: number };
  execStatus(pid: number): { exitCode: number; exited: boolean };
  fileRead(path: string): string;
  fileWrite(path: string, content: string, append?: boolean): boolean;
  getNetworkInterfaces(): string;
  getOsInfo(): string;
  shutdown(mode: number): boolean;
  sync(): boolean;
  setTime(time: number): boolean;
  getUsers(): string;
  rawCommand(command: string, args: string[]): string;
}

export class Connection extends Hypervisor {
  static open(uri: string): Promise<Connection>;
}

export const Network: {
  defineXml: (conn: Connection, xml: string) => Network;
};

export const Machine: {
  lookupByName: (conn: Connection, name: string) => Domain | null;
  lookupByUuidString: (conn: Connection, uuid: string) => Domain | null;
};
