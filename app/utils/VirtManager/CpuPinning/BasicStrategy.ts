import { BaseCpuPinningStrategy, CpuPinningConfig } from './BasePinningStrategy'

export class BasicStrategy extends BaseCpuPinningStrategy {
  /**
   * Sets CPU pinning configuration for a VM.
   *
   * This method:
   * 1. Retrieves the host's NUMA topology
   * 2. Determines the best pinning strategy based on available resources
   * 3. Applies either NUMA-aware or round-robin pinning
   * 4. Creates a complete CPU pinning configuration with NUMA topology
   *
   * @param vcpuCount Number of virtual CPUs for the VM
   * @returns Complete CPU pinning configuration for libvirt XML
   */
  setCpuPinning (vcpuCount: number): CpuPinningConfig {
    const numaTopology = this.getNumaTopology()

    // Log the NUMA topology for debugging purposes
    console.log(`Setting CPU pinning for ${vcpuCount} vCPUs with NUMA topology:`,
      Object.entries(numaTopology).map(([node, cpus]) => `${node}: ${cpus.join(',')}`).join(' | '))

    if (this.canOptimizeNumaPinning(vcpuCount, numaTopology)) {
      console.log(`Using NUMA-aware CPU pinning strategy for ${vcpuCount} vCPUs`)
      return this.optimizeNumaPinning(vcpuCount, numaTopology)
    } else {
      console.log(`Using round-robin CPU pinning strategy for ${vcpuCount} vCPUs`)
      return this.optimizeRoundRobinPinning(vcpuCount, numaTopology)
    }
  }

  /**
   * Determines if NUMA-aware CPU pinning optimization is possible.
   *
   * This method checks if:
   * 1. We have enough physical CPUs to accommodate all vCPUs
   * 2. NUMA topology information is available and valid
   * 3. There's at least one NUMA node with CPUs
   *
   * @param vcpuCount Number of virtual CPUs for the VM
   * @param numaTopology Host NUMA topology information
   * @returns True if NUMA optimization is possible, false otherwise
   */
  private canOptimizeNumaPinning (vcpuCount: number, numaTopology: { [key: string]: string[] }): boolean {
    // Check if we have NUMA topology information
    if (!numaTopology || Object.keys(numaTopology).length === 0) {
      return false
    }

    // Check if we have at least one CPU in the NUMA topology
    const availableCpus = Object.values(numaTopology).flat()
    if (availableCpus.length === 0) {
      return false
    }

    // We can still do NUMA optimization even if we have more vCPUs than physical CPUs,
    // but we'll prefer 1:1 mapping when possible
    return true
  }

