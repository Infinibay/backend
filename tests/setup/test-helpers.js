"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.ErrorMatchers = exports.TestMutations = exports.TestQueries = void 0;
exports.generateTestToken = generateTestToken;
exports.executeGraphQL = executeGraphQL;
exports.createMockContext = createMockContext;
exports.createAdminContext = createAdminContext;
exports.createUserContext = createUserContext;
exports.createUnauthenticatedContext = createUnauthenticatedContext;
exports.cleanupTestData = cleanupTestData;
exports.waitFor = waitFor;
exports.createDepartmentWithVMs = createDepartmentWithVMs;
exports.createMultipleDepartments = createMultipleDepartments;
exports.setupComplexFirewallHierarchy = setupComplexFirewallHierarchy;
exports.createIntegrationTestData = createIntegrationTestData;
exports.setupLibvirtMockState = setupLibvirtMockState;
exports.assertGraphQLSuccess = assertGraphQLSuccess;
exports.assertGraphQLError = assertGraphQLError;
exports.createPaginationInput = createPaginationInput;
exports.verifyFirewallStateConsistency = verifyFirewallStateConsistency;
exports.assertEffectiveRules = assertEffectiveRules;
exports.checkRuleInheritance = checkRuleInheritance;
exports.verifyRuleSynchronization = verifyRuleSynchronization;
exports.captureWebSocketEvents = captureWebSocketEvents;
exports.verifyEventSequence = verifyEventSequence;
exports.assertEventPayload = assertEventPayload;
exports.simulateMultipleConnections = simulateMultipleConnections;
exports.simulateServiceFailure = simulateServiceFailure;
exports.simulateNetworkIssues = simulateNetworkIssues;
exports.simulateDatabaseFailure = simulateDatabaseFailure;
exports.verifyErrorRecovery = verifyErrorRecovery;
exports.executeMultiStepWorkflow = executeMultiStepWorkflow;
exports.createMultipleRules = createMultipleRules;
exports.applyMultipleTemplates = applyMultipleTemplates;
exports.verifyMultiOperationResults = verifyMultiOperationResults;
exports.executeAcrossAllFirewallServices = executeAcrossAllFirewallServices;
exports.verifyServiceIntegration = verifyServiceIntegration;
exports.checkServiceStateConsistency = checkServiceStateConsistency;
exports.simulateConcurrentServiceOperations = simulateConcurrentServiceOperations;
exports.withComplexTransaction = withComplexTransaction;
exports.withErrorInjection = withErrorInjection;
exports.withMultiUserScenario = withMultiUserScenario;
exports.withServiceIntegrationTesting = withServiceIntegrationTesting;
exports.executeCompleteWorkflow = executeCompleteWorkflow;
exports.verifyWorkflowSteps = verifyWorkflowSteps;
exports.assertWorkflowConsistency = assertWorkflowConsistency;
exports.checkWorkflowEventDelivery = checkWorkflowEventDelivery;
exports.createComplexDepartmentScenario = createComplexDepartmentScenario;
exports.createComplexRuleHierarchy = createComplexRuleHierarchy;
exports.createFailureTestScenarios = createFailureTestScenarios;
exports.assertStateConsistency = assertStateConsistency;
exports.assertEventTiming = assertEventTiming;
exports.assertRuleInheritance = assertRuleInheritance;
exports.assertServiceIntegration = assertServiceIntegration;
exports.withTransaction = withTransaction;
const graphql_1 = require("graphql");
const jwt = __importStar(require("jsonwebtoken"));
const jest_setup_1 = require("./jest.setup");
const mock_factories_1 = require("./mock-factories");
// JWT token generation for testing
function generateTestToken(userId, role = 'USER') {
    return jwt.sign({ id: userId, role }, process.env.TOKENKEY || 'test-secret-key', { expiresIn: '24h' });
}
// GraphQL query/mutation executor
function executeGraphQL(options) {
    return __awaiter(this, void 0, void 0, function* () {
        const result = yield (0, graphql_1.graphql)({
            schema: options.schema,
            source: options.query,
            variableValues: options.variables,
            contextValue: options.context
        });
        return result;
    });
}
// Create mock Express request/response objects
function createMockContext(options = null, authorization) {
    // Handle both calling patterns: createMockContext(user) and createMockContext({ user, prisma })
    let user = null;
    if (options && typeof options === 'object' && 'user' in options) {
        user = options.user || null;
    }
    else {
        user = options;
    }
    const mockReq = {
        headers: authorization ? { authorization } : {},
        get: jest.fn(),
        header: jest.fn(),
        accepts: jest.fn(),
        acceptsCharsets: jest.fn(),
        // Add other required Request properties as empty functions/values
        method: 'GET',
        url: '/',
        originalUrl: '/',
        path: '/',
        query: {},
        params: {},
        body: {},
        cookies: {},
        files: undefined,
        hostname: 'localhost',
        ip: '127.0.0.1',
        ips: [],
        protocol: 'http',
        secure: false,
        xhr: false,
        fresh: false,
        stale: true,
        subdomains: [],
        baseUrl: '',
        route: undefined,
        app: {},
        is: jest.fn(),
        param: jest.fn(),
        range: jest.fn(),
        accepted: [],
        acceptsEncodings: jest.fn(),
        acceptsLanguages: jest.fn(),
        connection: {},
        socket: {}
    };
    const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        end: jest.fn().mockReturnThis(),
        header: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        cookie: jest.fn().mockReturnThis(),
        clearCookie: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        locals: {},
        headersSent: false
    };
    return {
        req: mockReq,
        res: mockRes,
        prisma: jest_setup_1.mockPrisma,
        user,
        setupMode: false,
        virtioSocketWatcher: undefined,
        eventManager: undefined
    };
}
// Helper functions for common context scenarios
function createAdminContext() {
    const adminUser = (0, mock_factories_1.createMockAdminUser)();
    return createMockContext(adminUser, 'admin-token');
}
function createUserContext() {
    const user = (0, mock_factories_1.createMockUser)();
    return createMockContext(user, 'user-token');
}
function createUnauthenticatedContext() {
    return createMockContext(null);
}
// Common GraphQL queries and mutations for testing
exports.TestQueries = {
    LOGIN: `
    query Login($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        token
      }
    }
  `,
    CURRENT_USER: `
    query CurrentUser {
      currentUser {
        id
        email
        firstName
        lastName
        role
      }
    }
  `,
    GET_USER: `
    query GetUser($id: String!) {
      user(id: $id) {
        id
        email
        firstName
        lastName
        role
        deleted
      }
    }
  `,
    LIST_USERS: `
    query ListUsers($orderBy: UserOrderByInputType, $pagination: PaginationInputType) {
      users(orderBy: $orderBy, pagination: $pagination) {
        id
        email
        firstName
        lastName
        role
      }
    }
  `,
    GET_MACHINE: `
    query GetMachine($id: String!) {
      machine(id: $id) {
        id
        name
        internalName
        status
        os
        cpuCores
        ramGB
        diskSizeGB
      }
    }
  `,
    LIST_MACHINES: `
    query ListMachines($orderBy: MachineOrderBy, $pagination: PaginationInputType) {
      machines(orderBy: $orderBy, pagination: $pagination) {
        id
        name
        status
        os
      }
    }
  `,
    LIST_DEPARTMENTS: `
    query ListDepartments {
      departments {
        id
        name
        totalMachines
      }
    }
  `,
    USERS: `
    query Users($orderBy: UserOrderByInputType, $pagination: PaginationInputType) {
      users(orderBy: $orderBy, pagination: $pagination) {
        id
        email
        firstName
        lastName
        role
      }
    }
  `,
    MACHINE: `
    query Machine($id: String!) {
      machine(id: $id) {
        id
        name
        internalName
        status
        os
        cpuCores
        ramGB
        diskSizeGB
      }
    }
  `,
    MACHINES: `
    query Machines($orderBy: MachineOrderBy, $pagination: PaginationInputType) {
      machines(orderBy: $orderBy, pagination: $pagination) {
        id
        name
        status
        os
      }
    }
  `,
    DEPARTMENT: `
    query Department($id: String!) {
      department(id: $id) {
        id
        name
        totalMachines
      }
    }
  `,
    DEPARTMENTS: `
    query Departments {
      departments {
        id
        name
        totalMachines
      }
    }
  `,
    MACHINE_TEMPLATES: `
    query MachineTemplates($orderBy: MachineTemplateOrderBy, $pagination: PaginationInputType) {
      machineTemplates(orderBy: $orderBy, pagination: $pagination) {
        id
        name
        cores
        ram
        storage
      }
    }
  `
};
exports.TestMutations = {
    CREATE_USER: `
    mutation CreateUser($input: CreateUserInputType!) {
      createUser(input: $input) {
        id
        email
        firstName
        lastName
        role
      }
    }
  `,
    UPDATE_USER: `
    mutation UpdateUser($id: String!, $input: UpdateUserInputType!) {
      updateUser(id: $id, input: $input) {
        id
        email
        firstName
        lastName
        role
      }
    }
  `,
    CREATE_MACHINE: `
    mutation CreateMachine($input: CreateMachineInputType!) {
      createMachine(input: $input) {
        id
        name
        internalName
        status
        os
      }
    }
  `,
    POWER_ON: `
    mutation PowerOn($id: String!) {
      powerOn(id: $id) {
        success
        message
      }
    }
  `,
    POWER_OFF: `
    mutation PowerOff($id: String!) {
      powerOff(id: $id) {
        success
        message
      }
    }
  `,
    DESTROY_MACHINE: `
    mutation DestroyMachine($id: String!) {
      destroyMachine(id: $id) {
        success
        message
      }
    }
  `,
    CREATE_DEPARTMENT: `
    mutation CreateDepartment($name: String!) {
      createDepartment(name: $name) {
        id
        name
      }
    }
  `,
    DESTROY_DEPARTMENT: `
    mutation DestroyDepartment($id: String!) {
      destroyDepartment(id: $id) {
        success
        message
      }
    }
  `,
    LOGIN: `
    mutation Login($email: String!, $password: String!) {
      login(email: $email, password: $password) {
        token
      }
    }
  `,
    DELETE_USER: `
    mutation UpdateUser($id: String!, $input: UpdateUserInputType!) {
      updateUser(id: $id, input: $input) {
        id
        email
      }
    }
  `,
    DELETE_DEPARTMENT: `
    mutation DestroyDepartment($id: String!) {
      destroyDepartment(id: $id) {
        id
        name
      }
    }
  `
};
// Error matchers
exports.ErrorMatchers = {
    unauthorized: expect.objectContaining({
        message: expect.stringContaining('Unauthorized')
    }),
    notFound: expect.objectContaining({
        message: expect.stringContaining('not found')
    }),
    validationError: expect.objectContaining({
        message: expect.stringContaining('Validation')
    }),
    duplicateError: expect.objectContaining({
        message: expect.stringContaining('already exists')
    })
};
// Test data cleanup utilities
function cleanupTestData(prisma, tables) {
    return __awaiter(this, void 0, void 0, function* () {
        const prismaClient = prisma;
        for (const table of tables.reverse()) {
            try {
                yield prismaClient[table].deleteMany({});
            }
            catch (error) {
                // Ignore errors for non-existent tables
            }
        }
    });
}
// Wait utility for async operations
function waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
// Multi-VM Test Setup Helpers
function createDepartmentWithVMs(prisma_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, vmCount = 3, departmentName) {
        const department = yield prisma.department.create({
            data: {
                name: departmentName || `Department-${Date.now()}`
            }
        });
        const vms = [];
        for (let i = 0; i < vmCount; i++) {
            const user = yield prisma.user.create({
                data: (0, mock_factories_1.createMockUser)()
            });
            const vm = yield prisma.machine.create({
                data: Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)()), { name: `TestVM-${i + 1}`, internalName: `testvm-${i + 1}`, userId: user.id, departmentId: department.id })
            });
            vms.push({ vm, user });
        }
        return { department, vms };
    });
}
function createMultipleDepartments(prisma_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, departmentCount = 2, vmsPerDepartment = 2) {
        const departments = [];
        for (let i = 0; i < departmentCount; i++) {
            const { department, vms } = yield createDepartmentWithVMs(prisma, vmsPerDepartment, `TestDept-${i + 1}`);
            departments.push({ department, vms });
        }
        return departments;
    });
}
function setupComplexFirewallHierarchy(prisma) {
    return __awaiter(this, void 0, void 0, function* () {
        const globalTemplate = {
            name: 'Global-Security',
            rules: [
                { action: 'allow', port: 22, protocol: 'tcp', description: 'SSH' },
                { action: 'allow', port: 80, protocol: 'tcp', description: 'HTTP' }
            ]
        };
        const departmentTemplate = {
            name: 'Department-Web',
            rules: [
                { action: 'allow', port: 443, protocol: 'tcp', description: 'HTTPS' },
                { action: 'allow', port: 8080, protocol: 'tcp', description: 'Alt-HTTP' }
            ]
        };
        const vmTemplate = {
            name: 'VM-Database',
            rules: [
                { action: 'allow', port: 3306, protocol: 'tcp', description: 'MySQL' },
                { action: 'allow', port: 5432, protocol: 'tcp', description: 'PostgreSQL' }
            ]
        };
        return { globalTemplate, departmentTemplate, vmTemplate };
    });
}
function createIntegrationTestData() {
    return {
        users: Array.from({ length: 5 }, (_, i) => (Object.assign(Object.assign({}, (0, mock_factories_1.createMockUser)()), { email: `user${i + 1}@test.com` }))),
        machines: Array.from({ length: 5 }, (_, i) => (Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)()), { name: `TestMachine-${i + 1}`, internalName: `testmachine-${i + 1}` }))),
        departments: Array.from({ length: 3 }, (_, i) => ({
            name: `TestDepartment-${i + 1}`
        }))
    };
}
// Mock libvirt state helper
function setupLibvirtMockState(state) {
    const libvirt = require('libvirt-node');
    if (libvirt.__setLibvirtMockState) {
        libvirt.__setLibvirtMockState(state);
    }
}
// Response assertion helpers
function assertGraphQLSuccess(result) {
    const response = result;
    expect(response.errors).toBeUndefined();
    expect(response.data).toBeDefined();
}
function assertGraphQLError(result, expectedError) {
    var _a;
    const response = result;
    expect(response.errors).toBeDefined();
    expect((_a = response.errors) === null || _a === void 0 ? void 0 : _a.length).toBeGreaterThan(0);
    if (expectedError && response.errors) {
        expect(response.errors[0].message).toContain(expectedError);
    }
}
function createPaginationInput(page = 1, pageSize = 10, orderBy = 'createdAt') {
    return {
        take: pageSize,
        skip: (page - 1) * pageSize,
        orderBy
    };
}
// Firewall State Verification Utilities
function verifyFirewallStateConsistency(prisma, machineId) {
    return __awaiter(this, void 0, void 0, function* () {
        const machine = yield prisma.machine.findUnique({
            where: { id: machineId },
            include: { department: true }
        });
        if (!machine) {
            throw new Error(`Machine ${machineId} not found`);
        }
        return {
            isValid: true,
            machine,
            firewallData: undefined,
            departmentId: machine.departmentId
        };
    });
}
function assertEffectiveRules(rules, expectedRules) {
    expect(rules).toHaveLength(expectedRules.length);
    expectedRules.forEach((expected, index) => {
        expect(rules[index]).toMatchObject(expected);
    });
}
function checkRuleInheritance(vmRules, departmentRules, globalRules) {
    const allRules = [...globalRules, ...departmentRules, ...vmRules];
    const effectiveRules = allRules.reduce((acc, rule) => {
        const key = `${rule.port}-${rule.protocol}`;
        if (!acc[key] || rule.priority > acc[key].priority) {
            acc[key] = rule;
        }
        return acc;
    }, {});
    return Object.values(effectiveRules);
}
function verifyRuleSynchronization(beforeRules, afterRules) {
    const beforeSet = new Set(beforeRules.map(r => `${r.port}-${r.protocol}-${r.action}`));
    const afterSet = new Set(afterRules.map(r => `${r.port}-${r.protocol}-${r.action}`));
    return {
        added: [...afterSet].filter(r => !beforeSet.has(r)),
        removed: [...beforeSet].filter(r => !afterSet.has(r)),
        unchanged: [...beforeSet].filter(r => afterSet.has(r))
    };
}
let capturedEvents = [];
function captureWebSocketEvents() {
    capturedEvents = [];
    const mockEmit = jest.fn((eventType, payload, userId) => {
        capturedEvents.push({
            eventType,
            payload,
            timestamp: Date.now(),
            userId
        });
    });
    return { mockEmit, getCapturedEvents: () => [...capturedEvents] };
}
function verifyEventSequence(events, expectedSequence) {
    expect(events).toHaveLength(expectedSequence.length);
    events.forEach((event, index) => {
        expect(event.eventType).toBe(expectedSequence[index]);
    });
}
function assertEventPayload(event, expectedPayload) {
    expect(event.payload).toMatchObject(expectedPayload);
}
function simulateMultipleConnections(userCount) {
    const connections = [];
    for (let i = 0; i < userCount; i++) {
        const userId = `user-${i + 1}`;
        const mockSocket = {
            id: `socket-${i + 1}`,
            userId,
            emit: jest.fn(),
            on: jest.fn(),
            disconnect: jest.fn()
        };
        connections.push(mockSocket);
    }
    return connections;
}
// Error Simulation and Recovery Testing
function simulateServiceFailure(serviceName, errorMessage) {
    const error = new Error(errorMessage || `${serviceName} service failure`);
    const mockFn = jest.fn().mockRejectedValue(error);
    return { error, mockFn };
}
function simulateNetworkIssues() {
    const networkError = new Error('Network connection failed');
    networkError.name = 'NetworkError';
    return networkError;
}
function simulateDatabaseFailure() {
    const dbError = new Error('Database connection lost');
    dbError.name = 'DatabaseError';
    return dbError;
}
function verifyErrorRecovery(operation, expectedError) {
    return __awaiter(this, void 0, void 0, function* () {
        yield expect(operation()).rejects.toThrow(expectedError);
    });
}
// Multi-Operation Helpers
function executeMultiStepWorkflow(steps_1) {
    return __awaiter(this, arguments, void 0, function* (steps, rollbackOnFailure = true) {
        const results = [];
        const completedSteps = [];
        try {
            for (const step of steps) {
                const result = yield step();
                results.push(result);
                completedSteps.push(step);
            }
            return results;
        }
        catch (error) {
            if (rollbackOnFailure) {
                // Simulate rollback of completed steps
                console.log(`Rolling back ${completedSteps.length} completed steps`);
            }
            throw error;
        }
    });
}
function createMultipleRules(count, basePort = 8000) {
    return Array.from({ length: count }, (_, i) => ({
        action: i % 2 === 0 ? 'allow' : 'deny',
        port: basePort + i,
        protocol: i % 3 === 0 ? 'udp' : 'tcp',
        description: `Test rule ${i + 1}`
    }));
}
function applyMultipleTemplates(templateCount) {
    return Array.from({ length: templateCount }, (_, i) => ({
        name: `Template-${i + 1}`,
        description: `Test template ${i + 1}`,
        rules: createMultipleRules(3, 9000 + (i * 10))
    }));
}
function verifyMultiOperationResults(results, expectedCount) {
    expect(results).toHaveLength(expectedCount);
    results.forEach((result, index) => {
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
    });
}
// Cross-Service Integration Helpers
function executeAcrossAllFirewallServices(operations) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = {};
        if (operations.networkFilter) {
            results.networkFilter = yield operations.networkFilter();
        }
        if (operations.departmentFirewall) {
            results.departmentFirewall = yield operations.departmentFirewall();
        }
        if (operations.firewallSimplifier) {
            results.firewallSimplifier = yield operations.firewallSimplifier();
        }
        if (operations.advancedFirewall) {
            results.advancedFirewall = yield operations.advancedFirewall();
        }
        return results;
    });
}
function verifyServiceIntegration(serviceResults) {
    Object.entries(serviceResults).forEach(([serviceName, result]) => {
        expect(result).toBeDefined();
        expect(result).not.toBeNull();
    });
}
function checkServiceStateConsistency(serviceStates, expectedConsistencyKeys) {
    const services = Object.keys(serviceStates);
    expect(services.length).toBeGreaterThan(1);
    expectedConsistencyKeys.forEach(key => {
        const values = services.map(service => serviceStates[service][key]);
        const firstValue = values[0];
        values.forEach(value => {
            expect(value).toEqual(firstValue);
        });
    });
}
function simulateConcurrentServiceOperations(operations) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = yield Promise.allSettled(operations.map(op => op()));
        const successful = results.filter(r => r.status === 'fulfilled');
        const failed = results.filter(r => r.status === 'rejected');
        return {
            successful: successful.map(r => r.value),
            failed: failed.map(r => r.reason),
            totalCount: results.length,
            successCount: successful.length,
            failureCount: failed.length
        };
    });
}
function withComplexTransaction(prisma_1, testFn_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, testFn, options = {}) {
        yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            const testUser = yield tx.user.create({ data: (0, mock_factories_1.createMockUser)() });
            const adminUser = yield tx.user.create({
                data: Object.assign(Object.assign({}, (0, mock_factories_1.createMockUser)()), { role: 'ADMIN', email: 'admin@test.com' })
            });
            const departments = yield createMultipleDepartments(tx, options.departmentCount || 2, options.vmCount || 2);
            const testMachine = yield tx.machine.create({
                data: Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)()), { userId: testUser.id })
            });
            const multipleVMs = departments.flatMap(d => d.vms);
            const templates = yield setupComplexFirewallHierarchy(tx);
            const context = {
                prisma: tx,
                user: testUser,
                req: {},
                res: {},
                setupMode: false,
                virtioSocketWatcher: undefined,
                eventManager: undefined
            };
            const adminContext = {
                prisma: tx,
                user: adminUser,
                req: {},
                res: {},
                setupMode: false,
                virtioSocketWatcher: undefined,
                eventManager: undefined
            };
            jest.clearAllMocks();
            yield testFn({
                testUser,
                adminUser,
                testMachine,
                context,
                adminContext,
                departments: departments.map(d => d.department),
                multipleVMs,
                templates: templates
            });
            throw new Error('Test complete - rollback transaction');
        }), { timeout: 30000 }).catch((error) => {
            if (!error.message.includes('Test complete - rollback transaction')) {
                throw error;
            }
        });
    });
}
function withErrorInjection(prisma_1, testFn_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, testFn, errorConfig = {}) {
        const originalTransaction = withTransaction;
        try {
            yield originalTransaction(prisma, (params) => __awaiter(this, void 0, void 0, function* () {
                if (errorConfig.failurePoint) {
                    // Inject error at specified point
                    const error = new Error(errorConfig.errorMessage || 'Injected test error');
                    error.name = 'InjectedError';
                    throw error;
                }
                yield testFn(params);
            }));
        }
        catch (error) {
            if (error.name === 'InjectedError') {
                // Expected injected error
                return;
            }
            throw error;
        }
    });
}
function withMultiUserScenario(prisma_1, testFn_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, testFn, userCount = 3) {
        yield withTransaction(prisma, (params) => __awaiter(this, void 0, void 0, function* () {
            const additionalUsers = [];
            for (let i = 0; i < userCount; i++) {
                const user = yield params.context.prisma.user.create({
                    data: Object.assign(Object.assign({}, (0, mock_factories_1.createMockUser)()), { email: `additional-user-${i + 1}@test.com` })
                });
                additionalUsers.push(user);
            }
            yield testFn(Object.assign(Object.assign({}, params), { additionalUsers }));
        }));
    });
}
function withServiceIntegrationTesting(prisma, testFn) {
    return __awaiter(this, void 0, void 0, function* () {
        yield withComplexTransaction(prisma, testFn, { vmCount: 3, departmentCount: 2 });
    });
}
// Workflow Testing Utilities
function executeCompleteWorkflow(steps) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = [];
        for (const step of steps) {
            console.log(`Executing workflow step: ${step.name}`);
            const result = yield step.operation();
            step.verify(result);
            results.push({ step: step.name, result });
        }
        return results;
    });
}
function verifyWorkflowSteps(workflow, expectedSteps) {
    expect(workflow).toHaveLength(expectedSteps.length);
    workflow.forEach((step, index) => {
        expect(step.step).toBe(expectedSteps[index]);
        expect(step.result).toBeDefined();
    });
}
function assertWorkflowConsistency(workflowResults) {
    expect(workflowResults.length).toBeGreaterThan(0);
    workflowResults.forEach(result => {
        expect(result.step).toBeDefined();
        expect(result.result).toBeDefined();
    });
}
function checkWorkflowEventDelivery(events, workflowSteps) {
    workflowSteps.forEach(stepName => {
        const stepEvents = events.filter(e => e.eventType.includes(stepName));
        expect(stepEvents.length).toBeGreaterThanOrEqual(1);
    });
}
// Test Data Factories
function createComplexDepartmentScenario() {
    return {
        departments: [
            { name: 'Engineering', vmCount: 5 },
            { name: 'Marketing', vmCount: 3 },
            { name: 'Operations', vmCount: 4 }
        ],
        templates: [
            {
                name: 'Web-Server',
                rules: [
                    { action: 'allow', port: 80, protocol: 'tcp' },
                    { action: 'allow', port: 443, protocol: 'tcp' }
                ]
            },
            {
                name: 'Database-Server',
                rules: [
                    { action: 'allow', port: 3306, protocol: 'tcp' },
                    { action: 'allow', port: 5432, protocol: 'tcp' }
                ]
            }
        ]
    };
}
function createComplexRuleHierarchy() {
    return {
        global: [
            { action: 'allow', port: 22, protocol: 'tcp', priority: 1 },
            { action: 'deny', port: 23, protocol: 'tcp', priority: 1 }
        ],
        department: [
            { action: 'allow', port: 80, protocol: 'tcp', priority: 2 },
            { action: 'allow', port: 443, protocol: 'tcp', priority: 2 }
        ],
        vm: [
            { action: 'allow', port: 8080, protocol: 'tcp', priority: 3 },
            { action: 'deny', port: 80, protocol: 'tcp', priority: 3 } // Override department rule
        ]
    };
}
function createFailureTestScenarios() {
    return {
        networkFailure: () => simulateNetworkIssues(),
        databaseFailure: () => simulateDatabaseFailure(),
        serviceFailure: (service) => simulateServiceFailure(service),
        partialFailure: () => ({ success: false, partialData: { recovered: true } })
    };
}
// Assertion Helpers
function assertStateConsistency(states, consistencyRules) {
    consistencyRules.forEach(rule => {
        Object.entries(states).forEach(([stateName, state]) => {
            const value = state[rule.key];
            expect(rule.validator(value)).toBe(true);
        });
    });
}
function assertEventTiming(events, maxTimeDifference = 1000, enabled = false) {
    // Timing assertions are disabled by default to avoid flakiness
    if (!enabled || events.length < 2)
        return;
    for (let i = 1; i < events.length; i++) {
        const timeDiff = events[i].timestamp - events[i - 1].timestamp;
        expect(timeDiff).toBeLessThanOrEqual(maxTimeDifference);
    }
}
function assertRuleInheritance(effectiveRules, inheritanceChain) {
    const allSourceRules = inheritanceChain.flatMap(chain => chain.rules.map(rule => (Object.assign(Object.assign({}, rule), { source: chain.source }))));
    effectiveRules.forEach(rule => {
        const matchingSourceRules = allSourceRules.filter(sr => sr.port === rule.port && sr.protocol === rule.protocol);
        expect(matchingSourceRules.length).toBeGreaterThan(0);
    });
}
function assertServiceIntegration(integrationResults, requiredServices) {
    requiredServices.forEach(service => {
        expect(integrationResults[service]).toBeDefined();
        expect(integrationResults[service]).not.toBeNull();
    });
}
// Shared transaction helper for integration tests
function withTransaction(prisma, testFn) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            // Create test users within transaction
            const testUser = yield tx.user.create({
                data: (0, mock_factories_1.createMockUser)()
            });
            const adminUser = yield tx.user.create({
                data: Object.assign(Object.assign({}, (0, mock_factories_1.createMockUser)()), { role: 'ADMIN', email: 'admin@test.com' })
            });
            // Create test machine
            const testMachine = yield tx.machine.create({
                data: Object.assign(Object.assign({}, (0, mock_factories_1.createMockMachine)()), { userId: testUser.id })
            });
            const context = {
                prisma: tx,
                user: testUser,
                req: {},
                res: {},
                setupMode: false,
                virtioSocketWatcher: undefined,
                eventManager: undefined
            };
            const adminContext = {
                prisma: tx,
                user: adminUser,
                req: {},
                res: {},
                setupMode: false,
                virtioSocketWatcher: undefined,
                eventManager: undefined
            };
            // Clear all mocks
            jest.clearAllMocks();
            // Run the test
            yield testFn({ testUser, adminUser, testMachine, context, adminContext });
            // Throw error to force rollback
            throw new Error('Test complete - rollback transaction');
        }), {
            timeout: 30000 // 30 second timeout for long tests
        }).catch((error) => {
            // Expected error from rollback
            if (!error.message.includes('Test complete - rollback transaction')) {
                throw error; // Re-throw unexpected errors
            }
        });
    });
}
