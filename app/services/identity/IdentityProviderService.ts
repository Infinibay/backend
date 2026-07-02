import crypto from 'crypto'
import net from 'net'
import tls from 'tls'
import dns from 'dns'
import bcrypt from 'bcrypt'
import { Client, Entry } from 'ldapts'
import { IdentityGroupRoleMapping, IdentityProvider, Prisma, PrismaClient, UserRole } from '@prisma/client'

export interface IdentityProviderConfig {
  name: string
  providerType: 'ACTIVE_DIRECTORY' | 'LDAP'
  enabled?: boolean
  domain?: string | null
  host: string
  port?: number | null
  useTls?: boolean | null
  baseDn: string
  bindDn?: string | null
  bindPassword?: string | null
  userFilter?: string | null
  groupFilter?: string | null
  attributes?: Prisma.InputJsonObject | null
  tlsCa?: string | null
  tlsInsecureSkipVerify?: boolean
}

export interface IdentityProviderPatch {
  name?: string
  providerType?: 'ACTIVE_DIRECTORY' | 'LDAP'
  enabled?: boolean
  domain?: string | null
  host?: string
  port?: number | null
  useTls?: boolean | null
  baseDn?: string
  bindDn?: string | null
  bindPassword?: string | null
  userFilter?: string | null
  groupFilter?: string | null
  attributes?: Prisma.InputJsonObject | null
  tlsCa?: string | null
  tlsInsecureSkipVerify?: boolean
}

export interface IdentityConnectionResult {
  success: boolean
  message: string
  latencyMs?: number
}

export interface IdentitySyncResult {
  success: boolean
  message: string
  syncRunId: string
  usersCreated: number
  usersUpdated: number
  usersDisabled: number
  groupsSeen: number
}

interface DirectoryAttributeMap {
  email: string
  firstName: string
  lastName: string
  externalIdCandidates: string[]
}

function encryptionKey (): Buffer {
  const secret = process.env.IDENTITY_SECRET_KEY || process.env.TOKENKEY
  if (!secret) {
    // Never silently fall back to a public, hard-coded key in production — that
    // would encrypt every bind secret under a key anyone can read from source.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('IDENTITY_SECRET_KEY (or TOKENKEY) must be set in production to encrypt identity provider secrets')
    }
    return crypto.createHash('sha256').update('infinibay-identity-development-key').digest()
  }
  return crypto.createHash('sha256').update(secret).digest()
}

function encryptSecret (value: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decryptSecret (value: string): string {
  const [version, ivBase64, tagBase64, encryptedBase64] = value.split(':')
  if (version !== 'v1' || !ivBase64 || !tagBase64 || !encryptedBase64) {
    throw new Error('Unsupported identity secret format')
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivBase64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, 'base64')),
    decipher.final()
  ]).toString('utf8')
}

function cleanString (value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizedPort (port?: number | null, useTls?: boolean | null): number {
  if (port == null) return useTls ? 636 : 389
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Port must be between 1 and 65535')
  }
  return port
}

function directoryUrl (provider: Pick<IdentityProvider, 'host' | 'port' | 'useTls'>): string {
  return `${provider.useTls ? 'ldaps' : 'ldap'}://${provider.host}:${provider.port}`
}

// Single source of truth for directory TLS options. tlsInsecureSkipVerify is
// honored ONLY outside production, so a misconfigured prod connector can never
// silently disable certificate validation.
function resolveTlsOptions (p: { tlsCa?: string | null, tlsInsecureSkipVerify?: boolean }): { rejectUnauthorized: boolean, ca?: string } {
  const insecure = p.tlsInsecureSkipVerify === true && process.env.NODE_ENV !== 'production'
  return { rejectUnauthorized: !insecure, ca: p.tlsCa || undefined }
}

// SSRF guard: returns true when the address belongs to a private/loopback/
// link-local range that an attacker could use to pivot into the internal
// network. Kept deliberately simple — string-prefix checks over the parsed octets.
function isPrivateAddress (address: string, family: number): boolean {
  if (family === 6) {
    const lower = address.toLowerCase()
    if (lower === '::1') return true
    // fc00::/7 (unique local) covers fc.. and fd.. prefixes
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    // link-local fe80::/10
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check the embedded v4 address
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1], 4)
    return false
  }

  const octets = address.split('.').map(part => parseInt(part, 10))
  if (octets.length !== 4 || octets.some(part => Number.isNaN(part))) return false
  const [a, b] = octets
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 10) return true // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true // 192.168.0.0/16
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
  return false
}

