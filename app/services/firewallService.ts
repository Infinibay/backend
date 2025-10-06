import { PrismaClient } from '@prisma/client'
import { NetworkFilterService } from './networkFilterService'
import { KNOWN_SERVICES, getServiceById, ServiceDefinition } from '../config/knownServices'

export interface VmServiceStatus {
  vmId: string;
  vmName: string;
  serviceId: string;
  serviceName: string;
  useEnabled: boolean;
  provideEnabled: boolean;
  running: boolean;
}

export interface DepartmentServiceStatus {
  departmentId: string;
  departmentName: string;
  serviceId: string;
  serviceName: string;
  useEnabled: boolean;
  provideEnabled: boolean;
  vmCount: number;
  enabledVmCount: number;
}

export interface GlobalServiceStatus {
  serviceId: string;
  serviceName: string;
  useEnabled: boolean;
  provideEnabled: boolean;
}

export interface DepartmentServiceDetailedStats {
  departmentId: string;
  departmentName: string;
  serviceId: string;
  serviceName: string;
  useEnabled: boolean;
  provideEnabled: boolean;
  vmCount: number;
  enabledVmCount: number;
  runningVmCount: number;
  vms: {
    vmId: string;
    vmName: string;
    useEnabled: boolean;
    provideEnabled: boolean;
    running: boolean;
    inheritedFromDepartment: boolean;
  }[];
}

export class FirewallService {
  private networkFilterService: NetworkFilterService

  constructor (private prisma: PrismaClient) {
    this.networkFilterService = new NetworkFilterService(prisma)
  }

  // Service listing
  async getServices (): Promise<ServiceDefinition[]> {
    return KNOWN_SERVICES
  }

  // Helper methods to get filters
  async getVmFilter (vmId: string) {
    return this.prisma.vMNWFilter.findFirst({
      where: { vmId }
    })
  }

  async getDepartmentFilter (departmentId: string) {
    return this.prisma.departmentNWFilter.findFirst({
      where: { departmentId }
    })
  }

