import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql';
import { UserInputError } from 'apollo-server-errors'
import { DepartmentType } from './type';
import { InfinibayContext } from '../../../utils/context';

@Resolver(DepartmentType)
export class DepartmentResolver {
  @Query(() => [DepartmentType])
  @Authorized('USER')
  async departments(
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType[]> {
    const departments = await prisma.department.findMany({ include: { machines: true } });
    let response = [];
    for (let index = 0; index < departments.length; index++) {
      const dep = departments[index];
      response.push({
        id: dep.id,
        name: dep.name,
        createdAt: dep.createdAt,
        internetSpeed: dep.internetSpeed || undefined,
        ipSubnet: dep.ipSubnet || undefined,
        totalMachines: dep.machines.length,
      });

    }

    return response;
  }

  @Query(() => DepartmentType, { nullable: true })
  @Authorized('USER')
  async department(
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType | null> {
    const department = await prisma.department.findUnique({
      where: { id },
      include: { machines: true }
    });

    if (!department) {
      return null;
    }

    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined,
      totalMachines: department.machines.length,
    };
  }

  @Mutation(() => DepartmentType)
  @Authorized('ADMIN')
  async createDepartment(
    @Arg('name') name: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType> {
    const department = await prisma.department.create({
      data: { name }
    });
    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined,
      totalMachines: 0,
    };
  }

  // Destroy department
  @Mutation(() => DepartmentType)
  @Authorized('ADMIN')
  async destroyDepartment(
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType> {
    // Check if deparment exist, if not, error, if yes, dlete it
    const department = await prisma.department.findUnique({
      where: { id }
    });
    if (!department) {
      throw new UserInputError('Department not found');
    }
    // check if there are machines in the department, if yes, error, if no, delete it
    const machines = await prisma.machine.findMany({
      where: { departmentId: id }
    });
    if (machines.length > 0) {
      throw new UserInputError('Cannot delete department with machines');
    }
    // delete department
    const deletedDepartment = await prisma.department.delete({
      where: { id }
    });
    return {
      id: deletedDepartment.id,
      name: deletedDepartment.name,
      createdAt: deletedDepartment.createdAt,
      internetSpeed: deletedDepartment.internetSpeed || undefined,
      ipSubnet: deletedDepartment.ipSubnet || undefined,
      totalMachines: 0,
    };
  }

  // find deparment by name
  @Query(() => DepartmentType, { nullable: true })
  @Authorized('USER')
  async findDepartmentByName(
    @Arg('name') name: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType | null> {
    const department = await prisma.department.findFirst({
      where: { name },
      include: { machines: true }
    });
    if (!department) {
      return null;
    }
    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined,
      totalMachines: department.machines.length,
    };
  }
}