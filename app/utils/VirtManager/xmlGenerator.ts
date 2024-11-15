import xml2js from 'xml2js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';

export enum NetworkModel {
  VIRTIO = 'virtio',
  E1000 = 'e1000',
}

export class XMLGenerator {
  private xml: any;
  private id: string;
  private os: string;

  constructor(name: string, id: string, os: string) {
    this.xml = {
      domain: {
        $: {
          type: 'kvm'
        },
        name: [name],
        metadata: {
          "ibosinfo:libosinfo": {
            $: {
              "xmlns:libosinfo": "http://libosinfo.org/xmlns/libvirt/domain/1.0"
            }
          },
          "libosinfo:os": {
            $: { id: "http://microsoft.com/win/10" }
          }
        },
        devices: [
          {
            controller: [
              {
                $: {
                  type: 'sata',
                  index: '0'
                }
              }
            ]
          }
        ]
      }
    };
    this.xml.domain.os = [{ type: [{ _: 'hvm', $: { arch: 'x86_64', machine: 'q35' } }] }];
    this.id = id;
    this.os = os;
  }

  load(externalXml: any) {
    this.xml = externalXml
  }

  getXmlObject(): any {
    return this.xml;
  }

  setMemory(size: number): void {
    // Convert size from Gb to KiB (1 Gb = 1024 * 1024 KiB)
    const sizeInKiB = size * 1024 * 1024;
    this.xml.domain.memory = [{ _: sizeInKiB, $: { unit: 'KiB' } }];
    this.xml.domain.currentMemory = [{ _: sizeInKiB, $: { unit: 'KiB' } }];
    this.xml.domain.devices[0].memballoon = [{ $: { model: 'virtio' } }];
  }

  setVCPUs(count: number): void {
    this.xml.domain.vcpu = [{ _: count, $: { placement: 'static', current: count } }]; //current may not be needed
    this.xml.domain.cpu = {
      $: {
        mode: 'host-passthrough',
        check: 'none',
        migratable: 'on',
      },
    };
    // https://libvirt.org/formatdomain.html#hypervisor-features
    this.xml.domain.features[0].hyperv = {
      $: { mode: 'custom' },
      relaxed: { $: { state: 'on' } },
      vapic: { $: { state: 'on' } },
      spinlocks: { $: { state: 'on', retries: '8191' } },
    };
    this.xml.domain.clock = {
      $: {
        offset: "localtime"
      },
      timer: [
        { $: { name: "rtc", tickpolicy: "catchup" } },
        { $: { name: "pit", tickpolicy: "delay" } },
        { $: { name: "hpet", present: "no" } },
        { $: { name: "hypervclock", present: "yes" } }
      ]
    }

    this.xml.domain.pm = {
      "suspend-to-mem": { $: { enabled: "no" } },
      "suspend-to-disk": { $: { enabled: "no" } }
    }
  }

  setBootDevice(devices: ('fd' | 'hd' | 'cdrom' | 'network')[]): void {
    this.xml.domain.os[0].boot = devices.map(device => ({ $: { dev: device } }));
  }

  addNetworkInterface(network: string, model: string) {
    const networkInterface = {
      $: { type: 'network' },
      source: [{ $: { network: network } }],
      model: [{ $: { type: model } }],
    };

    this.xml.domain.devices[0].interface = this.xml.domain.devices[0].interface || [];
    this.xml.domain.devices[0].interface.push(networkInterface);
    // TODO: Add bandwidth quota
    // TODO: Add ip address
  }

  enableTPM(version: '1.2' | '2.0' = '2.0'): void {
    const secretUUID = uuidv4();
    this.xml.domain.devices[0].tpm = [{
      $: { model: 'tpm-tis' },
      backend: [{
        $: { type: 'emulator', version: version },
      }]
    }];
  }

