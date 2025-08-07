import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import jwt from 'jsonwebtoken'
import { PrismaClient } from '@prisma/client'

// Interface for authenticated socket
export interface AuthenticatedSocket {
  id: string
  userId: string
  userRole: string
  userNamespace: string
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
  }
}

// Socket.io service for managing real-time connections
export class SocketService {
  private io: SocketIOServer | null = null
  private prisma: PrismaClient
  private connectedUsers: Map<string, AuthenticatedSocket> = new Map()

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  // Initialize Socket.io server
  initialize(httpServer: HTTPServer): void {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling']
    })

    this.setupAuthentication()
    this.setupConnectionHandlers()

    console.log('🔌 Socket.io service initialized')
  }

  // Setup JWT authentication middleware
  private setupAuthentication(): void {
    this.io?.use(async (socket: any, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization

        if (!token) {
          return next(new Error('Authentication token required'))
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.TOKENKEY || 'secret') as any

        if (!decoded.userId) {
          return next(new Error('Invalid token payload'))
        }

        // Fetch user from database
        const user = await this.prisma.user.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            namespace: true
          } as any
        })

        if (!user) {
          return next(new Error('User not found'))
        }

        // Use stored namespace or generate and store one if it doesn't exist
        let userNamespace = (user as any).namespace
        if (!userNamespace) {
          userNamespace = this.generateUserNamespace((user as any).id)
          // Store the generated namespace in the database for future use
          await this.prisma.user.update({
            where: { id: (user as any).id },
            data: { namespace: userNamespace } as any
          })
        }

        // Attach user info to socket
        socket.userId = (user as any).id
        socket.userRole = (user as any).role
        socket.userNamespace = userNamespace
        socket.user = user

        next()
      } catch (error) {
        console.error('🔐 Socket authentication error:', error)
        next(new Error('Authentication failed'))
      }
    })
  }

  // Setup connection event handlers
  private setupConnectionHandlers(): void {
    this.io?.on('connection', (socket: any) => {
      const authSocket = socket as AuthenticatedSocket

      console.log(`🔌 User connected: ${authSocket.user.email} (${authSocket.id})`)

      // Store connected user
      this.connectedUsers.set(authSocket.userId, authSocket)

      // Join user to their personal namespace room
      socket.join(authSocket.userNamespace)

      // Join admin users to admin room (for admin-only events)
      if (authSocket.userRole === 'ADMIN') {
        socket.join('admin')
      }

      // Handle disconnection
      socket.on('disconnect', (reason: string) => {
        console.log(`🔌 User disconnected: ${authSocket.user.email} (${reason})`)
        this.connectedUsers.delete(authSocket.userId)
      })

      // Send welcome message with namespace info
      socket.emit('connected', {
        message: 'Real-time connection established',
        namespace: authSocket.userNamespace,
        user: authSocket.user,
        timestamp: new Date().toISOString()
      })
    })
  }

  // Generate unique namespace for user (fallback for users without stored namespace)
  private generateUserNamespace(userId: string): string {
    // Format: user_<userId_prefix>_<random>
    // This creates a persistent namespace for the user
    const randomSuffix = Math.random().toString(36).substring(2, 8)
    return `user_${userId.substring(0, 8)}_${randomSuffix}`
  }

  // Send event to specific user namespace
  sendToUserNamespace(namespace: string, resource: string, action: string, payload: any): void {
    if (!this.io) {
      console.warn('⚠️ Socket.io not initialized, cannot send event')
      return
    }

    const eventName = `${namespace}:${resource}:${action}`

    this.io.to(namespace).emit(eventName, {
      status: payload.status || 'success',
      error: payload.error || null,
      data: payload.data || null,
      timestamp: new Date().toISOString()
    })

    console.log(`📡 Sent event ${eventName} to namespace ${namespace}`)
  }

  // Send event to specific user by userId
  sendToUser(userId: string, resource: string, action: string, payload: any): void {
    const connectedUser = this.connectedUsers.get(userId)
    if (connectedUser) {
      this.sendToUserNamespace(connectedUser.userNamespace, resource, action, payload)
    }
  }

  // Send event to multiple users
  sendToUsers(userIds: string[], resource: string, action: string, payload: any): void {
    userIds.forEach(userId => {
      this.sendToUser(userId, resource, action, payload)
    })
  }

  // Send event to all admin users
  sendToAdmins(resource: string, action: string, payload: any): void {
    if (!this.io) return

    const eventName = `admin:${resource}:${action}`

    this.io.to('admin').emit(eventName, {
      status: payload.status || 'success',
      error: payload.error || null,
      data: payload.data || null,
      timestamp: new Date().toISOString()
    })

    console.log(`👑 Sent admin event ${eventName}`)
  }

  // Get connection statistics
  getStats(): { connectedUsers: number; userIds: string[] } {
    return {
      connectedUsers: this.connectedUsers.size,
      userIds: Array.from(this.connectedUsers.keys())
    }
  }

  // Get Socket.io server instance (for EventManager)
  getIO(): SocketIOServer | null {
    return this.io
  }
}

// Singleton instance
let socketService: SocketService | null = null

export const createSocketService = (prisma: PrismaClient): SocketService => {
  if (!socketService) {
    socketService = new SocketService(prisma)
  }
  return socketService
}

export const getSocketService = (): SocketService => {
  if (!socketService) {
    throw new Error('Socket service not initialized. Call createSocketService first.')
  }
  return socketService
}
