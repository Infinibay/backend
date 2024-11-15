import fs from 'fs';
import path from 'path';

export interface CpuPinningConfig {
  cputune?: {
    vcpupin: Array<{
      $: {  // Note the $ structure required by xml2js
        vcpu: string;
        cpuset: string;
      }
    }>;
  };
  cpu?: {
    numa?: {
      cell: any[];
    };
  };
}

export abstract class BaseCpuPinningStrategy {
  protected xml: any;

  constructor(xml: any) {
    this.xml = xml;
  }

  protected getVmMemory(): number {
    const memoryNode = this.xml.domain.memory;
    if (memoryNode && memoryNode[0]._ && memoryNode[0].$.unit === 'KiB') {
      return Math.floor(Number(memoryNode[0]._) / 1024); // Convert KiB to MiB
    }
    throw new Error('VM memory is not set or improperly configured.');
  }

  protected getHostNumaMemory(): { [key: string]: number } {
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

  protected getNumaTopology(): { [key: string]: string[] } {
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

  protected expandCpuList(cpuList: string): string[] {
    return cpuList.split(',').flatMap(range => {
      const [startStr, endStr] = range.split('-');
      const start = parseInt(startStr, 10);
      const end = endStr !== undefined ? parseInt(endStr, 10) : start;

      return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
    });
  }

  protected createCpuPinningConfig(vcpuPins: { vcpu: number; cpuset: string }[]): CpuPinningConfig {
    return {
      cputune: {
        vcpupin: vcpuPins.map(pin => ({
          $: {  // Add the $ structure here
            vcpu: String(pin.vcpu),
            cpuset: pin.cpuset
          }
        })),
      }
    };
  }

  protected addNumaToConfig(config: CpuPinningConfig, numaCells: any[]): CpuPinningConfig {
    return {
      ...config,
      cpu: {
        numa: { cell: numaCells }
      }
    };
  }

  abstract setCpuPinning(vcpuCount: number): CpuPinningConfig;
}