import { BaseCpuPinningStrategy, CpuPinningConfig } from './BasePinningStrategy';

export class BasicStrategy extends BaseCpuPinningStrategy {
  setCpuPinning(vcpuCount: number): CpuPinningConfig {
    const numaTopology = this.getNumaTopology();

    if (this.canOptimizeNumaPinning(vcpuCount, numaTopology)) {
      return this.optimizeNumaPinning(vcpuCount, numaTopology);
    } else {
      return this.optimizeRoundRobinPinning(vcpuCount, numaTopology);
    }
  }

  private canOptimizeNumaPinning(vcpuCount: number, numaTopology: { [key: string]: string[] }): boolean {
    const availableCpus = Object.values(numaTopology).flat();
    return vcpuCount <= availableCpus.length;
  }

  private optimizeNumaPinning(vcpuCount: number, numaTopology: { [key: string]: string[] }): CpuPinningConfig {
    const vcpuPins: { vcpu: number; cpuset: string }[] = [];
    let vcpuIndex = 0;

    for (const node of Object.keys(numaTopology)) {
      const cpus = numaTopology[node];
      for (const cpu of cpus) {
        if (vcpuIndex < vcpuCount) {
          vcpuPins.push({ vcpu: vcpuIndex, cpuset: cpu });
          vcpuIndex++;
        } else {
          break;
        }
      }
      if (vcpuIndex >= vcpuCount) {
        break;
      }
    }

    const config = this.createCpuPinningConfig(vcpuPins);
    const numaCells = this.generateNumaCells(vcpuCount, numaTopology);

    return this.addNumaToConfig(config, numaCells);
  }

  private optimizeRoundRobinPinning(vcpuCount: number, numaTopology: { [key: string]: string[] }): CpuPinningConfig {
    const allCpus = Object.values(numaTopology).flat();
    const totalCpus = allCpus.length;

    const vcpuPins = Array.from({ length: vcpuCount }, (_, vcpuIndex) => ({
      vcpu: vcpuIndex,
      cpuset: allCpus[vcpuIndex % totalCpus],
    }));

    return this.createCpuPinningConfig(vcpuPins);
  }

  private generateNumaCells(vcpuCount: number, numaTopology: { [key: string]: string[] }): any[] {
    const hostNumaMemory = this.getHostNumaMemory();
    const totalHostMemory = Object.values(hostNumaMemory).reduce((acc, mem) => acc + mem, 0);
    const vmMemory = this.getVmMemory();

    if (vmMemory > totalHostMemory) {
      throw new Error(`Requested VM memory (${vmMemory} MiB) exceeds host total memory (${totalHostMemory} MiB).`);
    }

    let remainingVCPUs = vcpuCount;
    let remainingMemory = vmMemory;
    let currentVcpuIndex = 0;

    const activeNumaNodes = Object.keys(numaTopology).map((node, index) => {
      const nodeCpus = numaTopology[node];
      const assignedVCPUs = nodeCpus.slice(0, Math.min(nodeCpus.length, remainingVCPUs));
      remainingVCPUs -= assignedVCPUs.length;

      if (assignedVCPUs.length === 0) {
        return null;
      }

      const vcpuMapping = assignedVCPUs.map(() => currentVcpuIndex++);
      const nodeMemory = Math.floor((vcpuMapping.length / vcpuCount) * vmMemory);
      remainingMemory -= nodeMemory;

      return {
        id: index,
        cpus: vcpuMapping.join(','),
        memory: nodeMemory,
      };
    }).filter(Boolean) as { id: number; cpus: string; memory: number }[];

    if (activeNumaNodes.length > 0 && remainingMemory > 0) {
      activeNumaNodes[activeNumaNodes.length - 1].memory += remainingMemory;
    }

    return activeNumaNodes.map(node => ({
      $: {
        id: String(node.id),
        cpus: node.cpus,
        memory: String(node.memory),
        unit: 'MiB',
      },
    }));
  }
}