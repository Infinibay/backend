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
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const resolver_1 = require("@graphql/resolvers/user/resolver");
const errors_1 = require("@utils/errors");
const pagination_1 = require("@utils/pagination");
const type_1 = require("@graphql/resolvers/user/type");
const jest_setup_1 = require("../../setup/jest.setup");
const db_factories_1 = require("../../setup/db-factories");
/**
 * UserResolver tests — real database.
 *
 * UserResolver instantiates `new PrismaClient()` directly per call, which
 * connects to DATABASE_URL from the env. Under `.env.test` that resolves to
 * the test DB — the same one `testPrisma.prisma` is talking to. We seed
 * through testPrisma and read results back through the resolver.
 */
describe('UserResolver — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    let resolver;
    let adminContext;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        resolver = new resolver_1.UserResolver();
        const admin = yield (0, db_factories_1.createAdmin)(prisma);
        adminContext = {
            prisma,
            user: admin,
            req: {},
            res: {},
            setupMode: false,
        };
    }));
    describe('currentUser', () => {
        it('returns the user from context with a namespace', () => __awaiter(void 0, void 0, void 0, function* () {
            const contextUser = yield (0, db_factories_1.createUser)(prisma);
            const ctx = Object.assign(Object.assign({}, adminContext), { user: contextUser });
            const result = yield resolver.currentUser(ctx);
            expect(result).toBeTruthy();
            expect(result === null || result === void 0 ? void 0 : result.id).toBe(contextUser.id);
            expect(result === null || result === void 0 ? void 0 : result.namespace).toBe(`user_${contextUser.id.substring(0, 8)}`);
        }));
        it('returns null when the context has no user', () => __awaiter(void 0, void 0, void 0, function* () {
            const ctx = Object.assign(Object.assign({}, adminContext), { user: null });
            expect(yield resolver.currentUser(ctx)).toBeNull();
        }));
    });
    describe('user(id)', () => {
        it('returns a user by id', () => __awaiter(void 0, void 0, void 0, function* () {
            const target = yield (0, db_factories_1.createUser)(prisma);
            const result = yield resolver.user(target.id);
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.id).toBe(target.id);
            expect(result === null || result === void 0 ? void 0 : result.email).toBe(target.email);
        }));
        it('returns null when the id is unknown', () => __awaiter(void 0, void 0, void 0, function* () {
            expect(yield resolver.user('non-existent-id')).toBeNull();
        }));
    });
    describe('users(orderBy, pagination)', () => {
        it('returns users ordered by createdAt desc with pagination', () => __awaiter(void 0, void 0, void 0, function* () {
            const users = [];
            for (let i = 0; i < 6; i++) {
                users.push(yield (0, db_factories_1.createUser)(prisma, { email: `paginate-${i}-${Date.now()}@test.infinibay` }));
            }
            const result = yield resolver.users({ fieldName: type_1.UserOrderByField.CREATED_AT, direction: pagination_1.OrderByDirection.DESC }, { take: 3, skip: 0 });
            expect(result).toHaveLength(3);
            // Most-recently created first — the 6 seeded users + 1 admin from beforeEach.
            // Just verify the ordering is respected (descending createdAt).
            for (let i = 0; i < result.length - 1; i++) {
                expect(result[i].createdAt.getTime())
                    .toBeGreaterThanOrEqual(result[i + 1].createdAt.getTime());
            }
        }));
        it('returns an empty array when pagination skips past all rows', () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield resolver.users({ fieldName: type_1.UserOrderByField.EMAIL, direction: pagination_1.OrderByDirection.ASC }, { take: 10, skip: 10000 });
            expect(result).toEqual([]);
        }));
        it('orders by email ascending when requested', () => __awaiter(void 0, void 0, void 0, function* () {
            yield (0, db_factories_1.createUser)(prisma, { email: 'aaa@test.infinibay' });
            yield (0, db_factories_1.createUser)(prisma, { email: 'zzz@test.infinibay' });
            const result = yield resolver.users({ fieldName: type_1.UserOrderByField.EMAIL, direction: pagination_1.OrderByDirection.ASC }, { take: 100, skip: 0 });
            const emails = result.map(u => u.email);
            const sorted = [...emails].sort();
            expect(emails).toEqual(sorted);
        }));
    });
    describe('login', () => {
        it('returns a JWT token on correct credentials', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const password = 'password123';
            const user = yield (0, db_factories_1.createUser)(prisma, { password: bcrypt_1.default.hashSync(password, 4) });
            const result = yield resolver.login(user.email, password);
            expect(result).not.toBeNull();
            expect(result === null || result === void 0 ? void 0 : result.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
            const decoded = jsonwebtoken_1.default.verify(result.token, (_a = process.env.TOKENKEY) !== null && _a !== void 0 ? _a : 'secret');
            expect(decoded.userId).toBe(user.id);
        }));
        it('throws for an unknown email', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(resolver.login('no-such-user@test.infinibay', 'password'))
                .rejects.toThrow('Invalid credentials');
        }));
        it('throws for an incorrect password', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma, { password: bcrypt_1.default.hashSync('correct', 4) });
            yield expect(resolver.login(user.email, 'wrong-password'))
                .rejects.toThrow('Invalid credentials');
        }));
        it('still authenticates a soft-deleted user (resolver does not check the flag)', () => __awaiter(void 0, void 0, void 0, function* () {
            const password = 'password';
            const user = yield (0, db_factories_1.createUser)(prisma, {
                deleted: true,
                password: bcrypt_1.default.hashSync(password, 4)
            });
            const result = yield resolver.login(user.email, password);
            expect(result === null || result === void 0 ? void 0 : result.token).toBeTruthy();
        }));
    });
    describe('createUser', () => {
        it('creates a new user with a hashed password', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                email: `new-${Date.now()}@test.infinibay`,
                password: 'plainpw123',
                passwordConfirmation: 'plainpw123',
                firstName: 'New',
                lastName: 'User',
                role: type_1.UserRole.USER,
            };
            const result = yield resolver.createUser(input, adminContext);
            expect(result.email).toBe(input.email);
            expect(result.firstName).toBe('New');
            const stored = yield prisma.user.findUnique({ where: { email: input.email } });
            expect(stored).not.toBeNull();
            expect(stored.password).not.toBe('plainpw123');
            expect(yield bcrypt_1.default.compare('plainpw123', stored.password)).toBe(true);
        }));
        it('throws UserInputError if the email is already taken', () => __awaiter(void 0, void 0, void 0, function* () {
            const existing = yield (0, db_factories_1.createUser)(prisma);
            const input = {
                email: existing.email,
                password: 'x1x2x3x4',
                passwordConfirmation: 'x1x2x3x4',
                firstName: 'Dup',
                lastName: 'User',
                role: type_1.UserRole.USER,
            };
            yield expect(resolver.createUser(input, adminContext)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('does not validate email format (by design)', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                email: `garbage-${Date.now()}`,
                password: 'plainpw123',
                passwordConfirmation: 'plainpw123',
                firstName: 'Weird',
                lastName: 'Email',
                role: type_1.UserRole.USER,
            };
            const result = yield resolver.createUser(input, adminContext);
            expect(result.email).toBe(input.email);
        }));
        it('rejects mismatched password confirmation', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                email: `mismatch-${Date.now()}@test.infinibay`,
                password: '123',
                passwordConfirmation: '456',
                firstName: 'Mis',
                lastName: 'Match',
                role: type_1.UserRole.USER,
            };
            yield expect(resolver.createUser(input, adminContext)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('creates an admin user when role=ADMIN', () => __awaiter(void 0, void 0, void 0, function* () {
            const input = {
                email: `admin-new-${Date.now()}@test.infinibay`,
                password: 'plainpw123',
                passwordConfirmation: 'plainpw123',
                firstName: 'Admin',
                lastName: 'New',
                role: type_1.UserRole.ADMIN,
            };
            const result = yield resolver.createUser(input, adminContext);
            expect(result.role).toBe('ADMIN');
        }));
    });
    describe('updateUser', () => {
        it('updates first/last name', () => __awaiter(void 0, void 0, void 0, function* () {
            const target = yield (0, db_factories_1.createUser)(prisma, { firstName: 'Old', lastName: 'Name' });
            yield resolver.updateUser(target.id, { firstName: 'Updated', lastName: 'Name', password: undefined, passwordConfirmation: undefined, role: undefined }, adminContext);
            const reloaded = yield prisma.user.findUnique({ where: { id: target.id } });
            expect(reloaded === null || reloaded === void 0 ? void 0 : reloaded.firstName).toBe('Updated');
        }));
        it('hashes the new password when provided', () => __awaiter(void 0, void 0, void 0, function* () {
            const target = yield (0, db_factories_1.createUser)(prisma);
            const newPassword = 'NewSecurePass123!';
            yield resolver.updateUser(target.id, { firstName: undefined, lastName: undefined, password: newPassword, passwordConfirmation: newPassword, role: undefined }, adminContext);
            const reloaded = yield prisma.user.findUnique({ where: { id: target.id } });
            expect(reloaded === null || reloaded === void 0 ? void 0 : reloaded.password).not.toBe(newPassword);
            expect(yield bcrypt_1.default.compare(newPassword, reloaded.password)).toBe(true);
        }));
        it('throws if the user does not exist', () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(resolver.updateUser('non-existent', { firstName: 'X', lastName: undefined, password: undefined, passwordConfirmation: undefined, role: undefined }, adminContext)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('rejects mismatched password confirmation', () => __awaiter(void 0, void 0, void 0, function* () {
            const target = yield (0, db_factories_1.createUser)(prisma);
            yield expect(resolver.updateUser(target.id, { firstName: undefined, lastName: undefined, password: 'A', passwordConfirmation: 'B', role: undefined }, adminContext)).rejects.toThrow(errors_1.UserInputError);
        }));
        it('allows an admin to promote a user to ADMIN', () => __awaiter(void 0, void 0, void 0, function* () {
            const target = yield (0, db_factories_1.createUser)(prisma, { role: 'USER' });
            const result = yield resolver.updateUser(target.id, { firstName: undefined, lastName: undefined, password: undefined, passwordConfirmation: undefined, role: type_1.UserRole.ADMIN }, adminContext);
            expect(result.role).toBe('ADMIN');
        }));
    });
});