// Resolve every address a host maps to and block the request when any of them
// is private/loopback/link-local. Disabled outside production so local dev and
// test environments can still reach internal directory servers.
async function isHostAllowed (host: string): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') return true
  if (process.env.IDENTITY_ALLOW_PRIVATE_TARGETS === 'true') return true

  try {
    const addresses = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
      dns.lookup(host, { all: true }, (error, result) => {
        if (error) reject(error)
        else resolve(result)
      })
    })
    if (addresses.length === 0) return false
    return !addresses.some(addr => isPrivateAddress(addr.address, addr.family))
  } catch {
    // Fail closed: if we cannot resolve the host we cannot prove it is safe.
    return false
  }
}

function valueToString (value: Buffer | Buffer[] | string[] | string | undefined): string | null {
  if (value == null) return null
  if (Buffer.isBuffer(value)) return value.toString('hex')
  if (Array.isArray(value)) {
    const first = value[0]
    if (Buffer.isBuffer(first)) return first.toString('hex')
    return first ? String(first) : null
  }
  return String(value)
}

function valuesToStrings (value: Buffer | Buffer[] | string[] | string | undefined): string[] {
  if (value == null) return []
  if (Buffer.isBuffer(value)) return [value.toString('hex')]
  if (Array.isArray(value)) {
    return value
      .map(item => Buffer.isBuffer(item) ? item.toString('hex') : String(item))
      .filter(Boolean)
  }
  return [String(value)]
}

function entryValue (entry: Entry, attribute: string): string | null {
  return valueToString(entry[attribute])
}

function defaultAttributeMap (attributes: Prisma.JsonValue | null): DirectoryAttributeMap {
  const configured = attributes && typeof attributes === 'object' && !Array.isArray(attributes)
    ? attributes as Record<string, unknown>
    : {}

  return {
    email: typeof configured.email === 'string' ? configured.email : 'mail',
    firstName: typeof configured.firstName === 'string' ? configured.firstName : 'givenName',
    lastName: typeof configured.lastName === 'string' ? configured.lastName : 'sn',
    externalIdCandidates: Array.isArray(configured.externalIdCandidates)
      ? configured.externalIdCandidates.filter((item): item is string => typeof item === 'string')
      : ['objectGUID', 'objectSid', 'entryUUID', 'uid', 'sAMAccountName', 'userPrincipalName', 'mail']
  }
}

function directoryEmail (entry: Entry, map: DirectoryAttributeMap): string | null {
  return entryValue(entry, map.email) ||
    entryValue(entry, 'userPrincipalName') ||
    entryValue(entry, 'mail')
}

function directoryExternalId (entry: Entry, map: DirectoryAttributeMap): string {
  for (const attribute of map.externalIdCandidates) {
    const value = entryValue(entry, attribute)
    if (value) return value
  }
  return entry.dn
}

const ROLE_PRIORITY: Record<UserRole, number> = {
  [UserRole.USER]: 1,
  [UserRole.ADMIN]: 2,
  [UserRole.SUPER_ADMIN]: 3
}

function resolveRoleFromGroups (memberOf: string[], mappings: IdentityGroupRoleMapping[]): UserRole {
  const normalizedGroups = new Set(memberOf.map(group => group.toLowerCase()))

  return mappings.reduce<UserRole>((selected, mapping) => {
    const matches = normalizedGroups.has(mapping.groupDn.toLowerCase()) ||
      normalizedGroups.has(mapping.groupName.toLowerCase())
    if (!matches) return selected
    return ROLE_PRIORITY[mapping.role] > ROLE_PRIORITY[selected] ? mapping.role : selected
  }, UserRole.USER)
}

export class IdentityProviderService {
  constructor (private readonly prisma: PrismaClient) {}

  // Refuse an LDAP simple bind over a plaintext (non-TLS) connection in
  // production: the end-user password (on login) and the service bind password
  // (on sync) would otherwise traverse the network in cleartext. Mirrors the
  // other NODE_ENV production guards in this file.
  private assertBindTransportSecure (provider: Pick<IdentityProvider, 'useTls'>): void {
    if (process.env.NODE_ENV === 'production' && !provider.useTls) {
      throw new Error('Bind over a non-TLS connection is refused in production')
    }
  }

