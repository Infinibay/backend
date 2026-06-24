import {
  Field,
  ID,
  Int,
  InputType,
  ObjectType,
  registerEnumType
} from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { IdentitySyncStatus, Prisma } from '@prisma/client'
import { UserRole } from '../user/type'

export enum IdentityProviderKind {
  ACTIVE_DIRECTORY = 'ACTIVE_DIRECTORY',
  LDAP = 'LDAP'
}

export enum IdentityProviderState {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  ERROR = 'ERROR',
  SYNCING = 'SYNCING'
}

registerEnumType(IdentityProviderKind, {
  name: 'IdentityProviderKind',
  description: 'External directory provider type'
})

registerEnumType(IdentityProviderState, {
  name: 'IdentityProviderState',
  description: 'External directory connection state'
})

registerEnumType(IdentitySyncStatus, {
  name: 'IdentitySyncStatus',
  description: 'External directory sync run status'
})

@ObjectType()
export class IdentityProviderType {
  @Field(() => ID)
    id: string = ''

  @Field()
    name: string = ''

  @Field(() => IdentityProviderKind)
    providerType: IdentityProviderKind = IdentityProviderKind.ACTIVE_DIRECTORY

  @Field(() => IdentityProviderState)
    status: IdentityProviderState = IdentityProviderState.DISCONNECTED

  @Field()
    enabled: boolean = true

  @Field(() => String, { nullable: true })
    domain?: string | null

  @Field()
    host: string = ''

  @Field()
    port: number = 389

  @Field()
    useTls: boolean = false

  @Field(() => String, { nullable: true })
    tlsCa?: string | null

  @Field()
    tlsInsecureSkipVerify: boolean = false

  @Field()
    baseDn: string = ''

  @Field(() => String, { nullable: true })
    bindDn?: string | null

  @Field()
    hasBindPassword: boolean = false

  @Field(() => String, { nullable: true })
    userFilter?: string | null

  @Field(() => String, { nullable: true })
    groupFilter?: string | null

  @Field(() => GraphQLJSONObject, { nullable: true })
    attributes?: Prisma.JsonValue | null

  @Field(() => Date, { nullable: true })
    lastTestAt?: Date | null

  @Field(() => Date, { nullable: true })
    lastSyncAt?: Date | null

  @Field(() => String, { nullable: true })
    lastError?: string | null

  @Field()
    createdAt: Date = new Date()

  @Field()
    updatedAt: Date = new Date()
}

@ObjectType()
export class IdentityProviderConnectionResultType {
  @Field()
    success: boolean = false

  @Field()
    message: string = ''

  @Field({ nullable: true })
    latencyMs?: number

  @Field(() => IdentityProviderType, { nullable: true })
    provider?: IdentityProviderType | null
}

@ObjectType()
export class IdentityProviderSyncResultType {
  @Field()
    success: boolean = false

  @Field()
    message: string = ''

  @Field()
    syncRunId: string = ''

  @Field()
    usersCreated: number = 0

  @Field()
    usersUpdated: number = 0

  @Field()
    usersDisabled: number = 0

  @Field()
    groupsSeen: number = 0

  @Field(() => IdentityProviderType, { nullable: true })
    provider?: IdentityProviderType | null
}

@ObjectType()
export class IdentitySyncRunType {
  @Field(() => ID)
    id: string = ''

  @Field(() => ID)
    providerId: string = ''

  @Field(() => IdentitySyncStatus)
    status: IdentitySyncStatus = IdentitySyncStatus.RUNNING

  @Field(() => Date)
    startedAt: Date = new Date()

  @Field(() => Date, { nullable: true })
    finishedAt?: Date | null

  @Field(() => Int)
    usersCreated: number = 0

  @Field(() => Int)
    usersUpdated: number = 0

  @Field(() => Int)
    usersDisabled: number = 0

  @Field(() => Int)
    groupsSeen: number = 0

  @Field(() => String, { nullable: true })
    message?: string | null

  @Field(() => String, { nullable: true })
    error?: string | null
}

@ObjectType()
export class IdentityGroupRoleMappingType {
  @Field(() => ID)
    id: string = ''

  @Field(() => ID)
    providerId: string = ''

  @Field()
    groupDn: string = ''

  @Field()
    groupName: string = ''

  @Field(() => UserRole)
    role: UserRole = UserRole.USER

  @Field()
    createdAt: Date = new Date()

  @Field()
    updatedAt: Date = new Date()
}

@InputType()
export class UpsertIdentityGroupRoleMappingInput {
  @Field(() => ID)
    providerId: string = ''

  @Field()
    groupDn: string = ''

  @Field(() => String, { nullable: true })
    groupName?: string

  @Field(() => UserRole)
    role: UserRole = UserRole.USER
}

@InputType()
export class CreateIdentityProviderInput {
  @Field()
    name: string = ''

  @Field(() => IdentityProviderKind)
    providerType: IdentityProviderKind = IdentityProviderKind.ACTIVE_DIRECTORY

  @Field(() => Boolean, { nullable: true })
    enabled?: boolean

  @Field(() => String, { nullable: true })
    domain?: string

  @Field()
    host: string = ''

  @Field(() => Number, { nullable: true })
    port?: number

  @Field(() => Boolean, { nullable: true })
    useTls?: boolean

  @Field(() => String, { nullable: true })
    tlsCa?: string

  @Field(() => Boolean, { nullable: true })
    tlsInsecureSkipVerify?: boolean

  @Field()
    baseDn: string = ''

  @Field(() => String, { nullable: true })
    bindDn?: string

  @Field(() => String, { nullable: true })
    bindPassword?: string

  @Field(() => String, { nullable: true })
    userFilter?: string

  @Field(() => String, { nullable: true })
    groupFilter?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    attributes?: Prisma.InputJsonObject
}

@InputType()
export class UpdateIdentityProviderInput {
  @Field(() => String, { nullable: true })
    name?: string

  @Field(() => IdentityProviderKind, { nullable: true })
    providerType?: IdentityProviderKind

  @Field(() => Boolean, { nullable: true })
    enabled?: boolean

  @Field(() => String, { nullable: true })
    domain?: string

  @Field(() => String, { nullable: true })
    host?: string

  @Field(() => Number, { nullable: true })
    port?: number

  @Field(() => Boolean, { nullable: true })
    useTls?: boolean

  @Field(() => String, { nullable: true })
    tlsCa?: string

  @Field(() => Boolean, { nullable: true })
    tlsInsecureSkipVerify?: boolean

  @Field(() => String, { nullable: true })
    baseDn?: string

  @Field(() => String, { nullable: true })
    bindDn?: string

  @Field(() => String, { nullable: true })
    bindPassword?: string

  @Field(() => String, { nullable: true })
    userFilter?: string

  @Field(() => String, { nullable: true })
    groupFilter?: string

  @Field(() => GraphQLJSONObject, { nullable: true })
    attributes?: Prisma.InputJsonObject
}
