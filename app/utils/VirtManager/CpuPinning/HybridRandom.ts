import { BaseCpuPinningStrategy, CpuPinningConfig } from './BasePinningStrategy';

export class HybridRandomStrategy extends BaseCpuPinningStrategy {
  /**
   * Sets the CPU pinning configuration using a hybrid random strategy.
   * This strategy shuffles the NUMA nodes and CPUs within each node to distribute vCPUs randomly.
   * @param vcpuCount The number of virtual CPUs to pin.
   * @returns The CPU pinning configuration.
   */
  setCpuPinning(vcpuCount: number): CpuPinningConfig {
    const numaTopology = this.getNumaTopology();
    const numaNodes = this.shuffleArray(Object.keys(numaTopology));
    const vcpuPins: { vcpu: number; cpuset: string }[] = [];
    let vcpuIndex = 0;

    while (vcpuIndex < vcpuCount) {
      for (const node of numaNodes) {
        const cpus = this.shuffleArray(numaTopology[node]);
        for (const cpu of cpus) {
          if (vcpuIndex >= vcpuCount) break;
          vcpuPins.push({ vcpu: vcpuIndex, cpuset: cpu });
          vcpuIndex++;
        }
        if (vcpuIndex >= vcpuCount) break;
      }
    }

    return this.createCpuPinningConfig(vcpuPins);
  }

  /**
   * Shuffles an array using the Fisher-Yates algorithm.
   * @param array The array to shuffle.
   * @returns The shuffled array.
   */
  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = array.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
