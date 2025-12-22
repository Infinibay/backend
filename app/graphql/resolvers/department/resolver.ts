import { Resolver, Query, Mutation, Arg, Ctx, Authorized, Int } from 'type-graphql'
import { UserInputError } from 'apollo-server-errors'
import { DepartmentType, UpdateDepartmentNameInput, UpdateDepartmentNetworkInput, DepartmentNetworkDiagnosticsType, DhcpTrafficCaptureType } from './type'
import { InfinibayContext } from '../../../utils/context'
import { getEventManager } from '../../../services/EventManager'
import { DepartmentCleanupService } from '../../../services/cleanup/departmentCleanupService'
import { DepartmentNetworkService } from '../../../services/network/DepartmentNetworkService'

@Resolver(DepartmentType)
export class DepartmentResolver {
  @Query(() => [DepartmentType])
  @Authorized('USER')
  async departments (
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType[]> {
    const departments = await prisma.department.findMany({ include: { machines: true } })
    const response = []
    for (let index = 0; index < departments.length; index++) {
      const dep = departments[index]
      response.push({
        id: dep.id,
        name: dep.name,
        createdAt: dep.createdAt,
        internetSpeed: dep.internetSpeed || undefined,
        ipSubnet: dep.ipSubnet || undefined,
        bridgeName: dep.bridgeName || undefined,
        gatewayIP: dep.gatewayIP || undefined,
        dnsServers: dep.dnsServers,
        ntpServers: dep.ntpServers,
        totalMachines: dep.machines.length
      })
    }

    return response
  }

  @Query(() => DepartmentType, { nullable: true })
  @Authorized('USER')
  async department (
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType | null> {
    const department = await prisma.department.findUnique({
      where: { id },
      include: { machines: true }
    })

    if (!department) {
      return null
    }

    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined,
      bridgeName: department.bridgeName || undefined,
      gatewayIP: department.gatewayIP || undefined,
      dnsServers: department.dnsServers,
      ntpServers: department.ntpServers,
      totalMachines: department.machines.length
    }
  }

  @Mutation(() => DepartmentType)
  @Authorized('ADMIN')
  async createDepartment (
    @Arg('name') name: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DepartmentType> {
    // Auto-assign the next available subnet
    const ipSubnet = await this.getNextAvailableSubnet(prisma)

    // Create department with ipSubnet
    const department = await prisma.department.create({
      data: {
        name,
        ipSubnet
      }
    })

    // Configure network infrastructure (bridge, dnsmasq, NAT)
    // If this fails, the department creation should fail
    const networkService = new DepartmentNetworkService(prisma)
    try {
      await networkService.configureNetwork(department.id, ipSubnet)
    } catch (networkError) {
      // Network configuration failed - delete the department and throw
      console.error(`Failed to configure network for department ${department.id}:`, networkError)
      await prisma.department.delete({ where: { id: department.id } })
      const errorMessage = networkError instanceof Error ? networkError.message : String(networkError)
      throw new UserInputError(`Failed to configure department network: ${errorMessage}`)
    }

    // Get updated department with network info
    const updatedDepartment = await prisma.department.findUnique({
      where: { id: department.id }
    })

    if (!updatedDepartment) {
      throw new UserInputError('Department was created but could not be retrieved')
    }

    // Trigger real-time event for department creation
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('departments', 'create', { id: department.id }, user?.id)
      console.log(`🎯 Triggered real-time event: departments:create for department ${department.id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return {
      id: updatedDepartment.id,
      name: updatedDepartment.name,
      createdAt: updatedDepartment.createdAt,
      internetSpeed: updatedDepartment.internetSpeed || undefined,
      ipSubnet: updatedDepartment.ipSubnet || undefined,
      bridgeName: updatedDepartment.bridgeName || undefined,
      gatewayIP: updatedDepartment.gatewayIP || undefined,
      dnsServers: updatedDepartment.dnsServers,
      ntpServers: updatedDepartment.ntpServers,
      totalMachines: 0
    }
  }

  // Destroy department
  @Mutation(() => DepartmentType)
  @Authorized('ADMIN')
  async destroyDepartment (
    @Arg('id') id: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DepartmentType> {
    // Check if deparment exist, if not, error, if yes, dlete it
    const department = await prisma.department.findUnique({
      where: { id }
    })
    if (!department) {
      throw new UserInputError('Department not found')
    }
    // check if there are machines in the department, if yes, error, if no, delete it
    const machines = await prisma.machine.findMany({
      where: { departmentId: id }
    })
    if (machines.length > 0) {
      throw new UserInputError('Cannot delete department with machines')
    }

    // Use cleanup service to properly remove department and associated resources
    const cleanupService = new DepartmentCleanupService(prisma)
    await cleanupService.cleanupDepartment(id)

    // Trigger real-time event for department deletion
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('departments', 'delete', { id }, user?.id)
      console.log(`🎯 Triggered real-time event: departments:delete for department ${id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined,
      bridgeName: department.bridgeName || undefined,
      gatewayIP: department.gatewayIP || undefined,
      dnsServers: department.dnsServers,
      ntpServers: department.ntpServers,
      totalMachines: 0
    }
  }

  @Mutation(() => DepartmentType)
  @Authorized('ADMIN')
  async updateDepartmentName (
    @Arg('input') input: UpdateDepartmentNameInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DepartmentType> {
    const { id, name } = input

    // Check if department exists
    const department = await prisma.department.findUnique({
      where: { id },
      include: { machines: true }
    })

    if (!department) {
      throw new UserInputError('Department not found')
    }

    // Validate name is not empty
    if (!name || name.trim() === '') {
      throw new UserInputError('Department name cannot be empty')
    }

    // Check if name is already taken by another department
    const existingDepartment = await prisma.department.findFirst({
      where: {
        name: name.trim(),
        id: { not: id } // Exclude the current department
      }
    })

    if (existingDepartment) {
      throw new UserInputError(`Department name "${name.trim()}" is already taken`)
    }

    // Update the department name
    const updatedDepartment = await prisma.department.update({
      where: { id },
      data: { name: name.trim() },
      include: { machines: true }
    })

    // Trigger real-time event for department update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('departments', 'update', { id: updatedDepartment.id }, user?.id)
      console.log(`🎯 Triggered real-time event: departments:update for department ${updatedDepartment.id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
      // Don't fail the main operation if event triggering fails
    }

    return {
      id: updatedDepartment.id,
      name: updatedDepartment.name,
      createdAt: updatedDepartment.createdAt,
      internetSpeed: updatedDepartment.internetSpeed || undefined,
      ipSubnet: updatedDepartment.ipSubnet || undefined,
      bridgeName: updatedDepartment.bridgeName || undefined,
      gatewayIP: updatedDepartment.gatewayIP || undefined,
      dnsServers: updatedDepartment.dnsServers,
      ntpServers: updatedDepartment.ntpServers,
      totalMachines: updatedDepartment.machines.length
    }
  }

  // find deparment by name
  @Query(() => DepartmentType, { nullable: true })
  @Authorized('USER')
  async findDepartmentByName (
    @Arg('name') name: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType | null> {
    const department = await prisma.department.findFirst({
      where: { name },
      include: { machines: true }
    })
    if (!department) {
      return null
    }
    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined,
      bridgeName: department.bridgeName || undefined,
      gatewayIP: department.gatewayIP || undefined,
      dnsServers: department.dnsServers,
      ntpServers: department.ntpServers,
      totalMachines: department.machines.length
    }
  }

  @Mutation(() => DepartmentType)
  @Authorized('ADMIN')
  async updateDepartmentNetwork (
    @Arg('input') input: UpdateDepartmentNetworkInput,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DepartmentType> {
    const { id, dnsServers, ntpServers } = input

    // Check if department exists
    const department = await prisma.department.findUnique({
      where: { id },
      include: { machines: true }
    })

    if (!department) {
      throw new UserInputError('Department not found')
    }

    // Validate DNS servers (IPv4 addresses or hostnames)
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

    if (dnsServers !== undefined) {
      if (dnsServers.length === 0) {
        throw new UserInputError('At least one DNS server is required')
      }
      for (const dns of dnsServers) {
        if (!ipv4Regex.test(dns) && !hostnameRegex.test(dns)) {
          throw new UserInputError(`Invalid DNS server: ${dns}. Must be a valid IPv4 address or hostname`)
        }
        // Reject invalid private IPs
        if (dns.startsWith('127.') || dns.startsWith('169.254.')) {
          throw new UserInputError(`Invalid DNS server: ${dns}. Loopback and link-local addresses are not allowed`)
        }
      }
    }

    if (ntpServers !== undefined) {
      for (const ntp of ntpServers) {
        if (!ipv4Regex.test(ntp) && !hostnameRegex.test(ntp)) {
          throw new UserInputError(`Invalid NTP server: ${ntp}. Must be a valid IPv4 address or hostname`)
        }
      }
    }

    // Update department with new DNS/NTP servers
    const updatedDepartment = await prisma.department.update({
      where: { id },
      data: {
        ...(dnsServers !== undefined && { dnsServers }),
        ...(ntpServers !== undefined && { ntpServers })
      },
      include: { machines: true }
    })

    // Restart dnsmasq to apply changes (if department has network configured)
    if (department.bridgeName && department.ipSubnet && department.dnsmasqPid) {
      const networkService = new DepartmentNetworkService(prisma)
      try {
        await networkService.restartDnsmasq(id)
      } catch (networkError) {
        console.error(`Failed to restart dnsmasq for department ${id}:`, networkError)
        // Don't fail the mutation, just log the error - the new config will be applied on next restart
      }
    }

    // Trigger real-time event for department update
    try {
      const eventManager = getEventManager()
      await eventManager.dispatchEvent('departments', 'update', { id: updatedDepartment.id }, user?.id)
      console.log(`🎯 Triggered real-time event: departments:update for department ${updatedDepartment.id}`)
    } catch (eventError) {
      console.error('Failed to trigger real-time event:', eventError)
    }

    return {
      id: updatedDepartment.id,
      name: updatedDepartment.name,
      createdAt: updatedDepartment.createdAt,
      internetSpeed: updatedDepartment.internetSpeed || undefined,
      ipSubnet: updatedDepartment.ipSubnet || undefined,
      bridgeName: updatedDepartment.bridgeName || undefined,
      gatewayIP: updatedDepartment.gatewayIP || undefined,
      dnsServers: updatedDepartment.dnsServers,
      ntpServers: updatedDepartment.ntpServers,
      totalMachines: updatedDepartment.machines.length
    }
  }

  /**
   * Gets comprehensive network diagnostics for a department.
   * Checks bridge, dnsmasq, br_netfilter, and NAT status.
   */
  @Query(() => DepartmentNetworkDiagnosticsType)
  @Authorized('ADMIN')
  async departmentNetworkDiagnostics (
    @Arg('departmentId') departmentId: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentNetworkDiagnosticsType> {
    const networkService = new DepartmentNetworkService(prisma)

    try {
      return await networkService.diagnoseDepartmentNetwork(departmentId)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new UserInputError(`Failed to get network diagnostics: ${errorMessage}`)
    }
  }

  /**
   * Captures DHCP traffic on a department's bridge for debugging.
   * Returns captured packets with summary statistics.
   */
  @Query(() => DhcpTrafficCaptureType)
  @Authorized('ADMIN')
  async captureDepartmentDhcpTraffic (
    @Arg('departmentId') departmentId: string,
    @Arg('durationSeconds', () => Int, { defaultValue: 30 }) durationSeconds: number,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DhcpTrafficCaptureType> {
    // Validate duration
    if (durationSeconds < 5 || durationSeconds > 120) {
      throw new UserInputError('Duration must be between 5 and 120 seconds')
    }

    const networkService = new DepartmentNetworkService(prisma)

    try {
      return await networkService.captureDhcpTraffic(departmentId, durationSeconds)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new UserInputError(`Failed to capture DHCP traffic: ${errorMessage}`)
    }
  }

  /**
   * Finds the next available subnet for a new department.
   * Uses pattern 10.10.X.0/24 where X starts at 1 and increments.
   * Finds gaps in existing subnets to reuse freed numbers.
   */
  private async getNextAvailableSubnet (prisma: any): Promise<string> {
    // Get all existing subnets
    const departments = await prisma.department.findMany({
      where: { ipSubnet: { not: null } },
      select: { ipSubnet: true }
    })

    // Extract the third octet from each subnet (10.10.X.0/24)
    const usedOctets = new Set<number>()
    for (const dept of departments) {
      if (dept.ipSubnet) {
        const match = dept.ipSubnet.match(/^10\.10\.(\d+)\.0\/24$/)
        if (match && match[1]) {
          usedOctets.add(parseInt(match[1], 10))
        }
      }
    }

    // Find the first available octet starting from 1
    // Max is 254 (10.10.254.0/24)
    for (let octet = 1; octet <= 254; octet++) {
      if (!usedOctets.has(octet)) {
        return `10.10.${octet}.0/24`
      }
    }

    throw new UserInputError('No available subnets remaining. Maximum of 254 departments reached.')
  }
}
