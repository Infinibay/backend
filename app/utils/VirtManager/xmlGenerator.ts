import xml2js from 'xml2js';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { BaseCpuPinningStrategy } from './CpuPinning/BasePinningStrategy';
import { BasicStrategy } from './CpuPinning/BasicStrategy';
import { HybridRandomStrategy } from './CpuPinning/HybridRandom';

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
    this.xml.domain.vcpu = [{ _: count, $: { placement: 'static', current: count } }];
    this.xml.domain.cpu = {
      $: {
        mode: 'host-passthrough',
        check: 'none',
        migratable: 'on',
      },
    };

    // Add hypervisor features and clock settings
    this.xml.domain.features = this.xml.domain.features || [{}];
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
    };

    this.xml.domain.pm = {
      "suspend-to-mem": { $: { enabled: "no" } },
      "suspend-to-disk": { $: { enabled: "no" } }
    };
  }

  setCpuPinningOptimization(strategy?: BaseCpuPinningStrategy): void {
    const vcpuCount = Number(this.xml.domain.vcpu[0]._);

    if (!strategy) {
      strategy = new HybridRandomStrategy(this.xml);
    }

    const pinningConfig = strategy.setCpuPinning(vcpuCount);

    // Apply the configuration to the XML
    if (pinningConfig.cputune) {
      this.xml.domain.cputune = pinningConfig.cputune;
    }
    if (pinningConfig.cpu) {
      this.xml.domain.cpu = {
        ...this.xml.domain.cpu,
        ...pinningConfig.cpu
      };
    }
  }

  // Renamed method: setBootDevice -> setBootOrder
  setBootOrder(devices: ('fd' | 'hd' | 'cdrom' | 'network')[]): void {
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

  setBootDevice(devices: string[]): void {
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
  enableHighResolutionGraphics(vramSize: number = 512, driver: string = 'qxl'): void {
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
    } : {
      // virtio virgl3d
      // Works, but performance is not the best
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


  /*
  * Add GPU passthrough
  * @param pciBus - The PCI bus address of the GPU in the format `0000:B4:00.0`
  * @returns {void}
  */
  addGPUPassthrough(
    pciBus: string
  ): void {
    this.xml.domain.devices[0].hostdev = this.xml.domain.devices[0].hostdev || [];
  
    // Parse PCI address from `pciBus` (e.g., 00000000:B4:00.0)
    const [domain, bus, slotFunction] = pciBus.split(':');
    const [slot, func] = slotFunction.split('.');
  
    // Construct passthrough configuration
    const gpuPassthrough = {
      $: { mode: 'subsystem', type: 'pci', managed: 'yes' },
      source: [
        {
          address: [
            {
              $: {
                domain: `0x${domain}`,
                bus: `0x${bus}`,
                slot: `0x${slot}`,
                function: func,
              },
            },
          ],
        },
      ],
    };
  
    this.xml.domain.devices[0].hostdev.push(gpuPassthrough);
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
        { $: { mode: 'server' } }, // client cause problems with gpu drivers
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
