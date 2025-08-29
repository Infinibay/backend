import { getSocketService } from '../SocketService'
import { ISO } from '@prisma/client'

export interface ISOEvent {
  action: 'registered' | 'removed' | 'validated' | 'progress' | 'status_changed';
  iso?: ISO;
  isoId?: string;
  filename?: string;
  progress?: {
    current: number;
    total: number;
    message: string;
  };
  status?: {
    available: boolean;
    message: string;
  };
}

export class ISOEventManager {
  private static instance: ISOEventManager

  private constructor () {}

  public static getInstance (): ISOEventManager {
    if (!ISOEventManager.instance) {
      ISOEventManager.instance = new ISOEventManager()
    }
    return ISOEventManager.instance
  }

  /**
   * Get socket service when needed
   */
  private getSocket () {
    try {
      return getSocketService()
    } catch (error) {
      console.warn('Socket service not initialized yet')
      return null
    }
  }

  /**
   * Emit ISO registered event
   */
  public emitISORegistered (iso: ISO): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const event: ISOEvent = {
      action: 'registered',
      iso
    }

    // Emit to all connected clients
    const io = socketService.getIO()
    if (io) {
      io.emit('iso:registered', event)
      console.log(`ISO registered event emitted for: ${iso.filename}`)
    }
  }

  /**
   * Emit ISO removed event
   */
  public emitISORemoved (isoId: string, filename: string): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const event: ISOEvent = {
      action: 'removed',
      isoId,
      filename
    }

    const io = socketService.getIO()
    if (io) {
      io.emit('iso:removed', event)
      console.log(`ISO removed event emitted for: ${filename}`)
    }
  }

  /**
   * Emit ISO validation event
   */
  public emitISOValidated (iso: ISO, isValid: boolean): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const event: ISOEvent = {
      action: 'validated',
      iso,
      status: {
        available: isValid,
        message: isValid ? 'ISO validation successful' : 'ISO validation failed'
      }
    }

    const io = socketService.getIO()
    if (io) {
      io.emit('iso:validated', event)
    }
  }

  /**
   * Emit ISO upload progress event
   */
  public emitUploadProgress (
    filename: string,
    current: number,
    total: number,
    userId?: string
  ): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const event: ISOEvent = {
      action: 'progress',
      filename,
      progress: {
        current,
        total,
        message: `Uploading ${filename}: ${Math.round((current / total) * 100)}%`
      }
    }

    if (userId) {
      // Send to specific user
      socketService.sendToUser(userId, 'iso', 'upload:progress', event)
    } else {
      // Broadcast to all
      const io = socketService.getIO()
      if (io) {
        io.emit('iso:upload:progress', event)
      }
    }
  }

  /**
   * Emit ISO download progress event
   */
  public emitDownloadProgress (
    filename: string,
    current: number,
    total: number,
    userId?: string
  ): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const event: ISOEvent = {
      action: 'progress',
      filename,
      progress: {
        current,
        total,
        message: `Downloading ${filename}: ${Math.round((current / total) * 100)}%`
      }
    }

    if (userId) {
      // Send to specific user
      socketService.sendToUser(userId, 'iso', 'download:progress', event)
    } else {
      // Broadcast to all
      const io = socketService.getIO()
      if (io) {
        io.emit('iso:download:progress', event)
      }
    }
  }

  /**
   * Emit ISO status changed event
   */
  public emitStatusChanged (iso: ISO): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const event: ISOEvent = {
      action: 'status_changed',
      iso,
      status: {
        available: iso.isAvailable,
        message: iso.isAvailable ? 'ISO is now available' : 'ISO is no longer available'
      }
    }

    const io = socketService.getIO()
    if (io) {
      io.emit('iso:status:changed', event)
    }
  }

  /**
   * Emit batch ISO status update
   */
  public emitBatchStatusUpdate (isos: ISO[]): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const availableOS = isos
      .filter(iso => iso.isAvailable)
      .map(iso => iso.os)

    const io = socketService.getIO()
    if (io) {
      io.emit('iso:batch:update', {
        availableOS,
        isos: isos.map(iso => ({
          id: iso.id,
          os: iso.os,
          filename: iso.filename,
          available: iso.isAvailable
        }))
      })
    }
  }

  /**
   * Emit system readiness update
   */
  public emitSystemReadinessUpdate (
    ready: boolean,
    availableOS: string[],
    missingOS: string[]
  ): void {
    const socketService = this.getSocket()
    if (!socketService) return

    const io = socketService.getIO()
    if (io) {
      io.emit('system:readiness:update', {
        ready,
        availableOS,
        missingOS,
        timestamp: new Date().toISOString()
      })
    }
  }
}

export default ISOEventManager
