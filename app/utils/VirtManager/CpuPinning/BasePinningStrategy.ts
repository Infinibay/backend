import fs from 'fs'
import path from 'path'

export interface CpuPinningConfig {
  cputune?: {
    vcpupin: Array<{
      $: { // Note the $ structure required by xml2js
        vcpu: string;
        cpuset: string;
      }
    }>;
  };
  cpu?: {
    // CPU model and mode
    $?: {
      mode?: 'host-model' | 'host-passthrough' | 'custom' | 'maximum';
      match?: 'exact' | 'minimum' | 'strict';
      check?: 'none' | 'partial' | 'full';
      migratable?: 'on' | 'off';
    };
    // CPU topology
    topology?: {
      $: {
        sockets: string;
        dies?: string;
        cores: string;
        threads: string;
      }
    };
    // CPU cache
    cache?: {
      $: {
        level?: string;
        mode: 'emulate' | 'passthrough';
      }
    };
    // CPU max physical address bits
    maxphysaddr?: {
      $: {
        mode: 'emulate' | 'passthrough';
        bits?: string;
      }
    };
    // NUMA topology
    numa?: {
      cell: any[];
    };
  };
}

export abstract class BaseCpuPinningStrategy {
  protected xml: any

  constructor (xml: any) {
    this.xml = xml
  }

  protected getVmMemory (): number {
    const memoryNode = this.xml.domain.memory
    if (memoryNode && memoryNode[0]._ && memoryNode[0].$.unit === 'KiB') {
      return Math.floor(Number(memoryNode[0]._) / 1024) // Convert KiB to MiB
    }
    throw new Error('VM memory is not set or improperly configured.')
  }

  protected getHostNumaMemory (): { [key: string]: number } {
    const nodesDir = '/sys/devices/system/node/'
    const nodeDirs = fs.readdirSync(nodesDir).filter(dir => dir.startsWith('node'))
    const numaMemory: { [key: string]: number } = {}

    nodeDirs.forEach(nodeDir => {
      const meminfoPath = path.join(nodesDir, nodeDir, 'meminfo')
      if (fs.existsSync(meminfoPath)) {
        const meminfo = fs.readFileSync(meminfoPath, 'utf8')
        const matched = meminfo.match(/MemTotal:\s+(\d+)\s+kB/)
        if (matched) {
          const memoryInMiB = Math.floor(Number(matched[1]) / 1024) // Convert from kB to MiB
          numaMemory[nodeDir] = memoryInMiB
        }
      }
    })

    return numaMemory
  }

  protected getNumaTopology (): { [key: string]: string[] } {
    const nodesDir = '/sys/devices/system/node/'
    const nodeDirs = fs.readdirSync(nodesDir).filter(dir => dir.startsWith('node'))
    const numaTopology: { [key: string]: string[] } = {}

    nodeDirs.forEach(nodeDir => {
      const cpuListPath = path.join(nodesDir, nodeDir, 'cpulist')
      if (fs.existsSync(cpuListPath)) {
        const cpuList = fs.readFileSync(cpuListPath, 'utf8').trim()
        numaTopology[nodeDir] = this.expandCpuList(cpuList)
      }
    })

    return numaTopology
  }

  protected expandCpuList (cpuList: string): string[] {
    return cpuList.split(',').flatMap(range => {
      const [startStr, endStr] = range.split('-')
      const start = parseInt(startStr, 10)
      const end = endStr !== undefined ? parseInt(endStr, 10) : start

      return Array.from({ length: end - start + 1 }, (_, i) => String(start + i))
    })
  }

  /**
   * Creates a basic CPU pinning configuration with vcpupin elements
   *
   * @param vcpuPins Array of vCPU to physical CPU mappings
   * @returns Basic CPU pinning configuration
   */
  protected createCpuPinningConfig (vcpuPins: { vcpu: number; cpuset: string }[]): CpuPinningConfig {
    return {
      cputune: {
        vcpupin: vcpuPins.map(pin => ({
          $: { // Add the $ structure here
            vcpu: String(pin.vcpu),
            cpuset: pin.cpuset
          }
        }))
      }
    }
  }