  enableFeatures(): void {
    if (!this.xml.domain.features) {
      this.xml.domain.features = [{}];
    }
    this.xml.domain.features[0].acpi = [{}]; // Advanced Configuration and Power Interface, for power management.
    this.xml.domain.features[0].apic = [{}]; // Advanced Programmable Interrupt Controller, for better handling of system interrupts.
    this.xml.domain.features[0].kvm = [{ "hidden": { $: { state: 'on' } } }]; // KVM features for performance improvement.
    this.xml.domain.features[0].hyperv = {
      $: { mode: "custom" },
      relaxed: { $: { state: "on" } },
      vapic: { $: { state: "on" } },
      spinlocks: { $: { state: "on", retries: "8191" } },
    };
  }

  setUEFI(): void {
    this.enableFeatures();
    let efiPath: string
    let nvramPath: string

    // Check for OVMF files in different possible locations
    const possibleEfiPaths = [
      '/usr/share/OVMF/OVMF_CODE.ms.fd',
      '/usr/share/OVMF/OVMF_CODE_4M.ms.fd',
      '/usr/share/edk2/ovmf/OVMF_CODE.ms.fd',
      '/usr/share/qemu/OVMF_CODE.ms.fd'
    ];

    efiPath = possibleEfiPaths.find(p => fs.existsSync(p)) || '';

    if (!efiPath) {
      throw new Error('UEFI firmware file (OVMF_CODE.ms.fd or OVMF_CODE_4M.ms.fd) not found. Please install OVMF package.');
    }

    nvramPath = path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'uefi', `${this.id}_VARS.fd`);
    this.xml.domain.os[0].loader = [{ _: efiPath, $: { readonly: 'yes', type: 'pflash', secure: "yes" } }];
    this.xml.domain.os[0].nvram = [{ _: nvramPath }];
  }

  addDisk(path: string, bus: 'ide' | 'sata' | 'virtio', size: number): string {
    let dev: string = '';
    if (bus === 'ide') {
      dev = 'hd';
    } else if (bus === 'sata') {
      dev = 'sd';
    } else if (bus === 'virtio') {
      dev = 'vd';
    }
    dev = this.getNextBus(dev);

    // Enable io Threads for better performance
    // https://libvirt.org/formatdomain.html#iothreads-allocation
    this.xml.domain.iothreads = [{ _: '4' }];
    const disk = {
      $: { type: 'file', device: 'disk' },
      driver: [{ $: { name: 'qemu', type: 'qcow2', cache: 'writeback', discard: 'unmap' } }],
      source: [{ $: { file: path } }],
      target: [{ $: { dev: dev, bus: bus } }],
      capacity: [{ _: String(size), $: { unit: 'G' } }],
    };
    this.xml.domain.devices[0].disk = this.xml.domain.devices[0].disk || [];
    this.xml.domain.devices[0].disk.push(disk);
    return dev
  }

  setStorage(size: number): void {
    const diskPath = path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'disks') || '/opt/infinibay/disks';
    this.addDisk(`${diskPath}/${this.xml.domain.name[0]}-main.qcow2`, 'virtio', size);
  }

  addNetwork(model: NetworkModel, network: string): void {
    const networkInterface = {
      $: { type: 'network' },
      source: [{ $: { network: network } }],
      model: [{ $: { type: 'virtio' } }],
      driver: [{ $: { name: 'vhost', queues: '4' } }],
    };

    this.xml.domain.devices[0].interface = this.xml.domain.devices[0].interface || [];
    this.xml.domain.devices[0].interface.push(networkInterface);
  }

  addVirtIODrivers(): string {
    const virtioIsoPath = process.env.VIRTIO_WIN_ISO_PATH;
    if (!virtioIsoPath) {
      throw new Error('VIRTIO_WIN_ISO_PATH environment variable is not set');
    }

    return this.addCDROM(virtioIsoPath, 'sata');
  }

  addCDROM(path: string, bus: 'ide' | 'sata' | 'virtio'): string {
    let dev: string = '';
    if (bus === 'ide') {
      dev = 'hd';
    } else if (bus === 'sata') {
      dev = 'sd';
    } else if (bus === 'virtio') {
      dev = 'vd';
    }
    dev = this.getNextBus(dev);

    const cdrom = {
      $: { type: 'file', device: 'cdrom' },
      driver: [{ $: { name: 'qemu', type: 'raw' } }],
      source: [{ $: { file: path } }],
      target: [{ $: { dev: dev, bus: bus } }],
      readonly: [{}],
    };
    this.xml.domain.devices[0].disk = this.xml.domain.devices[0].disk || [];
    this.xml.domain.devices[0].disk.push(cdrom);
    return dev
  }

  addVNC(port: number, autoport: boolean = true, listen: string = '0.0.0.0'): string {
    this.xml.domain.devices[0].graphics = this.xml.domain.devices[0].graphics || [];
    // Check if a VNC configuration already exists
    const existingVNC = this.xml.domain.devices[0].graphics?.find((g: any) => g.$.type === 'vnc');

    // Generate a random password
    const password = Math.random().toString(36).slice(-8);

    if (existingVNC) {
      // Modify the existing VNC configuration
      existingVNC.$.port = String(port);
      existingVNC.$.autoport = autoport ? 'yes' : 'no';
      existingVNC.$.listen = listen;
      existingVNC.$.passwd = password;
    } else {
      // Add a new VNC configuration
      const graphics = {
        $: { type: 'vnc', port: String(port), autoport: autoport ? 'yes' : 'no', listen: listen, passwd: password },
      };
      this.xml.domain.devices[0].graphics = this.xml.domain.devices[0].graphics || [];
      this.xml.domain.devices[0].graphics.push(graphics);
    }

    // Return the generated password
    return password;
  }

  setBootOrder(devices: string[]): void {
    this.xml.domain.os[0].boot = devices.map(device => ({ $: { dev: device } }));
  }

  generate(): string {
    // Convert the JSON object to XML
    const builder = new xml2js.Builder();
    return builder.buildObject(this.xml);
  }

  /**
   * Get the next available bus for a device
   * @param dev The device to get the next bus for
   *
   * Example:
   * Lest suppose that the xml has sda, sdb and vda
   * getNextBus('sd') -> 'sdc'
   * getNextBus('vd') -> 'vdb'
   * getNextBus('hd') -> 'hda'
   */
  protected getNextBus(dev: string): string {
    // Get all devices
    const devices = this.xml.domain.devices[0].disk || [];

    // Filter devices that use the same bus type
    const sameBusDevices = devices.filter((device: any) => device.target[0].$.dev.startsWith(dev));

    // If no devices are using the bus, return the first one
    if (sameBusDevices.length === 0) {
      return dev + 'a';
    }

    // Sort devices alphabetically
    sameBusDevices.sort((a: any, b: any) => a.target[0].$.dev.localeCompare(b.target[0].$.dev));

    // Get the last device in the sorted list
    const lastDevice = sameBusDevices[sameBusDevices.length - 1];

    // Get the last character of the last device and increment it
    const lastChar = lastDevice.target[0].$.dev.slice(-1);
    const incrementedChar = String.fromCharCode(lastChar.charCodeAt(0) + 1);

    // Return the next bus
    return dev + incrementedChar;
  }

  getStoragePath(): string {
    const diskPath = path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'disks') || '/opt/infinibay/disks';
    return path.join(diskPath, `${this.id}.img`);
  }

  getUefiVarFile(): string {
    return this.xml?.domain?.os?.[0]?.nvram?.[0]?._ as string
  }

  getDisks(): string[] {
    return this.xml?.domain?.devices?.[0]?.disk?.map((disk: any) => disk.source[0].$.file) || []
  }

  // Enable high resolution graphics for the VM
  enableHighResolutionGraphics(vramSize: number = 512, driver: string = 'virtio'): void {
    // Ensure the video array exists
    this.xml.domain.devices[0].video = this.xml.domain.devices[0].video || [];

    // Configure the video device with QXL model and increased VRAM
    const videoDevice = driver === 'qxl' ? {
      model: [
        {
          $: {
            type: 'qxl',
            ram: String(vramSize * 2 * 1024),  // RAM: Twice the VRAM for caching
            vram: String(vramSize * 1024),    // Video RAM
            vgamem: String((vramSize * 1024) / 2), // VGA memory (optional)
          },
        },
      ],
      accel: [
        {
          $: {
            accel3d: 'yes', // Enable 3D acceleration
            accel2d: 'yes', // Enable 2D acceleration
          },
        },
      ],
    } : { // virtio virgl3d
      model: [
        {
          $: {
            type: 'virtio',
            accel3d: 'yes',
          },
          gl: {
            $: {
              rendernode: '/dev/dri/renderD128', // TODO detect the rendernode, right now is hardcoded
            },
          }
        },
      ],
    };

    // Add or update the video device configuration
    this.xml.domain.devices[0].video = [videoDevice];
  }

  // Enable USB tablet input device
  // Improves mouse input in the guest OS, especially the synchronization between the host and guest cursor.
  enableInputTablet(): void {
    // Ensure the input array exists
    this.xml.domain.devices[0].input = this.xml.domain.devices[0].input || [];
    // Add USB tablet input device
    const inputDevice = {
      $: {
        type: 'tablet',
        bus: 'usb',
      },
    };
    this.xml.domain.devices[0].input.push(inputDevice);
  }

  addGuestAgentChannel(): void {
    // Ensure the channel array exists
    this.xml.domain.devices[0].channel = this.xml.domain.devices[0].channel || [];
    // Add QEMU Guest Agent virtio channel
    const channelDevice = {
      $: {
        type: 'unix',
      },
      address: [
        {
          $: {
            type: 'virtio-serial',
            mode: 'virtio-serial',
            controller: '0',
            bus: '0',
            port: '1',
          },
        },
      ],
      target: [
        {
          $: {
            type: 'virtio',
            name: `org.qemu.guest_agent.0`,
          },
        },
      ],
    };
    this.xml.domain.devices[0].channel.push(channelDevice);
  }

  // UNUSED UNTESTED
  addGpu(pciAddress: string): void {
    this.xml.domain.devices[0].hostdev = this.xml.domain.devices[0].hostdev || [];
    const gpu = {
      $: { mode: 'subsystem', type: 'pci', managed: 'yes' },
      source: [{ address: [{ $: { domain: '0x0000', bus: pciAddress.split(':')[0], slot: pciAddress.split(':')[1], function: pciAddress.split('.')[1] } }] }],
    };
    this.xml.domain.devices[0].hostdev.push(gpu);
  }

  addAudioDevice(): void {
    this.xml.domain.devices[0].sound = this.xml.domain.devices[0].sound || [];
    const audioDevice = {
      $: { model: 'ich9' },
    };
    this.xml.domain.devices[0].sound.push(audioDevice);
  }

  disablePowerManagement(): void {
    this.xml.domain.pm = {
      "suspend-to-mem": { $: { enabled: "no" } },
      "suspend-to-disk": { $: { enabled: "no" } },
    };
  }

  getCpuInfo() {
    const cpus = os.cpus();
    const physicalCores = new Set();
    cpus.forEach(cpu => {
      const coreId = cpu.model + cpu.times.user; // Model + user time (to differentiate cores)
      physicalCores.add(coreId);
    });

    const numCores = physicalCores.size;
    const numThreads = cpus.length;

    return { numCores, numThreads };
  }

  /**
  * Detect and apply the best CPU pinning strategy.
  * Attempts NUMA optimization first, falls back to round-robin if NUMA isn't possible.
  * 
  * Why it matters:
  * - NUMA-aware CPU pinning ensures vCPUs are pinned to physical CPUs
  *   within the same NUMA node, reducing latency and improving memory
  *   locality for workloads. 
  * - Round-robin pinning ensures that even when NUMA optimization isn't
  *   possible, vCPUs are evenly distributed across all available CPUs.
  */
  setCpuPinningOptimization(vcpuCount: number): void {
    const numaTopology = this.getNumaTopology();

    if (this.canOptimizeNumaPinning(vcpuCount, numaTopology)) {
      this.optimizeNumaPinning(vcpuCount, numaTopology);
    } else {
      this.optimizeRoundRobinPinning(vcpuCount, numaTopology);
    }
  }

  /**
   * Check if NUMA optimization is possible for the given vCPU count.
   * 
   * Why it matters:
   * - This ensures that NUMA optimization is only attempted when there are
   *   enough CPUs across NUMA nodes to accommodate the VM's requested vCPUs.
   * - Prevents unnecessary fallback to round-robin by checking resources upfront.
   */
  private canOptimizeNumaPinning(vcpuCount: number, numaTopology: { [key: string]: string[] }): boolean {
    const availableCpus = Object.values(numaTopology).flat();
    return vcpuCount <= availableCpus.length;
  }

  /**
   * Optimize CPU pinning using NUMA topology.
   * 
   * Why it matters:
   * - Assigns vCPUs to CPUs within the same NUMA node to minimize latency and
   *   improve memory locality, which is critical for performance-sensitive workloads.
   * - Adds NUMA configuration to the XML for memory alignment and topology awareness.
   */
  private optimizeNumaPinning(vcpuCount: number, numaTopology: { [key: string]: string[] }): void {
    const vcpuPins: { vcpu: number; cpuset: string }[] = [];
    let vcpuIndex = 0;

    for (const node of Object.keys(numaTopology)) {
      const cpus = numaTopology[node];
      for (const cpu of cpus) {
        if (vcpuIndex < vcpuCount) {
          vcpuPins.push({ vcpu: vcpuIndex, cpuset: cpu });
          vcpuIndex++;
        }
      }
    }

    this.addCpuPinningToXml(vcpuPins);
    this.addNumaConfigurationToXml(numaTopology, vcpuCount); // Pass vCPU count here
  }

  /**
   * Fallback to round-robin CPU pinning if NUMA optimization isn't possible.
   * 
   * Why it matters:
   * - Ensures the VM can still operate with reasonable CPU pinning
   *   even when NUMA optimization isn't feasible.
   * - Distributes vCPUs evenly across all available physical CPUs
   *   to balance the load and avoid hotspots.
   */
  private optimizeRoundRobinPinning(vcpuCount: number, numaTopology: { [key: string]: string[] }): void {
    const allCpus = Object.values(numaTopology).flat();
    const totalCpus = allCpus.length;

    const vcpuPins = Array.from({ length: vcpuCount }, (_, vcpuIndex) => ({
      vcpu: vcpuIndex,
      cpuset: allCpus[vcpuIndex % totalCpus], // Round-robin across all available CPUs
    }));

    this.addCpuPinningToXml(vcpuPins);
  }

  /**
   * Add CPU pinning configuration to the XML.
   * 
   * Why it matters:
   * - Ensures that vCPUs are pinned to specific physical CPUs as per the selected
   *   optimization strategy, which improves performance and reduces contention.
   */
  private addCpuPinningToXml(vcpuPins: { vcpu: number; cpuset: string }[]): void {
    this.xml.domain.cputune = {
      vcpupin: vcpuPins.map(pin => ({ $: { vcpu: String(pin.vcpu), cpuset: pin.cpuset } })),
    };
  }

  /**
   * Add NUMA configuration to the XML.
   * 
   * Why it matters:
   * - Aligns VM memory with NUMA nodes to ensure memory locality, reducing latency.
   * - Proportionally allocates memory across NUMA nodes to match the host's topology.
   * - Optimizes performance for NUMA-aware workloads such as databases and HPC applications.
   */
  private addNumaConfigurationToXml(numaTopology: { [key: string]: string[] }, vcpuCount: number): void {
    const hostNumaMemory = this.getHostNumaMemory();
    const totalHostMemory = Object.values(hostNumaMemory).reduce((acc, mem) => acc + mem, 0);
    const vmMemory = this.getVmMemory();

    if (vmMemory > totalHostMemory) {
      throw new Error(`Requested VM memory (${vmMemory} MiB) exceeds host total memory (${totalHostMemory} MiB).`);
    }

    let remainingVCPUs = vcpuCount; // Track remaining vCPUs to assign
    let remainingMemory = vmMemory; // Track remaining memory to distribute
    let currentVcpuIndex = 0; // Track the current vCPU index

    const activeNumaNodes = Object.keys(numaTopology).map((node, index) => {
      const nodeCpus = numaTopology[node];
      const assignedVCPUs = nodeCpus.slice(0, Math.min(nodeCpus.length, remainingVCPUs)); // Limit vCPUs to remaining
      remainingVCPUs -= assignedVCPUs.length;

      if (assignedVCPUs.length === 0) {
        return null; // Skip this NUMA node if no vCPUs assigned
      }

      // Map vCPU indices to the assigned CPUs
      const vcpuMapping = assignedVCPUs.map(() => currentVcpuIndex++);

      // Allocate memory proportional to the assigned vCPUs
      const nodeMemory = Math.floor((vcpuMapping.length / vcpuCount) * vmMemory);
      remainingMemory -= nodeMemory;

      return {
        id: index,
        cpus: vcpuMapping.join(','),
        memory: nodeMemory,
      };
    }).filter(Boolean); // Remove null entries

    // Assign any remaining memory to the last NUMA node
    if (activeNumaNodes.length > 0) {
      const lastNode = activeNumaNodes[activeNumaNodes.length - 1];
      if (lastNode) {
        lastNode.memory += remainingMemory; // Ensure no memory is left unallocated
      }
    }

    // Build the NUMA cells for the XML
    const numaCells = activeNumaNodes.map(node => ({
      $: {
        id: String(node?.id),
        cpus: node?.cpus,
        memory: String(node?.memory),
        unit: 'MiB',
      },
    }));

    this.xml.domain.cpu = this.xml.domain.cpu || {};
    this.xml.domain.cpu.numa = { cell: numaCells };
  }

  /**
   * Detects memory available for each NUMA node on the host.
   * 
   * Why it matters:
   * - Provides data needed to proportionally allocate VM memory across NUMA nodes.
   * - Ensures that the VM's memory allocation matches the host's memory topology.
   */
  private getHostNumaMemory(): { [key: string]: number } {
    const nodesDir = '/sys/devices/system/node/';
    const nodeDirs = fs.readdirSync(nodesDir).filter(dir => dir.startsWith('node'));
    const numaMemory: { [key: string]: number } = {};

    nodeDirs.forEach(nodeDir => {
      const meminfoPath = path.join(nodesDir, nodeDir, 'meminfo');
      if (fs.existsSync(meminfoPath)) {
        const meminfo = fs.readFileSync(meminfoPath, 'utf8');
        const matched = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
        if (matched) {
          const memoryInMiB = Math.floor(Number(matched[1]) / 1024); // Convert from kB to MiB
          numaMemory[nodeDir] = memoryInMiB;
        }
      }
    });

    return numaMemory;
  }

  /**
   * Returns the total memory assigned to the VM in MiB.
   * 
   * Why it matters:
   * - Ensures the memory requested for the VM fits within the host's available resources.
   * - Provides the basis for proportionally allocating memory across NUMA nodes.
   */
  private getVmMemory(): number {
    const memoryNode = this.xml.domain.memory;
    if (memoryNode && memoryNode[0]._ && memoryNode[0].$.unit === 'KiB') {
      return Math.floor(Number(memoryNode[0]._) / 1024); // Convert KiB to MiB
    }
    throw new Error('VM memory is not set or improperly configured.');
  }

  /**
   * Get the NUMA topology of the host.
   * 
   * Why it matters:
   * - Provides information about CPUs in each NUMA node for optimized pinning.
   * - Forms the foundation for NUMA-aware resource allocation.
   */
  private getNumaTopology(): { [key: string]: string[] } {
    const nodesDir = '/sys/devices/system/node/';
    const nodeDirs = fs.readdirSync(nodesDir).filter(dir => dir.startsWith('node'));
    const numaTopology: { [key: string]: string[] } = {};

    nodeDirs.forEach(nodeDir => {
      const cpuListPath = path.join(nodesDir, nodeDir, 'cpulist');
      if (fs.existsSync(cpuListPath)) {
        const cpuList = fs.readFileSync(cpuListPath, 'utf8').trim();
        numaTopology[nodeDir] = this.expandCpuList(cpuList);
      }
    });

    return numaTopology;
  }

  /**
   * Expand CPU ranges (e.g., "0-3,8" → ["0", "1", "2", "3", "8"]).
   * 
   * Why it matters:
   * - Simplifies the NUMA topology representation for easier processing.
   */
  private expandCpuList(cpuList: string): string[] {
    return cpuList.split(',').flatMap(range => {
      const [start, end] = range.split('-').map(Number);
      return end !== undefined
        ? Array.from({ length: end - start + 1 }, (_, i) => String(start + i))
        : [String(start)];
    });
  }

  addSPICE(enableAudio: boolean = true, enableOpenGL: boolean = true): string {
    // Generate a random password for SPICE
    const password = Math.random().toString(36).slice(-8); // 8-character random password

    // Ensure the devices array exists
    this.xml.domain.devices[0].graphics = [];

    // Build SPICE configuration
    const spiceConfig: any = {
      $: {
        type: 'spice',
        autoport: 'yes',
        listen: '0.0.0.0', // Listen on all interfaces
        passwd: password, // Set the random password
      },
      listen: [
        { $: { type: 'address', address: '0.0.0.0' } },
      ],
      image: [
        { $: { compression: 'auto_glz' } }, // Auto image compression for low bandwidth
      ],
      jpeg: [
        { $: { compression: 'auto' } }, // Enable JPEG compression
      ],
      zlib: [
        { $: { compression: 'auto' } }, // Enable Zlib compression
      ],
      video: [
        { $: { streaming: 'all' } }, // Optimize video streaming
      ],
      clipboard: [
        { $: { copypaste: 'yes' } }, // Enable clipboard sharing
      ],
      filetransfer: [
        { $: { enable: 'yes' } }, // Enable file transfer
      ],
      mouse: [
        { $: { mode: 'client' } }, // Mouse handling
      ],
      streaming: [
        { $: { mode: 'filter' } }, // Adaptive streaming
      ],
    };

    // Enable OpenGL acceleration if required
    if (enableOpenGL) {
      spiceConfig.gl = [
        { $: { enable: 'yes', rendernode: '/dev/dri/renderD128' } },
      ];
    }

    // Add SPICE graphics configuration
    this.xml.domain.devices[0].graphics.push(spiceConfig);

    // Add audio redirection via SPICE channel
    if (enableAudio) {
      this.xml.domain.devices[0].channel = this.xml.domain.devices[0].channel || [];
      this.xml.domain.devices[0].channel.push({
        $: {
          type: 'spicevmc', // Required for SPICE audio redirection
        },
        target: [
          { $: { type: 'virtio', name: 'com.redhat.spice.0' } },
        ],
      });
    }

    // Return the generated password for the caller
    return password;
  }

}
