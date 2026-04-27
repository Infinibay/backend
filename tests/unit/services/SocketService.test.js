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
const SocketService_1 = require("../../../app/services/SocketService");
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const jest_setup_1 = require("../../setup/jest.setup");
// Mock dependencies
globals_1.jest.mock('socket.io');
globals_1.jest.mock('@prisma/client');
// Mock jsonwebtoken explicitly
globals_1.jest.mock('jsonwebtoken', () => ({
    verify: globals_1.jest.fn(),
    sign: globals_1.jest.fn()
}));
(0, globals_1.describe)('SocketService', () => {
    let socketService;
    let mockHttpServer;
    let mockIo;
    let mockSocket;
    let authMiddleware = null;
    let connectionHandler = null;
    (0, globals_1.beforeEach)(() => {
        globals_1.jest.clearAllMocks();
        // Create mock HTTP server
        mockHttpServer = {};
        // Create mock socket
        mockSocket = {
            id: 'test-socket-id',
            handshake: {
                auth: { token: 'test-token' },
                address: '127.0.0.1'
            },
            emit: globals_1.jest.fn(),
            on: globals_1.jest.fn(),
            join: globals_1.jest.fn(),
            leave: globals_1.jest.fn(),
            disconnect: globals_1.jest.fn(),
            rooms: new Set()
        };
        // Create mock Socket.IO server
        mockIo = {
            use: globals_1.jest.fn((middleware) => {
                authMiddleware = middleware;
            }),
            on: globals_1.jest.fn((event, handler) => {
                if (event === 'connection') {
                    connectionHandler = handler;
                }
            }),
            to: globals_1.jest.fn().mockReturnThis(),
            emit: globals_1.jest.fn()
        };
        // Mock SocketIOServer constructor
        socket_io_1.Server.mockImplementation(() => mockIo);
        // Reset singleton
        const globalWithSocketService = global;
        if (globalWithSocketService.socketService) {
            delete globalWithSocketService.socketService;
        }
        // Create SocketService instance
        socketService = (0, SocketService_1.createSocketService)(jest_setup_1.mockPrisma);
    });
    (0, globals_1.describe)('Initialization', () => {
        (0, globals_1.it)('should be a singleton', () => {
            const instance1 = (0, SocketService_1.getSocketService)();
            const instance2 = (0, SocketService_1.getSocketService)();
            (0, globals_1.expect)(instance1).toBe(instance2);
        });
        (0, globals_1.it)('should initialize Socket.io server with proper configuration', () => {
            socketService.initialize(mockHttpServer);
            (0, globals_1.expect)(socket_io_1.Server).toHaveBeenCalledWith(mockHttpServer, {
                cors: {
                    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
                    methods: ['GET', 'POST'],
                    credentials: true
                },
                transports: ['websocket', 'polling']
            });
            (0, globals_1.expect)(mockIo.use).toHaveBeenCalled();
            (0, globals_1.expect)(mockIo.on).toHaveBeenCalledWith('connection', globals_1.expect.any(Function));
        });
    });
    (0, globals_1.describe)('Authentication', () => {
        (0, globals_1.it)('should authenticate valid token', () => __awaiter(void 0, void 0, void 0, function* () {
            const mockUser = {
                token: 'test-token',
                id: 'user-123',
                email: 'test@example.com',
                password: 'hashed-password',
                deleted: false,
                firstName: 'Test',
                lastName: 'User',
                role: 'USER',
                createdAt: new Date(),
                updatedAt: new Date()
            };
            jsonwebtoken_1.default.verify.mockClear();
            jsonwebtoken_1.default.verify.mockReturnValue({ userId: 'user-123' });
            jest_setup_1.mockPrisma.user.findUnique.mockResolvedValue(mockUser);
            // Initialize after mocks are set
            socketService.initialize(mockHttpServer);
            const next = globals_1.jest.fn();
            // Ensure authMiddleware is captured
            (0, globals_1.expect)(authMiddleware).toBeDefined();
            // Call authMiddleware and ensure it completes
            if (authMiddleware) {
                yield authMiddleware(mockSocket, next);
            }
            // For now, skip checking next() call - focus on other assertions
            // The issue is that the mock isn't being properly injected into the SocketService
            // TODO: Fix the mock injection issue
            (0, globals_1.expect)(jsonwebtoken_1.default.verify).toHaveBeenCalledWith('test-token', 'test-secret-key');
            (0, globals_1.expect)(jest_setup_1.mockPrisma.user.findUnique).toHaveBeenCalledWith({
                where: { id: 'user-123' },
                select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                    role: true
                }
            });
            (0, globals_1.expect)(mockSocket.userId).toBe('user-123');
            (0, globals_1.expect)(mockSocket.userRole).toBe('USER');
            (0, globals_1.expect)(mockSocket.user).toEqual(mockUser);
            (0, globals_1.expect)(next).toHaveBeenCalledWith();
        }));
        (0, globals_1.it)('should reject missing token', () => __awaiter(void 0, void 0, void 0, function* () {
            socketService.initialize(mockHttpServer);
            const mockSocketNoToken = Object.assign(Object.assign({}, mockSocket), { handshake: {
                    auth: {},
                    headers: {},
                    address: '127.0.0.1'
                } });
            const next = globals_1.jest.fn();
            yield authMiddleware(mockSocketNoToken, next);
            (0, globals_1.expect)(next).toHaveBeenCalledWith(new Error('Authentication token required'));
        }));
        (0, globals_1.it)('should reject invalid token', () => __awaiter(void 0, void 0, void 0, function* () {
            jsonwebtoken_1.default.verify.mockImplementation(() => {
                throw new Error('Invalid token');
            });
            socketService.initialize(mockHttpServer);
            const next = globals_1.jest.fn();
            yield authMiddleware(mockSocket, next);
            (0, globals_1.expect)(next).toHaveBeenCalledWith(new Error('Authentication failed'));
        }));
        (0, globals_1.it)('should reject if user not found', () => __awaiter(void 0, void 0, void 0, function* () {
            jsonwebtoken_1.default.verify.mockReturnValue({ userId: 'user-123' });
            jest_setup_1.mockPrisma.user.findUnique.mockResolvedValue(null);
            socketService.initialize(mockHttpServer);
            const next = globals_1.jest.fn();
            yield authMiddleware(mockSocket, next);
            (0, globals_1.expect)(next).toHaveBeenCalledWith(new Error('User not found'));
        }));
    });
    (0, globals_1.describe)('Connection Handling', () => {
        (0, globals_1.beforeEach)(() => {
            socketService.initialize(mockHttpServer);
            // Setup authenticated socket
            mockSocket.userId = 'user-123';
            mockSocket.userRole = 'USER';
            mockSocket.userNamespace = 'user_user-123';
            mockSocket.user = {
                id: 'user-123',
                email: 'test@example.com',
                firstName: 'Test',
                lastName: 'User',
                role: 'USER'
            };
        });
        (0, globals_1.it)('should handle user connection', () => {
            connectionHandler(mockSocket);
            (0, globals_1.expect)(mockSocket.join).toHaveBeenCalledWith('user_user-123');
            (0, globals_1.expect)(mockSocket.emit).toHaveBeenCalledWith('connected', {
                message: 'Real-time connection established',
                namespace: 'user_user-123',
                user: mockSocket.user,
                timestamp: globals_1.expect.any(String)
            });
        });
        (0, globals_1.it)('should add admin users to admin room', () => {
            mockSocket.userRole = 'ADMIN';
            connectionHandler(mockSocket);
            (0, globals_1.expect)(mockSocket.join).toHaveBeenCalledWith('user_user-123');
            (0, globals_1.expect)(mockSocket.join).toHaveBeenCalledWith('admin');
        });
        (0, globals_1.it)('should handle user disconnection', () => {
            var _a;
            connectionHandler(mockSocket);
            // Simulate disconnect event
            const disconnectHandler = (_a = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')) === null || _a === void 0 ? void 0 : _a[1];
            disconnectHandler === null || disconnectHandler === void 0 ? void 0 : disconnectHandler('transport close');
            // Check that user was removed from connected users
            const stats = socketService.getStats();
            (0, globals_1.expect)(stats.connectedUsers).toBe(0);
            (0, globals_1.expect)(stats.userIds).toEqual([]);
        });
    });
    (0, globals_1.describe)('Message Sending', () => {
        (0, globals_1.beforeEach)(() => {
            socketService.initialize(mockHttpServer);
            // Setup connected user with all required mock methods
            const authSocket = {
                id: 'socket-123',
                userId: 'user-123',
                userRole: 'USER',
                userNamespace: 'user_user-123',
                user: {
                    id: 'user-123',
                    email: 'test@example.com',
                    firstName: 'Test',
                    lastName: 'User',
                    role: 'USER'
                },
                handshake: {
                    auth: { token: 'test-token' },
                    address: '127.0.0.1'
                },
                emit: globals_1.jest.fn(),
                on: globals_1.jest.fn(),
                join: globals_1.jest.fn(),
                leave: globals_1.jest.fn(),
                disconnect: globals_1.jest.fn(),
                rooms: new Set()
            };
            // Simulate user connection
            connectionHandler(authSocket);
        });
        (0, globals_1.it)('should send event to user namespace', () => {
            socketService.sendToUserNamespace('user_user-123', 'vms', 'create', {
                status: 'success',
                data: { id: 'vm-123' }
            });
            (0, globals_1.expect)(mockIo.to).toHaveBeenCalledWith('user_user-123');
            (0, globals_1.expect)(mockIo.emit).toHaveBeenCalledWith('user_user-123:vms:create', {
                status: 'success',
                error: null,
                data: { id: 'vm-123' },
                timestamp: globals_1.expect.any(String)
            });
        });
        (0, globals_1.it)('should send event to specific user', () => {
            socketService.sendToUser('user-123', 'vms', 'update', {
                status: 'success',
                data: { id: 'vm-123' }
            });
            (0, globals_1.expect)(mockIo.to).toHaveBeenCalledWith('user_user-123');
            (0, globals_1.expect)(mockIo.emit).toHaveBeenCalledWith('user_user-123:vms:update', {
                status: 'success',
                error: null,
                data: { id: 'vm-123' },
                timestamp: globals_1.expect.any(String)
            });
        });
        (0, globals_1.it)('should send event to multiple users', () => {
            // Add another connected user
            const authSocket2 = {
                id: 'socket-456',
                userId: 'user-456',
                userRole: 'USER',
                userNamespace: 'user_user-456',
                user: {
                    id: 'user-456',
                    email: 'test2@example.com',
                    firstName: 'Test2',
                    lastName: 'User2',
                    role: 'USER'
                },
                handshake: {
                    auth: { token: 'test-token' },
                    address: '127.0.0.1'
                },
                emit: globals_1.jest.fn(),
                on: globals_1.jest.fn(),
                join: globals_1.jest.fn(),
                leave: globals_1.jest.fn(),
                disconnect: globals_1.jest.fn(),
                rooms: new Set()
            };
            connectionHandler(authSocket2);
            socketService.sendToUsers(['user-123', 'user-456'], 'notification', 'new', {
                status: 'success',
                data: { message: 'Hello' }
            });
            (0, globals_1.expect)(mockIo.to).toHaveBeenCalledWith('user_user-123');
            (0, globals_1.expect)(mockIo.to).toHaveBeenCalledWith('user_user-456');
            (0, globals_1.expect)(mockIo.emit).toHaveBeenCalledTimes(2);
        });
        (0, globals_1.it)('should send event to admin users', () => {
            socketService.sendToAdmins('system', 'alert', {
                status: 'success',
                data: { message: 'System alert' }
            });
            (0, globals_1.expect)(mockIo.to).toHaveBeenCalledWith('admin');
            (0, globals_1.expect)(mockIo.emit).toHaveBeenCalledWith('admin:system:alert', {
                status: 'success',
                error: null,
                data: { message: 'System alert' },
                timestamp: globals_1.expect.any(String)
            });
        });
        (0, globals_1.it)('should emit event to room', () => {
            socketService.emitToRoom('custom-room', 'custom-event', {
                data: 'test'
            });
            (0, globals_1.expect)(mockIo.to).toHaveBeenCalledWith('custom-room');
            (0, globals_1.expect)(mockIo.emit).toHaveBeenCalledWith('custom-event', {
                data: 'test'
            });
        });
    });
    (0, globals_1.describe)('Statistics', () => {
        (0, globals_1.beforeEach)(() => {
            // Create a fresh SocketService instance for this test
            globals_1.jest.clearAllMocks();
            const globalWithSocketService = global;
            delete globalWithSocketService.socketService;
            // Create a new mock IO instance
            mockIo = {
                use: globals_1.jest.fn((middleware) => {
                    authMiddleware = middleware;
                }),
                on: globals_1.jest.fn((event, handler) => {
                    if (event === 'connection') {
                        connectionHandler = handler;
                    }
                }),
                to: globals_1.jest.fn().mockReturnThis(),
                emit: globals_1.jest.fn()
            };
            socket_io_1.Server.mockImplementation(() => mockIo);
            socketService = (0, SocketService_1.createSocketService)(jest_setup_1.mockPrisma);
            socketService.initialize(mockHttpServer);
        });
        (0, globals_1.it)('should return connection statistics', () => {
            // Get initial count (may have connections from previous tests)
            const initialStats = socketService.getStats();
            const initialCount = initialStats.connectedUsers;
            // Connect multiple users
            const users = [
                { id: 'user-stat-1', email: 'user1@example.com' },
                { id: 'user-stat-2', email: 'user2@example.com' },
                { id: 'user-stat-3', email: 'user3@example.com' }
            ];
            users.forEach(user => {
                const authSocket = {
                    id: `socket-${user.id}`,
                    userId: user.id,
                    userRole: 'USER',
                    userNamespace: `user_${user.id}`,
                    user: {
                        id: user.id,
                        email: user.email,
                        firstName: 'Test',
                        lastName: 'User',
                        role: 'USER'
                    },
                    handshake: {
                        auth: { token: 'test-token' },
                        address: '127.0.0.1'
                    },
                    emit: globals_1.jest.fn(),
                    on: globals_1.jest.fn(),
                    join: globals_1.jest.fn(),
                    leave: globals_1.jest.fn(),
                    disconnect: globals_1.jest.fn(),
                    rooms: new Set()
                };
                connectionHandler(authSocket);
            });
            const stats = socketService.getStats();
            (0, globals_1.expect)(stats.connectedUsers).toBe(initialCount + 3);
            (0, globals_1.expect)(stats.userIds).toContain('user-stat-1');
            (0, globals_1.expect)(stats.userIds).toContain('user-stat-2');
            (0, globals_1.expect)(stats.userIds).toContain('user-stat-3');
        });
    });
    (0, globals_1.describe)('Utility Methods', () => {
        (0, globals_1.it)('should return Socket.IO instance', () => {
            socketService.initialize(mockHttpServer);
            const io = socketService.getIO();
            (0, globals_1.expect)(io).toBe(mockIo);
        });
        (0, globals_1.it)('should return null if not initialized', () => {
            const newService = new SocketService_1.SocketService(jest_setup_1.mockPrisma);
            const io = newService.getIO();
            (0, globals_1.expect)(io).toBeNull();
        });
    });
});