  /**
   * Adds NUMA topology to the CPU configuration
   *
   * @param config Existing CPU configuration
   * @param numaCells NUMA cell definitions
   * @returns Updated CPU configuration with NUMA topology
   */
  protected addNumaToConfig (config: CpuPinningConfig, numaCells: any[]): CpuPinningConfig {
    return {
      ...config,
      cpu: {
        ...config.cpu,
        numa: { cell: numaCells }
      }
    }
  }

  /**
   * Gets the host CPU model information
   *
   * @returns Host CPU model information
   */
  protected getHostCpuInfo (): { model: string; vendor: string; features: string[] } {
    try {
      // Try to get CPU info from /proc/cpuinfo
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8')
      const modelNameMatch = cpuinfo.match(/model name\s*:\s*(.+)/)
      const vendorIdMatch = cpuinfo.match(/vendor_id\s*:\s*(.+)/)
      const flagsMatch = cpuinfo.match(/flags\s*:\s*(.+)/)

      return {
        model: modelNameMatch ? modelNameMatch[1].trim() : 'unknown',
        vendor: vendorIdMatch ? vendorIdMatch[1].trim() : 'unknown',
        features: flagsMatch ? flagsMatch[1].trim().split(' ') : []
      }
    } catch (error) {
      console.error('Failed to get CPU info:', error)
      return { model: 'unknown', vendor: 'unknown', features: [] }
    }
  }

  /**
   * Adds CPU topology configuration to the CPU configuration
   *
   * @param config Existing CPU configuration
   * @param vcpuCount Total number of vCPUs
   * @returns Updated CPU configuration with topology information
   */
  protected addCpuTopology (config: CpuPinningConfig, vcpuCount: number): CpuPinningConfig {
    // Calculate a reasonable topology based on the vCPU count
    // This is important for proper core detection in the guest OS
    let sockets = 1
    let cores = vcpuCount
    const threads = 1

    // Try to create a more realistic topology
    if (vcpuCount >= 4) {
      // For 4 or more vCPUs, use 2 sockets with cores/threads
      if (vcpuCount % 4 === 0) {
        // If divisible by 4, use 2 sockets, 2 threads
        sockets = 2
        cores = vcpuCount / (sockets * threads)
      } else if (vcpuCount % 2 === 0) {
        // If divisible by 2, use 2 sockets, 1 thread
        sockets = 2
        cores = vcpuCount / sockets
      }
    }

    // Note: We're explicitly NOT setting 'migratable' attribute here
    // as it's only compatible with 'host-passthrough' or 'maximum' modes
    return {
      ...config,
      cpu: {
        ...config.cpu,
        $: {
          mode: 'host-model', // Use host-model for best compatibility
          match: 'exact'
        },
        topology: {
          $: {
            sockets: String(sockets),
            cores: String(cores),
            threads: String(threads)
          }
        }
      }
    }
  }

  /**
   * Adds CPU cache configuration to the CPU configuration
   *
   * @param config Existing CPU configuration
   * @returns Updated CPU configuration with cache information
   */
  protected addCpuCache (config: CpuPinningConfig): CpuPinningConfig {
    return {
      ...config,
      cpu: {
        ...config.cpu,
        cache: {
          $: {
            mode: 'emulate', // Use emulate for better compatibility
            level: '3' // L3 cache
          }
        }
      }
    }
  }

  /**
   * Adds CPU maxphysaddr configuration to the CPU configuration
   *
   * @param config Existing CPU configuration
   * @returns Updated CPU configuration with maxphysaddr information
   */
  protected addCpuMaxPhysAddr (config: CpuPinningConfig): CpuPinningConfig {
    return {
      ...config,
      cpu: {
        ...config.cpu,
        maxphysaddr: {
          $: {
            mode: 'emulate',
            bits: '42' // Common value for modern CPUs
          }
        }
      }
    }
  }

  /**
   * Sets CPU pinning configuration for a VM
   *
   * @param vcpuCount Number of virtual CPUs for the VM
   * @returns Complete CPU pinning configuration for libvirt XML
   */
  abstract setCpuPinning(vcpuCount: number): CpuPinningConfig;
}