  // SSRF guard for the operational connect paths. isHostAllowed() was previously
  // only reached from testConnection, so a connector persisted with an internal
  // host could still be dialed by authenticateUser/syncProvider. Enforce it on
  // every path that opens an outbound directory connection (also covers rows
  // that predate any persist-time host validation).
  private async assertHostAllowed (host: string): Promise<void> {
    if (!(await isHostAllowed(host))) {
      throw new Error('Target host is not allowed')
    }
  }

  async buildCreateData (input: IdentityProviderConfig): Promise<Prisma.IdentityProviderCreateInput> {
    const host = cleanString(input.host)
    const baseDn = cleanString(input.baseDn)
    const name = cleanString(input.name)

    if (!name) throw new Error('Connector name is required')
    if (!host) throw new Error('Host is required')
    if (!baseDn) throw new Error('Base DN is required')
    // Persist-time SSRF guard: reject a connector pointed at an internal/loopback
    // target at config time (fail early with a clear error) instead of only on the
    // first authenticate/sync. Same policy as the operational paths (prod-only,
    // IDENTITY_ALLOW_PRIVATE_TARGETS escape hatch), so it never blocks a
    // legitimately-configured internal directory server.
    await this.assertHostAllowed(host)

    const useTls = input.useTls ?? false
    const bindPassword = cleanString(input.bindPassword)

    return {
      name,
      providerType: input.providerType,
      enabled: input.enabled ?? true,
      domain: cleanString(input.domain),
      host,
      port: normalizedPort(input.port, useTls),
      useTls,
      baseDn,
      bindDn: cleanString(input.bindDn),
      bindPasswordSecret: bindPassword ? encryptSecret(bindPassword) : undefined,
      userFilter: cleanString(input.userFilter) || '(objectClass=user)',
      groupFilter: cleanString(input.groupFilter) || '(objectClass=group)',
      attributes: input.attributes === null ? undefined : input.attributes as Prisma.InputJsonValue | undefined,
      tlsCa: cleanString(input.tlsCa),
      tlsInsecureSkipVerify: input.tlsInsecureSkipVerify ?? false
    }
  }

  async buildUpdateData (input: IdentityProviderPatch): Promise<Prisma.IdentityProviderUpdateInput> {
    const data: Prisma.IdentityProviderUpdateInput = {}

    if (input.name !== undefined) {
      const name = cleanString(input.name)
      if (!name) throw new Error('Connector name is required')
      data.name = name
    }
    if (input.providerType !== undefined) data.providerType = input.providerType
    if (input.enabled !== undefined) data.enabled = input.enabled
    if (input.domain !== undefined) data.domain = cleanString(input.domain)
    if (input.host !== undefined) {
      const host = cleanString(input.host)
      if (!host) throw new Error('Host is required')
      // Persist-time SSRF guard on the new host (see buildCreateData).
      await this.assertHostAllowed(host)
      data.host = host
    }
    if (input.useTls !== undefined) data.useTls = input.useTls ?? false
    if (input.port !== undefined) data.port = normalizedPort(input.port, input.useTls)
    if (input.baseDn !== undefined) {
      const baseDn = cleanString(input.baseDn)
      if (!baseDn) throw new Error('Base DN is required')
      data.baseDn = baseDn
    }
    if (input.bindDn !== undefined) data.bindDn = cleanString(input.bindDn)
    if (input.bindPassword !== undefined) {
      const bindPassword = cleanString(input.bindPassword)
      data.bindPasswordSecret = bindPassword ? encryptSecret(bindPassword) : null
    }
    if (input.userFilter !== undefined) data.userFilter = cleanString(input.userFilter)
    if (input.groupFilter !== undefined) data.groupFilter = cleanString(input.groupFilter)
    if (input.attributes !== undefined) {
      data.attributes = input.attributes === null ? Prisma.JsonNull : input.attributes as Prisma.InputJsonValue
    }
    if (input.tlsCa !== undefined) data.tlsCa = cleanString(input.tlsCa)
    if (input.tlsInsecureSkipVerify !== undefined) data.tlsInsecureSkipVerify = input.tlsInsecureSkipVerify ?? false

    return data
  }

