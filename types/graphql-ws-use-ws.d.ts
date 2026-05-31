// graphql-ws v6 ships its server adapter at `graphql-ws/use/ws`, which is
// resolved via the package `exports` map. Our tsconfig uses moduleResolution
// "node" (which does not honor exports), so we declare the subpath here.
// At runtime Node honors the exports map, so the import resolves correctly.
declare module 'graphql-ws/use/ws' {
  export { useServer } from 'graphql-ws/dist/use/ws'
}

declare module 'graphql-ws/dist/use/ws' {
  import type { ServerOptions } from 'graphql-ws'
  import type { WebSocketServer } from 'ws'
  export interface Disposable {
    dispose: () => Promise<void>
  }
  export function useServer (
    options: ServerOptions,
    ws: WebSocketServer,
    keepAlive?: number
  ): Disposable
}