  // Get service status for a VM
  async getVmServiceStatus (vmId: string, serviceId?: string): Promise<VmServiceStatus[]> {
    // Optimize the query to include only what's necessary
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        serviceConfigs: true,
        ports: {
          where: {
            OR: [
              { running: true },
              { enabled: true },
              { toEnable: true }
            ]
          }
        },
        department: {
          include: {
            serviceConfigs: true
          }
        }
      }
    })

    if (!vm) {
      throw new Error(`VM with ID ${vmId} not found`)
    }

    // Get global settings for inheritance in a single query
    const globalConfigs = await this.prisma.globalServiceConfig.findMany()

    // Filter services based on serviceId (if provided)
    const servicesToCheck = serviceId
      ? [getServiceById(serviceId)].filter(Boolean) as ServiceDefinition[]
      : KNOWN_SERVICES

    // Process all services in a single pass
    return servicesToCheck.map(service => {
      // Find configurations for each level in a single pass
      const vmConfig = vm.serviceConfigs.find(
        config => config.serviceId === service.id
      )

      // Get department config for inheritance
      const deptConfig = vm.department?.serviceConfigs.find(
        config => config.serviceId === service.id
      )

      // Get global config for inheritance
      const globalConfig = globalConfigs.find(
        config => config.serviceId === service.id
      )

      // Determine effective settings with inheritance
      const useEnabled = vmConfig?.useEnabled !== undefined
        ? vmConfig.useEnabled
        : deptConfig?.useEnabled !== undefined
          ? deptConfig.useEnabled
          : globalConfig?.useEnabled ?? false

      const provideEnabled = vmConfig?.provideEnabled !== undefined
        ? vmConfig.provideEnabled
        : deptConfig?.provideEnabled !== undefined
          ? deptConfig.provideEnabled
          : globalConfig?.provideEnabled ?? false

      // Use the helper method to check if service is running
      const running = this.isServiceRunning(vm.ports, service)

      return {
        vmId: vm.id,
        vmName: vm.name,
        serviceId: service.id,
        serviceName: service.displayName,
        useEnabled,
        provideEnabled,
        running
      }
    })
  }

  /**
   * Detects if a service is running by analyzing open ports
   */
  private isServiceRunning (vmPorts: any[], serviceDefinition: ServiceDefinition): boolean {
    return serviceDefinition.ports.some(servicePort =>
      vmPorts.some(vmPort =>
        vmPort.protocol === servicePort.protocol &&
        // Check for port range overlap
        vmPort.portStart <= servicePort.portEnd &&
        vmPort.portEnd >= servicePort.portStart &&
        // The port must be marked as running
        vmPort.running
      )
    )
  }

  // Toggle service for a VM
  async toggleVmService (
    vmId: string,
    serviceId: string,
    action: 'use' | 'provide',
    enabled: boolean
  ): Promise<VmServiceStatus> {
    const service = getServiceById(serviceId)
    if (!service) {
      throw new Error(`Service with ID ${serviceId} not found`)
    }

    // Get or create VM service config
    let vmConfig = await this.prisma.vMServiceConfig.findUnique({
      where: {
        vmId_serviceId: {
          vmId,
          serviceId
        }
      }
    })

    if (!vmConfig) {
      vmConfig = await this.prisma.vMServiceConfig.create({
        data: {
          vmId,
          serviceId,
          useEnabled: false,
          provideEnabled: false
        }
      })
    }

    // Update the service config
    vmConfig = await this.prisma.vMServiceConfig.update({
      where: { id: vmConfig.id },
      data: {
        useEnabled: action === 'use' ? enabled : vmConfig.useEnabled,
        provideEnabled: action === 'provide' ? enabled : vmConfig.provideEnabled
      }
    })

    // Get the VM filter
    const vmFilter = await this.getVmFilter(vmId)
    if (!vmFilter) {
      throw new Error(`Filter for VM ${vmId} not found`)
    }

    // Now apply the appropriate filter rules
    await this.applyServiceRules(
      vmFilter.nwFilterId,
      service,
      action,
      enabled
    )

    // Deduplicate rules to prevent duplicates
    await this.networkFilterService.deduplicateRules(vmFilter.nwFilterId)

    // If providing service, update VmPort records for visibility
    if (action === 'provide') {
      await this.updateVmPortRecords(vmId, service, enabled)
    }

    // Ensure filter will be flushed
    await this.prisma.nWFilter.update({
      where: { id: vmFilter.nwFilterId },
      data: { needsFlush: true }
    })

    // Return the updated status
    const status = await this.getVmServiceStatus(vmId, serviceId)
    return status[0]
  }

  // Clear VM-specific service overrides, reverting to department defaults
  async clearVmServiceOverrides (vmId: string, serviceId?: string): Promise<VmServiceStatus[]> {
    // Get VM with configurations and active ports
    const vm = await this.prisma.machine.findUnique({
      where: { id: vmId },
      include: {
        serviceConfigs: true,
        ports: {
          where: {
            OR: [
              { running: true },
              { enabled: true },
              { toEnable: true }
            ]
          }
        }
      }
    })

    if (!vm) {
      throw new Error(`VM with ID ${vmId} not found`)
    }

    // If a specific service is provided, only clear that one
    if (serviceId) {
      const service = getServiceById(serviceId)
      if (!service) {
        throw new Error(`Service with ID ${serviceId} not found`)
      }

      const vmConfig = await this.prisma.vMServiceConfig.findUnique({
        where: {
          vmId_serviceId: {
            vmId,
            serviceId
          }
        }
      })

      if (vmConfig) {
        await this.prisma.vMServiceConfig.delete({
          where: { id: vmConfig.id }
        })
      }

      // Get VM filter to update rules
      const vmFilter = await this.getVmFilter(vmId)
      if (vmFilter) {
        // Get department config to apply inherited settings
        const deptConfig = vm.departmentId
          ? await this.prisma.departmentServiceConfig.findFirst({
            where: {
              departmentId: vm.departmentId,
              serviceId
            }
          })
          : null

        // If there's a department config, apply it
        if (deptConfig) {
          // Apply department's 'use' rule
          await this.applyServiceRules(
            vmFilter.nwFilterId,
            service,
            'use',
            deptConfig.useEnabled
          )

          // Apply department's 'provide' rule
          await this.applyServiceRules(
            vmFilter.nwFilterId,
            service,
            'provide',
            deptConfig.provideEnabled
          )

          // Update port records if needed
          if (deptConfig.provideEnabled) {
            await this.updateVmPortRecords(vmId, service, true)
          }
        } else {
          // If no department config exists, get global config
          const globalConfig = await this.prisma.globalServiceConfig.findUnique({
            where: { serviceId }
          })

          // Apply global defaults if they exist
          if (globalConfig) {
            await this.applyServiceRules(
              vmFilter.nwFilterId,
              service,
              'use',
              globalConfig.useEnabled
            )

            await this.applyServiceRules(
              vmFilter.nwFilterId,
              service,
              'provide',
              globalConfig.provideEnabled
            )

            // Update port records if needed
            if (globalConfig.provideEnabled) {
              await this.updateVmPortRecords(vmId, service, true)
            }
          } else {
            // If no configs exist at any level, disable the service
            await this.applyServiceRules(vmFilter.nwFilterId, service, 'use', false)
            await this.applyServiceRules(vmFilter.nwFilterId, service, 'provide', false)
          }
        }

        // Ensure filter will be updated
        await this.prisma.nWFilter.update({
          where: { id: vmFilter.nwFilterId },
          data: { needsFlush: true }
        })
      }
    } else {
      // If no specific service provided, clear all VM service configs
      await this.prisma.vMServiceConfig.deleteMany({
        where: { vmId }
      })

      // Get VM filter to update rules
      const vmFilter = await this.getVmFilter(vmId)
      if (vmFilter && vm.departmentId) {
        // Get all department service configs
        const deptConfigs = await this.prisma.departmentServiceConfig.findMany({
          where: { departmentId: vm.departmentId }
        })

        // Get all global service configs for services without department configs
        const globalConfigs = await this.prisma.globalServiceConfig.findMany()

        // First, apply department configs where they exist
        for (const deptConfig of deptConfigs) {
          const service = getServiceById(deptConfig.serviceId)
          if (service) {
            // Apply department's rules
            await this.applyServiceRules(
              vmFilter.nwFilterId,
              service,
              'use',
              deptConfig.useEnabled
            )

            await this.applyServiceRules(
              vmFilter.nwFilterId,
              service,
              'provide',
              deptConfig.provideEnabled
            )

            // Update port records if needed
            if (deptConfig.provideEnabled) {
              await this.updateVmPortRecords(vmId, service, true)
            }
          }
        }

        // Apply global configs for services not covered by department configs
        const deptServiceIds = deptConfigs.map(dc => dc.serviceId)
        for (const globalConfig of globalConfigs) {
          // Skip services already handled by department configs
          if (deptServiceIds.includes(globalConfig.serviceId)) {
            continue
          }

          const service = getServiceById(globalConfig.serviceId)
          if (service) {
            // Apply global rules
            await this.applyServiceRules(
              vmFilter.nwFilterId,
              service,
              'use',
              globalConfig.useEnabled
            )

            await this.applyServiceRules(
              vmFilter.nwFilterId,
              service,
              'provide',
              globalConfig.provideEnabled
            )

            // Update port records if needed
            if (globalConfig.provideEnabled) {
              await this.updateVmPortRecords(vmId, service, true)
            }
          }
        }

        // Ensure filter will be updated
        await this.prisma.nWFilter.update({
          where: { id: vmFilter.nwFilterId },
          data: { needsFlush: true }
        })
      }
    }

    // Return the updated service status
    return this.getVmServiceStatus(vmId, serviceId)
  }

  // Get service status for a department
  async getDepartmentServiceStatus (
    departmentId: string,
    serviceId?: string
  ): Promise<DepartmentServiceStatus[]> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        serviceConfigs: true,
        machines: {
          include: {
            serviceConfigs: true
          }
        }
      }
    })

    if (!department) {
      throw new Error(`Department with ID ${departmentId} not found`)
    }

    // Get global settings for inheritance
    const globalConfigs = await this.prisma.globalServiceConfig.findMany()

    // Get services to check (all or specific one)
    const servicesToCheck = serviceId
      ? [getServiceById(serviceId)].filter(Boolean) as ServiceDefinition[]
      : KNOWN_SERVICES

    return servicesToCheck.map(service => {
      // Get department-specific config
      const deptConfig = department.serviceConfigs.find(
        config => config.serviceId === service.id
      )

      // Get global config for inheritance
      const globalConfig = globalConfigs.find(
        config => config.serviceId === service.id
      )

      // Determine effective settings with inheritance
      const useEnabled = deptConfig?.useEnabled !== undefined
        ? deptConfig.useEnabled
        : globalConfig?.useEnabled ?? false

      const provideEnabled = deptConfig?.provideEnabled !== undefined
        ? deptConfig.provideEnabled
        : globalConfig?.provideEnabled ?? false

      // Count VMs with this service enabled
      let enabledVmCount = 0
      const vmCount = department.machines.length

      // Check each VM for this service
      department.machines.forEach(vm => {
        const vmConfig = vm.serviceConfigs.find(
          config => config.serviceId === service.id
        )

        // VM has explicit config or inherits from department
        const vmUseEnabled = vmConfig?.useEnabled !== undefined
          ? vmConfig.useEnabled
          : useEnabled

        const vmProvideEnabled = vmConfig?.provideEnabled !== undefined
          ? vmConfig.provideEnabled
          : provideEnabled

        // Count as enabled if either use or provide is enabled
        if (vmUseEnabled || vmProvideEnabled) {
          enabledVmCount++
        }
      })

      return {
        departmentId: department.id,
        departmentName: department.name,
        serviceId: service.id,
        serviceName: service.displayName,
        useEnabled,
        provideEnabled,
        vmCount,
        enabledVmCount
      }
    })
  }

  // Toggle department service
  async toggleDepartmentService (
    departmentId: string,
    serviceId: string,
    action: 'use' | 'provide',
    enabled: boolean
  ): Promise<DepartmentServiceStatus> {
    const service = getServiceById(serviceId)
    if (!service) {
      throw new Error(`Service with ID ${serviceId} not found`)
    }

    // Get or create department service config
    let deptConfig = await this.prisma.departmentServiceConfig.findUnique({
      where: {
        departmentId_serviceId: {
          departmentId,
          serviceId
        }
      }
    })

    if (!deptConfig) {
      deptConfig = await this.prisma.departmentServiceConfig.create({
        data: {
          departmentId,
          serviceId,
          useEnabled: false,
          provideEnabled: false
        }
      })
    }

    // Update the service config
    deptConfig = await this.prisma.departmentServiceConfig.update({
      where: { id: deptConfig.id },
      data: {
        useEnabled: action === 'use' ? enabled : deptConfig.useEnabled,
        provideEnabled: action === 'provide' ? enabled : deptConfig.provideEnabled
      }
    })

    // Get the department filter
    const deptFilter = await this.getDepartmentFilter(departmentId)
    if (!deptFilter) {
      throw new Error(`Filter for department ${departmentId} not found`)
    }

    // Apply the appropriate filter rules
    await this.applyServiceRules(
      deptFilter.nwFilterId,
      service,
      action,
      enabled
    )

    // Ensure filter will be flushed
    await this.prisma.nWFilter.update({
      where: { id: deptFilter.nwFilterId },
      data: { needsFlush: true }
    })

    // Return the updated status
    const status = await this.getDepartmentServiceStatus(departmentId, serviceId)
    return status[0]
  }

  // Get detailed service statistics for a department
  async getDepartmentServiceDetailedStats (
    departmentId: string,
    serviceId?: string
  ): Promise<DepartmentServiceDetailedStats[]> {
    // Get department with optimized query to include only what's needed
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        serviceConfigs: true,
        machines: {
          include: {
            serviceConfigs: true,
            ports: {
              where: {
                OR: [
                  { running: true },
                  { enabled: true },
                  { toEnable: true }
                ]
              }
            }
          }
        }
      }
    })

    if (!department) {
      throw new Error(`Department with ID ${departmentId} not found`)
    }

    // Get global settings for inheritance
    const globalConfigs = await this.prisma.globalServiceConfig.findMany()

    // Get services to check (all or specific one)
    const servicesToCheck = serviceId
      ? [getServiceById(serviceId)].filter(Boolean) as ServiceDefinition[]
      : KNOWN_SERVICES

    return servicesToCheck.map(service => {
      // Get department-specific config
      const deptConfig = department.serviceConfigs.find(
        config => config.serviceId === service.id
      )

      // Get global config for inheritance
      const globalConfig = globalConfigs.find(
        config => config.serviceId === service.id
      )

      // Determine effective settings with inheritance
      const useEnabled = deptConfig?.useEnabled !== undefined
        ? deptConfig.useEnabled
        : globalConfig?.useEnabled ?? false

      const provideEnabled = deptConfig?.provideEnabled !== undefined
        ? deptConfig.provideEnabled
        : globalConfig?.provideEnabled ?? false

      // Count VMs with service enabled and track detailed VM status
      let enabledVmCount = 0
      let runningVmCount = 0
      const vmCount = department.machines.length
      const vms = department.machines.map(vm => {
        // Get VM-specific config
        const vmConfig = vm.serviceConfigs.find(
          config => config.serviceId === service.id
        )

        // Determine if settings are inherited from department
        const inheritedFromDepartment = vmConfig?.useEnabled === undefined &&
                                       vmConfig?.provideEnabled === undefined

        // VM has explicit config or inherits from department
        const vmUseEnabled = vmConfig?.useEnabled !== undefined
          ? vmConfig.useEnabled
          : useEnabled

        const vmProvideEnabled = vmConfig?.provideEnabled !== undefined
          ? vmConfig.provideEnabled
          : provideEnabled

        // Check if service is running on this VM
        const running = this.isServiceRunning(vm.ports, service)

        // Count as enabled if either use or provide is enabled
        if (vmUseEnabled || vmProvideEnabled) {
          enabledVmCount++
        }

        // Count as running if service is actually running
        if (running) {
          runningVmCount++
        }

        return {
          vmId: vm.id,
          vmName: vm.name,
          useEnabled: vmUseEnabled,
          provideEnabled: vmProvideEnabled,
          running,
          inheritedFromDepartment
        }
      })

      return {
        departmentId: department.id,
        departmentName: department.name,
        serviceId: service.id,
        serviceName: service.displayName,
        useEnabled,
        provideEnabled,
        vmCount,
        enabledVmCount,
        runningVmCount,
        vms
      }
    })
  }

  // Apply a service setting to all VMs in a department
  async applyServiceToAllDepartmentVms (
    departmentId: string,
    serviceId: string,
    action: 'use' | 'provide',
    enabled: boolean
  ): Promise<DepartmentServiceStatus> {
    const service = getServiceById(serviceId)
    if (!service) {
      throw new Error(`Service with ID ${serviceId} not found`)
    }

    // First update the department-level configuration and apply rules to the department filter
    await this.toggleDepartmentService(departmentId, serviceId, action, enabled)

    // Get all VMs in the department
    const vms = await this.prisma.machine.findMany({
      where: { departmentId },
      select: { id: true, name: true }
    })

    // Validate that VMs have filter references to the department filter
    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      throw new Error(`Filter for department ${departmentId} not found`)
    }

    // Get or verify filter references for each VM
    const linkPromises = vms.map(async vm => {
      try {
        // Get VM filter
        const vmFilter = await this.getVmFilter(vm.id)
        if (!vmFilter) {
          console.error(`No filter found for VM ${vm.id}`)
          return
        }

        // Check if filter reference exists
        const filterRef = await this.prisma.filterReference.findFirst({
          where: {
            sourceFilterId: vmFilter.nwFilterId,
            targetFilterId: departmentFilter.nwFilterId
          }
        })

        // Create filter reference if it doesn't exist
        if (!filterRef) {
          console.log(`Creating filter reference for VM ${vm.name} to department filter`)
          await this.prisma.filterReference.create({
            data: {
              sourceFilterId: vmFilter.nwFilterId,
              targetFilterId: departmentFilter.nwFilterId
            }
          })

          // Ensure filter will be updated
          await this.prisma.nWFilter.update({
            where: { id: vmFilter.nwFilterId },
            data: { updatedAt: new Date() }
          })
        }

        // Update port records if providing service
        if (action === 'provide') {
          await this.updateVmPortRecords(vm.id, service, enabled)
        }
      } catch (error) {
        console.error(`Error linking VM ${vm.id} to department filter:`, error)
      }
    })

    // Wait for all filter references to be created/verified
    await Promise.all(linkPromises)

    // Return the updated department service status
    const status = await this.getDepartmentServiceStatus(departmentId, serviceId)
    return status[0]
  }

  // Clear all department-specific service configurations
  async clearDepartmentServiceConfigs (
    departmentId: string,
    serviceId?: string
  ): Promise<DepartmentServiceStatus[]> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: { serviceConfigs: true }
    })

    if (!department) {
      throw new Error(`Department with ID ${departmentId} not found`)
    }

    // Get the department filter
    const deptFilter = await this.getDepartmentFilter(departmentId)
    if (!deptFilter) {
      throw new Error(`Filter for department ${departmentId} not found`)
    }

    // If specific service is provided, only clear that one
    if (serviceId) {
      const service = getServiceById(serviceId)
      if (!service) {
        throw new Error(`Service with ID ${serviceId} not found`)
      }

      const deptConfig = await this.prisma.departmentServiceConfig.findUnique({
        where: {
          departmentId_serviceId: {
            departmentId,
            serviceId
          }
        }
      })

      if (deptConfig) {
        // Delete the configuration
        await this.prisma.departmentServiceConfig.delete({
          where: { id: deptConfig.id }
        })

        // Get global config to apply as fallback
        const globalConfig = await this.prisma.globalServiceConfig.findUnique({
          where: { serviceId }
        })

        // Apply global settings to department filter
        if (globalConfig) {
          await this.applyServiceRules(
            deptFilter.nwFilterId,
            service,
            'use',
            globalConfig.useEnabled
          )

          await this.applyServiceRules(
            deptFilter.nwFilterId,
            service,
            'provide',
            globalConfig.provideEnabled
          )
        } else {
          // If no global config, disable service
          await this.applyServiceRules(deptFilter.nwFilterId, service, 'use', false)
          await this.applyServiceRules(deptFilter.nwFilterId, service, 'provide', false)
        }
      }
    } else {
      // Delete all department service configurations
      await this.prisma.departmentServiceConfig.deleteMany({
        where: { departmentId }
      })

      // Get all global service configs for fallback
      const globalConfigs = await this.prisma.globalServiceConfig.findMany()

      // Apply global settings to all services
      for (const globalConfig of globalConfigs) {
        const service = getServiceById(globalConfig.serviceId)
        if (service) {
          await this.applyServiceRules(
            deptFilter.nwFilterId,
            service,
            'use',
            globalConfig.useEnabled
          )

          await this.applyServiceRules(
            deptFilter.nwFilterId,
            service,
            'provide',
            globalConfig.provideEnabled
          )
        }
      }
    }

    // Ensure filter will be updated
    await this.prisma.nWFilter.update({
      where: { id: deptFilter.nwFilterId },
      data: { needsFlush: true }
    })

    // Return the updated service status
    return this.getDepartmentServiceStatus(departmentId, serviceId)
  }

  // Get VMs in a department with service overrides
  async getVmsWithServiceOverrides (
    departmentId: string,
    serviceId: string
  ): Promise<{
    vmId: string;
    vmName: string;
    useEnabled: boolean;
    provideEnabled: boolean;
    useOverridden: boolean;
    provideOverridden: boolean;
  }[]> {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        serviceConfigs: {
          where: { serviceId }
        },
        machines: {
          include: {
            serviceConfigs: {
              where: { serviceId }
            }
          }
        }
      }
    })

    if (!department) {
      throw new Error(`Department with ID ${departmentId} not found`)
    }

    // Get department config for this service
    const deptConfig = department.serviceConfigs[0]

    // Get global config for inheritance
    const globalConfig = await this.prisma.globalServiceConfig.findUnique({
      where: { serviceId }
    })

    // Determine department settings with inheritance
    const deptUseEnabled = deptConfig?.useEnabled !== undefined
      ? deptConfig.useEnabled
      : globalConfig?.useEnabled ?? false

    const deptProvideEnabled = deptConfig?.provideEnabled !== undefined
      ? deptConfig.provideEnabled
      : globalConfig?.provideEnabled ?? false

    // Return VM overrides
    return department.machines.map(vm => {
      const vmConfig = vm.serviceConfigs[0] // We filtered for the specific serviceId

      // Determine if VM has explicit settings
      const useOverridden = vmConfig?.useEnabled !== undefined
      const provideOverridden = vmConfig?.provideEnabled !== undefined

      // VM has explicit config or inherits from department
      const useEnabled = vmConfig?.useEnabled !== undefined
        ? vmConfig.useEnabled
        : deptUseEnabled

      const provideEnabled = vmConfig?.provideEnabled !== undefined
        ? vmConfig.provideEnabled
        : deptProvideEnabled

      return {
        vmId: vm.id,
        vmName: vm.name,
        useEnabled,
        provideEnabled,
        useOverridden,
        provideOverridden
      }
    })
  }

  // Reset VM overrides to department defaults for a specific service
  async resetVmServiceOverridesToDepartment (
    departmentId: string,
    serviceId: string,
    vmIds: string[]
  ): Promise<{
    departmentId: string;
    serviceId: string;
    resetVmCount: number;
    successfulResets: { vmId: string; vmName: string }[];
    failedResets: { vmId: string; error: string }[];
  }> {
    const service = getServiceById(serviceId)
    if (!service) {
      throw new Error(`Service with ID ${serviceId} not found`)
    }

    // Get department filter
    const departmentFilter = await this.getDepartmentFilter(departmentId)
    if (!departmentFilter) {
      throw new Error(`Filter for department ${departmentId} not found`)
    }

    // Track results
    const successfulResets: { vmId: string; vmName: string }[] = []
    const failedResets: { vmId: string; error: string }[] = []

    // Process each VM
    for (const vmId of vmIds) {
      try {
        // Get VM name for reporting
        const vm = await this.prisma.machine.findUnique({
          where: { id: vmId },
          select: { name: true }
        })

        if (!vm) {
          failedResets.push({ vmId, error: 'VM not found' })
          continue
        }

        // Delete VM service config to remove overrides
        await this.prisma.vMServiceConfig.deleteMany({
          where: {
            vmId,
            serviceId
          }
        })

        // Get VM filter
        const vmFilter = await this.getVmFilter(vmId)
        if (!vmFilter) {
          failedResets.push({ vmId, error: 'VM filter not found' })
          continue
        }

        // Ensure VM filter references department filter
        const filterRef = await this.prisma.filterReference.findFirst({
          where: {
            sourceFilterId: vmFilter.nwFilterId,
            targetFilterId: departmentFilter.nwFilterId
          }
        })

        // Create filter reference if it doesn't exist
        if (!filterRef) {
          await this.prisma.filterReference.create({
            data: {
              sourceFilterId: vmFilter.nwFilterId,
              targetFilterId: departmentFilter.nwFilterId
            }
          })
        }

        // Remove any direct service rules from VM filter
        // This ensures VM will only inherit rules from department filter
        await this.prisma.fWRule.deleteMany({
          where: {
            nwFilterId: vmFilter.nwFilterId,
            comment: {
              contains: service.displayName
            }
          }
        })

        // Update port records if needed
        await this.updateVmPortRecords(vmId, service, false)

        // Ensure filter will be updated
        await this.prisma.nWFilter.update({
          where: { id: vmFilter.nwFilterId },
          data: { needsFlush: true }
        })

        successfulResets.push({ vmId, vmName: vm.name })
      } catch (error) {
        failedResets.push({
          vmId,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return {
      departmentId,
      serviceId,
      resetVmCount: successfulResets.length,
      successfulResets,
      failedResets
    }
  }

  // Get global service status
  async getGlobalServiceStatus (serviceId?: string): Promise<GlobalServiceStatus[]> {
    // Get global config for all services or specific one
    const globalConfigs = await this.prisma.globalServiceConfig.findMany(
      serviceId ? { where: { serviceId } } : undefined
    )

    // Get services to check
    const servicesToCheck = serviceId
      ? [getServiceById(serviceId)].filter(Boolean) as ServiceDefinition[]
      : KNOWN_SERVICES

    return servicesToCheck.map(service => {
      // Find config for this service
      const config = globalConfigs.find(
        config => config.serviceId === service.id
      )

      return {
        serviceId: service.id,
        serviceName: service.displayName,
        useEnabled: config?.useEnabled ?? false,
        provideEnabled: config?.provideEnabled ?? false
      }
    })
  }

  // Toggle global service settings
  async toggleGlobalService (
    serviceId: string,
    action: 'use' | 'provide',
    enabled: boolean
  ): Promise<GlobalServiceStatus> {
    const service = getServiceById(serviceId)
    if (!service) {
      throw new Error(`Service with ID ${serviceId} not found`)
    }

    // Get or create global service config
    let globalConfig = await this.prisma.globalServiceConfig.findUnique({
      where: { serviceId }
    })

    if (!globalConfig) {
      globalConfig = await this.prisma.globalServiceConfig.create({
        data: {
          serviceId,
          useEnabled: false,
          provideEnabled: false
        }
      })
    }

    // Update the service config
    globalConfig = await this.prisma.globalServiceConfig.update({
      where: { id: globalConfig.id },
      data: {
        useEnabled: action === 'use' ? enabled : globalConfig.useEnabled,
        provideEnabled: action === 'provide' ? enabled : globalConfig.provideEnabled
      }
    })

    // Return the updated status
    const status = await this.getGlobalServiceStatus(serviceId)
    return status[0]
  }

  // Apply service rules
  private async applyServiceRules (
    filterId: string,
    service: ServiceDefinition,
    action: 'use' | 'provide',
    enabled: boolean
  ): Promise<void> {
    if (enabled) {
      // Add rules for this service
      await this.addServiceRules(filterId, service, action)
    } else {
      // Remove rules for this service
      await this.removeServiceRules(filterId, service, action)
    }
  }

  // Add service rules to a filter
  private async addServiceRules (
    filterId: string,
    service: ServiceDefinition,
    action: 'use' | 'provide'
  ): Promise<void> {
    for (const port of service.ports) {
      if (action === 'use') {
        // Outbound rule for using service
        await this.networkFilterService.createRule(
          filterId,
          'accept',
          'out',
          500, // Medium priority
          port.protocol,
          undefined, // No simple port, use range
          {
            dstPortStart: port.portStart,
            dstPortEnd: port.portEnd,
            comment: `Allow using ${service.displayName} service`,
            state: { established: true, related: true }
          }
        )
      } else {
        // Inbound rule for providing service
        await this.networkFilterService.createRule(
          filterId,
          'accept',
          'in',
          500, // Medium priority
          port.protocol,
          undefined, // No simple port, use range
          {
            dstPortStart: port.portStart,
            dstPortEnd: port.portEnd,
            comment: `Allow providing ${service.displayName} service`
          }
        )

        // Allow established outbound connections for server responses
        await this.networkFilterService.createRule(
          filterId,
          'accept',
          'out',
          499, // Higher priority than regular rules
          port.protocol,
          undefined, // No simple port, use range
          {
            srcPortStart: port.portStart,
            srcPortEnd: port.portEnd,
            comment: `Allow outbound traffic for ${service.displayName} service`,
            state: { established: true, related: true }
          }
        )
      }
    }
  }

  // Remove service rules from a filter
  private async removeServiceRules (
    filterId: string,
    service: ServiceDefinition,
    action: 'use' | 'provide'
  ): Promise<void> {
    // Find rules by comment and direction
    const commentPattern = `${action === 'use' ? 'Allow using' : 'Allow providing'} ${service.displayName}`

    const rules = await this.prisma.fWRule.findMany({
      where: {
        nwFilterId: filterId,
        comment: {
          contains: service.displayName
        },
        direction: action === 'use' ? 'out' : 'in'
      }
    })

    // Delete all matching rules
    for (const rule of rules) {
      await this.prisma.fWRule.delete({
        where: { id: rule.id }
      })
    }

    // Also delete related inbound/outbound rules for responses if they exist
    if (action === 'use') {
      const responseRules = await this.prisma.fWRule.findMany({
        where: {
          nwFilterId: filterId,
          direction: 'in',
          comment: {
            contains: `${service.displayName} service responses`
          }
        }
      })

      for (const rule of responseRules) {
        await this.prisma.fWRule.delete({
          where: { id: rule.id }
        })
      }
    } else {
      // Find and delete outbound response rules for 'provide' action
      const outboundResponseRules = await this.prisma.fWRule.findMany({
        where: {
          nwFilterId: filterId,
          direction: 'out',
          comment: {
            contains: `outbound traffic for ${service.displayName}`
          }
        }
      })

      for (const outboundRule of outboundResponseRules) {
        await this.prisma.fWRule.delete({
          where: { id: outboundRule.id }
        })
      }
    }
  }

  // Update VM port records for service visibility
  private async updateVmPortRecords (
    vmId: string,
    service: ServiceDefinition,
    enabled: boolean
  ): Promise<void> {
    for (const port of service.ports) {
      const existingPort = await this.prisma.vmPort.findFirst({
        where: {
          vmId,
          protocol: port.protocol,
          portStart: port.portStart,
          portEnd: port.portEnd
        }
      })

      if (existingPort) {
        // Update existing port record
        await this.prisma.vmPort.update({
          where: { id: existingPort.id },
          data: {
            enabled,
            toEnable: enabled,
            lastSeen: new Date()
          }
        })
      } else if (enabled) {
        // Create new port record if enabling
        await this.prisma.vmPort.create({
          data: {
            vmId,
            protocol: port.protocol,
            portStart: port.portStart,
            portEnd: port.portEnd,
            running: false,
            enabled: true,
            toEnable: true,
            lastSeen: new Date()
          }
        })
      }
    }
  }
}
