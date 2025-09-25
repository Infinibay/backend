import 'reflect-metadata'
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { SocketService, createSocketService, getSocketService } from '../../../app/services/SocketService'
import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { mockPrisma } from '../../setup/jest.setup'

type MockUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
} | null

// Mock dependencies
jest.mock('socket.io')
jest.mock('@prisma/client')

// Mock jsonwebtoken explicitly
jest.mock('jsonwebtoken', () => ({
  verify: jest.fn(),
  sign: jest.fn()
}))

interface MockSocket {
  id: string
  handshake: {
    auth?: { token?: string }
    headers?: { authorization?: string }
    address?: string
  }
  userId?: string
  userRole?: string
  userNamespace?: string
  user?: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
  }
  emit: jest.Mock
  on: jest.Mock
  join: jest.Mock
  leave: jest.Mock
  disconnect: jest.Mock
  rooms: Set<string>
}

describe('SocketService', () => {
  let socketService: SocketService
  let mockHttpServer: jest.Mocked<HTTPServer>
  let mockIo: jest.Mocked<SocketIOServer>
  let mockSocket: MockSocket
  let authMiddleware: ((socket: MockSocket, next: (err?: Error) => void) => void) | null = null
  let connectionHandler: ((socket: MockSocket) => void) | null = null

  beforeEach(() => {
    jest.clearAllMocks()

    // Create mock HTTP server
    mockHttpServer = {} as jest.Mocked<HTTPServer>

    // Create mock socket
    mockSocket = {
      id: 'test-socket-id',
      handshake: {
        auth: { token: 'test-token' },
        address: '127.0.0.1'
      },
      emit: jest.fn(),
      on: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      disconnect: jest.fn(),
      rooms: new Set()
    }

    // Create mock Socket.IO server
    mockIo = {
      use: jest.fn((middleware: unknown) => {
        authMiddleware = middleware as ((socket: MockSocket, next: (err?: Error) => void) => void)
      }),
      on: jest.fn((event: string, handler: unknown) => {
        if (event === 'connection') {
          connectionHandler = handler as ((socket: MockSocket) => void)
        }
      }),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn()
    } as unknown as jest.Mocked<SocketIOServer>

    // Mock SocketIOServer constructor
    (SocketIOServer as unknown as jest.Mock).mockImplementation(() => mockIo)

    // Reset singleton
    const globalWithSocketService = global as typeof global & { socketService?: SocketService }
    if (globalWithSocketService.socketService) {
      delete globalWithSocketService.socketService
    }

    // Create SocketService instance
    socketService = createSocketService(mockPrisma)
  })

  describe('Initialization', () => {
    it('should be a singleton', () => {
      const instance1 = getSocketService()
      const instance2 = getSocketService()
      expect(instance1).toBe(instance2)
    })

    it('should initialize Socket.io server with proper configuration', () => {
      socketService.initialize(mockHttpServer)

      expect(SocketIOServer).toHaveBeenCalledWith(mockHttpServer, {
        cors: {
          origin: process.env.FRONTEND_URL || 'http://localhost:3000',
          methods: ['GET', 'POST'],
          credentials: true
        },
        transports: ['websocket', 'polling']
      })

      expect(mockIo.use).toHaveBeenCalled()
      expect(mockIo.on).toHaveBeenCalledWith('connection', expect.any(Function))
    })
  })

  describe('Authentication', () => {
    it('should authenticate valid token', async () => {
      const mockUser = {
        token: 'test-token',
        id: 'user-123',
        email: 'test@example.com',
        password: 'hashed-password',
        deleted: false,
        firstName: 'Test',
        lastName: 'User',
        avatar: null,
        role: 'USER',
        createdAt: new Date()
      }

      // Set up mocks before initialization
      ;(jwt.verify as jest.Mock).mockClear()
      ;(jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-123' })
      mockPrisma.user.findUnique.mockResolvedValue(mockUser)

      // Initialize after mocks are set
      socketService.initialize(mockHttpServer)

      const next = jest.fn()

      // Ensure authMiddleware is captured
      expect(authMiddleware).toBeDefined()

      // Call authMiddleware and ensure it completes
      if (authMiddleware) {
        await authMiddleware(mockSocket, next)
      }

      // For now, skip checking next() call - focus on other assertions
      // The issue is that the mock isn't being properly injected into the SocketService
      // TODO: Fix the mock injection issue

      expect(jwt.verify).toHaveBeenCalledWith('test-token', 'test-secret-key')
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true
        }
      })
      expect(mockSocket.userId).toBe('user-123')
      expect(mockSocket.userRole).toBe('USER')
      expect(mockSocket.user).toEqual(mockUser)
      expect(next).toHaveBeenCalledWith()
    })

    it('should reject missing token', async () => {
      socketService.initialize(mockHttpServer)

      const mockSocketNoToken = {
        ...mockSocket,
        handshake: {
          auth: {},
          headers: {},
          address: '127.0.0.1'
        }
      }

      const next = jest.fn()
      await authMiddleware!(mockSocketNoToken, next)

      expect(next).toHaveBeenCalledWith(new Error('Authentication token required'))
    })

    it('should reject invalid token', async () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token')
      })

      socketService.initialize(mockHttpServer)

      const next = jest.fn()
      await authMiddleware!(mockSocket, next)

      expect(next).toHaveBeenCalledWith(new Error('Authentication failed'))
    })

    it('should reject if user not found', async () => {
      (jwt.verify as jest.Mock).mockReturnValue({ userId: 'user-123' })
      mockPrisma.user.findUnique.mockResolvedValue(null)

      socketService.initialize(mockHttpServer)

      const next = jest.fn()
      await authMiddleware!(mockSocket, next)

      expect(next).toHaveBeenCalledWith(new Error('User not found'))
    })
  })

  describe('Connection Handling', () => {
    beforeEach(() => {
      socketService.initialize(mockHttpServer)

      // Setup authenticated socket
      mockSocket.userId = 'user-123'
      mockSocket.userRole = 'USER'
      mockSocket.userNamespace = 'user_user-123'
      mockSocket.user = {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'USER'
      }
    })

    it('should handle user connection', () => {
      connectionHandler!(mockSocket)

      expect(mockSocket.join).toHaveBeenCalledWith('user_user-123')
      expect(mockSocket.emit).toHaveBeenCalledWith('connected', {
        message: 'Real-time connection established',
        namespace: 'user_user-123',
        user: mockSocket.user,
        timestamp: expect.any(String)
      })
    })

    it('should add admin users to admin room', () => {
      mockSocket.userRole = 'ADMIN'

      connectionHandler!(mockSocket)

      expect(mockSocket.join).toHaveBeenCalledWith('user_user-123')
      expect(mockSocket.join).toHaveBeenCalledWith('admin')
    })

    it('should handle user disconnection', () => {
      connectionHandler!(mockSocket)

      // Simulate disconnect event
      const disconnectHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'disconnect'
      )?.[1] as ((reason: string) => void) | undefined

      disconnectHandler?.('transport close')

      // Check that user was removed from connected users
      const stats = socketService.getStats()
      expect(stats.connectedUsers).toBe(0)
      expect(stats.userIds).toEqual([])
    })
  })

  describe('Message Sending', () => {
    beforeEach(() => {
      socketService.initialize(mockHttpServer)

      // Setup connected user with all required mock methods
      const authSocket: MockSocket = {
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
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        disconnect: jest.fn(),
        rooms: new Set()
      }

      // Simulate user connection
      connectionHandler!(authSocket)
    })

    it('should send event to user namespace', () => {
      socketService.sendToUserNamespace('user_user-123', 'vms', 'create', {
        status: 'success',
        data: { id: 'vm-123' }
      })

      expect(mockIo.to).toHaveBeenCalledWith('user_user-123')
      expect(mockIo.emit).toHaveBeenCalledWith('user_user-123:vms:create', {
        status: 'success',
        error: null,
        data: { id: 'vm-123' },
        timestamp: expect.any(String)
      })
    })

    it('should send event to specific user', () => {
      socketService.sendToUser('user-123', 'vms', 'update', {
        status: 'success',
        data: { id: 'vm-123' }
      })

      expect(mockIo.to).toHaveBeenCalledWith('user_user-123')
      expect(mockIo.emit).toHaveBeenCalledWith('user_user-123:vms:update', {
        status: 'success',
        error: null,
        data: { id: 'vm-123' },
        timestamp: expect.any(String)
      })
    })

    it('should send event to multiple users', () => {
      // Add another connected user
      const authSocket2: MockSocket = {
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
        emit: jest.fn(),
        on: jest.fn(),
        join: jest.fn(),
        leave: jest.fn(),
        disconnect: jest.fn(),
        rooms: new Set()
      }
      connectionHandler!(authSocket2)

      socketService.sendToUsers(['user-123', 'user-456'], 'notification', 'new', {
        status: 'success',
        data: { message: 'Hello' }
      })

      expect(mockIo.to).toHaveBeenCalledWith('user_user-123')
      expect(mockIo.to).toHaveBeenCalledWith('user_user-456')
      expect(mockIo.emit).toHaveBeenCalledTimes(2)
    })

    it('should send event to admin users', () => {
      socketService.sendToAdmins('system', 'alert', {
        status: 'success',
        data: { message: 'System alert' }
      })

      expect(mockIo.to).toHaveBeenCalledWith('admin')
      expect(mockIo.emit).toHaveBeenCalledWith('admin:system:alert', {
        status: 'success',
        error: null,
        data: { message: 'System alert' },
        timestamp: expect.any(String)
      })
    })

    it('should emit event to room', () => {
      socketService.emitToRoom('custom-room', 'custom-event', {
        data: 'test'
      })

      expect(mockIo.to).toHaveBeenCalledWith('custom-room')
      expect(mockIo.emit).toHaveBeenCalledWith('custom-event', {
        data: 'test'
      })
    })
  })

  describe('Statistics', () => {
    beforeEach(() => {
      // Create a fresh SocketService instance for this test
      jest.clearAllMocks()
      const globalWithSocketService = global as typeof global & { socketService?: SocketService }
      delete globalWithSocketService.socketService

      // Create a new mock IO instance
      mockIo = {
        use: jest.fn((middleware: unknown) => {
          authMiddleware = middleware as ((socket: MockSocket, next: (err?: Error) => void) => void)
        }),
        on: jest.fn((event: string, handler: unknown) => {
          if (event === 'connection') {
            connectionHandler = handler as ((socket: MockSocket) => void)
          }
        }),
        to: jest.fn().mockReturnThis(),
        emit: jest.fn()
      } as unknown as jest.Mocked<SocketIOServer>

      ;(SocketIOServer as unknown as jest.Mock).mockImplementation(() => mockIo)

      socketService = createSocketService(mockPrisma)
      socketService.initialize(mockHttpServer)
    })

    it('should return connection statistics', () => {
      // Get initial count (may have connections from previous tests)
      const initialStats = socketService.getStats()
      const initialCount = initialStats.connectedUsers

      // Connect multiple users
      const users = [
        { id: 'user-stat-1', email: 'user1@example.com' },
        { id: 'user-stat-2', email: 'user2@example.com' },
        { id: 'user-stat-3', email: 'user3@example.com' }
      ]

      users.forEach(user => {
        const authSocket: MockSocket = {
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
          emit: jest.fn(),
          on: jest.fn(),
          join: jest.fn(),
          leave: jest.fn(),
          disconnect: jest.fn(),
          rooms: new Set()
        }
        connectionHandler!(authSocket)
      })

      const stats = socketService.getStats()
      expect(stats.connectedUsers).toBe(initialCount + 3)
      expect(stats.userIds).toContain('user-stat-1')
      expect(stats.userIds).toContain('user-stat-2')
      expect(stats.userIds).toContain('user-stat-3')
    })
  })

  describe('Utility Methods', () => {
    it('should return Socket.IO instance', () => {
      socketService.initialize(mockHttpServer)
      const io = socketService.getIO()
      expect(io).toBe(mockIo)
    })

    it('should return null if not initialized', () => {
      const newService = new SocketService(mockPrisma)
      const io = newService.getIO()
      expect(io).toBeNull()
    })
  })
})
