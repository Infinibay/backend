import { BaseCpuPinningStrategy, CpuPinningConfig } from './BasePinningStrategy'

export class HybridRandomStrategy extends BaseCpuPinningStrategy {
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

    // Shuffle the NUMA nodes for random distribution
    const numaNodes = this.shuffleArray(Object.keys(numaTopology))
    const vcpuPins: { vcpu: number; cpuset: string }[] = []

    // Track vCPU assignments to NUMA nodes for topology creation
    const vCpuAssignments: { [nodeId: string]: number[] } = {}
    numaNodes.forEach(nodeId => { vCpuAssignments[nodeId] = [] })

    let vcpuIndex = 0

    // First pass: assign vCPUs to physical cores in a shuffled manner
    while (vcpuIndex < vcpuCount) {
      for (const nodeId of numaNodes) {
        const cpus = this.shuffleArray(numaTopology[nodeId])
        for (const cpu of cpus) {
          if (vcpuIndex >= vcpuCount) break

          vcpuPins.push({ vcpu: vcpuIndex, cpuset: cpu })
          vCpuAssignments[nodeId].push(vcpuIndex)
          vcpuIndex++
        }
        if (vcpuIndex >= vcpuCount) break
      }
    }

    // Create the CPU pinning configuration
    let config = this.createCpuPinningConfig(vcpuPins)

    // Generate NUMA cells based on vCPU assignments
    const numaCells = this.generateNumaCells(vCpuAssignments)

    // Add NUMA topology to the configuration
    config = this.addNumaToConfig(config, numaCells)

    // Add CPU topology, cache, and maxphysaddr for better VM core detection
    config = this.addCpuTopology(config, vcpuCount)
    config = this.addCpuCache(config)
    config = this.addCpuMaxPhysAddr(config)

    return config
  }

  /**
   * Generates NUMA cell configuration for the VM based on vCPU assignments.
   *
   * @param vCpuAssignments Mapping of NUMA node IDs to assigned vCPU indices
   * @returns Array of NUMA cell configurations for libvirt XML
   */
  private generateNumaCells (vCpuAssignments: { [nodeId: string]: number[] }): any[] {
    const vmMemory = this.getVmMemory()
    const numaCells: any[] = []

    // Get total number of vCPUs across all nodes
    const totalVCpus = Object.values(vCpuAssignments)
      .reduce((sum, vcpus) => sum + vcpus.length, 0)

    // Create NUMA cells for the guest
    Object.entries(vCpuAssignments).forEach(([nodeId, vcpus], index) => {
      if (vcpus.length === 0) return // Skip nodes with no vCPUs

      // Sort vCPUs for better representation
      vcpus.sort((a, b) => a - b)

      // Format vCPU list as ranges where possible (e.g., "0-3,5,7-9" instead of "0,1,2,3,5,7,8,9")
      const cpuRanges = this.formatCpuRanges(vcpus)

      // Calculate memory allocation for this NUMA node proportional to vCPU count
      const memoryRatio = vcpus.length / totalVCpus
      const nodeMemory = Math.floor(vmMemory * memoryRatio)

      numaCells.push({
        $: {
          id: String(index),
          cpus: cpuRanges,
          memory: String(nodeMemory),
          unit: 'MiB'
        }
      })
    })

    return numaCells
  }

  /**
   * Formats a list of CPU indices into a compact range representation.
   * For example, [0,1,2,3,5,7,8,9] becomes "0-3,5,7-9"
   *
   * @param cpus Array of CPU indices to format
   * @returns Formatted CPU range string
   */
  private formatCpuRanges (cpus: number[]): string {
    if (cpus.length === 0) return ''
    if (cpus.length === 1) return cpus[0].toString()

    const sortedCpus = [...cpus].sort((a, b) => a - b)
    const ranges: string[] = []

    let rangeStart = sortedCpus[0]
    let rangeEnd = rangeStart

    for (let i = 1; i < sortedCpus.length; i++) {
      if (sortedCpus[i] === rangeEnd + 1) {
        // Continue the current range
        rangeEnd = sortedCpus[i]
      } else {
        // End the current range and start a new one
        ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`)
        rangeStart = rangeEnd = sortedCpus[i]
      }
    }

    // Add the last range
    ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`)

    return ranges.join(',')
  }

  /**
   * Shuffles an array using the Fisher-Yates algorithm.
   * @param array The array to shuffle.
   * @returns The shuffled array.
   */
  private shuffleArray<T> (array: T[]): T[] {
    const shuffled = array.slice()
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled
  }
}
