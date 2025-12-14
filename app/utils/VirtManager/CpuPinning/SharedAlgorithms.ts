/**
 * SharedAlgorithms - Core CPU pinning algorithms shared between backend and infinivirt
 *
 * This module provides pure functions for calculating NUMA-aware CPU pinning
 * without any dependency on libvirt XML or numactl specifics. Both backend
 * strategies (for libvirt XML generation) and infinivirt's CpuPinningAdapter
 * (for numactl wrapper generation) delegate to these shared algorithms.
 *
 * @module SharedAlgorithms
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Normalized NUMA topology representation.
 * Uses number[] for CPU cores to be agnostic of string vs number representation.
 */
export interface NormalizedNumaTopology {
  /** Map of NUMA node ID to array of CPU core indices on that node */
  nodes: Map<number, number[]>
  /** Total number of CPUs across all NUMA nodes */
  totalCpus: number
}

/**
 * Result of CPU pinning calculation.
 * Contains the selected cores and NUMA nodes without format-specific details.
 */
export interface PinningAllocationResult {
  /** Array of physical CPU core indices to pin to */
  selectedCores: number[]
  /** Array of NUMA node IDs used */
  usedNodes: number[]
  /** Map of vCPU index to physical CPU core */
  vcpuToCoreMapping: Map<number, number>
  /** Map of NUMA node ID to vCPU indices assigned to that node */
  vcpuAssignments: Map<number, number[]>
}

/**
 * Options for hybrid pinning algorithm.
 */
export interface HybridPinningOptions {
  /**
   * Optional seed for reproducible randomization.
   * If not provided, uses Math.random() (non-deterministic).
   */
  seed?: number
}

// =============================================================================
// Seedable PRNG
// =============================================================================

/**
 * Simple seedable pseudo-random number generator using mulberry32.
 * Provides deterministic random numbers when a seed is specified.
 */
export class SeededRandom {
  private state: number

  /**
   * Create a new SeededRandom instance.
   * @param seed - The seed value. If undefined, uses a random seed.
   */
  constructor (seed?: number) {
    this.state = seed ?? Math.floor(Math.random() * 2147483647)
  }

  /**
   * Get the current seed/state (useful for logging).
   */
  getSeed (): number {
    return this.state
  }

  /**
   * Generate the next random number in [0, 1).
   * Uses mulberry32 algorithm for good distribution.
   */
  next (): number {
    let t = this.state += 0x6D2B79F5
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }

  /**
   * Generate a random integer in [0, max).
   * @param max - The exclusive upper bound
   */
  nextInt (max: number): number {
    return Math.floor(this.next() * max)
  }
}

// =============================================================================
// Conversion Utilities
// =============================================================================

/**
 * Convert object-based topology (from sysfs) to normalized Map format.
 *
 * @param topology - Object with string keys ('node0', 'node1') and string[] CPU values
 * @returns NormalizedNumaTopology with number-based keys and values
 *
 * @example
 * ```typescript
 * const objTopology = { 'node0': ['0', '1', '2', '3'], 'node1': ['4', '5', '6', '7'] }
 * const normalized = normalizeObjectTopology(objTopology)
 * // normalized.nodes = Map { 0 => [0,1,2,3], 1 => [4,5,6,7] }
 * ```
 */
export function normalizeObjectTopology (
  topology: { [key: string]: string[] }
): NormalizedNumaTopology {
  const nodes = new Map<number, number[]>()
  let totalCpus = 0

  for (const [nodeKey, cpuStrings] of Object.entries(topology)) {
    // Extract node ID from 'node0', 'node1', etc.
    const nodeId = parseInt(nodeKey.replace('node', ''), 10)
    if (isNaN(nodeId)) continue

    const cpus = cpuStrings.map(s => parseInt(s, 10)).filter(n => !isNaN(n))
    nodes.set(nodeId, cpus)
    totalCpus += cpus.length
  }

  return { nodes, totalCpus }
}

/**
 * Convert Map-based topology to normalized format (pass-through for type consistency).
 *
 * @param topology - Map with number keys and number[] CPU values
 * @returns NormalizedNumaTopology
 */
export function normalizeMapTopology (
  topology: Map<number, number[]>
): NormalizedNumaTopology {
  let totalCpus = 0
  topology.forEach(cpus => { totalCpus += cpus.length })
  return { nodes: topology, totalCpus }
}

