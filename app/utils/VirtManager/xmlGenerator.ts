import xml2js from 'xml2js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
export enum NetworkModel {
  VIRTIO = 'virtio',
  E1000 = 'e1000',
}

export class XMLGenerator {
  private xml: any;
  private id: string;
  private os: string;

  constructor(name: string, id: string, os: string) {
    this.xml = { domain: { $: { type: 'kvm' }, name: [name], devices: [{ controller: [{ $: { type: 'sata', index: '0' } }] }] } };
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
  }

  setVCPUs(count: number): void {
    // this.xml.domain.vcpu = [{ _: count, $: { placement: 'static', current: count } }];
    // this.xml.domain.cpu = [{ model: [{ _: 'host-model', $: { mode: 'custom', match: 'exact' } }], topology: [{ $: { sockets: '1', cores: count.toString(), threads: '1' } }] }];
    this.xml.domain.vcpu = [{ _: count, $: { placement: 'static', current: count } }];
    this.xml.domain.cpu = [{
      mode: 'host-model',
      model: { $: { fallback: 'allow' } },
      // model: [{ _: 'kvm64', $: { mode: 'custom', match: 'exact' } }],
      topology: [{ $: { sockets: '1', cores: count.toString(), threads: '1' } }],
      // feature: [
      //   // fpu: Floating Point Unit, fundamental for any modern processor. Introduced in 1985.
      //   { $: { name: 'fpu', policy: 'require' } },
      //   // vme: Virtual 8086 Mode Enhancements, commonly supported. Introduced in 1985.
      //   { $: { name: 'vme', policy: 'require' } },
      //   // de: Debugging Extensions. Introduced in 1990.
      //   { $: { name: 'de', policy: 'require' } },
      //   // pse: Page Size Extensions, for larger pages in memory management. Introduced in 1995.
      //   { $: { name: 'pse', policy: 'require' } },
      //   // tsc: Time Stamp Counter, for timing and performance monitoring. Introduced in 1995.
      //   { $: { name: 'tsc', policy: 'require' } },
      //   // msr: Model-Specific Registers, used for various control and configuration settings. Introduced in 1995.
      //   { $: { name: 'msr', policy: 'require' } },
      //   // pae: Physical Address Extension, for accessing more than 4 GB of RAM. Introduced in 1995.
      //   { $: { name: 'pae', policy: 'require' } },
      //   // mce: Machine Check Exception, for error detection and handling. Introduced in 1995.
      //   { $: { name: 'mce', policy: 'require' } },
      //   // cx8: CMPXCHG8 instruction, for atomic operations on 64-bit data. Introduced in 1995.
      //   { $: { name: 'cx8', policy: 'require' } },
      //   // apic: Advanced Programmable Interrupt Controller, for handling interrupts. Introduced in 1995.
      //   { $: { name: 'apic', policy: 'require' } },
      //   // sep: SYSENTER and SYSEXIT instructions, for efficient transitions between user and kernel modes. Introduced in 1997.
      //   { $: { name: 'sep', policy: 'require' } },
      //   // mtrr: Memory Type Range Registers, for memory type and caching control. Introduced in 1997.
      //   { $: { name: 'mtrr', policy: 'require' } },
      //   // pge: Page Global Enable, for global page mapping in TLB. Introduced in 1997.
      //   { $: { name: 'pge', policy: 'require' } },
      //   // cmov: Conditional Move Instructions, for efficient conditional operations. Introduced in 1997.
      //   { $: { name: 'cmov', policy: 'require' } },
      //   // pat: Page Attribute Table, for fine-grained control of memory caching. Introduced in 1997.
      //   { $: { name: 'pat', policy: 'require' } },
      //   // clflush: Cache Line Flush instruction, used for cache control. Introduced in 1999.
      //   { $: { name: 'clflush', policy: 'require' } },
      //   // mmx: MultiMedia Extensions, for SIMD operations. Introduced in 1997.
      //   { $: { name: 'mmx', policy: 'require' } },
      //   // fxsr: FXSAVE and FXRSTOR instructions, for saving and restoring FPU context. Introduced in 1999.
      //   { $: { name: 'fxsr', policy: 'require' } },
      //   // sse: Streaming SIMD Extensions, for SIMD operations. Introduced in 1999.
      //   { $: { name: 'sse', policy: 'require' } },
      //   // sse2: Streaming SIMD Extensions 2, further SIMD enhancements. Introduced in 2001.
      //   { $: { name: 'sse2', policy: 'require' } },
      //   // sse3: Streaming SIMD Extensions 3. Introduced in 2004.
      //   { $: { name: 'sse3', policy: 'require' } },
      //   // ssse3: Supplemental Streaming SIMD Extensions 3, for enhanced SIMD capabilities. Introduced in 2006.
      //   { $: { name: 'ssse3', policy: 'require' } },
      //   // sse4.1: Streaming SIMD Extensions 4.1. Introduced in 2007.
      //   { $: { name: 'sse4.1', policy: 'require' } },
      //   // sse4.2: Streaming SIMD Extensions 4.2. Introduced in 2008.
      //   { $: { name: 'sse4.2', policy: 'require' } },
      //   // popcnt: POPCNT instruction, supported by most modern CPUs. Introduced in 2008.
      //   { $: { name: 'popcnt', policy: 'require' } },
      //   // aes: Advanced Encryption Standard New Instructions, common in CPUs post-2010. Introduced in 2010.
      //   { $: { name: 'aes', policy: 'require' } }, // commented because cause issues in fedora 39
      //   // avx: Advanced Vector Extensions, common in CPUs post-2011. Introduced in 2011.
      //   { $: { name: 'avx', policy: 'require' } },
      //   // hypervisor: Indicates that the code is running on a hypervisor. Introduced in 2005.
      //   { $: { name: 'hypervisor', policy: 'require' } },
      //   // Add more features as needed
      // ],
    }];
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
        // encryption: [{ $: { secret: secretUUID } }]
      }]
    }];
  }

  enableFeatures(): void {
    if (!this.xml.domain.features) {
      this.xml.domain.features = [{}];
    }
    this.xml.domain.features[0].acpi = [{}]; // Advanced Configuration and Power Interface, for power management.
    this.xml.domain.features[0].apic = [{}]; // Advanced Programmable Interrupt Controller, for better handling of system interrupts.
    this.xml.domain.features[0].pae = [{}];  // Physical Address Extension, allows 32-bit CPUs to use more than 4 GB of memory.
    this.xml.domain.features[0].hap = [{}];  // Hardware Assisted Paging, also known as Extended Page Tables (EPT) or Nested Page Tables (NPT), improves performance of address translations.
    // this.xml.domain.features[0].viridian = [{}]; // Viridian enlightenments, improves performance and compatibility on Hyper-V.
    this.xml.domain.features[0].privnet = [{}]; // Private network, improves network performance by avoiding MAC address conflicts.
    this.xml.domain.features[0].kvm = [{ "hint-dedicated": { $: { state: 'on' } } }]; // KVM features for performance improvement.
    this.xml.domain.features[0].pvspinlock = [{ $: { state: 'on' } }]; // Paravirtualized spinlock, for improved performance in certain scenarios.
  }

  setUEFI(): void {
    this.enableFeatures();
    let efiPath: string
    let nvramPath: string

    // Check for OVMF files in different possible locations
    const possibleEfiPaths = [
      '/usr/share/OVMF/OVMF_CODE.fd',
      '/usr/share/OVMF/OVMF_CODE_4M.fd',
      '/usr/share/edk2/ovmf/OVMF_CODE.fd',
      '/usr/share/qemu/OVMF_CODE.fd'
    ];

    efiPath = possibleEfiPaths.find(p => fs.existsSync(p)) || '';

    if (!efiPath) {
      throw new Error('UEFI firmware file (OVMF_CODE.fd or OVMF_CODE_4M.fd) not found. Please install OVMF package.');
    }

    nvramPath = path.join(process.env.INFINIBAY_BASE_DIR ?? '/opt/infinibay', 'uefi', `${this.id}_VARS.fd`);
    this.xml.domain.os[0].loader = [{ _: efiPath, $: { readonly: 'yes', type: 'pflash' } }];
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

    const disk = {
      $: { type: 'file', device: 'disk' },
      driver: [{ $: { name: 'qemu', type: 'qcow2' } }],
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
      model: [{ $: { type: model } }],
    };

    this.xml.domain.devices[0].interface = this.xml.domain.devices[0].interface || [];
    this.xml.domain.devices[0].interface.push(networkInterface);
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
}

