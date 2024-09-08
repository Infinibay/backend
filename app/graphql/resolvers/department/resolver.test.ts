import { PrismaClient } from '@prisma/client';
import { DepartmentResolver } from './resolver';
import { InfinibayContext } from '../../../utils/context';

const prisma = new PrismaClient();

describe('DepartmentResolver', () => {
  let resolver: DepartmentResolver;
  let context: InfinibayContext;

  beforeEach(() => {
    resolver = new DepartmentResolver();
    context = { prisma } as InfinibayContext;
  });

  afterEach(async () => {
    await prisma.department.deleteMany();
  });

  describe('departments', () => {
    it('should return all departments', async () => {
      await prisma.department.createMany({
        data: [
          { name: 'Sales' },
          { name: 'Marketing' },
          { name: 'Engineering' },
        ],
      });

      const result = await resolver.departments(context);

      expect(result).toHaveLength(3);
      expect(result.map(d => d.name)).toEqual(['Sales', 'Marketing', 'Engineering']);
    });
  });

  describe('createDepartment', () => {
    it('should create a new department', async () => {
      const result = await resolver.createDepartment('Human Resources', context);

      expect(result).toHaveProperty('id');
      expect(result.name).toBe('Human Resources');
    });
  });
});