// =============================================================================
// Core Algorithms
// =============================================================================

/**
 * Calculate basic (sequential) CPU pinning allocation.
 *
 * This algorithm distributes vCPUs across NUMA nodes proportionally to the
 * number of physical CPUs in each node, keeping vCPUs within the same node
 * when possible to maximize memory locality.
 *
 * Algorithm:
 * 1. Calculate how many vCPUs to assign to each NUMA node proportionally
 * 2. Assign vCPUs to physical cores sequentially within each node
 * 3. Handle overcommit (more vCPUs than cores) by wrapping around
 *
 * @param vcpuCount - Number of virtual CPUs to allocate
 * @param topology - Normalized host NUMA topology
 * @returns PinningAllocationResult with core assignments
 *
 * @example
 * ```typescript
 * const topology = normalizeObjectTopology({ 'node0': ['0','1'], 'node1': ['2','3'] })
 * const result = calculateBasicPinning(4, topology)
 * // result.selectedCores = [0, 1, 2, 3]
 * // result.usedNodes = [0, 1]
 * ```
 */
export function calculateBasicPinning (
  vcpuCount: number,
  topology: NormalizedNumaTopology
): PinningAllocationResult {
  const selectedCores: number[] = []
  const usedNodes = new Set<number>()
  const vcpuToCoreMapping = new Map<number, number>()
  const vcpuAssignments = new Map<number, number[]>()

  if (topology.totalCpus === 0 || vcpuCount <= 0) {
    return {
      selectedCores: [],
      usedNodes: [],
      vcpuToCoreMapping: new Map(),
      vcpuAssignments: new Map()
    }
  }

  // Get sorted node IDs for deterministic iteration
  const nodeIds = Array.from(topology.nodes.keys()).sort((a, b) => a - b)

  // Initialize vcpuAssignments
  nodeIds.forEach(nodeId => vcpuAssignments.set(nodeId, []))

  // Calculate vCPU distribution per node (proportional to physical CPUs)
  const vCpusPerNode = new Map<number, number>()
  let remainingVCpus = vcpuCount

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i]
    const nodeCpus = topology.nodes.get(nodeId) || []

    if (nodeCpus.length === 0) {
      vCpusPerNode.set(nodeId, 0)
      continue
    }

    // Last node gets remaining vCPUs to avoid rounding issues
    if (i === nodeIds.length - 1) {
      vCpusPerNode.set(nodeId, remainingVCpus)
    } else {
      // Proportional allocation based on node's share of total CPUs
      const nodeShare = Math.floor((nodeCpus.length / topology.totalCpus) * vcpuCount)
      const allocation = Math.min(nodeShare, remainingVCpus)
      vCpusPerNode.set(nodeId, allocation)
      remainingVCpus -= allocation
    }
  }

  // Assign vCPUs to physical cores
  let vcpuIndex = 0
  for (const nodeId of nodeIds) {
    const nodeCpus = topology.nodes.get(nodeId) || []
    const nodeVCpuCount = vCpusPerNode.get(nodeId) || 0

    if (nodeVCpuCount === 0 || nodeCpus.length === 0) continue

    usedNodes.add(nodeId)
    const nodeAssignments = vcpuAssignments.get(nodeId)!

    for (let i = 0; i < nodeVCpuCount; i++) {
      // Wrap around if more vCPUs than physical cores (overcommit)
      const coreIndex = i % nodeCpus.length
      const physicalCore = nodeCpus[coreIndex]

      vcpuToCoreMapping.set(vcpuIndex, physicalCore)
      nodeAssignments.push(vcpuIndex)

      if (!selectedCores.includes(physicalCore)) {
        selectedCores.push(physicalCore)
      }

      vcpuIndex++
    }
  }

  // Sort selected cores for consistent output
  selectedCores.sort((a, b) => a - b)

  return {
    selectedCores,
    usedNodes: Array.from(usedNodes).sort((a, b) => a - b),
    vcpuToCoreMapping,
    vcpuAssignments
  }
}

