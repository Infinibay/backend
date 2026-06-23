import 'reflect-metadata'
import { RecommendationType } from '@prisma/client'
import { buildSchema } from 'type-graphql'
import { graphql } from 'graphql'
import { testPrisma } from '../setup/jest.setup'
import { VMRecommendationService } from '../../app/services/VMRecommendationService'
import { VMRecommendationResolver } from '../../app/graphql/resolvers/VMRecommendationResolver'
import { InfinibayContext } from '../../app/utils/context'
import '../../app/graphql/types/RecommendationTypes'
import { RECOMMENDATION_TEST_QUERIES } from '../setup/recommendation-test-helpers'
import {
  createUser,
  createAdmin,
  createDepartment,
  createMachine,
  createHealthSnapshot
} from '../setup/db-factories'
import { seedSystemRoles } from '../setup/permission-factories'

// PackageManager touches the DB in its constructor via loadAll(); mock it out —
// it's unrelated to the recommendation service under test.
jest.mock('../../app/services/packages/PackageManager', () => ({
  getPackageManager: jest.fn().mockReturnValue({
    loadAll: jest.fn().mockResolvedValue(undefined),
    getPackageStatuses: jest.fn().mockReturnValue([]),
    runCheckers: jest.fn().mockResolvedValue([])
  }),
  PackageManager: jest.fn()
}))

