import xml2js from 'xml2js';

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

  setOS(os: string): void {
    this.xml.domain.os = [{ type: [os] }];
  }
    
  setStorage(size: number): void {
    const diskPath = process.env.DISK_PATH || '/var/lib/libvirt/images';
    this.addDisk(`${diskPath}/${this.id}.img`, 'vda', 'virtio', size);
  }
    
  generate(): string {
    // Convert the JSON object to XML
    const builder = new xml2js.Builder();
    return builder.buildObject(this.xml);
  }
}
