import { Resolver, Query, Mutation, Arg, Ctx, Authorized } from 'type-graphql';
import { DepartmentType } from './type';
import { InfinibayContext } from '../../../utils/context';

@Resolver(DepartmentType)
export class DepartmentResolver {
  @Query(() => [DepartmentType])
  @Authorized('USER')
  async departments(
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType[]> {
    const departments = await prisma.department.findMany();
    return departments.map(dept => ({
      id: dept.id,
      name: dept.name,
      createdAt: dept.createdAt,
      internetSpeed: dept.internetSpeed || undefined,
      ipSubnet: dept.ipSubnet || undefined
    }));
  }

  @Query(() => DepartmentType, { nullable: true })
  @Authorized('USER')
  async department(
    @Arg('id') id: string,
    @Ctx() { prisma }: InfinibayContext
  ): Promise<DepartmentType | null> {
    const department = await prisma.department.findUnique({
      where: { id }
    });

    if (!department) {
      return null;
    }

    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined
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
      ipSubnet: department.ipSubnet || undefined
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
      throw new Error('Department not found');
    }
    const deletedDepartment = await prisma.department.delete({
      where: { id }
    });
    return {
      id: deletedDepartment.id,
      name: deletedDepartment.name,
      createdAt: deletedDepartment.createdAt,
      internetSpeed: deletedDepartment.internetSpeed || undefined,
      ipSubnet: deletedDepartment.ipSubnet || undefined
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
      where: { name }
    });
    if (!department) {
      return null;
    }
    return {
      id: department.id,
      name: department.name,
      createdAt: department.createdAt,
      internetSpeed: department.internetSpeed || undefined,
      ipSubnet: department.ipSubnet || undefined
    };
  }
}