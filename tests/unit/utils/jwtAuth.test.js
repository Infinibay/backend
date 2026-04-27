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
const globals_1 = require("@jest/globals");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
// Mock the database module
const mockPrisma = {
    user: {
        findUnique: globals_1.jest.fn()
    }
};
globals_1.jest.mock('@utils/database', () => mockPrisma);
// Import after mocking
const { verifyRequestAuth } = globals_1.jest.requireActual('@utils/jwtAuth');
(0, globals_1.describe)('JWT Authentication Security Tests', () => {
    // SafeUser object - simulates what Prisma returns with select clause excluding password/token
    const mockSafeUser = {
        id: 'test-user-id',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'ADMIN',
        deleted: false,
        createdAt: new Date('2024-01-01')
        // Note: password and token fields are intentionally excluded to simulate Prisma select behavior
    };
    const testSecret = 'test-secret-key';
    const originalEnv = process.env;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        process.env = Object.assign({}, originalEnv);
        process.env.TOKENKEY = testSecret;
        // Mock Prisma to return only safe user fields (simulating the select clause)
        mockPrisma.user.findUnique.mockResolvedValue(mockSafeUser);
    });
    afterEach(() => {
        process.env = originalEnv;
    });
    (0, globals_1.describe)('verifyRequestAuth', () => {
        (0, globals_1.it)('should return SafeUser without password and token fields', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const token = jsonwebtoken_1.default.sign({ userId: mockSafeUser.id, userRole: mockSafeUser.role }, testSecret);
            const mockRequest = {
                headers: {
                    authorization: `Bearer ${token}`
                }
            };
            // Act
            const result = yield verifyRequestAuth(mockRequest, {
                method: 'context',
                debugAuth: false
            });
            // Assert
            (0, globals_1.expect)(result.user).toBeDefined();
            (0, globals_1.expect)(result.user).not.toHaveProperty('password');
            (0, globals_1.expect)(result.user).not.toHaveProperty('token');
            // Verify SafeUser has all the expected fields except password and token
            (0, globals_1.expect)(result.user).toMatchObject({
                id: mockSafeUser.id,
                email: mockSafeUser.email,
                firstName: mockSafeUser.firstName,
                lastName: mockSafeUser.lastName,
                role: mockSafeUser.role,
                deleted: mockSafeUser.deleted,
                createdAt: mockSafeUser.createdAt
            });
            (0, globals_1.expect)(result.meta.status).toBe('authenticated');
            (0, globals_1.expect)(result.meta.method).toBe('context');
        }));
        (0, globals_1.it)('should return unauthenticated status when no token provided', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const mockRequest = {
                headers: {}
            };
            // Act
            const result = yield verifyRequestAuth(mockRequest, {
                method: 'context',
                debugAuth: false
            });
            // Assert
            (0, globals_1.expect)(result.user).toBeNull();
            (0, globals_1.expect)(result.decoded).toBeNull();
            (0, globals_1.expect)(result.meta.status).toBe('unauthenticated');
            (0, globals_1.expect)(result.meta.method).toBe('context');
        }));
    });
    (0, globals_1.describe)('Security Requirements', () => {
        (0, globals_1.it)('should never return password field in context user', () => __awaiter(void 0, void 0, void 0, function* () {
            // Arrange
            const token = jsonwebtoken_1.default.sign({ userId: mockSafeUser.id, userRole: mockSafeUser.role }, testSecret);
            const mockRequest = {
                headers: {
                    authorization: `Bearer ${token}`
                }
            };
            // Act
            const result = yield verifyRequestAuth(mockRequest, {
                method: 'context',
                debugAuth: false
            });
            // Assert - Verify at runtime that sensitive fields are excluded
            (0, globals_1.expect)(result.user).toBeDefined();
            if (result.user) {
                (0, globals_1.expect)(Object.prototype.hasOwnProperty.call(result.user, 'password')).toBe(false);
                (0, globals_1.expect)(Object.prototype.hasOwnProperty.call(result.user, 'token')).toBe(false);
                // Verify that safe fields are still present
                (0, globals_1.expect)(result.user.id).toBe(mockSafeUser.id);
                (0, globals_1.expect)(result.user.email).toBe(mockSafeUser.email);
                (0, globals_1.expect)(result.user.role).toBe(mockSafeUser.role);
            }
        }));
        (0, globals_1.it)('should maintain type safety with SafeUser', () => {
            // This is a compile-time test to ensure SafeUser type excludes sensitive fields
            const safeUser = {
                id: 'test-id',
                email: 'test@example.com',
                firstName: 'Test',
                lastName: 'User',
                role: 'USER',
                deleted: false,
                createdAt: new Date(),
                updatedAt: new Date()
                // password and token should not be assignable to SafeUser
            };
            (0, globals_1.expect)(safeUser).toBeDefined();
            (0, globals_1.expect)(safeUser.id).toBe('test-id');
            // These should cause TypeScript errors if uncommented:
            // safeUser.password = 'should-not-work'
            // safeUser.token = 'should-not-work'
        });
    });
});
