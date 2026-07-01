import { InputType, Field, Int, registerEnumType } from 'type-graphql'

// Shared hard ceiling on the page size a list query should honour. The bound is
// NOT enforced on this input type itself — doing so via property setters breaks
// structural typing (a `{ take, skip }` literal stops being assignable) and risks
// an omitted nullable field being coerced to NaN. Instead each list resolver
// clamps with `clampTake(pagination?.take)` when translating to Prisma `take`,
// which is where the value is actually consumed. The ceiling matches the highest
// deliberate per-resolver limit already in the codebase (the `machines` query),
// so it never truncates a legitimate page; it only neutralises the unbounded
// (`take: 2e9`) result-set + per-row async fan-out DoS.
export const MAX_TAKE = 1000

/** Clamp a caller-supplied page size into [1, MAX_TAKE]; undefined stays undefined. */
export function clampTake (take?: number | null): number | undefined {
  if (take == null) return undefined
  return Math.min(Math.max(Math.trunc(take), 1), MAX_TAKE)
}

@InputType()
export class PaginationInputType {
  @Field(() => Int, { nullable: true })
    take: number = 20

  @Field(() => Int, { nullable: true })
    skip: number = 0
}

export enum OrderByDirection {
    ASC = 'asc',
    DESC = 'desc'
}

registerEnumType(OrderByDirection, {
  name: 'OrderByDirection'
})
