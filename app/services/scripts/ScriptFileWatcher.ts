import logger from '@main/logger'
import * as chokidar from 'chokidar'
import * as path from 'path'
import { ScriptManager } from './ScriptManager'

const SCRIPTS_BASE_DIR = process.env.INFINIBAY_BASE_DIR
  ? path.join(process.env.INFINIBAY_BASE_DIR, 'scripts')
  : '/opt/infinibay/scripts'
const LIBRARY_DIR = path.join(SCRIPTS_BASE_DIR, 'library')

export class ScriptFileWatcher {
  private watcher?: chokidar.FSWatcher
  private isRunning: boolean = false

  constructor() {
    // No need to store scriptManager since we use static cache
  }

  public start(): void {
    if (this.isRunning) {
      logger.warn('ScriptFileWatcher is already running')
      return
    }

    logger.info(`Starting ScriptFileWatcher for directory: ${LIBRARY_DIR}`)

    this.watcher = chokidar.watch(LIBRARY_DIR, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      }
    })

    this.watcher.on('change', (filePath: string) => {
      logger.info(`Script file changed: ${filePath}`)
      this.handleFileChange(filePath)
    })

    this.watcher.on('unlink', (filePath: string) => {
      logger.info(`Script file deleted: ${filePath}`)
      this.handleFileChange(filePath)
    })

    this.watcher.on('error', (err: unknown) => {
      logger.error('ScriptFileWatcher error:', err)
    })

    this.isRunning = true
    logger.info('ScriptFileWatcher started successfully')
  }

  public stop(): void {
    if (!this.isRunning) return

    if (this.watcher) {
      this.watcher.close()
      this.watcher = undefined
    }

    this.isRunning = false
    logger.info('ScriptFileWatcher stopped')
  }

  private handleFileChange(filePath: string): void {
    // Extract filename from path
    const fileName = path.basename(filePath)

    // Invalidate cache for all scripts using static method
    // Could be optimized to only invalidate specific script by querying DB for scriptId by fileName
    ScriptManager.invalidateCache()

    logger.info(`Cache invalidated due to file change: ${fileName}`)
  }
}

// Singleton instance
let instance: ScriptFileWatcher | null = null

export function initializeScriptFileWatcher(): ScriptFileWatcher {
  if (!instance) {
    instance = new ScriptFileWatcher()
    instance.start()
  }
  return instance
}

export function getScriptFileWatcher(): ScriptFileWatcher | null {
  return instance
}
