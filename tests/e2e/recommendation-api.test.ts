import 'reflect-metadata'
// @ts-ignore - supertest type declarations may not be installed
import request from 'supertest'
import express from 'express'
import http from 'http'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@as-integrations/express5'
import { buildSchema } from 'type-graphql'
import { RecommendationType } from '@prisma/client'
import { testPrisma } from '../setup/jest.setup'
import { InfinibayContext } from '../../app/utils/context'
import { VMRecommendationResolver } from '../../app/graphql/resolvers/VMRecommendationResolver'
import '../../app/graphql/types/RecommendationTypes'
import { authChecker } from '../../app/utils/authChecker'
import { RECOMMENDATION_TEST_QUERIES } from '../setup/recommendation-test-helpers'
import {
  createUser,
  createAdmin,
  createDepartment,
  createMachine,
  createHealthSnapshot
} from '../setup/db-factories'
import { seedSystemRoles } from '../setup/permission-factories'

// PackageManager touches DB in its constructor; mock it out — unrelated to the
// query/authz paths we actually care about here.
jest.mock('../../app/services/packages/PackageManager', () => ({
  getPackageManager: jest.fn().mockReturnValue({
    loadAll: jest.fn().mockResolvedValue(undefined),
    getPackageStatuses: jest.fn().mockReturnValue([]),
    runCheckers: jest.fn().mockResolvedValue([])
  }),
  PackageManager: jest.fn()
}))