describe('Recommendation flow — real database', () => {
  const prisma = testPrisma.prisma
  let service: VMRecommendationService
  let resolver: VMRecommendationResolver
  let schema: any

  let owner: Awaited<ReturnType<typeof createUser>>
  let admin: Awaited<ReturnType<typeof createAdmin>>
  let stranger: Awaited<ReturnType<typeof createUser>>
  let department: Awaited<ReturnType<typeof createDepartment>>
  let machine: Awaited<ReturnType<typeof createMachine>>

  beforeAll(async () => {
    schema = await buildSchema({
      resolvers: [VMRecommendationResolver] as any,
      authChecker: ({ context }: { context: InfinibayContext }) => !!context.user
    })
  })

  afterEach(() => {
    // VMRecommendationService's constructor starts setInterval + setTimeout
    // for background maintenance; dispose() clears them so Jest can exit.
    ;(service as any)?.dispose?.()
  })

  beforeEach(async () => {
    // The service constructor fires a one-shot setTimeout that jest.dispose()
    // doesn't clear. Install fake timers while constructing so the timeout is
    // captured into the fake queue and never fires.
    jest.useFakeTimers({ advanceTimers: false })
    service = new VMRecommendationService(prisma)
    jest.useRealTimers()
    resolver = new VMRecommendationResolver()

    // Action/verb RBAC: seed the system roles and link each test user so their
    // effective grants resolve (owner/stranger → USER own-scope, admin → ADMIN).
    await seedSystemRoles(prisma)
    const userRole = await prisma.role.findUnique({ where: { key: 'USER' } })
    const adminRole = await prisma.role.findUnique({ where: { key: 'ADMIN' } })
    owner = await createUser(prisma)
    await prisma.user.update({ where: { id: owner.id }, data: { roleId: userRole!.id } })
    admin = await createAdmin(prisma)
    await prisma.user.update({ where: { id: admin.id }, data: { roleId: adminRole!.id } })
    stranger = await createUser(prisma)
    await prisma.user.update({ where: { id: stranger.id }, data: { roleId: userRole!.id } })
    department = await createDepartment(prisma)
    machine = await createMachine(prisma, {
      userId: owner.id,
      departmentId: department.id,
      overrides: { status: 'running', cpuCores: 4, ramGB: 8, diskSizeGB: 100 }
    })
  })

  function makeContext (user: typeof owner | typeof admin | typeof stranger | null): InfinibayContext {
    return {
      prisma,
      user,
      req: {} as any,
      res: {} as any,
      setupMode: false,
      virtioSocketWatcher: {} as any
    } as unknown as InfinibayContext
  }

  async function seedCriticalDiskSnapshot () {
    return createHealthSnapshot(prisma, {
      machineId: machine.id,
      overallStatus: 'CRITICAL',
      diskSpaceInfo: { 'C:': { used: 96, total: 100 } }
    })
  }

  describe('generateRecommendations', () => {
    it('persists a disk-space recommendation when the latest snapshot shows critical usage', async () => {
      await seedCriticalDiskSnapshot()

      const result = await service.generateRecommendations(machine.id)

      expect(Array.isArray(result)).toBe(true)
      const stored = await prisma.vMRecommendation.findMany({
        where: { machineId: machine.id }
      })
      const diskRec = stored.find(r => r.type === RecommendationType.DISK_SPACE_LOW)
      expect(diskRec).toBeDefined()
      expect(diskRec!.machineId).toBe(machine.id)
    })

    it('is idempotent when the snapshot data has not changed', async () => {
      await seedCriticalDiskSnapshot()
      await service.generateRecommendations(machine.id)
      const firstCount = await prisma.vMRecommendation.count({ where: { machineId: machine.id } })
      expect(firstCount).toBeGreaterThan(0)

      // Regenerating with the same snapshot must not multiply the stored rows.
      await service.generateRecommendations(machine.id)
      const secondCount = await prisma.vMRecommendation.count({ where: { machineId: machine.id } })
      expect(secondCount).toBe(firstCount)
    })
  })

  describe('resolver authorization', () => {
    beforeEach(async () => {
      await seedCriticalDiskSnapshot()
      await service.generateRecommendations(machine.id)
    })

    it('owners can read their own VM recommendations', async () => {
      const result = await resolver.getVMRecommendations(machine.id, makeContext(owner))
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    it('admins can read any VM recommendations', async () => {
      const result = await resolver.getVMRecommendations(machine.id, makeContext(admin))
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
    })

    // Authorization now lives in the @Can decorator (middleware), which only
    // fires through the schema — a direct resolver call bypasses it. So the
    // denial paths are asserted end-to-end via graphql().
    it('strangers cannot read another user\'s VM recommendations (denied by @Can scope)', async () => {
      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: machine.id, refresh: false },
        contextValue: makeContext(stranger)
      })
      expect(result.errors).toBeDefined()
      expect(result.errors![0].message).toMatch(/not authorized|requires recommendation:view/i)
    })

    it('rejects unauthenticated requests', async () => {
      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: machine.id, refresh: false },
        contextValue: makeContext(null)
      })
      expect(result.errors).toBeDefined()
      expect(result.errors![0].message).toMatch(/authentication required|not authorized/i)
    })

    it('throws when the machine does not exist', async () => {
      await expect(
        resolver.getVMRecommendations('no-such-machine', makeContext(admin))
      ).rejects.toThrow('Machine not found')
    })
  })

  describe('GraphQL schema end-to-end', () => {
    it('returns the stored recommendations through the query', async () => {
      await seedCriticalDiskSnapshot()
      await service.generateRecommendations(machine.id)

      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: machine.id, refresh: false },
        contextValue: makeContext(owner)
      })

      expect(result.errors).toBeUndefined()
      const recs = (result.data as any)?.getVMRecommendations
      expect(Array.isArray(recs)).toBe(true)
      expect(recs.length).toBeGreaterThan(0)
    })

    it('returns Access denied for unauthenticated callers', async () => {
      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: machine.id },
        contextValue: makeContext(null)
      })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].message).toMatch(/authentication required|not authorized/i)
    })

    it('errors when the machine does not exist', async () => {
      const result = await graphql({
        schema,
        source: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variableValues: { vmId: 'non-existent-machine' },
        contextValue: makeContext(admin)
      })

      expect(result.errors).toBeDefined()
      expect(result.errors![0].message).toBe('Machine not found')
    })
  })
})
