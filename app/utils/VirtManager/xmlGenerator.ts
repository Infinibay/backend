import xml2js from 'xml2js';
import { v4 as uuidv4 } from 'uuid';

export enum NetworkModel {
  VIRTIO = 'virtio',
  E1000 = 'e1000',
}

export class XMLGenerator {
  private xml: any;
  private id: string;
  
  constructor(name: string, id: string) {
    this.xml = { domain: { $: { type: 'kvm' }, name: [name], devices: [{ controller: [{ $: { type: 'sata', index: '0' } }] }] } };
    this.xml.domain.os = [{ type: [{ _: 'hvm', $: { arch: 'x86_64', machine: 'pc' } }] }];
    this.id = id;
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
      model: [{ _: 'host-model', $: { mode: 'custom', match: 'exact' } }],
      topology: [{ $: { sockets: '1', cores: count.toString(), threads: '1' } }],
      feature: [
        // APIC (Advanced Programmable Interrupt Controller) - Introduced in 1995
        { $: { name: 'apic', policy: 'require' } },
        // PAE (Physical Address Extension) - Introduced in 1995
        { $: { name: 'pae', policy: 'require' } },
        // HT (Hyper-Threading) - Introduced in 2002
        { $: { name: 'ht', policy: 'require' } },
        // AES (Advanced Encryption Standard New Instructions) - Introduced in 2008
        { $: { name: 'aes', policy: 'require' } },
        // AVX (Advanced Vector Extensions) - Introduced in 2011
        { $: { name: 'avx', policy: 'require' } },
        // SSE (Streaming SIMD Extensions) - Introduced in 1999
        { $: { name: 'sse', policy: 'require' } },
        // SSE2 (Streaming SIMD Extensions 2) - Introduced in 2001
        { $: { name: 'sse2', policy: 'require' } },
        // SSE3 (Streaming SIMD Extensions 3) - Introduced in 2004
        { $: { name: 'sse3', policy: 'require' } },
        // SSSE3 (Supplemental Streaming SIMD Extensions 3) - Introduced in 2006
        { $: { name: 'ssse3', policy: 'require' } },
        // SSE4.1 (Streaming SIMD Extensions 4.1) - Introduced in 2006
        { $: { name: 'sse4.1', policy: 'require' } },
        // SSE4.2 (Streaming SIMD Extensions 4.2) - Introduced in 2008
        { $: { name: 'sse4.2', policy: 'require' } },
        // CX16 (CMPXCHG16B instruction) - Introduced in 2006
        { $: { name: 'cx16', policy: 'require' } },
        // NX (No eXecute) - Introduced in 2004
        { $: { name: 'nx', policy: 'require' } },
        // MMX (MultiMedia eXtensions) - Introduced in 1996
        { $: { name: 'mmx', policy: 'require' } },
        // FPU (Floating Point Unit) - Introduced in 1985
        { $: { name: 'fpu', policy: 'require' } },
        // DE (Debugging Extensions) - Introduced in 1990
        { $: { name: 'de', policy: 'require' } },
        // TSC (Time Stamp Counter) - Introduced in 1995
        { $: { name: 'tsc', policy: 'require' } },
        // MSR (Model Specific Registers) - Introduced in 1993
        { $: { name: 'msr', policy: 'require' } },
        // MCE (Machine Check Exception) - Introduced in 1995
        { $: { name: 'mce', policy: 'require' } },
        // PAT (Page Attribute Table) - Introduced in 1996
        { $: { name: 'pat', policy: 'require' } },
        // PSE (Page Size Extensions) - Introduced in 1995
        { $: { name: 'pse', policy: 'require' } },
        // PSE-36 (36-bit Page Size Extension) - Introduced in 1996
        { $: { name: 'pse36', policy: 'require' } },
        // ACPI (Advanced Configuration and Power Interface) - Introduced in 1996
        { $: { name: 'acpi', policy: 'require' } },
        // MTRR (Memory Type Range Registers) - Introduced in 1996
        { $: { name: 'mtrr', policy: 'require' } },
        // SEP (SYSENTER and SYSEXIT instructions) - Introduced in 1996
        { $: { name: 'sep', policy: 'require' } },
        // PNI (Prescott New Instructions) - Introduced in 2004
        { $: { name: 'pni', policy: 'require' } },
        // Add more features as needed
      ],
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

  enableACPI(): void {
    if (!this.xml.domain.features) {
      this.xml.domain.features = [{}];
    }
    this.xml.domain.features[0].acpi = [{}];
  }

  setUEFI(): void {
    this.enableACPI();
    const efiPath = '/usr/share/OVMF/OVMF_CODE.fd';
    const nvramPath = `/opt/infinibay/uefi/${this.id}_VARS.fd`;
    this.xml.domain.os[0].type[0].$.machine = 'pc-q35-2.11';
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
    const diskPath = process.env.DISK_PATH || '/opt/infinibay/disks';
    this.addDisk(`${diskPath}/${this.id}.img`, 'virtio', size);
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
    const diskPath = process.env.DISK_PATH || '/opt/infinibay/disks';
    return `${diskPath}/${this.id}.img`;
  }
}