describe('Recommendation API E2E — real database', () => {
  const prisma = testPrisma.prisma

  let app: express.Application
  let server: http.Server
  let apolloServer: ApolloServer
  let authToken: string
  let adminAuthToken: string

  // Seeded rows per test.
  let userRow: Awaited<ReturnType<typeof createUser>>
  let adminRow: Awaited<ReturnType<typeof createAdmin>>
  let otherUserRow: Awaited<ReturnType<typeof createUser>>
  let userMachine: Awaited<ReturnType<typeof createMachine>>
  let otherUserMachine: Awaited<ReturnType<typeof createMachine>>

  beforeAll(async () => {
    // Build schema + Apollo once per file. type-graphql's metadata cache is
    // global so rebuilding per test ends up with stale references that
    // manifest as a ghost "undefined.machine" in the resolver.
    app = express()
    server = http.createServer(app)

    const schema = await buildSchema({
      resolvers: [VMRecommendationResolver] as any,
      authChecker
    })
    apolloServer = new ApolloServer({ schema, csrfPrevention: true, cache: 'bounded' })
    await apolloServer.start()

    app.use('/graphql', cors(), express.json(), expressMiddleware(apolloServer, {
      context: async ({ req, res }): Promise<InfinibayContext> => {
        let user = null
        const token = req.headers.authorization
        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.TOKENKEY || 'test-secret-key') as { userId: string }
            user = await prisma.user.findUnique({ where: { id: decoded.userId } })
          } catch {
            // Invalid token — user stays null.
          }
        }
        return {
          prisma,
          req,
          res,
          user,
          setupMode: false,
          virtioSocketWatcher: {} as any
        } as unknown as InfinibayContext
      }
    }))
  })

  afterAll(async () => {
    server?.close()
    await apolloServer?.stop()
  })

  beforeEach(async () => {
    // Action/verb RBAC: seed system roles so each user's enum role resolves to
    // its grants (USER → recommendation:view@OWN, ADMIN → recommendation:manage).
    await seedSystemRoles(prisma)
    const department = await createDepartment(prisma)
    userRow = await createUser(prisma, { email: `e2e-user-${Date.now()}@test.infinibay` })
    adminRow = await createAdmin(prisma, { email: `e2e-admin-${Date.now()}@test.infinibay` })
    otherUserRow = await createUser(prisma, { email: `e2e-other-${Date.now()}@test.infinibay` })

    userMachine = await createMachine(prisma, {
      userId: userRow.id,
      departmentId: department.id,
      overrides: { name: 'E2E Test VM' }
    })
    otherUserMachine = await createMachine(prisma, {
      userId: otherUserRow.id,
      departmentId: department.id,
      overrides: { name: 'Other User VM' }
    })

    authToken = jwt.sign({ userId: userRow.id }, process.env.TOKENKEY || 'test-secret-key')
    adminAuthToken = jwt.sign({ userId: adminRow.id }, process.env.TOKENKEY || 'test-secret-key')
  })

  /**
   * Seeds a recommendation plus (if missing) a latest snapshot it can belong
   * to. The service filters by the latest snapshot's id, so an unanchored
   * recommendation is invisible through the API.
   */
  async function seedRecommendation (
    machineId: string,
    type: RecommendationType,
    overrides: Record<string, any> = {}
  ) {
    let snapshot = await prisma.vMHealthSnapshot.findFirst({
      where: { machineId },
      orderBy: { snapshotDate: 'desc' }
    })
    if (!snapshot) {
      snapshot = await createHealthSnapshot(prisma, {
        machineId,
        overallStatus: 'HEALTHY'
      })
    }
    return prisma.vMRecommendation.create({
      data: {
        machineId,
        snapshotId: snapshot.id,
        type,
        text: overrides.text ?? `${type} text`,
        actionText: overrides.actionText ?? `${type} action`,
        data: overrides.data ?? {},
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      }
    })
  }

  async function postQuery (token: string | null, query: any) {
    const req = request(app).post('/graphql').send(query)
    if (token) req.set('Authorization', token)
    return req
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  describe('GraphQL API authentication', () => {
    it('rejects unauthenticated requests', async () => {
      const res = await postQuery(null, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      })
      expect(res.status).toBe(200)
      expect(res.body.errors).toBeDefined()
    })

    it('accepts valid authentication tokens', async () => {
      await seedRecommendation(userMachine.id, RecommendationType.DISK_SPACE_LOW)

      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      })
      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.getVMRecommendations).toHaveLength(1)
      expect(res.body.data.getVMRecommendations[0].type).toBe('DISK_SPACE_LOW')
    })

    it('rejects invalid tokens', async () => {
      const res = await postQuery('invalid-token', {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      })
      expect(res.body.errors).toBeDefined()
    })
  })

  // ── Authorization ───────────────────────────────────────────────────────

  describe('Authorization and access control', () => {
    it('lets a user read their own machine recommendations', async () => {
      await seedRecommendation(userMachine.id, RecommendationType.OS_UPDATE_AVAILABLE)

      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      })
      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.getVMRecommendations).toHaveLength(1)
      expect(res.body.data.getVMRecommendations[0].type).toBe('OS_UPDATE_AVAILABLE')
    })

    it('denies a user access to another user\'s machine', async () => {
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: otherUserMachine.id }
      })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toMatch(/not authorized|access denied|requires recommendation:view/i)
    })

    it('lets an admin read any machine recommendations', async () => {
      await seedRecommendation(otherUserMachine.id, RecommendationType.DEFENDER_DISABLED)

      const res = await postQuery(adminAuthToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: otherUserMachine.id }
      })
      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.getVMRecommendations).toHaveLength(1)
      expect(res.body.data.getVMRecommendations[0].type).toBe('DEFENDER_DISABLED')
    })

    it('returns Machine not found for an unknown vmId', async () => {
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: 'non-existent-machine' }
      })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toBe('Machine not found')
    })
  })

  // ── Query parameters ────────────────────────────────────────────────────

  describe('Query parameter handling', () => {
    beforeEach(async () => {
      await seedRecommendation(userMachine.id, RecommendationType.DISK_SPACE_LOW, {
        createdAt: new Date('2023-10-15T10:00:00Z')
      })
      await seedRecommendation(userMachine.id, RecommendationType.OS_UPDATE_AVAILABLE, {
        createdAt: new Date('2023-10-15T11:00:00Z')
      })
      await seedRecommendation(userMachine.id, RecommendationType.OVER_PROVISIONED, {
        createdAt: new Date('2023-10-15T12:00:00Z')
      })
    })

    it('honours the refresh parameter by regenerating from the latest snapshot', async () => {
      // Critical disk snapshot so the DiskSpaceChecker fires during refresh.
      await createHealthSnapshot(prisma, {
        machineId: userMachine.id,
        overallStatus: 'CRITICAL',
        diskSpaceInfo: { 'C:': { used: 96, total: 100 } }
      })

      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id, refresh: true }
      })

      expect(res.body.errors).toBeUndefined()
      const recs = res.body.data.getVMRecommendations
      expect(Array.isArray(recs)).toBe(true)
      // After regeneration at least one disk-space recommendation must exist.
      expect(recs.find((r: any) => r.type === 'DISK_SPACE_LOW')).toBeDefined()
    })

    it('filters by recommendation type', async () => {
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
        variables: { vmId: userMachine.id, types: ['DISK_SPACE_LOW'] }
      })

      expect(res.body.errors).toBeUndefined()
      const recs = res.body.data.getVMRecommendations
      expect(recs.every((r: any) => r.type === 'DISK_SPACE_LOW')).toBe(true)
      expect(recs.length).toBeGreaterThan(0)
    })

    it('honours the limit parameter', async () => {
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_LIMIT,
        variables: { vmId: userMachine.id, limit: 2 }
      })

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.getVMRecommendations).toHaveLength(2)
    })

    it('filters by createdAfter / createdBefore', async () => {
      const res = await postQuery(authToken, {
        query: `
          query($vmId: ID!, $after: DateTimeISO!, $before: DateTimeISO!) {
            getVMRecommendations(vmId: $vmId, filter: { createdAfter: $after, createdBefore: $before }) {
              id type createdAt
            }
          }
        `,
        variables: {
          vmId: userMachine.id,
          after: '2023-10-15T10:30:00Z',
          before: '2023-10-15T11:30:00Z'
        }
      })

      expect(res.body.errors).toBeUndefined()
      const recs = res.body.data.getVMRecommendations
      // Only the 11:00 rec falls in [10:30, 11:30].
      expect(recs).toHaveLength(1)
      expect(recs[0].type).toBe('OS_UPDATE_AVAILABLE')
    })
  })

  // ── Error handling ──────────────────────────────────────────────────────

  describe('Error handling and edge cases', () => {
    it('rejects a GraphQL query with an unknown argument', async () => {
      const res = await request(app).post('/graphql').send({
        query: `query { getVMRecommendations(invalidParam: "test") { id } }`
      })
      expect(res.status).toBe(400)
      expect(res.body.errors).toBeDefined()
    })

    it('returns Machine not found for an unknown id', async () => {
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: 'invalid-machine-id' }
      })
      expect(res.body.errors).toBeDefined()
      expect(res.body.errors[0].message).toBe('Machine not found')
    })

    it('returns an empty array when there are no recommendations', async () => {
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      })
      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.getVMRecommendations).toEqual([])
    })

    it('rejects unknown RecommendationType enum values at parse time', async () => {
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
        variables: {
          vmId: userMachine.id,
          types: ['INVALID_RECOMMENDATION_TYPE']
        }
      })
      expect(res.body.errors).toBeDefined()
    })
  })

  // ── HTTP basics ─────────────────────────────────────────────────────────

  describe('HTTP response handling', () => {
    it('returns 200 + application/json on successful queries', async () => {
      const res = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send({
          query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
          variables: { vmId: userMachine.id }
        })
        .expect(200)
        .expect('Content-Type', /json/)
      expect(res.body.errors).toBeUndefined()
    })

    it('sets CORS headers', async () => {
      const res = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .set('Origin', 'http://localhost:3000')
        .send({
          query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
          variables: { vmId: userMachine.id }
        })
        .expect(200)

      expect(res.headers['access-control-allow-origin']).toBeDefined()
    })

    it('serves large payloads without truncation (up to service default limit)', async () => {
      // Seed 60 recommendations; the service's default page size is 20.
      const types = Object.values(RecommendationType)
      for (let i = 0; i < 60; i++) {
        await seedRecommendation(userMachine.id, types[i % types.length] as RecommendationType, {
          text: `Recommendation ${i} with a reasonably long description`.repeat(5),
          actionText: `Action ${i} `.repeat(10),
          data: { i, metrics: Array.from({ length: 10 }, (_, j) => ({ metric: j, value: j * 2 })) }
        })
      }

      // Request 50 via filter.limit to get a chunky payload.
      const res = await postQuery(authToken, {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_LIMIT,
        variables: { vmId: userMachine.id, limit: 50 }
      })

      expect(res.body.errors).toBeUndefined()
      expect(res.body.data.getVMRecommendations).toHaveLength(50)
      expect(res.text.length).toBeGreaterThan(10_000)
    })
  })
})
