import { Field, ID, InputType, Int, ObjectType, registerEnumType } from 'type-graphql'
import { GraphQLJSONObject } from 'graphql-type-json'
import { DepartmentRole, PermissionEffect } from '@prisma/client'
import { UserRole } from '../user/type'

registerEnumType(PermissionEffect, {
  name: 'PermissionEffect',
  description: 'Role permission decision'
})

registerEnumType(DepartmentRole, {
  name: 'DepartmentRole',
  description: 'Role a user holds within a single department'
})

@ObjectType()
export class PermissionPrincipalType {
  @Field()
    id: string = UserRole.USER

  @Field()
    label: string = ''

  @Field()
    kind: string = 'role'

  @Field()
    avatar: string = ''
}

@ObjectType()
export class PermissionResourceType {
  @Field()
    id: string = ''

  @Field()
    label: string = ''

  @Field()
    group: string = ''
}

@ObjectType()
export class RolePermissionMatrixType {
  @Field(() => [PermissionPrincipalType])
    principals: PermissionPrincipalType[] = []

  @Field(() => [PermissionResourceType])
    resources: PermissionResourceType[] = []

  @Field(() => GraphQLJSONObject)
    permissions: Record<string, 'allow' | 'deny'> = {}
}

@ObjectType()
export class EffectivePermissionType {
  @Field(() => [String])
    allowedResources: string[] = []
}

@InputType()
export class SetRolePermissionInput {
  @Field(() => UserRole)
    role: UserRole = UserRole.USER

  @Field()
    resource: string = ''

  @Field(() => PermissionEffect)
    effect: PermissionEffect = PermissionEffect.DENY
}

// ---------------------------------------------------------------------------
// Department-scoped roles
// ---------------------------------------------------------------------------

@ObjectType()
export class DepartmentMemberType {
  @Field(() => ID)
    id: string = ''

  @Field()
    departmentId: string = ''

  @Field()
    userId: string = ''

  @Field(() => DepartmentRole)
    role: DepartmentRole = DepartmentRole.MEMBER

  @Field()
    userEmail: string = ''

  @Field()
    userName: string = ''

  @Field(() => UserRole)
    userGlobalRole: UserRole = UserRole.USER
}

@InputType()
export class SetDepartmentMemberInput {
  @Field()
    departmentId: string = ''

  @Field()
    userId: string = ''

  @Field(() => DepartmentRole)
    role: DepartmentRole = DepartmentRole.MEMBER
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

@ObjectType()
export class PolicyAuditEntryType {
  @Field(() => ID)
    id: string = ''

  @Field({ nullable: true })
    actorId?: string

  @Field({ nullable: true })
    actorName?: string

  @Field()
    action: string = ''

  @Field()
    targetType: string = ''

  @Field({ nullable: true })
    targetId?: string

  @Field()
    summary: string = ''

  @Field(() => GraphQLJSONObject, { nullable: true })
    metadata?: Record<string, unknown>

  @Field()
    createdAt: Date = new Date()
}

@InputType()
export class PolicyAuditQueryInput {
  @Field(() => Int, { nullable: true, defaultValue: 100 })
    limit?: number = 100
}