  /**
   * Optimizes CPU pinning using NUMA topology for better VM core detection.
   *
   * This method implements best practices for libvirt CPU pinning:
   * 1. Assigns each vCPU to a specific physical CPU core
   * 2. Ensures consistent mapping between vCPUs and physical cores
   * 3. Attempts to keep vCPUs within the same NUMA node when possible
   * 4. Creates proper NUMA topology information for the guest
   *
   * @param vcpuCount Number of virtual CPUs for the VM
   * @param numaTopology Host NUMA topology information
   * @returns CPU pinning configuration
   */
  private optimizeNumaPinning (vcpuCount: number, numaTopology: { [key: string]: string[] }): CpuPinningConfig {
    const vcpuPins: { vcpu: number; cpuset: string }[] = []
    let vcpuIndex = 0

    // Group CPUs by NUMA node for better allocation
    const numaNodes = Object.keys(numaTopology)
    const cpusPerNode: { [nodeId: string]: string[] } = {}

    // Calculate how many vCPUs to allocate per NUMA node
    const totalPhysicalCpus = Object.values(numaTopology).flat().length
    const vCpusPerNode: { [nodeId: string]: number } = {}

    numaNodes.forEach(nodeId => {
      const nodeCpus = numaTopology[nodeId]
      cpusPerNode[nodeId] = [...nodeCpus] // Create a copy to avoid modifying original

      // Distribute vCPUs proportionally based on physical CPUs in each node
      const nodeRatio = nodeCpus.length / totalPhysicalCpus
      vCpusPerNode[nodeId] = Math.floor(vcpuCount * nodeRatio)

      // Ensure we don't exceed the total by adjusting the last node
      if (nodeId === numaNodes[numaNodes.length - 1]) {
        const allocated = Object.values(vCpusPerNode).reduce((sum, count) => sum + count, 0)
        if (allocated < vcpuCount) {
          vCpusPerNode[nodeId] += (vcpuCount - allocated)
        }
      }
    })

    // Assign vCPUs to physical CPUs, keeping them within NUMA nodes when possible
    for (const nodeId of numaNodes) {
      const nodeCpus = cpusPerNode[nodeId]
      const nodeVCpuCount = vCpusPerNode[nodeId]

      for (let i = 0; i < nodeVCpuCount && vcpuIndex < vcpuCount; i++) {
        // If we have more vCPUs than physical CPUs in this node, we'll need to share
        const cpuIndex = i % nodeCpus.length
        const physicalCpu = nodeCpus[cpuIndex]

        vcpuPins.push({
          vcpu: vcpuIndex,
          cpuset: physicalCpu
        })

        vcpuIndex++
      }
    }

    // Create the configuration with proper NUMA topology
    let config = this.createCpuPinningConfig(vcpuPins)
    const numaCells = this.generateNumaCells(vcpuCount, numaTopology, vCpusPerNode)

    // Add NUMA topology
    config = this.addNumaToConfig(config, numaCells)

    // Add CPU topology, cache, and maxphysaddr for better VM core detection
    config = this.addCpuTopology(config, vcpuCount)
    config = this.addCpuCache(config)
    config = this.addCpuMaxPhysAddr(config)

    return config
  }

  /**
   * Implements a round-robin CPU pinning strategy when NUMA optimization is not possible.
   *
   * This method:
   * 1. Distributes vCPUs across all available physical CPUs in a round-robin fashion
   * 2. Ensures each vCPU has a dedicated physical CPU when possible
   * 3. Falls back to sharing physical CPUs when there are more vCPUs than physical CPUs
   * 4. Creates a simpler configuration without NUMA topology information
   *
   * @param vcpuCount Number of virtual CPUs for the VM
   * @param numaTopology Host NUMA topology information
   * @returns CPU pinning configuration
   */
  private optimizeRoundRobinPinning (vcpuCount: number, numaTopology: { [key: string]: string[] }): CpuPinningConfig {
    const allCpus = Object.values(numaTopology).flat()
    const totalCpus = allCpus.length

    // When we have more vCPUs than physical CPUs, we need a different approach
    if (vcpuCount > totalCpus) {
      // Create CPU sets that assign multiple vCPUs to each physical CPU
      // This is better than 1:1 mapping that would leave some vCPUs without physical cores
      const vcpuPins = Array.from({ length: vcpuCount }, (_, vcpuIndex) => {
        // Calculate which physical CPU to use
        const physicalCpuIndex = vcpuIndex % totalCpus

        return {
          vcpu: vcpuIndex,
          cpuset: allCpus[physicalCpuIndex]
        }
      })

      return this.createCpuPinningConfig(vcpuPins)
    }

    // Standard round-robin assignment when we have enough physical CPUs
    const vcpuPins = Array.from({ length: vcpuCount }, (_, vcpuIndex) => ({
      vcpu: vcpuIndex,
      cpuset: allCpus[vcpuIndex % totalCpus]
    }))

    // Add basic NUMA topology information even for round-robin pinning
    let config = this.createCpuPinningConfig(vcpuPins)

    // For round-robin, we'll create a simple NUMA topology with all vCPUs in one cell
    const numaCells = [{
      $: {
        id: '0',
        cpus: Array.from({ length: vcpuCount }, (_, i) => i).join(','),
        memory: String(this.getVmMemory()),
        unit: 'MiB'
      }
    }]

    // Add NUMA topology
    config = this.addNumaToConfig(config, numaCells)

    // Add CPU topology, cache, and maxphysaddr for better VM core detection
    config = this.addCpuTopology(config, vcpuCount)
    config = this.addCpuCache(config)
    config = this.addCpuMaxPhysAddr(config)

    return config
  }

