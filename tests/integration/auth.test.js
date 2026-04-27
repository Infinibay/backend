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
const test_helpers_1 = require("../setup/test-helpers");
const jest_setup_1 = require("../setup/jest.setup");
const db_factories_1 = require("../setup/db-factories");
/**
 * Auth checker used across tests. Mirrors the production authChecker closely
 * enough to exercise the important branches (setup mode, token presence,
 * JWT verification, user lookup, deletion flag, role).
 */
function testAuthChecker(prisma, context, roles) {
    return __awaiter(this, void 0, void 0, function* () {
        if (context.setupMode && roles.includes('SETUP_MODE'))
            return true;
        const token = context.req.headers.authorization;
        if (!token)
            return false;
        try {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.TOKENKEY || 'test-secret-key');
            const tokenUserId = decoded.userId || decoded.id;
            const user = yield prisma.user.findUnique({ where: { id: tokenUserId } });
            if (!user || user.deleted)
                return false;
            context.user = user;
            if (roles.includes('ADMIN') && user.role !== 'ADMIN')
                return false;
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
describe('Authentication Flow — real database', () => {
    const prisma = jest_setup_1.testPrisma.prisma;
    describe('Login Flow', () => {
        it('authenticates a user with a valid password', () => __awaiter(void 0, void 0, void 0, function* () {
            const plain = 'SecurePassword123!';
            const user = yield (0, db_factories_1.createUser)(prisma, {
                password: bcrypt_1.default.hashSync(plain, 4)
            });
            const found = yield prisma.user.findUnique({ where: { email: user.email } });
            expect(found).not.toBeNull();
            expect(yield bcrypt_1.default.compare(plain, found.password)).toBe(true);
            const token = jsonwebtoken_1.default.sign({ userId: user.id, userRole: user.role }, process.env.TOKENKEY || 'test-secret-key');
            const decoded = jsonwebtoken_1.default.verify(token, process.env.TOKENKEY || 'test-secret-key');
            expect(decoded.userId).toBe(user.id);
            expect(decoded.userRole).toBe(user.role);
        }));
        it('rejects an incorrect password', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma, {
                password: bcrypt_1.default.hashSync('CorrectPassword!', 4)
            });
            const found = yield prisma.user.findUnique({ where: { email: user.email } });
            expect(yield bcrypt_1.default.compare('WrongPassword!', found.password)).toBe(false);
        }));
        it('returns null for non-existent emails', () => __awaiter(void 0, void 0, void 0, function* () {
            expect(yield prisma.user.findUnique({ where: { email: 'nobody@test.infinibay' } })).toBeNull();
        }));
        it('treats deleted users as absent from lookup', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma, { deleted: true });
            const ctx = {
                req: { headers: { authorization: (0, test_helpers_1.generateTestToken)(user.id, user.role) } },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(false);
        }));
    });
    describe('Token validation', () => {
        it('accepts a freshly-signed token and loads the user', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const user = yield (0, db_factories_1.createUser)(prisma);
            const ctx = {
                req: { headers: { authorization: (0, test_helpers_1.generateTestToken)(user.id, user.role) } },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(true);
            expect((_a = ctx.user) === null || _a === void 0 ? void 0 : _a.id).toBe(user.id);
        }));
        it('rejects an expired token', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma);
            const expired = jsonwebtoken_1.default.sign({ userId: user.id, userRole: user.role }, process.env.TOKENKEY || 'test-secret-key', { expiresIn: '1ms' });
            yield new Promise(r => setTimeout(r, 10));
            const ctx = {
                req: { headers: { authorization: expired } },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(false);
        }));
        it('rejects a token signed with a different secret', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma);
            const wrong = jsonwebtoken_1.default.sign({ userId: user.id, userRole: user.role }, 'wrong-secret-key');
            const ctx = {
                req: { headers: { authorization: wrong } },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(false);
        }));
        it('rejects a request with no Authorization header', () => __awaiter(void 0, void 0, void 0, function* () {
            const ctx = {
                req: { headers: {} },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(false);
        }));
    });
    describe('Role-based access', () => {
        it('grants ADMIN routes to admins', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const admin = yield (0, db_factories_1.createAdmin)(prisma);
            const ctx = {
                req: { headers: { authorization: (0, test_helpers_1.generateTestToken)(admin.id, 'ADMIN') } },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['ADMIN'])).toBe(true);
            expect((_a = ctx.user) === null || _a === void 0 ? void 0 : _a.role).toBe('ADMIN');
        }));
        it('denies ADMIN routes to regular users', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma);
            const ctx = {
                req: { headers: { authorization: (0, test_helpers_1.generateTestToken)(user.id, 'USER') } },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['ADMIN'])).toBe(false);
        }));
        it('grants USER routes to both roles', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma);
            const admin = yield (0, db_factories_1.createAdmin)(prisma);
            for (const u of [user, admin]) {
                const ctx = {
                    req: { headers: { authorization: (0, test_helpers_1.generateTestToken)(u.id, u.role) } },
                    user: null,
                    setupMode: false
                };
                expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(true);
            }
        }));
        it('grants SETUP_MODE access even without a token when setupMode is on', () => __awaiter(void 0, void 0, void 0, function* () {
            const ctx = {
                req: { headers: {} },
                user: null,
                setupMode: true
            };
            expect(yield testAuthChecker(prisma, ctx, ['SETUP_MODE'])).toBe(true);
        }));
    });
    describe('Session behaviour', () => {
        it('reuses the same token across requests', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const user = yield (0, db_factories_1.createUser)(prisma);
            const token = (0, test_helpers_1.generateTestToken)(user.id, user.role);
            for (let i = 0; i < 2; i++) {
                const ctx = {
                    req: { headers: { authorization: token } },
                    user: null,
                    setupMode: false
                };
                expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(true);
                expect((_a = ctx.user) === null || _a === void 0 ? void 0 : _a.id).toBe(user.id);
            }
        }));
        it('reflects a user update on the next request', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            const user = yield (0, db_factories_1.createUser)(prisma, { firstName: 'Original' });
            const token = (0, test_helpers_1.generateTestToken)(user.id, user.role);
            const ctx1 = {
                req: { headers: { authorization: token } },
                user: null,
                setupMode: false
            };
            yield testAuthChecker(prisma, ctx1, ['USER']);
            expect((_a = ctx1.user) === null || _a === void 0 ? void 0 : _a.firstName).toBe('Original');
            yield prisma.user.update({
                where: { id: user.id },
                data: { firstName: 'Updated' }
            });
            const ctx2 = {
                req: { headers: { authorization: token } },
                user: null,
                setupMode: false
            };
            yield testAuthChecker(prisma, ctx2, ['USER']);
            expect((_b = ctx2.user) === null || _b === void 0 ? void 0 : _b.firstName).toBe('Updated');
        }));
        it('handles concurrent requests from different users', () => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const users = yield Promise.all([
                (0, db_factories_1.createUser)(prisma),
                (0, db_factories_1.createUser)(prisma),
                (0, db_factories_1.createAdmin)(prisma)
            ]);
            const results = yield Promise.all(users.map(u => {
                const ctx = {
                    req: { headers: { authorization: (0, test_helpers_1.generateTestToken)(u.id, u.role) } },
                    user: null,
                    setupMode: false
                };
                return testAuthChecker(prisma, ctx, ['USER']).then(ok => ({ ok, ctx, u }));
            }));
            for (const { ok, ctx, u } of results) {
                expect(ok).toBe(true);
                expect((_a = ctx.user) === null || _a === void 0 ? void 0 : _a.id).toBe(u.id);
            }
        }));
    });
    describe('Security edge cases', () => {
        it('rejects malformed authorization headers', () => __awaiter(void 0, void 0, void 0, function* () {
            const malformed = ['not.a.jwt.token', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'Bearer token', '{}', ''];
            for (const token of malformed) {
                const ctx = {
                    req: { headers: { authorization: token } },
                    user: null,
                    setupMode: false
                };
                expect(yield testAuthChecker(prisma, ctx, ['USER'])).toBe(false);
            }
        }));
        it('prevents privilege escalation via forged role in token', () => __awaiter(void 0, void 0, void 0, function* () {
            const user = yield (0, db_factories_1.createUser)(prisma, { role: 'USER' });
            // A client that forges userRole=ADMIN in their JWT payload — the auth
            // checker must look up the real role from the DB, not trust the token.
            const forged = jsonwebtoken_1.default.sign({ userId: user.id, userRole: 'ADMIN' }, process.env.TOKENKEY || 'test-secret-key');
            const ctx = {
                req: { headers: { authorization: forged } },
                user: null,
                setupMode: false
            };
            expect(yield testAuthChecker(prisma, ctx, ['ADMIN'])).toBe(false);
        }));
    });
});
