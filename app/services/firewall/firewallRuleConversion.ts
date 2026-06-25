import { FirewallPolicy, type FirewallRule as PrismaFirewallRule } from '@prisma/client'
import type { FirewallRuleInput, ConnectionStateConfig, FirewallDefaultAction } from '@infinibay/infinization'

/**
 * Single source of truth for translating a persisted Prisma FirewallRule into the
 * `FirewallRuleInput` shape consumed by infinization's NftablesService/translator.
 *
 * Previously this conversion was duplicated (and had drifted) across
 * InfinizationFirewallService and FirewallManagerV2, which is how the connectionState
 * shape mismatch (see normalizeConnectionState) went unnoticed.
 */

/**
 * Canonical connection-state keys understood by infinization's translator
 * (the booleans on ConnectionStateConfig).
 */
const CONNECTION_STATE_KEYS = ['established', 'new', 'related', 'invalid'] as const

/**
 * Normalizes a persisted `connectionState` JSON value into the canonical boolean
 * shape (`{ established, new, related, invalid }`) that the nftables translator reads.
 *
 * Tolerates BOTH representations that exist in the wild:
 *   - canonical booleans:        `{ established: true, related: true }`
 *   - legacy "states" array:     `{ states: ['ESTABLISHED', 'RELATED'] }`
 *
 * The legacy array shape was emitted by FirewallPolicyService while the translator
 * only ever read booleans, so the foundational "Allow Established" rule silently
 * produced ZERO `ct state` tokens (fail-open). Normalizing here guarantees the rule
 * is honored regardless of which shape a given row happens to hold during migration.
 *
 * Returns `undefined` when there is no usable state config (so the translator emits
 * no `ct state` clause rather than an empty/garbage one).
 */
export function normalizeConnectionState (raw: unknown): ConnectionStateConfig | undefined {
  if (raw == null || typeof raw !== 'object') {
    return undefined
  }

  const obj = raw as Record<string, unknown>
  const out: ConnectionStateConfig = {}
  let any = false

  // Legacy array shape: { states: ['ESTABLISHED', 'RELATED', ...] }
  if (Array.isArray(obj.states)) {
    for (const s of obj.states) {
      const key = String(s).toLowerCase()
      if ((CONNECTION_STATE_KEYS as readonly string[]).includes(key)) {
        out[key as keyof ConnectionStateConfig] = true
        any = true
      }
    }
  }

  // Canonical boolean shape: { established: true, ... }
  for (const key of CONNECTION_STATE_KEYS) {
    if (obj[key] === true) {
      out[key] = true
      any = true
    }
  }

  return any ? out : undefined
}

/**
 * Converts a single Prisma FirewallRule to infinization's FirewallRuleInput.
 * Centralizes null→undefined coercion and connectionState normalization.
 */
export function prismaRuleToFirewallInput (rule: PrismaFirewallRule): FirewallRuleInput {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description ?? undefined,
    action: rule.action as 'ACCEPT' | 'DROP' | 'REJECT',
    direction: rule.direction as 'IN' | 'OUT' | 'INOUT',
    priority: rule.priority,
    protocol: rule.protocol,
    srcPortStart: rule.srcPortStart ?? undefined,
    srcPortEnd: rule.srcPortEnd ?? undefined,
    dstPortStart: rule.dstPortStart ?? undefined,
    dstPortEnd: rule.dstPortEnd ?? undefined,
    srcIpAddr: rule.srcIpAddr ?? undefined,
    srcIpMask: rule.srcIpMask ?? undefined,
    dstIpAddr: rule.dstIpAddr ?? undefined,
    dstIpMask: rule.dstIpMask ?? undefined,
    connectionState: normalizeConnectionState(rule.connectionState),
    overridesDept: rule.overridesDept ?? false
  }
}

/** Converts an array of Prisma FirewallRules to FirewallRuleInput. */
export function prismaRulesToFirewallInput (rules: PrismaFirewallRule[]): FirewallRuleInput[] {
  return rules.map(prismaRuleToFirewallInput)
}

/**
 * Maps a department's firewall policy to the terminal posture applied at the end of
 * each VM chain:
 *   - BLOCK_ALL => 'drop'   (default-deny: only explicitly-accepted traffic passes)
 *   - ALLOW_ALL => 'accept' (default-allow: only explicitly-dropped traffic is blocked)
 *
 * Anything unexpected falls through to 'drop' (fail-closed).
 */
export function firewallDefaultAction (policy: FirewallPolicy | null | undefined): FirewallDefaultAction {
  return policy === FirewallPolicy.ALLOW_ALL ? 'accept' : 'drop'
}
