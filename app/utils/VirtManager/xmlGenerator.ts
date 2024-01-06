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
    this.xml.domain.memory = [size];
  }
  
  setVCPUs(count: number): void {
    this.xml.domain.vcpu = [{ _: count, $: { placement: 'static', current: count } }];
    // this.xml.domain.cpu = [{ model: [{ _: 'host-model', $: { mode: 'custom', match: 'exact' } }], topology: [{ $: { sockets: '1', cores: count.toString(), threads: '1' } }] }];
  }

  setBootDevice(devices: ('fd' | 'hd' | 'cdrom' | 'network')[]): void {
    this.xml.domain.os[0].boot = devices.map(device => ({ $: { dev: device } }));
  }

  enableTPM(version: '1.2' | '2.0' = '2.0'): void {
    const secretUUID = uuidv4();
    this.xml.domain.devices[0].tpm = [{
      $: { model: 'tpm-tis' },
      backend: [{
        $: { type: 'emulator' },
        encryption: [{ $: { secret: secretUUID } }]
      }]
    }];
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
}

