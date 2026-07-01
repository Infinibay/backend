import { DepartmentRole, PrismaClient } from '@prisma/client'
import { UserInputError } from '@utils/errors'

const MEMBERSHIP_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true
} as const

/**
 * Manages explicit, role-bearing membership of users in departments.
 *
 * This is the data layer behind department-scoped permissions: a department
 * MANAGER can operate that department's resources without being a global
 * ADMIN. Authorization helpers (authChecker) read these rows to widen a
 * user's accessible-department set.
 */
export class DepartmentMembershipService {
  constructor (private readonly prisma: PrismaClient) {}

  async list (departmentId: string) {
    return this.prisma.departmentMembership.findMany({
      where: { departmentId },
      include: { user: { select: MEMBERSHIP_USER_SELECT } },
      orderBy: { createdAt: 'asc' }
    })
  }

  async setMember (departmentId: string, userId: string, role: DepartmentRole) {
    const department = await this.prisma.department.findUnique({ where: { id: departmentId } })
    // Use a mapped GraphQLError (BAD_USER_INPUT) rather than a plain Error so the
    // apollo formatError boundary returns a clean error instead of an
    // INTERNAL_SERVER_ERROR carrying a stacktrace extension on non-prod deploys.
    if (!department) throw new UserInputError('Department not found')
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.deleted) throw new UserInputError('User not found')

    return this.prisma.departmentMembership.upsert({
      where: { departmentId_userId: { departmentId, userId } },
      create: { departmentId, userId, role },
      update: { role },
      include: { user: { select: MEMBERSHIP_USER_SELECT } }
    })
  }

  async removeMember (departmentId: string, userId: string): Promise<boolean> {
    const res = await this.prisma.departmentMembership.deleteMany({
      where: { departmentId, userId }
    })
    return res.count > 0
  }

  /** Department ids where the user holds any membership (used for scoping). */
  async departmentIdsForUser (userId: string): Promise<string[]> {
    const rows = await this.prisma.departmentMembership.findMany({
      where: { userId },
      select: { departmentId: true }
    })
    return rows.map((r) => r.departmentId)
  }

  /** True if the user is a MANAGER of the given department. */
  async isManager (userId: string, departmentId: string): Promise<boolean> {
    const row = await this.prisma.departmentMembership.findUnique({
      where: { departmentId_userId: { departmentId, userId } }
    })
    return row?.role === DepartmentRole.MANAGER
  }
}
