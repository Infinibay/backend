import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import request from 'supertest'
import express from 'express'
import http from 'http'
import { ApolloServer } from '@apollo/server'
import { expressMiddleware } from '@apollo/server/express4'
import { buildSchema } from 'type-graphql'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { PrismaClient, RecommendationType } from '@prisma/client'
import { mockPrisma } from '../setup/jest.setup'
import { InfinibayContext } from '../../app/utils/context'
import resolvers from '../../app/graphql/resolvers'
import { authChecker } from '../../app/utils/authChecker'
import {
  createMockVMRecommendation,
  createMockHealthSnapshot,
  createMockDiskSpaceInfo,
  createMockResourceOptInfo,
  createMockWindowsUpdateInfo,
  createMockDefenderStatus,
  RECOMMENDATION_TEST_QUERIES,
  RecommendationPerformanceUtils
} from '../setup/recommendation-test-helpers'
import { createMockMachine, createMockUser } from '../setup/mock-factories'

describe('Recommendation API E2E Tests', () => {
  let app: express.Application
  let server: http.Server
  let apolloServer: ApolloServer
  let authToken: string
  let adminAuthToken: string

  // Test users and machines
  const testUser = createMockUser({
    id: 'e2e-user-1',
    email: 'e2e.user@test.com',
    role: 'USER'
  })

  const adminUser = createMockUser({
    id: 'e2e-admin-1',
    email: 'e2e.admin@test.com',
    role: 'ADMIN'
  })

  const userMachine = createMockMachine({
    id: 'e2e-machine-1',
    userId: testUser.id,
    name: 'E2E Test VM'
  })

  const otherUserMachine = createMockMachine({
    id: 'e2e-machine-2',
    userId: 'other-user-id',
    name: 'Other User VM'
  })

  beforeEach(async () => {
    jest.clearAllMocks()

    // Create Express app
    app = express()
    server = http.createServer(app)

    // Build GraphQL schema
    const schema = await buildSchema({
      resolvers,
      authChecker
    })

    // Create Apollo Server
    apolloServer = new ApolloServer({
      schema,
      csrfPrevention: true,
      cache: 'bounded'
    })

    await apolloServer.start()

    // Apply middleware
    app.use('/graphql', cors(), express.json(), expressMiddleware(apolloServer, {
      context: async ({ req, res }): Promise<InfinibayContext> => {
        let user = null
        const token = req.headers.authorization

        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.TOKENKEY || 'test-secret') as { userId: string }
            if (decoded.userId === testUser.id) {
              user = testUser
            } else if (decoded.userId === adminUser.id) {
              user = adminUser
            }
          } catch (error) {
            // Invalid token, user remains null
          }
        }

        return {
          prisma: mockPrisma as unknown as PrismaClient,
          req,
          res,
          user,
          setupMode: false,
          virtioSocketWatcher: {} as any
        }
      }
    }))

    // Generate auth tokens
    authToken = jwt.sign({ userId: testUser.id }, process.env.TOKENKEY || 'test-secret')
    adminAuthToken = jwt.sign({ userId: adminUser.id }, process.env.TOKENKEY || 'test-secret')

    // Setup basic mock responses
    mockPrisma.user.findUnique.mockImplementation(({ where }) => {
      if (where.id === testUser.id) return Promise.resolve(testUser as any)
      if (where.id === adminUser.id) return Promise.resolve(adminUser as any)
      return Promise.resolve(null)
    })

    mockPrisma.machine.findUnique.mockImplementation(({ where }) => {
      if (where.id === userMachine.id) return Promise.resolve(userMachine as any)
      if (where.id === otherUserMachine.id) return Promise.resolve(otherUserMachine as any)
      return Promise.resolve(null)
    })
  })

  afterEach(async () => {
    if (server) {
      server.close()
    }
    if (apolloServer) {
      await apolloServer.stop()
    }
    jest.clearAllMocks()
  })

  describe('GraphQL API Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeDefined()
      expect(response.body.errors[0].extensions.code).toBe('UNAUTHORIZED')
    })

    it('should accept valid authentication tokens', async () => {
      const mockRecommendations = [
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DISK_SPACE_LOW
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations as any)

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toHaveLength(1)
      expect(response.body.data.getVMRecommendations[0].type).toBe('DISK_SPACE_LOW')
    })

    it('should reject invalid tokens', async () => {
      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', 'invalid-token')
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeDefined()
      expect(response.body.errors[0].extensions.code).toBe('UNAUTHORIZED')
    })
  })

  describe('Authorization and Access Control', () => {
    it('should allow users to access their own machines', async () => {
      const mockRecommendations = [
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.OS_UPDATE_AVAILABLE,
          text: 'Security updates available',
          actionText: 'Install Windows updates'
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations as any)

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toHaveLength(1)
      expect(response.body.data.getVMRecommendations[0]).toMatchObject({
        machineId: userMachine.id,
        type: 'OS_UPDATE_AVAILABLE',
        text: 'Security updates available',
        actionText: 'Install Windows updates'
      })
    })

    it('should deny access to other users machines', async () => {
      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: otherUserMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeDefined()
      expect(response.body.errors[0].message).toBe('Access denied')
    })

    it('should allow admins to access any machine', async () => {
      const mockRecommendations = [
        createMockVMRecommendation({
          machineId: otherUserMachine.id,
          type: RecommendationType.DEFENDER_DISABLED
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations as any)

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: otherUserMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', adminAuthToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toHaveLength(1)
      expect(response.body.data.getVMRecommendations[0].type).toBe('DEFENDER_DISABLED')
    })

    it('should handle machine not found', async () => {
      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: 'non-existent-machine' }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeDefined()
      expect(response.body.errors[0].message).toBe('Machine not found')
    })
  })

  describe('Query Parameter Handling', () => {
    beforeEach(() => {
      const mockRecommendations = [
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DISK_SPACE_LOW,
          createdAt: new Date('2023-10-15T10:00:00Z')
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.OS_UPDATE_AVAILABLE,
          createdAt: new Date('2023-10-15T11:00:00Z')
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.OVER_PROVISIONED,
          createdAt: new Date('2023-10-15T12:00:00Z')
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations as any)
    })

    it('should handle refresh parameter', async () => {
      // Mock health snapshot for refresh
      const healthSnapshot = createMockHealthSnapshot({
        machineId: userMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('critical')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(healthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 3 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id, refresh: true }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(mockPrisma.vMHealthSnapshot.findFirst).toHaveBeenCalled()
      expect(mockPrisma.vMRecommendation.deleteMany).toHaveBeenCalled()
    })

    it('should handle type filtering', async () => {
      // Filter mock to return only disk space recommendations
      mockPrisma.vMRecommendation.findMany.mockImplementation(({ where }) => {
        if (where?.type?.in?.includes(RecommendationType.DISK_SPACE_LOW)) {
          return Promise.resolve([
            createMockVMRecommendation({
              machineId: userMachine.id,
              type: RecommendationType.DISK_SPACE_LOW
            })
          ] as any)
        }
        return Promise.resolve([] as any)
      })

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
        variables: {
          vmId: userMachine.id,
          types: ['DISK_SPACE_LOW']
        }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toHaveLength(1)
      expect(response.body.data.getVMRecommendations[0].type).toBe('DISK_SPACE_LOW')

      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith({
        where: {
          machineId: userMachine.id,
          type: { in: [RecommendationType.DISK_SPACE_LOW] }
        },
        orderBy: { createdAt: 'desc' }
      })
    })

    it('should handle limit parameter', async () => {
      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_LIMIT,
        variables: {
          vmId: userMachine.id,
          limit: 2
        }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith({
        where: { machineId: userMachine.id },
        orderBy: { createdAt: 'desc' },
        take: 2
      })
    })

    it('should handle date range filtering', async () => {
      const query = {
        query: `
          query GetVMRecommendationsWithDateRange($vmId: ID!, $after: DateTimeISO!, $before: DateTimeISO!) {
            getVMRecommendations(vmId: $vmId, filter: { createdAfter: $after, createdBefore: $before }) {
              id
              type
              createdAt
            }
          }
        `,
        variables: {
          vmId: userMachine.id,
          after: '2023-10-15T09:00:00Z',
          before: '2023-10-15T13:00:00Z'
        }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(mockPrisma.vMRecommendation.findMany).toHaveBeenCalledWith({
        where: {
          machineId: userMachine.id,
          createdAt: {
            gte: new Date('2023-10-15T09:00:00Z'),
            lte: new Date('2023-10-15T13:00:00Z')
          }
        },
        orderBy: { createdAt: 'desc' }
      })
    })
  })

  describe('Real API Scenarios', () => {
    it('should handle complete recommendation workflow via API', async () => {
      // Step 1: User requests recommendations (empty initially)
      mockPrisma.vMRecommendation.findMany.mockResolvedValueOnce([])

      const initialQuery = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const initialResponse = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(initialQuery)
        .expect(200)

      expect(initialResponse.body.data.getVMRecommendations).toHaveLength(0)

      // Step 2: System generates recommendations after health check
      const newRecommendations = [
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DISK_SPACE_LOW,
          text: 'Low disk space on drive C:',
          actionText: 'Clean up temporary files',
          data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 },
          createdAt: new Date()
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.OS_UPDATE_AVAILABLE,
          text: 'Critical Windows updates available',
          actionText: 'Install security updates',
          data: { criticalCount: 2, securityCount: 3 },
          createdAt: new Date()
        })
      ]

      // Step 3: User requests refresh to get new recommendations
      const healthSnapshot = createMockHealthSnapshot({
        machineId: userMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('warning'),
        windowsUpdateInfo: createMockWindowsUpdateInfo('critical_updates')
      })

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(healthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue([])
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 2 })
      mockPrisma.vMRecommendation.findMany.mockResolvedValueOnce(newRecommendations as any)

      const refreshQuery = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id, refresh: true }
      }

      const refreshResponse = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(refreshQuery)
        .expect(200)

      expect(refreshResponse.body.errors).toBeUndefined()
      expect(refreshResponse.body.data.getVMRecommendations).toHaveLength(2)

      const recommendations = refreshResponse.body.data.getVMRecommendations

      // Verify disk space recommendation
      const diskSpaceRec = recommendations.find(r => r.type === 'DISK_SPACE_LOW')
      expect(diskSpaceRec).toMatchObject({
        machineId: userMachine.id,
        type: 'DISK_SPACE_LOW',
        text: 'Low disk space on drive C:',
        actionText: 'Clean up temporary files',
        data: { drive: 'C:', usedPercent: 85, freeGB: 15.2 }
      })

      // Verify update recommendation
      const updateRec = recommendations.find(r => r.type === 'OS_UPDATE_AVAILABLE')
      expect(updateRec).toMatchObject({
        machineId: userMachine.id,
        type: 'OS_UPDATE_AVAILABLE',
        text: 'Critical Windows updates available',
        actionText: 'Install security updates',
        data: { criticalCount: 2, securityCount: 3 }
      })
    })

    it('should handle filtering for specific recommendation categories', async () => {
      const securityRecommendations = [
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DEFENDER_DISABLED,
          text: 'Windows Defender is disabled'
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.OS_UPDATE_AVAILABLE,
          text: 'Security updates pending'
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockImplementation(({ where }) => {
        if (where?.type?.in) {
          const filteredRecs = securityRecommendations.filter(rec =>
            where.type.in.includes(rec.type)
          )
          return Promise.resolve(filteredRecs as any)
        }
        return Promise.resolve(securityRecommendations as any)
      })

      const securityQuery = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
        variables: {
          vmId: userMachine.id,
          types: ['DEFENDER_DISABLED', 'OS_UPDATE_AVAILABLE']
        }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(securityQuery)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toHaveLength(2)

      const types = response.body.data.getVMRecommendations.map(r => r.type)
      expect(types).toContain('DEFENDER_DISABLED')
      expect(types).toContain('OS_UPDATE_AVAILABLE')
    })
  })

  describe('Performance and Scalability', () => {
    it('should handle large recommendation datasets efficiently', async () => {
      const largeDataset = Array.from({ length: 50 }, (_, i) => {
        const types = Object.values(RecommendationType)
        return createMockVMRecommendation({
          id: `rec-${i}`,
          machineId: userMachine.id,
          type: types[i % types.length] as RecommendationType,
          text: `Recommendation ${i + 1}`,
          actionText: `Action ${i + 1}`,
          createdAt: new Date(Date.now() - i * 60000)
        })
      })

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(largeDataset as any)

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const { executionTimeMs } = await RecommendationPerformanceUtils
        .measureRecommendationGenerationTime(async () => {
          return request(app)
            .post('/graphql')
            .set('Authorization', authToken)
            .send(query)
        })

      expect(executionTimeMs).toBeLessThan(3000) // Should complete within 3 seconds
    })

    it('should handle concurrent API requests', async () => {
      const mockRecommendations = [
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DISK_SPACE_LOW
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(mockRecommendations as any)

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      // Make 5 concurrent requests
      const concurrentRequests = Array.from({ length: 5 }, () =>
        request(app)
          .post('/graphql')
          .set('Authorization', authToken)
          .send(query)
      )

      const responses = await Promise.all(concurrentRequests)

      responses.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body.errors).toBeUndefined()
        expect(response.body.data.getVMRecommendations).toHaveLength(1)
      })
    })

    it('should handle memory-intensive recommendation generation', async () => {
      // Simulate memory-intensive recommendation generation
      const complexHealthSnapshot = createMockHealthSnapshot({
        machineId: userMachine.id,
        diskSpaceInfo: createMockDiskSpaceInfo('critical'),
        resourceOptInfo: createMockResourceOptInfo('over_provisioned'),
        windowsUpdateInfo: createMockWindowsUpdateInfo('critical_updates'),
        defenderStatus: createMockDefenderStatus('threats')
      })

      const largeMetricsSet = Array.from({ length: 100 }, (_, i) =>
        createMockSystemMetrics({
          machineId: userMachine.id,
          timestamp: new Date(Date.now() - i * 3600000)
        })
      )

      mockPrisma.vMHealthSnapshot.findFirst.mockResolvedValue(complexHealthSnapshot as any)
      mockPrisma.systemMetrics.findMany.mockResolvedValue(largeMetricsSet as any)
      mockPrisma.vMRecommendation.deleteMany.mockResolvedValue({ count: 0 })
      mockPrisma.vMRecommendation.createMany.mockResolvedValue({ count: 5 })

      const newRecommendations = [
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DISK_SPACE_LOW
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.OVER_PROVISIONED
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.OS_UPDATE_AVAILABLE
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DEFENDER_THREAT
        }),
        createMockVMRecommendation({
          machineId: userMachine.id,
          type: RecommendationType.DEFENDER_DISABLED
        })
      ]

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(newRecommendations as any)

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id, refresh: true }
      }

      const startTime = Date.now()
      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)
      const endTime = Date.now()

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toHaveLength(5)
      expect(endTime - startTime).toBeLessThan(10000) // Should complete within 10 seconds
    })
  })

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed GraphQL queries', async () => {
      const malformedQuery = {
        query: `
          query GetRecommendations {
            getVMRecommendations(invalidParam: "test") {
              id
            }
          }
        `
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(malformedQuery)
        .expect(400)

      expect(response.body.errors).toBeDefined()
    })

    it('should handle service failures gracefully', async () => {
      mockPrisma.vMRecommendation.findMany.mockRejectedValue(
        new Error('Database service unavailable')
      )

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeDefined()
      expect(response.body.errors[0].message).toBe('Failed to fetch recommendations')
    })

    it('should handle invalid machine IDs', async () => {
      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: 'invalid-machine-id' }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeDefined()
      expect(response.body.errors[0].message).toBe('Machine not found')
    })

    it('should handle empty recommendation responses', async () => {
      mockPrisma.vMRecommendation.findMany.mockResolvedValue([])

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toEqual([])
    })

    it('should validate input parameters', async () => {
      const invalidTypeQuery = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
        variables: {
          vmId: userMachine.id,
          types: ['INVALID_RECOMMENDATION_TYPE']
        }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(invalidTypeQuery)
        .expect(400)

      expect(response.body.errors).toBeDefined()
    })
  })

  describe('HTTP Response Handling', () => {
    it('should return correct HTTP status codes', async () => {
      mockPrisma.vMRecommendation.findMany.mockResolvedValue([])

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)
        .expect('Content-Type', /json/)
    })

    it('should handle CORS properly', async () => {
      mockPrisma.vMRecommendation.findMany.mockResolvedValue([])

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .set('Origin', 'http://localhost:3000')
        .send(query)
        .expect(200)

      expect(response.headers['access-control-allow-origin']).toBeDefined()
    })

    it('should handle large response payloads', async () => {
      const largeRecommendationSet = Array.from({ length: 100 }, (_, i) =>
        createMockVMRecommendation({
          id: `rec-${i}`,
          machineId: userMachine.id,
          type: Object.values(RecommendationType)[i % Object.values(RecommendationType).length] as RecommendationType,
          text: `Very detailed recommendation text that explains the issue in great detail and provides comprehensive information about the problem and potential solutions. This is recommendation number ${i + 1}.`,
          actionText: `Detailed action text with step-by-step instructions for resolving this issue. This includes multiple steps and detailed explanations for action ${i + 1}.`,
          data: {
            detailedInfo: `Extensive data object with lots of information for recommendation ${i}`,
            metrics: Array.from({ length: 10 }, (_, j) => ({ metric: `value-${j}`, value: Math.random() * 100 })),
            timestamps: Array.from({ length: 5 }, () => new Date().toISOString()),
            additionalData: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit'.repeat(10)
          }
        })
      )

      mockPrisma.vMRecommendation.findMany.mockResolvedValue(largeRecommendationSet as any)

      const query = {
        query: RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
        variables: { vmId: userMachine.id }
      }

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', authToken)
        .send(query)
        .expect(200)

      expect(response.body.errors).toBeUndefined()
      expect(response.body.data.getVMRecommendations).toHaveLength(100)
      expect(response.text.length).toBeGreaterThan(50000) // Large response
    })
  })
})