  /**
   * Generates NUMA cell configuration for the VM based on host topology.
   *
   * This method creates a NUMA topology for the guest that:
   * 1. Aligns with the physical NUMA topology of the host
   * 2. Properly distributes memory across NUMA nodes
   * 3. Ensures vCPUs are assigned to the correct NUMA cells
   * 4. Follows libvirt best practices for NUMA configuration
   *
   * @param vcpuCount Number of virtual CPUs for the VM
   * @param numaTopology Host NUMA topology information
   * @param vCpusPerNode Optional distribution of vCPUs per NUMA node
   * @returns Array of NUMA cell configurations for libvirt XML
   */
  private generateNumaCells (
    vcpuCount: number,
    numaTopology: { [key: string]: string[] },
    vCpusPerNode?: { [nodeId: string]: number }
  ): any[] {
    const hostNumaMemory = this.getHostNumaMemory()
    const totalHostMemory = Object.values(hostNumaMemory).reduce((acc, mem) => acc + mem, 0)
    const vmMemory = this.getVmMemory()

    if (vmMemory > totalHostMemory) {
      throw new Error(`Requested VM memory (${vmMemory} MiB) exceeds host total memory (${totalHostMemory} MiB).`)
    }

    const numaNodes = Object.keys(numaTopology)
    const numaCells: { id: number; cpus: string; memory: number }[] = []

    // If vCpusPerNode wasn't provided, calculate it
    if (!vCpusPerNode) {
      vCpusPerNode = {}
      const totalPhysicalCpus = Object.values(numaTopology).flat().length

      numaNodes.forEach(nodeId => {
        const nodeCpus = numaTopology[nodeId]
        const nodeRatio = nodeCpus.length / totalPhysicalCpus
        vCpusPerNode![nodeId] = Math.floor(vcpuCount * nodeRatio)
      })

      // Ensure we allocate all vCPUs
      const allocated = Object.values(vCpusPerNode).reduce((sum, count) => sum + count, 0)
      if (allocated < vcpuCount) {
        vCpusPerNode[numaNodes[numaNodes.length - 1]] += (vcpuCount - allocated)
      }
    }

    // Calculate memory distribution proportionally to vCPU allocation
    const totalVCpus = Object.values(vCpusPerNode).reduce((sum, count) => sum + count, 0)
    let startVcpuIndex = 0
    let remainingMemory = vmMemory

    // Create NUMA cells for the guest
    numaNodes.forEach((nodeId, index) => {
      const nodeVCpuCount = vCpusPerNode![nodeId]
      if (nodeVCpuCount === 0) return // Skip nodes with no vCPUs

      // Calculate memory allocation for this NUMA node
      const memoryRatio = nodeVCpuCount / totalVCpus
      const nodeMemory = Math.floor(vmMemory * memoryRatio)

      // Create vCPU range for this NUMA cell
      const endVcpuIndex = startVcpuIndex + nodeVCpuCount - 1
      const cpuRange = nodeVCpuCount > 1
        ? `${startVcpuIndex}-${endVcpuIndex}`
        : `${startVcpuIndex}`

      // Add the NUMA cell
      numaCells.push({
        id: index,
        cpus: cpuRange,
        memory: nodeMemory
      })

      remainingMemory -= nodeMemory
      startVcpuIndex = endVcpuIndex + 1
    })

    // Distribute any remaining memory to the last cell
    if (numaCells.length > 0 && remainingMemory > 0) {
      numaCells[numaCells.length - 1].memory += remainingMemory
    }

    // Format for libvirt XML
    return numaCells.map(cell => ({
      $: {
        id: String(cell.id),
        cpus: cell.cpus,
        memory: String(cell.memory),
        unit: 'MiB'
      }
    }))
  }
}
