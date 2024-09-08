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
}