"use strict";
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
exports.createUser = createUser;
exports.createAdmin = createAdmin;
exports.createDepartment = createDepartment;
exports.createTemplateCategory = createTemplateCategory;
exports.createTemplate = createTemplate;
exports.createApplication = createApplication;
exports.createMachine = createMachine;
exports.createHealthSnapshot = createHealthSnapshot;
exports.seedBaseFixtures = seedBaseFixtures;
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = require("crypto");
// Cheap hash (4 rounds) — tests don't care about cryptographic strength.
const TEST_PASSWORD_HASH = bcrypt_1.default.hashSync('TestPass123!', 4);
function unique(prefix) {
    return `${prefix}-${Date.now()}-${(0, crypto_1.randomUUID)().slice(0, 8)}`;
}
function createUser(prisma_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, overrides = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const id = (_a = overrides.id) !== null && _a !== void 0 ? _a : (0, crypto_1.randomUUID)();
        return prisma.user.create({
            data: {
                id,
                email: (_b = overrides.email) !== null && _b !== void 0 ? _b : `user-${id}@test.infinibay`,
                password: (_c = overrides.password) !== null && _c !== void 0 ? _c : TEST_PASSWORD_HASH,
                firstName: (_d = overrides.firstName) !== null && _d !== void 0 ? _d : 'Test',
                lastName: (_e = overrides.lastName) !== null && _e !== void 0 ? _e : 'User',
                deleted: (_f = overrides.deleted) !== null && _f !== void 0 ? _f : false,
                role: (_g = overrides.role) !== null && _g !== void 0 ? _g : 'USER',
                token: (_h = overrides.token) !== null && _h !== void 0 ? _h : 'null',
            }
        });
    });
}
function createAdmin(prisma, overrides = {}) {
    return createUser(prisma, Object.assign({ firstName: 'Admin', role: 'ADMIN' }, overrides));
}
function createDepartment(prisma_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, overrides = {}) {
        var _a, _b;
        return prisma.department.create({
            data: Object.assign({ name: (_a = overrides.name) !== null && _a !== void 0 ? _a : unique('dept'), bridgeName: (_b = overrides.bridgeName) !== null && _b !== void 0 ? _b : null }, (overrides.id ? { id: overrides.id } : {}))
        });
    });
}
function createTemplateCategory(prisma_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, overrides = {}) {
        var _a, _b;
        return prisma.machineTemplateCategory.create({
            data: {
                name: (_a = overrides.name) !== null && _a !== void 0 ? _a : unique('category'),
                description: (_b = overrides.description) !== null && _b !== void 0 ? _b : 'test category',
            }
        });
    });
}
function createTemplate(prisma_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, overrides = {}) {
        var _a, _b, _c, _d, _e;
        const categoryId = (_a = overrides.categoryId) !== null && _a !== void 0 ? _a : (yield createTemplateCategory(prisma)).id;
        return prisma.machineTemplate.create({
            data: {
                name: (_b = overrides.name) !== null && _b !== void 0 ? _b : unique('template'),
                cores: (_c = overrides.cores) !== null && _c !== void 0 ? _c : 4,
                ram: (_d = overrides.ram) !== null && _d !== void 0 ? _d : 8,
                storage: (_e = overrides.storage) !== null && _e !== void 0 ? _e : 100,
                categoryId,
            }
        });
    });
}
function createApplication(prisma_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, overrides = {}) {
        var _a, _b, _c, _d, _e;
        return prisma.application.create({
            data: {
                name: (_a = overrides.name) !== null && _a !== void 0 ? _a : unique('app'),
                description: (_b = overrides.description) !== null && _b !== void 0 ? _b : 'Test app',
                os: (_c = overrides.os) !== null && _c !== void 0 ? _c : ['linux'],
                installCommand: (_d = overrides.installCommand) !== null && _d !== void 0 ? _d : 'echo install',
                parameters: (_e = overrides.parameters) !== null && _e !== void 0 ? _e : {},
            }
        });
    });
}
function createMachine(prisma, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const { userId, departmentId, overrides = {}, withConfiguration = false } = opts;
        return prisma.machine.create({
            data: Object.assign(Object.assign(Object.assign({}, (overrides.id ? { id: overrides.id } : {})), { name: (_a = overrides.name) !== null && _a !== void 0 ? _a : unique('vm'), internalName: (_b = overrides.internalName) !== null && _b !== void 0 ? _b : unique('internal'), status: (_c = overrides.status) !== null && _c !== void 0 ? _c : 'stopped', os: (_d = overrides.os) !== null && _d !== void 0 ? _d : 'ubuntu', cpuCores: (_e = overrides.cpuCores) !== null && _e !== void 0 ? _e : 2, ramGB: (_f = overrides.ramGB) !== null && _f !== void 0 ? _f : 4, diskSizeGB: (_g = overrides.diskSizeGB) !== null && _g !== void 0 ? _g : 50, userId,
                departmentId }), (withConfiguration
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
                : {}))
        });
    });
}
function createHealthSnapshot(prisma, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const data = {
            machineId: opts.machineId,
            overallStatus: (_a = opts.overallStatus) !== null && _a !== void 0 ? _a : 'HEALTHY',
            checksCompleted: 1,
            checksFailed: 0,
            osType: (_b = opts.osType) !== null && _b !== void 0 ? _b : 'linux',
        };
        if (opts.diskSpaceInfo !== undefined)
            data.diskSpaceInfo = opts.diskSpaceInfo;
        if (opts.resourceOptInfo !== undefined)
            data.resourceOptInfo = opts.resourceOptInfo;
        if (opts.windowsUpdateInfo !== undefined)
            data.windowsUpdateInfo = opts.windowsUpdateInfo;
        if (opts.defenderStatus !== undefined)
            data.defenderStatus = opts.defenderStatus;
        return prisma.vMHealthSnapshot.create({ data });
    });
}
/**
 * One-shot "typical test setup" — an admin, a regular user, a department, a
 * template, and an application. Call this in beforeEach when the test needs
 * the full fixture set. Returns an object of the created rows.
 */
function seedBaseFixtures(prisma) {
    return __awaiter(this, void 0, void 0, function* () {
        const admin = yield createAdmin(prisma);
        const user = yield createUser(prisma);
        const department = yield createDepartment(prisma);
        const template = yield createTemplate(prisma);
        const application = yield createApplication(prisma);
        return { admin, user, department, template, application };
    });
}
