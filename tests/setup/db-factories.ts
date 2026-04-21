/**
 * Integration-test factories — write real rows into the test database.
 *
 * Each factory is standalone and accepts an optional `overrides` partial so
 * tests can customise only the fields they care about. Unique constraints
 * (emails, internal names) are defaulted with a timestamp+random suffix so
 * two tests in the same file never collide inside one beforeEach.
 *
 * Compare with mock-factories.ts, which returns plain objects for unit tests.
 * This module actually writes to Postgres and returns the created row.
 */

import { PrismaClient, User, Department, MachineTemplate, MachineTemplateCategory, Machine, Application, VMHealthSnapshot } from '@prisma/client'
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'

// Cheap hash (4 rounds) — tests don't care about cryptographic strength.
const TEST_PASSWORD_HASH = bcrypt.hashSync('TestPass123!', 4)

function unique (prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

export async function createUser (
  prisma: PrismaClient,
  overrides: Partial<User> = {}
): Promise<User> {
  const id = overrides.id ?? randomUUID()
  return prisma.user.create({
    data: {
      id,
      email: overrides.email ?? `user-${id}@test.infinibay`,
      password: overrides.password ?? TEST_PASSWORD_HASH,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? 'User',
      deleted: overrides.deleted ?? false,
      role: overrides.role ?? 'USER',
      token: overrides.token ?? 'null',
    }
  })
}

export function createAdmin (prisma: PrismaClient, overrides: Partial<User> = {}): Promise<User> {
  return createUser(prisma, { firstName: 'Admin', role: 'ADMIN', ...overrides })
}

export async function createDepartment (
  prisma: PrismaClient,
  overrides: Partial<Department> = {}
): Promise<Department> {
  return prisma.department.create({
    data: {
      name: overrides.name ?? unique('dept'),
      bridgeName: overrides.bridgeName ?? null,
      ...(overrides.id ? { id: overrides.id } : {})
    }
  })
}

export async function createTemplateCategory (
  prisma: PrismaClient,
  overrides: Partial<MachineTemplateCategory> = {}
): Promise<MachineTemplateCategory> {
  return prisma.machineTemplateCategory.create({
    data: {
      name: overrides.name ?? unique('category'),
      description: overrides.description ?? 'test category',
    }
  })
}

export async function createTemplate (
  prisma: PrismaClient,
  overrides: Partial<MachineTemplate> & { categoryId?: string } = {}
): Promise<MachineTemplate> {
  const categoryId = overrides.categoryId ?? (await createTemplateCategory(prisma)).id
  return prisma.machineTemplate.create({
    data: {
      name: overrides.name ?? unique('template'),
      cores: overrides.cores ?? 4,
      ram: overrides.ram ?? 8,
      storage: overrides.storage ?? 100,
      categoryId,
    }
  })
}

export async function createApplication (
  prisma: PrismaClient,
  overrides: Partial<Application> = {}
): Promise<Application> {
  return prisma.application.create({
    data: {
      name: overrides.name ?? unique('app'),
      description: overrides.description ?? 'Test app',
      os: overrides.os ?? ['linux'],
      installCommand: overrides.installCommand ?? 'echo install',
      parameters: overrides.parameters ?? {},
    }
  })
}

export interface CreateMachineOptions {
  userId: string
  departmentId: string
  overrides?: Partial<Machine>
  /** If true, also create a default MachineConfiguration row. */
  withConfiguration?: boolean
}

export async function createMachine (
  prisma: PrismaClient,
  opts: CreateMachineOptions
): Promise<Machine> {
  const { userId, departmentId, overrides = {}, withConfiguration = false } = opts
  return prisma.machine.create({
    data: {
      ...(overrides.id ? { id: overrides.id } : {}),
      name: overrides.name ?? unique('vm'),
      internalName: overrides.internalName ?? unique('internal'),
      status: overrides.status ?? 'stopped',
      os: overrides.os ?? 'ubuntu',
      cpuCores: overrides.cpuCores ?? 2,
      ramGB: overrides.ramGB ?? 4,
      diskSizeGB: overrides.diskSizeGB ?? 50,
      userId,
      departmentId,
      ...(withConfiguration
        ? {
            configuration: {
              create: {
                graphicPort: 5900,
                graphicProtocol: 'spice',
                graphicHost: 'localhost',
                graphicPassword: null,
              }
            }
          }
        : {})
    }
  })
}

export interface CreateHealthSnapshotOptions {
  machineId: string
  overallStatus?: string
  diskSpaceInfo?: any
  resourceOptInfo?: any
  windowsUpdateInfo?: any
  defenderStatus?: any
  osType?: string
}

export async function createHealthSnapshot (
  prisma: PrismaClient,
  opts: CreateHealthSnapshotOptions
): Promise<VMHealthSnapshot> {
  const data: any = {
    machineId: opts.machineId,
    overallStatus: opts.overallStatus ?? 'HEALTHY',
    checksCompleted: 1,
    checksFailed: 0,
    osType: opts.osType ?? 'linux',
  }
  if (opts.diskSpaceInfo !== undefined) data.diskSpaceInfo = opts.diskSpaceInfo
  if (opts.resourceOptInfo !== undefined) data.resourceOptInfo = opts.resourceOptInfo
  if (opts.windowsUpdateInfo !== undefined) data.windowsUpdateInfo = opts.windowsUpdateInfo
  if (opts.defenderStatus !== undefined) data.defenderStatus = opts.defenderStatus
  return prisma.vMHealthSnapshot.create({ data })
}

/**
 * One-shot "typical test setup" — an admin, a regular user, a department, a
 * template, and an application. Call this in beforeEach when the test needs
 * the full fixture set. Returns an object of the created rows.
 */
export async function seedBaseFixtures (prisma: PrismaClient) {
  const admin = await createAdmin(prisma)
  const user = await createUser(prisma)
  const department = await createDepartment(prisma)
  const template = await createTemplate(prisma)
  const application = await createApplication(prisma)
  return { admin, user, department, template, application }
}