  async testConnection (config: { host: string, port: number, useTls: boolean, tlsCa?: string | null, tlsInsecureSkipVerify?: boolean }): Promise<IdentityConnectionResult> {
    const startedAt = Date.now()

    // SSRF guard: do not let a connector probe internal hosts in production.
    const allowed = await isHostAllowed(config.host)
    if (!allowed) {
      return { success: false, message: 'Target host is not allowed', latencyMs: Date.now() - startedAt }
    }

    const tlsOptions = resolveTlsOptions(config)

    return new Promise((resolve) => {
      let settled = false
      const finish = (success: boolean, message: string) => {
        if (settled) return
        settled = true
        socket.destroy()
        resolve({ success, message, latencyMs: Date.now() - startedAt })
      }

      const socket = config.useTls
        ? tls.connect({
          host: config.host,
          port: config.port,
          servername: config.host,
          rejectUnauthorized: tlsOptions.rejectUnauthorized,
          ca: tlsOptions.ca
        })
        : net.connect({ host: config.host, port: config.port })

      socket.setTimeout(5000)
      // For TLS we only consider the endpoint reachable once the handshake
      // completes ('secureConnect'); resolving on 'connect' would mask a failed
      // certificate validation and falsely report an unreachable/insecure host as ok.
      if (!config.useTls) {
        socket.once('connect', () => finish(true, 'Directory endpoint is reachable'))
      }
      socket.once('secureConnect', () => finish(true, 'Directory endpoint is reachable over TLS'))
      socket.once('timeout', () => finish(false, 'Connection timed out'))
      socket.once('error', (error) => finish(false, error.message))
    })
  }

