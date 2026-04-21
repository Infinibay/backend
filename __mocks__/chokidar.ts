// Mock for chokidar ESM module (v5 is ESM-only, breaks Jest CJS)
import { EventEmitter } from 'events'

export class FSWatcher extends EventEmitter {
  add(path: string) { return this }
  on(event: string, callback: (...args: unknown[]) => void) { return this }
  close() { return Promise.resolve() }
  unwatch(paths: string | string[]) { return this }
  getWatched() { return {} }
}

export function watch(_paths: string | string[], _options?: Record<string, unknown>): FSWatcher {
  return new FSWatcher()
}
