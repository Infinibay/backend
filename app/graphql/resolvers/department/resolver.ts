import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-errors'
import { DepartmentType, UpdateDepartmentNameInput } from './type'
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
      totalMachines: department.machines.length
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
