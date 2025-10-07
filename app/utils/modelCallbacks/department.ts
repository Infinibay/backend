import { PrismaClient, Prisma } from '@prisma/client'

export async function afterCreateDepartment (
  prisma: PrismaClient,
  args: Prisma.DepartmentCreateArgs,
  result: any
): Promise<void> {
  // Firewall system removed - no post-creation actions needed
}
