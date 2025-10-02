import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql'
import { UserInputError } from 'apollo-server-errors'
import { DepartmentType, UpdateDepartmentNameInput } from './type'
import { InfinibayContext } from '../../../utils/context'
import { getEventManager } from '../../../services/EventManager'

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
      totalMachines: department.machines.length
    }
  }

  @Mutation(() => DepartmentType)
  @Authorized('ADMIN')
  async createDepartment (
    @Arg('name') name: string,
    @Ctx() { prisma, user }: InfinibayContext
  ): Promise<DepartmentType> {
    const department = await prisma.department.create({
      data: { name }
    })

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
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined,
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
    // delete department
    const deletedDepartment = await prisma.department.delete({
      where: { id }
    })

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
      id: deletedDepartment.id,
      name: deletedDepartment.name,
      createdAt: deletedDepartment.createdAt,
      internetSpeed: deletedDepartment.internetSpeed || undefined,
      ipSubnet: deletedDepartment.ipSubnet || undefined,
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
      totalMachines: department.machines.length
    }
  }
}
