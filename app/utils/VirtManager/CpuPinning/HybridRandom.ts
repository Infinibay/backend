import { BaseCpuPinningStrategy, CpuPinningConfig } from './BasePinningStrategy'
import {
  calculateHybridPinning,
  normalizeObjectTopology,
  formatCpuRanges,
  PinningAllocationResult,
  HybridPinningOptions
} from './SharedAlgorithms'

export class HybridRandomStrategy extends BaseCpuPinningStrategy {
  private seed?: number

  /**
   * Create a HybridRandomStrategy.
   *
   * @param xml - Libvirt XML configuration object
   * @param seed - Optional seed for reproducible random pinning. If not provided,
   *               pinning is non-deterministic (different each run).
   */
  constructor (xml: any, seed?: number) {
    super(xml)
    this.seed = seed
  }

  /**
   * Sets the CPU pinning configuration using a hybrid random strategy.
   * This strategy shuffles the NUMA nodes and CPUs within each node to distribute vCPUs randomly
   * while still maintaining a proper NUMA topology for the guest.
   *
   * @param vcpuCount The number of virtual CPUs to pin.
   * @returns The CPU pinning configuration with NUMA topology information.
   */
  setCpuPinning (vcpuCount: number): CpuPinningConfig {
    const numaTopology = this.getNumaTopology()

    // Log the NUMA topology for debugging purposes
    console.log(`Setting CPU pinning for ${vcpuCount} vCPUs with HybridRandom strategy. NUMA topology:`,
      Object.entries(numaTopology).map(([node, cpus]) => `${node}: ${cpus.join(',')}`).join(' | '))

    // Use shared algorithm for hybrid pinning
    const normalized = normalizeObjectTopology(numaTopology)
    const options: HybridPinningOptions = {}
    if (this.seed !== undefined) {
      options.seed = this.seed
      console.log(`Using deterministic hybrid pinning with seed: ${this.seed}`)
    }

    const allocation = calculateHybridPinning(vcpuCount, normalized, options)

    // Log the pinning result for reproducibility tracking
    console.log(`Hybrid pinning result: cores [${allocation.selectedCores.join(',')}], NUMA nodes [${allocation.usedNodes.join(',')}]`)

    // Convert allocation to vcpupin format
    const vcpuPins = this.allocationToVcpuPins(allocation)

    // Create the CPU pinning configuration
    let config = this.createCpuPinningConfig(vcpuPins)

    // Generate NUMA cells based on vCPU assignments
    const numaCells = this.generateNumaCells(allocation)

    // Add NUMA topology to the configuration
    config = this.addNumaToConfig(config, numaCells)

    // Add CPU topology, cache, and maxphysaddr for better VM core detection
    config = this.addCpuTopology(config, vcpuCount)
    config = this.addCpuCache(config)
    config = this.addCpuMaxPhysAddr(config)

    return config
  }

  /**
   * Converts PinningAllocationResult to vcpupin format for libvirt.
   *
   * @param allocation - Result from shared pinning algorithm
   * @returns Array of vcpu to cpuset mappings
   */
  private allocationToVcpuPins (allocation: PinningAllocationResult): { vcpu: number; cpuset: string }[] {
    const vcpuPins: { vcpu: number; cpuset: string }[] = []

    allocation.vcpuToCoreMapping.forEach((physicalCore, vcpuIndex) => {
      vcpuPins.push({
        vcpu: vcpuIndex,
        cpuset: String(physicalCore)
      })
    })

    // Sort by vCPU index for consistent output
    vcpuPins.sort((a, b) => a.vcpu - b.vcpu)

    return vcpuPins
  }

  /**
   * Generates NUMA cell configuration for the VM based on vCPU assignments.
   *
   * @param allocation - Result from shared pinning algorithm with vcpuAssignments
   * @returns Array of NUMA cell configurations for libvirt XML
   */
  private generateNumaCells (allocation: PinningAllocationResult): any[] {
    const vmMemory = this.getVmMemory()
    const numaCells: any[] = []

    // Get total number of vCPUs across all nodes
    let totalVCpus = 0
    allocation.vcpuAssignments.forEach(vcpus => {
      totalVCpus += vcpus.length
    })

    // Create NUMA cells for the guest
    let cellIndex = 0
    allocation.vcpuAssignments.forEach((vcpus, nodeId) => {
      if (vcpus.length === 0) return // Skip nodes with no vCPUs

      // Sort vCPUs for better representation
      const sortedVcpus = [...vcpus].sort((a, b) => a - b)

      // Format vCPU list as ranges using shared utility
      const cpuRanges = formatCpuRanges(sortedVcpus)

      // Calculate memory allocation for this NUMA node proportional to vCPU count
      const memoryRatio = vcpus.length / totalVCpus
      const nodeMemory = Math.floor(vmMemory * memoryRatio)

      numaCells.push({
        $: {
          id: String(cellIndex),
          cpus: cpuRanges,
          memory: String(nodeMemory),
          unit: 'MiB'
        }
      })

      cellIndex++
    })

    return numaCells
  }
}
