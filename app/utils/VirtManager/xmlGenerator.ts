import xml2js from 'xml2js';

export enum NetworkModel {
  VIRTIO = 'virtio',
  E1000 = 'e1000',
}

export class XMLGenerator {
  private xml: any;
  private id: string;
  
  constructor(name: string, id: string) {
    this.xml = { domain: { $: { type: 'kvm' }, name: [name], devices: [{}] } };
    this.id = id;
  }
  
  setMemory(size: number): void {
    this.xml.domain.memory = [size];
  }
  
  setVCPUs(count: number): void {
    this.xml.domain.vcpu = [count];
  }
  
  addDisk(path: string, dev: string, bus: string, size: number): void {
    const disk = {
      $: { type: 'file', device: 'disk' },
      driver: [{ $: { name: 'qemu', type: 'qcow2' } }],
      source: [{ $: { file: path } }],
      target: [{ $: { dev: dev, bus: bus } }],
      capacity: [{ _: String(size), $: { unit: 'G' } }],
    };
    this.xml.domain.devices[0].disk = this.xml.domain.devices[0].disk || [];
    this.xml.domain.devices[0].disk.push(disk);
  }

  setOS(): void {
    this.xml.domain.os = [{ type: [{ _: 'hvm', $: { arch: 'x86_64', machine: 'pc' } }] }];
  }
    
  setStorage(size: number): void {
    const diskPath = process.env.DISK_PATH || '/var/lib/libvirt/images';
    this.addDisk(`${diskPath}/${this.id}.img`, 'vda', 'virtio', size);
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

  addCDROM(path: string, dev: string = 'hdc', bus: string = 'ide'): void {
    const cdrom = {
      $: { type: 'file', device: 'cdrom' },
      driver: [{ $: { name: 'qemu', type: 'raw' } }],
      source: [{ $: { file: path } }],
      target: [{ $: { dev: dev, bus: bus } }],
      readonly: [{}],
    };
    this.xml.domain.devices[0].disk = this.xml.domain.devices[0].disk || [];
    this.xml.domain.devices[0].disk.push(cdrom);
  }

  addVNC(port: number, autoport: boolean, listen: string): void {
    this.xml.domain.devices[0].graphics = this.xml.domain.devices[0].graphics || [];
    // Check if a VNC configuration already exists
    const existingVNC = this.xml.domain.devices[0].graphics?.find((g: any) => g.$.type === 'vnc');

    if (existingVNC) {
      // Modify the existing VNC configuration
      existingVNC.$.port = String(port);
      existingVNC.$.autoport = autoport ? 'yes' : 'no';
      existingVNC.$.listen = listen;
    } else {
      // Add a new VNC configuration
      const graphics = {
        $: { type: 'vnc', port: String(port), autoport: autoport ? 'yes' : 'no', listen: listen },
      };
      this.xml.domain.devices[0].graphics = this.xml.domain.devices[0].graphics || [];
      this.xml.domain.devices[0].graphics.push(graphics);
    }
  }

  setBootOrder(devices: string[]): void {
    this.xml.domain.os[0].boot = devices.map(device => ({ $: { dev: device } }));
  }
  
  generate(): string {
    // Convert the JSON object to XML
    const builder = new xml2js.Builder();
    return builder.buildObject(this.xml);
  }
}

