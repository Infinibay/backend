// Shared PubSub instance for GraphQL subscriptions.
//
// type-graphql 2.x exports `PubSub` only as a TypeScript interface (not a class),
// and its shape is slightly different from `graphql-subscriptions`:
//   - type-graphql: publish(key, ...args): void, subscribe(...): AsyncIterable<unknown>
//   - graphql-subs: publish(key, payload): Promise<void>, asyncIterableIterator(triggers)
//
// We wrap the concrete in-memory `graphql-subscriptions` PubSub in a small adapter
// that satisfies type-graphql's `PubSub` interface, while still being usable as a
// regular publisher from app code (publish/subscribe pass through).
import { PubSub as InMemoryPubSub } from 'graphql-subscriptions'
import type { PubSub as TypeGraphQLPubSub } from 'type-graphql'

const engine = new InMemoryPubSub()

export const pubsub: TypeGraphQLPubSub & {
  publish: (routingKey: string, payload?: unknown) => void
} = {
  publish (routingKey: string, payload?: unknown): void {
    // graphql-subscriptions returns Promise<void>; we fire-and-forget for the
    // type-graphql interface but log unhandled rejections.
    engine.publish(routingKey, payload).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[pubsub] publish(${routingKey}) failed:`, err)
    })
  },
  subscribe (routingKey: string): AsyncIterable<unknown> {
    return engine.asyncIterableIterator(routingKey)
  }
}

// Topic constants — single source of truth for subscription trigger names
export const TOPICS = {
  SYSTEM_METRICS_UPDATED: 'SYSTEM_METRICS_UPDATED'
} as const
