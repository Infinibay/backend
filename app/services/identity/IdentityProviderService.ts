import crypto from 'crypto'
import net from 'net'
import tls from 'tls'
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

function resolveRoleFromGroups (memberOf: string[], mappings: IdentityGroupRoleMapping[]): UserRole {
  const normalizedGroups = new Set(memberOf.map(group => group.toLowerCase()))
  const priority = {
    [UserRole.USER]: 1,
    [UserRole.ADMIN]: 2,
    [UserRole.SUPER_ADMIN]: 3
  }

  return mappings.reduce<UserRole>((selected, mapping) => {
    const matches = normalizedGroups.has(mapping.groupDn.toLowerCase()) ||
      normalizedGroups.has(mapping.groupName.toLowerCase())
    if (!matches) return selected
    return priority[mapping.role] > priority[selected] ? mapping.role : selected
  }, UserRole.USER)
}

export class IdentityProviderService {
  constructor (private readonly prisma: PrismaClient) {}

  buildCreateData (input: IdentityProviderConfig): Prisma.IdentityProviderCreateInput {
    const host = cleanString(input.host)
    const baseDn = cleanString(input.baseDn)
    const name = cleanString(input.name)

    if (!name) throw new Error('Connector name is required')
    if (!host) throw new Error('Host is required')
    if (!baseDn) throw new Error('Base DN is required')

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
      attributes: input.attributes === null ? undefined : input.attributes as Prisma.InputJsonValue | undefined
    }
  }

  buildUpdateData (input: IdentityProviderPatch): Prisma.IdentityProviderUpdateInput {
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

    return data
  }

  async testConnection (config: { host: string, port: number, useTls: boolean }): Promise<IdentityConnectionResult> {
    const startedAt = Date.now()

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
          rejectUnauthorized: false
        })
        : net.connect({ host: config.host, port: config.port })

      socket.setTimeout(5000)
      socket.once('connect', () => finish(true, 'Directory endpoint is reachable'))
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
      useTls: provider.useTls
    })
    if (!endpoint.success || !options.requireBind) return endpoint

    if (!provider.bindDn) {
      return { success: false, message: 'Bind DN is required for strict directory validation' }
    }

    const client = new Client({
      url: directoryUrl(provider),
      timeout: 10000,
      connectTimeout: 5000,
      tlsOptions: { rejectUnauthorized: false }
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
    if (!password) return false

    const provider = await this.prisma.identityProvider.findUnique({ where: { id: providerId } })
    if (!provider || !provider.enabled) return false

    const client = new Client({
      url: directoryUrl(provider),
      timeout: 10000,
      connectTimeout: 5000,
      tlsOptions: { rejectUnauthorized: false }
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
      tlsOptions: { rejectUnauthorized: false }
    })

    try {
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
      const now = new Date()
      const placeholderPassword = await bcrypt.hash(
        crypto.randomBytes(32).toString('hex'),
        parseInt(process.env.BCRYPT_ROUNDS || '10')
      )

      for (const entry of userSearch.searchEntries) {
        const email = directoryEmail(entry, map)
        if (!email) continue

        const externalId = directoryExternalId(entry, map)
        const firstName = entryValue(entry, map.firstName) || entryValue(entry, 'displayName') || entryValue(entry, 'cn') || email
        const lastName = entryValue(entry, map.lastName) || ''
        const role = resolveRoleFromGroups(valuesToStrings(entry.memberOf), groupRoleMappings)
        const existingLinked = await this.prisma.user.findFirst({
          where: { identityProviderId: providerId, externalId }
        })
        const existingByEmail = existingLinked
          ? null
          : await this.prisma.user.findUnique({ where: { email } })

        const existingUser = existingLinked || existingByEmail
        if (existingUser) {
          await this.prisma.user.update({
            where: { id: existingUser.id },
            data: {
              email,
              firstName,
              lastName,
              deleted: false,
              role,
              identityProviderId: providerId,
              externalId,
              externalDn: entry.dn,
              lastDirectorySyncAt: now
            }
          })
          usersUpdated++
        } else {
          await this.prisma.user.create({
            data: {
              email,
              password: placeholderPassword,
              firstName,
              lastName,
              role,
              deleted: false,
              identityProviderId: providerId,
              externalId,
              externalDn: entry.dn,
              lastDirectorySyncAt: now
            }
          })
          usersCreated++
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

      const message = `Directory sync finished: ${usersCreated} created, ${usersUpdated} updated`
      await this.prisma.identitySyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          usersCreated,
          usersUpdated,
          usersDisabled: 0,
          groupsSeen,
          message
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
        usersDisabled: 0,
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
