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
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const client_1 = require("@prisma/client");
const type_graphql_1 = require("type-graphql");
const graphql_1 = require("graphql");
const jest_setup_1 = require("../setup/jest.setup");
const VMRecommendationService_1 = require("../../app/services/VMRecommendationService");
const VMRecommendationResolver_1 = require("../../app/graphql/resolvers/VMRecommendationResolver");
require("../../app/graphql/types/RecommendationTypes");
const recommendation_test_helpers_1 = require("../setup/recommendation-test-helpers");
const db_factories_1 = require("../setup/db-factories");
// PackageManager touches the DB in its constructor via loadAll(); mock it out —
// it's unrelated to the recommendation service under test.
jest.mock('../../app/services/packages/PackageManager', () => ({
    getPackageManager: jest.fn().mockReturnValue({
        loadAll: jest.fn().mockResolvedValue(undefined),
        getPackageStatuses: jest.fn().mockReturnValue([]),
        runCheckers: jest.fn().mockResolvedValue([])
    }),
    PackageManager: jest.fn()
}));
describe('Recommendation flow — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    let service;
    let resolver;
    let schema;
    let owner;
    let admin;
    let stranger;
    let department;
    let machine;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        schema = yield (0, type_graphql_1.buildSchema)({
            resolvers: [VMRecommendationResolver_1.VMRecommendationResolver],
            authChecker: ({ context }) => !!context.user
        });
    }));
    afterEach(() => {
        var _a;
        // VMRecommendationService's constructor starts setInterval + setTimeout
        // for background maintenance; dispose() clears them so Jest can exit.
        ;
        (_a = service === null || service === void 0 ? void 0 : service.dispose) === null || _a === void 0 ? void 0 : _a.call(service);
    });
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        // The service constructor fires a one-shot setTimeout that jest.dispose()
        // doesn't clear. Install fake timers while constructing so the timeout is
        // captured into the fake queue and never fires.
        jest.useFakeTimers({ advanceTimers: false });
        service = new VMRecommendationService_1.VMRecommendationService(prisma);
        jest.useRealTimers();
        resolver = new VMRecommendationResolver_1.VMRecommendationResolver();
        owner = yield (0, db_factories_1.createUser)(prisma);
        admin = yield (0, db_factories_1.createAdmin)(prisma);
        stranger = yield (0, db_factories_1.createUser)(prisma);
        department = yield (0, db_factories_1.createDepartment)(prisma);
        machine = yield (0, db_factories_1.createMachine)(prisma, {
            userId: owner.id,
            departmentId: department.id,
            overrides: { status: 'running', cpuCores: 4, ramGB: 8, diskSizeGB: 100 }
        });
    }));
    function makeContext(user) {
        return {
            prisma,
            user,
            req: {},
            res: {},
            setupMode: false,
            virtioSocketWatcher: {}
        };
    }
    function seedCriticalDiskSnapshot() {
        return __awaiter(this, void 0, void 0, function* () {
            return (0, db_factories_1.createHealthSnapshot)(prisma, {
                machineId: machine.id,
                overallStatus: 'CRITICAL',
                diskSpaceInfo: { 'C:': { used: 96, total: 100 } }
            });
        });
    }
    describe('generateRecommendations', () => {
        it('persists a disk-space recommendation when the latest snapshot shows critical usage', () => __awaiter(void 0, void 0, void 0, function* () {
            yield seedCriticalDiskSnapshot();
            const result = yield service.generateRecommendations(machine.id);
            expect(Array.isArray(result)).toBe(true);
            const stored = yield prisma.vMRecommendation.findMany({
                where: { machineId: machine.id }
            });
            const diskRec = stored.find(r => r.type === client_1.RecommendationType.DISK_SPACE_LOW);
            expect(diskRec).toBeDefined();
            expect(diskRec.machineId).toBe(machine.id);
        }));
        it('is idempotent when the snapshot data has not changed', () => __awaiter(void 0, void 0, void 0, function* () {
            yield seedCriticalDiskSnapshot();
            yield service.generateRecommendations(machine.id);
            const firstCount = yield prisma.vMRecommendation.count({ where: { machineId: machine.id } });
            expect(firstCount).toBeGreaterThan(0);
            // Regenerating with the same snapshot must not multiply the stored rows.
            yield service.generateRecommendations(machine.id);
            const secondCount = yield prisma.vMRecommendation.count({ where: { machineId: machine.id } });
            expect(secondCount).toBe(firstCount);
        }));
    });
    describe('resolver authorization', () => {
        beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
            yield seedCriticalDiskSnapshot();
            yield service.generateRecommendations(machine.id);
        }));
        it('owners can read their own VM recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield resolver.getVMRecommendations(machine.id, makeContext(owner));
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        }));
        it('admins can read any VM recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield resolver.getVMRecommendations(machine.id, makeContext(admin));
            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBeGreaterThan(0);
        }));
        it('strangers cannot read another user\'s VM recommendations', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(resolver.getVMRecommendations(machine.id, makeContext(stranger))).rejects.toThrow('Access denied');
        }));
        it('rejects unauthenticated requests', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(resolver.getVMRecommendations(machine.id, makeContext(null))).rejects.toThrow('Access denied');
        }));
        it('throws when the machine does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(resolver.getVMRecommendations('no-such-machine', makeContext(admin))).rejects.toThrow('Machine not found');
        }));
    });
    describe('GraphQL schema end-to-end', () => {
        it('returns the stored recommendations through the query', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            yield seedCriticalDiskSnapshot();
            yield service.generateRecommendations(machine.id);
            const result = yield (0, graphql_1.graphql)({
                schema,
                source: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variableValues: { vmId: machine.id, refresh: false },
                contextValue: makeContext(owner)
            });
            expect(result.errors).toBeUndefined();
            const recs = (_a = result.data) === null || _a === void 0 ? void 0 : _a.getVMRecommendations;
            expect(Array.isArray(recs)).toBe(true);
            expect(recs.length).toBeGreaterThan(0);
        }));
        it('returns Access denied for unauthenticated callers', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield (0, graphql_1.graphql)({
                schema,
                source: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variableValues: { vmId: machine.id },
                contextValue: makeContext(null)
            });
            expect(result.errors).toBeDefined();
            expect(result.errors[0].message).toContain('Access denied');
        }));
        it('errors when the machine does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield (0, graphql_1.graphql)({
                schema,
                source: recommendation_test_helpers_1.RECOMMENDATION_TEST_QUERIES.GET_VM_RECOMMENDATIONS,
                variableValues: { vmId: 'non-existent-machine' },
                contextValue: makeContext(admin)
            });
            expect(result.errors).toBeDefined();
            expect(result.errors[0].message).toBe('Machine not found');
        }));
    });
});
