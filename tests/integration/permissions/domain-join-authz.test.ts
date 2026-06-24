/**
 * Authz test for joinVmToDomain — proves the domain-join is gated on
 * `identityProvider:use` whenever the stored bind secret is used (i.e. the
 * caller did NOT supply BOTH username and password). When the caller supplies
 * its own join credentials, the stored-secret gate must NOT fire.
 *
 * Approach (documented in StructuredOutput notes): we instantiate the resolver
 * (MachineMutations) and call joinVmToDomain DIRECTLY with a fabricated context
 * whose `assertCan` is a jest.fn. The heavier collaborator (DomainJoinService)
 * is jest.mock'd so the join itself is an inert no-op — this isolates the
 * authorization decision from the real join/prisma/virtio machinery. We assert:
 *   (a) stored-secret path calls assertCan('identityProvider:use'); and when
 *       assertCan rejects, joinVmToDomain rejects BEFORE the join is attempted.
 *   (b) BOTH-credentials path does NOT call assertCan('identityProvider:use').
 * Plus a registry assertion that 'identityProvider:use' is a valid permission.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { isValidPermission, RESOURCES } from '@main/permissions/registry'

// Inert no-op for the heavy collaborator so the join never actually runs.
const mockJoinMachineToDomain = jest.fn()

jest.mock('../../../app/services/DomainJoinService', () => ({
  DomainJoinService: jest.fn().mockImplementation(() => ({
    joinMachineToDomain: mockJoinMachineToDomain
  }))
}))

import { MachineMutations } from '@resolvers/machine/resolver'
import { DomainJoinService } from '@main/services/DomainJoinService'
import { JoinDomainInput } from '@resolvers/machine/type'
import { InfinibayContext } from '@utils/context'

const JOIN_RESULT = { success: true, message: 'joined', domain: 'example.com' }

function buildInput (overrides: Partial<JoinDomainInput> = {}): JoinDomainInput {
  const input = new JoinDomainInput()
  input.machineId = 'machine-1'
  input.identityProviderId = 'provider-1'
  return Object.assign(input, overrides)
}

function buildContext (assertCan: any): InfinibayContext {
  return {
    req: {} as never,
    res: {} as never,
    prisma: {} as never,
    user: { id: 'admin-1' } as never,
    setupMode: false,
    assertCan: assertCan as never
  } as InfinibayContext
}

describe('joinVmToDomain authorization', () => {
  let resolver: MachineMutations

  beforeEach(() => {
    jest.clearAllMocks()
    mockJoinMachineToDomain.mockResolvedValue(JOIN_RESULT as never)
    resolver = new MachineMutations()
  })

  it("registry exposes 'identityProvider:use' as a valid permission", () => {
    expect(isValidPermission('identityProvider:use')).toBe(true)
    const idp = RESOURCES.find((r) => r.key === 'identityProvider')
    expect(idp?.verbs).toContain('use')
  })

  describe('stored bind-secret path (neither username nor password supplied)', () => {
    it("asserts 'identityProvider:use' before performing the join", async () => {
      const assertCan = jest.fn<(p: string, i?: unknown) => Promise<void>>()
        .mockResolvedValue(undefined)
      const ctx = buildContext(assertCan)

      const result = await resolver.joinVmToDomain(buildInput(), ctx)

      expect(assertCan).toHaveBeenCalledWith('identityProvider:use')
      // The gate is checked before the join runs.
      const assertOrder = assertCan.mock.invocationCallOrder[0]
      const joinOrder = mockJoinMachineToDomain.mock.invocationCallOrder[0]
      expect(assertOrder).toBeLessThan(joinOrder)
      expect(result).toEqual(JOIN_RESULT)
    })

    it('also requires the gate when only username is supplied', async () => {
      const assertCan = jest.fn<(p: string, i?: unknown) => Promise<void>>()
        .mockResolvedValue(undefined)
      const ctx = buildContext(assertCan)

      await resolver.joinVmToDomain(buildInput({ username: 'svc-join' }), ctx)

      expect(assertCan).toHaveBeenCalledWith('identityProvider:use')
    })

    it('also requires the gate when only password is supplied', async () => {
      const assertCan = jest.fn<(p: string, i?: unknown) => Promise<void>>()
        .mockResolvedValue(undefined)
      const ctx = buildContext(assertCan)

      await resolver.joinVmToDomain(buildInput({ password: 'pw' }), ctx)

      expect(assertCan).toHaveBeenCalledWith('identityProvider:use')
    })

    it('is DENIED (rejects) and never attempts the join when assertCan rejects', async () => {
      const denial = new Error('FORBIDDEN: requires identityProvider:use')
      const assertCan = jest.fn<(p: string, i?: unknown) => Promise<void>>()
        .mockRejectedValue(denial)
      const ctx = buildContext(assertCan)

      await expect(resolver.joinVmToDomain(buildInput(), ctx)).rejects.toThrow(denial)

      expect(assertCan).toHaveBeenCalledWith('identityProvider:use')
      // The denial short-circuits before any join is attempted.
      expect(mockJoinMachineToDomain).not.toHaveBeenCalled()
      expect(DomainJoinService).not.toHaveBeenCalled()
    })
  })

  describe('caller-supplied credential path (BOTH username AND password)', () => {
    it("does NOT assert 'identityProvider:use'", async () => {
      const assertCan = jest.fn<(p: string, i?: unknown) => Promise<void>>()
        .mockResolvedValue(undefined)
      const ctx = buildContext(assertCan)

      const result = await resolver.joinVmToDomain(
        buildInput({ username: 'svc-join', password: 'super-secret' }),
        ctx
      )

      expect(assertCan).not.toHaveBeenCalledWith('identityProvider:use')
      // With explicit creds the gate is skipped entirely, but the join still runs.
      expect(mockJoinMachineToDomain).toHaveBeenCalledTimes(1)
      expect(result).toEqual(JOIN_RESULT)
    })

    it('forwards the caller-supplied credentials to the join service', async () => {
      const assertCan = jest.fn<(p: string, i?: unknown) => Promise<void>>()
        .mockResolvedValue(undefined)
      const ctx = buildContext(assertCan)

      await resolver.joinVmToDomain(
        buildInput({ username: 'svc-join', password: 'super-secret' }),
        ctx
      )

      expect(mockJoinMachineToDomain).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'svc-join', password: 'super-secret' })
      )
    })
  })
})
