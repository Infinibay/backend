import { describe, it, expect } from '@jest/globals'
import {
  nodeHealth,
  calculateNodeCapacity,
  NODE_STALE_AFTER_MS
} from '../../../app/services/node/NodeCapacity'

/**
 * Phase 0: node staleness is driven by `lastHeartbeat` (the agent sign-of-life),
 * falling back to `updatedAt` only when no heartbeat has ever been recorded.
 * These are pure-function tests — no DB.
 */
describe('NodeCapacity staleness (heartbeat-driven, Phase 0)', () => {
  const NOW = new Date('2026-06-30T12:00:00.000Z')
  const recent = new Date(NOW.getTime() - 10_000) // 10s ago → fresh
  const old = new Date(NOW.getTime() - NODE_STALE_AFTER_MS - 10_000) // > threshold → stale

  const baseNode = {
    cores: 8,
    ram: 16 * 1024, // MB → 16 GB
    maintenanceMode: false,
    machines: [] as Array<{ cpuCores: number, ramGB: number, diskSizeGB: number }>
  }

  describe('nodeHealth(lastSeen)', () => {
    it('is online for a recent sign-of-life', () => {
      expect(nodeHealth(recent, NOW)).toBe('online')
    })
    it('is stale once the threshold is exceeded', () => {
      expect(nodeHealth(old, NOW)).toBe('stale')
    })
  })

  describe('calculateNodeCapacity', () => {
    it('uses lastHeartbeat when present — a recent heartbeat is online even if updatedAt is old', () => {
      const cap = calculateNodeCapacity({ ...baseNode, updatedAt: old, lastHeartbeat: recent }, NOW)
      expect(cap.health).toBe('online')
      expect(cap.schedulable).toBe(true)
    })

    it('heartbeat is AUTHORITATIVE — an old heartbeat is stale even if updatedAt is recent', () => {
      // The critical Phase-0 behaviour: a node whose row was just touched
      // (updatedAt recent) but whose agent stopped heartbeating must read stale.
      const cap = calculateNodeCapacity({ ...baseNode, updatedAt: recent, lastHeartbeat: old }, NOW)
      expect(cap.health).toBe('stale')
      expect(cap.schedulable).toBe(false)
    })

    it('falls back to updatedAt when lastHeartbeat is null (legacy / never-heartbeated)', () => {
      const onlineFallback = calculateNodeCapacity({ ...baseNode, updatedAt: recent, lastHeartbeat: null }, NOW)
      expect(onlineFallback.health).toBe('online')

      const staleFallback = calculateNodeCapacity({ ...baseNode, updatedAt: old, lastHeartbeat: null }, NOW)
      expect(staleFallback.health).toBe('stale')
    })

    it('falls back to updatedAt when lastHeartbeat is omitted entirely', () => {
      const cap = calculateNodeCapacity({ ...baseNode, updatedAt: recent }, NOW)
      expect(cap.health).toBe('online')
    })

    it('a maintenance node is never schedulable regardless of health', () => {
      const cap = calculateNodeCapacity(
        { ...baseNode, maintenanceMode: true, updatedAt: recent, lastHeartbeat: recent },
        NOW
      )
      expect(cap.health).toBe('online')
      expect(cap.schedulable).toBe(false)
    })
  })
})
