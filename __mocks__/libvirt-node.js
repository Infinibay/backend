// Mock implementation of libvirt-node
const mockState = {
  domains: new Map(),
  networks: new Map(),
  storagePools: new Map(),
  nwFilters: new Map(),
  hypervisorInfo: {
    model: 'x86_64',
    memory: 32768,
    cpus: 16,
    threads: 2,
    cores: 4,
    sockets: 2,
    nodes: 1,
    cpu_model: 'Intel Core i7',
    cpu_vendor: 'Intel',
    cpu_frequency: 2400
  }
};

// Helper to generate random MAC address
function generateMacAddress() {
  const mac = [];
  for (let i = 0; i < 6; i++) {
    mac.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  return mac.join(':');
}

class MockDomain {
  constructor(xml) {
    this.xml = xml;
    this.name = xml.match(/<name>(.*?)<\/name>/)?.[1] || 'test-vm';
    this.uuid = xml.match(/<uuid>(.*?)<\/uuid>/)?.[1] || 'test-uuid';
    this.state = 'shutoff';
    this.id = Math.floor(Math.random() * 1000);
    this.persistent = true;
    this.autostart = false;
  }

  async create() {
    this.state = 'running';
    return true;
  }

  async destroy() {
    this.state = 'shutoff';
    return true;
  }

  async shutdown() {
    this.state = 'shutoff';
    return true;
  }

  async suspend() {
    this.state = 'paused';
    return true;
  }

  async resume() {
    this.state = 'running';
    return true;
  }

  async reboot() {
    return true;
  }

  async reset() {
    return true;
  }

  async undefine() {
    mockState.domains.delete(this.name);
    return true;
  }

  async getXMLDesc() {
    return this.xml;
  }

  async getName() {
    return this.name;
  }

  async getUUID() {
    return this.uuid;
  }

  async getID() {
    return this.id;
  }

  async getInfo() {
    return {
      state: this.state === 'running' ? 1 : this.state === 'paused' ? 3 : 5,
      maxMem: 8388608,
      memory: 4194304,
      nrVirtCpu: 4,
      cpuTime: 1000000000
    };
  }

  async getState() {
    const stateMap = {
      'running': [1, 1],
      'paused': [3, 2],
      'shutoff': [5, 1]
    };
    return stateMap[this.state] || [5, 1];
  }

  async isPersistent() {
    return this.persistent;
  }

  async isActive() {
    return this.state === 'running';
  }

  async getAutostart() {
    return this.autostart;
  }

  async setAutostart(value) {
    this.autostart = value;
    return true;
  }

  async attachDevice(xml) {
    return true;
  }

  async detachDevice(xml) {
    return true;
  }

  async updateDevice(xml) {
    return true;
  }

  async setVcpus(count) {
    return true;
  }

  async setMemory(memory) {
    return true;
  }

  async blockResize(device, size) {
    return true;
  }

  async getBlockInfo(device) {
    return {
      capacity: 107374182400,
      allocation: 21474836480,
      physical: 107374182400
    };
  }

  async getCPUStats() {
    return {
      cpu_time: 1000000000,
      user_time: 500000000,
      system_time: 500000000
    };
  }

  async getMemoryStats() {
    return {
      actual: 4194304,
      swap_in: 0,
      swap_out: 0,
      major_fault: 100,
      minor_fault: 1000,
      unused: 2097152,
      available: 4194304,
      rss: 2097152
    };
  }

  async getInterfaceStats(iface) {
    return {
      rx_bytes: 1000000,
      rx_packets: 1000,
      rx_errors: 0,
      rx_drop: 0,
      tx_bytes: 500000,
      tx_packets: 500,
      tx_errors: 0,
      tx_drop: 0
    };
  }

  async getBlockStats(device) {
    return {
      rd_req: 1000,
      rd_bytes: 10000000,
      wr_req: 500,
      wr_bytes: 5000000,
      errors: 0
    };
  }

  async screenshot(stream, screen) {
    return Buffer.from('fake-screenshot-data');
  }
}

class MockNetwork {
  constructor(xml) {
    this.xml = xml;
    this.name = xml.match(/<name>(.*?)<\/name>/)?.[1] || 'test-network';
    this.uuid = xml.match(/<uuid>(.*?)<\/uuid>/)?.[1] || 'test-network-uuid';
    this.active = false;
    this.persistent = true;
    this.autostart = false;
  }

  async create() {
    this.active = true;
    return true;
  }

  async destroy() {
    this.active = false;
    return true;
  }

  async undefine() {
    mockState.networks.delete(this.name);
    return true;
  }

  async getXMLDesc() {
    return this.xml;
  }

  async getName() {
    return this.name;
  }

  async getUUID() {
    return this.uuid;
  }

  async isActive() {
    return this.active;
  }

  async isPersistent() {
    return this.persistent;
  }

  async getAutostart() {
    return this.autostart;
  }

  async setAutostart(value) {
    this.autostart = value;
    return true;
  }

  async getBridgeName() {
    return 'virbr0';
  }

  async getDHCPLeases() {
    return [
      {
        interface: 'vnet0',
        expiry_time: Date.now() + 3600000,
        type: 0,
        mac: generateMacAddress(),
        ipaddr: '192.168.122.10',
        prefix: 24,
        hostname: 'test-vm'
      }
    ];
  }
}

class MockStoragePool {
  constructor(xml) {
    this.xml = xml;
    this.name = xml.match(/<name>(.*?)<\/name>/)?.[1] || 'test-pool';
    this.uuid = xml.match(/<uuid>(.*?)<\/uuid>/)?.[1] || 'test-pool-uuid';
    this.active = false;
    this.persistent = true;
    this.autostart = false;
    this.volumes = new Map();
  }

  async create() {
    this.active = true;
    return true;
  }

  async build(flags) {
    return true;
  }

  async destroy() {
    this.active = false;
    return true;
  }

  async undefine() {
    mockState.storagePools.delete(this.name);
    return true;
  }

  async getXMLDesc() {
    return this.xml;
  }

  async getName() {
    return this.name;
  }

  async getUUID() {
    return this.uuid;
  }

  async isActive() {
    return this.active;
  }

  async isPersistent() {
    return this.persistent;
  }

  async getAutostart() {
    return this.autostart;
  }

  async setAutostart(value) {
    this.autostart = value;
    return true;
  }

  async refresh() {
    return true;
  }

  async getInfo() {
    return {
      state: this.active ? 2 : 0,
      capacity: 1099511627776,
      allocation: 549755813888,
      available: 549755813888
    };
  }

  async listVolumes() {
    return Array.from(this.volumes.keys());
  }

  async createVolume(xml) {
    const name = xml.match(/<name>(.*?)<\/name>/)?.[1] || 'test-volume';
    const volume = new MockStorageVolume(xml, this);
    this.volumes.set(name, volume);
    return volume;
  }

  async lookupVolumeByName(name) {
    return this.volumes.get(name);
  }
}

class MockStorageVolume {
  constructor(xml, pool) {
    this.xml = xml;
    this.pool = pool;
    this.name = xml.match(/<name>(.*?)<\/name>/)?.[1] || 'test-volume';
    this.key = `/var/lib/libvirt/images/${this.name}`;
    this.path = this.key;
  }

  async getXMLDesc() {
    return this.xml;
  }

  async getName() {
    return this.name;
  }

  async getKey() {
    return this.key;
  }

  async getPath() {
    return this.path;
  }

  async getInfo() {
    return {
      type: 0,
      capacity: 107374182400,
      allocation: 0
    };
  }

  async delete() {
    this.pool.volumes.delete(this.name);
    return true;
  }

  async wipe() {
    return true;
  }

  async resize(capacity) {
    return true;
  }
}

class MockNWFilter {
  constructor(xml) {
    this.xml = xml;
    this.name = xml.match(/<filter.*?name=['"]([^'"]+)['"]/)?.[1] || 'test-filter';
    this.uuid = xml.match(/<uuid>(.*?)<\/uuid>/)?.[1] || 'test-filter-uuid';
  }

  async getXMLDesc() {
    return this.xml;
  }

  async getName() {
    return this.name;
  }

  async getUUID() {
    return this.uuid;
  }

  async undefine() {
    mockState.nwFilters.delete(this.name);
    return true;
  }
}

class MockHypervisor {
  constructor() {
    this.uri = 'qemu:///system';
    this.connected = true;
  }

  async connect() {
    this.connected = true;
    return true;
  }

  async disconnect() {
    this.connected = false;
    return true;
  }

  async getCapabilities() {
    return `<?xml version="1.0"?>
<capabilities>
  <host>
    <cpu>
      <arch>x86_64</arch>
      <model>Intel Core i7</model>
      <vendor>Intel</vendor>
    </cpu>
  </host>
</capabilities>`;
  }

  async getHostname() {
    return 'test-hypervisor';
  }

  async getType() {
    return 'QEMU';
  }

  async getVersion() {
    return 7000000;
  }

  async getLibVersion() {
    return 8000000;
  }

  async getURI() {
    return this.uri;
  }

  async isAlive() {
    return this.connected;
  }

  async isSecure() {
    return true;
  }

  async getNodeInfo() {
    return mockState.hypervisorInfo;
  }

  async listDomains() {
    return Array.from(mockState.domains.keys());
  }

  async listActiveDomains() {
    return Array.from(mockState.domains.values())
      .filter(d => d.state === 'running')
      .map(d => d.id);
  }

  async listDefinedDomains() {
    return Array.from(mockState.domains.values())
      .filter(d => d.state === 'shutoff')
      .map(d => d.name);
  }

  async lookupDomainByName(name) {
    const domain = mockState.domains.get(name);
    if (!domain) {
      throw new Error(`Domain '${name}' not found`);
    }
    return domain;
  }

  async lookupDomainById(id) {
    const domain = Array.from(mockState.domains.values()).find(d => d.id === id);
    if (!domain) {
      throw new Error(`Domain with ID ${id} not found`);
    }
    return domain;
  }

  async lookupDomainByUUID(uuid) {
    const domain = Array.from(mockState.domains.values()).find(d => d.uuid === uuid);
    if (!domain) {
      throw new Error(`Domain with UUID ${uuid} not found`);
    }
    return domain;
  }

  async createDomainXML(xml) {
    const domain = new MockDomain(xml);
    domain.state = 'running';
    mockState.domains.set(domain.name, domain);
    return domain;
  }

  async defineDomainXML(xml) {
    const domain = new MockDomain(xml);
    mockState.domains.set(domain.name, domain);
    return domain;
  }

  async listNetworks() {
    return Array.from(mockState.networks.keys());
  }

  async listActiveNetworks() {
    return Array.from(mockState.networks.values())
      .filter(n => n.active)
      .map(n => n.name);
  }

  async listDefinedNetworks() {
    return Array.from(mockState.networks.values())
      .filter(n => !n.active)
      .map(n => n.name);
  }

  async lookupNetworkByName(name) {
    const network = mockState.networks.get(name);
    if (!network) {
      throw new Error(`Network '${name}' not found`);
    }
    return network;
  }

  async lookupNetworkByUUID(uuid) {
    const network = Array.from(mockState.networks.values()).find(n => n.uuid === uuid);
    if (!network) {
      throw new Error(`Network with UUID ${uuid} not found`);
    }
    return network;
  }

  async createNetworkXML(xml) {
    const network = new MockNetwork(xml);
    network.active = true;
    mockState.networks.set(network.name, network);
    return network;
  }

  async defineNetworkXML(xml) {
    const network = new MockNetwork(xml);
    mockState.networks.set(network.name, network);
    return network;
  }

  async listStoragePools() {
    return Array.from(mockState.storagePools.keys());
  }

  async listActiveStoragePools() {
    return Array.from(mockState.storagePools.values())
      .filter(p => p.active)
      .map(p => p.name);
  }

  async listDefinedStoragePools() {
    return Array.from(mockState.storagePools.values())
      .filter(p => !p.active)
      .map(p => p.name);
  }

  async lookupStoragePoolByName(name) {
    const pool = mockState.storagePools.get(name);
    if (!pool) {
      throw new Error(`Storage pool '${name}' not found`);
    }
    return pool;
  }

  async lookupStoragePoolByUUID(uuid) {
    const pool = Array.from(mockState.storagePools.values()).find(p => p.uuid === uuid);
    if (!pool) {
      throw new Error(`Storage pool with UUID ${uuid} not found`);
    }
    return pool;
  }

  async createStoragePoolXML(xml) {
    const pool = new MockStoragePool(xml);
    pool.active = true;
    mockState.storagePools.set(pool.name, pool);
    return pool;
  }

  async defineStoragePoolXML(xml) {
    const pool = new MockStoragePool(xml);
    mockState.storagePools.set(pool.name, pool);
    return pool;
  }

  async listNWFilters() {
    return Array.from(mockState.nwFilters.keys());
  }

  async lookupNWFilterByName(name) {
    const filter = mockState.nwFilters.get(name);
    if (!filter) {
      throw new Error(`Network filter '${name}' not found`);
    }
    return filter;
  }

  async lookupNWFilterByUUID(uuid) {
    const filter = Array.from(mockState.nwFilters.values()).find(f => f.uuid === uuid);
    if (!filter) {
      throw new Error(`Network filter with UUID ${uuid} not found`);
    }
    return filter;
  }

  async defineNWFilterXML(xml) {
    const filter = new MockNWFilter(xml);
    mockState.nwFilters.set(filter.name, filter);
    return filter;
  }

  async getNodeMemoryStats() {
    return {
      total: 32768 * 1024,
      free: 16384 * 1024,
      buffers: 2048 * 1024,
      cached: 4096 * 1024
    };
  }

  async getNodeCPUStats() {
    return {
      kernel: 1000000000,
      user: 2000000000,
      idle: 5000000000,
      iowait: 100000000
    };
  }

  async getNodeDevices() {
    return [
      {
        name: 'pci_0000_01_00_0',
        parent: 'pci_0000_00_01_0',
        driver: 'nvidia',
        capability: 'pci',
        vendor: 'NVIDIA Corporation',
        product: 'GeForce RTX 3080'
      }
    ];
  }
}

// Module exports
module.exports = {
  Hypervisor: MockHypervisor,
  
  // Export mock state for testing
  __setLibvirtMockState: (state) => {
    Object.assign(mockState, state);
  },
  
  __getLibvirtMockState: () => mockState,
  
  __resetLibvirtMockState: () => {
    mockState.domains.clear();
    mockState.networks.clear();
    mockState.storagePools.clear();
    mockState.nwFilters.clear();
  },

  // Constants
  VIR_DOMAIN_NOSTATE: 0,
  VIR_DOMAIN_RUNNING: 1,
  VIR_DOMAIN_BLOCKED: 2,
  VIR_DOMAIN_PAUSED: 3,
  VIR_DOMAIN_SHUTDOWN: 4,
  VIR_DOMAIN_SHUTOFF: 5,
  VIR_DOMAIN_CRASHED: 6,
  VIR_DOMAIN_PMSUSPENDED: 7,

  VIR_DOMAIN_AFFECT_CURRENT: 0,
  VIR_DOMAIN_AFFECT_LIVE: 1,
  VIR_DOMAIN_AFFECT_CONFIG: 2,

  VIR_DOMAIN_UNDEFINE_MANAGED_SAVE: 1,
  VIR_DOMAIN_UNDEFINE_SNAPSHOTS_METADATA: 2,
  VIR_DOMAIN_UNDEFINE_NVRAM: 4,

  VIR_STORAGE_POOL_BUILD_NEW: 0,
  VIR_STORAGE_POOL_BUILD_REPAIR: 1,
  VIR_STORAGE_POOL_BUILD_RESIZE: 2,
  VIR_STORAGE_POOL_BUILD_NO_OVERWRITE: 4,
  VIR_STORAGE_POOL_BUILD_OVERWRITE: 8
};