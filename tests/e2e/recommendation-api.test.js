"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
// @ts-ignore - supertest type declarations may not be installed
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const server_1 = require("@apollo/server");
const express5_1 = require("@as-integrations/express5");
const type_graphql_1 = require("type-graphql");
const client_1 = require("@prisma/client");
const jest_setup_1 = require("../setup/jest.setup");
const VMRecommendationResolver_1 = require("../../app/graphql/resolvers/VMRecommendationResolver");
require("../../app/graphql/types/RecommendationTypes");
const authChecker_1 = require("../../app/utils/authChecker");
const recommendation_test_helpers_1 = require("../setup/recommendation-test-helpers");
const db_factories_1 = require("../setup/db-factories");
// PackageManager touches DB in its constructor; mock it out — unrelated to the
// query/authz paths we actually care about here.
jest.mock('../../app/services/packages/PackageManager', () => ({
    getPackageManager: jest.fn().mockReturnValue({
        loadAll: jest.fn().mockResolvedValue(undefined),
        getPackageStatuses: jest.fn().mockReturnValue([]),
        runCheckers: jest.fn().mockResolvedValue([])
    }),
    PackageManager: jest.fn()
}));
describe('Recommendation API E2E — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    let app;
    let server;
    let apolloServer;
    let authToken;
    let adminAuthToken;
    // Seeded rows per test.
    let userRow;
    let adminRow;
    let otherUserRow;
    let userMachine;
    let otherUserMachine;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        // Build schema + Apollo once per file. type-graphql's metadata cache is
        // global so rebuilding per test ends up with stale references that
        // manifest as a ghost "undefined.machine" in the resolver.
        app = (0, express_1.default)();
        server = http_1.default.createServer(app);
        const schema = yield (0, type_graphql_1.buildSchema)({
            resolvers: [VMRecommendationResolver_1.VMRecommendationResolver],
            authChecker: authChecker_1.authChecker
        });
        apolloServer = new server_1.ApolloServer({ schema, csrfPrevention: true, cache: 'bounded' });
        yield apolloServer.start();
        app.use('/graphql', (0, cors_1.default)(), express_1.default.json(), (0, express5_1.expressMiddleware)(apolloServer, {
            context: (_a) => __awaiter(void 0, [_a], void 0, function* ({ req, res }) {
                let user = null;
                const token = req.headers.authorization;
                if (token) {
                    try {
                        const decoded = jsonwebtoken_1.default.verify(token, process.env.TOKENKEY || 'test-secret-key');
                        user = yield prisma.user.findUnique({ where: { id: decoded.userId } });
                    }
                    catch (_b) {
                        // Invalid token — user stays null.
                    }
                }
                return {
                    prisma,
                    req,
                    res,
                    user,
                    setupMode: false,
                    virtioSocketWatcher: {}
                };
            })
        }));
    }));
    afterAll(() => __awaiter(void 0, void 0, void 0, function* () {
        server === null || server === void 0 ? void 0 : server.close();
        yield (apolloServer === null || apolloServer === void 0 ? void 0 : apolloServer.stop());
    }));
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        const department = yield (0, db_factories_1.createDepartment)(prisma);
        userRow = yield (0, db_factories_1.createUser)(prisma, { email: `e2e-user-${Date.now()}@test.infinibay` });
        adminRow = yield (0, db_factories_1.createAdmin)(prisma, { email: `e2e-admin-${Date.now()}@test.infinibay` });
        otherUserRow = yield (0, db_factories_1.createUser)(prisma, { email: `e2e-other-${Date.now()}@test.infinibay` });
        userMachine = yield (0, db_factories_1.createMachine)(prisma, {
            userId: userRow.id,
            departmentId: department.id,
            overrides: { name: 'E2E Test VM' }
        });
        otherUserMachine = yield (0, db_factories_1.createMachine)(prisma, {
            userId: otherUserRow.id,
            departmentId: department.id,
            overrides: { name: 'Other User VM' }
        });
        authToken = jsonwebtoken_1.default.sign({ userId: userRow.id }, process.env.TOKENKEY || 'test-secret-key');
        adminAuthToken = jsonwebtoken_1.default.sign({ userId: adminRow.id }, process.env.TOKENKEY || 'test-secret-key');
    }));
    /**
     * Seeds a recommendation plus (if missing) a latest snapshot it can belong
     * to. The service filters by the latest snapshot's id, so an unanchored
     * recommendation is invisible through the API.
     */
    function seedRecommendation(machineId_1, type_1) {
        return __awaiter(this, arguments, void 0, function* (machineId, type, overrides = {}) {
            var _a, _b, _c;
            let snapshot = yield prisma.vMHealthSnapshot.findFirst({
                where: { machineId },
                orderBy: { snapshotDate: 'desc' }
            });
            if (!snapshot) {
                snapshot = yield (0, db_factories_1.createHealthSnapshot)(prisma, {
                    machineId,
                    overallStatus: 'HEALTHY'
                });
            }
            return prisma.vMRecommendation.create({
                data: Object.assign({ machineId, snapshotId: snapshot.id, type, text: (_a = overrides.text) !== null && _a !== void 0 ? _a : `${type} text`, actionText: (_b = overrides.actionText) !== null && _b !== void 0 ? _b : `${type} action`, data: (_c = overrides.data) !== null && _c !== void 0 ? _c : {} }, (overrides.createdAt ? { createdAt: overrides.createdAt } : {}))
            });
        });
    }
    function postQuery(token, query) {
        return __awaiter(this, void 0, void 0, function* () {
            const req = (0, supertest_1.default)(app).post('/graphql').send(query);
            if (token)
                req.set('Authorization', token);
            return req;
        });
    }
    // ── Auth ────────────────────────────────────────────────────────────────
    describe('GraphQL API authentication', () => {
        it('rejects unauthenticated requests', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(null, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id }
            });
            expect(res.status).toBe(200);
            expect(res.body.errors).toBeDefined();
        }));
        it('accepts valid authentication tokens', () => __awaiter(void 0, void 0, void 0, function* () {
            yield seedRecommendation(userMachine.id, client_1.RecommendationType.DISK_SPACE_LOW);
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id }
            });
            expect(res.body.errors).toBeUndefined();
            expect(res.body.data.getVMRecommendations).toHaveLength(1);
            expect(res.body.data.getVMRecommendations[0].type).toBe('DISK_SPACE_LOW');
        }));
        it('rejects invalid tokens', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery('invalid-token', {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id }
            });
            expect(res.body.errors).toBeDefined();
        }));
    });
    // ── Authorization ───────────────────────────────────────────────────────
    describe('Authorization and access control', () => {
        it('lets a user read their own machine recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            yield seedRecommendation(userMachine.id, client_1.RecommendationType.OS_UPDATE_AVAILABLE);
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id }
            });
            expect(res.body.errors).toBeUndefined();
            expect(res.body.data.getVMRecommendations).toHaveLength(1);
            expect(res.body.data.getVMRecommendations[0].type).toBe('OS_UPDATE_AVAILABLE');
        }));
        it('denies a user access to another user\'s machine', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: otherUserMachine.id }
            });
            expect(res.body.errors).toBeDefined();
            expect(res.body.errors[0].message).toBe('Access denied');
        }));
        it('lets an admin read any machine recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            yield seedRecommendation(otherUserMachine.id, client_1.RecommendationType.DEFENDER_DISABLED);
            const res = yield postQuery(adminAuthToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: otherUserMachine.id }
            });
            expect(res.body.errors).toBeUndefined();
            expect(res.body.data.getVMRecommendations).toHaveLength(1);
            expect(res.body.data.getVMRecommendations[0].type).toBe('DEFENDER_DISABLED');
        }));
        it('returns Machine not found for an unknown vmId', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: 'non-existent-machine' }
            });
            expect(res.body.errors).toBeDefined();
            expect(res.body.errors[0].message).toBe('Machine not found');
        }));
    });
    // ── Query parameters ────────────────────────────────────────────────────
    describe('Query parameter handling', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield seedRecommendation(userMachine.id, client_1.RecommendationType.DISK_SPACE_LOW, {
                createdAt: new Date('2023-10-15T10:00:00Z')
            });
            yield seedRecommendation(userMachine.id, client_1.RecommendationType.OS_UPDATE_AVAILABLE, {
                createdAt: new Date('2023-10-15T11:00:00Z')
            });
            yield seedRecommendation(userMachine.id, client_1.RecommendationType.OVER_PROVISIONED, {
                createdAt: new Date('2023-10-15T12:00:00Z')
            });
        }));
        it('honours the refresh parameter by regenerating from the latest snapshot', () => __awaiter(void 0, void 0, void 0, function* () {
            // Critical disk snapshot so the DiskSpaceChecker fires during refresh.
            yield (0, db_factories_1.createHealthSnapshot)(prisma, {
                machineId: userMachine.id,
                overallStatus: 'CRITICAL',
                diskSpaceInfo: { 'C:': { used: 96, total: 100 } }
            });
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id, refresh: true }
            });
            expect(res.body.errors).toBeUndefined();
            const recs = res.body.data.getVMRecommendations;
            expect(Array.isArray(recs)).toBe(true);
            // After regeneration at least one disk-space recommendation must exist.
            expect(recs.find((r) => r.type === 'DISK_SPACE_LOW')).toBeDefined();
        }));
        it('filters by recommendation type', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
                variables: { vmId: userMachine.id, types: ['DISK_SPACE_LOW'] }
            });
            expect(res.body.errors).toBeUndefined();
            const recs = res.body.data.getVMRecommendations;
            expect(recs.every((r) => r.type === 'DISK_SPACE_LOW')).toBe(true);
            expect(recs.length).toBeGreaterThan(0);
        }));
        it('honours the limit parameter', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_LIMIT,
                variables: { vmId: userMachine.id, limit: 2 }
            });
            expect(res.body.errors).toBeUndefined();
            expect(res.body.data.getVMRecommendations).toHaveLength(2);
        }));
        it('filters by createdAfter / createdBefore', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
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
            });
            expect(res.body.errors).toBeUndefined();
            const recs = res.body.data.getVMRecommendations;
            // Only the 11:00 rec falls in [10:30, 11:30].
            expect(recs).toHaveLength(1);
            expect(recs[0].type).toBe('OS_UPDATE_AVAILABLE');
        }));
    });
    // ── Error handling ──────────────────────────────────────────────────────
    describe('Error handling and edge cases', () => {
        it('rejects a GraphQL query with an unknown argument', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield (0, supertest_1.default)(app).post('/graphql').send({
                query: `query { getVMRecommendations(invalidParam: "test") { id } }`
            });
            expect(res.status).toBe(400);
            expect(res.body.errors).toBeDefined();
        }));
        it('returns Machine not found for an unknown id', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: 'invalid-machine-id' }
            });
            expect(res.body.errors).toBeDefined();
            expect(res.body.errors[0].message).toBe('Machine not found');
        }));
        it('returns an empty array when there are no recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id }
            });
            expect(res.body.errors).toBeUndefined();
            expect(res.body.data.getVMRecommendations).toEqual([]);
        }));
        it('rejects unknown RecommendationType enum values at parse time', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_FILTER,
                variables: {
                    vmId: userMachine.id,
                    types: ['INVALID_RECOMMENDATION_TYPE']
                }
            });
            expect(res.body.errors).toBeDefined();
        }));
    });
    // ── HTTP basics ─────────────────────────────────────────────────────────
    describe('HTTP response handling', () => {
        it('returns 200 + application/json on successful queries', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield (0, supertest_1.default)(app)
                .post('/graphql')
                .set('Authorization', authToken)
                .send({
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id }
            })
                .expect(200)
                .expect('Content-Type', /json/);
            expect(res.body.errors).toBeUndefined();
        }));
        it('sets CORS headers', () => __awaiter(void 0, void 0, void 0, function* () {
            const res = yield (0, supertest_1.default)(app)
                .post('/graphql')
                .set('Authorization', authToken)
                .set('Origin', 'http://localhost:3000')
                .send({
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variables: { vmId: userMachine.id }
            })
                .expect(200);
            expect(res.headers['access-control-allow-origin']).toBeDefined();
        }));
        it('serves large payloads without truncation (up to service default limit)', () => __awaiter(void 0, void 0, void 0, function* () {
            // Seed 60 recommendations; the service's default page size is 20.
            const types = Object.values(client_1.RecommendationType);
            for (let i = 0; i < 60; i++) {
                yield seedRecommendation(userMachine.id, types[i % types.length], {
                    text: `Recommendation ${i} with a reasonably long description`.repeat(5),
                    actionText: `Action ${i} `.repeat(10),
                    data: { i, metrics: Array.from({ length: 10 }, (_, j) => ({ metric: j, value: j * 2 })) }
                });
            }
            // Request 50 via filter.limit to get a chunky payload.
            const res = yield postQuery(authToken, {
                query: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS_WITH_LIMIT,
                variables: { vmId: userMachine.id, limit: 50 }
            });
            expect(res.body.errors).toBeUndefined();
            expect(res.body.data.getVMRecommendations).toHaveLength(50);
            expect(res.text.length).toBeGreaterThan(10000);
        }));
    });
});