  async testSavedProvider (providerId: string, options: { requireBind?: boolean } = {}): Promise<IdentityConnectionResult> {
    const provider = await this.prisma.identityProvider.findUnique({ where: { id: providerId } })
    if (!provider) return { success: false, message: 'Identity provider not found' }
    if (!provider.enabled) return { success: false, message: 'Identity provider is disabled' }

    const endpoint = await this.testConnection({
      host: provider.host,
      port: provider.port,
      useTls: provider.useTls,
      tlsCa: provider.tlsCa,
      tlsInsecureSkipVerify: provider.tlsInsecureSkipVerify
    })
    if (!endpoint.success || !options.requireBind) return endpoint

    if (!provider.bindDn) {
      return { success: false, message: 'Bind DN is required for strict directory validation' }
    }

    // Strict validation performs a real bind — refuse it over plaintext in prod
    // and re-check the SSRF host guard before opening the connection.
    try {
      this.assertBindTransportSecure(provider)
      await this.assertHostAllowed(provider.host)
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error), latencyMs: endpoint.latencyMs }
    }

    const client = new Client({
      url: directoryUrl(provider),
      timeout: 10000,
      connectTimeout: 5000,
      tlsOptions: resolveTlsOptions(provider)
    })

    try {
      const password = provider.bindPasswordSecret ? decryptSecret(provider.bindPasswordSecret) : ''
      await client.bind(provider.bindDn, password)
      return {
        success: true,
        message: 'Directory endpoint is reachable and bind credentials are valid',
        latencyMs: endpoint.latencyMs
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: endpoint.latencyMs
      }
    } finally {
      await client.unbind().catch(() => undefined)
    }
  }

  async authenticateUser (providerId: string, userDn: string, password: string): Promise<boolean> {
    // Reject empty userDn as well as empty password: an empty bind is treated by
    // most directories as an anonymous (unauthenticated) bind and would succeed.
    if (!password || !userDn) return false

    const provider = await this.prisma.identityProvider.findUnique({ where: { id: providerId } })
    if (!provider || !provider.enabled) return false

    // Refuse plaintext bind in prod and block SSRF to internal hosts. Both guards
    // throw; authenticateUser preserves its boolean contract by returning false.
    try {
      this.assertBindTransportSecure(provider)
      await this.assertHostAllowed(provider.host)
    } catch {
      return false
    }

    const client = new Client({
      url: directoryUrl(provider),
      timeout: 10000,
      connectTimeout: 5000,
      tlsOptions: resolveTlsOptions(provider)
    })

    try {
      await client.bind(userDn, password)
      return true
    } catch {
      return false
    } finally {
      await client.unbind().catch(() => undefined)
    }
  }

  async syncProvider (providerId: string): Promise<IdentitySyncResult> {
    const provider = await this.prisma.identityProvider.findUnique({ where: { id: providerId } })
    if (!provider) throw new Error('Identity provider not found')
    if (!provider.enabled) throw new Error('Identity provider is disabled')

    const syncRun = await this.prisma.identitySyncRun.create({
      data: {
        providerId,
        status: 'RUNNING',
        message: 'Directory sync started'
      }
    })

    await this.prisma.identityProvider.update({
      where: { id: providerId },
      data: { status: 'SYNCING', lastError: null }
    })

    const client = new Client({
      url: directoryUrl(provider),
      timeout: 30000,
      connectTimeout: 5000,
      tlsOptions: resolveTlsOptions(provider)
    })

    try {
      // Refuse plaintext bind in prod and block SSRF to internal hosts. A throw
      // here is handled by the catch below, which marks the sync run ERROR.
      this.assertBindTransportSecure(provider)
      await this.assertHostAllowed(provider.host)

      if (provider.bindDn) {
        const password = provider.bindPasswordSecret ? decryptSecret(provider.bindPasswordSecret) : ''
        await client.bind(provider.bindDn, password)
      }

      const map = defaultAttributeMap(provider.attributes)
      const groupRoleMappings = await this.prisma.identityGroupRoleMapping.findMany({
        where: { providerId }
      })
      const attributes = Array.from(new Set([
        map.email,
        map.firstName,
        map.lastName,
        'cn',
        'displayName',
        'memberOf',
        'mail',
        'userPrincipalName',
        'userAccountControl',
        ...map.externalIdCandidates
      ]))

      const userSearch = await client.search(provider.baseDn, {
        scope: 'sub',
        filter: provider.userFilter || '(objectClass=user)',
        attributes,
        explicitBufferAttributes: ['objectGUID', 'objectSid'],
        paged: { pageSize: 500 }
      })

      let usersCreated = 0
      let usersUpdated = 0
      let usersDisabled = 0
      let usersFailed = 0
      let usersConflicted = 0
      const seenExternalIds = new Set<string>()
      const now = new Date()
      const placeholderPassword = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        parseInt(process.env.BCRYPT_ROUNDS || '10')
      )

      for (const entry of userSearch.searchEntries) {
        // Per-entry resilience: a single malformed/conflicting entry (e.g. a
        // P2002 unique-email collision) must not abort the whole run. Each entry
        // is isolated in its own try/catch and only bumps a failure counter.
        try {
          const email = directoryEmail(entry, map)
          if (!email) continue

          const externalId = directoryExternalId(entry, map)
          seenExternalIds.add(externalId)

          const firstName = entryValue(entry, map.firstName) || entryValue(entry, 'displayName') || entryValue(entry, 'cn') || email
          const lastName = entryValue(entry, map.lastName) || ''

          // Did the directory authoritatively report group membership this run?
          const memberOf = valuesToStrings(entry.memberOf)
          const hasMemberOf = memberOf.length > 0
          const computedRole = resolveRoleFromGroups(memberOf, groupRoleMappings)

          // AD ACCOUNTDISABLE bit (0x2) — a disabled directory account must be
          // soft-deleted locally so it can no longer authenticate.
          const uacRaw = entryValue(entry, 'userAccountControl')
          const uac = uacRaw != null ? parseInt(uacRaw, 10) : NaN
          const directoryDisabled = Number.isFinite(uac) && (uac & 0x2) === 0x2

          const existingLinked = await this.prisma.user.findFirst({
            where: { identityProviderId: providerId, externalId }
          })
          const existingByEmail = existingLinked
            ? null
            : await this.prisma.user.findUnique({ where: { email } })

          // Email-hijack guard: an email-matched row may only be ADOPTED when it
          // is currently unlinked. If it is already linked (to any provider, or
          // to this provider under a different externalId) we must never re-point
          // its identity via the email key — treat it as a conflict and skip.
          if (!existingLinked && existingByEmail) {
            const isUnlinked = existingByEmail.identityProviderId == null && existingByEmail.externalId == null
            if (!isUnlinked) {
              usersConflicted++
              continue
            }
          }

          const existingUser = existingLinked || existingByEmail
          if (existingUser) {
            // Role-downgrade guard: never silently lower an existing user's role.
            // Only write 'role' when the directory authoritatively reported group
            // membership, OR a mapping raised the role above the current one.
            // Otherwise (no memberOf and the computed role would be lower) keep
            // the current role and leave it untouched.
            const raisesRole = ROLE_PRIORITY[computedRole] > ROLE_PRIORITY[existingUser.role]
            const writeRole = hasMemberOf || raisesRole

            const updateData: Prisma.UserUncheckedUpdateInput = {
              email,
              firstName,
              lastName,
              deleted: directoryDisabled,
              identityProviderId: providerId,
              externalId,
              externalDn: entry.dn,
              lastDirectorySyncAt: now
            }
            if (writeRole) updateData.role = computedRole

            await this.prisma.user.update({
              where: { id: existingUser.id },
              data: updateData
            })
            if (directoryDisabled) usersDisabled++
            else usersUpdated++
          } else {
            // Newly-created users keep the computed role.
            await this.prisma.user.create({
              data: {
                email,
                password: placeholderPassword,
                firstName,
                lastName,
                role: computedRole,
                deleted: directoryDisabled,
                identityProviderId: providerId,
                externalId,
                externalDn: entry.dn,
                lastDirectorySyncAt: now
              }
            })
            if (directoryDisabled) usersDisabled++
            else usersCreated++
          }
        } catch (entryError) {
          usersFailed++
          const reason = entryError instanceof Error ? entryError.message : String(entryError)
          console.error(`[identity-sync] failed to process directory entry ${entry.dn}: ${reason}`)
        }
      }

      // Deprovision pass: soft-delete locally-linked users whose externalId was
      // NOT seen this run. Guarded by a non-empty result set so a transient empty
      // search never mass-disables the whole directory.
      if (userSearch.searchEntries.length > 0) {
        const linkedUsers = await this.prisma.user.findMany({
          where: { identityProviderId: providerId, deleted: false },
          select: { id: true, externalId: true }
        })
        for (const linked of linkedUsers) {
          if (linked.externalId && seenExternalIds.has(linked.externalId)) continue
          try {
            await this.prisma.user.update({
              where: { id: linked.id },
              data: { deleted: true, lastDirectorySyncAt: now }
            })
            usersDisabled++
          } catch (disableError) {
            usersFailed++
            const reason = disableError instanceof Error ? disableError.message : String(disableError)
            console.error(`[identity-sync] failed to deprovision user ${linked.id}: ${reason}`)
          }
        }
      }

      let groupsSeen = 0
      if (provider.groupFilter) {
        const groupSearch = await client.search(provider.baseDn, {
          scope: 'sub',
          filter: provider.groupFilter,
          attributes: ['cn'],
          paged: { pageSize: 500 }
        })
        groupsSeen = groupSearch.searchEntries.length
      }

      // Aggregate per-entry failures and conflicts into the run message. The run
      // still completes as SUCCESS when only individual entries failed — only a
      // thrown directory-level error (caught below) marks the whole run ERROR.
      let message = `Directory sync finished: ${usersCreated} created, ${usersUpdated} updated, ${usersDisabled} disabled`
      const notes: string[] = []
      if (usersConflicted > 0) notes.push(`${usersConflicted} skipped (email already linked to another account)`)
      if (usersFailed > 0) notes.push(`${usersFailed} failed`)
      if (notes.length > 0) message += ` (${notes.join('; ')})`

      await this.prisma.identitySyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          usersCreated,
          usersUpdated,
          usersDisabled,
          groupsSeen,
          message,
          error: notes.length > 0 ? notes.join('; ') : null
        }
      })
      await this.prisma.identityProvider.update({
        where: { id: providerId },
        data: {
          status: 'CONNECTED',
          lastSyncAt: new Date(),
          lastError: null
        }
      })

      return {
        success: true,
        message,
        syncRunId: syncRun.id,
        usersCreated,
        usersUpdated,
        usersDisabled,
        groupsSeen
      }
    } catch (error) {
      const message = (error as Error).message
      await this.prisma.identitySyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'ERROR',
          finishedAt: new Date(),
          error: message
        }
      })
      await this.prisma.identityProvider.update({
        where: { id: providerId },
        data: {
          status: 'ERROR',
          lastError: message
        }
      })
      return {
        success: false,
        message,
        syncRunId: syncRun.id,
        usersCreated: 0,
        usersUpdated: 0,
        usersDisabled: 0,
        groupsSeen: 0
      }
    } finally {
      await client.unbind().catch(() => undefined)
    }
  }
}