/**
 * Calculate hybrid (randomized) CPU pinning allocation.
 *
 * This algorithm shuffles core allocation across NUMA nodes, providing better
 * load distribution for mixed workloads that may benefit from spreading across
 * different NUMA nodes.
 *
 * Algorithm:
 * 1. Flatten all CPUs with their node info into a single list
 * 2. Shuffle the list using Fisher-Yates algorithm (optionally seeded)
 * 3. Select first N cores for vCPU count
 * 4. Handle overcommit by using all available cores
 *
 * @param vcpuCount - Number of virtual CPUs to allocate
 * @param topology - Normalized host NUMA topology
 * @param options - Optional configuration including seed for reproducibility
 * @returns PinningAllocationResult with core assignments
 *
 * @example
 * ```typescript
 * const topology = normalizeObjectTopology({ 'node0': ['0','1'], 'node1': ['2','3'] })
 *
 * // Non-deterministic (different each run)
 * const result1 = calculateHybridPinning(4, topology)
 *
 * // Deterministic (same result with same seed)
 * const result2 = calculateHybridPinning(4, topology, { seed: 12345 })
 * ```
 */
export function calculateHybridPinning (
  vcpuCount: number,
  topology: NormalizedNumaTopology,
  options?: HybridPinningOptions
): PinningAllocationResult {
  const selectedCores: number[] = []
  const usedNodes = new Set<number>()
  const vcpuToCoreMapping = new Map<number, number>()
  const vcpuAssignments = new Map<number, number[]>()

  if (topology.totalCpus === 0 || vcpuCount <= 0) {
    return {
      selectedCores: [],
      usedNodes: [],
      vcpuToCoreMapping: new Map(),
      vcpuAssignments: new Map()
    }
  }

  // Initialize vcpuAssignments for all nodes
  topology.nodes.forEach((_, nodeId) => vcpuAssignments.set(nodeId, []))

  // Flatten all CPUs with their node info
  const allCpus: Array<{ core: number; node: number }> = []
  topology.nodes.forEach((cores, nodeId) => {
    cores.forEach(core => {
      allCpus.push({ core, node: nodeId })
    })
  })

  // Create random source (seeded or Math.random)
  const rng = new SeededRandom(options?.seed)

  // Fisher-Yates shuffle
  const shuffled = [...allCpus]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  // Assign vCPUs to shuffled cores
  const toSelect = Math.min(vcpuCount, shuffled.length)
  for (let vcpuIndex = 0; vcpuIndex < toSelect; vcpuIndex++) {
    const { core, node } = shuffled[vcpuIndex]

    vcpuToCoreMapping.set(vcpuIndex, core)
    usedNodes.add(node)
    vcpuAssignments.get(node)!.push(vcpuIndex)

    if (!selectedCores.includes(core)) {
      selectedCores.push(core)
    }
  }

  // Handle overcommit: if more vCPUs than physical cores, wrap around
  if (vcpuCount > shuffled.length) {
    for (let vcpuIndex = shuffled.length; vcpuIndex < vcpuCount; vcpuIndex++) {
      const wrapIndex = vcpuIndex % shuffled.length
      const { core, node } = shuffled[wrapIndex]

      vcpuToCoreMapping.set(vcpuIndex, core)
      usedNodes.add(node)
      vcpuAssignments.get(node)!.push(vcpuIndex)
    }

    // In overcommit, all cores are used
    shuffled.forEach(({ core, node }) => {
      if (!selectedCores.includes(core)) {
        selectedCores.push(core)
      }
      usedNodes.add(node)
    })
  }

  // Sort for consistent output
  selectedCores.sort((a, b) => a - b)

  return {
    selectedCores,
    usedNodes: Array.from(usedNodes).sort((a, b) => a - b),
    vcpuToCoreMapping,
    vcpuAssignments
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format a list of CPU indices as compact ranges.
 * For example, [0,1,2,3,5,7,8,9] becomes "0-3,5,7-9"
 *
 * @param cpus - Array of CPU indices to format
 * @returns Formatted CPU range string
 */
export function formatCpuRanges (cpus: number[]): string {
  if (cpus.length === 0) return ''
  if (cpus.length === 1) return cpus[0].toString()

  const sorted = [...cpus].sort((a, b) => a - b)
  const ranges: string[] = []

  let rangeStart = sorted[0]
  let rangeEnd = rangeStart

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === rangeEnd + 1) {
      rangeEnd = sorted[i]
    } else {
      ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`)
      rangeStart = rangeEnd = sorted[i]
    }
  }

  ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}-${rangeEnd}`)
  return ranges.join(',')
}
